"use strict";

// Guards buildReport() against hallucinating P0 bugs on short / auth-blocked
// crawls. When uniqueStates < 5 and stopReason indicates the crawl never
// reached in-app screens, we must return a suppressed-analysis envelope
// without calling Sonnet at all.

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReport } = require("../report-builder");

function makeFakeClient() {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (args) => {
        calls.push(args);
        // Minimal valid tool_use response so the non-guarded path still works.
        return {
          content: [
            {
              type: "tool_use",
              name: "emit_report",
              input: {
                overall_score: 7,
                summary: "test",
                critical_bugs: [],
                ux_issues: [],
                suggestions: [],
                quick_wins: [],
                recommended_next_steps: [],
                coverage_assessment: "ok",
              },
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    },
  };
}

test("guard: suppresses analysis when stopReason=blocked_by_auth (regardless of screen count)", async () => {
  const client = makeFakeClient();
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses: [],
    flows: [],
    crawlStats: { uniqueStates: 42 }, // lots of screens — but blocked
    opts: {},
    crawlHealth: { stopReason: "blocked_by_auth" },
    client,
  });

  assert.equal(client.calls.length, 0, "Sonnet must NOT be called when blocked");
  const report = JSON.parse(result.report);
  assert.equal(report.analysis_suppressed, true);
  assert.equal(report.overall_score, null);
  assert.ok(Array.isArray(report.critical_bugs) && report.critical_bugs.length === 0);
  assert.equal(result.tokenUsage.input_tokens, 0);
  assert.equal(result.tokenUsage.output_tokens, 0);
});

test("guard: suppresses analysis when budget_exhausted with < 5 in-app screens", async () => {
  const client = makeFakeClient();
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses: [],
    flows: [],
    crawlStats: { uniqueStates: 3 },
    opts: {},
    crawlHealth: { stopReason: "budget_exhausted" },
    client,
  });

  assert.equal(client.calls.length, 0, "Sonnet must NOT be called on short crawl");
  const report = JSON.parse(result.report);
  assert.equal(report.analysis_suppressed, true);
  assert.equal(report.overall_score, null);
});

test("guard: allows normal analysis when budget_exhausted with >= 5 in-app screens", async () => {
  const client = makeFakeClient();
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses: [],
    flows: [],
    crawlStats: { uniqueStates: 19 },
    opts: {},
    crawlHealth: { stopReason: "budget_exhausted" },
    client,
  });

  assert.equal(client.calls.length, 1, "Sonnet should be called when crawl was meaningful");
  const report = JSON.parse(result.report);
  assert.notEqual(report.analysis_suppressed, true);
  assert.equal(report.overall_score, 7);
});

test("guard: allows normal analysis when stopReason is a healthy completion", async () => {
  const client = makeFakeClient();
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses: [],
    flows: [],
    crawlStats: { uniqueStates: 15 },
    opts: {},
    crawlHealth: { stopReason: "target_reached" },
    client,
  });

  assert.equal(client.calls.length, 1, "Sonnet should be called on healthy completion");
  const report = JSON.parse(result.report);
  assert.notEqual(report.analysis_suppressed, true);
});

test("guard: reads stopReason from crawlStats when crawlHealth missing", async () => {
  const client = makeFakeClient();
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses: [],
    flows: [],
    crawlStats: { uniqueStates: 2, stopReason: "blocked_by_auth" },
    opts: {},
    crawlHealth: {},
    client,
  });

  assert.equal(client.calls.length, 0);
  const report = JSON.parse(result.report);
  assert.equal(report.analysis_suppressed, true);
});

test("guard: suppresses on agent_done:blocked_by_auth:* compound stopReason", async () => {
  const client = makeFakeClient();
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses: [],
    flows: [],
    crawlStats: { uniqueStates: 7 }, // above the 5-screen threshold
    opts: {},
    crawlHealth: { stopReason: "agent_done:blocked_by_auth:fp_revisit_loop" },
    client,
  });

  assert.equal(client.calls.length, 0, "Sonnet must NOT be called on fp-revisit auth exit");
  const report = JSON.parse(result.report);
  assert.equal(report.analysis_suppressed, true);
});

test("guard: suppresses when AI oracle analyzed fewer than 3 screens (absolute floor)", async () => {
  // Real case from job 3631ab85 — 26 unique screens crawled but only 2 fed to
  // Sonnet, which then hallucinated "app stuck on loading screen".
  const client = makeFakeClient();
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses: [],
    flows: [],
    crawlStats: { uniqueStates: 26 },
    opts: {},
    crawlHealth: {
      stopReason: "agent_done:press_back_blocked",
      aiScreensAnalyzed: 2,
      aiScreensSkipped: 24,
    },
    client,
  });

  assert.equal(client.calls.length, 0, "Sonnet must NOT be called on thin AI coverage");
  const report = JSON.parse(result.report);
  assert.equal(report.analysis_suppressed, true);
  assert.equal(report.suppression_trigger, "thin_ai_coverage");
  assert.match(report.summary, /2 of 26/);
});

test("guard: suppresses when AI oracle ratio < 20% of unique screens", async () => {
  const client = makeFakeClient();
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses: [],
    flows: [],
    crawlStats: { uniqueStates: 50 },
    opts: {},
    crawlHealth: {
      stopReason: "target_reached",
      aiScreensAnalyzed: 5, // 10% — above absolute floor, below ratio floor
    },
    client,
  });

  assert.equal(client.calls.length, 0, "Sonnet must NOT be called when < 20% of screens triaged");
  const report = JSON.parse(result.report);
  assert.equal(report.analysis_suppressed, true);
  assert.equal(report.suppression_trigger, "thin_ai_coverage");
});

test("guard: allows Sonnet when aiScreensAnalyzed is healthy", async () => {
  const client = makeFakeClient();
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses: [],
    flows: [],
    crawlStats: { uniqueStates: 20 },
    opts: {},
    crawlHealth: {
      stopReason: "target_reached",
      aiScreensAnalyzed: 8, // 40% — above both floors
    },
    client,
  });

  assert.equal(client.calls.length, 1, "Sonnet should be called when AI coverage is adequate");
  const report = JSON.parse(result.report);
  assert.notEqual(report.analysis_suppressed, true);
});

test("guard: does NOT suppress when aiScreensAnalyzed is not reported at all", async () => {
  // Back-compat: legacy callers / test fixtures that don't thread the field
  // should continue to hit the Sonnet path. Thin-AI-coverage check is opt-in.
  const client = makeFakeClient();
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses: [],
    flows: [],
    crawlStats: { uniqueStates: 12 },
    opts: {},
    crawlHealth: { stopReason: "target_reached" }, // no aiScreensAnalyzed field
    client,
  });

  assert.equal(client.calls.length, 1, "missing aiScreensAnalyzed should not trigger suppression");
});
