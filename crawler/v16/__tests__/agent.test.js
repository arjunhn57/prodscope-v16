"use strict";

/**
 * Phase-3 tests for crawler/v16/agent.js. No live API calls — an in-process
 * mock Anthropic client lets us assert:
 *   - messages.stream request shape (model, system cache_control, image gating)
 *   - JSON parsing (fenced + plain + malformed)
 *   - Sonnet escalation gated by budgetController.canEscalateToSonnet
 *   - Token accounting (cached vs uncached)
 *   - Safe fallback on invalid action
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  decideNextAction,
  parseModelJson,
  coerceDecision,
  shouldSendImage,
  splitUsage,
  buildRequest,
  HAIKU_MODEL,
  SONNET_MODEL,
} = require("../agent");

// ── fixture: write a tiny valid PNG once and reuse the path ──
const FIXTURE_PNG = path.join(os.tmpdir(), "v16-agent-test.png");
// 1×1 transparent PNG
const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63000100000005000100",
  "hex",
);
try {
  fs.writeFileSync(FIXTURE_PNG, TINY_PNG);
} catch (_) {}

function baseCtx(overrides) {
  const ctx = {
    observation: {
      screenshotPath: FIXTURE_PNG,
      xml: "<hierarchy/>",
      packageName: "com.a",
      activity: "com.a/.Main",
      fingerprint: "hash-A",
      timestampMs: 1,
    },
    fingerprintChanged: true,
    lastFeedback: "none",
    lastAction: null,
    historyTail: [],
    credentials: null,
    appContext: null,
    budget: {
      costUsd: 0,
      maxCostUsd: 0.12,
      sonnetEscalationsUsed: 0,
      maxSonnetEscalations: 3,
    },
    budgetController: { canEscalateToSonnet: () => true },
    uniqueScreens: 1,
    targetUniqueScreens: 25,
    step: 1,
    stepsRemaining: 79,
  };
  return Object.assign(ctx, overrides || {});
}

/**
 * Build a mock Anthropic client. `scripted` is an array of responses per
 * sequential call: {text, usage}. Each text is parsed as JSON and returned
 * as a tool_use block (matching the new tool-use flow). A text that fails
 * to parse is returned as a plain text block — the legacy JSON fallback
 * path in agent.js will try to parse it.
 */
function makeMockClient(scripted) {
  const calls = [];
  const remaining = scripted.slice();
  return {
    calls,
    messages: {
      create: async (body) => {
        calls.push(body);
        const next = remaining.shift();
        if (!next) throw new Error(`mock exhausted; ${calls.length} calls but ${scripted.length} scripted`);
        return makeMockMessage(next.text, next.usage);
      },
    },
  };
}

/**
 * Build an Anthropic message result from a scripted text. If the text parses
 * as JSON, we emit a tool_use block with that object as `input`. Otherwise
 * we emit a plain text block so the legacy fallback path is exercised.
 */
function makeMockMessage(text, usage) {
  let parsed = null;
  if (typeof text === "string") {
    let cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    try {
      parsed = JSON.parse(cleaned);
    } catch (_) {
      const first = cleaned.indexOf("{");
      const last = cleaned.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try {
          parsed = JSON.parse(cleaned.substring(first, last + 1));
        } catch (_) {}
      }
    }
  }
  const content = parsed && typeof parsed === "object"
    ? [{ type: "tool_use", name: "emit_action", id: "mock-id", input: parsed }]
    : [{ type: "text", text: String(text || "") }];
  return {
    content,
    usage: usage || { input_tokens: 0, output_tokens: 0 },
    stop_reason: parsed ? "tool_use" : "end_turn",
  };
}

// ─────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────

test("parseModelJson handles plain JSON", () => {
  const out = parseModelJson('{"reasoning":"r","action":{"type":"tap","x":1,"y":2}}');
  assert.equal(out.reasoning, "r");
  assert.equal(out.action.type, "tap");
});

test("parseModelJson strips markdown fences", () => {
  const out = parseModelJson('```json\n{"action":{"type":"press_back"}}\n```');
  assert.equal(out.action.type, "press_back");
});

