"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBudget, PRICING } = require("../budget");

test("createBudget uses defaults when no config", () => {
  const b = createBudget();
  const s = b.snapshot();
  assert.equal(s.stepsUsed, 0);
  assert.equal(s.costUsd, 0);
  assert.equal(s.sonnetEscalationsUsed, 0);
  assert.equal(s.haikuCallsUsed, 0);
  assert.equal(s.maxSteps, 80);
  assert.equal(s.maxCostUsd, 0.12);
  assert.equal(s.maxSonnetEscalations, 3);
  assert.equal(s.exhaustedReason, null);
});

test("step() increments stepsUsed and exhausts at maxSteps", () => {
  const b = createBudget({ maxSteps: 3 });
  for (let i = 0; i < 2; i++) b.step();
  assert.equal(b.exhausted(), null);
  b.step();
  assert.equal(b.exhausted(), "max_steps_reached");
});

test("recordLlmCall accumulates Haiku cost with uncached input", () => {
  const b = createBudget();
  b.recordLlmCall("haiku", 1000, 200);
  const s = b.snapshot();
  const expected = (1000 * PRICING.haiku.inputPerM + 200 * PRICING.haiku.outputPerM) / 1_000_000;
  assert.ok(Math.abs(s.costUsd - expected) < 1e-9, `cost ${s.costUsd} vs expected ${expected}`);
  assert.equal(s.haikuCallsUsed, 1);
  assert.equal(s.sonnetEscalationsUsed, 0);
});

test("recordLlmCall uses cached price for cached tokens", () => {
  const b = createBudget();
  b.recordLlmCall("haiku", 5000, 100, 4000);
  const uncached = 1000;
  const cached = 4000;
  const expected =
    (uncached * PRICING.haiku.inputPerM) / 1e6 +
    (cached * PRICING.haiku.cachedInputPerM) / 1e6 +
    (100 * PRICING.haiku.outputPerM) / 1e6;
  assert.ok(Math.abs(b.snapshot().costUsd - expected) < 1e-9);
});

test("Sonnet escalations counted and capped by canEscalateToSonnet", () => {
  const b = createBudget({ maxSonnetEscalations: 2 });
  assert.equal(b.canEscalateToSonnet(), true);
  b.recordLlmCall("sonnet", 1000, 100);
  b.recordLlmCall("sonnet", 1000, 100);
  const s = b.snapshot();
  assert.equal(s.sonnetEscalationsUsed, 2);
  assert.equal(b.canEscalateToSonnet(), false);
});

test("exhausted() returns budget_exhausted when cost >= maxCostUsd", () => {
  const b = createBudget({ maxCostUsd: 0.01 });
  b.recordLlmCall("sonnet", 10000, 2000); // 10000*3/1M + 2000*15/1M = 0.03 + 0.03 = 0.06
  assert.equal(b.exhausted(), "budget_exhausted");
});

test("canEscalateToSonnet returns false when cost cap hit even if escalation count low", () => {
  const b = createBudget({ maxCostUsd: 0.005 });
  b.recordLlmCall("haiku", 10000, 10000); // 0.01 + 0.05 = 0.06 > 0.005
  assert.equal(b.canEscalateToSonnet(), false);
});

test("recordLlmCall rejects unknown model", () => {
  const b = createBudget();
  assert.throws(() => b.recordLlmCall("gpt-4", 100, 100), /unknown model/);
});

test("aggressively-compressed 80-step Haiku crawl fits in ₹10 ceiling", () => {
  // Projected Phase-3 prompt compression (matches prompts.js design):
  //   - Prefix 4K tokens cached after step 1
  //   - Suffix 300 tokens (3-step history + fingerprint + last action + budget)
  //   - Screenshot 750 tokens (downscaled 540x1200), included every 3rd FP-change step ≈ 12/80
  //   - Output capped at 80 tokens
  const b = createBudget();

  // Step 1: full uncached prefix + suffix + screenshot + output
  b.recordLlmCall("haiku", 4000 + 300 + 750, 80, 0);

  for (let i = 2; i <= 80; i++) {
    const hasImage = i % 7 === 0; // sparse: ~12 of 79 steps
    const input = (hasImage ? 750 : 0) + 300 + 4000;
    b.recordLlmCall("haiku", input, 80, 4000);
  }

  const s = b.snapshot();
  assert.ok(
    s.costUsd <= 0.12,
    `compressed 80-step crawl cost ${s.costUsd.toFixed(4)} exceeds ₹10 ceiling`,
  );
  assert.equal(s.haikuCallsUsed, 80);
});

