"use strict";

/**
 * baselines.js — pure comparison logic for golden-suite regressions.
 *
 * Split out of golden-suite-run.js so tests can require this without pulling
 * in the entire v17 agent loop (and its adb dependencies).
 */

/**
 * Compare a suite run against baseline thresholds. Returns a list of
 * human-readable regression strings; empty means the run is within baselines.
 *
 * @param {Array<object>} perApp - per-app summaries from computeSummary()
 * @param {object} aggregate - aggregate summary object
 * @param {object} baselines - baselines JSON
 * @returns {string[]}
 */
function compareToBaselines(perApp, aggregate, baselines) {
  const regressions = [];
  const apps = (baselines && baselines.apps) || {};
  for (const summary of perApp) {
    if (summary.note) continue; // skipped apps can't regress
    const bl = apps[summary.label];
    if (!bl) continue; // no baseline for this app — pass silently
    if (typeof bl.minUniqueScreens === "number" && summary.uniqueScreens < bl.minUniqueScreens) {
      regressions.push(
        `${summary.label}: uniqueScreens=${summary.uniqueScreens} < baseline ${bl.minUniqueScreens}`,
      );
    }
    if (typeof bl.maxCostUsd === "number" && summary.costUsd > bl.maxCostUsd) {
      regressions.push(
        `${summary.label}: costUsd=$${summary.costUsd} > baseline $${bl.maxCostUsd}`,
      );
    }
    if (typeof bl.maxLlmFallbackRate === "number" && summary.llmFallbackRate > bl.maxLlmFallbackRate) {
      regressions.push(
        `${summary.label}: llmFallbackRate=${summary.llmFallbackRate} > baseline ${bl.maxLlmFallbackRate}`,
      );
    }
    if (bl.mustCrossBoundary === true && !summary.crossedBoundary) {
      regressions.push(
        `${summary.label}: did not cross first decision boundary (stopReason=${summary.stopReason})`,
      );
    }
  }
  const agg = (baselines && baselines.aggregate) || {};
  if (typeof agg.maxMeanCostUsd === "number" && aggregate.meanCostUsd > agg.maxMeanCostUsd) {
    regressions.push(
      `aggregate: meanCostUsd=$${aggregate.meanCostUsd} > baseline $${agg.maxMeanCostUsd}`,
    );
  }
  if (
    typeof agg.maxOverallLlmFallbackRate === "number" &&
    aggregate.overallLlmFallbackRate > agg.maxOverallLlmFallbackRate
  ) {
    regressions.push(
      `aggregate: overallLlmFallbackRate=${aggregate.overallLlmFallbackRate} > baseline ${agg.maxOverallLlmFallbackRate}`,
    );
  }
  if (typeof agg.minCrossedBoundaryRatio === "number") {
    const ratio = aggregate.appsAttempted > 0 ? aggregate.appsCrossedBoundary / aggregate.appsAttempted : 0;
    if (ratio < agg.minCrossedBoundaryRatio) {
      regressions.push(
        `aggregate: crossedBoundaryRatio=${ratio.toFixed(3)} < baseline ${agg.minCrossedBoundaryRatio}`,
      );
    }
  }
  return regressions;
}

module.exports = { compareToBaselines };
