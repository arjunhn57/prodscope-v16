"use strict";

/**
 * v17/drivers/permission-driver.js
 *
 * Deterministic driver for Android runtime permission dialogs. Per Phase B.1
 * plan: hardcode the well-known AOSP permission-controller resource-ids and
 * NEVER call the classifier for system permissions. Haiku is reserved for the
 * long tail of vendor-customised permission UIs and in-app overlays — those
 * fall through to DismissDriver / LLMFallback rather than landing here.
 *
 * Priority:
 *   1. permission_allow_foreground_only_button  (location/camera/mic/storage —
 *                                                safest grant; user can revoke)
 *   2. permission_allow_button                  (notifications, contacts — no
 *                                                foreground-only variant)
 *   3. permission_allow_one_time_button         (API 30+ ephemeral grant)
 *
 * We never tap `permission_deny_*` buttons — denial leaves the app in a half-
 * broken state (a known source of fp_revisit_loop).
 */

const { parseClickableGraph } = require("./clickable-graph");
const { logger } = require("../../../lib/logger");

const log = logger.child({ component: "v17-permission-driver" });

/** Both AOSP package names have shipped in production Android for years. */
const SYSTEM_PERMISSION_PACKAGES = new Set([
  "com.android.permissioncontroller",
  "com.android.packageinstaller",
  // Rare but observed on older OEM ROMs:
  "com.google.android.permissioncontroller",
]);

/** Hardcoded resource-id allow-list, highest-priority first. */
const ALLOW_BUTTON_IDS = [
  "com.android.permissioncontroller:id/permission_allow_foreground_only_button",
  "com.android.packageinstaller:id/permission_allow_foreground_only_button",
  "com.android.permissioncontroller:id/permission_allow_button",
  "com.android.packageinstaller:id/permission_allow_button",
  "com.android.permissioncontroller:id/permission_allow_one_time_button",
  "com.android.packageinstaller:id/permission_allow_one_time_button",
];

const ALLOW_ID_SET = new Set(ALLOW_BUTTON_IDS);

/**
 * Resource-id patterns we MUST NEVER tap. Presence of these is also a reliable
 * signal that we ARE on a permission dialog, independent of packageName.
 */
const DENY_BUTTON_IDS = new Set([
  "com.android.permissioncontroller:id/permission_deny_button",
  "com.android.packageinstaller:id/permission_deny_button",
  "com.android.permissioncontroller:id/permission_deny_and_dont_ask_again_button",
  "com.android.packageinstaller:id/permission_deny_and_dont_ask_again_button",
]);

/**
 * Return true if this observation is a system permission dialog. Relies on
 * packageName first (cheap, correct on vanilla Android) and falls back to
 * XML resource-id inspection for OEMs that misattribute the dialog.
 *
 * @param {{packageName?:string, xml?:string|null}} observation
 * @returns {boolean}
 */
function claim(observation) {
  if (!observation || typeof observation !== "object") return false;
  const pkg = typeof observation.packageName === "string" ? observation.packageName : "";
  if (SYSTEM_PERMISSION_PACKAGES.has(pkg)) return true;
  const xml = typeof observation.xml === "string" ? observation.xml : "";
  if (!xml) return false;
  // Presence of any hardcoded permission resource-id (allow or deny) is
  // sufficient — this covers OEMs that host the dialog in a system-overlay
  // window with a misleading packageName.
  for (const id of ALLOW_ID_SET) {
    if (xml.includes(id)) return true;
  }
  for (const id of DENY_BUTTON_IDS) {
    if (xml.includes(id)) return true;
  }
  return false;
}

/**
 * Emit a tap action for the highest-priority allow button, or null if the
 * dialog doesn't match the hardcoded layout. Null yields to the next driver
 * (DismissDriver / AuthDriver / LLMFallback) — we intentionally do NOT invoke
 * the classifier here, because a mistap on a permission dialog is high-blast-
 * radius (wrong grant can block the whole run).
 *
 * @param {{xml?:string|null}} observation
 * @returns {{type:'tap', x:number, y:number, targetText?:string}|null}
 */
function decide(observation) {
  if (!observation || typeof observation !== "object") return null;
  const graph = parseClickableGraph(observation.xml);
  if (graph.clickables.length === 0) return null;

  // Walk ALLOW_BUTTON_IDS in priority order; return the first matching
  // clickable. Each priority tier is tried in full before moving to the next,
  // so we always prefer foreground-only over allow-all.
  for (const targetId of ALLOW_BUTTON_IDS) {
    const hit = graph.clickables.find((c) => c.resourceId === targetId);
    if (!hit) continue;
    log.info(
      { resourceId: targetId, cx: hit.cx, cy: hit.cy },
      "PermissionDriver: tapping allow button",
    );
    return {
      type: "tap",
      x: hit.cx,
      y: hit.cy,
      targetText: hit.label || "permission_allow",
    };
  }

  log.warn(
    { pkg: observation.packageName || "", clickables: graph.clickables.length },
    "PermissionDriver: claimed but no hardcoded allow id matched — yielding",
  );
  return null;
}

module.exports = {
  name: "PermissionDriver",
  claim,
  decide,
  // exported for direct testing
  SYSTEM_PERMISSION_PACKAGES,
  ALLOW_BUTTON_IDS,
  DENY_BUTTON_IDS,
};
