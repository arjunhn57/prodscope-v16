"use strict";

/**
 * ux-heuristics.js — Deterministic UX issue detection
 *
 * Checks accessibility (missing contentDescription, small tap targets),
 * empty screens, and slow response times. Zero LLM tokens.
 */

const { ACCESSIBILITY_MIN_TAP_DP, SLOW_RESPONSE_THRESHOLD_MS } = require("../config/defaults");

// -------------------------------------------------------------------------
// Bounds parser
// -------------------------------------------------------------------------

function parseBounds(boundsStr) {
  if (!boundsStr) return null;
  const m = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return {
    x1: parseInt(m[1], 10),
    y1: parseInt(m[2], 10),
    x2: parseInt(m[3], 10),
    y2: parseInt(m[4], 10),
  };
}

// Assume typical density ~2.75 (1080px / 393dp)
const PX_PER_DP = 2.75;

function pxToDp(px) {
  return px / PX_PER_DP;
}

// -------------------------------------------------------------------------
// Accessibility checks
// -------------------------------------------------------------------------

/**
 * Check for accessibility issues in the UI XML.
 * @param {string} xml - uiautomator XML dump
 * @returns {Array<{ type: string, severity: string, detail: string, element: string }>}
 */
function checkAccessibility(xml) {
  if (!xml) return [];
  const findings = [];

  // Regex to match clickable/focusable nodes
  const nodeRegex = /<node\s[^>]*>/gi;
  let match;

  while ((match = nodeRegex.exec(xml)) !== null) {
    const node = match[0];

    // Skip non-interactive elements
    const clickable = /clickable="true"/i.test(node);
    const focusable = /focusable="true"/i.test(node);
    if (!clickable && !focusable) continue;

    const className = (node.match(/class="([^"]+)"/) || [])[1] || "";
    const resourceId = (node.match(/resource-id="([^"]+)"/) || [])[1] || "";
    const text = (node.match(/text="([^"]+)"/) || [])[1] || "";
    const contentDesc = (node.match(/content-desc="([^"]+)"/) || [])[1] || "";
    const boundsStr = (node.match(/bounds="([^"]+)"/) || [])[1] || "";

    const elementId = resourceId || text || className;

    // Check 1: Missing contentDescription on ImageView/ImageButton
    if (
      (className.includes("ImageView") || className.includes("ImageButton")) &&
      !contentDesc &&
      !text
    ) {
      findings.push({
        type: "missing_content_description",
        severity: "medium",
        detail: `Clickable image missing contentDescription for screen readers`,
        element: elementId,
      });
    }

    // Check 2: Small tap target
    const bounds = parseBounds(boundsStr);
    if (bounds) {
      const widthDp = pxToDp(bounds.x2 - bounds.x1);
      const heightDp = pxToDp(bounds.y2 - bounds.y1);

      if (widthDp < ACCESSIBILITY_MIN_TAP_DP || heightDp < ACCESSIBILITY_MIN_TAP_DP) {
        findings.push({
          type: "small_tap_target",
          severity: "low",
          detail: `Tap target too small: ${Math.round(widthDp)}×${Math.round(heightDp)}dp (min ${ACCESSIBILITY_MIN_TAP_DP}dp)`,
          element: elementId,
        });
      }
    }
  }

  // Cap findings to avoid noise (max 10 per screen)
  return findings.slice(0, 10);
}

// -------------------------------------------------------------------------
// Empty screen check
// -------------------------------------------------------------------------

/**
 * Check if a screen has no interactable elements (likely broken/stuck).
 * @param {string} xml - uiautomator XML dump
 * @returns {{ isEmpty: boolean, detail: string }}
 */
function checkEmptyScreen(xml) {
  if (!xml) return { isEmpty: true, detail: "No XML available" };

  const clickableCount = (xml.match(/clickable="true"/gi) || []).length;
  const editableCount = (xml.match(/class="android\.widget\.EditText"/gi) || []).length;
  const scrollableCount = (xml.match(/scrollable="true"/gi) || []).length;

  const interactableCount = clickableCount + editableCount + scrollableCount;

  if (interactableCount === 0) {
    return {
      isEmpty: true,
      detail: `Screen has 0 interactable elements (no clickable, editable, or scrollable nodes)`,
    };
  }

  return { isEmpty: false, detail: "" };
}

// -------------------------------------------------------------------------
// Slow response check
// -------------------------------------------------------------------------

/**
 * Check if the transition time exceeded the threshold.
 * @param {number} preActionTimestamp - Timestamp before action (Date.now())
 * @param {number} [postTimestamp] - Timestamp after action (defaults to now)
 * @returns {{ slow: boolean, durationMs: number, detail: string }}
 */
function checkSlowResponse(preActionTimestamp, postTimestamp) {
  const now = postTimestamp || Date.now();
  const durationMs = now - preActionTimestamp;

  if (durationMs > SLOW_RESPONSE_THRESHOLD_MS) {
    return {
      slow: true,
      durationMs,
      detail: `Screen transition took ${(durationMs / 1000).toFixed(1)}s (threshold: ${SLOW_RESPONSE_THRESHOLD_MS / 1000}s)`,
    };
  }

  return { slow: false, durationMs, detail: "" };
}

// -------------------------------------------------------------------------
// Aggregated check
// -------------------------------------------------------------------------

/**
 * Run all UX heuristic checks on a screen.
 * @param {string} xml
 * @param {number} [preActionTimestamp]
 * @returns {Array<{ type: string, severity: string, detail: string, element?: string }>}
 */
function runAllChecks(xml, preActionTimestamp) {
  const findings = [];

  // Accessibility
  findings.push(...checkAccessibility(xml));

  // Empty screen
  const empty = checkEmptyScreen(xml);
  if (empty.isEmpty) {
    findings.push({
      type: "empty_screen",
      severity: "high",
      detail: empty.detail,
    });
  }

  // Slow response
  if (preActionTimestamp) {
    const slow = checkSlowResponse(preActionTimestamp);
    if (slow.slow) {
      findings.push({
        type: "slow_response",
        severity: "medium",
        detail: slow.detail,
      });
    }
  }

  return findings;
}

module.exports = {
  checkAccessibility,
  checkEmptyScreen,
  checkSlowResponse,
  runAllChecks,
  parseBounds,
};
