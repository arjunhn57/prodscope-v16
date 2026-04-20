"use strict";

/**
 * v16/agent-loop.js — The main V16 crawl loop.
 *
 * Replaces the 18-stage V15 pipeline with a single decision loop:
 *
 *   launchApp; waitForReady
 *   loop:
 *     if budget.exhausted(): stop
 *     obs, feedback = capture()
 *     stateGraph.recordVisit(obs.fingerprint)
 *     decision = agent.decideNextAction(obs, history, ...)
 *     if decision.action.type === 'done': stop(agent_done)
 *     if consecutiveIdentical(decision.action) >= 3: force press_back()
 *     executor.executeAction(decision.action)
 *     await readiness.wait(decision.action.type)
 *     budget.step()
 *     emitSseProgress(...)
 *
 * The loop function is called by jobs/runner.js when CRAWL_ENGINE=v16.
 * It emits SSE progress via a shape compatible with the V15 frontend.
 */

const path = require("path");
const adb = require("../adb");
const readiness = require("../readiness");
const { logger } = require("../../lib/logger");

const { captureObservation } = require("./observation");
const { createStateGraph } = require("./state");
const { createBudget } = require("./budget");
const { executeAction, validateAction } = require("./executor");
const { decideNextAction } = require("./agent");
const { findAuthEscapeButton } = require("./auth-escape");
const jobStore = require("../../jobs/store");

const log = logger.child({ component: "v16-loop" });

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
const AUTH_LOOP_FP_THRESHOLD = 3;

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
      `v16_step_${step}`,
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
    engine: "v16",
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
          engine: "v16",
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
            engine: "v16",
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

    // ── Decide ──
    const budgetSnap = budget.snapshot();

    // Image policy: always on step 1 and after crash/left-app; otherwise every
    // Nth fingerprint change. Reset the counter when we actually send.
    const sendImage =
      step <= 1 ||
      lastFeedback === "app_crashed" ||
      lastFeedback === "left_app" ||
      (fingerprintChanged && fpChangesSinceImage >= IMAGE_EVERY_N_FP_CHANGES);
    if (sendImage) fpChangesSinceImage = 0;

    const forceEscalate =
      (stagnationStreak >= STAGNATION_ESCALATION_THRESHOLD || isOrbiting) &&
      budget.canEscalateToSonnet();

    /** @type {import('./agent').AgentDecision} */
    let decision;
    try {
      decision = await decideNextAction(
        {
          observation,
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
          authEscape: findAuthEscapeButton(observation),
        },
        { anthropic: deps.anthropic },
      );
      if (forceEscalate && decision.escalated) {
        // Reset both stagnation signals — give the Sonnet-picked action a full
        // fresh window to take effect before we'd re-fire escalation.
        stagnationStreak = 0;
        orbitWindow.length = 0;
      }
    } catch (err) {
      log.error({ err: err.message, step }, "agent decision failed");
      decision = {
        action: { type: "press_back" },
        reasoning: `agent failure: ${err.message}`,
        expectedOutcome: "",
        modelUsed: "haiku",
        escalated: false,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
      };
    }

    // Record LLM cost from the decision's token usage
    if (decision.inputTokens > 0 || decision.outputTokens > 0) {
      budget.recordLlmCall(
        decision.modelUsed,
        decision.inputTokens,
        decision.outputTokens,
        decision.cachedInputTokens,
      );
      // If escalated, the escalation path invoked both models; the second
      // model's share was counted as "modelUsed=sonnet" above. The Haiku
      // portion is already absorbed into the sonnet call's token total by
      // agent.splitUsage aggregation, so we don't double-count here.
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
    // has decided so the agent gets fair attempts on the 1st and 2nd visits;
    // only repeat offenders get overridden. Exclusions:
    //   - type: a legitimate form-fill hits the same FP repeatedly
    //   - done: the agent already chose to exit
    //   - request_human_input: that path has its own exit via timeout
    if (
      currentFpVisits >= AUTH_LOOP_FP_THRESHOLD &&
      actionToExecute?.type !== "done" &&
      actionToExecute?.type !== "type" &&
      actionToExecute?.type !== "request_human_input"
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
    });

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
