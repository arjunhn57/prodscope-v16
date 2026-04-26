"use strict";

/**
 * v18/sonnet-escalation.js
 *
 * Capped Sonnet escalation for semantic classification. Invoked when Haiku
 * returns low confidence OR when the crawler has been stuck on the same
 * fp-family. Produces output conforming to the same schema as the Haiku
 * classifier — the downstream dispatcher doesn't care which model answered.
 *
 * Budget: MAX_SONNET_ESCALATIONS_PER_CRAWL enforced at call-site via a
 * counter on deps. The wrapper does NOT call Sonnet if the counter is at
 * or above the cap — it returns null, and the caller keeps using the Haiku
 * default plan.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { logger } = require("../../lib/logger");
const {
  CLASSIFY_TOOL,
  validatePlan,
  applyInputTypeShortCircuit,
  mergeClassifications,
  extractUsage,
  loadScreenshotBlock,
  LOW_CONFIDENCE_THRESHOLD,
} = require("./semantic-classifier");

/**
 * Accumulate token usage into a caller-provided sink. Used so a failed /
 * malformed Sonnet call still reports its cost while the function keeps
 * returning null for the plan-success contract the dispatcher expects.
 *
 * @param {object|undefined} sink
 * @param {{input_tokens:number, output_tokens:number, cached_input_tokens:number}} usage
 */
function addToSink(sink, usage) {
  if (!sink || !usage) return;
  sink.input_tokens = (sink.input_tokens || 0) + (usage.input_tokens || 0);
  sink.output_tokens = (sink.output_tokens || 0) + (usage.output_tokens || 0);
  sink.cached_input_tokens =
    (sink.cached_input_tokens || 0) + (usage.cached_input_tokens || 0);
}

const log = logger.child({ component: "v18-sonnet-escalation" });

const SONNET_MODEL = "claude-sonnet-4-6";
// 25s (was 8s 2026-04-24) — production run d0bbce69 showed Sonnet timing out
// at 8s consistently when asked to process a full screenshot. Sonnet with
// vision + 2000-token output typically needs 12-20s; 25s gives headroom.
// Timeouts still consume the per-crawl escalation budget so we don't loop
// forever on a pathological screen.
const SONNET_TIMEOUT_MS = 25000;
const SONNET_MAX_TOKENS = 2000;

/** Hard cap per crawl. 2026-04-26 (Phase E2): 6 → 2. In-crawl Sonnet
 *  escalation rarely fires (recent runs hit 0). Sonnet stays primarily
 *  for V2 report synthesis. 2 leaves a buffer for genuinely hard auth
 *  / cred screens. The cost cap and novelty-stall stop are the actual
 *  brakes; this is a ceiling. */
const MAX_SONNET_ESCALATIONS_PER_CRAWL = 2;

const SYSTEM_PROMPT = `You are the senior-QA-engineer escalation layer for a mobile app crawler.

The Haiku classifier was either unsure (confidence < ${LOW_CONFIDENCE_THRESHOLD}) or the crawler got stuck on this screen type. Your job is to produce a better plan.

The goal: MAP the app, not USE it. Explore like a senior QA engineer.

All rules from the Haiku system prompt apply — intent taxonomy, screen types, optimistic-on-ambiguity, strict destructive. Use the richer model capacity to reason harder about ambiguous cases, especially when the screen is novel or the structural signals conflict.

You ALSO produce engine_action — the engine-level decision evaluated BEFORE drivers run. Most screens → "proceed". If you're on the wrong app (launcher, Chrome, dialer, another app) → "relaunch". If the screen is a clear dead-end and needs back-nav → "press_back". If content is still loading → "wait". Compare observed packageName to targetPackage when deciding relaunch — they are both in the input payload.

You receive the same input Haiku did, plus a brief diagnostic describing WHY we escalated (low confidence value, or which earlier plan failed).`;

