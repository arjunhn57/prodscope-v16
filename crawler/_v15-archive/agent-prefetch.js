// @ts-check
"use strict";

/**
 * agent-prefetch.js — Parallel LLM decision prefetch (V2 vision-first).
 *
 * Mirrors crawler/pipeline.js but for agent.decideCoordinates calls instead
 * of screen captures. At the end of step N (after captureStableScreen), we
 * fire the LLM decision call for step N+1 in the background. At STAGE 14 of
 * step N+1, selectActionVisionFirst consumes the prefetch instead of making
 * a fresh sync call.
 *
 * Safety: the prefetch is validated by comparing the screenshotHash of the
 * snapshot it was built from against the freshly captured snapshot at step
 * N+1. On mismatch, we discard and the caller falls back to a sync call.
 */

const agent = require("./agent");
const screenshotFp = require("./screenshot-fp");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "agent-prefetch" });

/** @type {Promise<import('./agent').AgentCoordDecision> | null} */
let prefetchPromise = null;
/** @type {string | null} */
let prefetchScreenshotHash = null;
let prefetchStep = -1;
/** @type {Error | null} */
let prefetchError = null;

/**
 * Build the agent.decideCoordinates input from ctx + snapshot. Extracted so
 * both the prefetch path and (eventually) the sync path share identical
 * input shapes. For Track F the sync path in policy-step.js still builds its
 * own input inline — we can unify later.
 *
 * NOTE: This builds input from ctx state AT THE TIME startPrefetch is called
 * (end of step N). Some fields (recent history, appMap) may be slightly stale
 * by the time the prefetch is consumed at step N+1 — but the screenshot is
 * the dominant signal and the hash check protects correctness.
 *
 * @param {number} stepNumber
 * @param {{ xml?: string, screenshotPath: string | null }} snapshot
 * @param {any} ctxLike
 * @returns {any}
 */
function buildAgentInput(stepNumber, snapshot, ctxLike) {
  const policyStep = require("./policy-step");
  const xmlHints = policyStep.extractXmlTextHints(snapshot.xml || "");

  const recentHistory = (ctxLike.explorationJournal || []).slice(-8).map((/** @type {any} */ j) => ({
    step: typeof j.step === "number" ? j.step : 0,
    action: typeof j.action === "string" ? j.action : "",
    outcome: typeof j.outcome === "string" ? j.outcome : "",
  }));

  const appMapSummary = ctxLike.appMap ? {
    totalScreens: ctxLike.appMap.screenNodes ? ctxLike.appMap.screenNodes.size : 0,
    navTabs: (ctxLike.appMap.navTabs || []).map((/** @type {any} */ t) => ({
      label: t.label,
      explored: !!t.explored,
      exhausted: !!t.exhausted,
    })),
  } : { totalScreens: 0, navTabs: [] };

  return {
    goal: ctxLike.goals || "Explore the app and discover its main features",
    credentials: ctxLike.credentials || null,
    packageName: ctxLike.packageName,
    stepNumber,
    maxSteps: ctxLike.maxSteps,
    visitedScreensCount: ctxLike.stateGraph && typeof ctxLike.stateGraph.uniqueStateCount === "function"
      ? ctxLike.stateGraph.uniqueStateCount()
      : 0,
    currentScreenType: "unknown",
    screenshotPath: snapshot.screenshotPath,
    // Old AgentCoordInput had `elements` as a required field — keep empty for vision-first
    elements: [],
    recentHistory,
    appMapSummary,
    xmlHints,
    visionFirstMode: true,
  };
}

/**
 * Kick off an LLM decision call for the next step in the background.
 * Safe to call multiple times — replaces any existing in-flight prefetch
 * (the previous one is orphaned, its promise resolves uncaught but is
 * protected by a .catch below to prevent unhandled rejection warnings).
 *
 * @param {number} nextStep
 * @param {{ xml?: string, screenshotPath: string | null, screenshotHash?: string }} snapshot
 * @param {any} ctxLike
 */
