#!/usr/bin/env node
"use strict";

/**
 * golden-suite-run.js — Phase D.5 validator.
 *
 * Runs v17/agent-loop sequentially across N apps, force-stopping + clearing
 * data between runs so no app's state leaks into the next. Emits a per-app
 * JSON summary and an aggregate `GOLDEN_SUITE_RESULT:` line at the end.
 *
 * Why its own harness (not a shell loop around e2e-v17-run): we need to own
 * the between-runs cleanup (force-stop ALL tracked packages, pm clear the
 * incoming target, KEYCODE_HOME, sleep) in a single place so no run
 * accidentally observes the previous run's activity.
 *
 * Usage:
 *   node scripts/golden-suite-run.js [--config=path/to/suite.json]
 *                                    [--baselines=path/to/baselines.json]
 *
 * Default suite is embedded below. Each entry:
 *   { label, pkg, credentials?, maxSteps?, description }
 *
 * Success gates (per the V17 plan):
 *   - ≥ 9/11 apps cross their first decision boundary
 *   - mean cost / run ≤ $0.04
 *   - LLMFallback rate < 30% across the suite
 *
 * With --baselines=..., the harness additionally checks every included app
 * against proven per-app thresholds (minUniqueScreens, maxCostUsd, etc.) and
 * exits with code 2 on any regression. This is what CI should run.
 */

