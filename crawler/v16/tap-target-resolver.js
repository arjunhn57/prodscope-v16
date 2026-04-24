"use strict";

/**
 * v16/tap-target-resolver.js — Resolve a tap target's pixel coords from
 * UIAutomator XML bounds when the model has emitted `action.targetText`.
 *
 * Why: vision (Haiku perception) returns approximate (x, y) for labeled
 * buttons, and on multi-button login screens that estimate can be off by
 * 500+ pixels, causing taps to land on the wrong element. XML bounds are
 * pixel-perfect when the element is in the accessibility tree.
 *
 * Strategy (tiered, first tier with matches wins):
 *   1. exact case-sensitive match         (confidence "exact")
 *   2. exact case-insensitive match       (confidence "ci")
 *   3. case-insensitive substring match   (confidence "substring")
 * When multiple candidates match inside a tier, pick the one whose center is
 * closest to the model's fallback (x, y) — combines both signals.
 *
 * If XML is empty, unparseable, or has no matching label, we return the
 * fallback coords verbatim with source "vision". The executor then taps
 * what the model asked for — resolver is non-blocking by design.
 */

const { extractClickableLabels } = require("./auth-escape");

/**
 * @typedef {Object} TapTargetResolution
 * @property {number} x
 * @property {number} y
 * @property {'xml'|'vision'} source
 * @property {'exact'|'ci'|'substring'|'none'} confidence
 */

/**
 * @param {string|null|undefined} xml
 * @param {string|null|undefined} targetText
 * @param {{x:number,y:number}|null|undefined} fallback
 * @returns {TapTargetResolution}
 */
function resolveTapTarget(xml, targetText, fallback) {
  const fx = fallback && Number.isFinite(fallback.x) ? fallback.x : 0;
  const fy = fallback && Number.isFinite(fallback.y) ? fallback.y : 0;
  const miss = { x: fx, y: fy, source: "vision", confidence: "none" };

  if (!targetText || typeof targetText !== "string") return miss;
  const target = targetText.trim();
  if (target.length === 0) return miss;
  if (!xml || typeof xml !== "string") return miss;

  const candidates = extractClickableLabels(xml);
  if (candidates.length === 0) return miss;

  const targetLower = target.toLowerCase();

  const exact = candidates.filter((c) => c.label === target);
  if (exact.length > 0) return pickClosest(exact, fx, fy, "exact");

  const ci = candidates.filter((c) => c.labelLower === targetLower);
  if (ci.length > 0) return pickClosest(ci, fx, fy, "ci");

  const substring = candidates.filter((c) => c.labelLower.includes(targetLower));
  if (substring.length > 0) return pickClosest(substring, fx, fy, "substring");

  return miss;
}

/**
 * @param {Array<{bounds:{cx:number,cy:number}}>} candidates
 * @param {number} fx
 * @param {number} fy
 * @param {'exact'|'ci'|'substring'} confidence
 * @returns {TapTargetResolution}
 */
function pickClosest(candidates, fx, fy, confidence) {
  let best = candidates[0];
  let bestDist = manhattan(best.bounds.cx, best.bounds.cy, fx, fy);
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const d = manhattan(c.bounds.cx, c.bounds.cy, fx, fy);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return { x: best.bounds.cx, y: best.bounds.cy, source: "xml", confidence };
}

function manhattan(x1, y1, x2, y2) {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

module.exports = {
  resolveTapTarget,
};
