"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const { checkCyclingLoop, checkNoNewState, checkDiscoveryRate, checkSoftRevisit } = require("../stuck-detector");

// Suppress console.log during tests
const origLog = console.log;
beforeEach(() => { console.log = () => {}; });
process.on("exit", () => { console.log = origLog; });

function makeCtx(overrides = {}) {
  return {
    recentFpWindow: [],
    consecutiveNoNewState: 0,
    discoveryWindow: [],
    discoveryStopEligibleStep: 40,
    homeFingerprint: "home_fp",
    coverageTracker: null,
    ...overrides,
  };
}

describe("checkCyclingLoop", () => {
  it("does not flag with diverse fingerprints", () => {
    const ctx = makeCtx();
    for (let i = 0; i < 12; i++) {
      const result = checkCyclingLoop(ctx, `fp_${i}`);
      assert.strictEqual(result.stuck, false);
    }
  });

  it("flags when cycling among few fingerprints", () => {
    const ctx = makeCtx();
    const fps = ["a", "b", "c"]; // only 3 unique, threshold is 4
    let stuck = false;
    for (let i = 0; i < 20; i++) {
      const result = checkCyclingLoop(ctx, fps[i % 3]);
      if (result.stuck) { stuck = true; break; }
    }
    assert.strictEqual(stuck, true);
  });

  it("does not flag home fingerprint cycling", () => {
    const ctx = makeCtx({ homeFingerprint: "home" });
    // Fill window with just "home" — should NOT trigger cycling since home is excluded
    for (let i = 0; i < 12; i++) {
      const result = checkCyclingLoop(ctx, "home");
      assert.strictEqual(result.stuck, false);
    }
  });

  it("resets window after detection", () => {
    const ctx = makeCtx();
    for (let i = 0; i < 12; i++) {
      checkCyclingLoop(ctx, `fp_${i % 2}`); // only 2 unique
    }
    // After stuck detection, window should be cleared
    assert.strictEqual(ctx.recentFpWindow.length, 0);
  });

  it("maintains sliding window of CYCLE_WINDOW size", () => {
    const ctx = makeCtx();
    for (let i = 0; i < 20; i++) {
      checkCyclingLoop(ctx, `fp_${i}`); // all unique, never stuck
    }
    assert.ok(ctx.recentFpWindow.length <= 12);
  });
});

describe("checkNoNewState", () => {
  it("resets counter on new state", () => {
    const ctx = makeCtx({ consecutiveNoNewState: 5 });
    checkNoNewState(ctx, true);
    assert.strictEqual(ctx.consecutiveNoNewState, 0);
  });

  it("increments counter on revisit", () => {
    const ctx = makeCtx();
    checkNoNewState(ctx, false);
    assert.strictEqual(ctx.consecutiveNoNewState, 1);
  });

  it("does not stall before threshold", () => {
    const ctx = makeCtx();
    for (let i = 0; i < 7; i++) {
      const result = checkNoNewState(ctx, false);
      assert.strictEqual(result.stalled, false);
    }
  });

  it("stalls at threshold (8)", () => {
    const ctx = makeCtx();
    let stalled = false;
    for (let i = 0; i < 10; i++) {
      const result = checkNoNewState(ctx, false);
      if (result.stalled) { stalled = true; break; }
    }
    assert.strictEqual(stalled, true);
    assert.strictEqual(ctx.consecutiveNoNewState, 8);
  });
});

describe("checkDiscoveryRate", () => {
  it("does not trigger before eligible step", () => {
    const ctx = makeCtx({ discoveryStopEligibleStep: 40 });
    for (let i = 0; i < 12; i++) {
      const result = checkDiscoveryRate(ctx, false, 10);
      assert.strictEqual(result.exhausted, false);
    }
  });

  it("does not trigger without full window", () => {
    const ctx = makeCtx({ discoveryStopEligibleStep: 5 });
    for (let i = 0; i < 5; i++) {
      const result = checkDiscoveryRate(ctx, false, 10);
      assert.strictEqual(result.exhausted, false);
    }
  });

  it("triggers when no discoveries and all saturated", () => {
    const ctx = makeCtx({
      discoveryStopEligibleStep: 5,
      coverageTracker: { allSaturated: () => true },
    });
    let exhausted = false;
    for (let i = 0; i < 15; i++) {
      const result = checkDiscoveryRate(ctx, false, 10);
      if (result.exhausted) { exhausted = true; break; }
    }
    assert.strictEqual(exhausted, true);
  });

  it("does not trigger when discoveries exist", () => {
    const ctx = makeCtx({
      discoveryStopEligibleStep: 5,
      coverageTracker: { allSaturated: () => true },
    });
    for (let i = 0; i < 15; i++) {
      // Every other step is a new discovery
      const result = checkDiscoveryRate(ctx, i % 3 === 0, 10);
      assert.strictEqual(result.exhausted, false);
    }
  });

  it("does not trigger when not all saturated", () => {
    const ctx = makeCtx({
      discoveryStopEligibleStep: 5,
      coverageTracker: { allSaturated: () => false },
    });
    for (let i = 0; i < 15; i++) {
      const result = checkDiscoveryRate(ctx, false, 10);
      assert.strictEqual(result.exhausted, false);
    }
  });
});

describe("checkSoftRevisit", () => {
  it("returns false with no hashes", () => {
    const result = checkSoftRevisit(null, []);
    assert.strictEqual(result.isSoftRevisit, false);
  });

  it("returns false for 'no_screenshot'", () => {
    const result = checkSoftRevisit("no_screenshot", ["abc123"]);
    assert.strictEqual(result.isSoftRevisit, false);
  });

  it("returns false for empty recent hashes", () => {
    const result = checkSoftRevisit("abc123", []);
    assert.strictEqual(result.isSoftRevisit, false);
  });

  it("detects soft revisit with identical hash", () => {
    const result = checkSoftRevisit("abcdef1234567890", ["abcdef1234567890"]);
    assert.strictEqual(result.isSoftRevisit, true);
    assert.strictEqual(result.closestDistance, 0);
  });

  it("skips no_screenshot entries in recent hashes", () => {
    const result = checkSoftRevisit("abcdef1234567890", ["no_screenshot", "no_screenshot"]);
    assert.strictEqual(result.isSoftRevisit, false);
    assert.strictEqual(result.closestDistance, 64);
  });
});
