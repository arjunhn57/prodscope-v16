/**
 * scoring.js — Crawl quality scoring
 *
 * Deterministic, explainable scoring (0-100) derived from signals
 * already collected during a crawl. No ADB calls, no LLM calls.
 *
 * Returns both a final score and a full breakdown so the number
 * is never a black box.
 */

"use strict";

/**
 * @typedef {Object} ScoringBreakdown
 * @property {number} base               - Starting score (always 50)
 * @property {number} explorationBonus    - Reward for discovering unique screens
 * @property {number} effectivenessBonus  - Reward for high action effectiveness
 * @property {number} recoveryPenalty     - Penalty for excessive recovery attempts
 * @property {number} oraclePenalty       - Penalty for deterministic bugs found
 * @property {number} stopReasonModifier  - Bonus/penalty based on why crawl stopped
 * @property {number} depthBonus          - Reward for deep exploration (steps used)
 * @property {number} stuckPenalty        - Penalty for high ineffective action rate
 * @property {string[]} factors           - Human-readable explanation of each modifier
 */

/**
 * @typedef {Object} ScoringResult
 * @property {number} score              - Final quality score, clamped 0-100
 * @property {string} grade              - Letter grade: A/B/C/D/F
 * @property {ScoringBreakdown} breakdown
 */

/**
 * Compute a crawl quality score from existing crawl signals.
 *
 * @param {Object} params
 * @param {Object} params.stats           - { totalSteps, uniqueStates, totalTransitions, recoveryStats }
 * @param {Object} params.metrics         - Output of CrawlMetrics.summary()
 * @param {Array}  params.oracleFindings  - Deterministic findings array
 * @param {string} params.stopReason      - Why the crawl stopped
 * @param {number} params.maxSteps        - Configured step budget
 * @returns {ScoringResult}
 */
