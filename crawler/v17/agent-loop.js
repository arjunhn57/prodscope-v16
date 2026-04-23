"use strict";

/**
 * v17/agent-loop.js — Driver-first crawl loop (A.4 of V17 plan).
 *
 * Structurally identical to v16/agent-loop.js, but the per-step decision
 * point goes through the deterministic driver dispatcher instead of a single
 * LLM call. Drivers handle mechanical UI flows (auth, onboarding,
 * permissions, dismiss, exploration); LLMFallback catches everything else.
 *
 *   launchApp; waitForReady
 *   loop:
 *     if budget.exhausted(): stop
 *     obs, feedback = capture()
 *     stateGraph.recordVisit(obs.fingerprint)
 *     { driver, action } = await dispatch(obs, driverState, deps)
 *     if action.type === 'done': stop(agent_done)
 *     if consecutiveIdentical(action) >= 3: force press_back()
 *     executor.executeAction(action)
 *     await readiness.wait(action.type)
 *     budget.step()
 *     emitSseProgress(...)
 *
 * Called by jobs/runner.js when CRAWL_ENGINE=v17. Emits SSE with
 * engine: "v17" so the frontend can distinguish runs. V16 reuses are marked
 * — Phase-E cleanup may remove them once the golden suite passes.
 */

const path = require("path");
const adb = require("../adb");
const readiness = require("../readiness");
const { logger } = require("../../lib/logger");

// V16 reuses (still-good primitives): capture, state graph, budget, executor,
// and — for LLMFallback — the full v16 agent decision pipeline.
const { captureObservation } = require("../v16/observation");
const { createStateGraph } = require("../v16/state");
const { createBudget } = require("../v16/budget");
const { executeAction, validateAction } = require("../v16/executor");
const { isAuthScreen, findAuthEscapeButton } = require("../v16/auth-escape");
const { decideNextAction } = require("../v16/agent");
const jobStore = require("../../jobs/store");

// V17 additions: driver dispatcher + per-run classifier cache + LLMFallback wrapper.
const { dispatch } = require("./dispatcher");
const { createCache: createClassifierCache } = require("./node-classifier");
const { createLlmFallback } = require("./drivers/llm-fallback");

const log = logger.child({ component: "v17-loop" });

const HISTORY_TAIL_SIZE = 6;
const MAX_CONSECUTIVE_IDENTICAL = 3;
// After this many consecutive no_change feedbacks the loop force-escalates to
// Sonnet. Raised from 3 → 5 because back-nav loops (A → B → back → A) can
// produce short no_change streaks that aren't real stagnation.
const STAGNATION_ESCALATION_THRESHOLD = 5;
// Orbit detection — if the SAME fingerprint shows up ≥ORBIT_REPEATS times in
// the last ORBIT_WINDOW steps (regardless of action/feedback), we're bouncing
// around a small cluster and should escalate. Catches the case stagnationStreak
// misses: agent takes diverse actions that all land back on the same screen.
const ORBIT_WINDOW = 8;
const ORBIT_REPEATS = 5;
// Send the screenshot image only every Nth fingerprint change after step 1.
// The agent retains recent history in text; a stale image for one step is
// cheaper than an image every step.
const IMAGE_EVERY_N_FP_CHANGES = 2;
// Discovery delta window — "new unique screens in last 5 steps" is surfaced
// to the agent so it can notice stagnation even without no_change feedback.
const DISCOVERY_WINDOW_STEPS = 5;
// Recent-fingerprint buffer length — shown to the agent so it knows which
// fingerprints to avoid revisiting.
const RECENT_FP_BUFFER = 10;
// Auth-loop exit — if the SAME fingerprint has been observed this many times
// total and the agent is still not choosing to exit (e.g. biztoso 6f926f08:
// tapped (352,1006) at steps #09/#16/#22/#29 on the same login FP across a
// launcher-orbit), force-terminate with blocked_by_auth. Wider net than the
// ORBIT_REPEATS window (5-in-8); catches cross-orbit loops stagnationStreak
// resets through.
const AUTH_LOOP_FP_THRESHOLD = 4;

