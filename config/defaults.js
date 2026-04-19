"use strict";

const path = require("path");

module.exports = {
  PORT: process.env.PORT || 8080,
  USE_CRAWLER_V1: process.env.USE_CRAWLER_V1 !== "false",
  SKIP_AI_FOR_TESTS: process.env.SKIP_AI_FOR_TESTS === "true",
  UPLOAD_DEST: "/tmp/uploads/",
  SCREENSHOT_DIR_PREFIX: "/tmp/screenshots-",
  MAX_CRAWL_STEPS: 80,
  EMULATOR_AVD: "prodscope-test",
  SNAPSHOT_NAME: process.env.SNAPSHOT_NAME || "prodscope-ready",
  SNAPSHOT_BOOT_TIMEOUT: 30,   // seconds — snapshot restore should be fast
  COLD_BOOT_TIMEOUT: 240,      // seconds — fallback if no snapshot
  ANALYSIS_MODEL: "claude-haiku-4-5-20251001",
  REPORT_MODEL: "claude-sonnet-4-20250514",
  DB_PATH: process.env.DB_PATH || path.join(__dirname, "..", "data", "prodscope.db"),

  // Coverage thresholds
  SATURATION_VISIT_THRESHOLD: 4,  // min visits before a feature can be saturated
  SATURATION_STALE_WINDOW: 5,     // consecutive visits with no new fingerprints = saturated
  COVERED_UNIQUE_SCREENS: 2,      // unique screens needed for "covered" status

  // Oracle/triage thresholds (Week 4)
  MAX_AI_TRIAGE_SCREENS: 5,       // max screens sent to AI vision analysis (reduced from 8 — most apps have 3-4 distinct screen types)
  ACCESSIBILITY_MIN_TAP_DP: 48,   // minimum tap target size in dp
  SLOW_RESPONSE_THRESHOLD_MS: 12000, // screen transition > 12s = slow (emulator is inherently slow)

  // Budget allocation (percentages of MAX_CRAWL_STEPS)
  AUTH_BUDGET_PERCENT: 0.15,
  SURVEY_BUDGET_PERCENT: 0.25,
  EXPLORE_BUDGET_PERCENT: 0.45,
  VERIFY_BUDGET_PERCENT: 0.15,

  // Scroll
  MAX_SCROLLS_PER_SCREEN: 4,
  SCROLL_UNCHANGED_LIMIT: 2, // stop scrolling after N unchanged fingerprints

  // Vision (gated, in-crawl)
  MAX_VISION_CALLS_PER_CRAWL: 60,
  VISION_BUDGET_NATIVE: 20,        // native Android apps need fewer vision calls
  VISION_BUDGET_OBFUSCATED: 40,    // Compose/Flutter/RN need more vision calls
  VISION_MODEL: "claude-haiku-4-5-20251001",

  // Gestures
  LONG_PRESS_DURATION_MS: 800,

  // Loading detection
  LOADING_WAIT_TIMEOUT_MS: 8000,
  LOADING_POLL_INTERVAL_MS: 500,

  // Mode transitions
  VERIFY_MODE_THRESHOLD: 0.85,  // switch to VERIFY at 85% budget used
  REPLAN_AT_PERCENT: 0.5,       // replan at 50% budget used

  // Readiness engine
  READINESS_POLL_INTERVAL_MS: 250,        // how often to poll during readiness checks
  READINESS_SCREEN_TIMEOUT_MS: 5000,      // max wait for screen XML to stabilize
  READINESS_FOREGROUND_TIMEOUT_MS: 10000, // max wait for app to reach foreground
  READINESS_INTERACTIVE_TIMEOUT_MS: 5000, // max wait for UI to have clickable elements
  READINESS_MIN_STABLE_COUNT: 2,          // consecutive identical XML dumps = "settled"

  // Job timeout — hard ceiling to prevent zombie crawls
  MAX_CRAWL_DURATION_MS: 30 * 60 * 1000, // 30 minutes

  // V16 agent-first crawler — default engine since Phase 6 cutover (2026-04-19).
  // CRAWL_ENGINE=v15 still works for rollback, but the V15 sources live in
  // crawler/_v15-archive/ and are only reachable via that path.
  CRAWL_ENGINE: process.env.CRAWL_ENGINE || "v16",
  V16_MAX_COST_USD: Number(process.env.V16_MAX_COST_USD) || 0.12, // ₹10 hard ceiling
  V16_MAX_SONNET_ESCALATIONS: Number(process.env.V16_MAX_SONNET_ESCALATIONS) || 3,
};