function startPrefetch(nextStep, snapshot, ctxLike) {
  if (!snapshot || !snapshot.screenshotPath) {
    log.debug({ nextStep }, "[agent-prefetch] skip — no screenshot");
    return;
  }

  let hash = snapshot.screenshotHash || null;
  if (!hash) {
    try {
      hash = screenshotFp.computeHash(snapshot.screenshotPath);
    } catch (_) {
      hash = null;
    }
  }

  // Drain any existing in-flight prefetch so we don't leak unhandled
  // rejections when we overwrite its slot.
  const priorPromise = prefetchPromise;
  if (priorPromise) {
    priorPromise.catch(() => {});
  }

  prefetchScreenshotHash = hash;
  prefetchStep = nextStep;
  prefetchError = null;

  const input = buildAgentInput(nextStep, snapshot, ctxLike);

  log.debug({ nextStep, hash }, "[agent-prefetch] started");

  const p = agent.decideCoordinates(input, { ctx: ctxLike })
    .then((/** @type {import('./agent').AgentCoordDecision} */ d) => {
      log.debug({ nextStep, action: d.action }, "[agent-prefetch] resolved");
      return d;
    })
    .catch((/** @type {Error} */ err) => {
      prefetchError = err;
      log.warn({ nextStep, err: err && err.message }, "[agent-prefetch] rejected");
      throw err;
    });

  // Silent drain: prevent unhandled rejection if recovery/out-of-app paths
  // skip STAGE 14 (selectActionVisionFirst) so consumePrefetch never runs.
  // The original `p` still rejects for consumers that DO await it via
  // consumePrefetch's try/catch — this extra handler just keeps Node's
  // unhandled-rejection tracker from crashing the process.
  p.catch(() => {});

  prefetchPromise = p;
}

/**
 * Consume the prefetch if it matches the expected step AND the screenshot
 * hash matches the freshly captured snapshot. Otherwise return null and the
 * caller must make a sync call.
 *
 * @param {number} expectedStep
 * @param {{ screenshotHash?: string, screenshotPath?: string | null }} actualSnapshot
 * @returns {Promise<import('./agent').AgentCoordDecision | null>}
 */
async function consumePrefetch(expectedStep, actualSnapshot) {
  if (!prefetchPromise) return null;

  if (prefetchStep !== expectedStep) {
    log.debug({ expected: expectedStep, actual: prefetchStep }, "[agent-prefetch] step mismatch, discarding");
    const p = prefetchPromise;
    clear();
    // Drain the orphaned promise so its rejection (if any) doesn't become
    // an unhandled rejection warning.
    p.catch(() => {});
    return null;
  }

  // Resolve current hash for comparison
  let actualHash = (actualSnapshot && actualSnapshot.screenshotHash) || null;
  if (!actualHash && actualSnapshot && actualSnapshot.screenshotPath) {
    try {
      actualHash = screenshotFp.computeHash(actualSnapshot.screenshotPath);
    } catch (_) {
      actualHash = null;
    }
  }

  const expectedHash = prefetchScreenshotHash;
  if (expectedHash && actualHash && expectedHash !== actualHash) {
    log.debug({ expectedHash, actualHash, step: expectedStep }, "[agent-prefetch] hash mismatch, discarding");
    const p = prefetchPromise;
    clear();
    p.catch(() => {});
    return null;
  }

  try {
    const decision = await prefetchPromise;
    log.info({
      step: expectedStep,
      hashMatched: expectedHash === actualHash,
      action: decision.action,
    }, "[agent-prefetch] consumed");
    clear();
    return decision;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.warn({ step: expectedStep, err: errMsg }, "[agent-prefetch] consume failed");
    clear();
    return null;
  }
}

function clear() {
  prefetchPromise = null;
  prefetchScreenshotHash = null;
  prefetchStep = -1;
  prefetchError = null;
}

/**
 * @param {number} step
 * @returns {boolean}
 */
function hasPrefetch(step) {
  return prefetchPromise !== null && prefetchStep === step;
}

module.exports = { startPrefetch, consumePrefetch, clear, hasPrefetch, buildAgentInput };
