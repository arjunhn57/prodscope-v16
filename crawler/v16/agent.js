"use strict";

/**
 * v16/agent.js — The "brain" of V16.
 *
 * Haiku 4.5 is the PRIMARY model: does perception AND decision in one call
 * per step. This is required to stay under the ₹10 (~$0.12) cost ceiling.
 *
 * Sonnet 4.6 is an opt-in ESCALATION path, invoked only when:
 *   - Haiku returned "escalate": true, AND
 *   - budget.canEscalateToSonnet() returns true.
 *
 * Hard cap: 3 Sonnet escalations per crawl (enforced by budget.js). After
 * that, agent runs Haiku-only until done/budget exhaustion.
 *
 * Inputs: current observation + history tail + goals + credentials + budget.
 * Output: one Action (validated by executor.js) plus reasoning + expected
 * outcome for logging, plus token usage for cost accounting.
 */

const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");
const { buildCacheablePrefix, buildStepSuffix } = require("./prompts");
const { validateAction } = require("./executor");
const { logger } = require("../../lib/logger");

const log = logger.child({ component: "v16-agent" });

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-6";

// Haiku output cap — kept tight to stay under the $0.12 ceiling. Reasoning
// field is instructed to be 1 short sentence; the tool schema + action payload
// typically fits in ~60-90 tokens. 120 is a cost/safety margin.
const HAIKU_MAX_TOKENS = 120;
const SONNET_MAX_TOKENS = 600;

// Anthropic tool schema — forces structured output. The model MUST emit a
// tool_use block conforming to this schema when tool_choice.name matches.
const DECISION_TOOL = {
  name: "emit_action",
  description:
    "Emit the next action for the QA tester agent. Always call this tool exactly once per turn.",
  input_schema: {
    type: "object",
    properties: {
      reasoning: { type: "string", description: "1-2 short sentences about what you see and why." },
      expected_outcome: { type: "string", description: "What you expect after this action." },
      escalate: { type: "boolean", description: "Set true ONLY if deeply uncertain." },
      action: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              // Core pointer gestures
              "tap",
              "double_tap",
              "long_press",
              "drag",
              // Swipes (semantic — executor fills in coords from screen dims)
              "swipe",
              "scroll_up",
              "scroll_down",
              "swipe_horizontal",
              "pull_to_refresh",
              // Edge / gesture-nav swipes
              "edge_swipe_back",
              "edge_swipe_drawer",
              "edge_swipe_home",
              // Text input
              "type",
              "clear_field",
              // Keys
              "press_back",
              "press_home",
              "press_menu",
              "press_app_switch",
              "press_escape",
              "ime_action",
              // Lifecycle
              "launch_app",
              "wait",
              "done",
              "request_human_input",
            ],
          },
          x: { type: "number" },
          y: { type: "number" },
          x1: { type: "number" },
          y1: { type: "number" },
          x2: { type: "number" },
          y2: { type: "number" },
          direction: {
            type: "string",
            enum: ["left", "right"],
            description:
              "For swipe_horizontal: 'left' = swipe finger right→left (go to NEXT page in a ViewPager/carousel); 'right' = swipe finger left→right (go to PREVIOUS page).",
          },
          screenWidth: { type: "number", description: "Optional — emulator screen width in px. Default 1080." },
          screenHeight: { type: "number", description: "Optional — emulator screen height in px. Default 2400." },
          durationMs: { type: "number", description: "For drag: gesture duration in ms. Default 700." },
          targetText: {
            type: "string",
            description:
              "For tap/long_press/double_tap on a labeled element, the exact visible text of "
              + "the element (e.g. 'Continue with Email', 'Sign in', 'Skip'). The "
              + "executor prefers coords derived from UIAutomator XML bounds when "
              + "this text matches a clickable node. Omit for icon-only or "
              + "coordinate-only taps.",
          },
          text: { type: "string", description: "Use ${EMAIL} / ${PASSWORD} for credentials." },
          ms: { type: "number", description: "Wait duration in ms (0..3000)." },
          reason: { type: "string", description: "For done: why the crawl ends." },
          field: {
            type: "string",
            enum: ["otp", "email_code", "2fa", "captcha"],
            description: "For request_human_input: which kind of code you need a human to provide.",
          },
          prompt: {
            type: "string",
            description: "For request_human_input: 1 short sentence explaining what the human should enter.",
          },
        },
        required: ["type"],
      },
    },
    required: ["reasoning", "action", "expected_outcome"],
  },
};

