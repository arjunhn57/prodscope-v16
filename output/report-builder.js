"use strict";

/**
 * report-builder.js — Structured JSON report with 1 Sonnet LLM call.
 *
 * Uses Anthropic `tool_use` with `tool_choice` to force structured JSON
 * output. The model MUST emit a tool_use block whose `.input` already
 * matches REPORT_TOOL.input_schema, so there is no JSON parsing step and
 * the old raw-text fallback never fires on a paying partner.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { REPORT_MODEL } = require("../config/defaults");
const { buildReportPrompt } = require("../brain/context-builder");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Forced-JSON tool schema for the final report. Keep this in sync with the
 * frontend CrawlReport type — the `input` object is persisted verbatim.
 *
 * We do NOT include crawl-stats / coverage / deterministic findings here —
 * those are enriched by this module after the model call.
 */
const SEVERITY_ENUM = ["critical", "high", "medium", "low"];
const EFFORT_ENUM = ["low", "medium", "high"];

const REPORT_TOOL = {
  name: "emit_report",
  description:
    "Emit the final crawl QA report. Always call this tool exactly once. Do not include any other text in the response.",
  input_schema: {
    type: "object",
    properties: {
      overall_score: {
        type: "number",
        description: "Overall app-quality score, 0-100.",
      },
      summary: {
        type: "string",
        description:
          "2-4 sentence executive summary for a product owner. Name the top risk first.",
      },
      critical_bugs: {
        type: "array",
        description: "Crashes / ANRs / blocking defects worth ship-blocking.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            severity: { type: "string", enum: SEVERITY_ENUM },
            step: { type: "number" },
          },
          required: ["title", "description"],
        },
      },
      ux_issues: {
        type: "array",
        description: "Lower-severity UX / accessibility notes.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            severity: { type: "string", enum: SEVERITY_ENUM },
          },
          required: ["title", "description"],
        },
      },
      suggestions: {
        type: "array",
        description: "General suggestions tied to effort estimates.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            effort: { type: "string", enum: EFFORT_ENUM },
          },
          required: ["title", "description"],
        },
      },
      quick_wins: {
        type: "array",
        description: "Tight list of fast, low-risk wins.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
          },
          required: ["title", "description"],
        },
      },
      recommended_next_steps: {
        type: "array",
        description: "What the team should do next, in priority order.",
        items: { type: "string" },
      },
      coverage_assessment: {
        type: "string",
        description:
          "1-2 sentence verdict on crawl coverage (what we saw vs. what we missed).",
      },
    },
    required: [
      "overall_score",
      "summary",
      "critical_bugs",
      "ux_issues",
      "suggestions",
      "quick_wins",
      "recommended_next_steps",
      "coverage_assessment",
    ],
  },
};

/**
 * Extract the forced `emit_report` tool_use block from a Messages response.
 * Returns the input object, or null if the model returned text instead.
 *
 * @param {object} response - Anthropic messages.create response
 * @returns {object|null}
 */
function extractReportToolInput(response) {
  if (!response || !Array.isArray(response.content)) return null;
  for (const block of response.content) {
    if (
      block &&
      block.type === "tool_use" &&
      block.name === REPORT_TOOL.name &&
      block.input &&
      typeof block.input === "object"
    ) {
      return block.input;
    }
  }
  return null;
}

/**
 * Last-ditch fallback — the SDK should never return a bare text block when
 * tool_choice is forced, but we keep this so a future API quirk doesn't
 * nuke the report for a design partner.
 *
 * @param {object} response
 * @returns {object|null}
 */
function extractReportFromText(response) {
  if (!response || !Array.isArray(response.content)) return null;
  const textBlock = response.content.find(
    (b) => b && b.type === "text" && typeof b.text === "string"
  );
  if (!textBlock) return null;
  const raw = textBlock.text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (_) {
    /* ignore */
  }
  return null;
}

/**
 * Build a structured report from crawl results + oracle findings.
 * Makes 1 Sonnet LLM call for synthesis via forced tool_use.
 *
 * @param {Object} params
 * @param {string} params.packageName
 * @param {Object} params.coverageSummary
 * @param {Array}  params.deterministicFindings
 * @param {Array}  params.aiAnalyses
 * @param {Array}  params.flows
 * @param {Object} params.crawlStats
 * @param {Object} params.opts
 * @param {Object} params.crawlHealth
 * @param {object} [params.client] - Optional Anthropic client (tests).
 * @returns {{ report: string, tokenUsage: { input_tokens: number, output_tokens: number } }}
 */
