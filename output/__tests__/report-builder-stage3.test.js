"use strict";

/**
 * report-builder-stage3.test.js — Phase 3.1 Stage 3 routing tests.
 *
 * Stage 3 sits between the Phase 1 suppression gate and the Sonnet
 * synthesis call. When Stage 2 has already produced >= 3 high-confidence
 * critical_bugs, Sonnet adds nothing but prose polish — so we render a
 * deterministic narrative from the schema and skip the $0.046 Sonnet
 * call entirely. When signals are mixed or thin (and Phase 1 suppression
 * didn't fire), Sonnet still synthesizes as before.
 *
 * Pinned contract:
 *   1. ≥ 3 critical_bugs with confidence >= SONNET_SKIP_CONFIDENCE_THRESHOLD
 *      → deterministic narrative, zero Sonnet calls, zero Sonnet tokens.
 *   2. Fewer than 3 high-confidence critical_bugs → Sonnet call, as today.
 *   3. Phase 1 suppression (blocked_by_auth, thin coverage) still wins —
 *      it's the outermost gate.
 *   4. ORACLE_STAGE1_ENABLED=false disables the Stage 3 router — Sonnet
 *      fires unconditionally (legacy behavior).
 *   5. Deterministic narrative preserves coverage_assessment, crawl_health,
 *      deterministic_findings so the downstream report consumers don't
 *      regress.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReport } = require("../report-builder");

function makeClient({ throwError } = {}) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (args) => {
        calls.push(args);
        if (throwError) throw throwError;
        return {
          content: [
            {
              type: "tool_use",
              name: "emit_report",
              input: {
                overall_score: 7,
                summary: "sonnet summary",
                critical_bugs: [],
                ux_issues: [],
                suggestions: [],
                quick_wins: [],
                recommended_next_steps: [],
                coverage_assessment: "sonnet assessment",
              },
            },
          ],
          usage: { input_tokens: 3000, output_tokens: 2500 },
        };
      },
    },
  };
}

function makeAnalysis(step, critical_bugs = [], ux_issues = [], suggestions = []) {
  return {
    step,
    screenType: "feed",
    feature: "browsing",
    critical_bugs,
    bugs: critical_bugs,
    ux_issues,
    suggestions,
    accessibility: [],
    tokenUsage: { input_tokens: 800, output_tokens: 300 },
  };
}

function bug(title, confidence, severity = "high") {
  return { title, severity, confidence, evidence: "test" };
}

function ux(title, confidence, severity = "medium") {
  return { title, severity, confidence };
}

const HEALTHY_STATS = { uniqueStates: 20, totalSteps: 30 };
const HEALTHY_HEALTH = { stopReason: "max_steps_reached", aiScreensAnalyzed: 10, uniqueStates: 20 };

// ── high-signal → deterministic narrative, no Sonnet ──────────────────────

test("stage 3: ≥3 high-confidence critical_bugs → deterministic route, Sonnet skipped", async () => {
  const client = makeClient();
  const aiAnalyses = [
    makeAnalysis(1, [bug("Login button unresponsive", 0.9), bug("Password field accepts >256 chars", 0.85)]),
    makeAnalysis(2, [bug("Settings crashes on save", 0.95)]),
    makeAnalysis(3, [], [ux("Cramped tap targets", 0.7)]),
  ];
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: HEALTHY_STATS,
    opts: {},
    crawlHealth: HEALTHY_HEALTH,
    client,
  });

  assert.equal(client.calls.length, 0, "Sonnet must NOT be called when Haiku already has enough");
  const report = JSON.parse(result.report);
  assert.equal(report.analysis_suppressed, undefined, "Not suppression — this is a real report");
  assert.equal(report.report_synthesis_model, "template");
  assert.equal(report.critical_bugs.length, 3);
  assert.equal(result.tokenUsage.input_tokens, 0);
  assert.equal(result.tokenUsage.output_tokens, 0);
});

test("stage 3: deterministic narrative preserves coverage, crawl_health, deterministic_findings", async () => {
  const client = makeClient();
  const det = [{ type: "crash", severity: "critical", detail: "NPE at com.x", step: 5 }];
  const aiAnalyses = [
    makeAnalysis(1, [bug("A", 0.9), bug("B", 0.9), bug("C", 0.9)]),
  ];
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: { feed: { status: "exploring" } },
    deterministicFindings: det,
    aiAnalyses,
    flows: [{ outcome: "completed" }, { outcome: "skipped" }],
    crawlStats: HEALTHY_STATS,
    opts: {},
    crawlHealth: HEALTHY_HEALTH,
    client,
  });

  const report = JSON.parse(result.report);
  assert.ok(report.coverage);
  assert.equal(report.coverage.totalFlows, 2);
  assert.equal(report.coverage.completedFlows, 1);
  assert.equal(report.crawl_health.stopReason, "max_steps_reached");
  assert.equal(report.deterministic_findings.length, 1);
  assert.equal(report.deterministic_findings[0].type, "crash");
  assert.ok(report.overall_score !== null, "Overall score should be computed from signals");
  assert.ok(typeof report.summary === "string" && report.summary.length > 0);
});

test("stage 3: counts ONLY critical_bugs with confidence >= threshold", async () => {
  const client = makeClient();
  // 2 at 0.9, 1 at 0.5 — threshold is 0.8, so only 2 qualify → Sonnet fires
  const aiAnalyses = [
    makeAnalysis(1, [bug("A", 0.9), bug("B", 0.9), bug("C", 0.5)]),
  ];
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: HEALTHY_STATS,
    opts: {},
    crawlHealth: HEALTHY_HEALTH,
    client,
  });

  assert.equal(client.calls.length, 1, "Only 2 high-confidence bugs — Sonnet should still fire");
  const report = JSON.parse(result.report);
  assert.equal(report.report_synthesis_model, undefined); // Sonnet path doesn't set this
  assert.equal(report.overall_score, 7); // sonnet response
});

test("stage 3: bugs without a confidence field don't count as high-confidence", async () => {
  const client = makeClient();
  // 3 bugs but none have confidence — treat as unknown, NOT high-signal
  const aiAnalyses = [
    makeAnalysis(1, [
      { title: "A", severity: "high" },
      { title: "B", severity: "high" },
      { title: "C", severity: "high" },
    ]),
  ];
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: HEALTHY_STATS,
    opts: {},
    crawlHealth: HEALTHY_HEALTH,
    client,
  });

  assert.equal(client.calls.length, 1, "No confidence scores → can't trust, fall to Sonnet");
});

// ── mixed-signal / low-signal → Sonnet fires ──────────────────────────────

test("stage 3: zero critical_bugs → Sonnet synthesis (today's behavior)", async () => {
  const client = makeClient();
  const aiAnalyses = [makeAnalysis(1, [], [ux("Low contrast", 0.6)])];
  await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: HEALTHY_STATS,
    opts: {},
    crawlHealth: HEALTHY_HEALTH,
    client,
  });

  assert.equal(client.calls.length, 1, "Low-signal crawl still goes to Sonnet");
});

test("stage 3: feature flag — setting stage1Enabled=false disables deterministic route", async () => {
  const client = makeClient();
  const aiAnalyses = [
    makeAnalysis(1, [bug("A", 0.9), bug("B", 0.9), bug("C", 0.9)]),
  ];
  await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: HEALTHY_STATS,
    opts: {},
    crawlHealth: HEALTHY_HEALTH,
    client,
    stage1Enabled: false,
  });

  assert.equal(client.calls.length, 1, "Flag off → always Sonnet, even on high-signal");
});

// ── Phase 1 suppression still wins ────────────────────────────────────────

test("stage 3: Phase 1 thin-coverage suppression overrides high-signal Stage 3", async () => {
  const client = makeClient();
  const aiAnalyses = [
    makeAnalysis(1, [bug("A", 0.9), bug("B", 0.9), bug("C", 0.9)]),
  ];
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: { uniqueStates: 20 },
    opts: {},
    // aiScreensAnalyzed=1 < MIN_AI_SCREENS_ABSOLUTE(3) → Phase 1 suppression fires
    crawlHealth: { stopReason: "max_steps_reached", aiScreensAnalyzed: 1 },
    client,
  });

  assert.equal(client.calls.length, 0, "Suppression gate is outermost");
  const report = JSON.parse(result.report);
  assert.equal(report.analysis_suppressed, true);
  assert.equal(report.suppression_trigger, "thin_ai_coverage");
});

test("stage 3: Phase 1 blocked_by_auth suppression overrides high-signal Stage 3", async () => {
  const client = makeClient();
  const aiAnalyses = [
    makeAnalysis(1, [bug("A", 0.95), bug("B", 0.95), bug("C", 0.95)]),
  ];
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: { uniqueStates: 5 },
    opts: {},
    crawlHealth: { stopReason: "blocked_by_auth:otp_required" },
    client,
  });

  assert.equal(client.calls.length, 0, "Auth-blocked suppression still wins");
  const report = JSON.parse(result.report);
  assert.equal(report.analysis_suppressed, true);
});

// ── deterministic narrative content ───────────────────────────────────────

test("stage 3: deterministic narrative deduplicates identical critical_bug titles", async () => {
  const client = makeClient();
  const aiAnalyses = [
    makeAnalysis(1, [bug("Same bug across screens", 0.9)]),
    makeAnalysis(2, [bug("Same bug across screens", 0.9)]),
    makeAnalysis(3, [bug("Same bug across screens", 0.9)]),
    makeAnalysis(4, [bug("Different bug", 0.9)]),
  ];
  const result = await buildReport({
    packageName: "com.example.app",
    coverageSummary: {},
    deterministicFindings: [],
    aiAnalyses,
    flows: [],
    crawlStats: HEALTHY_STATS,
    opts: {},
    crawlHealth: HEALTHY_HEALTH,
    client,
  });

  const report = JSON.parse(result.report);
  assert.equal(report.report_synthesis_model, "template");
  // 4 bugs total but 2 unique after dedup
  assert.equal(report.critical_bugs.length, 2);
});
