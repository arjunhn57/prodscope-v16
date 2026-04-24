#!/usr/bin/env node
"use strict";

/**
 * e2e-smoke.js — minimal end-to-end smoke test for CI.
 *
 * Drives V17's agent loop on Wikipedia for a short budget and asserts:
 *   - the loop doesn't crash
 *   - it captures at least MIN_UNIQUE_SCREENS distinct screens
 *   - it finishes within HARD_TIMEOUT_MS
 *   - cost stays under MAX_COST_USD (so a broken budget-enforcement
 *     commit can't bleed CI credits)
 *
 * This is INTENTIONALLY narrower than scripts/golden-suite-run.js. CI
 * should know "does the full pipeline run on a real emulator?" — that
 * is the signal the smoke gives. Baseline thresholds (≥ 20 screens etc.)
 * belong in the nightly full-suite job, not in per-PR smoke.
 *
 * Exit codes:
 *   0 — smoke passed
 *   1 — infra failure (emulator unreachable, Wikipedia not installed, etc.)
 *   2 — smoke gates violated (too few screens, too expensive, crashed)
 */

const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawnSync } = require("child_process");

const { runAgentLoop } = require("../crawler/v17/agent-loop");

const TARGET_PACKAGE = "org.wikipedia";
const TARGET_LABEL = "wikipedia";
const MAX_STEPS = 10;
const MAX_COST_USD = 0.05;
const MIN_UNIQUE_SCREENS = 3;
const HARD_TIMEOUT_MS = 5 * 60 * 1000;

function adb(args, timeoutMs = 30000) {
  const result = spawnSync("adb", args, { timeout: timeoutMs, encoding: "utf8" });
  return {
    code: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(line) {
  console.log(`[smoke] ${line}`);
}

async function main() {
  log(`starting V17 smoke on ${TARGET_PACKAGE}`);

  // ── preflight: emulator reachable? ─────────────────────────────────
  const devicesCheck = adb(["devices"], 10000);
  const liveDevices = devicesCheck.stdout
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /\sdevice$/.test(l));
  if (liveDevices.length === 0) {
    console.error(`[smoke] FAIL — no adb devices found. stdout=${devicesCheck.stdout}`);
    process.exit(1);
  }
  log(`emulator OK (${liveDevices.length} device(s))`);

  // ── preflight: target APK installed? ───────────────────────────────
  const pkgCheck = adb(["shell", "pm", "list", "packages", TARGET_PACKAGE], 15000);
  const pkgInstalled = pkgCheck.stdout
    .split("\n")
    .some((line) => line.trim() === `package:${TARGET_PACKAGE}`);
  if (!pkgInstalled) {
    console.error(`[smoke] FAIL — ${TARGET_PACKAGE} is not installed on the emulator.`);
    process.exit(1);
  }
  log(`${TARGET_PACKAGE} installed`);

  // ── reset app state so the crawl starts from a clean launch ────────
  adb(["shell", "am", "force-stop", TARGET_PACKAGE], 10000);
  adb(["shell", "pm", "clear", TARGET_PACKAGE], 30000);
  adb(["shell", "input", "keyevent", "KEYCODE_HOME"], 5000);
  await sleep(2000);
  log("state reset (force-stop + pm clear + HOME)");

  // ── run the crawl under a hard wall-clock timeout ──────────────────
  const screenshotDir = path.join(os.tmpdir(), `e2e-smoke-${Date.now()}`);
  fs.mkdirSync(screenshotDir, { recursive: true });

  const started = Date.now();
  const jobId = `smoke-${started}`;
  let result;
  try {
    result = await Promise.race([
      runAgentLoop({
        jobId,
        targetPackage: TARGET_PACKAGE,
        screenshotDir,
        credentials: null,
        appContext: {},
        budgetConfig: {
          maxSteps: MAX_STEPS,
          maxCostUsd: MAX_COST_USD * 2, // loop-level soft cap; hard gate below
          maxSonnetEscalations: 1,
        },
        onProgress: () => {},
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`smoke exceeded ${HARD_TIMEOUT_MS}ms hard timeout`)),
          HARD_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    console.error(`[smoke] FAIL — runAgentLoop crashed: ${err.stack || err.message}`);
    process.exit(2);
  }

  const durationMs = Date.now() - started;
  const uniqueScreens = (result && result.uniqueScreens) || 0;
  const costUsd = Number(((result && result.costUsd) || 0).toFixed(4));
  const stopReason = (result && result.stopReason) || "unknown";
  const steps = (result && Array.isArray(result.actionsTaken) && result.actionsTaken.length) || 0;

  log(
    `done uniqueScreens=${uniqueScreens} steps=${steps} cost=$${costUsd} ` +
      `duration=${(durationMs / 1000).toFixed(1)}s stopReason=${stopReason}`,
  );

  // ── gate checks ────────────────────────────────────────────────────
  const failures = [];
  if (uniqueScreens < MIN_UNIQUE_SCREENS) {
    failures.push(`uniqueScreens=${uniqueScreens} < MIN_UNIQUE_SCREENS=${MIN_UNIQUE_SCREENS}`);
  }
  if (costUsd > MAX_COST_USD) {
    failures.push(`costUsd=$${costUsd} > MAX_COST_USD=$${MAX_COST_USD}`);
  }

  console.log(
    `SMOKE_RESULT: ${JSON.stringify({
      label: TARGET_LABEL,
      jobId,
      uniqueScreens,
      steps,
      costUsd,
      durationMs,
      stopReason,
      ok: failures.length === 0,
      failures,
    })}`,
  );

  if (failures.length > 0) {
    console.error(`[smoke] FAIL — ${failures.length} gate violation(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(2);
  }

  log("OK — all gates passed");
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[smoke] top-level failure: ${err.stack || err.message}`);
    process.exit(1);
  });
}