/**
 * @typedef {Object} RunOptions
 * @property {string} jobId
 * @property {string} targetPackage
 * @property {string} screenshotDir
 * @property {import('./executor').Credentials|null} [credentials]
 * @property {{ goals?: string[], painPoints?: string[], goldenPath?: string[] }} [appContext]
 * @property {import('./budget').BudgetConfig} [budgetConfig]
 * @property {(payload: object) => void} [onProgress]
 * @property {Object} [deps]   // testing: {adb, anthropic, readiness, now, fs}
 *
 * @typedef {Object} ScreenRecord
 * @property {string} path
 * @property {string} xml
 * @property {number} index
 * @property {string} fingerprint
 * @property {string} activity
 *
 * @typedef {Object} RunResult
 * @property {string} stopReason
 * @property {number} uniqueScreens
 * @property {number} stepsUsed
 * @property {number} costUsd
 * @property {number} sonnetEscalations
 * @property {ScreenRecord[]} screens
 * @property {Array<object>} actionsTaken
 * @property {Object} stats
 */

/**
 * Are two actions "identical" for the consecutive-identical circuit breaker?
 * @param {object} a
 * @param {object} b
 */
function actionsIdentical(a, b) {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "tap":
    case "long_press":
      return a.x === b.x && a.y === b.y;
    case "swipe":
      return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
    case "type":
      return a.text === b.text;
    case "wait":
      return true;
    default:
      return true;
  }
}

/**
 * Format an action as a compact string for SSE / logs.
 * @param {object} a
 */
