"use strict";

/**
 * v16/budget.js — Resource budget enforcement for V16 agent-first crawler.
 *
 * Tracks five hard caps (the only "rules" in V16):
 *   1. Max steps (default 80)
 *   2. Max wall-time (default 30 min)
 *   3. Max consecutive identical actions (default 3)  [tracked elsewhere]
 *   4. Max LLM cost in USD (hard ceiling $0.12 ≈ ₹10)
 *   5. Max Sonnet escalations per crawl (default 3; once hit, Haiku-only)
 *
 * Token/cost accounting uses Anthropic's Jan 2026 per-1M rates. Cached
 * inputs are priced at 0.1× the uncached rate.
 */

/**
 * @typedef {Object} BudgetConfig
 * @property {number} [maxSteps=80]
 * @property {number} [maxWallMs=1800000]       // 30 minutes
 * @property {number} [maxCostUsd=0.12]         // ₹10 ceiling
 * @property {number} [maxSonnetEscalations=3]
 *
 * @typedef {Object} BudgetSnapshot
 * @property {number} stepsUsed
 * @property {number} wallMsElapsed
 * @property {number} costUsd
 * @property {number} sonnetEscalationsUsed
 * @property {number} haikuCallsUsed
 * @property {string|null} exhaustedReason
 * @property {number} maxSteps
 * @property {number} maxCostUsd
 * @property {number} maxSonnetEscalations
 *
 * @typedef {'haiku'|'sonnet'} ModelId
 */

/** USD per 1M tokens, Jan 2026 public pricing. */
const PRICING = Object.freeze({
  haiku: {
    inputPerM: 1.0,
    outputPerM: 5.0,
    cachedInputPerM: 0.1,
  },
  sonnet: {
    inputPerM: 3.0,
    outputPerM: 15.0,
    cachedInputPerM: 0.3,
  },
});

const DEFAULTS = Object.freeze({
  maxSteps: 80,
  maxWallMs: 30 * 60 * 1000,
  maxCostUsd: 0.12,
  maxSonnetEscalations: 3,
});

/**
 * @param {BudgetConfig} [config]
 */
function createBudget(config) {
  const cfg = Object.assign({}, DEFAULTS, config || {});

  const startMs = Date.now();
  let stepsUsed = 0;
  let costUsd = 0;
  let sonnetEscalationsUsed = 0;
  let haikuCallsUsed = 0;

  /**
   * @param {ModelId} model
   * @param {number} inputTokens           uncached input tokens (includes images)
   * @param {number} outputTokens
   * @param {number} [cachedInputTokens=0] tokens read from cache
   */
  function recordLlmCall(model, inputTokens, outputTokens, cachedInputTokens) {
    const price = PRICING[model];
    if (!price) throw new Error(`unknown model: ${model}`);

    const cached = cachedInputTokens || 0;
    const uncached = Math.max(0, (inputTokens || 0) - cached);
    const out = outputTokens || 0;

    const delta =
      (uncached * price.inputPerM) / 1_000_000 +
      (cached * price.cachedInputPerM) / 1_000_000 +
      (out * price.outputPerM) / 1_000_000;

    costUsd += delta;
    if (model === "sonnet") sonnetEscalationsUsed += 1;
    else if (model === "haiku") haikuCallsUsed += 1;
  }

  function step() {
    stepsUsed += 1;
  }

  function canEscalateToSonnet() {
    if (sonnetEscalationsUsed >= cfg.maxSonnetEscalations) return false;
    if (costUsd >= cfg.maxCostUsd) return false;
    return true;
  }

  function exhausted() {
    if (stepsUsed >= cfg.maxSteps) return "max_steps_reached";
    if (Date.now() - startMs >= cfg.maxWallMs) return "timeout";
    if (costUsd >= cfg.maxCostUsd) return "budget_exhausted";
    return null;
  }

  function snapshot() {
    return {
      stepsUsed,
      wallMsElapsed: Date.now() - startMs,
      costUsd,
      sonnetEscalationsUsed,
      haikuCallsUsed,
      exhaustedReason: exhausted(),
      maxSteps: cfg.maxSteps,
      maxCostUsd: cfg.maxCostUsd,
      maxSonnetEscalations: cfg.maxSonnetEscalations,
    };
  }

  return { step, recordLlmCall, canEscalateToSonnet, exhausted, snapshot };
}

module.exports = { createBudget, PRICING, DEFAULTS };
