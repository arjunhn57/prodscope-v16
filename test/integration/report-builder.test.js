"use strict";

// ---------------------------------------------------------------------------
// Phase 7, Day 5 — report-builder hardening tests.
//
// These tests prove that the final report generator uses forced `tool_use`
// output and that the parsing path tolerates SDK oddities without falling
// back to the old raw-text mush.
// ---------------------------------------------------------------------------

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  buildReport,
  REPORT_TOOL,
  extractReportToolInput,
  extractReportFromText,
} = require("../../output/report-builder");

function baseParams(overrides = {}) {
  return {
    packageName: "com.example.test",
    coverageSummary: { home: { uniqueScreens: 4, status: "seen" } },
    deterministicFindings: [
      {
        type: "crash",
        severity: "critical",
        detail: "NPE in CheckoutActivity",
        step: 9,
        element: "CheckoutActivity",
      },
    ],
    aiAnalyses: [],
    flows: [{ feature: "checkout", outcome: "failed", steps: [{}, {}] }],
    crawlStats: { totalSteps: 15, uniqueStates: 13, stopReason: "budget" },
    opts: { goals: "general", painPoints: "" },
    crawlHealth: { emulatorRestarts: 0 },
    ...overrides,
  };
}

function mockClientReturningTool(toolInput, usage) {
  return {
    messages: {
      create: async () => ({
        content: [
          {
            type: "tool_use",
            name: REPORT_TOOL.name,
            input: toolInput,
          },
        ],
        usage: usage || { input_tokens: 1234, output_tokens: 567 },
      }),
    },
  };
}

function mockClientReturningText(text, usage) {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "text", text }],
        usage: usage || { input_tokens: 99, output_tokens: 11 },
      }),
    },
  };
}

describe("Report builder (Day 5 demo hardening)", () => {
  describe("REPORT_TOOL schema", () => {
    it("is a valid Anthropic tool definition", () => {
      assert.strictEqual(REPORT_TOOL.name, "emit_report");
      assert.strictEqual(typeof REPORT_TOOL.description, "string");
      assert.strictEqual(REPORT_TOOL.input_schema.type, "object");
      const required = REPORT_TOOL.input_schema.required;
      for (const key of [
        "overall_score",
        "summary",
        "critical_bugs",
        "ux_issues",
        "suggestions",
        "quick_wins",
        "recommended_next_steps",
        "coverage_assessment",
      ]) {
        assert.ok(required.includes(key), `schema should require ${key}`);
      }
    });
  });

  describe("extractReportToolInput()", () => {
    it("returns the input object when a matching tool_use block is present", () => {
      const input = { overall_score: 80, summary: "ok" };
      const result = extractReportToolInput({
        content: [{ type: "tool_use", name: REPORT_TOOL.name, input }],
      });
      assert.strictEqual(result, input);
    });

    it("ignores tool_use blocks from other tools", () => {
      const result = extractReportToolInput({
        content: [{ type: "tool_use", name: "something_else", input: {} }],
      });
      assert.strictEqual(result, null);
    });

    it("returns null for empty or malformed responses", () => {
      assert.strictEqual(extractReportToolInput(null), null);
      assert.strictEqual(extractReportToolInput({}), null);
      assert.strictEqual(extractReportToolInput({ content: "not-array" }), null);
    });
  });

  describe("extractReportFromText()", () => {
    it("parses fenced JSON from a text block", () => {
      const result = extractReportFromText({
        content: [
          {
            type: "text",
            text: '```json\n{"overall_score": 77, "summary": "hi"}\n```',
          },
        ],
      });
      assert.deepStrictEqual(result, { overall_score: 77, summary: "hi" });
    });

    it("returns null on malformed JSON rather than throwing", () => {
      const result = extractReportFromText({
        content: [{ type: "text", text: "not JSON at all" }],
      });
      assert.strictEqual(result, null);
    });
  });

  describe("buildReport()", () => {
    it("consumes tool_use output and enriches with crawl metadata", async () => {
      const toolInput = {
        overall_score: 72,
        summary: "Solid foundation; checkout is the weak point.",
        critical_bugs: [
          { title: "Crash in checkout", description: "NPE when tapping Place Order", severity: "critical" },
        ],
        ux_issues: [],
        suggestions: [],
        quick_wins: [],
        recommended_next_steps: ["Patch the NPE before shipping"],
        coverage_assessment: "Good breadth; onboarding fully covered.",
      };
      const client = mockClientReturningTool(toolInput);
      const { report, tokenUsage } = await buildReport({
        ...baseParams(),
        client,
      });

      assert.strictEqual(tokenUsage.input_tokens, 1234);
      assert.strictEqual(tokenUsage.output_tokens, 567);

      const parsed = JSON.parse(report);
      assert.strictEqual(parsed.overall_score, 72);
      assert.strictEqual(parsed.summary, toolInput.summary);
      assert.deepStrictEqual(parsed.recommended_next_steps, [
        "Patch the NPE before shipping",
      ]);
      // Enrichment from params:
      assert.strictEqual(parsed.crawl_stats.totalSteps, 15);
      assert.ok(parsed.coverage);
      assert.strictEqual(parsed.coverage.totalFlows, 1);
      assert.ok(Array.isArray(parsed.deterministic_findings));
      assert.strictEqual(parsed.deterministic_findings[0].type, "crash");
      assert.strictEqual(parsed.token_usage.input_tokens, 1234);
    });

    it("still parses a fenced-text fallback when the SDK returns text only", async () => {
      const toolShaped = JSON.stringify({
        overall_score: 55,
        summary: "Text-block fallback",
        critical_bugs: [],
        ux_issues: [],
        suggestions: [],
        quick_wins: [],
        recommended_next_steps: [],
        coverage_assessment: "ok",
      });
      const client = mockClientReturningText("```json\n" + toolShaped + "\n```");
      const { report } = await buildReport({ ...baseParams(), client });

      const parsed = JSON.parse(report);
      assert.strictEqual(parsed.overall_score, 55);
      assert.strictEqual(parsed.summary, "Text-block fallback");
    });

    it("emits a deterministic-only catastrophic fallback when the API throws", async () => {
      const client = {
        messages: {
          create: async () => {
            throw new Error("Anthropic 500");
          },
        },
      };

      const { report, tokenUsage } = await buildReport({
        ...baseParams(),
        client,
      });

      assert.strictEqual(tokenUsage.input_tokens, 0);
      assert.strictEqual(tokenUsage.output_tokens, 0);

      const parsed = JSON.parse(report);
      assert.strictEqual(parsed.overall_score, 0);
      assert.ok(parsed.ai_analysis_failed, "fallback flag should be set");
      // Deterministic findings are still surfaced
      assert.strictEqual(parsed.critical_bugs.length, 1);
      assert.strictEqual(parsed.critical_bugs[0].title, "crash");
      // Shape stays schema-compatible
      assert.ok(Array.isArray(parsed.suggestions));
      assert.ok(Array.isArray(parsed.quick_wins));
      assert.ok(Array.isArray(parsed.recommended_next_steps));
      assert.strictEqual(typeof parsed.coverage_assessment, "string");
    });

    it("falls back when the model returns neither tool_use nor parseable text", async () => {
      const client = mockClientReturningText("this is not JSON and has no fence");
      const { report } = await buildReport({ ...baseParams(), client });

      const parsed = JSON.parse(report);
      // Goes through the catastrophic fallback path because extractors return null.
      assert.ok(parsed.ai_analysis_failed);
      assert.ok(parsed.summary.startsWith("Report generation failed"));
    });
  });
});
