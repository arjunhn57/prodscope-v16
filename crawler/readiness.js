/**
 * readiness.js — Screen readiness engine
 * Replaces blind sleep() calls with polling-based readiness detection.
 * All functions return structured results and never throw.
 */

"use strict";

const crypto = require("crypto");
const path = require("path");
const adb = require("./adb");
const screenshotFp = require("./screenshot-fp");
const { normalize } = require("./fingerprint");
const { sleep } = require("../utils/sleep");
const defaults = require("../config/defaults");

async function pollUntil(checkFn, opts = {}) {
  const pollInterval = opts.pollIntervalMs || defaults.READINESS_POLL_INTERVAL_MS || 250;
  const timeout = opts.timeoutMs || 5000;
  const start = Date.now();
  let lastResult = { done: false };

  while (Date.now() - start < timeout) {
    try {
      lastResult = await checkFn();
      if (lastResult.done) {
        return { ready: true, elapsedMs: Date.now() - start, ...lastResult };
      }
    } catch (_e) {}
    await sleep(pollInterval);
  }

  return { ready: false, elapsedMs: Date.now() - start, reason: "timeout", ...lastResult };
}

async function waitForScreenReady(opts = {}) {
  // Don't hammer a dead UIAutomator service
  if (adb.isUiAutomatorDegraded()) {
    return { ready: true, elapsedMs: 0, reason: "uiautomator_degraded", xml: "" };
  }

  const timeoutMs = opts.timeoutMs || defaults.READINESS_SCREEN_TIMEOUT_MS || 5000;
  const pollIntervalMs = opts.pollIntervalMs || defaults.READINESS_POLL_INTERVAL_MS || 250;
  const minStable = opts.minStableCount || defaults.READINESS_MIN_STABLE_COUNT || 2;

  let lastHash = null;
  let stableCount = 0;
  let lastXml = "";

  const result = await pollUntil(
    () => {
      const xml = adb.dumpXml();
      lastXml = xml || "";
      if (!xml || xml.trim() === "") {
        stableCount = 0;
        lastHash = null;
        return { done: false, reason: "empty_xml", xml: lastXml };
      }
      const normalized = normalize(xml);
      const hash = crypto.createHash("md5").update(normalized).digest("hex");
      if (hash === lastHash) {
        stableCount++;
      } else {
        stableCount = 1;
        lastHash = hash;
      }
      if (stableCount >= minStable) {
        return { done: true, reason: "stable", xml: lastXml };
      }
      return { done: false, reason: "settling", xml: lastXml };
    },
    { pollIntervalMs, timeoutMs }
  );

  return {
    ready: result.ready,
    elapsedMs: result.elapsedMs,
    reason: result.reason || "timeout",
    xml: result.xml || lastXml,
  };
}

async function waitForAppForeground(packageName, opts = {}) {
  const timeoutMs = opts.timeoutMs || defaults.READINESS_FOREGROUND_TIMEOUT_MS || 10000;
  const pollIntervalMs = opts.pollIntervalMs || 300;

  return pollUntil(
    () => {
      const current = adb.getCurrentPackage();
      if (current === packageName) {
        return { done: true, reason: "foreground" };
      }
      return { done: false, reason: "wrong_package", currentPackage: current };
    },
    { pollIntervalMs, timeoutMs }
  );
}

async function waitForInteractiveUi(opts = {}) {
  const timeoutMs = opts.timeoutMs || defaults.READINESS_INTERACTIVE_TIMEOUT_MS || 5000;
  const pollIntervalMs = opts.pollIntervalMs || 300;
  const minClickable = opts.minClickable || 1;
  let lastXml = "";

  const result = await pollUntil(
    () => {
      const xml = adb.dumpXml();
      lastXml = xml || "";
      if (!xml) {
        return { done: false, reason: "no_xml", xml: "", clickableCount: 0 };
      }
      const matches = xml.match(/clickable="true"/g);
      const count = matches ? matches.length : 0;
      if (count >= minClickable) {
        return { done: true, reason: "interactive", xml, clickableCount: count };
      }
      return { done: false, reason: "not_interactive", xml, clickableCount: count };
    },
    { pollIntervalMs, timeoutMs }
  );

  return {
    ready: result.ready,
    elapsedMs: result.elapsedMs,
    reason: result.reason || "timeout",
    xml: result.xml || lastXml,
    clickableCount: result.clickableCount || 0,
  };
}

