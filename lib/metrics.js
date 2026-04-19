"use strict";

/**
 * metrics.js — In-process metrics collector.
 *
 * Tracks crawl-level metrics and exposes them in Prometheus text format
 * via GET /metrics. No external dependencies (no StatsD/Datadog/etc).
 *
 * Metrics tracked:
 *   - prodscope_crawls_total (counter, by stop_reason)
 *   - prodscope_crawl_duration_seconds (histogram)
 *   - prodscope_unique_screens_total (histogram)
 *   - prodscope_vision_calls_total (counter)
 *   - prodscope_cost_per_crawl_inr (gauge, latest)
 *   - prodscope_job_queue_depth (gauge)
 *   - prodscope_recovery_attempts_total (counter)
 */

// ── Counters ────────────────────────────────────────────────────────────────

const crawlsByStopReason = {};
let totalCrawls = 0;
let totalVisionCalls = 0;
let totalRecoveryAttempts = 0;
let totalScreensCaptured = 0;

// ── Per-model token counters ───────────────────────────────────────────────

let haikuInputTokens = 0;
let haikuOutputTokens = 0;
let sonnetInputTokens = 0;
let sonnetOutputTokens = 0;
let totalCostInr = 0;

// ── Histograms (simple bucket-less: track sum, count, min, max) ─────────

const durations = [];
const uniqueScreenCounts = [];
const MAX_HISTORY = 100; // keep last N for percentile computation

// ── Gauges ──────────────────────────────────────────────────────────────────

let latestCostInr = 0;
let lastCrawlTimestamp = 0;
let consecutiveFailures = 0;

// ── Recording API ───────────────────────────────────────────────────────────

/**
 * Record completion of a crawl.
 * @param {{ stopReason: string, durationMs: number, uniqueScreens: number, visionCalls: number, recoveryAttempts: number, costInr: number, haikuTokens?: { input_tokens: number, output_tokens: number }, sonnetTokens?: { input_tokens: number, output_tokens: number } }} data
 */
function recordCrawl(data) {
  totalCrawls++;

  const reason = data.stopReason || "unknown";
  crawlsByStopReason[reason] = (crawlsByStopReason[reason] || 0) + 1;

  durations.push(data.durationMs / 1000);
  if (durations.length > MAX_HISTORY) durations.shift();

  uniqueScreenCounts.push(data.uniqueScreens || 0);
  if (uniqueScreenCounts.length > MAX_HISTORY) uniqueScreenCounts.shift();

  totalVisionCalls += data.visionCalls || 0;
  totalRecoveryAttempts += data.recoveryAttempts || 0;
  totalScreensCaptured += data.uniqueScreens || 0;
  latestCostInr = data.costInr || 0;
  totalCostInr += data.costInr || 0;
  lastCrawlTimestamp = Date.now();

  // Per-model token tracking
  if (data.haikuTokens) {
    haikuInputTokens += data.haikuTokens.input_tokens || 0;
    haikuOutputTokens += data.haikuTokens.output_tokens || 0;
  }
  if (data.sonnetTokens) {
    sonnetInputTokens += data.sonnetTokens.input_tokens || 0;
    sonnetOutputTokens += data.sonnetTokens.output_tokens || 0;
  }

  // Track consecutive failures
  const isFailure = ["device_offline", "capture_failed", "app_crash_loop", "action_execution_failed"].includes(reason);
  if (isFailure) {
    consecutiveFailures++;
  } else {
    consecutiveFailures = 0;
  }
}

// ── Prometheus text format ──────────────────────────────────────────────────

