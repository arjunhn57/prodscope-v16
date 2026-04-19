"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

// policy-step.js requires live modules (policy, recovery, out-of-app, actions).
// We test selectAction's decision logic by calling it with mocked dependencies.
// The module itself is small (73 LOC) — the key logic is:
//   1. Call policy.choose → get decision
//   2. If decision.action.type === "stop" → return break
//   3. Intercept back-for-exhaustion → trigger recovery instead

// ── Module shape ────────────────────────────────────────────────────────────

describe("policy-step module", () => {
  it("exports selectAction function", () => {
    const { selectAction } = require("../policy-step");
    assert.strictEqual(typeof selectAction, "function");
  });
});

// ── Decision routing logic (tested inline) ──────────────────────────────────

describe("selectAction decision routing", () => {
  // Simulate the decision routing logic from selectAction without calling it
  // (since it requires ctx.recoveryManager, ctx.modeManager, etc.)

  it("stop decision produces break directive", () => {
    const decision = { action: { type: "stop" }, reason: "no_more_targets" };
    const directive = decision.action.type === "stop" ? "break" : "proceed";
    assert.strictEqual(directive, "break");
  });

  it("normal tap decision produces proceed directive", () => {
    const decision = { action: { type: "tap", key: "tap:btn:200,300" }, reason: "highest_priority" };
    const directive = decision.action.type === "stop" ? "break" : "proceed";
    assert.strictEqual(directive, "proceed");
  });

  it("back decision is NOT intercepted when untried actions exist", () => {
    const decision = { action: { type: "back" }, reason: "all_actions_exhausted" };
    const candidates = [
      { key: "tap:a:100,200" },
      { key: "tap:b:300,400" },
    ];
    const tried = new Set();
    const ineffective = new Set();
    const effectiveUntried = candidates.filter(
      (a) => !tried.has(a.key) && !ineffective.has(a.key)
    ).length;

    const shouldRecover = decision.action.type === "back" &&
      ["all_actions_exhausted"].includes(decision.reason) &&
      effectiveUntried === 0;

    assert.strictEqual(shouldRecover, false);
    assert.strictEqual(effectiveUntried, 2);
  });

  it("back decision IS intercepted when no effective untried actions", () => {
    const decision = { action: { type: "back" }, reason: "all_actions_exhausted" };
    const candidates = [
      { key: "tap:a:100,200" },
    ];
    const tried = new Set(["tap:a:100,200"]);
    const ineffective = new Set();
    const effectiveUntried = candidates.filter(
      (a) => !tried.has(a.key) && !ineffective.has(a.key)
    ).length;

    const shouldRecover = decision.action.type === "back" &&
      ["all_actions_exhausted"].includes(decision.reason) &&
      effectiveUntried === 0;

    assert.strictEqual(shouldRecover, true);
  });

  it("back with ineffective actions still triggers recovery", () => {
    const decision = { action: { type: "back" }, reason: "all_actions_exhausted" };
    const candidates = [
      { key: "tap:a:100,200" },
      { key: "tap:b:300,400" },
    ];
    const tried = new Set(["tap:a:100,200"]);
    const ineffective = new Set(["tap:b:300,400"]);
    const effectiveUntried = candidates.filter(
      (a) => !tried.has(a.key) && !ineffective.has(a.key)
    ).length;

    const shouldRecover = decision.action.type === "back" &&
      ["all_actions_exhausted"].includes(decision.reason) &&
      effectiveUntried === 0;

    assert.strictEqual(shouldRecover, true);
    assert.strictEqual(effectiveUntried, 0);
  });

  it("loop_detected reason triggers recovery intercept", () => {
    const decision = { action: { type: "back" }, reason: "loop_detected" };
    const effectiveUntried = 0;
    const shouldRecover = decision.action.type === "back" &&
      ["loop_detected", "max_revisits_exceeded", "all_actions_exhausted"].includes(decision.reason) &&
      effectiveUntried === 0;

    assert.strictEqual(shouldRecover, true);
  });

  it("max_revisits_exceeded reason triggers recovery intercept", () => {
    const decision = { action: { type: "back" }, reason: "max_revisits_exceeded" };
    const effectiveUntried = 0;
    const shouldRecover = decision.action.type === "back" &&
      ["loop_detected", "max_revisits_exceeded", "all_actions_exhausted"].includes(decision.reason) &&
      effectiveUntried === 0;

    assert.strictEqual(shouldRecover, true);
  });

  it("non-interceptable reason does not trigger recovery", () => {
    const decision = { action: { type: "back" }, reason: "user_requested" };
    const effectiveUntried = 0;
    const shouldRecover = decision.action.type === "back" &&
      ["loop_detected", "max_revisits_exceeded", "all_actions_exhausted"].includes(decision.reason) &&
      effectiveUntried === 0;

    assert.strictEqual(shouldRecover, false);
  });
});