/**
 * Decide whether this screen warrants Sonnet escalation.
 *
 * @param {{confidence:number}} plan
 * @param {{stuckFingerprintFamily?:boolean}} signals
 * @returns {boolean}
 */
function shouldEscalate(plan, signals) {
  if (!plan) return true;
  if (typeof plan.confidence !== "number") return true;
  if (plan.confidence < LOW_CONFIDENCE_THRESHOLD) return true;
  if (signals && signals.stuckFingerprintFamily) return true;
  return false;
}

// loadScreenshotBlock now imported from ./semantic-classifier so escalation
// gets the same Phase F1.1 downscale path (was a local fs.readFileSync copy).

function extractToolInput(message) {
  if (!message || !Array.isArray(message.content)) return null;
  for (const block of message.content) {
    if (block && block.type === "tool_use" && block.name === CLASSIFY_TOOL.name) {
      return block.input || null;
    }
  }
  return null;
}

/**
 * Build the Sonnet request. Adds the escalation reason to the payload so
 * the model knows what went wrong.
 */
function buildRequest(graph, xmlText, observation, screenshotBlock, priorPlan, reason) {
  const nodesForPrompt = graph.clickables.map((c, i) => ({
    index: i,
    label: c.label || "",
    resourceId: c.resourceId || "",
    className: c.className || "",
    bounds: c.bounds
      ? { x1: c.bounds.x1, y1: c.bounds.y1, x2: c.bounds.x2, y2: c.bounds.y2 }
      : null,
    isInput: !!c.isInput,
    isButton: !!c.isButton,
    isCheckbox: !!c.isCheckbox,
  }));

  const textBlock = {
    type: "text",
    text: JSON.stringify({
      package: (observation && observation.packageName) || "",
      activity: (observation && observation.activity) || "",
      // Target package the crawl is supposed to stay in. Compare with
      // `package` above when deciding engine_action=relaunch.
      targetPackage: (observation && observation.targetPackage) || "",
      trajectorySummary: (observation && observation.trajectorySummary) || "",
      escalationReason: reason || "low_confidence",
      priorPlanSummary: priorPlan
        ? {
            screenType: priorPlan.screenType,
            confidence: priorPlan.confidence,
            allowedIntents: priorPlan.allowedIntents,
            actionBudget: priorPlan.actionBudget,
            engineAction: priorPlan.engineAction,
          }
        : null,
      nodes: nodesForPrompt,
      xmlExcerpt: typeof xmlText === "string" ? xmlText.slice(0, 10000) : "",
    }),
  };

  const content = screenshotBlock ? [screenshotBlock, textBlock] : [textBlock];

  return {
    model: SONNET_MODEL,
    max_tokens: SONNET_MAX_TOKENS,
    temperature: 0,
    // 2026-04-26 (Phase E4): cache the static system prompt so escalation
    // calls 2..N (capped at MAX_SONNET_ESCALATIONS_PER_CRAWL = 2) reuse
    // the cached prefix at 10% of normal rate. Marginal savings since
    // escalations rarely fire (~$0.001-0.005/run typical) but free.
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: CLASSIFY_TOOL.name },
    messages: [{ role: "user", content }],
  };
}

