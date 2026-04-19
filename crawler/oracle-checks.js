"use strict";

/**
 * oracle-checks.js — Post-action oracle checks for crash, ANR, accessibility, and slow transitions.
 *
 * These are "free" bug detections that require zero LLM calls — just logcat, dumpsys, and XML parsing.
 */

const adb = require("./adb");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "oracle-checks" });

/**
 * Run oracle checks after each action.
 *
 * @param {object} ctx - CrawlContext
 * @param {object} snapshot - Screen snapshot (must have .xml, .activity)
 * @param {number} step - Current step number
 * @param {number} preActionTimestamp - Date.now() before the action was executed
 * @returns {Array<object>} Array of finding objects
 */
function runOracleChecks(ctx, snapshot, step, preActionTimestamp) {
  const stepFindings = [];

  // Crash detection via logcat — only count crashes FROM the target app,
  // not from UIAutomator or other system processes
  try {
    const logcat = adb.run("adb logcat -d -s AndroidRuntime:E", { ignoreError: true });
    if (logcat && /FATAL EXCEPTION/.test(logcat)) {
      // Filter out UIAutomator's own crashes (common with rapid dump commands)
      const isUiAutomatorCrash = /com\.android\.commands\.uiautomator|UiAutomationService.*already registered/.test(logcat);
      if (!isUiAutomatorCrash) {
        // Check if crash is from the target app or a genuinely unknown process
        const isTargetCrash = ctx.packageName && logcat.includes(ctx.packageName);
        const severity = isTargetCrash ? "critical" : "low";
        stepFindings.push({ type: "crash", severity, detail: logcat.substring(0, 500), step });
        log.error({ step, isTargetCrash }, "CRASH DETECTED");
      } else {
        log.warn({ step }, "UIAutomator crash in logcat (not an app bug)");
      }
    }
  } catch (e) { /* logcat check failed, non-critical */ }

  // ANR detection
  try {
    const anrCheck = adb.run("adb shell dumpsys activity processes | grep ANR", { ignoreError: true });
    if (anrCheck && anrCheck.trim() && /ANR in/.test(anrCheck)) {
      stepFindings.push({ type: "anr", severity: "high", detail: anrCheck.trim().substring(0, 300), step });
      log.error({ step }, "ANR DETECTED");
    }
  } catch (e) { /* ANR check failed, non-critical */ }

  // Accessibility: missing content descriptions on clickable elements
  if (snapshot.xml) {
    const clickableNodes = (snapshot.xml.match(/clickable="true"/g) || []).length;
    const emptyDescNodes = (snapshot.xml.match(/clickable="true"[^>]*content-desc=""/g) || []).length;
    if (clickableNodes > 3 && emptyDescNodes > clickableNodes * 0.5) {
      stepFindings.push({
        type: "missing_content_description", severity: "medium",
        detail: `${emptyDescNodes}/${clickableNodes} clickable elements lack content descriptions`,
        step, element: snapshot.activity || "unknown",
      });
    }

    // Accessibility: small tap targets
    const smallTargets = [];
    const boundsRegex = /clickable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
    let bm;
    while ((bm = boundsRegex.exec(snapshot.xml)) !== null) {
      const w = parseInt(bm[3]) - parseInt(bm[1]);
      const h = parseInt(bm[4]) - parseInt(bm[2]);
      if (w < 44 || h < 44) smallTargets.push({ w, h });
    }
    if (smallTargets.length > 3) {
      stepFindings.push({
        type: "small_tap_target", severity: "low",
        detail: `${smallTargets.length} tap targets smaller than 44px (WCAG minimum 48dp)`,
        step, element: snapshot.activity || "unknown",
      });
    }
  }

  // Slow transition detection
  const transitionTime = Date.now() - preActionTimestamp;
  const slowThresholdMs = require("../config/defaults").SLOW_RESPONSE_THRESHOLD_MS || 12000;
  if (transitionTime > slowThresholdMs) {
    stepFindings.push({
      type: "slow_transition", severity: "low",
      detail: `Screen transition took ${transitionTime}ms (threshold: ${slowThresholdMs}ms)`,
      step,
    });
    log.warn({ step, transitionTimeMs: transitionTime, thresholdMs: slowThresholdMs }, "Slow transition");
  }

  return stepFindings;
}

/**
 * Flatten oracleFindingsByStep into a single array for the report pipeline.
 *
 * @param {object} oracleFindingsByStep - Map of step → findings[]
 * @returns {Array<object>}
 */
function flattenOracleFindings(oracleFindingsByStep) {
  const all = [];
  for (const findings of Object.values(oracleFindingsByStep)) {
    for (const f of findings) all.push(f);
  }
  return all;
}

module.exports = { runOracleChecks, flattenOracleFindings };
