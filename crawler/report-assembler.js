"use strict";

/**
 * report-assembler.js — Final crawl result assembly and artifact persistence.
 */

const fs = require("fs");
const { flattenOracleFindings } = require("./oracle-checks");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "report-assembler" });

// Anthropic pricing (USD per million tokens) — used by V2 coverage metrics
const V2_PRICE_INPUT_PER_M = 3;
const V2_PRICE_OUTPUT_PER_M = 15;
const V2_PRICE_CACHE_WRITE_PER_M = 3.75;
const V2_PRICE_CACHE_READ_PER_M = 0.30;

/**
 * Build the V2 coverage report section (vision-first mode metrics).
 * Additive — does not replace the V1 `coverage` field (which holds
 * CoverageTracker feature-category summaries).
 *
 * @param {any} ctx - CrawlContext
 * @returns {import('./types/crawl-context').V2CoverageReport}
 */
function buildV2Coverage(ctx) {
  const actionsTaken = ctx.actionsTaken || [];
  const stepsUsed = actionsTaken.length;
  const uniqueScreens = ctx.stateGraph ? ctx.stateGraph.uniqueStateCount() : 0;

  const startTime = ctx.startTime || Date.now();
  const endTime = ctx.endTime || Date.now();
  const elapsedMs = endTime - startTime;
  const elapsedMin = elapsedMs / 60000;

  const uniquePerStep = stepsUsed > 0 ? uniqueScreens / stepsUsed : 0;
  const uniquePerMinute = elapsedMin > 0 ? uniqueScreens / elapsedMin : 0;

  const tu = ctx.v2TokenUsage || {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  const costUSD =
    (tu.inputTokens * V2_PRICE_INPUT_PER_M +
      tu.outputTokens * V2_PRICE_OUTPUT_PER_M +
      tu.cacheCreationInputTokens * V2_PRICE_CACHE_WRITE_PER_M +
      tu.cacheReadInputTokens * V2_PRICE_CACHE_READ_PER_M) /
    1_000_000;

  const cacheDenom = tu.cacheReadInputTokens + tu.cacheCreationInputTokens;
  const cacheHitRate = cacheDenom > 0 ? tu.cacheReadInputTokens / cacheDenom : 0;

  const stepsWastedOnRecovery = actionsTaken.filter((a) => a && a.type === "recovery").length;

  return {
    stepsUsed,
    uniqueScreens,
    uniquePerStep: Number(uniquePerStep.toFixed(3)),
    uniquePerMinute: Number(uniquePerMinute.toFixed(2)),
    stepsWastedOnRecovery,
    visionFirstMode: !!ctx.visionFirstMode,
    tokenUsage: tu,
    costUSD: Number(costUSD.toFixed(4)),
    cacheHitRate: Number(cacheHitRate.toFixed(3)),
  };
}

/**
 * Assemble the final crawl result, signal completion, and save artifacts.
 *
 * @param {object} ctx - CrawlContext
 * @returns {object} The crawl result object
 */
function assembleReport(ctx) {
  const { screens, actionsTaken, stateGraph, packageName, maxSteps, screenshotDir } = ctx;

  // Flatten oracle findings for the report pipeline
  const oracleFindings = flattenOracleFindings(ctx.oracleFindingsByStep);
  if (oracleFindings.length > 0) {
    log.info({ count: oracleFindings.length, types: oracleFindings.map(f => f.type) }, "Oracle findings");
  }

  // C6: Determine crawl quality tier
  const uniqueStates = stateGraph.uniqueStateCount();
  let crawlQuality;
  if (uniqueStates >= 15) crawlQuality = "full";
  else if (uniqueStates >= 5) crawlQuality = "degraded";
  else crawlQuality = "minimal";

  const result = {
    screens: screens.map((s) => ({
      index: s.index,
      step: s.step,
      path: s.screenshotPath,
      activity: s.activity,
      timestamp: s.timestamp,
      xml: s.xml,
      screenType: s.screenType || "unknown",
      feature: s.feature || "other",
      fuzzyFp: s.fuzzyFp || "",
    })),
    actionsTaken,
    graph: stateGraph.toJSON(),
    stopReason: ctx.stopReason,
    crawlQuality,
    reproPath: stateGraph.history,
    stats: {
      totalSteps: screens.length,
      uniqueStates,
      totalTransitions: stateGraph.transitions.length,
      recoveryStats: ctx.recoveryManager.getStats(),
      tokenUsage: ctx.tokenUsage || { input_tokens: 0, output_tokens: 0 },
    },
    oracleFindings,
    oracleFindingsByStep: ctx.oracleFindingsByStep,
    coverage: ctx.coverageTracker ? ctx.coverageTracker.summary() : {},
    // V2 vision-first mode coverage metrics (additive — populated on every
    // crawl, `visionFirstMode` indicates whether V2 path was active).
    v2Coverage: buildV2Coverage(ctx),
    plan: ctx.plan || null,
    flows: ctx.flowTracker ? ctx.flowTracker.getFlows() : [],
    metrics: ctx.metrics.summary({
      totalSteps: screens.length,
      uniqueStates: stateGraph.uniqueStateCount(),
    }),
  };

  // Signal crawl complete to live feed
  if (ctx.onProgress) {
    ctx.onProgress({
      phase: "analyzing",
      rawStep: maxSteps,
      maxRawSteps: maxSteps,
      countedUniqueScreens: stateGraph.uniqueStateCount(),
      targetUniqueScreens: maxSteps,
      activity: "",
      intentType: "",
      latestAction: ctx.lastLiveAction,
      message: "Crawl complete: " + result.stats.uniqueStates + " unique screens. Analyzing...",
      captureMode: "screenshot",
      packageName,
    });
  }

  log.info({ totalSteps: result.stats.totalSteps, uniqueStates: result.stats.uniqueStates, stopReason: ctx.stopReason }, "Crawl complete");

  const artifactPath = `${screenshotDir}/crawl_artifacts.json`;
  fs.writeFileSync(artifactPath, JSON.stringify(result, null, 2));
  log.info({ artifactPath }, "Artifacts saved");

  return result;
}

module.exports = { assembleReport };
