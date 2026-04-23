#!/usr/bin/env node
"use strict";

/**
 * v16-vs-v17-wikipedia.js
 *
 * Runs wikipedia twice on the same emulator, 30 steps each:
 *   1) V16 agent-loop
 *   2) V17 agent-loop
 *
 * Prints the uniqueScreens + stopReason + steps for each so we can tell if
 * the Phase D.2 V17 coverage gap vs Phase C is a code regression or an
 * emulator / budget issue.
 *
 * Run with `.env` sourced so the Haiku classifier has ANTHROPIC_API_KEY.
 */

const { spawnSync } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const v16 = require("../crawler/v16/agent-loop");
const v17 = require("../crawler/v17/agent-loop");

const PKG = "org.wikipedia";
const MAX_STEPS = 30;

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
  console.log(`\n=== ${label}: starting wikipedia run (${MAX_STEPS} steps) ===`);
  await resetForApp();
  const screenshotDir = path.join(os.tmpdir(), `v16v17-${label}-${Date.now()}`);
  fs.mkdirSync(screenshotDir, { recursive: true });
  const started = Date.now();
  let result;
  try {
    result = await runAgentLoop({
      jobId: `v16v17-${label}-${Date.now()}`,
      targetPackage: PKG,
      screenshotDir,
      credentials: null,
      appContext: {},
      budgetConfig: {
        maxSteps: MAX_STEPS,
        maxCostUsd: 0.2,
        maxSonnetEscalations: 3,
      },
      onProgress: () => {},
    });
  } catch (err) {
    console.error(`${label}: runAgentLoop threw: ${err.message}`);
    return { label, error: err.message };
  }
  const durationMs = Date.now() - started;
  const summary = {
    label,
    uniqueScreens: result.uniqueScreens,
    stepsUsed: result.stepsUsed,
    stopReason: result.stopReason,
    costUsd: Number((result.costUsd || 0).toFixed(4)),
    durationMs,
  };
  console.log(`=== ${label}: DONE ${JSON.stringify(summary)} ===`);
  return summary;
}

async function main() {
  // Order: V16 first, then V17 — so any slow warm-up cost falls on V16.
  const v16Summary = await runOne("V16", v16.runAgentLoop);
  // Extra cooldown between runs so the emulator settles.
  await sleep(3000);
  const v17Summary = await runOne("V17", v17.runAgentLoop);

  console.log("\n== Comparison ==");
  console.log(JSON.stringify({ v16: v16Summary, v17: v17Summary }, null, 2));
  console.log(
    `\nV16_VS_V17_RESULT: ${JSON.stringify({ v16: v16Summary, v17: v17Summary })}`,
  );
}

main().catch((err) => {
  console.error("top-level failure:", err);
  process.exit(1);
});
