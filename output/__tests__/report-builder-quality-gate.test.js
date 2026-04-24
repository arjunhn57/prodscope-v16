"use strict";

/**
 * report-builder-quality-gate.test.js — Phase 3.2 report-quality gate.
 *
 * Even when Phase 1 suppression passes (enough screens crawled, enough
 * AI coverage), we shouldn't publish `critical_bugs` unless the crawl
 * actually got deep enough to have meaningful evidence. Two conditions
 * must BOTH be true to publish bugs:
 *
 *   1. crawlStats.uniqueStates >= 10
 *   2. crawlHealth.crossedFirstDecisionBoundary === true
 *
 * Otherwise the report is rendered in "coverage-only" mode:
 *   - critical_bugs: []
 *   - critical_bugs_suppressed: true
 *   - critical_bugs_suppression_reason: "<thin_coverage | no_boundary>"
 *   - ux_issues, accessibility, suggestions still surfaced (real signal)
 *   - recommended_next_steps: retry guidance
 *
 * This gate is separate from Phase 1 suppression:
 *   Phase 1:  don't pay Sonnet — return suppressed envelope
 *   Phase 3.2: critical_bugs specifically gated — other findings stay
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReport } = require("../report-builder");

function makeClient() {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (args) => {
        calls.push(args);
        return {
          content: [
            {
              type: "tool_use",
              name: "emit_report",
              input: {
                overall_score: 7,
                summary: "sonnet summary",
                critical_bugs: [
                  { title: "sonnet-invented bug", severity: "high" },
                ],
                ux_issues: [],
                suggestions: [],
                quick_wins: [],
                recommended_next_steps: [],
                coverage_assessment: "ok",
              },
            },
          ],
          usage: { input_tokens: 3000, output_tokens: 2500 },
        };
      },
    },
  };
}

function makeAnalysis(step, critical_bugs = [], ux_issues = []) {
  return {
    step,
    screenType: "feed",
    feature: "browsing",
    critical_bugs,
    bugs: critical_bugs,
    ux_issues,
    suggestions: [],
    accessibility: [],
    tokenUsage: { input_tokens: 800, output_tokens: 300 },
  };
}

const aBug = (title, confidence = 0.9) => ({ title, severity: "high", confidence });
const aUx = (title) => ({ title, severity: "medium", confidence: 0.7 });

const HEALTHY_HEALTH = {
  stopReason: "max_steps_reached",
  aiScreensAnalyzed: 10,
  uniqueStates: 20,
  crossedFirstDecisionBoundary: true,
};

// ── gate fires on insufficient coverage ───────────────────────────────────

test("quality gate: < 10 unique screens → critical_bugs suppressed", async () => {
  const client = makeClient();
  const aiAnalyses = [
    makeAnalysis(1, [aBug("A"), aBug("B"), aBug("C"), aBug("D")]),
  ];
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: { uniqueStates: 7 },
    opts: {},
    crawlHealth: {
      stopReason: "max_steps_reached",
      aiScreensAnalyzed: 5,
      crossedFirstDecisionBoundary: true,
    },
    client,
  });

  assert.equal(client.calls.length, 0, "Sonnet must not be called when bug publication is gated");
  const report = JSON.parse(result.report);
  assert.equal(report.critical_bugs_suppressed, true);
  assert.match(report.critical_bugs_suppression_reason, /thin_coverage|below|7/);
  assert.deepEqual(report.critical_bugs, []);
});

test("quality gate: crossedFirstDecisionBoundary=false → critical_bugs suppressed", async () => {
  const client = makeClient();
  const aiAnalyses = [
    makeAnalysis(1, [aBug("A"), aBug("B"), aBug("C"), aBug("D")]),
  ];
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: { uniqueStates: 20 },
    opts: {},
    crawlHealth: {
      stopReason: "max_steps_reached",
      aiScreensAnalyzed: 10,
      crossedFirstDecisionBoundary: false,
    },
    client,
  });

  assert.equal(client.calls.length, 0);
  const report = JSON.parse(result.report);
  assert.equal(report.critical_bugs_suppressed, true);
  assert.match(report.critical_bugs_suppression_reason, /boundary|decision/);
  assert.deepEqual(report.critical_bugs, []);
});

test("quality gate: both conditions must pass; either failing gates bugs", async () => {
  const client = makeClient();
  const aiAnalyses = [makeAnalysis(1, [aBug("A"), aBug("B"), aBug("C"), aBug("D")])];

  // Fail both
  const r1 = await buildReport({
    packageName: "x",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: { uniqueStates: 5 },
    opts: {},
    crawlHealth: { stopReason: "ok", aiScreensAnalyzed: 5, crossedFirstDecisionBoundary: false },
    client,
  });
  assert.equal(JSON.parse(r1.report).critical_bugs_suppressed, true);
});

// ── ux_issues, suggestions, accessibility still surface ───────────────────

test("quality gate: ux_issues and suggestions are preserved even when bugs suppressed", async () => {
  const client = makeClient();
  const aiAnalyses = [
    makeAnalysis(1, [aBug("A"), aBug("B"), aBug("C")], [aUx("Low contrast"), aUx("Small tap targets")]),
  ];
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: { uniqueStates: 8 }, // fails gate
    opts: {},
    crawlHealth: {
      stopReason: "max_steps_reached",
      aiScreensAnalyzed: 5,
      crossedFirstDecisionBoundary: true,
    },
    client,
  });

  const report = JSON.parse(result.report);
  assert.equal(report.critical_bugs_suppressed, true);
  assert.deepEqual(report.critical_bugs, []);
  // UX findings were real Stage 2 output — keep them
  assert.ok(report.ux_issues.length >= 2);
  assert.match(JSON.stringify(report.ux_issues), /Low contrast/);
});

test("quality gate: recommended_next_steps guides the user to re-run", async () => {
  const client = makeClient();
  const aiAnalyses = [makeAnalysis(1, [aBug("A"), aBug("B"), aBug("C")])];
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: { uniqueStates: 8 },
    opts: {},
    crawlHealth: {
      stopReason: "max_steps_reached",
      aiScreensAnalyzed: 5,
      crossedFirstDecisionBoundary: true,
    },
    client,
  });

  const report = JSON.parse(result.report);
  assert.ok(Array.isArray(report.recommended_next_steps));
  assert.ok(report.recommended_next_steps.length >= 1);
  assert.match(
    report.recommended_next_steps.join(" "),
    /re-?run|increase|budget|step/i,
    "should suggest a retry or budget increase",
  );
});

// ── gate passes — full report renders ─────────────────────────────────────

test("quality gate: >= 10 screens AND boundary crossed → full Sonnet / Stage 3 path", async () => {
  const client = makeClient();
  const aiAnalyses = [
    makeAnalysis(1, [aBug("A", 0.5)]), // low confidence, so Stage 3 won't skip Sonnet
  ];
  await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: { uniqueStates: 15 },
    opts: {},
    crawlHealth: {
      stopReason: "max_steps_reached",
      aiScreensAnalyzed: 8,
      crossedFirstDecisionBoundary: true,
    },
    client,
  });

  assert.equal(client.calls.length, 1, "Sonnet fires when both gate conditions pass");
});

test("quality gate: missing crossedFirstDecisionBoundary is NOT treated as false", async () => {
  const client = makeClient();
  const aiAnalyses = [makeAnalysis(1, [aBug("A", 0.5)])];

  // Legacy runners (pre-3.2) don't set crossedFirstDecisionBoundary.
  // We must NOT regress them — if the field is absent, default to true
  // so the gate only fires on explicit false signals.
  await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: { uniqueStates: 15 },
    opts: {},
    crawlHealth: {
      stopReason: "max_steps_reached",
      aiScreensAnalyzed: 8,
      // crossedFirstDecisionBoundary: undefined
    },
    client,
  });

  assert.equal(client.calls.length, 1, "Sonnet still fires when the field isn't provided");
});

// ── priority ordering ──────────────────────────────────────────────────────

test("quality gate: Phase 1 blocked_by_auth suppression wins over Phase 3.2", async () => {
  const client = makeClient();
  const aiAnalyses = [makeAnalysis(1, [aBug("A"), aBug("B")])];

  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: { uniqueStates: 8 },
    opts: {},
    crawlHealth: {
      stopReason: "blocked_by_auth:otp_required",
      aiScreensAnalyzed: 1,
      crossedFirstDecisionBoundary: false,
    },
    client,
  });

  assert.equal(client.calls.length, 0);
  const report = JSON.parse(result.report);
  assert.equal(report.analysis_suppressed, true, "Phase 1 analysis_suppressed is the outermost gate");
  assert.equal(report.suppression_trigger, "blocked_by_auth");
  // critical_bugs_suppressed isn't set — analysis_suppressed subsumes it
});

test("quality gate: Stage 3 high-signal route still respects the quality gate", async () => {
  const client = makeClient();
  // 3 high-confidence bugs — would normally trigger Stage 3 deterministic route
  const aiAnalyses = [
    makeAnalysis(1, [{ title: "A", severity: "high", confidence: 0.9 }, { title: "B", severity: "high", confidence: 0.9 }, { title: "C", severity: "high", confidence: 0.9 }]),
  ];
  // But coverage is thin (< 10 screens) — gate must suppress bugs anyway
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: { uniqueStates: 6 },
    opts: {},
    crawlHealth: {
      stopReason: "max_steps_reached",
      aiScreensAnalyzed: 4,
      crossedFirstDecisionBoundary: true,
    },
    client,
  });

  assert.equal(client.calls.length, 0, "Stage 3 templated path — Sonnet not called");
  const report = JSON.parse(result.report);
  assert.equal(report.critical_bugs_suppressed, true);
  assert.deepEqual(report.critical_bugs, []);
});
