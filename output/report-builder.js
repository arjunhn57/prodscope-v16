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

  // Hallucination guard: when the crawl was blocked before it could reach
  // in-app screens, feeding launcher / auth screenshots to Sonnet produces
  // fabricated P0 bugs ("Potential infinite loading state") that ruin
  // design-partner credibility. Return a suppressed-analysis envelope
  // instead of calling Sonnet at all.
  const inAppScreens = crawlStats?.uniqueStates ?? 0;
  const stopReason = crawlHealth?.stopReason ?? crawlStats?.stopReason;
  const wasBlocked =
    String(stopReason || "").includes("blocked_by_auth") ||
    (stopReason === "budget_exhausted" && inAppScreens < 5);

  if (wasBlocked) {
    const suppressed = {
      overall_score: null,
      summary: `We couldn't reach the app's main flows — the crawl was blocked before exploration could complete (stopReason: ${stopReason}, in-app screens: ${inAppScreens}). We're not publishing findings for this run because they would be based on login/setup screens only.`,
      critical_bugs: [],
      ux_issues: [],
      suggestions: [],
      quick_wins: [],
      recommended_next_steps: [
        "Provide an OTP / verification code at upload (Known Inputs panel)",
        "Or stay on the Live page to answer the human-input popup when it appears",
        "Re-run once login succeeds to get real findings",
      ],
      coverage_assessment: `Incomplete — only ${inAppScreens} unique in-app screens explored.`,
      coverage: {
        summary: coverageSummary,
        totalFlows: (flows || []).length,
        completedFlows: (flows || []).filter((f) => f.outcome === "completed").length,
      },
      crawl_health: crawlHealth || {},
      crawl_stats: crawlStats,
      analysis_suppressed: true,
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
