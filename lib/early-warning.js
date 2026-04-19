"use strict";

/**
 * early-warning.js — Predictive failure detection.
 *
 * Evaluates crawl health at step 10 to detect patterns that predict
 * eventual failure. Allows early strategy switches instead of wasting
 * the remaining 70 steps.
 *
 * Rules:
 *  - 0 new screens in 10 steps + auth abandoned → "abort"
 *  - 1-2 new screens + high recovery count   → "aggressive"
 *  - 3+ new screens in 10 steps              → "normal"
 */

/**
 * Evaluate crawl health based on progress so far.
 *
 * @param {object} ctx - CrawlContext
 * @param {number} step - Current step number
 * @returns {{ health: number, recommendation: "normal"|"aggressive"|"abort", reasons: string[] }}
 */
function evaluateCrawlHealth(ctx, step) {
  const reasons = [];

  const uniqueScreens = ctx.stateGraph ? ctx.stateGraph.uniqueStateCount() : 0;
  const recoveryAttempts = ctx.globalRecoveryAttempts || 0;
  const authState = ctx.authMachine ? ctx.authMachine.state : "IDLE";
  const authTerminal = ctx.authMachine ? ctx.authMachine.isTerminal : false;
  const authSucceeded = authState === "SUCCEEDED";
  // ── Score components (0-100 each) ──
  let screenScore = Math.min(100, (uniqueScreens / Math.max(1, step * 0.3)) * 100);
  let recoveryPenalty = Math.min(60, recoveryAttempts * 15);
  let authPenalty = 0;

  if (authTerminal && !authSucceeded && uniqueScreens <= 2) {
    authPenalty = 40;
    reasons.push("auth_failed_low_screens");
  }

  const health = Math.max(0, Math.min(100, Math.round(screenScore - recoveryPenalty - authPenalty)));

  // ── Recommendation ──
  let recommendation = "normal";

  // Abort: zero progress + auth dead-end
  if (uniqueScreens === 0 && step >= 10) {
    recommendation = "abort";
    reasons.push("zero_screens_at_step_10");
  } else if (uniqueScreens <= 1 && authTerminal && !authSucceeded) {
    recommendation = "abort";
    reasons.push("auth_dead_end_no_progress");
  }

  // Aggressive: some progress but struggling
  if (recommendation === "normal" && uniqueScreens <= 2 && recoveryAttempts >= 3) {
    recommendation = "aggressive";
    reasons.push("low_screens_high_recovery");
  }
  if (recommendation === "normal" && uniqueScreens <= 2 && step >= 10) {
    recommendation = "aggressive";
    reasons.push("slow_discovery");
  }

  return { health, recommendation, reasons };
}

module.exports = { evaluateCrawlHealth };
