"use strict";

/**
 * v16/state.js — Unique-screen counter keyed by perceptual fingerprint.
 *
 * The state graph is intentionally simple in V16: the agent decides when to
 * stop, so there is no cycle-detection, stuck-detection, or soft-revisit
 * logic here. We just record visits and count distinct fingerprints.
 *
 * State identity is the fingerprint ONLY — activity name and package are
 * metadata for logging. (V15 split multi-window flows by activity; V16 does
 * not.)
 */

/**
 * @typedef {Object} VisitRecord
 * @property {string} fingerprint
 * @property {string} activity
 * @property {string} packageName
 * @property {number} step
 * @property {number} timestampMs
 */

function createStateGraph() {
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {VisitRecord[]} */
  const visits = [];

  /**
   * @param {string} fingerprint
   * @param {{activity:string, packageName:string, step:number}} meta
   * @returns {{isNew: boolean, visitCount: number}}
   */
  function recordVisit(fingerprint, meta) {
    if (!fingerprint || typeof fingerprint !== "string") {
      throw new Error("recordVisit requires non-empty fingerprint");
    }
    const prev = counts.get(fingerprint) || 0;
    const next = prev + 1;
    counts.set(fingerprint, next);
    visits.push({
      fingerprint,
      activity: meta.activity || "unknown",
      packageName: meta.packageName || "unknown",
      step: meta.step,
      timestampMs: Date.now(),
    });
    return { isNew: prev === 0, visitCount: next };
  }

  function uniqueScreenCount() {
    return counts.size;
  }

  function history() {
    return visits.slice();
  }

  function visitCounts() {
    const out = {};
    for (const [k, v] of counts.entries()) out[k] = v;
    return out;
  }

  return { recordVisit, uniqueScreenCount, history, visitCounts };
}

module.exports = { createStateGraph };