test("parseModelJson extracts from prose + JSON", () => {
  const out = parseModelJson('Here is my choice: {"action":{"type":"press_home"}}');
  assert.equal(out.action.type, "press_home");
});

test("parseModelJson returns null on garbage", () => {
  assert.equal(parseModelJson("not json at all"), null);
  assert.equal(parseModelJson(""), null);
  assert.equal(parseModelJson(null), null);
});

test("coerceDecision returns fallback on null", () => {
  const d = coerceDecision(null);
  assert.equal(d.action.type, "press_back");
  assert.equal(d.escalate, false);
});

test("coerceDecision returns fallback on invalid action", () => {
  const d = coerceDecision({ action: { type: "shake" }, reasoning: "r" });
  assert.equal(d.action.type, "press_back");
  assert.ok(d.validationError);
});

test("coerceDecision preserves valid action + escalate flag", () => {
  const d = coerceDecision({
    action: { type: "tap", x: 10, y: 20 },
    reasoning: "tapping the button",
    expected_outcome: "see next screen",
    escalate: true,
  });
  assert.equal(d.action.type, "tap");
  assert.equal(d.reasoning, "tapping the button");
  assert.equal(d.expectedOutcome, "see next screen");
  assert.equal(d.escalate, true);
});

test("shouldSendImage true on step 1 regardless of fp", () => {
  const ctx = baseCtx({ step: 1, fingerprintChanged: false });
  assert.equal(shouldSendImage(ctx), true);
});

test("shouldSendImage true when fingerprint changed", () => {
  const ctx = baseCtx({ step: 5, fingerprintChanged: true });
  assert.equal(shouldSendImage(ctx), true);
});

test("shouldSendImage false when fp same and not step 1", () => {
  const ctx = baseCtx({ step: 5, fingerprintChanged: false, lastFeedback: "no_change" });
  assert.equal(shouldSendImage(ctx), false);
});

test("shouldSendImage true on app_crashed / left_app even if fp unchanged", () => {
  assert.equal(
    shouldSendImage(baseCtx({ step: 5, fingerprintChanged: false, lastFeedback: "app_crashed" })),
    true,
  );
  assert.equal(
    shouldSendImage(baseCtx({ step: 5, fingerprintChanged: false, lastFeedback: "left_app" })),
    true,
  );
});

test("shouldSendImage honors explicit ctx.sendImage=false even when fp changed", () => {
  const ctx = baseCtx({ step: 5, fingerprintChanged: true, sendImage: false });
  assert.equal(shouldSendImage(ctx), false);
});

test("shouldSendImage honors explicit ctx.sendImage=true even when fp unchanged", () => {
  const ctx = baseCtx({ step: 5, fingerprintChanged: false, sendImage: true });
  assert.equal(shouldSendImage(ctx), true);
});

test("splitUsage folds cache_creation into uncached and reports cached", () => {
  const u = splitUsage({
    input_tokens: 300,
    output_tokens: 80,
    cache_read_input_tokens: 4000,
    cache_creation_input_tokens: 0,
  });
  assert.equal(u.cachedInputTokens, 4000);
  assert.equal(u.outputTokens, 80);
  // totalInput reported = uncached + cached
  assert.equal(u.inputTokens, 300 + 4000);
});

test("splitUsage treats cache_creation as uncached (billed at full rate)", () => {
  const u = splitUsage({
    input_tokens: 0,
    output_tokens: 50,
    cache_creation_input_tokens: 4000,
  });
  // uncached portion = input + creation = 0 + 4000
  assert.equal(u.cachedInputTokens, 0);
  assert.equal(u.inputTokens, 4000);
});

// ─────────────────────────────────────────────────────────────────
// buildRequest shape
// ─────────────────────────────────────────────────────────────────

test("buildRequest uses Haiku model by default with cache_control on system", () => {
  const body = buildRequest(baseCtx(), "haiku");
  assert.equal(body.model, HAIKU_MODEL);
  assert.equal(body.max_tokens, 120);
  assert.equal(body.temperature, 0);
  assert.ok(Array.isArray(body.system));
  assert.equal(body.system[0].cache_control.type, "ephemeral");
  assert.ok(body.system[0].text.length > 500);
  assert.ok(Array.isArray(body.tools));
  assert.equal(body.tools[0].name, "emit_action");
  assert.equal(body.tool_choice.type, "tool");
  assert.equal(body.tool_choice.name, "emit_action");
});