/**
 * @typedef {import('./executor').Action} Action
 * @typedef {{email?:string, password?:string}} Credentials
 * @typedef {import('./observation').Observation} Observation
 * @typedef {'changed'|'no_change'|'app_crashed'|'left_app'|'none'} FeedbackLabel
 *
 * @typedef {Object} AgentDecision
 * @property {string} reasoning
 * @property {Action} action
 * @property {string} expectedOutcome
 * @property {'haiku'|'sonnet'} modelUsed
 * @property {boolean} escalated        // true if Sonnet was invoked this step
 * @property {number} inputTokens       // total input tokens (both calls if escalated)
 * @property {number} outputTokens      // total output tokens
 * @property {number} cachedInputTokens // cached portion of inputTokens
 *
 * @typedef {Object} AgentContext
 * @property {Observation} observation
 * @property {boolean} fingerprintChanged
 * @property {FeedbackLabel} lastFeedback
 * @property {{type:string,[k:string]:any}|null} lastAction
 * @property {Array<{step:number, action:any, feedback:string, fingerprint:string, activity:string}>} historyTail
 * @property {Credentials|null} credentials
 * @property {{ goals?: string[], painPoints?: string[], goldenPath?: string[] }} [appContext]
 * @property {import('./budget').BudgetSnapshot} budget
 * @property {{canEscalateToSonnet: () => boolean}} budgetController
 * @property {number} uniqueScreens
 * @property {number} targetUniqueScreens
 * @property {number} step
 * @property {number} stepsRemaining
 */

