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
const fs = require("fs");
const { logger } = require("../../lib/logger");
const {
  CLASSIFY_TOOL,
  validatePlan,
  applyInputTypeShortCircuit,
  mergeClassifications,
  LOW_CONFIDENCE_THRESHOLD,
} = require("./semantic-classifier");

const log = logger.child({ component: "v18-sonnet-escalation" });

const SONNET_MODEL = "claude-sonnet-4-6";
const SONNET_TIMEOUT_MS = 8000;
const SONNET_MAX_TOKENS = 2000;

/** Hard cap per crawl. */
const MAX_SONNET_ESCALATIONS_PER_CRAWL = 2;

const SYSTEM_PROMPT = `You are the senior-QA-engineer escalation layer for a mobile app crawler.

The Haiku classifier was either unsure (confidence < ${LOW_CONFIDENCE_THRESHOLD}) or the crawler got stuck on this screen type. Your job is to produce a better plan.

The goal: MAP the app, not USE it. Explore like a senior QA engineer.

All rules from the Haiku system prompt apply — intent taxonomy, screen types, optimistic-on-ambiguity, strict destructive. Use the richer model capacity to reason harder about ambiguous cases, especially when the screen is novel or the structural signals conflict.

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

/**
 * Load a screenshot as an image block, mirroring semantic-classifier.
 *
 * @param {string} [screenshotPath]
 * @returns {object|null}
 */
function loadScreenshotBlock(screenshotPath) {
  if (!screenshotPath || typeof screenshotPath !== "string") return null;
  try {
    const data = fs.readFileSync(screenshotPath);
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: data.toString("base64"),
      },
    };
  } catch (err) {
    log.warn({ err: err.message, screenshotPath }, "escalation: screenshot load failed");
    return null;
  }
}

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
      trajectorySummary: (observation && observation.trajectorySummary) || "",
      escalationReason: reason || "low_confidence",
      priorPlanSummary: priorPlan
        ? {
            screenType: priorPlan.screenType,
            confidence: priorPlan.confidence,
            allowedIntents: priorPlan.allowedIntents,
            actionBudget: priorPlan.actionBudget,
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
    system: SYSTEM_PROMPT,
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
 *
 * @param {object} graph
 * @param {object} observation
 * @param {string} xmlText
 * @param {object} priorPlan  - Haiku's plan (low-confidence or missing)
 * @param {object} deps       - { anthropic, escalationBudget, reason, timeoutMs, cache }
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
  const screenshotBlock = loadScreenshotBlock(observation && observation.screenshotPath);
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
