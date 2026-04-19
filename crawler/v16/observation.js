"use strict";

/**
 * v16/observation.js — Per-step observation capture + feedback derivation.
 *
 * Captures the device state into a structured Observation and computes a
 * FeedbackLabel relative to the previous observation. No decisions here —
 * agent.js reads this and decides.
 *
 * Fingerprint strategy: uses the exact-hash (MD5 prefix of PNG bytes) rather
 * than the perceptual aHash. Reason: V15 documented that aHash collapses
 * distinct Compose screens (Biztoso: 7 screens → 1 hash). Exact bytes are
 * slightly noisier (animation frames), but the agent-loop waits for
 * screen-stable readiness before capturing, which settles animations.
 */

const adb = require("../adb");
const screenshotFp = require("../screenshot-fp");

/**
 * @typedef {'changed' | 'no_change' | 'app_crashed' | 'left_app' | 'none'} FeedbackLabel
 *
 * @typedef {Object} Observation
 * @property {string} screenshotPath
 * @property {string} xml
 * @property {string} packageName
 * @property {string} activity
 * @property {string} fingerprint
 * @property {number} timestampMs
 *
 * @typedef {Object} ObservationContext
 * @property {string} targetPackage
 * @property {string} screenshotPath
 * @property {Observation|null} previous
 * @property {{type: string, [k: string]: any}|null} lastAction
 *
 * @typedef {Object} ObservationResult
 * @property {Observation} observation
 * @property {FeedbackLabel} feedback
 * @property {boolean} fingerprintChanged
 */

/**
 * Extract the package name from an activity string like "com.foo/.MainActivity".
 * @param {string} activity
 * @returns {string}
 */
function parsePackageFromActivity(activity) {
  if (!activity || typeof activity !== "string") return "unknown";
  const slash = activity.indexOf("/");
  return slash > 0 ? activity.substring(0, slash) : activity;
}

/**
 * Capture a single observation and compute feedback vs. the previous one.
 *
 * Dependencies on `adb` and `screenshotFp` are the default but can be
 * overridden for unit tests via `deps`.
 *
 * @param {ObservationContext} ctx
 * @param {{adb?:object, screenshotFp?:object}} [deps]
 * @returns {Promise<ObservationResult>}
 */
async function captureObservation(ctx, deps) {
  const _adb = (deps && deps.adb) || adb;
  const _fp = (deps && deps.screenshotFp) || screenshotFp;

  if (!ctx || typeof ctx.screenshotPath !== "string" || !ctx.screenshotPath) {
    throw new Error("captureObservation requires ctx.screenshotPath");
  }

  const screenshotOk = await _adb.screencapAsync(ctx.screenshotPath);
  const xml = await _adb.dumpXmlAsync();
  const activity = await _adb.getCurrentActivityAsync();
  const packageName = parsePackageFromActivity(activity);
  const fingerprint = screenshotOk
    ? _fp.computeExactHash(ctx.screenshotPath)
    : "no_screenshot";

  const observation = {
    screenshotPath: ctx.screenshotPath,
    xml: xml || "",
    packageName,
    activity: activity || "unknown",
    fingerprint,
    timestampMs: Date.now(),
  };

  const feedback = computeFeedback(ctx.previous, observation, ctx.targetPackage);
  const fingerprintChanged =
    ctx.previous !== null && ctx.previous.fingerprint !== observation.fingerprint;

  return { observation, feedback, fingerprintChanged };
}

/**
 * Derive a feedback label from prev → current.
 *
 * Ordering matters: left_app / app_crashed shadow changed/no_change so the
 * agent sees the dominant signal.
 *
 * @param {Observation|null} prev
 * @param {Observation} cur
 * @param {string} targetPackage
 * @returns {FeedbackLabel}
 */
function computeFeedback(prev, cur, targetPackage) {
  if (!prev) return "none";

  // Out of target app
  if (
    targetPackage &&
    cur.packageName &&
    cur.packageName !== "unknown" &&
    cur.packageName !== targetPackage
  ) {
    return "left_app";
  }

  // Heuristic crash detection: packageName went to 'unknown' or launcher, or activity contains "crash"
  const crashy =
    (cur.activity || "").toLowerCase().includes("crash") ||
    (cur.packageName === "unknown" && prev.packageName === targetPackage);
  if (crashy) return "app_crashed";

  if (prev.fingerprint && cur.fingerprint && prev.fingerprint === cur.fingerprint) {
    return "no_change";
  }
  return "changed";
}

module.exports = {
  captureObservation,
  computeFeedback,
  parsePackageFromActivity,
};