function computeCrawlScore({ stats, metrics, oracleFindings, stopReason, maxSteps }) {
  const factors = [];
  const totalSteps = stats.totalSteps || 0;
  const uniqueStates = stats.uniqueStates || 0;
  const recoveryStats = stats.recoveryStats || {};

  // ── BASE ──────────────────────────────────────────────────
  const base = 50;
  factors.push("Base: 50");

  // ── EXPLORATION BONUS (0 to +20) ──────────────────────────
  // Unique screen discovery rate: uniqueStates / totalSteps
  const uniqueRate = totalSteps > 0 ? uniqueStates / totalSteps : 0;
  // Also reward absolute count — more unique screens = better crawl
  const absoluteScreenBonus = Math.min(uniqueStates * 0.5, 8);
  const rateBonus = Math.min(uniqueRate * 20, 12);
  const explorationBonus = Math.round(Math.min(rateBonus + absoluteScreenBonus, 20));
  factors.push(
    `Exploration: +${explorationBonus} (${uniqueStates} unique screens, ` +
    `${Math.round(uniqueRate * 100)}% discovery rate)`
  );

  // ── EFFECTIVENESS BONUS (0 to +15) ────────────────────────
  // Low ineffective action rate = good
  const ineffectiveRate = (metrics && metrics.ineffectiveActionRate) || 0;
  const effectivenessBonus = Math.round(Math.max(0, (1 - ineffectiveRate) * 15));
  factors.push(
    `Effectiveness: +${effectivenessBonus} (${Math.round(ineffectiveRate * 100)}% ineffective actions)`
  );

  // ── DEPTH BONUS (0 to +10) ────────────────────────────────
  // Reward using a good portion of the step budget
  const budgetUsage = maxSteps > 0 ? totalSteps / maxSteps : 0;
  const depthBonus = Math.round(Math.min(budgetUsage * 10, 10));
  factors.push(
    `Depth: +${depthBonus} (${totalSteps}/${maxSteps} steps used, ` +
    `${Math.round(budgetUsage * 100)}% of budget)`
  );

  // ── RECOVERY PENALTY (0 to -15) ───────────────────────────
  // Each recovery attempt is a signal the crawl struggled
  let totalRecoveryAttempts = 0;
  let totalRecoveryFailures = 0;
  for (const strategy of Object.values(recoveryStats)) {
    totalRecoveryAttempts += strategy.attempts || 0;
    totalRecoveryFailures += (strategy.attempts || 0) - (strategy.successes || 0);
  }
  // Penalty scales with failures, not just attempts (successful recovery is ok)
  const recoveryPenalty = -Math.round(Math.min(totalRecoveryFailures * 3 + totalRecoveryAttempts * 0.5, 15));
  factors.push(
    `Recovery: ${recoveryPenalty} (${totalRecoveryAttempts} attempts, ` +
    `${totalRecoveryFailures} failures)`
  );

  // ── ORACLE PENALTY (0 to -15) ─────────────────────────────
  // Bugs found = useful for the user, but signal app instability
  // which makes the crawl less reliable/complete
  const findings = oracleFindings || [];
  const crashes = findings.filter(f => f.type === "crash" || f.type === "anr").length;
  const otherFindings = findings.length - crashes;
  // Crashes hurt more than UX issues
  const oraclePenalty = -Math.round(Math.min(crashes * 5 + otherFindings * 1, 15));
  if (findings.length > 0) {
    factors.push(
      `Oracle: ${oraclePenalty} (${crashes} crash/ANR, ${otherFindings} other findings)`
    );
  } else {
    factors.push("Oracle: 0 (no issues found)");
  }

  // ── STUCK PENALTY (0 to -10) ──────────────────────────────
  // High ineffective rate means crawl was spinning its wheels
  const stuckPenalty = ineffectiveRate > 0.4
    ? -Math.round(Math.min((ineffectiveRate - 0.4) * 25, 10))
    : 0;
  if (stuckPenalty < 0) {
    factors.push(`Stuck: ${stuckPenalty} (ineffective rate ${Math.round(ineffectiveRate * 100)}% > 40%)`);
  }

  // ── STOP REASON MODIFIER (-10 to +5) ──────────────────────
  const STOP_REASON_SCORES = {
    budget_exhausted: 5,     // Used full budget = thorough
    max_steps: 5,            // Same as budget exhausted
    max_steps_reached: 5,    // Default stop — used all steps
    all_explored: 5,         // Covered everything = great
    coverage_saturated: 3,   // Good enough coverage
    no_new_states: -3,       // Ran out of things to find
    device_offline: -10,     // Infrastructure failure
    capture_failed: -8,      // Infrastructure failure
    out_of_app_limit: -5,    // App kept leaving
    left_target_app: -5,     // App navigated away too many times
    emulator_failure: -10,   // Infrastructure failure
    auth_validation_error: -2, // Auth flow had validation issues
    auth_submit_loop: -3,    // Stuck in auth submit loop
    in_app_sparse_screen: -2, // Very sparse screen
  };
  const stopReasonModifier = STOP_REASON_SCORES[stopReason] || 0;
  factors.push(`Stop reason: ${stopReasonModifier >= 0 ? "+" : ""}${stopReasonModifier} (${stopReason || "unknown"})`);

  // ── FINAL SCORE ───────────────────────────────────────────
  const raw = base + explorationBonus + effectivenessBonus + depthBonus +
    recoveryPenalty + oraclePenalty + stuckPenalty + stopReasonModifier;
  const score = Math.max(0, Math.min(100, raw));

  const grade = score >= 85 ? "A"
    : score >= 70 ? "B"
    : score >= 50 ? "C"
    : score >= 30 ? "D"
    : "F";

  factors.push(`Raw: ${raw}, Clamped: ${score}, Grade: ${grade}`);

  return {
    score,
    grade,
    breakdown: {
      base,
      explorationBonus,
      effectivenessBonus,
      depthBonus,
      recoveryPenalty,
      oraclePenalty,
      stuckPenalty,
      stopReasonModifier,
      factors,
    },
  };
}

module.exports = { computeCrawlScore };