let _defaultClient = null;
function getDefaultClient() {
  if (!_defaultClient) {
    _defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _defaultClient;
}

/**
 * Read and base64-encode a PNG screenshot. Returns null if the file is
 * missing — the agent will still decide based on text context alone.
 * @param {string} path
 * @returns {string|null}
 */
function readScreenshotBase64(path) {
  try {
    if (!path || !fs.existsSync(path)) return null;
    return fs.readFileSync(path).toString("base64");
  } catch (err) {
    log.warn({ err: err.message, path }, "screenshot read failed");
    return null;
  }
}

/**
 * Decide whether to send the screenshot image this step. Sending an image is
 * the single largest per-step cost. Policy:
 *   1. Honor explicit `ctx.sendImage` (boolean) when the loop has already
 *      computed the every-Nth-FP-change policy. Tests and legacy callers may
 *      omit this, in which case we fall back to the per-FP-change default.
 *   2. Always send on step 1 and after crash/left-app.
 *   3. Otherwise, send on every fingerprint change.
 * @param {AgentContext} ctx
 * @returns {boolean}
 */
function shouldSendImage(ctx) {
  if (ctx.step <= 1) return true;
  // Crashed or left-app → model needs to see where it landed.
  if (ctx.lastFeedback === "app_crashed" || ctx.lastFeedback === "left_app") return true;
  // Loop-controlled override (every 2nd FP change policy).
  if (typeof ctx.sendImage === "boolean") return ctx.sendImage;
  if (ctx.fingerprintChanged) return true;
  return false;
}

/**
 * Build the Messages API request body for a given model/context.
 * Uses system field with ephemeral cache_control so the stable prefix is
 * read from cache on step 2+.
 *
 * @param {AgentContext} ctx
 * @param {'haiku'|'sonnet'} modelKind
 * @returns {object} request body for anthropic.messages.stream
 */
function buildRequest(ctx, modelKind) {
  const systemPrefix = buildCacheablePrefix();
  const suffix = buildStepSuffix({
    step: ctx.step,
    stepsRemaining: ctx.stepsRemaining,
    uniqueScreens: ctx.uniqueScreens,
    targetUniqueScreens: ctx.targetUniqueScreens,
    fingerprint: ctx.observation.fingerprint,
    fingerprintChanged: ctx.fingerprintChanged,
    screenshotPath: ctx.observation.screenshotPath,
    xml: ctx.observation.xml,
    activity: ctx.observation.activity,
    packageName: ctx.observation.packageName,
    lastFeedback: ctx.lastFeedback,
    lastAction: ctx.lastAction,
    historyTail: ctx.historyTail || [],
    credentials: ctx.credentials,
    budget: {
      costUsd: ctx.budget.costUsd,
      costCapUsd: ctx.budget.maxCostUsd,
      sonnetUsed: ctx.budget.sonnetEscalationsUsed,
      sonnetCap: ctx.budget.maxSonnetEscalations,
    },
    appContext: ctx.appContext,
    stagnationStreak: ctx.stagnationStreak,
    discoveryDelta5: ctx.discoveryDelta5,
    recentFingerprints: ctx.recentFingerprints,
    authEscape: ctx.authEscape || null,
    // V18 Phase 3: trajectory hint from v18/trajectory-memory.js — tells
    // the LLM which hub screen-types are still unexplored so its tap
    // choices can prefer drawer menus / gear icons / "..." buttons that
    // lead there. Populated by v17/drivers/llm-fallback.js when
    // deps.trajectory is provided by the v18 dispatcher.
    trajectoryHint: ctx.trajectoryHint || null,
    pressBackBlockedOnAuth: ctx.pressBackBlockedOnAuth || null,
  });

  const contentParts = [];
  if (shouldSendImage(ctx)) {
    const b64 = readScreenshotBase64(ctx.observation.screenshotPath);
    if (b64) {
      contentParts.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: b64 },
      });
    }
  }
  contentParts.push({ type: "text", text: suffix });

  return {
    model: modelKind === "sonnet" ? SONNET_MODEL : HAIKU_MODEL,
    max_tokens: modelKind === "sonnet" ? SONNET_MAX_TOKENS : HAIKU_MAX_TOKENS,
    temperature: 0,
    system: [
      {
        type: "text",
        text: systemPrefix,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [DECISION_TOOL],
    tool_choice: { type: "tool", name: DECISION_TOOL.name },
    messages: [{ role: "user", content: contentParts }],
  };
}

/**
 * Extract the first emit_action tool_use block's input from an Anthropic message.
 * @param {object} message — shape: { content: Array<{type, ...}>, usage }
 * @returns {object|null}
 */
function extractToolInput(message) {
  if (!message || !Array.isArray(message.content)) return null;
  for (const block of message.content) {
    if (block && block.type === "tool_use" && block.name === DECISION_TOOL.name) {
      return block.input || null;
    }
  }
  return null;
}

/**
 * Also try to pull any text_content (model chain-of-thought that precedes the
 * tool call) — useful for logging when the tool call is missing.
 */
function extractTextContent(message) {
  if (!message || !Array.isArray(message.content)) return "";
  let text = "";
  for (const block of message.content) {
    if (block && block.type === "text" && typeof block.text === "string") {
      text += block.text;
    }
  }
  return text;
}

/**
 * Parse the JSON blob the model returns. Tolerates leading/trailing
 * markdown fences (```json ... ```), leading prose, and the occasional
 * stray character.
 * @param {string} raw
 * @returns {{reasoning?:string, action?:object, expected_outcome?:string, escalate?:boolean}|null}
 */
function parseModelJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  let cleaned = raw.trim();
  // Strip markdown fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  // Try direct JSON parse first
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // Fall through to brace-extraction.
  }
  // Extract the first top-level { ... } block
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last < 0 || last <= first) return null;
  try {
    return JSON.parse(cleaned.substring(first, last + 1));
  } catch (err) {
    log.warn({ err: err.message, raw: cleaned.slice(0, 200) }, "JSON parse failed");
    return null;
  }
}