test("pauseWallClock subtracts paused time from wallMsElapsed", async () => {
  const b = createBudget();
  await new Promise((r) => setTimeout(r, 30));
  b.pauseWallClock();
  await new Promise((r) => setTimeout(r, 80));
  b.resumeWallClock();
  await new Promise((r) => setTimeout(r, 30));
  const s = b.snapshot();
  // Total wall time ≈ 140ms, paused ≈ 80ms → elapsed should be ~60ms
  assert.ok(s.wallMsElapsed < 120, `expected <120ms, got ${s.wallMsElapsed}`);
  assert.ok(s.wallMsElapsed >= 40, `expected ≥40ms, got ${s.wallMsElapsed}`);
  assert.ok(s.pausedMs >= 70, `expected pausedMs ≥70ms, got ${s.pausedMs}`);
  assert.equal(s.paused, false);
});

test("wallMsElapsed excludes currently-paused interval", async () => {
  const b = createBudget();
  await new Promise((r) => setTimeout(r, 40));
  b.pauseWallClock();
  await new Promise((r) => setTimeout(r, 60));
  const s = b.snapshot();
  assert.equal(s.paused, true);
  assert.ok(s.wallMsElapsed < 60, `expected <60ms while paused, got ${s.wallMsElapsed}`);
});

test("multiple pause/resume cycles accumulate pausedMs", async () => {
  const b = createBudget();
  for (let i = 0; i < 3; i++) {
    b.pauseWallClock();
    await new Promise((r) => setTimeout(r, 25));
    b.resumeWallClock();
    await new Promise((r) => setTimeout(r, 10));
  }
  const s = b.snapshot();
  assert.ok(s.pausedMs >= 60, `expected cumulative pause ≥60ms, got ${s.pausedMs}`);
});

test("double pauseWallClock is idempotent", () => {
  const b = createBudget();
  b.pauseWallClock();
  b.pauseWallClock(); // should not reset pausedAt
  const s1 = b.snapshot();
  assert.equal(s1.paused, true);
  b.resumeWallClock();
  const s2 = b.snapshot();
  assert.equal(s2.paused, false);
});

test("resume without pause is a no-op", () => {
  const b = createBudget();
  b.resumeWallClock(); // should not crash or flip state
  const s = b.snapshot();
  assert.equal(s.paused, false);
  assert.equal(s.pausedMs, 0);
});

test("pause does NOT stop cost or step accumulation", () => {
  const b = createBudget();
  b.pauseWallClock();
  b.step();
  b.recordLlmCall("haiku", 1000, 200);
  const s = b.snapshot();
  assert.equal(s.stepsUsed, 1);
  assert.ok(s.costUsd > 0);
});

test("wallclock timeout respects paused time", () => {
  const b = createBudget({ maxWallMs: 50 });
  b.pauseWallClock();
  // Even after real time passes, timeout should not fire while paused
  const start = Date.now();
  while (Date.now() - start < 70) {
    /* busy wait */
  }
  assert.equal(b.exhausted(), null, "should not be exhausted while paused");
  b.resumeWallClock();
});

test("non-compressed 80-step crawl WOULD exceed ceiling (validates enforcement is needed)", () => {
  // Naïve: full image every step, no caching, big suffix, 200-token outputs.
  const b = createBudget();
  for (let i = 1; i <= 80; i++) {
    b.recordLlmCall("haiku", 4000 + 1000 + 1500, 200, 0);
  }
  const s = b.snapshot();
  assert.ok(s.costUsd > 0.12, `expected uncompressed to exceed cap, got ${s.costUsd}`);
  assert.equal(b.exhausted(), "budget_exhausted");
});
