"use strict";

/**
 * ai-oracle.test.js — Phase 3.1 Stage 2 deepCheck tests.
 *
 * Before 3.1, deepCheck parsed free-form JSON from the model and silently
 * wrapped parse failures as a fake "AI analysis failed" ux_issue. That was
 * a data-quality bug masquerading as a graceful fallback. These tests pin
 * the new contract:
 *
 *   1. deepCheck uses tool_use with tool_choice, so the model can only
 *      return a schema-valid response.
 *   2. Each finding carries a confidence field (0.0-1.0) used by Stage 3
 *      routing to decide Sonnet skip.
 *   3. Any SDK error or malformed response yields empty arrays — never a
 *      fabricated ux_issue with the error message leaking as content.
 *   4. Token usage is always reported.
 *   5. The returned `bugs` field stays for backwards compatibility with
 *      brain/context-builder.js; `critical_bugs` is the new canonical field.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { deepCheck, analyzeTriagedScreens } = require("../ai-oracle");

// ── fixtures ───────────────────────────────────────────────────────────────

function makeTempScreenshot() {
  const p = path.join(os.tmpdir(), `oracle-test-${Date.now()}-${Math.random()}.png`);
  // Minimal PNG header + IEND so fs.existsSync + toString("base64") both work.
  const minimalPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND chunk
    0xae, 0x42, 0x60, 0x82,
  ]);
  fs.writeFileSync(p, minimalPng);
  return p;
}

function makeScreen(overrides = {}) {
  return {
    step: 3,
    path: makeTempScreenshot(),
    screenType: "feed",
    feature: "browsing",
    xml: `<hierarchy><node text="Login"/></hierarchy>`,
    activity: "com.example/.MainActivity",
    ...overrides,
  };
}

function makeToolUseResponse({ input, inputTokens = 100, outputTokens = 50 } = {}) {
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name: "emit_screen_analysis",
        input,
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

// ── happy path — tool_use round-trip ───────────────────────────────────────

test("deepCheck — returns structured findings from a tool_use response", async () => {
  const screen = makeScreen();
  const response = makeToolUseResponse({
    input: {
      critical_bugs: [
        { title: "Login button unresponsive", evidence: "Button with text 'Login' did not transition", severity: "high", confidence: 0.9 },
      ],
      ux_issues: [
        { title: "Cramped tap targets", severity: "medium", confidence: 0.7 },
      ],
      accessibility: [],
      suggestions: [{ title: "Increase contrast on CTA", effort: "low" }],
    },
  });
  const client = mockClient({ response });

  const result = await deepCheck(screen, { appCategory: "social" }, { client });

  assert.equal(result.critical_bugs.length, 1);
  assert.equal(result.critical_bugs[0].confidence, 0.9);
  // Legacy `bugs` alias must still populate for brain/context-builder.js:87
  assert.equal(result.bugs.length, 1);
  assert.equal(result.ux_issues.length, 1);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.tokenUsage.input_tokens, 100);
  assert.equal(result.tokenUsage.output_tokens, 50);

  try { fs.unlinkSync(screen.path); } catch (_) {}
});

test("deepCheck — request to SDK uses tool_choice to force schema-valid output", async () => {
  const screen = makeScreen();
  const response = makeToolUseResponse({
    input: { critical_bugs: [], ux_issues: [], accessibility: [], suggestions: [] },
  });
  const client = mockClient({ response });

  await deepCheck(screen, { appCategory: "social" }, { client });

  const call = mockClient.lastCall;
  assert.ok(call, "SDK was called");
  assert.ok(Array.isArray(call.tools), "tools array is present");
  assert.equal(call.tools[0].name, "emit_screen_analysis");
  assert.equal(call.tool_choice.type, "tool");
  assert.equal(call.tool_choice.name, "emit_screen_analysis");
  // Input schema must require the four top-level fields so malformed
  // tool_use from the model will be rejected at SDK level.
  const required = call.tools[0].input_schema.required || [];
  assert.ok(required.includes("critical_bugs"));
  assert.ok(required.includes("ux_issues"));

  try { fs.unlinkSync(screen.path); } catch (_) {}
});

// ── error paths — must NEVER fabricate a ux_issue containing the error ───

test("deepCheck — SDK throw returns empty arrays, no error-as-ux_issue leak", async () => {
  const screen = makeScreen();
  const client = mockClient({ throwError: new Error("network unreachable") });

  const result = await deepCheck(screen, { appCategory: "social" }, { client });

  assert.deepEqual(result.critical_bugs, []);
  assert.deepEqual(result.bugs, []);
  assert.deepEqual(result.ux_issues, []);
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(result.accessibility, []);
  // This is the core contract: the error message must NOT leak into
  // user-facing issues (regression from the pre-3.1 fallback behavior).
  for (const bucket of ["critical_bugs", "ux_issues", "suggestions", "accessibility"]) {
    for (const f of result[bucket] || []) {
      assert.ok(
        !JSON.stringify(f).includes("network unreachable"),
        `error text must not leak into ${bucket}: ${JSON.stringify(f)}`,
      );
    }
  }

  try { fs.unlinkSync(screen.path); } catch (_) {}
});

test("deepCheck — response without tool_use block returns empty arrays", async () => {
  const screen = makeScreen();
  const response = {
    content: [{ type: "text", text: "Sorry, I cannot analyze this." }],
    usage: { input_tokens: 50, output_tokens: 10 },
    stop_reason: "end_turn",
  };
  const client = mockClient({ response });

  const result = await deepCheck(screen, { appCategory: "social" }, { client });

  assert.deepEqual(result.critical_bugs, []);
  assert.deepEqual(result.ux_issues, []);
  assert.equal(result.tokenUsage.input_tokens, 50);

  try { fs.unlinkSync(screen.path); } catch (_) {}
});

test("deepCheck — tool_use with partial/invalid shape still returns safe arrays", async () => {
  const screen = makeScreen();
  // Model returned something odd — nested strings where arrays should be.
  const response = makeToolUseResponse({
    input: { critical_bugs: "not an array", ux_issues: null },
  });
  const client = mockClient({ response });

  const result = await deepCheck(screen, { appCategory: "social" }, { client });

  assert.ok(Array.isArray(result.critical_bugs));
  assert.ok(Array.isArray(result.ux_issues));
  assert.ok(Array.isArray(result.suggestions));
  assert.ok(Array.isArray(result.accessibility));

  try { fs.unlinkSync(screen.path); } catch (_) {}
});

test("deepCheck — missing screenshot path returns empty fallback quickly", async () => {
  const client = mockClient({ throwError: new Error("should not be reached") });
  const result = await deepCheck(
    { path: "/nonexistent/path.png", xml: "" },
    { appCategory: "social" },
    { client },
  );
  assert.deepEqual(result.critical_bugs, []);
  assert.deepEqual(result.ux_issues, []);
});

// ── aggregation ────────────────────────────────────────────────────────────

test("analyzeTriagedScreens — aggregates per-screen tokens across the batch", async () => {
  const screens = [makeScreen({ step: 1 }), makeScreen({ step: 2 })];
  let call = 0;
  const client = {
    messages: {
      create: async () => {
        call++;
        return makeToolUseResponse({
          input: { critical_bugs: [], ux_issues: [], accessibility: [], suggestions: [] },
          inputTokens: 100 * call,
          outputTokens: 30 * call,
        });
      },
    },
  };

  const out = await analyzeTriagedScreens(screens, { appCategory: "social" }, { client });

  assert.equal(out.analyses.length, 2);
  // 100 + 200 = 300, 30 + 60 = 90
  assert.equal(out.totalTokens.input_tokens, 300);
  assert.equal(out.totalTokens.output_tokens, 90);

  for (const s of screens) { try { fs.unlinkSync(s.path); } catch (_) {} }
});

test("analyzeTriagedScreens — one screen failure does not poison the batch", async () => {
  const screens = [makeScreen({ step: 1 }), makeScreen({ step: 2 })];
  let call = 0;
  const client = {
    messages: {
      create: async () => {
        call++;
        if (call === 1) throw new Error("temporary API error");
        return makeToolUseResponse({
          input: {
            critical_bugs: [{ title: "Good finding", confidence: 0.9 }],
            ux_issues: [],
            accessibility: [],
            suggestions: [],
          },
        });
      },
    },
  };

  const out = await analyzeTriagedScreens(screens, { appCategory: "social" }, { client });

  assert.equal(out.analyses.length, 2);
  // First screen's findings should be empty (error swallowed)
  assert.deepEqual(out.analyses[0].critical_bugs, []);
  // Second should carry through
  assert.equal(out.analyses[1].critical_bugs.length, 1);
  assert.equal(out.analyses[1].critical_bugs[0].title, "Good finding");

  for (const s of screens) { try { fs.unlinkSync(s.path); } catch (_) {} }
});
