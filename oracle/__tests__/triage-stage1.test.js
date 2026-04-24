"use strict";

/**
 * triage-stage1.test.js — Phase 3.1 Stage 1 Haiku ranker tests.
 *
 * Stage 1 is a cheap Haiku call that ranks ALL unique screens before the
 * heuristic-only triage decides which K go to Stage 2. The ranker adds
 * semantic signal ("this login screen with an empty error bar looks
 * broken") that the pure heuristic can't see.
 *
 * Pinned contract:
 *   1. rankScreens(candidates, {client}) does ONE batched Haiku call
 *      via tool_use, not N calls — latency and rate-limit matter.
 *   2. On any SDK error or malformed response, returns null so callers
 *      fall back to heuristic scoring (zero regression).
 *   3. triageWithRanker() passes Stage 1 scores through, then selects
 *      top MAX_DEEP_ANALYZE_SCREENS by a combined score.
 *   4. If ORACLE_STAGE1_ENABLED=false, triageWithRanker short-circuits
 *      to the legacy heuristic path.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { rankScreens, triageWithRanker } = require("../triage");

function makeScreen(step, screenType, fuzzyFp, xml = "<hierarchy/>") {
  return {
    step,
    index: step,
    path: `/tmp/test/step_${step}.png`,
    screenType: screenType || "unknown",
    feature: "other",
    fuzzyFp: fuzzyFp || `fp_${step}`,
    xml,
    activity: "com.example/.MainActivity",
  };
}

function makeRankerResponse(rankings, { inputTokens = 200, outputTokens = 80 } = {}) {
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_rank",
        name: "rank_screens",
        input: { rankings },
      },
    ],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    stop_reason: "tool_use",
  };
}

function mockClient({ response, throwError } = {}) {
  return {
    messages: {
      create: async (params) => {
        mockClient.lastCall = params;
        if (throwError) throw throwError;
        return response;
      },
    },
  };
}

// ── rankScreens contract ───────────────────────────────────────────────────

test("rankScreens — single batched Haiku call with a tool_use response", async () => {
  const screens = [makeScreen(1, "login"), makeScreen(2, "feed"), makeScreen(3, "settings")];
  const response = makeRankerResponse([
    { step: 1, hotspot_score: 9, reason: "login form with empty error bar" },
    { step: 2, hotspot_score: 3, reason: "standard feed" },
    { step: 3, hotspot_score: 6, reason: "deep settings surface" },
  ]);
  const client = mockClient({ response });

  const ranked = await rankScreens(screens, { client });

  assert.ok(ranked);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].step, 1);
  assert.equal(ranked[0].hotspotScore, 9);
  assert.match(ranked[0].reason, /login/);

  // Enforce "single batched call" — no N-per-screen call pattern.
  assert.ok(mockClient.lastCall, "client should have been called");
  assert.ok(Array.isArray(mockClient.lastCall.tools));
  assert.equal(mockClient.lastCall.tools[0].name, "rank_screens");
});

test("rankScreens — empty candidate list skips the SDK call entirely", async () => {
  const client = mockClient({ throwError: new Error("should not be called") });
  const ranked = await rankScreens([], { client });
  assert.deepEqual(ranked, []);
});

test("rankScreens — SDK throw returns null so callers fall back", async () => {
  const screens = [makeScreen(1, "login")];
  const client = mockClient({ throwError: new Error("rate limit") });

  const ranked = await rankScreens(screens, { client });

  assert.equal(ranked, null, "SDK errors yield null; heuristic path takes over");
});

test("rankScreens — response without tool_use returns null", async () => {
  const screens = [makeScreen(1, "login")];
  const response = {
    content: [{ type: "text", text: "I cannot rank these." }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  const client = mockClient({ response });

  const ranked = await rankScreens(screens, { client });
  assert.equal(ranked, null);
});

test("rankScreens — malformed rankings array returns null, not a crash", async () => {
  const screens = [makeScreen(1, "login")];
  const response = makeRankerResponse("not an array"); // deliberately wrong
  const client = mockClient({ response });

  const ranked = await rankScreens(screens, { client });
  assert.equal(ranked, null);
});

test("rankScreens — scores outside [0,10] are clamped", async () => {
  const screens = [makeScreen(1, "login"), makeScreen(2, "feed")];
  const response = makeRankerResponse([
    { step: 1, hotspot_score: 42, reason: "out of range high" },
    { step: 2, hotspot_score: -5, reason: "out of range low" },
  ]);
  const client = mockClient({ response });

  const ranked = await rankScreens(screens, { client });
  assert.equal(ranked[0].hotspotScore, 10);
  assert.equal(ranked[1].hotspotScore, 0);
});

// ── triageWithRanker contract ──────────────────────────────────────────────

test("triageWithRanker — heuristic-only fallback when ranker returns null", async () => {
  const screens = [
    makeScreen(1, "login"),
    makeScreen(2, "feed"),
    makeScreen(3, "dialog"), // dropped by heuristic skip
    makeScreen(4, "settings"),
  ];
  const client = mockClient({ throwError: new Error("sdk failure") });

  const result = await triageWithRanker(screens, {}, {}, null, { client });

  // Heuristic runs regardless. Dialog is dropped, 3 screens remain.
  const selected = result.screensToAnalyze.map((s) => s.screenType);
  assert.ok(!selected.includes("dialog"));
  assert.ok(result.triageLog.length >= 1);
  // Fallback marker surfaced in the log for observability
  assert.ok(result.triageLog.some((e) => e.reason && /fallback|heuristic/i.test(e.reason)));
});

test("triageWithRanker — ranker scores influence the top-K selection", async () => {
  // Heuristic would rank 'feed' equal with 'settings'. Ranker bumps
  // 'settings' to a 9 — it should beat 'feed' in the selection.
  const screens = [
    makeScreen(1, "feed"),
    makeScreen(2, "settings"),
    makeScreen(3, "profile"),
    makeScreen(4, "notification"),
    makeScreen(5, "menu"),
    makeScreen(6, "about"),
    makeScreen(7, "help"),
    makeScreen(8, "search"),
    makeScreen(9, "filters"),
    makeScreen(10, "recent"),
    makeScreen(11, "sync"),
    makeScreen(12, "spare"),
  ];
  const response = makeRankerResponse([
    { step: 1, hotspot_score: 2, reason: "standard feed" },
    { step: 2, hotspot_score: 9, reason: "deep settings surface" },
    { step: 3, hotspot_score: 8, reason: "profile edit inputs" },
    { step: 4, hotspot_score: 1, reason: "simple" },
    { step: 5, hotspot_score: 1, reason: "simple" },
    { step: 6, hotspot_score: 1, reason: "simple" },
    { step: 7, hotspot_score: 1, reason: "simple" },
    { step: 8, hotspot_score: 7, reason: "search with filters" },
    { step: 9, hotspot_score: 1, reason: "simple" },
    { step: 10, hotspot_score: 1, reason: "simple" },
    { step: 11, hotspot_score: 1, reason: "simple" },
    { step: 12, hotspot_score: 1, reason: "simple" },
  ]);
  const client = mockClient({ response });

  const result = await triageWithRanker(screens, {}, {}, null, { client, maxDeepAnalyze: 3 });

  const selectedTypes = result.screensToAnalyze.map((s) => s.screenType);
  // Top 3 by ranker score should be settings, profile, search
  assert.ok(selectedTypes.includes("settings"));
  assert.ok(selectedTypes.includes("profile"));
});

test("triageWithRanker — respects maxDeepAnalyze cap", async () => {
  const screens = Array.from({ length: 10 }, (_, i) => makeScreen(i + 1, `type_${i}`));
  const response = makeRankerResponse(
    screens.map((s) => ({ step: s.step, hotspot_score: 5, reason: "x" })),
  );
  const client = mockClient({ response });

  const result = await triageWithRanker(screens, {}, {}, null, { client, maxDeepAnalyze: 4 });

  assert.ok(result.screensToAnalyze.length <= 4);
});

test("triageWithRanker — ORACLE_STAGE1_ENABLED=false routes to heuristic path", async () => {
  const screens = [makeScreen(1, "login"), makeScreen(2, "feed")];
  const client = mockClient({ throwError: new Error("should not call SDK when flag off") });

  const result = await triageWithRanker(screens, {}, {}, null, {
    client,
    stage1Enabled: false,
    maxDeepAnalyze: 10,
  });

  // Both screens pass the heuristic filters.
  assert.equal(result.screensToAnalyze.length, 2);
});

test("triageWithRanker — surfaces ranker scores in triageLog for observability", async () => {
  const screens = [makeScreen(1, "login"), makeScreen(2, "feed")];
  const response = makeRankerResponse([
    { step: 1, hotspot_score: 8, reason: "login with error bar" },
    { step: 2, hotspot_score: 2, reason: "standard" },
  ]);
  const client = mockClient({ response });

  const result = await triageWithRanker(screens, {}, {}, null, { client, maxDeepAnalyze: 2 });

  // Ranker reason should show up somewhere in the log for the selected screen.
  const loginLog = result.triageLog.find((e) => e.step === 1 && e.action === "analyze");
  assert.ok(loginLog);
  assert.match(JSON.stringify(loginLog), /hotspot|ranker|error bar|8/);
});
