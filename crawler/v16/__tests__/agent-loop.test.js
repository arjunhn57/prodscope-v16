"use strict";

/**
 * Phase-4 tests for agent-loop.js. Uses in-process mocks for:
 *   - adb (screencapAsync, dumpXmlAsync, getCurrentActivityAsync, tap, etc.)
 *   - readiness (no-op)
 *   - anthropic (stubbed messages.stream via scripted responses)
 *
 * The goal is end-to-end coverage of the loop's decisions: launch, capture,
 * decide, execute, emit SSE, budget-exhaustion, done, consecutive-identical
 * safety net, error fallback, and token accounting.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  runAgentLoop,
  actionsIdentical,
  formatActionLabel,
} = require("../agent-loop");

// 1x1 transparent PNG for screenshot fixtures
const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63000100000005000100",
  "hex",
);

function makeTmpScreenshotDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v16-loop-"));
  return dir;
}

/**
 * Mock ADB that pretends to capture a screenshot each call. Returns a
 * fingerprint that changes every N steps so the agent sees "changed" vs
 * "no_change" feedback. Records all calls for assertion.
 */
function makeMockAdb(opts = {}) {
  const calls = [];
  const activities = opts.activities || ["com.a/.Main"];
  let captureCount = 0;

  return {
    calls,
    // Device I/O — all sync in the real module but we mimic async variants too
    launchApp: (p) => calls.push({ m: "launchApp", p }),
    tap: (x, y) => calls.push({ m: "tap", x, y }),
    swipe: (x1, y1, x2, y2, d) => calls.push({ m: "swipe", x1, y1, x2, y2, d }),
    pressBack: () => calls.push({ m: "pressBack" }),
    pressHome: () => calls.push({ m: "pressHome" }),
    inputText: (t) => calls.push({ m: "inputText", t }),
    // Async observation helpers used by observation.js
    screencapAsync: async (outPath) => {
      captureCount += 1;
      // Write a different byte pattern per call so computeExactHash sees unique fps.
      const buf = Buffer.concat([TINY_PNG, Buffer.from([captureCount])]);
      fs.writeFileSync(outPath, buf);
      return true;
    },
    dumpXmlAsync: async () => "<hierarchy/>",
    getCurrentActivityAsync: async () =>
      activities[(captureCount - 1) % activities.length],
  };
}

function makeMockReadiness() {
  let called = 0;
  return {
    called: () => called,
    waitForScreenReadyScreenshotOnly: async () => {
      called += 1;
      return { ready: true, elapsedMs: 0, reason: "mock" };
    },
  };
}

/**
 * Mock Anthropic client: scripted responses per call. text = raw response
 * body, usage = Anthropic usage shape.
 */
function makeMockAnthropic(scripted) {
  const calls = [];
  const remaining = scripted.slice();
  return {
    calls,
    messages: {
      create: async (body) => {
        calls.push(body);
        const next = remaining.shift() || scripted[scripted.length - 1];
        return mockMessage(next.text, next.usage);
      },
    },
  };
}

