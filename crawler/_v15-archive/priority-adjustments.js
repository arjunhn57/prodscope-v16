"use strict";

/**
 * priority-adjustments.js — All candidate priority adjustment passes.
 *
 * Each sub-function is a named, composable pass that modifies the candidate
 * list. The orchestrator calls adjustPriorities() which runs them in order.
 */

const actions = require("./actions");
const adb = require("./adb");
const readiness = require("./readiness");
const { SITUATION } = require("./recovery");
const { findBestAuthSubmitAction } = require("./auth-helpers");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "priority-adjustments" });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Suppress TYPE actions on non-auth, non-form screens.
 * On form/search screens: keep only 1 TYPE action.
 */
function suppressType(candidates, ctx, classification, screenIntent) {
  const isAuthIntent =
    screenIntent.type === "auth_choice" ||
    screenIntent.type === "phone_entry" ||
    screenIntent.type === "email_entry" ||
    screenIntent.type === "email_login" ||
    screenIntent.type === "email_signup" ||
    screenIntent.type === "otp_verification";

  if (ctx.authMachine.isActive || isAuthIntent) return candidates;

  const allowType = classification && (classification.type === "search" || classification.type === "form");
  if (!allowType) {
    const hasTap = candidates.some((a) => a.type === actions.ACTION_TYPES.TAP);
    if (hasTap) {
      candidates = candidates.filter((a) => a.type !== actions.ACTION_TYPES.TYPE);
      ctx.log.info("Suppressing TYPE actions on non-auth screen");
    }
  } else {
    const typeActions = candidates.filter((a) => a.type === actions.ACTION_TYPES.TYPE);
    const nonTypeActions = candidates.filter((a) => a.type !== actions.ACTION_TYPES.TYPE);
    if (typeActions.length > 1) {
      candidates = [typeActions[0], ...nonTypeActions];
      ctx.log.info({ kept: 1, suppressed: typeActions.length - 1 }, "Form screen: keeping 1 TYPE action");
    } else {
      ctx.log.info({ screenType: classification.type }, "Allowing TYPE actions on screen");
    }
  }

  return candidates;
}

/**
 * Handle sparse screens (only BACK available) — try recovery, then stop.
 */
async function handleSparseScreen(candidates, ctx, fp, primaryPackage, stateGraph) {
  if (
    primaryPackage !== ctx.packageName ||
    candidates.length !== 1 ||
    candidates[0].type !== actions.ACTION_TYPES.BACK
  ) {
    return { candidates, shouldContinue: false, shouldBreak: false };
  }

  const sparseCount = (ctx.visitedCounts.get(`sparse::${fp}`) || 0) + 1;
  ctx.visitedCounts.set(`sparse::${fp}`, sparseCount);

  if (sparseCount <= 2) {
    ctx.log.info({ sparseCount, maxAttempts: 2 }, "In-app sparse screen with only BACK available - recovery attempt");
    await ctx.recoveryManager.recover(SITUATION.DEAD_END, fp, ctx);
    return { candidates, shouldContinue: true, shouldBreak: false };
  }

  ctx.log.info("In-app sparse screen persisted after recovery - stopping");
  return { candidates, shouldContinue: false, shouldBreak: true, breakReason: "in_app_sparse_screen" };
}

/**
 * Deprioritize content-creation actions during early exploration.
 */
function deprioritizeContentCreation(candidates, classification, step, maxSteps) {
  const isEarly = step < Math.floor(maxSteps / 2);
  if (!isEarly || !classification || classification.feature !== "content_creation") return candidates;

  candidates = candidates.map((a) => {
    if (a.type === actions.ACTION_TYPES.TAP) {
      return { ...a, priority: Math.floor(a.priority / 3) };
    }
    return a;
  });
  log.info("Early exploration: reducing content-creation priority");
  return candidates;
}

/**
 * Suppress BACK from home screen + boost scroll when taps exhausted.
 */
function adjustHomeScreen(candidates, ctx, fp, stateGraph, tried) {
  if (fp !== ctx.homeFingerprint) return candidates;

  const beforeCount = candidates.length;
  candidates = candidates.filter((a) => a.type !== actions.ACTION_TYPES.BACK);
  if (candidates.length < beforeCount) {
    ctx.log.info("Home screen - BACK suppressed (would exit app)");
  }

  const triedScrollDown = tried.has("scroll_down_1") && tried.has("scroll_down_2") && tried.has("scroll_down_3");
  const nonScrollNonBack = candidates.filter(
    (a) => a.type !== actions.ACTION_TYPES.SCROLL_DOWN &&
      a.type !== actions.ACTION_TYPES.SCROLL_UP &&
      a.type !== actions.ACTION_TYPES.BACK
  );
  const untriedTaps = nonScrollNonBack.filter((a) => !tried.has(a.key));
  const homeVisits = stateGraph.visitCount(fp);

  if (untriedTaps.length === 0 && homeVisits > 3 && !triedScrollDown) {
    ctx.log.info({ triedTaps: nonScrollNonBack.length }, "Home screen: all visible taps tried - boosting scroll to reveal new content");
    candidates = candidates.map((a) =>
      a.type === actions.ACTION_TYPES.SCROLL_DOWN ? { ...a, priority: 150 } : a
    );
  }

  return candidates;
}

