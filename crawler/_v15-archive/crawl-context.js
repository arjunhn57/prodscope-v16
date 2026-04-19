// @ts-check
"use strict";

/**
 * crawl-context.js — Explicit state container for a single crawl session.
 *
 * Replaces 40+ mutable variables scattered across runCrawl().
 * Every extracted module receives ctx as its first argument.
 *
 * @typedef {import('./types/crawl-context').CrawlContext} CrawlContextType
 * @typedef {import('./types/crawl-context').CrawlContextConfig} CrawlContextConfig
 * @typedef {import('./types/crawl-context').ScreenMemoryEntry} ScreenMemoryEntry
 * @typedef {import('./types/crawl-context').Classification} Classification
 * @typedef {import('./types/crawl-context').AppKnowledge} AppKnowledge
 * @typedef {import('./types/crawl-context').JournalEntry} JournalEntry
 * @typedef {import('./types/crawl-context').VisionResult} VisionResult
 * @typedef {import('./types/crawl-context').StateGraphLike} StateGraphLike
 */

const { AuthStateMachine } = require("./auth-state-machine");
const { PerceptionCache } = require("./vision-perception");
const { createCredentialState } = require("./auth-action-selector");
const { createCrawlLogger } = require("../lib/logger");
const { AppMap } = require("./app-map");

// Constants that were previously inline in runCrawl()
const MAX_NO_NEW_STATE = parseInt(process.env.MAX_NO_NEW_STATE || "8", 10);
const DISCOVERY_WINDOW_SIZE = 12;
const DISCOVERY_MIN_RATE = 1;
const CYCLE_WINDOW = 12;
const CYCLE_UNIQUE_THRESHOLD = 4;
const MAX_DEVICE_FAILS = 3;
const MAX_CAPTURE_FAILS = 3;
const MAX_CAPTURE_RECOVERIES = 3;
const MAX_AUTH_FILLS = 5;
const MAX_OUT_OF_APP_RECOVERIES = 8;
const AUTH_FLOW_MAX_STEPS = 8;
const MAX_SAME_AUTH_SUBMIT = 3;
const JOURNAL_MAX = 12;
const SOFT_REVISIT_WINDOW = 16;
const SOFT_REVISIT_THRESHOLD = 6;
const MAX_GLOBAL_RECOVERIES = 15; // H4: circuit breaker threshold

const VISION_SCREEN_TO_FEATURE = {
  login: "auth_flow", feed: "browsing", settings: "settings",
  detail: "content_viewing", search: "search", dialog: "interaction",
  form: "data_entry", nav_hub: "browsing", error: "error_handling",
  loading: "other", other: "other",
};

const VISION_NAV_FILTER = /\b(back|home|return|previous|main feed|navigate to|go to main|go back)\b/i;

/**
 * @implements {CrawlContextType}
 */