test("buildRequest switches to Sonnet model when asked", () => {
  const body = buildRequest(baseCtx(), "sonnet");
  assert.equal(body.model, SONNET_MODEL);
  assert.equal(body.max_tokens, 600);
});

test("buildRequest includes image on step 1", () => {
  const body = buildRequest(baseCtx({ step: 1 }), "haiku");
  const userContent = body.messages[0].content;
  const hasImage = userContent.some((p) => p.type === "image");
  assert.equal(hasImage, true);
});

test("buildRequest omits image when fp unchanged and feedback is no_change", () => {
  const body = buildRequest(
    baseCtx({ step: 5, fingerprintChanged: false, lastFeedback: "no_change" }),
    "haiku",
  );
  const userContent = body.messages[0].content;
  const hasImage = userContent.some((p) => p.type === "image");
  assert.equal(hasImage, false);
});

// ─────────────────────────────────────────────────────────────────
// decideNextAction — Haiku path only
// ─────────────────────────────────────────────────────────────────

test("decideNextAction: Haiku returns valid tap → returned as-is", async () => {
  const mock = makeMockClient([
    {
      text: '{"reasoning":"tapping login","action":{"type":"tap","x":540,"y":1800},"expected_outcome":"form","escalate":false}',
      usage: { input_tokens: 500, output_tokens: 40, cache_read_input_tokens: 0 },
    },
  ]);
  const decision = await decideNextAction(baseCtx(), { anthropic: mock });
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].model, HAIKU_MODEL);
  assert.equal(decision.action.type, "tap");
  assert.equal(decision.action.x, 540);
  assert.equal(decision.modelUsed, "haiku");
  assert.equal(decision.escalated, false);
  assert.equal(decision.outputTokens, 40);
});

test("decideNextAction: Haiku returns fenced JSON → parsed correctly", async () => {
  const mock = makeMockClient([
    {
      text: '```json\n{"reasoning":"back","action":{"type":"press_back"},"expected_outcome":"prev"}\n```',
      usage: { input_tokens: 450, output_tokens: 20 },
    },
  ]);
  const decision = await decideNextAction(baseCtx(), { anthropic: mock });
  assert.equal(decision.action.type, "press_back");
});

test("decideNextAction: invalid action → press_back fallback", async () => {
  const mock = makeMockClient([
    {
      text: '{"reasoning":"nope","action":{"type":"shake"},"expected_outcome":"?"}',
      usage: { input_tokens: 400, output_tokens: 10 },
    },
  ]);
  const decision = await decideNextAction(baseCtx(), { anthropic: mock });
  assert.equal(decision.action.type, "press_back");
  assert.equal(decision.modelUsed, "haiku");
  assert.equal(decision.escalated, false);
});

test("decideNextAction: completely unparseable → press_back fallback", async () => {
  const mock = makeMockClient([
    { text: "hello I am a model and I cannot JSON", usage: { input_tokens: 400, output_tokens: 10 } },
  ]);
  const decision = await decideNextAction(baseCtx(), { anthropic: mock });
  assert.equal(decision.action.type, "press_back");
});

// ─────────────────────────────────────────────────────────────────
// Sonnet escalation
// ─────────────────────────────────────────────────────────────────

test("decideNextAction: escalate=true AND budget allows → Sonnet called, decision uses Sonnet", async () => {
  const mock = makeMockClient([
    {
      // Haiku opts out and escalates
      text: '{"reasoning":"unsure","action":{"type":"press_back"},"expected_outcome":"?","escalate":true}',
      usage: { input_tokens: 400, output_tokens: 30 },
    },
    {
      // Sonnet returns confident answer
      text: '{"reasoning":"tap login","action":{"type":"tap","x":540,"y":2000},"expected_outcome":"form"}',
      usage: { input_tokens: 600, output_tokens: 60 },
    },
  ]);
  const decision = await decideNextAction(baseCtx(), { anthropic: mock });
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[0].model, HAIKU_MODEL);
  assert.equal(mock.calls[1].model, SONNET_MODEL);
  assert.equal(decision.modelUsed, "sonnet");
  assert.equal(decision.escalated, true);
  assert.equal(decision.action.type, "tap");
  assert.equal(decision.action.y, 2000);
  // Token accounting is summed across both calls
  assert.equal(decision.outputTokens, 30 + 60);
});

