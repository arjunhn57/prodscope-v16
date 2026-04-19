// @ts-check
"use strict";

/**
 * screen-classify.js — Screen classification helpers.
 *
 * Pure functions for classifying screens from XML or vision perception data.
 * Extracted from screen-intelligence.js for maintainability.
 *
 * @typedef {import('./types/crawl-context').CrawlContext} Ctx
 */

const { VISION_SCREEN_TO_FEATURE } = require("./crawl-context");
const log = require("../lib/logger").logger.child({ component: "screen-classify" });

// Brain modules — loaded conditionally
/** @type {any} */ let classify;
try {
  ({ classify } = require("../brain/screen-classifier"));
} catch (_) {
  classify = null;
}

/**
 * Accumulate _tokenUsage from a result object into ctx.tokenUsage.
 * @param {Ctx} ctx
 * @param {any} result
 */
function accumulateTokens(ctx, result) {
  if (result && result._tokenUsage && ctx.tokenUsage) {
    ctx.tokenUsage.input_tokens += result._tokenUsage.input_tokens || 0;
    ctx.tokenUsage.output_tokens += result._tokenUsage.output_tokens || 0;
  }
}

/**
 * Extract the most common package attribute from XML.
 * @param {string} xml
 * @returns {string}
 */
function getPrimaryPackage(xml) {
  if (!xml) return "";
  const matches = [...xml.matchAll(/package="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
  if (!matches.length) return "";
  /** @type {Record<string, number>} */
  const counts = {};
  for (const pkg of matches) counts[pkg] = (counts[pkg] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Classify a screen from XML using brain/screen-classifier.
 * @param {any} snapshot
 * @param {string} fp
 * @returns {any}
 */
function classifyScreen(snapshot, fp) {
  if (!classify) return null;

  const classification = classify(snapshot.xml, snapshot.activity, fp);
  snapshot.screenType = classification.type;
  snapshot.feature = classification.feature;
  log.info({ type: classification.type, feature: classification.feature, confidence: classification.confidence }, "[brain] Screen classified");
  return classification;
}

/**
 * Build a classification object from a vision perception result.
 * @param {any} perception - VisionPerception result
 * @param {any} snapshot - Screen snapshot (mutated: screenType + feature set)
 * @returns {any}
 */
function classifyFromPerception(perception, snapshot) {
  const type = perception.screenType === "nav_hub" ? "navigation_hub" : perception.screenType;
  const feature = (/** @type {Record<string, string>} */ (VISION_SCREEN_TO_FEATURE))[perception.screenType] || "other";

  snapshot.screenType = type;
  snapshot.feature = feature;

  log.info({ type, feature, classifiedBy: "vision-perception" }, "[perception] Classification — vision-derived");

  return {
    type,
    feature,
    confidence: 0.65,
    classifiedBy: "vision-perception",
  };
}

/** @returns {boolean} Whether brain classify module is loaded */
function hasClassifier() {
  return classify !== null;
}

module.exports = {
  accumulateTokens,
  getPrimaryPackage,
  classifyScreen,
  classifyFromPerception,
  hasClassifier,
};
