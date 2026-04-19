"use strict";

/**
 * Integration test: metrics recording + Prometheus output + health summary.
 * Verifies the full metrics pipeline without requiring an emulator or API keys.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");

// We need to re-require metrics fresh each test to reset state.
// node:test runs in the same process, so we clear the cache.
function freshMetrics() {
  const key = require.resolve("../../lib/metrics");
  delete require.cache[key];
  return require("../../lib/metrics");
}

describe("Metrics integration", () => {
  let metrics;

  beforeEach(() => {
    metrics = freshMetrics();
  });

  it("records a crawl and exposes via summary()", () => {
    metrics.recordCrawl({
      stopReason: "max_steps_reached",
      durationMs: 120000,
      uniqueScreens: 20,
      visionCalls: 15,
      recoveryAttempts: 2,
      costInr: 8.50,
    });

    const s = metrics.summary();
    assert.strictEqual(s.totalCrawls, 1);
    assert.strictEqual(s.crawlsByStopReason["max_steps_reached"], 1);
    assert.strictEqual(s.totalVisionCalls, 15);
    assert.strictEqual(s.totalRecoveryAttempts, 2);
    assert.strictEqual(s.totalScreensCaptured, 20);
    assert.strictEqual(s.latestCostInr, 8.50);
    assert.strictEqual(s.consecutiveFailures, 0);
    assert.ok(s.lastCrawlTimestamp);
    assert.strictEqual(s.avgDurationSeconds, "120.0");
    assert.strictEqual(s.avgUniqueScreens, "20.0");
  });

  it("tracks consecutive failures correctly", () => {
    metrics.recordCrawl({ stopReason: "device_offline", durationMs: 5000, uniqueScreens: 0, visionCalls: 0, recoveryAttempts: 0, costInr: 0 });
    assert.strictEqual(metrics.summary().consecutiveFailures, 1);

    metrics.recordCrawl({ stopReason: "capture_failed", durationMs: 5000, uniqueScreens: 0, visionCalls: 0, recoveryAttempts: 0, costInr: 0 });
    assert.strictEqual(metrics.summary().consecutiveFailures, 2);

    // Success resets the counter
    metrics.recordCrawl({ stopReason: "max_steps_reached", durationMs: 60000, uniqueScreens: 10, visionCalls: 5, recoveryAttempts: 0, costInr: 5 });
    assert.strictEqual(metrics.summary().consecutiveFailures, 0);
  });

  it("aggregates multiple crawls", () => {
    metrics.recordCrawl({ stopReason: "max_steps_reached", durationMs: 60000, uniqueScreens: 10, visionCalls: 5, recoveryAttempts: 1, costInr: 5 });
    metrics.recordCrawl({ stopReason: "exploration_exhausted", durationMs: 120000, uniqueScreens: 25, visionCalls: 20, recoveryAttempts: 3, costInr: 9 });

    const s = metrics.summary();
    assert.strictEqual(s.totalCrawls, 2);
    assert.strictEqual(s.crawlsByStopReason["max_steps_reached"], 1);
    assert.strictEqual(s.crawlsByStopReason["exploration_exhausted"], 1);
    assert.strictEqual(s.totalVisionCalls, 25);
    assert.strictEqual(s.totalRecoveryAttempts, 4);
    assert.strictEqual(s.totalScreensCaptured, 35);
    assert.strictEqual(s.latestCostInr, 9);
  });

  it("produces valid Prometheus text format", () => {
    metrics.recordCrawl({ stopReason: "max_steps_reached", durationMs: 60000, uniqueScreens: 10, visionCalls: 5, recoveryAttempts: 1, costInr: 5 });

    const prom = metrics.toPrometheus();
    assert.ok(prom.includes("# HELP prodscope_crawls_total"));
    assert.ok(prom.includes("# TYPE prodscope_crawls_total counter"));
    assert.ok(prom.includes('prodscope_crawls_total{stop_reason="max_steps_reached"} 1'));
    assert.ok(prom.includes("prodscope_vision_calls_total 5"));
    assert.ok(prom.includes("prodscope_recovery_attempts_total 1"));
    assert.ok(prom.includes("prodscope_cost_inr_latest 5.00"));
    assert.ok(prom.includes("prodscope_screens_captured_total 10"));
    assert.ok(prom.includes("prodscope_consecutive_failures 0"));
    assert.ok(prom.includes('prodscope_crawl_duration_seconds{quantile="0.5"}'));
  });

  it("handles zero crawls in Prometheus output", () => {
    const prom = metrics.toPrometheus();
    assert.ok(prom.includes('prodscope_crawls_total{stop_reason="none"} 0'));
    assert.ok(prom.includes("prodscope_vision_calls_total 0"));
  });
});
