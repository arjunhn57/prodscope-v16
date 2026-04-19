// @ts-check
"use strict";

/**
 * stuck-detector.js — Detects cycling loops, staleness, and discovery exhaustion.
 *
 * All checks are deterministic (zero LLM cost). Each function reads from ctx
 * and returns a directive telling the orchestrator how to proceed.
 *
 * @typedef {import('./types/crawl-context').CrawlContext} Ctx
 */

const {
  CYCLE_WINDOW, CYCLE_UNIQUE_THRESHOLD,
  MAX_NO_NEW_STATE, DISCOVERY_WINDOW_SIZE, DISCOVERY_MIN_RATE,
} = require("./crawl-context");
const screenshotFp = require("./screenshot-fp");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "stuck-detector" });

/**
 * Detect if the crawler is stuck in a cycling loop (e.g. date picker A→B→C→A→B→C).
 *
 * Mutates: ctx.recentFpWindow (push/shift/clear)
 *
 * @param {Ctx} ctx
 * @param {string} fp - Current screen fingerprint
 * @returns {{ stuck: boolean }}
 */
function checkCyclingLoop(ctx, fp) {
  ctx.recentFpWindow.push(fp);
  if (ctx.recentFpWindow.length > CYCLE_WINDOW) ctx.recentFpWindow.shift();

  if (ctx.recentFpWindow.length >= CYCLE_WINDOW) {
    const uniqueInWindow = new Set(ctx.recentFpWindow).size;
    if (uniqueInWindow <= CYCLE_UNIQUE_THRESHOLD && fp !== ctx.homeFingerprint) {
      log.warn({ uniqueInWindow, cycleWindow: CYCLE_WINDOW }, "Cycling-loop detected — pressing back to escape");
      ctx.recentFpWindow.length = 0; // reset window after escape
      return { stuck: true };
    }
  }

  return { stuck: false };
}

/**
 * Track consecutive steps with no new state. Returns stalled=true when threshold exceeded.
 *
 * Mutates: ctx.consecutiveNoNewState
 *
 * @param {Ctx} ctx
 * @param {boolean} isNew - Whether the current screen is new
 * @returns {{ stalled: boolean }}
 */
function checkNoNewState(ctx, isNew) {
  if (isNew) {
    ctx.consecutiveNoNewState = 0;
  } else {
    ctx.consecutiveNoNewState++;
    if (ctx.consecutiveNoNewState >= MAX_NO_NEW_STATE) {
      log.warn({ maxNoNewState: MAX_NO_NEW_STATE }, "Consecutive steps with no new state — stopping");
      return { stalled: true };
    }
  }
  return { stalled: false };
}

/**
 * Track discovery rate and detect when exploration is exhausted
 * (no new screens recently + all features saturated).
 *
 * Mutates: ctx.discoveryWindow (push/shift)
 *
 * @param {Ctx} ctx
 * @param {boolean} isNew - Whether the current screen is new
 * @param {number} step - Current step number
 * @returns {{ exhausted: boolean }}
 */
function checkDiscoveryRate(ctx, isNew, step) {
  ctx.discoveryWindow.push(isNew);
  if (ctx.discoveryWindow.length > DISCOVERY_WINDOW_SIZE) ctx.discoveryWindow.shift();

  if (step >= ctx.discoveryStopEligibleStep && ctx.discoveryWindow.length >= DISCOVERY_WINDOW_SIZE) {
    const newInWindow = ctx.discoveryWindow.filter(Boolean).length;
    const allSaturated = ctx.coverageTracker
      ? ctx.coverageTracker.allSaturated()
      : false;

    if (newInWindow < DISCOVERY_MIN_RATE && allSaturated) {
      log.info({ newInWindow, windowSize: DISCOVERY_WINDOW_SIZE }, "Exploration exhausted — all features saturated, stopping early");
      return { exhausted: true };
    }
  }

  return { exhausted: false };
}

/**
 * Detect "soft revisit" — screen is new by fingerprint but visually
 * near-identical to a recent screenshot (e.g., infinite scroll position).
 *
 * @param {string|null} screenshotHash - Current screenshot hash (16-char hex)
 * @param {string[]} recentHashes - Sliding window of recent screenshot hashes
 * @param {number} [threshold=6] - Max hamming distance to count as same screen
 * @returns {{ isSoftRevisit: boolean, closestDistance: number }}
 */
function checkSoftRevisit(screenshotHash, recentHashes, threshold = 6) {
  if (!screenshotHash || screenshotHash === "no_screenshot" || recentHashes.length === 0) {
    return { isSoftRevisit: false, closestDistance: 64 };
  }

  let closestDistance = 64;
  for (const recent of recentHashes) {
    if (!recent || recent === "no_screenshot") continue;
    const dist = screenshotFp.hammingDistance(screenshotHash, recent);
    if (dist < closestDistance) closestDistance = dist;
  }

  return { isSoftRevisit: closestDistance <= threshold, closestDistance };
}

module.exports = { checkCyclingLoop, checkNoNewState, checkDiscoveryRate, checkSoftRevisit };
