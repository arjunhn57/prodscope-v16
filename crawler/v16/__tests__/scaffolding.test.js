"use strict";

/**
 * Phase 1 smoke test: verifies all v16 modules load and export their
 * documented surface. Implementations throw "not implemented" — that is
 * expected until Phase 2.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

test("budget.js exports createBudget", () => {
  const m = require("../budget");
  assert.equal(typeof m.createBudget, "function");
});

test("observation.js exports captureObservation", () => {
  const m = require("../observation");
  assert.equal(typeof m.captureObservation, "function");
});

test("executor.js exports validateAction and executeAction", () => {
  const m = require("../executor");
  assert.equal(typeof m.validateAction, "function");
  assert.equal(typeof m.executeAction, "function");
});

test("state.js exports createStateGraph", () => {
  const m = require("../state");
  assert.equal(typeof m.createStateGraph, "function");
});

test("prompts.js exports buildCacheablePrefix and buildStepSuffix", () => {
  const m = require("../prompts");
  assert.equal(typeof m.buildCacheablePrefix, "function");
  assert.equal(typeof m.buildStepSuffix, "function");
});

test("agent.js exports decideNextAction", () => {
  const m = require("../agent");
  assert.equal(typeof m.decideNextAction, "function");
});

test("agent-loop.js exports runAgentLoop", () => {
  const m = require("../agent-loop");
  assert.equal(typeof m.runAgentLoop, "function");
});

test("prompts.buildCacheablePrefix is cache-eligible (≥1024 chars)", () => {
  const prompts = require("../prompts");
  const prefix = prompts.buildCacheablePrefix();
  assert.equal(typeof prefix, "string");
  // Anthropic ephemeral cache requires ≥1024 tokens; rough heuristic ≥1024 chars.
  assert.ok(prefix.length >= 1024, `prefix too short: ${prefix.length}`);
});

test("agent-loop.runAgentLoop validates required opts", async () => {
  const loop = require("../agent-loop");
  await assert.rejects(() => loop.runAgentLoop({}), /targetPackage/);
  await assert.rejects(
    () => loop.runAgentLoop({ targetPackage: "com.a" }),
    /screenshotDir/,
  );
});
