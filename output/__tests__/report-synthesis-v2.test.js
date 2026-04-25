"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  synthesizeReportV2,
  tagScreensWithIds,
  buildScreenIdIndex,
  reshapeStage2,
  extractToolInput,
} = require("../report-synthesis-v2");

// ── Pure helpers ───────────────────────────────────────────────────────

test("tagScreensWithIds: drops screens missing step + assigns stable screen_<step> ids", () => {
  const tagged = tagScreensWithIds([
    { step: 1, screenType: "auth" },
    { screenType: "feed" }, // no step — dropped
    { step: 14, screenType: "feed", feature: "home" },
  ]);
  assert.equal(tagged.length, 2);
  assert.equal(tagged[0].id, "screen_1");
  assert.equal(tagged[1].id, "screen_14");
  assert.equal(tagged[1].feature, "home");
});

test("buildScreenIdIndex: produces a lookup set + byId map", () => {
  const idx = buildScreenIdIndex([
    { id: "screen_1", step: 1, screenType: "auth" },
    { id: "screen_2", step: 2, screenType: "feed" },
  ]);
  assert.equal(idx.ids.length, 2);
  assert.ok(idx.set.has("screen_1"));
  assert.equal(idx.byId["screen_2"].screenType, "feed");
});

test("reshapeStage2: groups Stage 2 findings by screen id, preserving evidence", () => {
  const reshaped = reshapeStage2([
    {
      step: 5,
      critical_bugs: [{ title: "Crash on tap", evidence: "Long-press menu does not appear", confidence: 0.9, severity: "critical" }],
      ux_issues: [{ title: "Tiny tap target", evidence: "Login button is 32dp", severity: "high", confidence: 0.85 }],
    },
    {
      step: 12,
      accessibility: [{ title: "Missing label", evidence: "Submit button has no contentDescription", severity: "medium" }],
    },
    // No findings — should be filtered out
    { step: 99 },
  ]);
  assert.equal(reshaped.length, 2);
  assert.equal(reshaped[0].screenId, "screen_5");
  assert.equal(reshaped[0].findings.length, 2);
  assert.equal(reshaped[0].findings[0].kind, "bug");
  assert.equal(reshaped[1].findings[0].kind, "a11y");
});

test("extractToolInput: returns null when no matching tool block", () => {
  assert.equal(extractToolInput(null), null);
  assert.equal(extractToolInput({ content: [] }), null);
  assert.equal(
    extractToolInput({ content: [{ type: "text", text: "hello" }] }),
    null,
  );
  // Wrong tool name
  assert.equal(
    extractToolInput({
      content: [{ type: "tool_use", name: "different_tool", input: { x: 1 } }],
    }),
    null,
  );
});

test("extractToolInput: returns input when emit_report_v2 block present", () => {
  const r = extractToolInput({
    content: [
      { type: "text", text: "ignored" },
      { type: "tool_use", name: "emit_report_v2", input: { verdict: { claims: [] } } },
    ],
  });
  assert.deepEqual(r, { verdict: { claims: [] } });
});

// ── End-to-end: synthesizer with a mocked Anthropic client ────────────

function mockClient(toolInputToReturn) {
  return {
    messages: {
      create: async () => ({
        content: [
          {
            type: "tool_use",
            name: "emit_report_v2",
            input: toolInputToReturn,
          },
        ],
        usage: { input_tokens: 1000, output_tokens: 500 },
        stop_reason: "tool_use",
      }),
    },
  };
}

const fixtureScreens = [
  { step: 1, screenType: "auth", activity: ".LoginActivity" },
  { step: 4, screenType: "auth", activity: ".LoginActivity", feature: "auth" },
  { step: 9, screenType: "feed", activity: ".HomeActivity", feature: "home" },
  { step: 14, screenType: "settings", activity: ".SettingsActivity" },
];

const fixtureStage2 = [
  {
    step: 4,
    critical_bugs: [],
    ux_issues: [{ title: "OTP no paste", evidence: "screen_4 OTP input rejects paste", severity: "medium" }],
  },
];