/**
 * Force exploration of new screens — don't leave immediately.
 */
function forceNewScreenExploration(candidates, ctx, fp) {
  if (fp !== ctx.lastNewScreenFp || ctx.actionsOnNewScreen >= 2) return candidates;

  const exploreCandidates = candidates.filter((a) => {
    if (a.type === actions.ACTION_TYPES.BACK) return false;
    const label = `${a.text || ""} ${a.contentDesc || ""}`.toLowerCase().trim();
    if (label === "home") return false;
    return true;
  });
  if (exploreCandidates.length > 0) {
    candidates = exploreCandidates;
    ctx.log.info("New screen - exploring before going back/home");
  }
  ctx.actionsOnNewScreen++;
  return candidates;
}

/**
 * Deprioritize "Home" button if we've been home too often.
 */
function deprioritizeHomeButton(candidates, ctx, stateGraph) {
  if (!ctx.homeFingerprint || stateGraph.visitCount(ctx.homeFingerprint) <= 3) return candidates;
  return candidates.map((a) => {
    const label = `${a.text || ""} ${a.contentDesc || ""}`.toLowerCase().trim();
    if (label === "home") return { ...a, priority: Math.max(a.priority - 40, 5) };
    return a;
  });
}

/**
 * Boost auth submit actions on auth intent screens.
 */
function boostAuthIntent(candidates, screenIntent) {
  if (screenIntent.type !== "auth_choice" && screenIntent.type !== "phone_entry" && screenIntent.type !== "email_entry") {
    return candidates;
  }
  const authSubmit = findBestAuthSubmitAction(candidates);
  if (!authSubmit) return candidates;
  candidates = [authSubmit, ...candidates.filter((a) => a.key !== authSubmit.key)];
  log.info({ intentType: screenIntent.type }, "Prioritizing auth CTA");
  return candidates;
}

/**
 * Handle auth flow priority — boost submit when in active auth flow.
 * Submit loop detection is now handled by the auth state machine.
 */
function handleAuthFlowPriority(candidates, ctx, fp, screenIntent, snapshot) {
  const { isAuthIntent } = require("./auth-state-machine");

  // If auth is resolved (guest/abandoned/succeeded), suppress auth actions + boost escape buttons
  if (ctx.authMachine.isTerminal && isAuthIntent(screenIntent.type)) {
    const { AUTH_ESCAPE_REGEX } = require("./auth-state-machine");
    const authLabels = /sign.?in|log.?in|sign.?up|create.?account|register/i;
    candidates = candidates.map((a) => {
      const label = `${a.text || ""} ${a.contentDesc || ""}`.toLowerCase();
      if (AUTH_ESCAPE_REGEX.test(label)) return { ...a, priority: 200 };
      if (authLabels.test(label)) return { ...a, priority: 0 };
      return a;
    });
    ctx.log.info("Auth resolved - suppressing auth actions, boosting escape buttons");
    return { candidates, shouldBreak: false };
  }

  // Active auth flow: boost submit, suppress TYPE
  const isInAuthFlow = ctx.authMachine.isActive ||
    ctx.filledFingerprints.has(fp) || isAuthIntent(screenIntent.type);

  if (!isInAuthFlow) return { candidates, shouldBreak: false };

  const authSubmit = findBestAuthSubmitAction(candidates, screenIntent.type);

  if (authSubmit) {
    candidates = [
      authSubmit,
      ...candidates.filter((a) => a.key !== authSubmit.key && a.type !== actions.ACTION_TYPES.TYPE),
    ];
    ctx.log.info("Prioritizing auth CTA in auth flow");
  } else {
    candidates = candidates.filter((a) => a.type !== actions.ACTION_TYPES.TYPE);
    ctx.log.info("Suppressing extra TYPE actions in auth flow");
  }

  return { candidates, shouldBreak: false };
}

/**
 * Credential-aware auth choice boost — boost email/phone matching credential type.
 */