/**
 * Run one model call (Haiku or Sonnet). Returns the decision shape + tokens.
 * Throws on transport errors; callers are expected to fall back to a safe
 * default action (press_back) at the loop level.
 *
 * @param {AgentContext} ctx
 * @param {'haiku'|'sonnet'} modelKind
 * @param {{anthropic: {messages: {stream: (body:object) => Promise<any>}}}} deps
 * @returns {Promise<{parsed: object|null, usage: {input_tokens:number, output_tokens:number, cache_read_input_tokens?:number, cache_creation_input_tokens?:number}}>}
 */
async function callModel(ctx, modelKind, deps) {
  const client = deps.anthropic;
  const body = buildRequest(ctx, modelKind);
  const message = await client.messages.create(body);
  const usage = (message && message.usage) || { input_tokens: 0, output_tokens: 0 };
  const toolInput = extractToolInput(message);
  if (toolInput) {
    return { parsed: toolInput, usage };
  }
  // Fallback: some models may emit a text block with JSON inside if they refuse
  // to call the tool. Attempt legacy JSON parsing from any text content.
  const text = extractTextContent(message);
  const parsed = parseModelJson(text);
  if (!parsed) {
    log.warn(
      { modelKind, stopReason: message && message.stop_reason, raw: text.slice(0, 300) },
      "model returned no tool_use and no parseable JSON",
    );
  }
  return { parsed, usage };
}

/**
 * Fallback action used when the model returns malformed output or an invalid
 * action. press_back is safe: it either goes back or no-ops — never destructive.
 * @returns {Action}
 */
function safeFallbackAction() {
  return { type: "press_back" };
}

/**
 * Extract token counts from an Anthropic usage object, defaulting anything
 * missing to 0.
 */
function splitUsage(usage) {
  const cached =
    (usage && (usage.cache_read_input_tokens || 0)) || 0;
  // cache_creation_input_tokens is billed at full input rate; fold it into
  // uncached input so budget.recordLlmCall prices it correctly.
  const creation = (usage && usage.cache_creation_input_tokens) || 0;
  const uncachedInput = ((usage && usage.input_tokens) || 0) + creation;
  return {
    inputTokens: uncachedInput + cached, // total for reporting
    cachedInputTokens: cached,
    outputTokens: (usage && usage.output_tokens) || 0,
  };
}

/**
 * Coerce a parsed model response into an {action, reasoning, expectedOutcome, escalate}
 * triple. If the parsed object is missing fields or the action is invalid,
 * returns a safe fallback and `escalate=false`.
 *
 * @param {object|null} parsed
 * @returns {{ action: Action, reasoning: string, expectedOutcome: string, escalate: boolean, validationError?: string }}
 */
function coerceDecision(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return {
      action: safeFallbackAction(),
      reasoning: "model returned no parseable output — pressing back",
      expectedOutcome: "return to previous screen",
      escalate: false,
      validationError: "no parseable JSON",
    };
  }
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
  const expectedOutcome =
    typeof parsed.expected_outcome === "string" ? parsed.expected_outcome : "";
  const escalate = parsed.escalate === true;

  const v = validateAction(parsed.action);
  if (!v.valid) {
    return {
      action: safeFallbackAction(),
      reasoning: reasoning || `invalid action: ${v.error}`,
      expectedOutcome: expectedOutcome || "return to previous screen",
      escalate,
      validationError: v.error,
    };
  }
  return { action: parsed.action, reasoning, expectedOutcome, escalate };
}

/**
 * Decide the next action. Haiku-primary with optional Sonnet escalation.
 *
 * Two escalation paths:
 *   1. MODEL-REQUESTED: Haiku runs first; if it emits escalate=true and budget
 *      allows, Sonnet reruns the same step and we return Sonnet's decision.
 *   2. LOOP-FORCED (stagnation rescue): agent-loop sets ctx.forceEscalate=true
 *      after N consecutive no_change feedback. We skip Haiku entirely and go
 *      straight to Sonnet — cheaper than burning a stuck Haiku call first.
 *
 * Both paths respect the 3-per-crawl Sonnet cap via budgetController.
 *
 * @param {AgentContext & {forceEscalate?: boolean}} ctx
 * @param {{anthropic?: object}} [deps]
 * @returns {Promise<AgentDecision>}
 */
