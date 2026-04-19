"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { getHistoricalScore, choose } = require("../policy");

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function makeScreenMemory(fingerprint, actionOutcomes) {
  const mem = new Map();
  mem.set(fingerprint, { actionOutcomes });
  return mem;
}

function makeMinimalGraph(fingerprint) {
  return {
    triedActionsFor: () => new Set(),
    badActionsFor: () => new Set(),
    nodes: new Map([[fingerprint, { actionOutcomes: new Map(), screenData: {} }]]),
    transitions: [],
    visitCount: () => 0,
    detectLoop: () => false,
    uniqueStateCount: () => 5,
  };
}

/* ── getHistoricalScore unit tests ───────────────────────────────────────── */

describe("getHistoricalScore", () => {
  it("returns 0 when screenMemory is null", () => {
    const score = getHistoricalScore({ key: "tap:a:1,1" }, null, "fp1");
    assert.strictEqual(score, 0);
  });

  it("returns 0 when fingerprint not in memory", () => {
    const mem = makeScreenMemory("fp1", { "tap:a:1,1": { ok: 10, bad: 0, newScreen: 5, lastOutcome: "ok" } });
    const score = getHistoricalScore({ key: "tap:a:1,1" }, mem, "fp_other");
    assert.strictEqual(score, 0);
  });

  it("returns 0 when action has no entry", () => {
    const mem = makeScreenMemory("fp1", {});
    const score = getHistoricalScore({ key: "tap:a:1,1" }, mem, "fp1");
    assert.strictEqual(score, 0);
  });

  it("returns 0 below noise floor (< 3 total observations)", () => {
    const mem = makeScreenMemory("fp1", { "tap:a:1,1": { ok: 2, bad: 0, newScreen: 2, lastOutcome: "ok" } });
    const score = getHistoricalScore({ key: "tap:a:1,1" }, mem, "fp1");
    assert.strictEqual(score, 0, "2 observations is below noise floor");
  });

  it("returns positive score for consistently successful action", () => {
    // 10 ok, 0 bad, 8 newScreen → total=10, successRate=1.0, noveltyRate=0.8, confidence=1.0
    // raw = 1.0 * 8 + 0.8 * 4 = 8 + 3.2 = 11.2 → round(11.2) = 11
    const mem = makeScreenMemory("fp1", { "tap:a:1,1": { ok: 10, bad: 0, newScreen: 8, lastOutcome: "ok" } });
    const score = getHistoricalScore({ key: "tap:a:1,1" }, mem, "fp1");
    assert.strictEqual(score, 11);
  });

  it("returns lower score when success rate is mixed", () => {
    // 5 ok, 5 bad, 2 newScreen → total=10, successRate=0.5, noveltyRate=0.2, confidence=1.0
    // raw = 0.5 * 8 + 0.2 * 4 = 4 + 0.8 = 4.8 → round(4.8) = 5
    const mem = makeScreenMemory("fp1", { "tap:a:1,1": { ok: 5, bad: 5, newScreen: 2, lastOutcome: "ok" } });
    const score = getHistoricalScore({ key: "tap:a:1,1" }, mem, "fp1");
    assert.strictEqual(score, 5);
  });

  it("scales by confidence when below 10 observations", () => {
    // 3 ok, 0 bad, 3 newScreen → total=3, successRate=1.0, noveltyRate=1.0, confidence=0.3
    // raw = 1.0 * 8 + 1.0 * 4 = 12, score = round(12 * 0.3) = round(3.6) = 4
    const mem = makeScreenMemory("fp1", { "tap:a:1,1": { ok: 3, bad: 0, newScreen: 3, lastOutcome: "ok" } });
    const score = getHistoricalScore({ key: "tap:a:1,1" }, mem, "fp1");
    assert.strictEqual(score, 4);
  });

  it("caps confidence at 1.0 for >=10 observations", () => {
    // 50 ok, 0 bad, 50 newScreen → successRate=1.0, noveltyRate=1.0, confidence=1.0 (capped)
    // raw = 1.0 * 8 + 1.0 * 4 = 12 → score = 12
    const mem = makeScreenMemory("fp1", { "tap:a:1,1": { ok: 50, bad: 0, newScreen: 50, lastOutcome: "ok" } });
    const score = getHistoricalScore({ key: "tap:a:1,1" }, mem, "fp1");
    assert.strictEqual(score, 12);
  });

  it("ignores legacy string entries (v1 shape) gracefully", () => {
    const mem = new Map();
    mem.set("fp1", { actionOutcomes: { "tap:a:1,1": "ineffective" } });
    const score = getHistoricalScore({ key: "tap:a:1,1" }, mem, "fp1");
    assert.strictEqual(score, 0, "legacy string entries contribute no positive signal");
  });

  it("handles missing optional fields defensively", () => {
    const mem = makeScreenMemory("fp1", { "tap:a:1,1": { ok: 5 } }); // bad/newScreen missing
    const score = getHistoricalScore({ key: "tap:a:1,1" }, mem, "fp1");
    // total = 5, successRate = 1.0, noveltyRate = 0, confidence = 0.5
    // raw = 1.0 * 8 + 0 * 4 = 8 → round(8 * 0.5) = 4
    assert.strictEqual(score, 4);
  });
});

/* ── choose() integration with screenMemory ──────────────────────────────── */

describe("policy.choose with historical screen memory", () => {
  it("prefers historically successful action over untested competitor with same base priority", () => {
    const fp = "fp_home";
    const graph = makeMinimalGraph(fp);

    const candidates = [
      { key: "tap:loginBtn:100,200", type: "tap", priority: 50, text: "Login" },
      { key: "tap:otherBtn:300,400", type: "tap", priority: 50, text: "Other" },
    ];

    const mem = makeScreenMemory(fp, {
      "tap:loginBtn:100,200": { ok: 12, bad: 0, newScreen: 10, lastOutcome: "ok" },
    });

    const decision = choose(candidates, graph, fp, { screenMemory: mem });

    assert.strictEqual(decision.action.key, "tap:loginBtn:100,200", "Historically successful action should win");
    assert.ok(
      decision.action._historicalBoost > 0,
      `Expected historical boost > 0, got ${decision.action._historicalBoost}`
    );
  });

  it("does not override a significantly higher base priority", () => {
    const fp = "fp_home";
    const graph = makeMinimalGraph(fp);

    const candidates = [
      { key: "tap:a:100,200", type: "tap", priority: 100, text: "A" }, // high base
      { key: "tap:b:300,400", type: "tap", priority: 50, text: "B" },
    ];

    // B has max historical boost (~12) but A's base advantage is 50
    const mem = makeScreenMemory(fp, {
      "tap:b:300,400": { ok: 50, bad: 0, newScreen: 50, lastOutcome: "ok" },
    });

    const decision = choose(candidates, graph, fp, { screenMemory: mem });

    assert.strictEqual(decision.action.key, "tap:a:100,200", "Base priority should still dominate large gaps");
  });

  it("works without screenMemory (backwards compatible)", () => {
    const fp = "fp_home";
    const graph = makeMinimalGraph(fp);

    const candidates = [
      { key: "tap:a:100,200", type: "tap", priority: 50, text: "A" },
    ];

    const decision = choose(candidates, graph, fp, {});

    assert.strictEqual(decision.action.key, "tap:a:100,200");
    assert.strictEqual(decision.action._historicalBoost, 0);
  });
});