let _defaultClient = null;
function getDefaultClient() {
  if (!_defaultClient) {
    _defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _defaultClient;
}

/**
 * Run Sonnet escalation. Returns a new ScreenPlan + classified clickables,
 * or null on failure/budget-exhausted.
 *
 * deps.escalationBudget — shared mutable counter `{used:number, max:number}`.
 * The wrapper increments `used` when a call is actually made.
 * deps.tokenSink — optional `{input_tokens, output_tokens, cached_input_tokens}`
 * mutated in place when a network call happens (success OR malformed). Lets
 * the dispatcher charge the cost meter for tokens we actually spent, even
 * on paths where this function returns null.
 *
 * @param {object} graph
 * @param {object} observation
 * @param {string} xmlText
 * @param {object} priorPlan  - Haiku's plan (low-confidence or missing)
 * @param {object} deps       - { anthropic, escalationBudget, reason, timeoutMs, cache, tokenSink }
 * @returns {Promise<{plan:object, clickables:object[]}|null>}
 */
async function escalate(graph, observation, xmlText, priorPlan, deps = {}) {
  const budget = deps.escalationBudget || { used: 0, max: MAX_SONNET_ESCALATIONS_PER_CRAWL };
  if (budget.used >= budget.max) {
    log.info(
      { used: budget.used, max: budget.max },
      "escalation: budget exhausted, keeping prior plan",
    );
    return null;
  }

  const clickables = (graph && graph.clickables) || [];
  if (clickables.length === 0) return null;

  const anthropic = deps.anthropic || getDefaultClient();
  const timeoutMs = typeof deps.timeoutMs === "number" ? deps.timeoutMs : SONNET_TIMEOUT_MS;
  const reason = typeof deps.reason === "string" ? deps.reason : "low_confidence";
  const screenshotBlock = await loadScreenshotBlock(observation && observation.screenshotPath);
  const request = buildRequest(graph, xmlText, observation, screenshotBlock, priorPlan, reason);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    // Count the budget BEFORE the call so a timeout still consumes it.
    // This prevents a storm of stuck Sonnet calls on pathological screens.
    budget.used += 1;
    log.info(
      { used: budget.used, max: budget.max, reason, priorConfidence: priorPlan && priorPlan.confidence },
      "escalation: calling Sonnet",
    );

    const response = await anthropic.messages.create(request, { signal: controller.signal });
    const durationMs = Date.now() - startedAt;
    // Charge tokens BEFORE any null-return branch so the meter stays honest
    // on malformed / validation-fail paths.
    addToSink(deps.tokenSink, extractUsage(response));
    const toolInput = extractToolInput(response);
    if (!toolInput) {
      log.warn({ durationMs, stopReason: response && response.stop_reason }, "escalation: no tool_use block");
      return null;
    }

    const fingerprint = priorPlan && priorPlan.fingerprint;
    if (!fingerprint) {
      log.warn("escalation: missing fingerprint, cannot cache plan");
      return null;
    }

    const plan = validatePlan(toolInput, clickables.length, fingerprint);
    if (!plan) {
      log.warn({ durationMs }, "escalation: plan validation failed");
      return null;
    }

    // Layer short-circuits on top, same as Haiku path.
    const shortCircuited = applyInputTypeShortCircuit(clickables);
    for (const [idx, cls] of shortCircuited.entries()) {
      plan.nodeClassifications.set(idx, cls);
    }

    // Overwrite the Haiku cache entry so subsequent visits reuse this plan.
    if (deps.cache) deps.cache.set(fingerprint, plan);

    log.info(
      {
        durationMs,
        screenType: plan.screenType,
        confidence: plan.confidence,
        priorConfidence: priorPlan && priorPlan.confidence,
      },
      "escalation: Sonnet plan produced",
    );
    return { plan, clickables: mergeClassifications(clickables, plan.nodeClassifications) };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const msg = (err && err.message) || "";
    if ((err && err.name === "AbortError") || /aborted|abort/i.test(msg)) {
      log.warn({ durationMs, timeoutMs }, "escalation: timeout");
    } else {
      log.warn({ err: msg, durationMs }, "escalation: Sonnet call failed");
    }
    // No usage to record — exception thrown before / during response, so
    // we don't have a usage object to read from. The budget.used increment
    // above still consumed an attempt slot.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Create a fresh budget counter for a crawl.
 */
function createBudget(max = MAX_SONNET_ESCALATIONS_PER_CRAWL) {
  return { used: 0, max };
}

module.exports = {
  escalate,
  shouldEscalate,
  createBudget,
  MAX_SONNET_ESCALATIONS_PER_CRAWL,
  SONNET_MODEL,
  SONNET_TIMEOUT_MS,
};