test("decideNextAction: escalate=true but budget denies → stays on Haiku", async () => {
  const mock = makeMockClient([
    {
      text: '{"reasoning":"maybe","action":{"type":"tap","x":100,"y":200},"expected_outcome":"?","escalate":true}',
      usage: { input_tokens: 400, output_tokens: 30 },
    },
  ]);
  const ctx = baseCtx({ budgetController: { canEscalateToSonnet: () => false } });
  const decision = await decideNextAction(ctx, { anthropic: mock });
  assert.equal(mock.calls.length, 1);
  assert.equal(decision.modelUsed, "haiku");
  assert.equal(decision.escalated, false);
  assert.equal(decision.action.type, "tap");
});

test("decideNextAction: forceEscalate skips Haiku and calls Sonnet directly", async () => {
  const mock = makeMockClient([
    {
      text: '{"reasoning":"unstick","action":{"type":"tap","x":100,"y":2200},"expected_outcome":"drawer"}',
      usage: { input_tokens: 800, output_tokens: 50 },
    },
  ]);
  const ctx = baseCtx({ forceEscalate: true });
  const decision = await decideNextAction(ctx, { anthropic: mock });
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].model, SONNET_MODEL);
  assert.equal(decision.modelUsed, "sonnet");
  assert.equal(decision.escalated, true);
  assert.equal(decision.action.type, "tap");
  assert.equal(decision.action.y, 2200);
});

test("decideNextAction: forceEscalate ignored when budget denies Sonnet", async () => {
  const mock = makeMockClient([
    {
      text: '{"reasoning":"continuing","action":{"type":"swipe","x1":540,"y1":1800,"x2":540,"y2":600},"expected_outcome":"scroll"}',
      usage: { input_tokens: 300, output_tokens: 20 },
    },
  ]);
  const ctx = baseCtx({
    forceEscalate: true,
    budgetController: { canEscalateToSonnet: () => false },
  });
  const decision = await decideNextAction(ctx, { anthropic: mock });
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].model, HAIKU_MODEL);
  assert.equal(decision.modelUsed, "haiku");
  assert.equal(decision.escalated, false);
});

test("decideNextAction: Sonnet call throws → falls back to Haiku decision", async () => {
  const mock = {
    calls: [],
    messages: {
      create: async (body) => {
        mock.calls.push(body);
        if (mock.calls.length === 1) {
          return makeMockMessage(
            '{"reasoning":"unsure","action":{"type":"press_back"},"expected_outcome":"?","escalate":true}',
            { input_tokens: 400, output_tokens: 30 },
          );
        }
        throw new Error("sonnet 500");
      },
    },
  };
  const decision = await decideNextAction(baseCtx(), { anthropic: mock });
  assert.equal(mock.calls.length, 2);
  assert.equal(decision.modelUsed, "haiku");
  assert.equal(decision.escalated, false);
  assert.equal(decision.action.type, "press_back");
});

// ─────────────────────────────────────────────────────────────────
// Image gating in actual decideNextAction request body
// ─────────────────────────────────────────────────────────────────

test("decideNextAction omits image when fp unchanged mid-crawl", async () => {
  const mock = makeMockClient([
    {
      text: '{"reasoning":"retry","action":{"type":"swipe","x1":540,"y1":2000,"x2":540,"y2":800},"expected_outcome":"scroll"}',
      usage: { input_tokens: 300, output_tokens: 20 },
    },
  ]);
  const ctx = baseCtx({ step: 10, fingerprintChanged: false, lastFeedback: "no_change" });
  await decideNextAction(ctx, { anthropic: mock });
  const userContent = mock.calls[0].messages[0].content;
  const hasImage = userContent.some((p) => p.type === "image");
  assert.equal(hasImage, false);
});

test("decideNextAction throws when ctx.observation missing", async () => {
  await assert.rejects(() => decideNextAction({}, { anthropic: {} }), /observation/);
});