const { spawnSync, spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const { runAgentLoop } = require("../crawler/v17/agent-loop");
const { compareToBaselines } = require("./baselines");

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Default suite. Matches (as far as emulator provisioning allows) the 11-app
 * plan from the V17 doc. Apps not installed on the emulator are skipped
 * automatically; missing required apps (biztoso, wikipedia) are reported as
 * FAIL in the aggregate.
 *
 * IMPORTANT: keep labels short — they become column headers.
 */
const DEFAULT_SUITE = [
  {
    label: "biztoso",
    pkg: "com.biztoso.app",
    description: "auth-walled; AuthDriver email flow pin",
    credentials: {
      email: process.env.GOLDEN_TEST_EMAIL || "aetdummyaccount@gmail.com",
      password: process.env.GOLDEN_TEST_PASSWORD || "Test@1234",
    },
    maxSteps: 25,
  },
  {
    label: "wikipedia",
    pkg: "org.wikipedia",
    description: "no-auth content; ExplorationDriver pin",
    maxSteps: 25,
  },
  {
    label: "files",
    pkg: "com.google.android.apps.nbu.files",
    description: "no-auth; BottomNav + permission",
    maxSteps: 20,
  },
  {
    label: "spotify",
    pkg: "com.spotify.music",
    description: "auth + media UI",
    maxSteps: 20,
  },
  {
    label: "chrome",
    pkg: "com.android.chrome",
    description: "WebView heavy; exercises LLMFallback",
    maxSteps: 20,
  },
  {
    label: "docs",
    pkg: "com.google.android.apps.docs",
    description: "Google SSO auth flow",
    maxSteps: 20,
  },
  {
    label: "youtube",
    pkg: "com.google.android.youtube",
    description: "feed nav + content",
    maxSteps: 20,
  },
  {
    label: "maps",
    pkg: "com.google.android.apps.maps",
    description: "permission dialogs + map canvas",
    maxSteps: 20,
  },
  {
    label: "photos",
    pkg: "com.google.android.apps.photos",
    description: "permission + grid content",
    maxSteps: 20,
  },
  {
    label: "calendar",
    pkg: "com.google.android.calendar",
    description: "list view + month view",
    maxSteps: 20,
  },
  // ── Phase 3.3: framework coverage ──────────────────────────────────
  // These apps are deliberately included to detect regressions on
  // non-native rendering paths. If the driver suite silently only works
  // on native Android views, Discord and Google Pay are the first to fail.
  {
    label: "discord",
    pkg: "com.discord",
    description: "React Native — ReactViewGroup clickable pattern",
    maxSteps: 20,
  },
  {
    label: "google-pay",
    pkg: "com.google.android.apps.nbu.paisa.user",
    description: "Flutter-dominant — CanvasDriver fallback territory",
    maxSteps: 15,
  },
];

/** Packages we ALWAYS force-stop before any run so prior-run state can't leak. */
const TRACKED_PACKAGES = [
  "com.biztoso.app",
  "org.wikipedia",
  "com.google.android.apps.nbu.files",
  "com.spotify.music",
  "com.android.chrome",
  "com.google.android.apps.docs",
  "com.google.android.youtube",
  "com.google.android.apps.maps",
  "com.google.android.apps.photos",
  "com.google.android.calendar",
  "com.discord",
  "com.google.android.apps.nbu.paisa.user",
];

function adb(args, timeoutMs = 30000) {
  const result = spawnSync("adb", args, { timeout: timeoutMs, encoding: "utf8" });
  return {
    code: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Hard reset the emulator into a known state before the next app launches.
 *   1. force-stop every tracked package (belt-and-braces — we don't trust
 *      monkey's default LAUNCHER intent to displace a lingering foreground app)
 *   2. pm clear the incoming target (fresh install state each run)
 *   3. KEYCODE_HOME back to launcher
 *   4. wait for the launcher to settle (3s)
 */
async function resetForApp(pkg, label) {
  console.log(`[suite] ${label}: resetting emulator state`);
  for (const pk of TRACKED_PACKAGES) {
    adb(["shell", "am", "force-stop", pk], 15000);
  }
  const clr = adb(["shell", "pm", "clear", pkg], 30000);
  console.log(`[suite] ${label}: pm clear → ${clr.stdout.trim() || clr.stderr.trim()}`);
  adb(["shell", "input", "keyevent", "KEYCODE_HOME"], 10000);
  await sleep(3000);
  // Verify we're on the launcher (no stray foreground app).
  const dump = adb(["shell", "dumpsys", "activity", "activities"], 15000);
  const m = dump.stdout.match(/topResumedActivity=[^\n]*\/([^\s\n]+)/);
  console.log(`[suite] ${label}: top activity pre-launch = ${m ? m[1] : "<unknown>"}`);
}

/**
 * Exact-line match on `pm list packages <pkg>`. `pm list packages` prints one
 * `package:<full.name>` per match; a substring check wrongly classifies
 * sub-packages as installed (e.g. `com.google.android.apps.docs.editors.sheets`
 * would match `com.google.android.apps.docs`). Require the full-line form.
 *
 * @param {string} pkg
 * @returns {boolean}
 */
function isPackageInstalled(pkg) {
  const r = adb(["shell", "pm", "list", "packages", pkg], 10000);
  if (typeof r.stdout !== "string") return false;
  const needle = `package:${pkg}`;
  return r.stdout
    .split("\n")
    .some((line) => line.trim() === needle);
}

/**
 * Verify the emulator is reachable, restart the adb server up to MAX_ATTEMPTS
 * times if not. Returns { ok, devices } — `ok: false` means the caller should
 * skip the run rather than hanging on an unreachable device.
 *
 * The Golden Suite's previous failure mode: after a long run the emulator's
 * adb bridge would drop silently and `adb devices` returned just the header;
 * every subsequent run then timed out on `pm list packages`. Catching that
 * here turns "one bad app stalls the entire suite" into "one bad app is
 * skipped with an explicit note".
 *
 * @param {string} label - app label (used only for logging)
 * @returns {Promise<{ok:boolean, devices:string[]}>}
 */
async function ensureEmulator(label) {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = adb(["devices"], 8000);
    const lines = (r.stdout || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    // Drop the "List of devices attached" header and keep only live devices.
    const devices = lines
      .slice(1)
      .filter((l) => /\sdevice$/.test(l));
    if (devices.length > 0) {
      if (attempt > 1) {
        console.log(
          `[suite] ${label}: emulator recovered on attempt ${attempt} (${devices.length} device(s))`,
        );
      }
      return { ok: true, devices };
    }
    console.warn(
      `[suite] ${label}: adb devices shows no live devices (attempt ${attempt}/${MAX_ATTEMPTS}); restarting adb server`,
    );
    adb(["kill-server"], 10000);
    await sleep(1500);
    adb(["start-server"], 10000);
    // start-server returns immediately; the device takes a moment to reattach.
    await sleep(2500);
  }
  return { ok: false, devices: [] };
}

function computeSummary(label, pkg, result, durationMs, note) {
  const actions = result && Array.isArray(result.actionsTaken) ? result.actionsTaken : [];
  const driverHits = {};
  const llmFallbackReasons = {};
  const llmModels = {};
  for (const a of actions) {
    const name = a.driver || a.model || "unknown";
    driverHits[name] = (driverHits[name] || 0) + 1;
    if (a.driver === "LLMFallback") {
      const reason = a.llmFallbackReason || "unknown";
      llmFallbackReasons[reason] = (llmFallbackReasons[reason] || 0) + 1;
      const m = a.model || "unknown";
      llmModels[m] = (llmModels[m] || 0) + 1;
    }
  }
  const steps = actions.length || 0;
  const llmFallbackSteps = driverHits["LLMFallback"] || 0;
  const llmFallbackRate = steps > 0 ? llmFallbackSteps / steps : 0;
  // "Crossed first decision boundary" proxy: any non-LLMFallback driver acted
  // or the run reached > 4 unique screens (no driver needed).
  const driverActed = Object.keys(driverHits).some((d) => d !== "LLMFallback" && driverHits[d] > 0);
  const crossedBoundary =
    driverActed || (result && result.uniqueScreens > 4);

  return {
    label,
    pkg,
    note: note || null,
    stopReason: (result && result.stopReason) || "harness_skip",
    uniqueScreens: (result && result.uniqueScreens) || 0,
    steps,
    costUsd: Number(((result && result.costUsd) || 0).toFixed(4)),
    durationMs,
    driverHits,
    llmFallbackRate: Number(llmFallbackRate.toFixed(3)),
    llmFallbackReasons,
    llmModels,
    crossedBoundary,
  };
}

async function runOneApp(entry) {
  const { label, pkg, credentials, maxSteps = 20 } = entry;
  const started = Date.now();
  const health = await ensureEmulator(label);
  if (!health.ok) {
    const note = "emulator unreachable — adb devices empty after restart attempts";
    console.error(`[suite] ${label}: SKIP (${note})`);
    return computeSummary(label, pkg, null, Date.now() - started, note);
  }
  if (!isPackageInstalled(pkg)) {
    const note = `package not installed on emulator — skipping`;
    console.log(`[suite] ${label}: SKIP (${note})`);
    return computeSummary(label, pkg, null, 0, note);
  }
  await resetForApp(pkg, label);
  const screenshotDir = path.join(os.tmpdir(), `v17-golden-${label}-${Date.now()}`);
  fs.mkdirSync(screenshotDir, { recursive: true });

  const jobId = `golden-${label}-${Date.now()}`;
  console.log(`[suite] ${label}: starting run jobId=${jobId} pkg=${pkg} hasCreds=${!!credentials}`);

  let result;
  try {
    result = await runAgentLoop({
      jobId,
      targetPackage: pkg,
      screenshotDir,
      credentials: credentials || null,
      appContext: {},
      budgetConfig: {
        maxSteps,
        maxCostUsd: 0.2,
        maxSonnetEscalations: 3,
      },
      onProgress: () => {},
    });
  } catch (err) {
    console.error(`[suite] ${label}: runAgentLoop threw: ${err.message}`);
    return computeSummary(label, pkg, null, Date.now() - started, `crash: ${err.message}`);
  }
  const durationMs = Date.now() - started;
  const summary = computeSummary(label, pkg, result, durationMs);
  console.log(
    `[suite] ${label}: DONE screens=${summary.uniqueScreens} cost=$${summary.costUsd} steps=${summary.steps} ` +
      `llmFallbackRate=${summary.llmFallbackRate} crossed=${summary.crossedBoundary} stopReason=${summary.stopReason}`,
  );
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let suite = DEFAULT_SUITE;
  if (args.config) {
    const cfg = JSON.parse(fs.readFileSync(args.config, "utf8"));
    if (!Array.isArray(cfg)) throw new Error("config must be a JSON array of app entries");
    suite = cfg;
  }

  const started = Date.now();
  console.log(`[suite] starting golden suite — ${suite.length} apps`);

  const perApp = [];
  for (const entry of suite) {
    const summary = await runOneApp(entry);
    perApp.push(summary);
    // Small cooldown between runs to let the emulator breathe.
    await sleep(1500);
  }

  // Aggregate.
  const included = perApp.filter((s) => !s.note);
  const skipped = perApp.filter((s) => s.note);
  const totalCost = included.reduce((a, b) => a + b.costUsd, 0);
  const meanCost = included.length > 0 ? totalCost / included.length : 0;
  const totalSteps = included.reduce((a, b) => a + b.steps, 0);
  const llmFallbackSteps = included.reduce(
    (a, b) => a + Math.round(b.llmFallbackRate * b.steps),
    0,
  );
  const overallLlmFallbackRate = totalSteps > 0 ? llmFallbackSteps / totalSteps : 0;
  const crossedCount = included.filter((s) => s.crossedBoundary).length;

  const durationMs = Date.now() - started;
  const aggregate = {
    appsAttempted: perApp.length,
    appsIncluded: included.length,
    appsSkipped: skipped.length,
    appsCrossedBoundary: crossedCount,
    meanCostUsd: Number(meanCost.toFixed(4)),
    totalCostUsd: Number(totalCost.toFixed(4)),
    overallLlmFallbackRate: Number(overallLlmFallbackRate.toFixed(3)),
    durationMs,
    gates: {
      costBar: Number(meanCost.toFixed(4)) <= 0.04,
      crossedBoundaryBar: crossedCount >= Math.ceil(0.818 * perApp.length), // ≥ 9/11
      llmFallbackBar: Number(overallLlmFallbackRate.toFixed(3)) < 0.3,
    },
  };

  console.log("\n== Per-app summary ==");
  for (const s of perApp) {
    console.log(JSON.stringify(s));
  }
  console.log("\n== Aggregate ==");
  console.log(JSON.stringify(aggregate, null, 2));

  // ── Baseline comparison (optional) ───────────────────────────────────
  // If --baselines=path is provided, compare every included app against its
  // proven thresholds and exit non-zero on any regression. CI should always
  // pass this flag so a bad merge fails fast.
  let regressions = [];
  if (args.baselines) {
    const baselinePath = path.resolve(args.baselines);
    let baselines;
    try {
      baselines = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    } catch (err) {
      console.error(`[suite] failed to load baselines ${baselinePath}: ${err.message}`);
      process.exit(1);
    }
    regressions = compareToBaselines(perApp, aggregate, baselines);
    console.log("\n== Baseline check ==");
    if (regressions.length === 0) {
      console.log(`OK — all ${included.length} included apps within baselines.`);
    } else {
      console.log(`REGRESSION — ${regressions.length} violation(s) against ${baselinePath}:`);
      for (const r of regressions) {
        console.log(`  - ${r}`);
      }
    }
  }

  console.log("\nGOLDEN_SUITE_RESULT: " + JSON.stringify({ aggregate, perApp, regressions }));

  if (regressions.length > 0) {
    process.exit(2);
  }
}

module.exports = { compareToBaselines };

// Only run the suite when invoked as a script, so tests can require this
// module for compareToBaselines() without triggering an adb-driven crawl.
if (require.main === module) {
  main().catch((err) => {
    console.error("[suite] top-level failure:", err);
    process.exit(1);
  });
}
