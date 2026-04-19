"use strict";

/**
 * screen-coverage.js — Coverage tracking, saturation, and plan lifecycle.
 *
 * Extracted from screen-intelligence.js for maintainability.
 */

const adb = require("./adb");
const { accumulateTokens } = require("./screen-classify");
const log = require("../lib/logger").logger.child({ component: "screen-coverage" });

// Brain planner modules — loaded conditionally
let createInitialPlan, currentTarget, advanceTarget, replan, replanMidCrawl, buildExplorationMap;
try {
  ({ createInitialPlan, currentTarget, advanceTarget, replan, replanMidCrawl, buildExplorationMap } = require("../brain/planner"));
} catch (_) {
  createInitialPlan = null;
}

/**
 * Handle feature saturation — press back if current feature is saturated.
 * @returns {'continue'|null}
 */
function handleSaturation(ctx, classification, fp, isNew, step, actionsTaken) {
  if (!ctx.coverageTracker) return null;

  ctx.coverageTracker.recordVisit(classification.feature, fp, classification.type);

  const canSaturationBack = ctx.saturationCooldown === 0 && fp !== ctx.homeFingerprint;

  if (ctx.coverageTracker.isSaturated(classification.feature) && !isNew && classification.confidence > 0.3) {
    if (!canSaturationBack) {
      const reason = fp === ctx.homeFingerprint ? "on HOME" : `cooldown (${ctx.saturationCooldown} steps left)`;
      ctx.log.info({ feature: classification.feature, reason }, "[brain] Feature saturated but skipping back");
    } else {
      ctx.log.info({ feature: classification.feature }, "[brain] Feature saturated — pressing back to explore elsewhere");
      adb.pressBack();
      actionsTaken.push({ step, type: "back", description: "press_back", reason: "feature_saturated", fromFingerprint: fp });
      ctx.consecutiveNoNewState = 0;
      return "continue";
    }
  } else if (ctx.coverageTracker.isSaturated(classification.feature) && !isNew && classification.confidence <= 0.3) {
    if (classification.feature === "data_entry" && canSaturationBack) {
      ctx.log.info({ feature: "data_entry" }, "[brain] Feature saturated — forcing back despite low confidence");
      adb.pressBack();
      actionsTaken.push({ step, type: "back", description: "press_back", reason: "form_saturated", fromFingerprint: fp });
      ctx.consecutiveNoNewState = 0;
      return "continue";
    }
    ctx.log.info({ feature: classification.feature, confidence: classification.confidence }, "[brain] Feature saturated but confidence too low — continuing exploration");
  }

  return null;
}

/**
 * Manage plan lifecycle: create, advance targets, replan at 40% and 70%.
 */
async function handlePlan(ctx, classification, step) {
  if (!ctx.plan && createInitialPlan && step <= 2) {
    try {
      ctx.plan = await createInitialPlan(
        { packageName: ctx.packageName, activities: [], permissions: [], appName: "" },
        { goals: ctx.goals || "", painPoints: ctx.painPoints || "", goldenPath: ctx.goldenPath || "" },
        classification.type === "navigation_hub" ? "app_with_tabs" : "general"
      );
      accumulateTokens(ctx, ctx.plan);
      ctx.log.info({ targets: ctx.plan.targets, priority: ctx.plan.priority }, "[brain] Plan created");
    } catch (e) {
      ctx.log.warn({ err: e }, "[brain] Plan creation failed");
    }
  }

  if (ctx.plan && ctx.coverageTracker && currentTarget) {
    const ct = currentTarget(ctx.plan);
    if (ct && ctx.coverageTracker.isCovered(ct)) {
      ctx.log.info({ target: ct }, "[brain] Target covered — advancing to next");
      advanceTarget(ctx.plan);
      const next = currentTarget(ctx.plan);
      if (next) ctx.log.info({ target: next }, "[brain] New target");
    }
  }

  // Replan at 40% budget — only at navigation hub screens
  if (ctx.plan && replan && ctx.coverageTracker && ctx.modeManager
      && !ctx._replanAt40Done
      && ctx.modeManager.budgetUsedPercent() >= 0.4
      && classification && classification.type === "navigation_hub") {
    try {
      const covSummary = ctx.coverageTracker.summary();
      const map = buildExplorationMap ? buildExplorationMap(ctx.coverageTracker, ctx.stateGraph, ctx.modeManager) : "";
      ctx.plan = await replan(ctx.plan, covSummary, { screenType: classification.type }, map);
      accumulateTokens(ctx, ctx.plan);
      ctx._replanAt40Done = true;
      ctx.log.info({ targets: ctx.plan.targets }, "[brain] Replanned at 40%");
    } catch (e) {
      ctx.log.warn({ err: e }, "[brain] Replan at 40% failed");
      ctx._replanAt40Done = true;
    }
  }

  // Replan at 70% budget — unconditional
  if (ctx.plan && replanMidCrawl && ctx.coverageTracker && ctx.modeManager
      && !ctx._replanAt70Done
      && ctx.modeManager.budgetUsedPercent() >= 0.7) {
    try {
      const covSummary = ctx.coverageTracker.summary();
      const uniqueScreens = ctx.stateGraph ? ctx.stateGraph.uniqueStateCount() : 0;
      const map = buildExplorationMap ? buildExplorationMap(ctx.coverageTracker, ctx.stateGraph, ctx.modeManager) : "";
      ctx.plan = await replanMidCrawl(ctx.plan, covSummary, uniqueScreens, map);
      accumulateTokens(ctx, ctx.plan);
      ctx._replanAt70Done = true;
      ctx.log.info({ targets: ctx.plan.targets }, "[brain] Replanned at 70%");
    } catch (e) {
      ctx.log.warn({ err: e }, "[brain] Replan at 70% failed");
      ctx._replanAt70Done = true;
    }
  }
}

module.exports = { handleSaturation, handlePlan };