function formatActionLabel(a) {
  if (!a) return "";
  switch (a.type) {
    case "tap":
    case "long_press":
      return `${a.type}(${a.x},${a.y})`;
    case "swipe":
      return `swipe(${a.x1},${a.y1}→${a.x2},${a.y2})`;
    case "type":
      return `type(…)`;
    case "wait":
      return `wait(${a.ms})`;
    case "done":
      return `done(${a.reason || ""})`;
    case "request_human_input":
      return `request_human_input(${a.field || "?"})`;
    default:
      return a.type;
  }
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip any password/email/static-input literals that might slip into free-form
 * agent text. Agent is told to use ${EMAIL} / ${PASSWORD} tokens, but a model
 * may quote creds in its reasoning. Also masks any staticInputs values (OTP
 * codes, CAPTCHAs) the user supplied at upload time. Last line of defense
 * before those strings reach the SSE stream / frontend.
 *
 * @param {string} text
 * @param {{email?:string, password?:string}|null} creds
 * @param {Record<string, string>|null} [staticInputs]
 */
function maskSecrets(text, creds, staticInputs) {
  if (!text || typeof text !== "string") return text;
  const email = creds && creds.email;
  const password = creds && creds.password;
  let out = text;
  if (password) {
    out = out.replace(new RegExp(escapeRegex(password), "g"), "••••••••");
  }
  if (email) {
    out = out.replace(new RegExp(escapeRegex(email), "g"), "•••@•••");
  }
  if (staticInputs && typeof staticInputs === "object") {
    for (const value of Object.values(staticInputs)) {
      if (typeof value === "string" && value.length >= 3) {
        out = out.replace(new RegExp(escapeRegex(value), "g"), "••••••");
      }
    }
  }
  return out;
}

/**
 * Wait for the screen to settle after an action. Shorter waits for no-op
 * actions like `wait` (the wait is the settle) and `done` (not dispatched).
 * @param {string} actionType
 * @param {string} screenshotDir
 * @param {number} step
 * @param {typeof readiness} _readiness
 */
async function waitAfterAction(actionType, screenshotDir, step, _readiness) {
  if (actionType === "done" || actionType === "wait") return;
  try {
    await _readiness.waitForScreenReadyScreenshotOnly(
      screenshotDir,
      `v17_step_${step}`,
      { timeoutMs: 2500, pollIntervalMs: 400 },
    );
  } catch (err) {
    log.warn({ err: err.message, step }, "readiness wait failed");
  }
}

/**
 * Build an SSE payload shape compatible with V15's frontend contract.
 * The V15 shape is documented in `crawler/run.js:sendLiveProgress()`; V16
 * fills the subset of fields it actually has, and leaves the rest nullable.
 */
function buildLivePayload(args) {
  const {
    step,
    maxSteps,
    uniqueScreens,
    targetUniqueScreens,
    observation,
    action,
    reasoning,
    expectedOutcome,
    packageName,
    message,
    budgetSnap,
    credentials,
    staticInputs,
  } = args;
  return {
    phase: "running",
    rawStep: step,
    maxRawSteps: maxSteps,
    countedUniqueScreens: uniqueScreens,
    targetUniqueScreens,
    activity: observation ? observation.activity : "",
    intentType: "",
    latestAction: formatActionLabel(action),
    message: maskSecrets(message || `Step ${step}/${maxSteps}`, credentials, staticInputs),
    captureMode: "screenshot",
    packageName,
    path: observation ? observation.screenshotPath : "",
    reasoning: reasoning ? maskSecrets(reasoning, credentials, staticInputs) : null,
    expectedOutcome: expectedOutcome ? maskSecrets(expectedOutcome, credentials, staticInputs) : null,
    perceptionBoxes: [],
    tapTarget:
      action && (action.type === "tap" || action.type === "long_press")
        ? { x: action.x, y: action.y }
        : null,
    navTabs: [],
    heapMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    engine: "v17",
    costUsd: budgetSnap.costUsd,
    maxCostUsd: budgetSnap.maxCostUsd,
    sonnetEscalationsUsed: budgetSnap.sonnetEscalationsUsed,
  };
}

/**
 * Resolve dependency injection slots, falling back to real modules.
 */
function resolveDeps(opts) {
  const d = opts.deps || {};
  return {
    adb: d.adb || adb,
    readiness: d.readiness || readiness,
    anthropic: d.anthropic, // may be undefined — agent.js uses default client then
    store: d.store || jobStore,
  };
}

/**
 * Run the V16 agent-first crawl.
 * @param {RunOptions} opts
 * @returns {Promise<RunResult>}
 */
async function runAgentLoop(opts) {
  if (!opts || !opts.targetPackage) {
    throw new Error("runAgentLoop requires opts.targetPackage");
  }
  if (!opts.screenshotDir) {
    throw new Error("runAgentLoop requires opts.screenshotDir");
  }

  const deps = resolveDeps(opts);
  const budget = createBudget(opts.budgetConfig);
  const stateGraph = createStateGraph();
  const maxSteps = (opts.budgetConfig && opts.budgetConfig.maxSteps) || 80;
  const targetUniqueScreens = 25;

  // V16.1: human-input resolution. staticInputs come from the upload form
  // ({ otp, email_code, "2fa", captcha }) and are used once per field; if the
  // agent re-emits request_human_input for the same field (static was wrong)
  // we fall through to the live popup on the 2nd call.
  const staticInputs = (opts.staticInputs && typeof opts.staticInputs === "object") ? opts.staticInputs : {};
  const humanInputStaticUsed = new Set();
  const HUMAN_INPUT_TIMEOUT_MS = 5 * 60 * 1000;

  /**
   * Resolver injected into executor.executeAction("request_human_input").
   * Returns { value, source } — static first, live popup (via store waiter)
   * otherwise. Pauses the wall-clock budget while waiting on the human so a
   * 2-min popup does not kill the 30-min budget.
   */
  async function resolveHumanInput({ field, prompt }) {
    const staticVal = staticInputs[field];
    if (typeof staticVal === "string" && staticVal.length > 0 && !humanInputStaticUsed.has(field)) {
      humanInputStaticUsed.add(field);
      log.info({ jobId: opts.jobId, field }, "human-input: using static value");
      return { value: staticVal, source: "static" };
    }
    if (!opts.jobId) {
      throw new Error("request_human_input requires opts.jobId for popup fallback");
    }
    if (typeof budget.pauseWallClock === "function") budget.pauseWallClock();
    if (opts.onProgress) {
      try {
        opts.onProgress({
          phase: "running",
          type: "awaiting_human_input",
          field,
          prompt,
          timeoutMs: HUMAN_INPUT_TIMEOUT_MS,
          engine: "v17",
          jobId: opts.jobId,
        });
      } catch (err) {
        log.warn({ err: err.message }, "onProgress threw during awaiting_human_input");
      }
    }
    try {
      const value = await deps.store.awaitJobInput(opts.jobId, { timeoutMs: HUMAN_INPUT_TIMEOUT_MS });
      log.info({ jobId: opts.jobId, field }, "human-input: popup value received");
      return { value, source: "popup" };
    } finally {
      if (typeof budget.resumeWallClock === "function") budget.resumeWallClock();
      if (opts.onProgress) {
        try {
          opts.onProgress({
            phase: "running",
            type: "human_input_received",
            field,
            engine: "v17",
            jobId: opts.jobId,
          });
        } catch (err) {
          log.warn({ err: err.message }, "onProgress threw during human_input_received");
        }
      }
    }
  }

  /** @type {ScreenRecord[]} */
  const screens = [];
  /** @type {Array<object>} */
  const actionsTaken = [];
  /** @type {Array<{step:number, action:any, feedback:string, fingerprint:string, activity:string}>} */
  const history = [];

  // V17: driver state is threaded across every dispatch() so AuthDriver's
  // state machine, stuck-detection, and (later) ExplorationDriver's coverage
  // memory persist between steps. Mutated by the dispatcher + drivers.
  const driverState = {
    credentials: opts.credentials || null,
    userSeededGoogleAccount: Boolean(opts.userSeededGoogleAccount),
    stateGraph,
  };
  const classifierCache = createClassifierCache();

  let prevObservation = null;
  let lastAction = null;
  let lastFeedback = "none";
  let stopReason = null;
  let consecutiveIdenticalCount = 0;
  let lastActionForConsecutive = null;

  // ── Discovery / stagnation tracking ──
  let stagnationStreak = 0; // consecutive no_change count
  let fpChangesSinceImage = 0; // for every-Nth-FP-change image policy
  const recentFingerprints = []; // rolling buffer (FP-change only), most-recent last
  /** rolling buffer of fingerprints from every step (last ORBIT_WINDOW) */
  const orbitWindow = [];
  /** total visit count per fingerprint across the whole run — drives the
   *  auth-loop hard-exit when the agent orbits the same auth wall. */
  const fingerprintVisits = new Map();
  const uniqueCountByStep = [0]; // index == step; value == uniqueScreens AFTER that step (step 0 = 0)

  // ── Launch app ──
  try {
    deps.adb.launchApp(opts.targetPackage);
  } catch (err) {
    log.error({ err: err.message }, "initial launchApp failed");
    return {
      stopReason: "launch_failed",
      uniqueScreens: 0,
      stepsUsed: 0,
      costUsd: 0,
      sonnetEscalations: 0,
      screens: [],
      actionsTaken: [],
      stats: { error: err.message },
    };
  }
  await waitAfterAction("launch_app", opts.screenshotDir, 0, deps.readiness);

  for (let step = 1; step <= maxSteps; step++) {
    const exhaustion = budget.exhausted();
    if (exhaustion) {
      stopReason = exhaustion;
      break;
    }

    // ── Capture ──
    const screenshotPath = path.join(opts.screenshotDir, `step-${step}.png`);
    /** @type {import('./observation').ObservationResult} */
    let capture;
    try {
      capture = await captureObservation(
        {
          targetPackage: opts.targetPackage,
          screenshotPath,
          previous: prevObservation,
          lastAction,
        },
        { adb: deps.adb },
      );
    } catch (err) {
      log.error({ err: err.message, step }, "capture failed");
      stopReason = "capture_failed";
      break;
    }
    const { observation, feedback, fingerprintChanged } = capture;
    lastFeedback = feedback;

    // ── Stagnation / discovery counters ──
    if (feedback === "no_change") {
      stagnationStreak += 1;
    } else {
      stagnationStreak = 0;
    }
    if (fingerprintChanged) {
      fpChangesSinceImage += 1;
      recentFingerprints.push(observation.fingerprint);
      if (recentFingerprints.length > RECENT_FP_BUFFER) {
        recentFingerprints.shift();
      }
    }
    // Orbit buffer: always push current fingerprint so we can detect bouncing
    // between a small set of screens (signal independent of feedback labels).
    orbitWindow.push(observation.fingerprint);
    if (orbitWindow.length > ORBIT_WINDOW) orbitWindow.shift();
    const orbitRepeats = orbitWindow.filter(
      (fp) => fp === observation.fingerprint,
    ).length;
    const isOrbiting =
      orbitWindow.length >= ORBIT_WINDOW && orbitRepeats >= ORBIT_REPEATS;
    // Auth-loop visit counter — unbounded-window companion to orbitWindow.
    // Increments on every observation, not just fp-change, so hitting the
    // same auth wall across launcher-orbit cycles still counts.
    const currentFpVisits =
      (fingerprintVisits.get(observation.fingerprint) ?? 0) + 1;
    fingerprintVisits.set(observation.fingerprint, currentFpVisits);

    // ── Record visit ──
    try {
      stateGraph.recordVisit(observation.fingerprint, {
        activity: observation.activity,
        packageName: observation.packageName,
        step,
      });
    } catch (err) {
      log.warn({ err: err.message, step }, "recordVisit failed");
    }
    screens.push({
      path: observation.screenshotPath,
      xml: observation.xml,
      index: step,
      fingerprint: observation.fingerprint,
      activity: observation.activity,
    });

    // Unique-count snapshot for discovery-delta window.
    uniqueCountByStep[step] = stateGraph.uniqueScreenCount();
    const baselineStep = Math.max(0, step - DISCOVERY_WINDOW_STEPS);
    const discoveryDelta5 =
      uniqueCountByStep[step] - (uniqueCountByStep[baselineStep] || 0);

    // ── Decide (V17 driver-first) ──
    const budgetSnap = budget.snapshot();

    // Image policy: retained for SSE only — drivers never receive the image.
    // Kept so the frontend's streaming thumbnails still update on the same
    // cadence as V16. LLMFallback (D.1) may want it when it ships.
    const sendImage =
      step <= 1 ||
      lastFeedback === "app_crashed" ||
      lastFeedback === "left_app" ||
      (fingerprintChanged && fpChangesSinceImage >= IMAGE_EVERY_N_FP_CHANGES);
    if (sendImage) fpChangesSinceImage = 0;

    // Clear auth state machine when the fingerprint changes AND we're no
    // longer on an auth screen — prevents a stale state.authStep from
    // carrying over into an unrelated screen if the user navigates away
    // mid-flow and later returns to a fresh form.
    if (fingerprintChanged && !isAuthScreen(observation) && driverState.authStep) {
      driverState.authStep = undefined;
      driverState.authStepDispatch = undefined;
    }

    // LLMFallback closure: wraps v16's decideNextAction with the loop-iteration
     // context so the dispatcher can hand non-auth screens back to the baseline
     // LLM loop. Captures the most recent call's token usage in `lastLlmCall`
     // so the agent-loop can merge it into the decision record after dispatch
     // returns.
    const forceEscalate =
      (stagnationStreak >= STAGNATION_ESCALATION_THRESHOLD || isOrbiting) &&
      budget.canEscalateToSonnet();
    /** @type {null | {modelUsed:string, inputTokens:number, outputTokens:number, cachedInputTokens:number, reasoning:string, expectedOutcome:string, escalated:boolean}} */
    let lastLlmCall = null;
    const innerLlmDecision = async (obs, _state, driverDeps) => {
      const llmDecision = await decideNextAction(
        {
          observation: obs,
          fingerprintChanged,
          lastFeedback,
          lastAction,
          historyTail: history.slice(-HISTORY_TAIL_SIZE),
          credentials: opts.credentials || null,
          appContext: opts.appContext || {},
          budget: budgetSnap,
          budgetController: {
            canEscalateToSonnet: () => budget.canEscalateToSonnet(),
          },
          uniqueScreens: stateGraph.uniqueScreenCount(),
          targetUniqueScreens,
          step,
          stepsRemaining: Math.max(0, maxSteps - step),
          sendImage,
          forceEscalate,
          stagnationStreak,
          discoveryDelta5,
          recentFingerprints: recentFingerprints.slice(),
          authEscape: findAuthEscapeButton(obs),
        },
        { anthropic: driverDeps.anthropic || deps.anthropic },
      );
      lastLlmCall = {
        modelUsed: llmDecision.modelUsed,
        inputTokens: llmDecision.inputTokens || 0,
        outputTokens: llmDecision.outputTokens || 0,
        cachedInputTokens: llmDecision.cachedInputTokens || 0,
        reasoning: llmDecision.reasoning || "",
        expectedOutcome: llmDecision.expectedOutcome || "",
        escalated: !!llmDecision.escalated,
      };
      if (forceEscalate && llmDecision.escalated) {
        // Reset both stagnation signals — give the Sonnet-picked action a full
        // fresh window to take effect before we'd re-fire escalation.
        stagnationStreak = 0;
        orbitWindow.length = 0;
      }
      return llmDecision.action;
    };
    // Wrap the inner LLM call with the named LLMFallback module. The wrapper
    // logs one line per escalation — "why we fell through" + a compact screen
    // signature — so Phase D telemetry can aggregate what's eating our margin.
    // Diagnostics flow through deps.getDiagnostics populated by the dispatcher.
    const llmFallback = createLlmFallback(innerLlmDecision);

    /**
     * @type {{
     *   action: any,
     *   reasoning: string,
     *   expectedOutcome: string,
     *   modelUsed: string,
     *   escalated: boolean,
     *   inputTokens: number,
     *   outputTokens: number,
     *   cachedInputTokens: number,
     * }}
     */
    let decision;
    try {
      const dispatchResult = await dispatch(observation, driverState, {
        anthropic: deps.anthropic,
        classifierCache,
        llmFallback,
      });
      if (dispatchResult.driver === "LLMFallback" && lastLlmCall) {
        decision = {
          action: dispatchResult.action,
          reasoning: lastLlmCall.reasoning,
          expectedOutcome: lastLlmCall.expectedOutcome,
          modelUsed: lastLlmCall.modelUsed,
          escalated: lastLlmCall.escalated,
          inputTokens: lastLlmCall.inputTokens,
          outputTokens: lastLlmCall.outputTokens,
          cachedInputTokens: lastLlmCall.cachedInputTokens,
          driver: "LLMFallback",
          llmFallbackReason: dispatchResult.llmFallbackReason || null,
          llmFallbackSignature: dispatchResult.llmFallbackSignature || null,
        };
      } else {
        decision = {
          action: dispatchResult.action,
          reasoning: `driver=${dispatchResult.driver}`,
          expectedOutcome: "",
          modelUsed: "driver",
          escalated: false,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          driver: dispatchResult.driver,
          llmFallbackReason: null,
          llmFallbackSignature: null,
        };
      }
    } catch (err) {
      log.error({ err: err.message, step }, "v17 dispatch failed — defaulting to press_back");
      decision = {
        action: { type: "press_back" },
        reasoning: `dispatch failure: ${err.message}`,
        expectedOutcome: "",
        modelUsed: "driver",
        escalated: false,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
      };
    }

    // Record LLM cost from the decision's token usage (will matter once
    // LLMFallback is wired).
    if (decision.inputTokens > 0 || decision.outputTokens > 0) {
      budget.recordLlmCall(
        decision.modelUsed,
        decision.inputTokens,
        decision.outputTokens,
        decision.cachedInputTokens,
      );
    }

    // ── press_back guardrail on auth screens ──
    // Drivers never emit press_back (AuthDriver concedes via
    // done('blocked_by_auth:*') instead). This guardrail therefore only
    // fires against a rogue LLMFallback action; when it does, we don't
    // re-ask (drivers will re-produce the same output) — we concede.
    if (
      decision.action?.type === "press_back" &&
      isAuthScreen(observation)
    ) {
      log.warn(
        { step },
        "press_back blocked on auth screen — conceding blocked_by_auth",
      );
      decision = {
        ...decision,
        action: {
          type: "done",
          reason: "blocked_by_auth:press_back_blocked",
        },
      };
    }
    // ── Consecutive-identical safety net ──
    let actionToExecute = decision.action;
    if (actionsIdentical(actionToExecute, lastActionForConsecutive)) {
      consecutiveIdenticalCount += 1;
    } else {
      consecutiveIdenticalCount = 1;
    }
    lastActionForConsecutive = actionToExecute;
    if (consecutiveIdenticalCount >= MAX_CONSECUTIVE_IDENTICAL) {
      log.warn(
        { action: formatActionLabel(actionToExecute), step },
        "consecutive-identical limit hit — forcing press_back",
      );
      actionToExecute = { type: "press_back" };
      consecutiveIdenticalCount = 0;
      lastActionForConsecutive = actionToExecute;
    }

    // ── Auth-loop hard exit ──
    // Wider than the orbit detector (5-in-8) — catches biztoso-style
    // launcher-orbit loops where the agent keeps returning to the same auth
    // wall across press_home / launch_app transitions. Runs AFTER the model
    // has decided so the agent gets fair attempts on the 1st–3rd visits;
    // only repeat offenders get overridden. Exclusions:
    //   - type: a legitimate form-fill hits the same FP repeatedly
    //   - done: the agent already chose to exit
    //   - request_human_input: that path has its own exit via timeout
    //   - press_back: dismissing a modal/popup that keeps the FP pinned
    //   - swipe: scroll-to-find attempt (Skip / Guest off-screen)
    if (
      currentFpVisits >= AUTH_LOOP_FP_THRESHOLD &&
      actionToExecute?.type !== "done" &&
      actionToExecute?.type !== "type" &&
      actionToExecute?.type !== "request_human_input" &&
      actionToExecute?.type !== "press_back" &&
      actionToExecute?.type !== "swipe"
    ) {
      log.warn(
        {
          step,
          fingerprint: observation.fingerprint,
          visits: currentFpVisits,
          overriddenAction: actionToExecute?.type,
        },
        "auth-loop: fingerprint revisited — forcing done(blocked_by_auth)",
      );
      actionToExecute = {
        type: "done",
        reason: "blocked_by_auth:fp_revisit_loop",
      };
    }

    // ── Emit SSE progress ──
    if (opts.onProgress) {
      try {
        opts.onProgress(
          buildLivePayload({
            step,
            maxSteps,
            uniqueScreens: stateGraph.uniqueScreenCount(),
            targetUniqueScreens,
            observation,
            action: actionToExecute,
            reasoning: decision.reasoning,
            expectedOutcome: decision.expectedOutcome,
            packageName: opts.targetPackage,
            budgetSnap: budget.snapshot(),
            credentials: opts.credentials,
            staticInputs,
          }),
        );
      } catch (err) {
        log.warn({ err: err.message }, "onProgress threw");
      }
    }

    // ── Execute ──
    const execCtx = {
      targetPackage: opts.targetPackage,
      credentials: opts.credentials || null,
      adb: deps.adb,
      xml: observation.xml,
      resolveHumanInput,
    };
    const v = validateAction(actionToExecute);
    if (!v.valid) {
      log.warn({ action: actionToExecute, error: v.error, step }, "invalid action from agent");
      actionToExecute = { type: "press_back" };
    }
    const execResult = await executeAction(actionToExecute, execCtx);
    actionsTaken.push({
      step,
      action: actionToExecute,
      model: decision.modelUsed,
      escalated: decision.escalated,
      reasoning: decision.reasoning,
      expectedOutcome: decision.expectedOutcome,
      feedback: lastFeedback,
      ok: execResult.ok,
      driver: decision.driver || null,
      llmFallbackReason: decision.llmFallbackReason || null,
      llmFallbackSignature: decision.llmFallbackSignature || null,
    });
    log.info(
      {
        jobId: opts.jobId,
        step,
        actionType: actionToExecute.type,
        targetText: actionToExecute.targetText || null,
        x: actionToExecute.x,
        y: actionToExecute.y,
        pkg: observation.activity && observation.activity.split("/")[0],
        fp: observation.fingerprint,
        feedback: lastFeedback,
        ok: execResult.ok,
      },
      "agent-step: action executed",
    );

    if (execResult.terminal) {
      stopReason = execResult.stopReason || "agent_done";
      budget.step();
      prevObservation = observation;
      lastAction = actionToExecute;
      history.push({
        step,
        action: actionToExecute,
        feedback: lastFeedback,
        fingerprint: observation.fingerprint,
        activity: observation.activity,
      });
      break;
    }

    await waitAfterAction(actionToExecute.type, opts.screenshotDir, step, deps.readiness);

    budget.step();
    prevObservation = observation;
    lastAction = actionToExecute;
    history.push({
      step,
      action: actionToExecute,
      feedback: lastFeedback,
      fingerprint: observation.fingerprint,
      activity: observation.activity,
    });
  }

  // ── Finalize stop reason if we fell out of the loop without one ──
  if (!stopReason) {
    stopReason = budget.exhausted() || "max_steps_reached";
  }

  const finalSnap = budget.snapshot();
  return {
    stopReason,
    uniqueScreens: stateGraph.uniqueScreenCount(),
    stepsUsed: finalSnap.stepsUsed,
    costUsd: finalSnap.costUsd,
    sonnetEscalations: finalSnap.sonnetEscalationsUsed,
    screens,
    actionsTaken,
    stats: {
      totalSteps: finalSnap.stepsUsed,
      uniqueStates: stateGraph.uniqueScreenCount(),
      visionCalls: finalSnap.haikuCallsUsed,
      sonnetCalls: finalSnap.sonnetEscalationsUsed,
      tokenUsage: {
        input_tokens: 0, // per-model breakdown lives in budget; keep placeholder for V15 shape
        output_tokens: 0,
      },
      wallMsElapsed: finalSnap.wallMsElapsed,
    },
  };
}

module.exports = {
  runAgentLoop,
  // exported for tests
  actionsIdentical,
  formatActionLabel,
  buildLivePayload,
  maskSecrets,
};
