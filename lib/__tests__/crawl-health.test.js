"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeDriverHits,
  crossedFirstDecisionBoundary,
} = require("../crawl-health");

// ── computeDriverHits ──────────────────────────────────────────────────────

test("computeDriverHits — empty / missing input returns empty object", () => {
  assert.deepEqual(computeDriverHits([]), {});
  assert.deepEqual(computeDriverHits(null), {});
  assert.deepEqual(computeDriverHits(undefined), {});
});

test("computeDriverHits — tallies each driver name separately", () => {
  const hits = computeDriverHits([
    { driver: "AuthDriver" },
    { driver: "ExplorationDriver" },
    { driver: "AuthDriver" },
    { driver: "LLMFallback" },
    { driver: "AuthDriver" },
  ]);
  assert.equal(hits.AuthDriver, 3);
  assert.equal(hits.ExplorationDriver, 1);
  assert.equal(hits.LLMFallback, 1);
});

test("computeDriverHits — falls back to .model when .driver missing", () => {
  const hits = computeDriverHits([
    { model: "claude-haiku-4-5" },
    { model: "claude-haiku-4-5" },
  ]);
  assert.equal(hits["claude-haiku-4-5"], 2);
});

test("computeDriverHits — null entries don't crash", () => {
  const hits = computeDriverHits([null, { driver: "AuthDriver" }, undefined]);
  assert.equal(hits.AuthDriver, 1);
});

// ── crossedFirstDecisionBoundary ──────────────────────────────────────────

test("boundary: driver other than LLMFallback acted → true", () => {
  const result = crossedFirstDecisionBoundary(
    [{ driver: "AuthDriver" }, { driver: "LLMFallback" }],
    2,
  );
  assert.equal(result, true);
});

test("boundary: only LLMFallback acted AND <= 4 screens → false", () => {
  const result = crossedFirstDecisionBoundary(
    [{ driver: "LLMFallback" }, { driver: "LLMFallback" }],
    3,
  );
  assert.equal(result, false);
});

test("boundary: only LLMFallback acted BUT > 4 screens → true (raw coverage wins)", () => {
  const result = crossedFirstDecisionBoundary(
    [{ driver: "LLMFallback" }, { driver: "LLMFallback" }],
    12,
  );
  assert.equal(result, true);
});

test("boundary: empty actions + 0 screens → false", () => {
  assert.equal(crossedFirstDecisionBoundary([], 0), false);
});

test("boundary: empty actions + 10 screens → true", () => {
  assert.equal(crossedFirstDecisionBoundary([], 10), true);
});

test("boundary: exactly 4 screens is NOT enough, 5 IS", () => {
  assert.equal(crossedFirstDecisionBoundary([{ driver: "LLMFallback" }], 4), false);
  assert.equal(crossedFirstDecisionBoundary([{ driver: "LLMFallback" }], 5), true);
});

test("boundary: undefined uniqueStates is treated as 0, not as boundary-crossed", () => {
  assert.equal(crossedFirstDecisionBoundary([{ driver: "LLMFallback" }], undefined), false);
});