function mockMessage(text, usage) {
  let parsed = null;
  if (typeof text === "string") {
    let cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    try {
      parsed = JSON.parse(cleaned);
    } catch (_) {
      const first = cleaned.indexOf("{");
      const last = cleaned.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try { parsed = JSON.parse(cleaned.substring(first, last + 1)); } catch (_) {}
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

function response(action, opts = {}) {
  return {
    text: JSON.stringify({
      reasoning: opts.reasoning || "",
      action,
      expected_outcome: opts.expectedOutcome || "",
      escalate: opts.escalate || false,
    }),
    usage: opts.usage || { input_tokens: 400, output_tokens: 30 },
  };
}

// ─────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────

test("actionsIdentical: same tap at same coords → true", () => {
  assert.equal(
    actionsIdentical({ type: "tap", x: 10, y: 20 }, { type: "tap", x: 10, y: 20 }),
    true,
  );
});

test("actionsIdentical: same tap at different coords → false", () => {
  assert.equal(
    actionsIdentical({ type: "tap", x: 10, y: 20 }, { type: "tap", x: 11, y: 20 }),
    false,
  );
});

test("actionsIdentical: press_back twice → true", () => {
  assert.equal(
    actionsIdentical({ type: "press_back" }, { type: "press_back" }),
    true,
  );
});

test("actionsIdentical: null or undefined → false", () => {
  assert.equal(actionsIdentical(null, { type: "tap", x: 1, y: 2 }), false);
  assert.equal(actionsIdentical({ type: "tap", x: 1, y: 2 }, null), false);
});

test("formatActionLabel handles all types", () => {
  assert.equal(formatActionLabel({ type: "tap", x: 1, y: 2 }), "tap(1,2)");
  assert.equal(
    formatActionLabel({ type: "swipe", x1: 1, y1: 2, x2: 3, y2: 4 }),
    "swipe(1,2→3,4)",
  );
  assert.equal(formatActionLabel({ type: "done", reason: "exh" }), "done(exh)");
});

// ─────────────────────────────────────────────────────────────────
// Full-loop integration (mocked)
// ─────────────────────────────────────────────────────────────────

test("runAgentLoop: stops on agent_done after one step", async () => {
  const dir = makeTmpScreenshotDir();
  const adb = makeMockAdb();
  const readiness = makeMockReadiness();
  const anthropic = makeMockAnthropic([response({ type: "done", reason: "exhausted" })]);

  const result = await runAgentLoop({
    jobId: "test",
    targetPackage: "com.a",
    screenshotDir: dir,
    budgetConfig: { maxSteps: 10 },
    deps: { adb, readiness, anthropic },
  });

  assert.equal(result.stopReason, "agent_done:exhausted");
  assert.equal(result.stepsUsed, 1);
  assert.equal(result.screens.length, 1);
  assert.equal(result.actionsTaken.length, 1);
  assert.equal(result.actionsTaken[0].action.type, "done");
  // launchApp was called once at start
  assert.equal(adb.calls.filter((c) => c.m === "launchApp").length, 1);
});

test("runAgentLoop: runs multiple steps, executes tap actions, stops on budget", async () => {
  const dir = makeTmpScreenshotDir();
  const adb = makeMockAdb();
  const readiness = makeMockReadiness();
  const anthropic = makeMockAnthropic([
    response({ type: "tap", x: 100, y: 200 }),
    response({ type: "tap", x: 300, y: 400 }),
    response({ type: "swipe", x1: 500, y1: 1000, x2: 500, y2: 200 }),
    response({ type: "done", reason: "explored" }),
  ]);

  const progressEvents = [];
  const result = await runAgentLoop({
    jobId: "test",
    targetPackage: "com.a",
    screenshotDir: dir,
    budgetConfig: { maxSteps: 10 },
    onProgress: (p) => progressEvents.push(p),
    deps: { adb, readiness, anthropic },
  });

  assert.equal(result.stopReason, "agent_done:explored");
  assert.equal(result.stepsUsed, 4);
  assert.equal(result.screens.length, 4);
  // ADB executed tap/swipe actions (not done/back)
  const taps = adb.calls.filter((c) => c.m === "tap");
  assert.equal(taps.length, 2);
  assert.deepEqual(taps[0], { m: "tap", x: 100, y: 200 });
  assert.equal(adb.calls.filter((c) => c.m === "swipe").length, 1);
  // SSE emitted per step
  assert.equal(progressEvents.length, 4);
  assert.equal(progressEvents[0].engine, "v16");
  assert.ok(progressEvents[0].latestAction.startsWith("tap("));
});

test("runAgentLoop: stops on max_steps when agent never emits done", async () => {
  const dir = makeTmpScreenshotDir();
  const adb = makeMockAdb();
  const readiness = makeMockReadiness();
  const anthropic = makeMockAnthropic([response({ type: "press_back" })]);

  const result = await runAgentLoop({
    jobId: "test",
    targetPackage: "com.a",
    screenshotDir: dir,
    budgetConfig: { maxSteps: 3 },
    deps: { adb, readiness, anthropic },
  });

  assert.equal(result.stopReason, "max_steps_reached");
  assert.equal(result.stepsUsed, 3);
});

test("runAgentLoop: consecutive-identical safety net forces press_back", async () => {
  const dir = makeTmpScreenshotDir();
  const adb = makeMockAdb();
  const readiness = makeMockReadiness();
  // Agent emits identical tap three times in a row → loop should override 3rd with press_back
  const anthropic = makeMockAnthropic([
    response({ type: "tap", x: 100, y: 100 }),
    response({ type: "tap", x: 100, y: 100 }),
    response({ type: "tap", x: 100, y: 100 }),
    response({ type: "done", reason: "stuck" }),
  ]);

  const result = await runAgentLoop({
    jobId: "test",
    targetPackage: "com.a",
    screenshotDir: dir,
    budgetConfig: { maxSteps: 10 },
    deps: { adb, readiness, anthropic },
  });

  const executedActions = result.actionsTaken.map((a) => a.action);
  assert.equal(executedActions[0].type, "tap");
  assert.equal(executedActions[1].type, "tap");
  // Third action must have been overridden to press_back
  assert.equal(executedActions[2].type, "press_back");
  // ADB should show only 2 tap calls, then pressBack
  const taps = adb.calls.filter((c) => c.m === "tap");
  assert.equal(taps.length, 2);
  assert.equal(adb.calls.filter((c) => c.m === "pressBack").length >= 1, true);
});

test("runAgentLoop: budget exhaustion on cost stops the loop", async () => {
  const dir = makeTmpScreenshotDir();
  const adb = makeMockAdb();
  const readiness = makeMockReadiness();
  // Each call uses 10K Haiku input tokens and 2K output → $0.01 + $0.01 = $0.02/step
  // Cap at $0.05 means we should stop after ~3 steps.
  const bigUsage = { input_tokens: 10000, output_tokens: 2000 };
  const anthropic = makeMockAnthropic([
    response({ type: "tap", x: 1, y: 1 }, { usage: bigUsage }),
    response({ type: "tap", x: 2, y: 2 }, { usage: bigUsage }),
    response({ type: "tap", x: 3, y: 3 }, { usage: bigUsage }),
    response({ type: "tap", x: 4, y: 4 }, { usage: bigUsage }),
    response({ type: "tap", x: 5, y: 5 }, { usage: bigUsage }),
  ]);

  const result = await runAgentLoop({
    jobId: "test",
    targetPackage: "com.a",
    screenshotDir: dir,
    budgetConfig: { maxSteps: 20, maxCostUsd: 0.05 },
    deps: { adb, readiness, anthropic },
  });

  assert.equal(result.stopReason, "budget_exhausted");
  assert.ok(result.costUsd >= 0.05, `cost ${result.costUsd} should hit cap`);
  assert.ok(result.stepsUsed < 20);
});

test("runAgentLoop: invalid action from agent → press_back fallback, loop continues", async () => {
  const dir = makeTmpScreenshotDir();
  const adb = makeMockAdb();
  const readiness = makeMockReadiness();
  // First response has invalid action type; agent.coerceDecision replaces it with
  // press_back. Second response is done.
  const anthropic = makeMockAnthropic([
    { text: '{"reasoning":"nope","action":{"type":"shake"}}', usage: { input_tokens: 300, output_tokens: 10 } },
    response({ type: "done", reason: "ok" }),
  ]);

  const result = await runAgentLoop({
    jobId: "test",
    targetPackage: "com.a",
    screenshotDir: dir,
    budgetConfig: { maxSteps: 5 },
    deps: { adb, readiness, anthropic },
  });

  assert.equal(result.stopReason, "agent_done:ok");
  assert.equal(result.actionsTaken[0].action.type, "press_back");
});

test("runAgentLoop: launchApp failure returns launch_failed stopReason", async () => {
  const dir = makeTmpScreenshotDir();
  const adb = makeMockAdb();
  adb.launchApp = () => {
    throw new Error("device offline");
  };
  const readiness = makeMockReadiness();
  const anthropic = makeMockAnthropic([response({ type: "done", reason: "x" })]);

  const result = await runAgentLoop({
    jobId: "test",
    targetPackage: "com.a",
    screenshotDir: dir,
    deps: { adb, readiness, anthropic },
  });
  assert.equal(result.stopReason, "launch_failed");
  assert.equal(result.screens.length, 0);
});

test("runAgentLoop: tracks unique screens and increments on fingerprint change", async () => {
  const dir = makeTmpScreenshotDir();
  const adb = makeMockAdb();
  const readiness = makeMockReadiness();
  const anthropic = makeMockAnthropic([
    response({ type: "tap", x: 1, y: 1 }),
    response({ type: "tap", x: 2, y: 2 }),
    response({ type: "done", reason: "d" }),
  ]);

  const result = await runAgentLoop({
    jobId: "test",
    targetPackage: "com.a",
    screenshotDir: dir,
    deps: { adb, readiness, anthropic },
  });

  // Each step writes a slightly different PNG → computeExactHash sees 3 unique fps
  assert.equal(result.uniqueScreens, 3);
});

test("runAgentLoop: credential substitution in type action", async () => {
  const dir = makeTmpScreenshotDir();
  const adb = makeMockAdb();
  const readiness = makeMockReadiness();
  const anthropic = makeMockAnthropic([
    response({ type: "type", text: "${EMAIL}" }),
    response({ type: "type", text: "${PASSWORD}" }),
    response({ type: "done", reason: "d" }),
  ]);

  await runAgentLoop({
    jobId: "test",
    targetPackage: "com.a",
    screenshotDir: dir,
    credentials: { email: "u@e.com", password: "secret-pw" },
    deps: { adb, readiness, anthropic },
  });

  const typeCalls = adb.calls.filter((c) => c.m === "inputText");
  assert.equal(typeCalls.length, 2);
  assert.equal(typeCalls[0].t, "u@e.com");
  assert.equal(typeCalls[1].t, "secret-pw");
});

test("runAgentLoop: agent decision failure uses press_back fallback and continues", async () => {
  const dir = makeTmpScreenshotDir();
  const adb = makeMockAdb();
  const readiness = makeMockReadiness();
  // anthropic throws on first call, then returns done
  const anthropic = {
    calls: [],
    messages: {
      create: async (body) => {
        anthropic.calls.push(body);
        if (anthropic.calls.length === 1) throw new Error("network 500");
        return mockMessage(
          JSON.stringify({ action: { type: "done", reason: "recovered" } }),
          { input_tokens: 200, output_tokens: 20 },
        );
      },
    },
  };

  const result = await runAgentLoop({
    jobId: "test",
    targetPackage: "com.a",
    screenshotDir: dir,
    budgetConfig: { maxSteps: 5 },
    deps: { adb, readiness, anthropic },
  });

  assert.equal(result.actionsTaken[0].action.type, "press_back");
  assert.equal(result.stopReason, "agent_done:recovered");
});

test("runAgentLoop: records token cost correctly across steps", async () => {
  const dir = makeTmpScreenshotDir();
  const adb = makeMockAdb();
  const readiness = makeMockReadiness();
  const anthropic = makeMockAnthropic([
    response({ type: "tap", x: 1, y: 2 }, { usage: { input_tokens: 1000, output_tokens: 100 } }),
    response({ type: "done", reason: "d" }, { usage: { input_tokens: 500, output_tokens: 50 } }),
  ]);

  const result = await runAgentLoop({
    jobId: "test",
    targetPackage: "com.a",
    screenshotDir: dir,
    deps: { adb, readiness, anthropic },
  });

  // Haiku pricing: $1/M input + $5/M output
  // Step 1: (1000 * 1 + 100 * 5) / 1M = 0.0015
  // Step 2: (500 * 1 + 50 * 5) / 1M   = 0.00075
  const expected = 0.0015 + 0.00075;
  assert.ok(Math.abs(result.costUsd - expected) < 1e-9, `cost ${result.costUsd} vs expected ${expected}`);
});
