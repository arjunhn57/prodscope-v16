"use strict";

/**
 * v18/dispatcher.js
 *
 * V18 driver-priority dispatcher. One structural change from v17:
 *
 *   Before dispatching, we run the v18 semantic classifier ONCE per step.
 *   Its output (a ScreenPlan + per-node {role, intent, priority}) is
 *   threaded into each driver via `deps.plan` and `deps.classifiedClickables`.
 *
 * V17 drivers that expect `deps.classify` (AuthDriver, DismissDriver)
 * receive a cached shim that returns the pre-classified clickables in v17's
 * shape — they keep working unchanged. V18's ExplorationDriver consumes
 * the new fields directly so it can filter out write/destructive candidates.
 *
 * Sonnet escalation fires when plan confidence is low OR when the
 * stuck-detector reports the crawler is spinning on the same fp-family.
 * Budget enforced via deps.escalationBudget.
 */

const PermissionDriver = require("../v17/drivers/permission-driver");
const CanvasDriver = require("../v17/drivers/canvas-driver");
const DismissDriver = require("../v17/drivers/dismiss-driver");
const AuthDriver = require("../v17/drivers/auth-driver");
const V18ExplorationDriver = require("./drivers/exploration-driver");
const { parseClickableGraph } = require("../v17/drivers/clickable-graph");
const { classifyScreen } = require("./semantic-classifier");
const { computeLogicalFingerprint } = require("../v17/node-classifier");
const { escalate, shouldEscalate } = require("./sonnet-escalation");
const {
  recordScreen,
  recordTap,
  recordAction,
  summarise: summariseTrajectory,
} = require("./trajectory-memory");
const { findClickableAt } = require("../v17/drivers/llm-fallback");
const { logger } = require("../../lib/logger");

const log = logger.child({ component: "v18-dispatcher" });

/**
 * Default V18 driver priority. Same shape as v17 — Permission → Canvas →
 * Dismiss → Auth → Exploration — but Exploration is the v18 variant.
 */
const DEFAULT_DRIVERS = [
  PermissionDriver,
  CanvasDriver,
  DismissDriver,
  AuthDriver,
  V18ExplorationDriver,
];

/**
 * Phase-A placeholder. The real LLMFallback wraps v16 decideNextAction.
 */
async function defaultLlmFallback() {
  return { type: "done", reason: "blocked:v18_llm_fallback_not_implemented" };
}

/**
 * Phase 2 — translate an LLM-decided engine_action into an Action the
 * v17 agent-loop executor already understands. Returns null if the action
 * can't be translated (e.g. relaunch requested but targetPackage not
 * available) — dispatcher falls through to normal driver dispatch.
 *
 * @param {string} engineAction  "relaunch" | "press_back" | "wait"
 * @param {object} plan           ScreenPlan from classifier
 * @param {object} observation    current observation
 * @param {object} deps           dispatch deps (contains targetPackage)
 * @returns {null | { driver: string, action: object }}
 */
function handleEngineAction(engineAction, plan, observation, deps) {
  switch (engineAction) {
    case "relaunch":
      // v16/executor already pulls targetPackage from ctx (set by runAgentLoop)
      // when action.type === "launch_app". We don't need to thread it here.
      return {
        driver: "EngineAction:relaunch",
        action: { type: "launch_app" },
      };
    case "press_back":
      return {
        driver: "EngineAction:press_back",
        action: { type: "press_back" },
      };
    case "wait":
      return {
        driver: "EngineAction:wait",
        action: { type: "wait", ms: 1500 },
      };
    default:
      return null;
  }
}

/**
 * @typedef {Object} DispatchDeps
 * @property {Array<object>} [drivers]
 * @property {Function} [llmFallback]
 * @property {any} [anthropic]
 * @property {Map<string, any>} [classifierCache]
 * @property {object} [trajectory]
 * @property {object} [escalationBudget]
 * @property {boolean} [stuckFingerprintFamily]
 * @property {number} [timeoutMs]
 */

/**
 * Dispatch one step. Classifier runs first; drivers see the classified output.
 *
 * @param {{xml?:string, packageName?:string, activity?:string, screenshotPath?:string}} observation
 * @param {object} state
 * @param {DispatchDeps} [deps]
 */
