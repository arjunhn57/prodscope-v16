"use strict";

/**
 * output/annotator/style.js — visual grammar for annotated screenshots.
 *
 * Every stroke weight, color, font, and spacing decision lives here so
 * the look stays consistent across the dossier. Severity + confidence
 * are encoded via halo intensity, NOT by changing the box stroke color
 * — the box stays the brand accent on every annotation. A diligence
 * reader scanning a 30-page report should be able to recognize a
 * ProdScope annotation at a glance.
 */

// Single accent stroke color — desaturated brand magenta. Severity is
// expressed by the halo, NOT by changing this.
const ACCENT = "#D62B4D";

// Off-white halo color for "strength" annotations (positive findings),
// distinct from the magenta concerns so a "good thing" doesn't look
// like a red-flag. Same accent stroke + green halo.
const STRENGTH_HALO = "#16A34A";

// Severity → halo opacity. Same color, different intensity. Concern is
// the loudest; strength is the quietest (we don't want a wall of green
// halos competing with the magenta concerns for attention).
const SEVERITY_HALO_ALPHA = {
  concern: 0.55,
  watch_item: 0.32,
  strength: 0.22,
};

// Confidence → halo width (px). Observed = thickest, hypothesis = thinnest.
// A reader can read confidence from the halo without reading the caption.
const CONFIDENCE_HALO_PX = {
  observed: 8,
  inferred: 5,
  hypothesis: 3,
};

// Stroke weights — same on every annotation regardless of severity.
const STROKE = {
  elementPx: 2,        // mode=element: solid box
  regionPx: 2,         // mode=region: dashed box
  regionDash: [10, 6], // dash pattern for region mode
  arrowPx: 1.5,        // arrow line width (used sparingly)
  cropFramePx: 3,      // zoom frame thickness
};

// Number badge — the ①②③ callouts that tie an annotation to its
// sidebar caption. Drawn on top of the box; reader's eye lands on the
// badge first, then the box, then the caption.
const BADGE = {
  radius: 14,
  fillColor: ACCENT,
  textColor: "#FFFFFF",
  fontSize: 14,
  fontWeight: "700",
  // Stroke around the badge — keeps it readable on busy backgrounds.
  ringPx: 2,
  ringColor: "#FFFFFF",
};

// Caption strip — when mode=whole_screen or when we render the caption
// below the screenshot (vs. in the sidebar). Small, dense, mono.
const CAPTION = {
  fontSize: 12,
  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  paddingX: 10,
  paddingY: 8,
  bgColor: "rgba(15, 23, 42, 0.92)", // slate-900 with alpha
  textColor: "#F8FAFC",              // slate-50
  maxLineWidth: 540,                  // px before wrap
};

// Sidebar caption list — the "①: <claim>" rows next to the screenshot
// when we render the full annotated panel.
const SIDEBAR = {
  width: 280,                        // px
  paddingX: 16,
  paddingY: 12,
  rowGap: 10,
  badgeGap: 8,
  fontSize: 13,
  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  bgColor: "#FFFFFF",
  textColor: "#0F172A",
  borderColor: "#E2E8F0",
};

// Crop / zoom frame — when we render a zoomed companion. The "rest of
// the screen" gets dimmed; the crop is highlighted by a frame.
const CROP = {
  framePx: STROKE.cropFramePx,
  frameColor: ACCENT,
  dimAlpha: 0.55,                    // 0..1 black overlay outside crop
  zoomFactor: 2.0,                   // 200% crop
};

/**
 * Resolve halo color for a severity. Strength gets a green halo so the
 * positive finding doesn't visually read as a red flag.
 */
function haloColorFor(severity) {
  if (severity === "strength") return STRENGTH_HALO;
  return ACCENT;
}

/**
 * Compose a stroke style from severity + confidence. The renderer
 * applies these to ctx — they're not mutated, just read.
 */
function strokeStyleFor({ severity, confidence }) {
  return {
    strokeColor: ACCENT,
    haloColor: haloColorFor(severity),
    haloAlpha: SEVERITY_HALO_ALPHA[severity] ?? SEVERITY_HALO_ALPHA.watch_item,
    haloPx: CONFIDENCE_HALO_PX[confidence] ?? CONFIDENCE_HALO_PX.inferred,
  };
}

module.exports = {
  ACCENT,
  STRENGTH_HALO,
  SEVERITY_HALO_ALPHA,
  CONFIDENCE_HALO_PX,
  STROKE,
  BADGE,
  CAPTION,
  SIDEBAR,
  CROP,
  haloColorFor,
  strokeStyleFor,
};