function validReport() {
  return {
    verdict: {
      claims: [
        {
          claim: "The app gates feed browsing behind sign-in across screens 1-4 before any content loads.",
          confidence: "observed",
          evidence_screen_ids: ["screen_1", "screen_4"],
        },
        {
          claim: "Settings (screen_14) exposes a notification toggle but no in-app account-deletion path.",
          confidence: "observed",
          evidence_screen_ids: ["screen_14"],
        },
        {
          claim: "Home feed appears empty for unauthenticated users until login completes (screen_9).",
          confidence: "observed",
          evidence_screen_ids: ["screen_9"],
        },
      ],
    },
    diligence_flags: [
      {
        severity: "concern",
        claim: "Auth-required browsing on screen_1 and screen_4 likely depresses D1 retention versus competitors.",
        confidence: "inferred",
        evidence_screen_ids: ["screen_1", "screen_4"],
        severity_rationale: "Pre-account gating typically suppresses unauthenticated activation.",
        founder_question: "What's the D1 retention split between authenticated and unauthenticated cohorts?",
      },
      {
        severity: "watch_item",
        claim: "OTP input on screen_4 does not accept clipboard paste, friction for users on the same device.",
        confidence: "observed",
        evidence_screen_ids: ["screen_4"],
        founder_question: "Why disable paste on the OTP field — is this an anti-fraud measure or an oversight?",
      },
    ],
    critical_bugs: [],
    ux_issues: [
      {
        title: "OTP field rejects clipboard paste",
        claim: "screen_4 OTP input does not surface a paste affordance and ignores programmatic paste.",
        severity: "medium",
        confidence: "observed",
        evidence_screen_ids: ["screen_4"],
      },
    ],
    coverage_summary: {
      screens_reached: 14,
      screens_attempted_blocked: [
        { area: "post-auth feed", reason: "test credentials rejected at screen_4" },
      ],
      areas_not_attempted: ["paid features", "in-app messaging"],
    },
  };
}

test("synthesizeReportV2: happy path returns ok+report when model output is valid", async () => {
  const out = await synthesizeReportV2({
    packageName: "com.example.app",
    crawlStats: { totalSteps: 80, uniqueStates: 14, stopReason: "max_steps_reached" },
    screens: fixtureScreens,
    stage2Analyses: fixtureStage2,
    deterministicFindings: [],
    coverageSummary: {},
    flows: [],
    deps: { client: mockClient(validReport()) },
  });
  assert.equal(out.ok, true);
  assert.equal(out.report.verdict.claims.length, 3);
  assert.equal(out.report.diligence_flags.length, 2);
  assert.equal(out.tokenUsage.input_tokens, 1000);
});

test("synthesizeReportV2: rejects model output that cites unknown screen ids", async () => {
  const bad = validReport();
  bad.diligence_flags[0].evidence_screen_ids = ["screen_FAKE"]; // hallucinated
  const out = await synthesizeReportV2({
    packageName: "com.example.app",
    crawlStats: { totalSteps: 80, uniqueStates: 14, stopReason: "max_steps_reached" },
    screens: fixtureScreens,
    stage2Analyses: fixtureStage2,
    deterministicFindings: [],
    coverageSummary: {},
    flows: [],
    deps: { client: mockClient(bad) },
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes("screen_FAKE")));
});

test("synthesizeReportV2: rejects model output with claims missing evidence", async () => {
  const bad = validReport();
  bad.verdict.claims[0].evidence_screen_ids = []; // empty evidence
  const out = await synthesizeReportV2({
    packageName: "com.example.app",
    crawlStats: { totalSteps: 80, uniqueStates: 14, stopReason: "max_steps_reached" },
    screens: fixtureScreens,
    stage2Analyses: fixtureStage2,
    deterministicFindings: [],
    coverageSummary: {},
    flows: [],
    deps: { client: mockClient(bad) },
  });
  assert.equal(out.ok, false);
});

test("synthesizeReportV2: refuses to synthesize when no screens have step ids", async () => {
  const out = await synthesizeReportV2({
    packageName: "com.example.app",
    crawlStats: { totalSteps: 0, uniqueStates: 0, stopReason: "launch_failed" },
    screens: [], // empty
    stage2Analyses: [],
    deterministicFindings: [],
    coverageSummary: {},
    flows: [],
    deps: {
      client: {
        messages: {
          create: async () => {
            throw new Error("should not be called");
          },
        },
      },
    },
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes("no_screens_to_cite")));
});

test("synthesizeReportV2: surfaces SDK errors as structured failure", async () => {
  const out = await synthesizeReportV2({
    packageName: "com.example.app",
    crawlStats: { totalSteps: 80, uniqueStates: 14, stopReason: "max_steps_reached" },
    screens: fixtureScreens,
    stage2Analyses: fixtureStage2,
    deterministicFindings: [],
    coverageSummary: {},
    flows: [],
    deps: {
      client: {
        messages: {
          create: async () => {
            const e = new Error("rate_limit_exceeded");
            throw e;
          },
        },
      },
    },
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes("anthropic_sdk_failed")));
});

test("synthesizeReportV2: handles model not calling tool (returns text instead)", async () => {
  const out = await synthesizeReportV2({
    packageName: "com.example.app",
    crawlStats: { totalSteps: 80, uniqueStates: 14, stopReason: "max_steps_reached" },
    screens: fixtureScreens,
    stage2Analyses: fixtureStage2,
    deterministicFindings: [],
    coverageSummary: {},
    flows: [],
    deps: {
      client: {
        messages: {
          create: async () => ({
            content: [{ type: "text", text: "I cannot do that." }],
            usage: { input_tokens: 800, output_tokens: 50 },
            stop_reason: "end_turn",
          }),
        },
      },
    },
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes("model_did_not_call_tool")));
});
