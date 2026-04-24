"use strict";

/**
 * crawl-health.js — Derived progress signals from a finished crawl.
 *
 * These metrics are computed from crawlResult.actionsTaken + stats and
 * threaded into report-builder's crawlHealth so the quality gates can
 * decide whether there's enough real progress to publish critical bugs.
 *
 * Pure, sync, no external deps.
 */

/**
 * Count how many times each driver acted across the crawl.
 *
 * @param {Array<{driver?: string, model?: string}>} actionsTaken
 * @returns {Record<string, number>}
 */
function computeDriverHits(actionsTaken) {
  const hits = {};
  if (!Array.isArray(actionsTaken)) return hits;
  for (const action of actionsTaken) {
    if (!action) continue;
    const name = action.driver || action.model || "unknown";
    hits[name] = (hits[name] || 0) + 1;
  }
  return hits;
}

/**
 * Decide whether the crawl crossed its first meaningful decision boundary.
 *
 * True when EITHER:
 *   - some driver other than LLMFallback acted at least once
 *     (proof the agent classified a screen and dispatched deterministically)
 *   - the crawl reached > 4 unique screens
 *     (raw coverage signal — enough depth that something non-trivial happened)
 *
 * Matches the heuristic in scripts/golden-suite-run.js:251-255 so CI and
 * production report-builder agree on what "crossed boundary" means.
 *
 * @param {Array<object>} actionsTaken - V17 agent-loop actionsTaken array
 * @param {number} uniqueStates - crawlResult.stats.uniqueStates
 * @returns {boolean}
 */
function crossedFirstDecisionBoundary(actionsTaken, uniqueStates) {
  const hits = computeDriverHits(actionsTaken);
  const driverActed = Object.keys(hits).some(
    (d) => d !== "LLMFallback" && hits[d] > 0,
  );
  const uniqueOk = typeof uniqueStates === "number" && uniqueStates > 4;
  return driverActed || uniqueOk;
}

module.exports = { computeDriverHits, crossedFirstDecisionBoundary };