function toPrometheus() {
  const lines = [];

  // Crawls by stop reason
  lines.push("# HELP prodscope_crawls_total Total crawls completed");
  lines.push("# TYPE prodscope_crawls_total counter");
  for (const [reason, count] of Object.entries(crawlsByStopReason)) {
    lines.push(`prodscope_crawls_total{stop_reason="${reason}"} ${count}`);
  }
  if (totalCrawls === 0) {
    lines.push(`prodscope_crawls_total{stop_reason="none"} 0`);
  }

  // Duration
  lines.push("# HELP prodscope_crawl_duration_seconds Crawl duration in seconds");
  lines.push("# TYPE prodscope_crawl_duration_seconds summary");
  if (durations.length > 0) {
    const sorted = [...durations].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const sum = sorted.reduce((a, b) => a + b, 0);
    lines.push(`prodscope_crawl_duration_seconds{quantile="0.5"} ${p50.toFixed(2)}`);
    lines.push(`prodscope_crawl_duration_seconds{quantile="0.95"} ${p95.toFixed(2)}`);
    lines.push(`prodscope_crawl_duration_seconds_sum ${sum.toFixed(2)}`);
    lines.push(`prodscope_crawl_duration_seconds_count ${durations.length}`);
  }

  // Unique screens
  lines.push("# HELP prodscope_unique_screens Unique screens per crawl");
  lines.push("# TYPE prodscope_unique_screens summary");
  if (uniqueScreenCounts.length > 0) {
    const sorted = [...uniqueScreenCounts].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    lines.push(`prodscope_unique_screens{quantile="0.5"} ${p50}`);
    lines.push(`prodscope_unique_screens_avg ${avg.toFixed(1)}`);
  }

  // Vision calls
  lines.push("# HELP prodscope_vision_calls_total Total vision API calls");
  lines.push("# TYPE prodscope_vision_calls_total counter");
  lines.push(`prodscope_vision_calls_total ${totalVisionCalls}`);

  // Recovery
  lines.push("# HELP prodscope_recovery_attempts_total Total recovery attempts");
  lines.push("# TYPE prodscope_recovery_attempts_total counter");
  lines.push(`prodscope_recovery_attempts_total ${totalRecoveryAttempts}`);

  // Cost
  lines.push("# HELP prodscope_cost_inr_latest Latest crawl cost in INR");
  lines.push("# TYPE prodscope_cost_inr_latest gauge");
  lines.push(`prodscope_cost_inr_latest ${latestCostInr.toFixed(2)}`);

  // Screens captured
  lines.push("# HELP prodscope_screens_captured_total Total screens captured across all crawls");
  lines.push("# TYPE prodscope_screens_captured_total counter");
  lines.push(`prodscope_screens_captured_total ${totalScreensCaptured}`);

  // Per-model token counters
  lines.push("# HELP prodscope_tokens_total Total tokens consumed by model and direction");
  lines.push("# TYPE prodscope_tokens_total counter");
  lines.push(`prodscope_tokens_total{model="haiku",direction="input"} ${haikuInputTokens}`);
  lines.push(`prodscope_tokens_total{model="haiku",direction="output"} ${haikuOutputTokens}`);
  lines.push(`prodscope_tokens_total{model="sonnet",direction="input"} ${sonnetInputTokens}`);
  lines.push(`prodscope_tokens_total{model="sonnet",direction="output"} ${sonnetOutputTokens}`);

  // Total cost
  lines.push("# HELP prodscope_cost_inr_total Cumulative cost across all crawls in INR");
  lines.push("# TYPE prodscope_cost_inr_total counter");
  lines.push(`prodscope_cost_inr_total ${totalCostInr.toFixed(2)}`);

  // Consecutive failures
  lines.push("# HELP prodscope_consecutive_failures Current consecutive failure count");
  lines.push("# TYPE prodscope_consecutive_failures gauge");
  lines.push(`prodscope_consecutive_failures ${consecutiveFailures}`);

  return lines.join("\n") + "\n";
}

// ── JSON summary (for /health and internal use) ─────────────────────────────

function summary() {
  return {
    totalCrawls,
    crawlsByStopReason: { ...crawlsByStopReason },
    totalVisionCalls,
    totalRecoveryAttempts,
    totalScreensCaptured,
    latestCostInr,
    totalCostInr,
    consecutiveFailures,
    tokensByModel: {
      haiku: { input: haikuInputTokens, output: haikuOutputTokens },
      sonnet: { input: sonnetInputTokens, output: sonnetOutputTokens },
    },
    lastCrawlTimestamp: lastCrawlTimestamp ? new Date(lastCrawlTimestamp).toISOString() : null,
    avgDurationSeconds: durations.length > 0
      ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1)
      : null,
    avgUniqueScreens: uniqueScreenCounts.length > 0
      ? (uniqueScreenCounts.reduce((a, b) => a + b, 0) / uniqueScreenCounts.length).toFixed(1)
      : null,
  };
}

module.exports = { recordCrawl, toPrometheus, summary };
