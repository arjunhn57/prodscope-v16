"use strict";

/**
 * Tests for v17/dispatcher.js.
 *
 * 4 integration cases per plan nifty-nibbling-widget.md A.5:
 *   1. PermissionDriver wins when permission dialog is on screen even if the
 *      auth XML is also present (priority order honored).
 *   2. AuthDriver wins over Exploration when both could claim.
 *   3. All drivers return null → dispatcher calls LLMFallback.
 *   4. State threads through across dispatches — authStep persists between
 *      calls and dispatchCount monotonically increases.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { dispatch } = require("../dispatcher");

// ── Minimal mock-driver factory ────────────────────────────────────────

function makeDriver({ name, claim = () => true, decide = () => null }) {
  const calls = { claim: 0, decide: 0 };
  return {
    name,
    calls,
    claim: (observation) => {
      calls.claim += 1;
      return claim(observation);
    },
    decide: async (observation, state, deps) => {
      calls.decide += 1;
      return decide(observation, state, deps);
    },
  };
}

// ── 1. Priority ordering: PermissionDriver wins ────────────────────────

test("dispatch: higher-priority driver wins even when lower-priority one could also claim", async () => {
  const permission = makeDriver({
    name: "PermissionDriver",
    claim: () => true,
    decide: () => ({ type: "tap", x: 900, y: 1600, targetText: "While using the app" }),
  });
  const auth = makeDriver({
    name: "AuthDriver",
    claim: () => true,
    decide: () => ({ type: "tap", x: 540, y: 900, targetText: "Continue with Email" }),
  });

  const observation = { xml: "<irrelevant/>", packageName: "com.example" };
  const state = {};
  const result = await dispatch(observation, state, {
    drivers: [permission, auth],
    llmFallback: () => ({ type: "done", reason: "unreachable" }),
  });

  assert.equal(result.driver, "PermissionDriver");
  assert.equal(result.action.targetText, "While using the app");
  // Permission wins first — auth is never consulted.
  assert.equal(permission.calls.claim, 1);
  assert.equal(permission.calls.decide, 1);
  assert.equal(auth.calls.claim, 0, "AuthDriver must not be called once PermissionDriver acts");
  assert.equal(auth.calls.decide, 0);
});

// ── 2. AuthDriver wins over Exploration ────────────────────────────────

test("dispatch: AuthDriver wins over Exploration when both claim the screen", async () => {
  const auth = makeDriver({
    name: "AuthDriver",
    claim: () => true,
    decide: () => ({ type: "type", text: "${EMAIL}" }),
  });
  const exploration = makeDriver({
    name: "ExplorationDriver",
    claim: () => true,
    decide: () => ({ type: "tap", x: 100, y: 100, targetText: "Home tab" }),
  });

  const result = await dispatch(
    { xml: "<xml/>" },
    {},
    {
      drivers: [auth, exploration],
      llmFallback: () => ({ type: "done", reason: "unreachable" }),
    },
  );
  assert.equal(result.driver, "AuthDriver");
  assert.equal(result.action.type, "type");
  assert.equal(exploration.calls.claim, 0, "Exploration not consulted when Auth acted");
});

// Sibling assertion: if the higher-priority driver claims but yields null,
// dispatch continues to the next driver (does NOT jump to LLMFallback).
test("dispatch: driver that claims but returns null falls through to the next driver", async () => {
  const yielder = makeDriver({
    name: "AuthDriver",
    claim: () => true,
    decide: () => null,
  });
  const acting = makeDriver({
    name: "ExplorationDriver",
    claim: () => true,
    decide: () => ({ type: "tap", x: 50, y: 50, targetText: "Home" }),
  });
  const llmFallback = async () => ({ type: "done", reason: "unreachable" });
  const result = await dispatch({ xml: "" }, {}, {
    drivers: [yielder, acting],
    llmFallback,
  });
  assert.equal(result.driver, "ExplorationDriver");
  assert.equal(yielder.calls.decide, 1, "AuthDriver was consulted");
  assert.equal(acting.calls.decide, 1, "Exploration was then consulted");
});

// ── 3. All drivers return null → LLMFallback takes over ────────────────

test("dispatch: all drivers yield null → LLMFallback is invoked", async () => {
  const auth = makeDriver({ name: "AuthDriver", claim: () => true, decide: () => null });
  const exploration = makeDriver({ name: "ExplorationDriver", claim: () => false });
  const fallbackCalls = [];
  const llmFallback = async (obs, state, deps) => {
    fallbackCalls.push({ obs, state, deps });
    return { type: "press_back" };
  };

  const state = {};
  const result = await dispatch({ xml: "<x/>" }, state, {
    drivers: [auth, exploration],
    llmFallback,
  });

  assert.equal(result.driver, "LLMFallback");
  assert.equal(result.action.type, "press_back");
  assert.equal(fallbackCalls.length, 1, "LLMFallback called exactly once");
  // Auth claimed but yielded null; exploration didn't claim — both should be
  // visible in their call counts.
  assert.equal(auth.calls.decide, 1);
  assert.equal(exploration.calls.claim, 1);
  assert.equal(exploration.calls.decide, 0);
});

// ── 4. State threads across dispatches ─────────────────────────────────

test("dispatch: dispatchCount increments monotonically and authStep persists between calls", async () => {
  // This driver mimics the AuthDriver state machine: first call focuses email,
  // second call types email, third call focuses password.
  const authDriver = {
    name: "AuthDriver",
    claim: () => true,
    decide: (observation, state) => {
      if (!state.authStep) {
        state.authStep = "email_focused";
        state.authStepDispatch = state.dispatchCount;
        return { type: "tap", x: 540, y: 560 };
      }
      if (state.authStep === "email_focused") {
        state.authStep = "email_typed";
        state.authStepDispatch = state.dispatchCount;
        return { type: "type", text: "${EMAIL}" };
      }
      if (state.authStep === "email_typed") {
        state.authStep = "password_focused";
        state.authStepDispatch = state.dispatchCount;
        return { type: "tap", x: 540, y: 740 };
      }
      return null;
    },
  };

  const state = {};
  const deps = {
    drivers: [authDriver],
    llmFallback: () => ({ type: "done", reason: "unreachable" }),
  };
  const observation = { xml: "<email-form/>" };

  const r1 = await dispatch(observation, state, deps);
  const dc1 = state.dispatchCount;
  const step1 = state.authStep;

  const r2 = await dispatch(observation, state, deps);
  const dc2 = state.dispatchCount;
  const step2 = state.authStep;

  const r3 = await dispatch(observation, state, deps);
  const dc3 = state.dispatchCount;
  const step3 = state.authStep;

  // dispatchCount strictly increases.
  assert.equal(dc1, 1, "first call → dispatchCount=1");
  assert.equal(dc2, 2);
  assert.equal(dc3, 3);

  // authStep advances across dispatches.
  assert.equal(step1, "email_focused");
  assert.equal(step2, "email_typed");
  assert.equal(step3, "password_focused");

  // Each dispatch produced a different action.
  assert.equal(r1.action.type, "tap");
  assert.equal(r2.action.type, "type");
  assert.equal(r3.action.type, "tap");

  // authStepDispatch tracks the dispatchCount at which authStep was last advanced.
  assert.equal(state.authStepDispatch, 3);
});
