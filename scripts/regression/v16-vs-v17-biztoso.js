#!/usr/bin/env node
"use strict";

/**
 * v16-vs-v17-biztoso.js
 *
 * Biztoso counterpart to v16-vs-v17-wikipedia.js. Runs biztoso twice on the
 * same emulator, 30 steps each, with credentials so AuthDriver has a path
 * across the login wall.
 *
 * Credentials come from env vars BIZTOSO_EMAIL / BIZTOSO_PASSWORD so they
 * are never committed to source.
 *
 * Run with `.env` sourced so the Haiku classifier has ANTHROPIC_API_KEY.
 */

const { spawnSync } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const v16 = require("../crawler/v16/agent-loop");
const v17 = require("../crawler/v17/agent-loop");

const PKG = "com.biztoso.app";
const MAX_STEPS = 30;

const CREDS = {
  email: process.env.BIZTOSO_EMAIL || "",
  password: process.env.BIZTOSO_PASSWORD || "",
};
if (!CREDS.email || !CREDS.password) {
  console.error("Missing BIZTOSO_EMAIL / BIZTOSO_PASSWORD env vars");
  process.exit(2);
}

function adb(args, timeoutMs = 30000) {
  const r = spawnSync("adb", args, { timeout: timeoutMs, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function resetForApp() {
  adb(["shell", "am", "force-stop", PKG], 15000);
  adb(["shell", "pm", "clear", PKG], 30000);
  adb(["shell", "input", "keyevent", "KEYCODE_HOME"], 10000);
  await sleep(3000);
}

async function runOne(label, runAgentLoop) {
  console.log(`\n=== ${label}: starting biztoso run (${MAX_STEPS} steps) ===`);
  await resetForApp();
  const screenshotDir = path.join(os.tmpdir(), `v16v17-biztoso-${label}-${Date.now()}`);
  fs.mkdirSync(screenshotDir, { recursive: true });
  const started = Date.now();
  let result;
  try {
    result = await runAgentLoop({
      jobId: `v16v17-biztoso-${label}-${Date.now()}`,
      targetPackage: PKG,
      screenshotDir,
      credentials: { email: CREDS.email, password: CREDS.password },
      appContext: {},
      budgetConfig: {
        maxSteps: MAX_STEPS,
        maxCostUsd: 0.3,
        maxSonnetEscalations: 3,
      },
      onProgress: () => {},
    });
  } catch (err) {
    console.error(`${label}: runAgentLoop threw: ${err.message}`);
    return { label, error: err.message };
  }
  const durationMs = Date.now() - started;
  const driverHits = {};
  if (result && Array.isArray(result.actionsTaken)) {
    for (const a of result.actionsTaken) {
      const name = a.driver || a.model || "unknown";
      driverHits[name] = (driverHits[name] || 0) + 1;
    }
  }
  const summary = {
    label,
    uniqueScreens: result.uniqueScreens,
    stepsUsed: result.stepsUsed,
    stopReason: result.stopReason,
    costUsd: Number((result.costUsd || 0).toFixed(4)),
    durationMs,
    driverHits,
  };
  console.log(`=== ${label}: DONE ${JSON.stringify(summary)} ===`);
  return summary;
}

async function main() {
  const v16Summary = await runOne("V16", v16.runAgentLoop);
  await sleep(3000);
  const v17Summary = await runOne("V17", v17.runAgentLoop);

  console.log("\n== Comparison ==");
  console.log(JSON.stringify({ v16: v16Summary, v17: v17Summary }, null, 2));
  console.log(
    `\nV16_VS_V17_BIZTOSO_RESULT: ${JSON.stringify({ v16: v16Summary, v17: v17Summary })}`,
  );
}

main().catch((err) => {
  console.error("top-level failure:", err);
  process.exit(1);
});
