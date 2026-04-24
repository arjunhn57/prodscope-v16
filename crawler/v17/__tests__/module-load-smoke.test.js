"use strict";

/**
 * module-load-smoke.test.js — regression guard against shipping with a
 * broken v17/agent-loop.js import graph.
 *
 * Background (2026-04-24 production incident): V17 shipped to main with
 * `isAuthScreen` imported from crawler/v16/auth-escape but never exported
 * from there — the function lived only in an uncommitted local working
 * tree. The existing driver-level unit tests never require()'d the
 * full agent-loop module, so the broken import only surfaced at runtime
 * on the FIRST screen transition (~5 min into every real crawl).
 *
 * This test literally require()s the agent-loop module and asserts that
 * its public surface is intact. If any downstream import breaks, the
 * require() throws at test time — not at step 2 of a paying user's crawl.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

test("v17/agent-loop: module loads without throwing", () => {
  // Pure require — if any transitive import resolves to undefined, this
  // throws synchronously and the test fails.
  assert.doesNotThrow(() => {
    require("../agent-loop");
  });
});

test("v17/agent-loop: exports runAgentLoop as a function", () => {
  const mod = require("../agent-loop");
  assert.equal(typeof mod.runAgentLoop, "function", "runAgentLoop must be exported as a function");
});

test("v17/agent-loop: all transitive v16 primitives resolve", () => {
  // Pin the exact v16 imports agent-loop declares (see top of the file).
  // If v16 drops one of these without coordinating with v17, the require
  // above still works but the fn becomes undefined — this test pins the
  // contract explicitly per-name.
  const authEscape = require("../../v16/auth-escape");
  assert.equal(typeof authEscape.isAuthScreen, "function", "v16/auth-escape must export isAuthScreen");
  assert.equal(typeof authEscape.findAuthEscapeButton, "function", "v16/auth-escape must export findAuthEscapeButton");

  const observation = require("../../v16/observation");
  assert.equal(typeof observation.captureObservation, "function", "v16/observation must export captureObservation");

  const state = require("../../v16/state");
  assert.equal(typeof state.createStateGraph, "function", "v16/state must export createStateGraph");

  const budget = require("../../v16/budget");
  assert.equal(typeof budget.createBudget, "function", "v16/budget must export createBudget");

  const executor = require("../../v16/executor");
  assert.equal(typeof executor.executeAction, "function", "v16/executor must export executeAction");
  assert.equal(typeof executor.validateAction, "function", "v16/executor must export validateAction");

  const agent = require("../../v16/agent");
  assert.equal(typeof agent.decideNextAction, "function", "v16/agent must export decideNextAction");
});

test("v17/dispatcher: module loads + all drivers resolve", () => {
  assert.doesNotThrow(() => {
    require("../dispatcher");
  });
  const mod = require("../dispatcher");
  assert.equal(typeof mod.dispatch, "function", "dispatcher must export dispatch");
});