async function decideNextAction(ctx, deps) {
  if (!ctx || !ctx.observation) {
    throw new Error("decideNextAction requires ctx.observation");
  }
  const anthropic = (deps && deps.anthropic) || getDefaultClient();

  // ── Forced Sonnet rescue (skips Haiku) ──
  const canEscalate =
    ctx.budgetController && ctx.budgetController.canEscalateToSonnet();
  if (ctx.forceEscalate && canEscalate) {
    log.info({ step: ctx.step, reason: "stagnation" }, "forced Sonnet escalation");
    try {
      const sonnetResult = await callModel(ctx, "sonnet", { anthropic });
      const sonnetTokens = splitUsage(sonnetResult.usage);
      const sonnetDecision = coerceDecision(sonnetResult.parsed);
      return {
        reasoning: sonnetDecision.reasoning,
        action: sonnetDecision.action,
        expectedOutcome: sonnetDecision.expectedOutcome,
        modelUsed: "sonnet",
        escalated: true,
        inputTokens: sonnetTokens.inputTokens,
        outputTokens: sonnetTokens.outputTokens,
        cachedInputTokens: sonnetTokens.cachedInputTokens,
      };
    } catch (err) {
      log.warn({ err: err.message }, "forced Sonnet call failed — falling back to Haiku");
      // Fall through to normal Haiku path.
    }
  }

  // ── Haiku pass ──
  const haikuResult = await callModel(ctx, "haiku", { anthropic });
  const haikuTokens = splitUsage(haikuResult.usage);
  const haikuDecision = coerceDecision(haikuResult.parsed);

  const wantsEscalation = haikuDecision.escalate && canEscalate;

  if (!wantsEscalation) {
    return {
      reasoning: haikuDecision.reasoning,
      action: haikuDecision.action,
      expectedOutcome: haikuDecision.expectedOutcome,
      modelUsed: "haiku",
      escalated: false,
      inputTokens: haikuTokens.inputTokens,
      outputTokens: haikuTokens.outputTokens,
      cachedInputTokens: haikuTokens.cachedInputTokens,
    };
  }

  // ── Model-requested Sonnet escalation ──
  log.info({ step: ctx.step, reasoning: haikuDecision.reasoning }, "escalating to Sonnet");
  let sonnetResult;
  try {
    sonnetResult = await callModel(ctx, "sonnet", { anthropic });
  } catch (err) {
    log.warn({ err: err.message }, "Sonnet call failed — using Haiku decision");
    return {
      reasoning: haikuDecision.reasoning,
      action: haikuDecision.action,
      expectedOutcome: haikuDecision.expectedOutcome,
      modelUsed: "haiku",
      escalated: false,
      inputTokens: haikuTokens.inputTokens,
      outputTokens: haikuTokens.outputTokens,
      cachedInputTokens: haikuTokens.cachedInputTokens,
    };
  }

  const sonnetTokens = splitUsage(sonnetResult.usage);
  const sonnetDecision = coerceDecision(sonnetResult.parsed);

  return {
    reasoning: sonnetDecision.reasoning || haikuDecision.reasoning,
    action: sonnetDecision.action,
    expectedOutcome: sonnetDecision.expectedOutcome || haikuDecision.expectedOutcome,
    modelUsed: "sonnet",
    escalated: true,
    inputTokens: haikuTokens.inputTokens + sonnetTokens.inputTokens,
    outputTokens: haikuTokens.outputTokens + sonnetTokens.outputTokens,
    cachedInputTokens: haikuTokens.cachedInputTokens + sonnetTokens.cachedInputTokens,
  };
}

module.exports = {
  decideNextAction,
  // Exported for unit testing
  buildRequest,
  parseModelJson,
  coerceDecision,
  shouldSendImage,
  splitUsage,
  HAIKU_MODEL,
  SONNET_MODEL,
};