async function buildReport(params) {
  const {
    packageName,
    coverageSummary,
    deterministicFindings,
    aiAnalyses,
    flows,
    crawlStats,
    opts,
    crawlHealth,
    client,
  } = params;

  // Hallucination guard: suppress the Sonnet analysis pass when the crawl
  // coverage is too thin to produce honest findings. Three independent
  // triggers:
  //
  //   A) stopReason indicates the crawl was blocked at auth — common case
  //      from the legacy `blocked_by_auth:*` prefix that V17 dropped but
  //      V16 still emits; we also catch bare `press_back_blocked` /
  //      `fp_revisit_loop` at low screen counts.
  //   B) budget exhausted with fewer than 5 in-app screens.
  //   C) the AI oracle triage ended up analyzing fewer than 3 absolute
  //      screens, OR fewer than 20% of the unique screens reached. This
  //      is the "20 screens crawled but only 2 analyzed" case that
  //      caused Sonnet to hallucinate "app stuck on loading screen" on a
  //      working biztoso run (2026-04-23, job 3631ab85).
  //
  // In any of these cases we return a structured, honest envelope with
  // `analysis_suppressed: true` instead of paying Sonnet to invent P0 bugs.
  const inAppScreens = crawlStats?.uniqueStates ?? 0;
  const stopReason = crawlHealth?.stopReason ?? crawlStats?.stopReason;
  const aiScreensAnalyzedRaw = crawlHealth?.aiScreensAnalyzed;
  const aiScreensAnalyzed = aiScreensAnalyzedRaw ?? 0;
  const MIN_AI_SCREENS_ABSOLUTE = 3;
  const MIN_AI_SCREENS_RATIO = 0.2;

  const blockedByAuth = String(stopReason || "").includes("blocked_by_auth");
  const budgetExhaustedEarly =
    stopReason === "budget_exhausted" && inAppScreens < 5;
  // Thin-AI-coverage check only applies when the runner actually reports
  // aiScreensAnalyzed — otherwise we'd suppress every legacy test fixture
  // that doesn't thread the field. The production code path (jobs/runner.js:465)
  // always sets it, so this only affects unit test scaffolding.
  const thinAiCoverage =
    typeof aiScreensAnalyzedRaw === "number" &&
    inAppScreens > 0 &&
    (aiScreensAnalyzed < MIN_AI_SCREENS_ABSOLUTE ||
      aiScreensAnalyzed / inAppScreens < MIN_AI_SCREENS_RATIO);

  if (blockedByAuth || budgetExhaustedEarly || thinAiCoverage) {
    let suppressionReason;
    let recommendedNextSteps;

    if (blockedByAuth) {
      suppressionReason =
        `we couldn't reach the app's main flows — the crawl was blocked before exploration could complete ` +
        `(stopReason: ${stopReason}, in-app screens: ${inAppScreens}). ` +
        `We're not publishing findings for this run because they would be based on login/setup screens only.`;
      recommendedNextSteps = [
        "Provide an OTP / verification code at upload (Known Inputs panel)",
        "Or stay on the Live page to answer the human-input popup when it appears",
        "Re-run once login succeeds to get real findings",
      ];
    } else if (budgetExhaustedEarly) {
      suppressionReason =
        `the crawl stopped after only ${inAppScreens} unique screens — not enough coverage to publish findings. ` +
        `Re-run with a larger step budget or check the crawl logs for navigation issues.`;
      recommendedNextSteps = [
        "Check the crawl logs for repeated press_back / fp_revisit_loop",
        "Re-run with a larger step budget",
        "Verify the app's launcher activity is reachable",
      ];
    } else {
      // thin AI coverage
      suppressionReason =
        `the AI analysis pass only triaged ${aiScreensAnalyzed} of ${inAppScreens} unique screens ` +
        `(${Math.round((aiScreensAnalyzed / inAppScreens) * 100)}%). That's below our threshold for publishing ` +
        `findings — at this coverage the Sonnet pass tends to extrapolate from splash / loading frames. ` +
        `Re-run with a deeper budget or a more permissive triage to get honest findings.`;
      recommendedNextSteps = [
        "Re-run the crawl with a higher MAX_CRAWL_STEPS",
        "Review the oracle triage filters in oracle/triage.js — they may be over-aggressively skipping",
        "Inspect the screenshots directly to see what the crawler actually reached",
      ];
    }

    const suppressed = {
      overall_score: null,
      summary: `Analysis suppressed: ${suppressionReason}`,
      critical_bugs: [],
      ux_issues: [],
      suggestions: [],
      quick_wins: [],
      recommended_next_steps: recommendedNextSteps,
      coverage_assessment: `Incomplete — only ${inAppScreens} unique in-app screens explored, ${aiScreensAnalyzed} analyzed by AI.`,
      coverage: {
        summary: coverageSummary,
        totalFlows: (flows || []).length,
        completedFlows: (flows || []).filter((f) => f.outcome === "completed").length,
      },
      crawl_health: crawlHealth || {},
      crawl_stats: crawlStats,
      analysis_suppressed: true,
      suppression_trigger: blockedByAuth
        ? "blocked_by_auth"
        : budgetExhaustedEarly
        ? "budget_exhausted_early"
        : "thin_ai_coverage",
    };
    return {
      report: JSON.stringify(suppressed, null, 2),
      tokenUsage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const prompt = buildReportPrompt({
    packageName,
    coverageSummary,
    deterministic: deterministicFindings,
    aiFindings: aiAnalyses,
    flows,
    crawlStats,
    opts,
  });

  const anthropicClient = client || anthropic;

  try {
    const response = await anthropicClient.messages.create({
      model: REPORT_MODEL,
      max_tokens: 2500,
      temperature: 0,
      tools: [REPORT_TOOL],
      tool_choice: { type: "tool", name: REPORT_TOOL.name },
      messages: [{ role: "user", content: prompt }],
    });

    const tokenUsage = {
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
    };

    const toolInput =
      extractReportToolInput(response) || extractReportFromText(response);

    if (!toolInput) {
      throw new Error(
        "model returned neither a tool_use block nor parseable JSON"
      );
    }

    const reportJson = { ...toolInput };

    reportJson.coverage = {
      summary: coverageSummary,
      totalFlows: (flows || []).length,
      completedFlows: (flows || []).filter((f) => f.outcome === "completed").length,
    };
    reportJson.crawl_health = crawlHealth || {};
    reportJson.crawl_stats = crawlStats;
    reportJson.deterministic_findings = (deterministicFindings || []).map((f) => ({
      type: f.type,
      severity: f.severity,
      detail: f.detail,
      step: f.step,
      element: f.element,
    }));
    reportJson.token_usage = tokenUsage;

    return { report: JSON.stringify(reportJson, null, 2), tokenUsage };
  } catch (e) {
    console.error(`  [report-builder] Report generation failed: ${e.message}`);

    // Catastrophic fallback: build deterministic-only report (no LLM).
    const fallbackReport = {
      overall_score: 0,
      summary: `Report generation failed: ${e.message}. Deterministic findings are included below.`,
      critical_bugs: (deterministicFindings || [])
        .filter((f) => f.severity === "critical" || f.type === "crash")
        .map((f) => ({ title: f.type, description: f.detail })),
      ux_issues: (deterministicFindings || [])
        .filter((f) => f.type.includes("accessibility") || f.type === "empty_screen")
        .map((f) => ({ title: f.type, description: f.detail })),
      suggestions: [],
      quick_wins: [],
      recommended_next_steps: [],
      coverage_assessment: "Unavailable — report generation failed.",
      coverage: { summary: coverageSummary },
      crawl_stats: crawlStats,
      deterministic_findings: deterministicFindings || [],
      ai_analysis_failed: true,
    };

    return {
      report: JSON.stringify(fallbackReport, null, 2),
      tokenUsage: { input_tokens: 0, output_tokens: 0 },
    };
  }
}

module.exports = {
  buildReport,
  REPORT_TOOL,
  extractReportToolInput,
  extractReportFromText,
};