class CrawlContext {
  /**
   * @param {CrawlContextConfig} config
   */
  constructor(config) {
    // ── Config (immutable for the crawl) ──
    this.screenshotDir = config.screenshotDir;
    this.packageName = config.packageName;
    this.credentials = config.credentials;
    this.goldenPath = config.goldenPath || null;
    this.goals = config.goals || "";
    this.painPoints = config.painPoints || "";
    this.maxSteps = config.maxSteps || 20;
    this.onProgress = config.onProgress || null;
    this.launcherActivity = (config.appProfile && config.appProfile.launcherActivity) || null;
    this.hasValidCredentials = !!(
      config.credentials &&
      (config.credentials.email || config.credentials.username) &&
      config.credentials.password
    );

    // ── Structured logging ──
    this.traceId = config.traceId || null;
    this.log = config.log || createCrawlLogger(config.jobId || "unknown", config.traceId);

    // ── Strategic exploration ──
    this.appMap = new AppMap();

    // ── Core crawl state ──
    /** @type {any} */
    this.stateGraph = null;       // set by caller after construction
    /** @type {any[]} */
    this.screens = [];
    /** @type {any[]} */
    this.actionsTaken = [];
    this.stopReason = "max_steps_reached";
    /** @type {any} */
    this.metrics = null;          // set by caller

    // ── Staleness / discovery ──
    this.consecutiveNoNewState = 0;
    /** @type {unknown[]} */
    this.discoveryWindow = [];
    this.discoveryStopEligibleStep = Math.floor(this.maxSteps * 0.5);
    /** @type {string[]} */
    this.recentFpWindow = [];
    /** @type {string[]} */
    this.recentScreenshotHashes = [];  // sliding window for soft-revisit detection

    // ── Device health ──
    this.consecutiveDeviceFails = 0;
    this.consecutiveCaptureFails = 0;
    this.totalCaptureRecoveries = 0;

    // ── Auth state (managed by AuthStateMachine) ──
    this.authMachine = new AuthStateMachine(config.credentials || {});
    /** @type {import('./types/crawl-context').CredentialState} */
    this.credentialState = /** @type {any} */ (createCredentialState()); // Perception-driven auth tracking
    /** @type {Set<string>} */
    this.handledFormScreens = new Set();
    /** @type {Set<string>} */
    this.filledFingerprints = new Set();
    /** @type {Map<string, number>} */
    this.visitedCounts = new Map();
    // Legacy fields — wired through authMachine, kept for modules not yet migrated
    this.authFillCount = 0;  // synced from authMachine.fillCount
    this.authFlowActive = false;  // synced from authMachine.isActive
    this.authFlowStepsRemaining = 0;
    /** @type {string | null} */
    this.lastAuthSubmitKey = null;
    this.consecutiveSameAuthSubmit = 0;

    // ── Navigation / recovery ──
    this.outOfAppRecoveries = 0;
    /** @type {unknown} */
    this.navStructure = null;
    this.saturationCooldown = 0;
    /** @type {number[]} */
    this.appCrashTimestamps = [];       // C9: timestamps of rapid app crashes
    this.consecutiveActionFails = 0;    // C7: consecutive executeAction failures
    this.globalRecoveryAttempts = 0;    // H4: total recovery attempts across crawl

    // ── Module instances (set by caller) ──
    /** @type {any} */
    this.recoveryManager = null;
    /** @type {any} */
    this.modeManager = null;
    /** @type {any} */
    this.appState = null;
    /** @type {any} */
    this.flowTracker = null;
    /** @type {any} */
    this.dedup = null;
    /** @type {any} */
    this.watchdog = null;
    /** @type {any} */
    this.coverageTracker = null;
    /** @type {any} */
    this.plan = null;
    this._replanAt40Done = false;
    this._replanAt70Done = false;

    // ── UIAutomator resilience ──
    this.screenshotOnlyMode = false;
    this.uiAutomatorRestartAttempts = 0;
    this.consecutiveXmlFailedSteps = 0;
    this.MAX_UIAUTOMATOR_RESTARTS = 2;

    // ── Vision ──
    /** @type {VisionResult | null} */
    this.visionResult = null;
    /** @type {Map<string, unknown>} */
    this.visionActionCache = new Map();
    this.perceptionCache = new PerceptionCache();

    // ── Exploration heuristics ──
    /** @type {string | null} */
    this.homeFingerprint = null;
    /** @type {string | null} */
    this.lastNewScreenFp = null;
    this.actionsOnNewScreen = 0;
    this.consecutiveSysHandlerSteps = 0;
    this.consecutiveFormVisits = 0;
    this.consecutiveIneffectiveTaps = 0;
    /** @type {string | null} */
    this.lastActionKey = null;
    /** @type {string | null} */
    this.lastActionFromFp = null;
    /** @type {JournalEntry[]} */
    this.explorationJournal = [];
    /** @type {unknown} */
    this.lastActionOutcome = null;
    /** @type {Record<number, unknown>} */
    this.oracleFindingsByStep = {};

    // ── Framework-adaptive mode (E8) ──
    this._frameworkAdaptive = false;     // Set when obfuscated framework detected past step 3

    // ── Scroll depth tracking (E4) ──
    /** @type {Map<string, number>} */
    this.scrollDepthByFp = new Map();    // fp → total scrolls done on that screen

    // ── Cross-crawl memory ──
    /** @type {Map<string, ScreenMemoryEntry>} */
    this.screenMemory = new Map();       // loaded from SQLite at crawl start
    /** @type {Map<string, Classification>} */
    this.classificationsByFp = new Map(); // fp → { type, feature }
    /** @type {AppKnowledge | null} */
    this.appKnowledge = null;            // populated by run.js from loadAppKnowledge()

    // ── Token usage tracking ──
    this.tokenUsage = { input_tokens: 0, output_tokens: 0 };

    // ── V2 vision-first mode (additive, gated by AGENT_VISION_FIRST env flag) ──
    this.visionFirstMode = process.env.AGENT_VISION_FIRST === "true";
    /** @type {import('./types/crawl-context').V2TokenUsage} */
    this.v2TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };

    // ── Live preview ──
    /** @type {unknown} */
    this.lastLiveAction = null;

    // ── E4: Stage skip flags ──
    this.authResolved = false;     // skip auth stages (5, 10, 11) after auth is resolved
    this.surveyComplete = false;   // skip survey subsystem after nav is surveyed
    this.permissionBurstDone = false; // skip permission burst after initial steps

    // ── Track G: coverage + token instrumentation timing ──
    // startTime/endTime are stamped by runCrawl() so buildV2Coverage()
    // can compute elapsedMs / uniquePerMinute. _prevUniqueCount is an
    // ephemeral per-step counter used by the [coverage] step log line.
    /** @type {number} */
    this.startTime = 0;
    /** @type {number} */
    this.endTime = 0;
    /** @type {number} */
    this._prevUniqueCount = 0;
  }
}

module.exports = {
  CrawlContext,
  // Re-export constants so extracted modules can import them
  MAX_NO_NEW_STATE,
  DISCOVERY_WINDOW_SIZE,
  DISCOVERY_MIN_RATE,
  CYCLE_WINDOW,
  CYCLE_UNIQUE_THRESHOLD,
  MAX_DEVICE_FAILS,
  MAX_CAPTURE_FAILS,
  MAX_CAPTURE_RECOVERIES,
  MAX_AUTH_FILLS,
  MAX_OUT_OF_APP_RECOVERIES,
  AUTH_FLOW_MAX_STEPS,
  MAX_SAME_AUTH_SUBMIT,
  JOURNAL_MAX,
  VISION_SCREEN_TO_FEATURE,
  VISION_NAV_FILTER,
  SOFT_REVISIT_WINDOW,
  SOFT_REVISIT_THRESHOLD,
  MAX_GLOBAL_RECOVERIES,
};