async function dispatch(observation, state, deps = {}) {
  const drivers = Array.isArray(deps.drivers) ? deps.drivers : DEFAULT_DRIVERS;
  const llmFallback = deps.llmFallback || defaultLlmFallback;

  if (state) {
    state.dispatchCount =
      typeof state.dispatchCount === "number" ? state.dispatchCount + 1 : 1;
  }

  // 1. Run the semantic classifier (Haiku). One call per unique fp; cached.
  const graph = parseClickableGraph(observation.xml || "");
  const classifierObs = Object.assign({}, observation, {
    trajectorySummary: deps.trajectory ? summariseTrajectory(deps.trajectory) : "",
    // Phase 2: Haiku compares observation.packageName vs targetPackage to
    // decide engine_action=relaunch when we've drifted out of the target.
    targetPackage: deps.targetPackage || observation.targetPackage || "",
  });
  let classification = await classifyScreen(graph, classifierObs, observation.xml || "", {
    anthropic: deps.anthropic,
    cache: deps.classifierCache,
    timeoutMs: deps.timeoutMs,
  });

  // 2. Sonnet escalation on low confidence or stuck loop.
  if (shouldEscalate(classification.plan, { stuckFingerprintFamily: !!deps.stuckFingerprintFamily })) {
    // Ensure Sonnet also receives targetPackage and trajectory context.
    const escalateObs = classifierObs;
    const escalated = await escalate(graph, escalateObs, observation.xml || "", classification.plan, {
      anthropic: deps.anthropic,
      escalationBudget: deps.escalationBudget,
      cache: deps.classifierCache,
      reason: deps.stuckFingerprintFamily ? "stuck_family" : "low_confidence",
      timeoutMs: deps.timeoutMs,
    });
    if (escalated) classification = escalated;
  }

  const { plan, clickables: classifiedClickables } = classification;

  // 3. Update trajectory memory.
  // Phase 4: compute logical fp alongside structural fp. Coverage tracking
  // (`logicalFingerprintsSeen`, `seenTypeCounts`) is keyed on logical fp so
  // scroll-offset / content-rotation drift doesn't inflate counts.
  // 2026-04-25 v2: per-fp edge tracking (`tappedEdgesByFp`) is now ALSO
  // keyed on logical fp. Pre-v2 it used structural fp, which let any feed
  // / list / timeline screen revive its frontier on every revisit because
  // structural fp churns with content rotation — the agent could re-tap
  // the same edge indefinitely. Logical fp stays stable across content
  // variance, so once an edge is tapped on a screen it stays in the
  // tapped set on subsequent revisits.
  const logicalFp = computeLogicalFingerprint(
    graph,
    observation.packageName,
    observation.activity,
  );
  // Attach to plan so downstream drivers / LLMFallback can read it without
  // re-computing.
  plan.logicalFingerprint = logicalFp;
  if (deps.trajectory) {
    recordScreen(
      deps.trajectory,
      plan.fingerprint,
      plan.screenType,
      logicalFp,
      observation.activity,
    );
  }

  log.info(
    {
      fingerprint: plan.fingerprint,
      screenType: plan.screenType,
      allowedIntents: plan.allowedIntents.join(","),
      confidence: plan.confidence,
      clickables: classifiedClickables.length,
      engineAction: plan.engineAction || "proceed",
    },
    "dispatcher: semantic plan ready",
  );

  // 3.5. Phase 2 — engine-level action. If the LLM decided we should
  //      relaunch / press_back / wait BEFORE drivers touch the screen,
  //      honour that decision here and skip the driver loop entirely.
  //      Replaces (most of) the DRIFT_ALLOWLIST + press_back regex
  //      guardrails with LLM-driven decisions.
  const engineAction = (plan && plan.engineAction) || "proceed";
  if (engineAction !== "proceed") {
    const engineActionResult = handleEngineAction(
      engineAction,
      plan,
      observation,
      deps,
    );
    if (engineActionResult) {
      log.info(
        {
          engineAction,
          reason: plan.engineActionReason,
          screenType: plan.screenType,
          fingerprint: plan.fingerprint,
          dispatchCount: state && state.dispatchCount,
        },
        "dispatcher: engine action took over",
      );
      return Object.assign(engineActionResult, { diagnostics: { claimedButNull: [], claimThrew: [], decideThrew: [] }, plan });
    }
  }

  // 4. Build the driver deps object. v17 drivers get a classify() shim that
  //    serves the cached classification in v17 shape (just `.role`).
  const diagnostics = {
    claimedButNull: [],
    claimThrew: [],
    decideThrew: [],
  };

  const driverDeps = {
    anthropic: deps.anthropic,
    classifierCache: deps.classifierCache,
    classify: async (_graph /* , _obs, _deps */) => classifiedClickables,
    plan,
    classifiedClickables,
    timeoutMs: deps.timeoutMs,
    // Phase 3: v18 ExplorationDriver uses this to filter already-tapped
    // edges from the frontier before running structural heuristics.
    // LLMFallback's wrapper also reads it to compute the trajectory hint.
    trajectory: deps.trajectory,
  };

  // 5. Dispatch, same priority loop as v17.
  for (const driver of drivers) {
    if (!driver || typeof driver.claim !== "function" || typeof driver.decide !== "function") {
      log.warn({ driver: driver && driver.name }, "dispatcher: skipping malformed driver");
      continue;
    }

    let claimed = false;
    try {
      claimed = Boolean(driver.claim(observation, state));
    } catch (err) {
      log.warn({ driver: driver.name, err: err.message }, "dispatcher: driver.claim threw");
      diagnostics.claimThrew.push({ driver: driver.name, err: err.message });
      continue;
    }
    if (!claimed) continue;

    let action = null;
    try {
      action = await driver.decide(observation, state, driverDeps);
    } catch (err) {
      log.warn({ driver: driver.name, err: err.message }, "dispatcher: driver.decide threw");
      diagnostics.decideThrew.push({ driver: driver.name, err: err.message });
      continue;
    }
    if (!action) {
      diagnostics.claimedButNull.push({ driver: driver.name, reason: "decide_returned_null" });
      continue;
    }

    log.info(
      {
        driver: driver.name,
        action: action.type,
        dispatchCount: state && state.dispatchCount,
        screenType: plan.screenType,
      },
      "dispatcher: driver acted",
    );
    recordTapIfAny(action, classifiedClickables, logicalFp, deps);
    recordActionOnTrajectory(action, driver.name, plan.fingerprint, state, deps, plan.screenType, observation.activity);
    return { driver: driver.name, action, diagnostics, plan };
  }

  // 6. LLMFallback (unchanged contract).
  const fallbackDeps = Object.assign({}, driverDeps, {
    getDiagnostics: () => diagnostics,
  });
  const fallbackAction = await llmFallback(observation, state, fallbackDeps);
  log.info(
    {
      action: fallbackAction && fallbackAction.type,
      dispatchCount: state && state.dispatchCount,
      fallbackReason: fallbackDeps.lastLlmFallbackReason || null,
      screenType: plan.screenType,
    },
    "dispatcher: LLMFallback acted",
  );
  recordTapIfAny(fallbackAction, classifiedClickables, logicalFp, deps);
  recordActionOnTrajectory(fallbackAction, "LLMFallback", plan.fingerprint, state, deps, plan.screenType, observation.activity);
  return {
    driver: "LLMFallback",
    action: fallbackAction,
    diagnostics,
    plan,
    llmFallbackReason: fallbackDeps.lastLlmFallbackReason || null,
    llmFallbackSignature: fallbackDeps.lastLlmFallbackSignature || null,
  };
}

