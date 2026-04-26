"use strict";

/**
 * lib/live-stream-cloak.js — defensive framing for the live-preview stream.
 *
 * Why this exists: the `/run/:jobId` live preview is the most-watched
 * surface of the product — design partners, prospects, and (via demo
 * videos / shared run links) competitors will see it. If the stream
 * looks like "an Android emulator running a script," it cheapens the
 * product and gives competitors a one-line pitch to copy ("just glue
 * an LLM to UIAutomator"). This module hides the framing:
 *
 *   1. Frames showing the Android launcher / recents / system UI are
 *      suppressed — viewers see the previous app frame held instead.
 *   2. The status bar (top ~80px) and nav bar / gesture pill (bottom
 *      ~130px) are cropped before the frame leaves the server. The
 *      viewer sees the app body, not Android system chrome.
 *   3. Activity / package metadata that names "launcher" / "systemui"
 *      / etc. is sanitized in the X-* headers so the page renders
 *      "Switching to your app…" instead of leaking the launcher
 *      activity name.
 *
 * Cropping uses @napi-rs/canvas (already a dep — used by the annotator
 * and the Phase F1 classifier downscale). ~5–10 ms per frame on 1080
 * × 2400 input.
 */

const { createCanvas, loadImage } = require("@napi-rs/canvas");

// Crop margins (px) on a typical 1080×2400 capture. Conservative — these
// strip the OS status bar and nav-bar / gesture pill but should not cut
// into any app's UI under a normal display config. Apps that draw
// edge-to-edge content lose ~6dp at top/bottom; acceptable.
const STATUS_BAR_PX = 80;
const NAV_BAR_PX = 130;

/**
 * Patterns that indicate the foreground is system UI (launcher,
 * recents, settings, system dialog) — NOT the target app. Frames
 * matching these should be suppressed; viewers should see the
 * previous app frame held in place instead.
 *
 * Activity strings come in shapes like:
 *   com.google.android.apps.nexuslauncher.NexusLauncherActivity
 *   com.android.launcher3.Launcher
 *   com.android.systemui.recents.RecentsActivity
 *   com.android.settings.SubSettings
 *
 * Test against the FULL activity string (including dotted prefix).
 */
const SYSTEM_UI_PATTERNS = [
  /\.nexuslauncher\./i,
  /\.launcher\d?(\.|$)/i,
  /\bcom\.android\.launcher/i,
  /\.systemui(\.|$)/i,
  /\bcom\.android\.systemui\b/i,
  /\.recents\./i,
  /\bcom\.android\.settings\b/i,
  /\bcom\.google\.android\.googlequicksearchbox\b/i,
  /\bcom\.android\.intentresolver\b/i,
  /\bcom\.google\.android\.permissioncontroller\b/i,
  /\bcom\.google\.android\.packageinstaller\b/i,
  /\bcom\.android\.packageinstaller\b/i,
  /\bandroid\.intent\.action\.MAIN\b/i,
];

/**
 * Predicate: is this activity / package one we should hide from viewers?
 *
 * @param {string|null|undefined} activity
 * @returns {boolean}
 */
function isSystemUiActivity(activity) {
  if (!activity || typeof activity !== "string") return false;
  return SYSTEM_UI_PATTERNS.some((re) => re.test(activity));
}

/**
 * Crop the OS status + nav bars from a captured PNG buffer. Returns a
 * fresh PNG buffer. Falls back to the original buffer on any error so
 * the live stream never breaks because of a bad frame.
 *
 * @param {Buffer} pngBuf
 * @param {{statusBarPx?: number, navBarPx?: number}} [opts]
 * @returns {Promise<Buffer>}
 */
async function cropAppBody(pngBuf, opts = {}) {
  if (!pngBuf || pngBuf.length === 0) return pngBuf;
  const top = opts.statusBarPx ?? STATUS_BAR_PX;
  const bot = opts.navBarPx ?? NAV_BAR_PX;
  try {
    const img = await loadImage(pngBuf);
    const srcW = img.width;
    const srcH = img.height;
    // If the image is too small for our crop margins, ship as-is rather
    // than producing a degenerate frame.
    if (srcH <= top + bot + 10) return pngBuf;
    const dstW = srcW;
    const dstH = srcH - top - bot;
    const canvas = createCanvas(dstW, dstH);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, -top, srcW, srcH);
    return canvas.toBuffer("image/png");
  } catch (_err) {
    return pngBuf;
  }
}

/**
 * Sanitize live-stream metadata headers when the foreground is system
 * UI. The viewer should NOT see "NexusLauncherActivity" in the page —
 * they should see a friendly "preparing next view" line.
 *
 * @param {{activity?: string, intentType?: string, latestAction?: string|object, message?: string}} meta
 * @returns {{activity: string, intentType: string, action: string, message: string, isSystem: boolean}}
 */
function sanitizeMeta(meta = {}) {
  const isSystem = isSystemUiActivity(meta.activity);
  if (!isSystem) {
    let actionStr = "";
    if (meta.latestAction && typeof meta.latestAction === "object") {
      actionStr = [meta.latestAction.type, meta.latestAction.description]
        .filter(Boolean)
        .join(": ");
    } else if (meta.latestAction) {
      actionStr = String(meta.latestAction);
    }
    return {
      activity: meta.activity || "",
      intentType: meta.intentType || "",
      action: actionStr,
      message: meta.message || "",
      isSystem: false,
    };
  }
  // System-UI: hide the actual identifiers behind a friendly status.
  return {
    activity: "",
    intentType: "",
    action: "",
    message: "Preparing next view…",
    isSystem: true,
  };
}

module.exports = {
  isSystemUiActivity,
  cropAppBody,
  sanitizeMeta,
  STATUS_BAR_PX,
  NAV_BAR_PX,
  SYSTEM_UI_PATTERNS,
};