function credentialAwareBoost(candidates, ctx, screenIntent) {
  if (!ctx.authMachine.hasCredentials || screenIntent.type !== "auth_choice") return candidates;

  const credentials = ctx.credentials;
  const hasEmail = credentials.email || credentials.username;
  const hasPhone = credentials.phone;

  candidates = candidates.map((a) => {
    const hay = `${a.text || ""} ${a.contentDesc || ""}`.toLowerCase();
    if (hasEmail && (hay.includes("email") || hay.includes("username"))) return { ...a, priority: a.priority + 50 };
    if (hasPhone && hay.includes("phone")) return { ...a, priority: a.priority + 50 };
    if (hasEmail && (hay.includes("google") || hay.includes("apple") || hay.includes("facebook"))) return { ...a, priority: Math.max(a.priority - 30, 0) };
    return a;
  });
  ctx.log.info("Applied credential-aware auth boost");
  return candidates;
}

/**
 * AppMap-informed priority adjustments — deprioritize tried/exhausted paths,
 * boost untried actions that are likely to lead to new screens.
 */
function boostByAppMap(candidates, ctx, fp, stateGraph) {
  if (!ctx.appMap || ctx.appMap.screenNodes.size === 0) return candidates;

  const node = ctx.appMap.screenNodes.get(fp);
  if (!node) return candidates;

  return candidates.map((c) => {
    if (node.actionsTried.has(c.key)) {
      // Already tried — deprioritize heavily
      return { ...c, priority: Math.max(c.priority - 50, 1) };
    }
    // Check if this action previously led to an exhausted child screen
    const transitions = stateGraph.adjacency.get(fp);
    if (transitions) {
      const childFp = transitions.get(c.key);
      if (childFp && ctx.appMap.isScreenExhausted(childFp)) {
        return { ...c, priority: Math.max(c.priority - 30, 5) };
      }
    }
    return c;
  });
}

/**
 * Apply plan boost and destructive action deferral.
 */
function applyPlanAndDestructiveFilters(candidates, ctx, planBoost) {
  if (ctx.plan && planBoost) {
    candidates = candidates.map((a) => ({
      ...a,
      priority: a.priority + planBoost(a, ctx.plan),
    }));
  }

  if (ctx.modeManager.budgetUsedPercent() < 0.85) {
    const beforeCount = candidates.length;
    candidates = candidates.filter((a) => !ctx.appState.isDestructiveAction(a));
    if (candidates.length < beforeCount) {
      ctx.log.info({ count: beforeCount - candidates.length }, "Destructive action(s) deferred to VERIFY mode");
    }
  }

  return candidates;
}

/**
 * Run all priority adjustment passes in order.
 *
 * @returns {Promise<{ candidates: Array, shouldContinue: boolean, shouldBreak: boolean, breakReason?: string }>}
 */
async function adjustPriorities(candidates, ctx, params) {
  const {
    fp, classification, screenIntent, step, maxSteps,
    primaryPackage, stateGraph, tried, snapshot, planBoost,
  } = params;

  // TYPE suppression
  candidates = suppressType(candidates, ctx, classification, screenIntent);

  // Sparse screen handling
  const sparse = await handleSparseScreen(candidates, ctx, fp, primaryPackage, stateGraph);
  if (sparse.shouldContinue || sparse.shouldBreak) return sparse;
  candidates = sparse.candidates;

  // Content creation deprioritization
  candidates = deprioritizeContentCreation(candidates, classification, step, maxSteps);

  // Home screen adjustments
  candidates = adjustHomeScreen(candidates, ctx, fp, stateGraph, tried);

  // New screen exploration
  candidates = forceNewScreenExploration(candidates, ctx, fp);

  // Home button deprioritization
  candidates = deprioritizeHomeButton(candidates, ctx, stateGraph);

  // Auth intent boost (E4: skip if auth resolved)
  if (!ctx.authResolved) {
    candidates = boostAuthIntent(candidates, screenIntent);

    // Auth flow priority + loop detection
    const authResult = handleAuthFlowPriority(candidates, ctx, fp, screenIntent, snapshot);
    if (authResult.shouldBreak) return { candidates: authResult.candidates, shouldContinue: false, shouldBreak: true, breakReason: authResult.breakReason };
    if (authResult.shouldContinue) return { candidates: authResult.candidates, shouldContinue: true, shouldBreak: false };
    candidates = authResult.candidates;

    // Credential-aware boost
    candidates = credentialAwareBoost(candidates, ctx, screenIntent);
  }

  // AppMap-informed priority adjustments
  candidates = boostByAppMap(candidates, ctx, fp, stateGraph);

  // Plan boost + destructive deferral
  candidates = applyPlanAndDestructiveFilters(candidates, ctx, planBoost);

  return { candidates, shouldContinue: false, shouldBreak: false };
}

module.exports = { adjustPriorities };