/**
 * Phase 3 — if the dispatched action is a tap AND we can find which
 * clickable was tapped via bounds containment, record the edge as
 * visited in the graph-exploration state.
 *
 * 2026-04-25 v2: keyed on LOGICAL fp, not structural. Structural fp
 * churns when feed/list content rotates, which previously revived the
 * frontier on every revisit and let the agent re-tap the same edge
 * indefinitely. Logical fp is stable across content variance.
 *
 * Silently no-op on non-tap actions, missing trajectory, or taps that
 * don't hit any classified clickable (e.g. v16 agent abstract-coord
 * taps — those already fell through the intent validator).
 *
 * @param {object} action
 * @param {object[]} classifiedClickables
 * @param {string} fp                     Logical fp keyed by caller.
 * @param {object} deps
 */
function recordTapIfAny(action, classifiedClickables, fp, deps) {
  if (!action || action.type !== "tap") return;
  if (!fp || !deps || !deps.trajectory) return;
  if (!Array.isArray(classifiedClickables) || classifiedClickables.length === 0) return;
  const hit = findClickableAt(classifiedClickables, action.x, action.y);
  if (!hit) return;
  try {
    recordTap(deps.trajectory, fp, hit);
  } catch (err) {
    log.warn({ err: err.message }, "dispatcher: recordTap failed");
  }
}

/**
 * Phase 4 — append a recentActions entry on every dispatched action.
 * countRecentHubTaps reads from this to detect Home/Profile bounce loops.
 *
 * 2026-04-25 v6: also persist screenType + activity so detectHubRevisit
 * can bucket recent actions at the (activity, screenType) level. The
 * targetText-bucketed detectors miss bottom-nav-bouncing patterns where
 * the agent re-tabs Feed/Shorts/Chat/Connections — each tap is a different
 * label so no targetText bucket fires.
 *
 * @param {object} action
 * @param {string} driverName
 * @param {string} fp
 * @param {object} state
 * @param {object} deps
 * @param {string} [screenType]
 * @param {string} [activity]
 */
function recordActionOnTrajectory(action, driverName, fp, state, deps, screenType, activity) {
  if (!action || !deps || !deps.trajectory) return;
  try {
    recordAction(deps.trajectory, {
      step: (state && state.dispatchCount) || 0,
      driver: driverName,
      actionType: action.type,
      targetText: action.targetText,
      fingerprint: fp,
      screenType: typeof screenType === "string" ? screenType : undefined,
      activity: typeof activity === "string" ? activity : undefined,
      outcome: null, // populated later by caller if available — unused by summarise
    });
  } catch (err) {
    log.warn({ err: err.message }, "dispatcher: recordAction failed");
  }
}

module.exports = {
  dispatch,
  DEFAULT_DRIVERS,
  defaultLlmFallback,
};
