// @ts-check
"use strict";

/**
 * screen-vision-resolver.js — Vision API resolution and caching.
 *
 * Handles the two vision paths: legacy XML-based and unified perception.
 * Extracted from screen-intelligence.js for maintainability.
 *
 * @typedef {import('./types/crawl-context').CrawlContext} Ctx
 */

const actions = require("./actions");
const vision = require("./vision");
const screenshotFp = require("./screenshot-fp");
const { assessXmlQuality } = require("./xml-quality");
const { VISION_SCREEN_TO_FEATURE, VISION_NAV_FILTER } = require("./crawl-context");
const { perceive } = require("./vision-perception");
const { accumulateTokens } = require("./screen-classify");
const log = require("../lib/logger").logger.child({ component: "screen-vision" });

/**
 * Compute effective fingerprint based on XML quality assessment.
 * @param {any} snapshot
 * @param {any} classification
 * @param {string} fp
 * @param {string} ssFp
 * @param {any} stateGraph
 * @returns {{ xmlQ: any, effectiveFp: string, preVisionCandidates: any[] }}
 */
function computeEffectiveFp(snapshot, classification, fp, ssFp, stateGraph) {
  const preVisionCandidates = actions.extract(snapshot.xml, stateGraph.triedActionsFor(fp));
  const xmlQ = assessXmlQuality(snapshot.xml, classification, preVisionCandidates.length);
  const effectiveFp = (xmlQ.visionPrimary && ssFp && ssFp !== "no_screenshot") ? "ss_" + ssFp : fp;
  if (xmlQ.visionPrimary) {
    log.info({ score: xmlQ.score.toFixed(2), reasons: xmlQ.reasons, effectiveFp: effectiveFp.slice(0, 16) }, "[xml-quality] Vision-primary mode activated");
  }

  // Set dynamic vision budget based on framework
  if (snapshot.xml && vision.budgetRemaining() > 0) {
    vision.setDynamicBudget(xmlQ.visionPrimary || vision.isObfuscatedFramework(snapshot.xml));
  }

  return { xmlQ, effectiveFp, preVisionCandidates };
}

/**
 * Resolve vision guidance via legacy XML-aware path.
 * @param {Ctx} ctx
 * @param {any} snapshot
 * @param {any} classification
 * @param {number} step
 * @param {string} effectiveFp
 * @param {string} ssFp
 * @param {any} xmlQ
 * @param {any[]} preVisionCandidates
 * @param {Function} formatJournal
 */
async function resolveVision(ctx, snapshot, classification, step, effectiveFp, ssFp, xmlQ, preVisionCandidates, formatJournal) {
  ctx.visionResult = null;

  const shouldCallVision = xmlQ.visionPrimary
    ? vision.budgetRemaining() > 0
    : (classification.confidence < 0.5 && vision.needsVision(snapshot.xml, classification, preVisionCandidates));

  if (shouldCallVision) {
    try {
      ctx.visionResult = await vision.getVisionGuidance(
        snapshot.screenshotPath, snapshot.xml,
        {
          classification: classification.type,
          triedCount: step,
          goal: ctx.plan ? ctx.plan.targets[0] : "explore the app",
          previousAction: /** @type {any} */ (ctx.lastActionOutcome),
          journal: formatJournal(),
        }
      );
      if (ctx.visionResult && ctx.visionResult.screenType) {
        ctx.log.info({ from: classification.type, to: ctx.visionResult.screenType }, "[vision] Override screen type");
        classification.type = ctx.visionResult.screenType === "nav_hub" ? "navigation_hub" : ctx.visionResult.screenType;
        classification.confidence = 0.7;
        classification.classifiedBy = "vision";
        classification.feature = (/** @type {Record<string, string>} */ (VISION_SCREEN_TO_FEATURE))[ctx.visionResult.screenType] || "other";
        snapshot.screenType = classification.type;
        snapshot.feature = classification.feature;
      }
      if (ctx.visionResult && ctx.visionResult.mainActions) {
        const before = ctx.visionResult.mainActions.length;
        ctx.visionResult.mainActions = ctx.visionResult.mainActions.filter(
          (/** @type {any} */ a) => !VISION_NAV_FILTER.test(a.description || "")
        );
        if (ctx.visionResult.mainActions.length < before) {
          ctx.log.info({ filtered: before - ctx.visionResult.mainActions.length }, "[vision] Filtered nav actions (back/home/return)");
        }
      }
      if (ctx.visionResult) ctx.visionActionCache.set(effectiveFp, ctx.visionResult);
    } catch (e) {
      ctx.log.warn({ err: e }, "[vision] Error during vision guidance");
    }
  }

  // Cache lookup: exact effective FP
  if (!ctx.visionResult && ctx.visionActionCache.has(effectiveFp)) {
    ctx.visionResult = ctx.visionActionCache.get(effectiveFp);
    ctx.log.info({ effectiveFp: effectiveFp.slice(0, 16), actionCount: (ctx.visionResult.mainActions || []).length }, "[vision] Using cached actions");
  }

  // Cache lookup: fuzzy screenshot match (hamming <= 8)
  if (!ctx.visionResult && ssFp && ssFp !== "no_screenshot") {
    for (const [cachedKey, cachedResult] of ctx.visionActionCache) {
      if (cachedKey.startsWith("ss_")) {
        const cachedSsHash = cachedKey.slice(3);
        if (screenshotFp.isSameScreen(ssFp, cachedSsHash, 8)) {
          ctx.visionResult = cachedResult;
          ctx.log.info({ cachedKey: cachedKey.slice(0, 16), actionCount: (cachedResult.mainActions || []).length }, "[vision] Fuzzy screenshot cache hit (hamming <=8)");
          break;
        }
      }
    }
  }
}

/**
 * Resolve vision via unified perception (screenshot-only mode).
 * @param {Ctx} ctx
 * @param {any} snapshot
 * @param {string} ssFp
 * @param {number} step
 * @param {Function} formatJournal
 * @returns {Promise<any|null>}
 */
async function resolveVisionPerception(ctx, snapshot, ssFp, step, formatJournal) {
  ctx.visionResult = null;

  const result = await perceive(
    snapshot.screenshotPath,
    snapshot.xml || null,
    {
      classification: /** @type {any} */ (undefined),
      triedCount: step,
      goal: ctx.plan ? ctx.plan.targets[0] : "explore the app",
      previousAction: /** @type {any} */ (ctx.lastActionOutcome),
      journal: formatJournal(),
    },
    ssFp,
    /** @type {any} */ (ctx.perceptionCache)
  );

  if (!result) return null;

  accumulateTokens(ctx, result.perception);
  const perception = /** @type {any} */ (result.perception);

  // Filter nav actions
  if (perception.mainActions) {
    const before = perception.mainActions.length;
    perception.mainActions = perception.mainActions.filter(
      (/** @type {any} */ a) => !VISION_NAV_FILTER.test(a.description || "")
    );
    if (perception.mainActions.length < before) {
      ctx.log.info({ filtered: before - perception.mainActions.length }, "[perception] Filtered nav actions (back/home/return)");
    }
  }

  ctx.visionResult = {
    screenType: perception.screenType,
    mainActions: perception.mainActions,
    isLoading: perception.isLoading,
    observation: perception.screenDescription,
  };

  return perception;
}

module.exports = {
  computeEffectiveFp,
  resolveVision,
  resolveVisionPerception,
};
