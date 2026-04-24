"use strict";

/**
 * ai-oracle.js — Stage 2 deep-analysis on flagged screens.
 *
 * Phase 3.1 rewrite: the model's output shape is now enforced by
 * tool_choice. Before 3.1, deepCheck parsed free-form JSON and silently
 * wrapped parse failures as a fake "AI analysis failed" ux_issue leaking
 * into user-facing reports. With tool_use the only legal response is a
 * schema-valid object; any failure (SDK error, no tool_use block,
 * malformed input) yields EMPTY arrays and zero error-text leakage.
 *
 * Every finding now carries a `confidence` float (0.0-1.0). Stage 3
 * routing in output/report-builder.js reads these to decide whether to
 * skip Sonnet synthesis and render from the schema deterministically.
 */

const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "ai-oracle" });
const { ANALYSIS_MODEL } = require("../config/defaults");
const { buildScreenAnalysisPrompt } = require("../brain/context-builder");

// Module-level default client. Tests inject their own via the opts.client arg.
const defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Tool definition (Stage 2 schema) ─────────────────────────────────────
// Every field in the model's tool_use response is enumerated here. If the
// model tries to return something off-schema, the SDK rejects it before it
// ever reaches our code — that's the fix for the silent-failure path.
const SCREEN_ANALYSIS_TOOL = {
  name: "emit_screen_analysis",
  description:
    "Emit structured QA findings for one Android app screen. " +
    "Every finding MUST include a confidence score (0.0 low, 1.0 certain). " +
    "Only emit findings supported by visible evidence on the screen.",
  input_schema: {
    type: "object",
    properties: {
      critical_bugs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            evidence: { type: "string", description: "The exact element/text that grounds this finding." },
            severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["title", "severity", "confidence"],
        },
      },
      ux_issues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["title", "severity", "confidence"],
        },
      },
      accessibility: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            wcag_criterion: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["title"],
        },
      },
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            effort: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["title"],
        },
      },
    },
    required: ["critical_bugs", "ux_issues", "accessibility", "suggestions"],
  },
};

const EMPTY_RESULT = Object.freeze({
  critical_bugs: [],
  bugs: [],
  ux_issues: [],
  suggestions: [],
  accessibility: [],
});

function toSafeArray(maybe) {
  return Array.isArray(maybe) ? maybe : [];
}

/**
 * Extract the tool_use block's `.input` from an Anthropic messages response.
 * Returns `null` if the response doesn't contain a tool_use for our tool —
 * caller treats that as "empty findings", never as an error surface.
 *
 * @param {object} response
 * @returns {object|null}
 */
function extractToolInput(response) {
  if (!response || !Array.isArray(response.content)) return null;
  for (const block of response.content) {
    if (block && block.type === "tool_use" && block.name === SCREEN_ANALYSIS_TOOL.name) {
      return block.input && typeof block.input === "object" ? block.input : null;
    }
  }
  return null;
}

/**
 * Run deep QA analysis on a single screen via Claude Haiku vision + tool_use.
 *
 * Target: ~800 tokens input (base64 image + short prompt), ~300 tokens output.
 *
 * @param {Object} screen   - { path, xml, screenType, activity, feature, step }
 * @param {Object} context  - Compressed context from brain/context-builder.js
 * @param {Object} [opts]   - { client } — injectable for tests; defaults to module SDK client
 * @returns {Promise<{
 *   critical_bugs: Array, bugs: Array, ux_issues: Array, suggestions: Array,
 *   accessibility: Array, tokenUsage: { input_tokens: number, output_tokens: number }
 * }>}
 */
async function deepCheck(screen, context, opts = {}) {
  const client = opts.client || defaultClient;

  const emptyWithTokens = (tokenUsage = { input_tokens: 0, output_tokens: 0 }) => ({
    ...EMPTY_RESULT,
    critical_bugs: [], bugs: [], ux_issues: [], suggestions: [], accessibility: [],
    tokenUsage,
  });

  if (!screen || !screen.path || !fs.existsSync(screen.path)) {
    return emptyWithTokens();
  }

  let response;
  try {
    const imgData = fs.readFileSync(screen.path).toString("base64");
    const prompt = buildScreenAnalysisPrompt(screen, context);

    response = await client.messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 800,
      tools: [SCREEN_ANALYSIS_TOOL],
      tool_choice: { type: "tool", name: SCREEN_ANALYSIS_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: imgData } },
            { type: "text", text: prompt },
          ],
        },
      ],
    });
  } catch (e) {
    // Any SDK failure (network, rate limit, auth) short-circuits to empty
    // findings. The error is logged for operator triage; the caller never
    // sees the error text in user-visible findings.
    log.error({ err: e, step: screen && screen.step }, "deepCheck SDK call failed");
    return emptyWithTokens();
  }

  const tokenUsage = {
    input_tokens: (response.usage && response.usage.input_tokens) || 0,
    output_tokens: (response.usage && response.usage.output_tokens) || 0,
  };

  const input = extractToolInput(response);
  if (!input) {
    // Model did not emit a tool_use (refused, hit max_tokens before the
    // tool, etc.). Stage 3 will see empty findings and route accordingly.
    log.warn({ step: screen && screen.step, stop_reason: response.stop_reason }, "deepCheck: no tool_use in response");
    return emptyWithTokens(tokenUsage);
  }

  const critical_bugs = toSafeArray(input.critical_bugs);
  return {
    critical_bugs,
    // Legacy alias retained until brain/context-builder.js:87 migrates to
    // critical_bugs. `bugs` and `critical_bugs` point at the same array.
    bugs: critical_bugs,
    ux_issues: toSafeArray(input.ux_issues),
    suggestions: toSafeArray(input.suggestions),
    accessibility: toSafeArray(input.accessibility),
    tokenUsage,
  };
}

/**
 * Analyze each triaged screen in turn, accumulating tokens.
 *
 * Serial, not parallel: keeps rate-limit exposure low and cost deterministic
 * in the happy path. If latency becomes the bottleneck, batch via
 * Promise.all over chunks of 3-5 here — at our scale the rate limit isn't
 * the concern.
 *
 * @param {Array} screens      - Screens returned by triage
 * @param {Object} contextData - Shared context (coverage, flows, plan)
 * @param {Object} [opts]      - { client } injected for tests
 * @returns {Promise<{
 *   analyses: Array,
 *   totalTokens: { input_tokens: number, output_tokens: number }
 * }>}
 */
async function analyzeTriagedScreens(screens, contextData, opts = {}) {
  const analyses = [];
  const totalTokens = { input_tokens: 0, output_tokens: 0 };

  for (const screen of screens) {
    log.info({ step: screen.step, screenType: screen.screenType }, "Analyzing step");
    const result = await deepCheck(screen, contextData, opts);
    analyses.push({
      step: screen.step,
      screenType: screen.screenType,
      feature: screen.feature,
      ...result,
    });
    totalTokens.input_tokens += result.tokenUsage.input_tokens;
    totalTokens.output_tokens += result.tokenUsage.output_tokens;
  }

  log.info(
    {
      screensAnalyzed: analyses.length,
      inputTokens: totalTokens.input_tokens,
      outputTokens: totalTokens.output_tokens,
    },
    "Analysis complete",
  );

  return { analyses, totalTokens };
}

module.exports = {
  deepCheck,
  analyzeTriagedScreens,
  // Exported for report-builder.js to validate tool-use schema in tests.
  SCREEN_ANALYSIS_TOOL,
};
