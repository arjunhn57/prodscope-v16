"use strict";

const path = require("path");

module.exports = {
  PORT: process.env.PORT || 8080,
  USE_CRAWLER_V1: process.env.USE_CRAWLER_V1 !== "false",
  SKIP_AI_FOR_TESTS: process.env.SKIP_AI_FOR_TESTS === "true",
  UPLOAD_DEST: "/tmp/uploads/",
  SCREENSHOT_DIR_PREFIX: "/tmp/screenshots-",
  // 2026-04-26 (Phase E1): 120 → 60. Even with v6 fixes the agent wastes
  // ~30% of late steps on hub-bouncing on feature-rich apps. Capping at
  // 60 cuts Haiku classifier calls + total walltime substantially.
  // Trade-off: ~40 unique screens captured vs ~73 at 120 — V2 only cited
  // ~3 anyway, so no functional loss to the deliverable.
  MAX_CRAWL_STEPS: 60,
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
  // MAX_AI_TRIAGE_SCREENS is the legacy cap on per-screen deep analysis.
  // Phase 3.1 introduced a 3-stage oracle: Stage 1 ranks all screens cheaply
  // (no image), Stage 2 deep-analyzes the top K (with image), Stage 3
  // synthesizes. MAX_DEEP_ANALYZE_SCREENS is the new Stage 2 cap.
  // MAX_AI_TRIAGE_SCREENS stays as a fallback for the pre-Stage-1 code path
  // until everything's wired — do NOT delete yet.
  MAX_AI_TRIAGE_SCREENS: 5,
  // 2026-04-26 (Phase E6): 10 → 5. K=10 is generous when V2 only cites
  // ~3 screens anyway. Halves Stage 2 oracle cost. Roll back to 10 if
  // V2 narrative quality drops materially.
  MAX_DEEP_ANALYZE_SCREENS: Number(process.env.MAX_DEEP_ANALYZE_SCREENS) || 5,
  // Feature flag: setting ORACLE_STAGE1_ENABLED=false bypasses Stage 1 and
  // the Stage 3 high-signal router, falling back to the legacy unconditional
  // Sonnet pipeline. This is the documented rollback path for Phase 3.1.
  ORACLE_STAGE1_ENABLED: process.env.ORACLE_STAGE1_ENABLED !== "false",
  // If every published critical_bug has confidence >= this threshold AND
  // there are at least 3 of them, Stage 3 skips Sonnet and renders a
  // deterministic narrative from the Stage 2 tool-use schema.
  SONNET_SKIP_CONFIDENCE_THRESHOLD: Number(process.env.SONNET_SKIP_CONFIDENCE_THRESHOLD) || 0.8,
  SONNET_SKIP_MIN_CRITICAL_BUGS: Number(process.env.SONNET_SKIP_MIN_CRITICAL_BUGS) || 3,
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
  // 2026-04-25 v6: cost ceiling raised from $0.12 to $0.20. Diligence
  // reports priced $99-$499 — $0.20 is a tight cap that still gives
  // feature-rich apps (biztoso-class) room to drill past the bottom-nav.
  // Drill-down preference + hub-revisit detector do the heavy lifting on
  // efficiency; this only adds a modest budget cushion.
  V16_MAX_COST_USD: Number(process.env.V16_MAX_COST_USD) || 0.20,
  // 2026-04-26 (Phase E2): 6 → 2. Sonnet stays reserved primarily for
  // V2 report synthesis; in-crawl escalations rarely fire (biztoso=0,
  // Bluesky=0). 2 is a buffer for genuinely hard auth/cred screens.
  V16_MAX_SONNET_ESCALATIONS: Number(process.env.V16_MAX_SONNET_ESCALATIONS) || 2,
};