/**
 * Screenshot-based screen readiness — for when UIAutomator is dead.
 * Polls via screencap + perceptual hash instead of XML MD5.
 */
async function waitForScreenReadyScreenshotOnly(screenshotDir, stepLabel, opts = {}) {
  const timeoutMs = opts.timeoutMs || 3000;
  const pollIntervalMs = opts.pollIntervalMs || 500;
  const minStable = 2;

  let lastHash = null;
  let stableCount = 0;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const ssPath = path.join(screenshotDir, `ready_${stepLabel}_${stableCount}.png`);
    const ok = adb.screencap(ssPath);
    if (!ok) {
      stableCount = 0;
      lastHash = null;
      await sleep(pollIntervalMs);
      continue;
    }

    const hash = screenshotFp.computeHash(ssPath);
    if (hash === "no_screenshot") {
      stableCount = 0;
      lastHash = null;
      await sleep(pollIntervalMs);
      continue;
    }

    if (lastHash && screenshotFp.isSameScreen(lastHash, hash, 5)) {
      stableCount++;
    } else {
      stableCount = 1;
      lastHash = hash;
    }

    if (stableCount >= minStable) {
      return { ready: true, elapsedMs: Date.now() - start, reason: "stable_screenshot", screenshotHash: hash };
    }

    await sleep(pollIntervalMs);
  }

  return { ready: false, elapsedMs: Date.now() - start, reason: "timeout", screenshotHash: lastHash };
}

/**
 * E2: Adaptive readiness — selects fast or normal path based on action context.
 *
 * Fast path (scrolls, revisited screens): single XML check, ~250ms.
 * Normal path: convergence polling, up to 5s.
 *
 * @param {object} opts
 * @param {string} [opts.actionType] - 'scroll', 'swipe', 'back', 'tap', etc.
 * @param {number} [opts.visitCount] - How many times current screen has been visited
 * @param {number} [opts.timeoutMs] - Override timeout
 */
async function waitForScreenReadyAdaptive(opts = {}) {
  const actionType = opts.actionType || 'tap';
  const visitCount = opts.visitCount || 0;

  // Don't hammer a dead UIAutomator service
  if (adb.isUiAutomatorDegraded()) {
    return { ready: true, elapsedMs: 0, reason: "uiautomator_degraded", xml: "", mode: "degraded" };
  }

  // Fast path: scrolls and revisited screens need minimal readiness checks
  const isFastPath = actionType === 'scroll' || actionType === 'swipe' || visitCount >= 3;

  if (isFastPath) {
    // Single XML check — no convergence polling
    await sleep(200); // brief settle
    const xml = adb.dumpXml();
    return {
      ready: true,
      elapsedMs: 200,
      reason: "fast_path",
      xml: xml || "",
      mode: "fast",
    };
  }

  // Back actions get a shorter timeout
  if (actionType === 'back') {
    return waitForScreenReady({ ...opts, timeoutMs: opts.timeoutMs || 2000, minStableCount: 1 });
  }

  // Normal path: full convergence polling
  const result = await waitForScreenReady(opts);

  // Visual loading check for sparse screens (Compose/Flutter)
  if (opts.screenshotDir && result.ready && result.xml) {
    const clickableCount = (result.xml.match(/clickable="true"/g) || []).length;
    if (clickableCount < 5) {
      const { isLoadingScreenVisual } = require("./loading-detector");
      const isLoading = await isLoadingScreenVisual(opts.screenshotDir, clickableCount);
      if (isLoading) {
        await sleep(1500);
        const freshXml = adb.dumpXml();
        return { ...result, xml: freshXml || result.xml, mode: "waited_visual_loading" };
      }
    }
  }

  return { ...result, mode: "normal" };
}

module.exports = {
  waitForScreenReady,
  waitForScreenReadyAdaptive,
  waitForScreenReadyScreenshotOnly,
  waitForAppForeground,
  waitForInteractiveUi,
};
