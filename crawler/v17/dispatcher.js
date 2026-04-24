"use strict";

/**
 * v17/dispatcher.js
 *
 * Driver-priority dispatcher. Iterates drivers in fixed priority order; the
 * first driver that both claims the screen AND produces a non-null action
 * wins. Drivers that claim but yield null fall through to the next driver.
 * If no driver acts, LLMFallback (v16 agent behavior wrapped) takes over.
 *
 * Phase A only wires AuthDriver and a placeholder LLMFallback. Additional
 * drivers (Permission, Dismiss, Onboarding, Exploration) slot in as they
 * ship in Phases B/C.
 *
 * Return contract: always resolves to { driver, action }. `action` is never
 * null — at minimum LLMFallback produces a done() action.
 */

const PermissionDriver = require("./drivers/permission-driver");
const CanvasDriver = require("./drivers/canvas-driver");
const DismissDriver = require("./drivers/dismiss-driver");
const AuthDriver = require("./drivers/auth-driver");
const ExplorationDriver = require("./drivers/exploration-driver");
const { logger } = require("../../lib/logger");

const log = logger.child({ component: "v17-dispatcher" });

/**
 * @typedef {Object} Driver
 * @property {string} name
 * @property {(observation:any) => boolean} claim
 * @property {(observation:any, state:any, deps?:any) => Promise<any|null>|any|null} decide
 *
 * @typedef {Object} DispatchDeps
 * @property {Array<Driver>} [drivers]          - override driver priority list
 * @property {Function} [llmFallback]            - override LLMFallback (async (obs, state, deps) => action)
 * @property {any} [anthropic]                   - Anthropic client forwarded to drivers
 * @property {Map<string, any>} [classifierCache]
 * @property {Function} [classify]               - override node-classifier.classify
 * @property {number} [timeoutMs]                - classifier timeout override
 */

/**
 * Default driver priority order. First non-null decide() wins.
 *
 * 1. PermissionDriver  — system permission dialogs only (hardcoded resource-ids,
 *    no classifier call).
 * 2. CanvasDriver      — empty-tree screens (cold-start splashes, canvas apps);
 *    emits one short wait per fingerprint, then yields.
 * 3. DismissDriver     — upsell / announcement modals on top of real content
 *    (classifier-driven; claim gated on modal-class or close-icon XML).
 * 4. AuthDriver        — any screen matching isAuthScreen (login, signup, SSO,
 *    OTP).
 * 5. ExplorationDriver — standard Android nav (BottomNavigationView, TabLayout,
 *    NavigationDrawer) and homogeneous lists; structural-only, zero AI, with
 *    state memory to prevent tab-dancing and an end-of-scroll detector.
 */
const DEFAULT_DRIVERS = [
  PermissionDriver,
  CanvasDriver,
  DismissDriver,
  AuthDriver,
  ExplorationDriver,
];

/**
 * Phase-A placeholder. The real LLMFallback (D.1) wraps v16 decideNextAction.
 * Until then we emit a done() action so runs terminate cleanly rather than
 * hanging.
 *
 * @returns {Promise<{type:'done', reason:string}>}
 */
async function defaultLlmFallback() {
  return { type: "done", reason: "blocked:llm_fallback_not_implemented" };
}

/**
 * Dispatch one step. Mutates `state.dispatchCount` (increments once per call,
 * initialized to 1 if absent) so drivers' stuck-detection logic has a
 * monotonic counter.
 *
 * @param {{xml?:string, packageName?:string, activity?:string, perceptionCache?:any}} observation
 * @param {Object} state
 * @param {DispatchDeps} [deps]
 * @returns {Promise<{driver:string, action:any}>}
 */
async function dispatch(observation, state, deps = {}) {
  const drivers = Array.isArray(deps.drivers) ? deps.drivers : DEFAULT_DRIVERS;
  const llmFallback = deps.llmFallback || defaultLlmFallback;

  if (state) {
    state.dispatchCount =
      typeof state.dispatchCount === "number" ? state.dispatchCount + 1 : 1;
  }

  // Per-dispatch diagnostics — what each driver did. LLMFallback reads this
  // via deps.getDiagnostics so escalation logs include the upstream decisions.
  const diagnostics = {
    claimedButNull: /** @type {Array<{driver:string, reason:string}>} */ ([]),
    claimThrew: /** @type {Array<{driver:string, err:string}>} */ ([]),
    decideThrew: /** @type {Array<{driver:string, err:string}>} */ ([]),
  };

  const driverDeps = {
    anthropic: deps.anthropic,
    classifierCache: deps.classifierCache,
    classify: deps.classify,
    timeoutMs: deps.timeoutMs,
    // Exposed to llmFallback via closure below. NOT forwarded to real drivers
    // — they should stay oblivious to dispatcher internals.
  };

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
      },
      "dispatcher: driver acted",
    );
    return { driver: driver.name, action, diagnostics };
  }

  // Provide diagnostics to the fallback via a zero-allocation getter so the
  // fallback can log a one-line rationale without widening its signature.
  const fallbackDeps = Object.assign({}, driverDeps, {
    getDiagnostics: () => diagnostics,
  });

  const fallbackAction = await llmFallback(observation, state, fallbackDeps);
  log.info(
    {
      action: fallbackAction && fallbackAction.type,
      dispatchCount: state && state.dispatchCount,
      fallbackReason: fallbackDeps.lastLlmFallbackReason || null,
    },
    "dispatcher: LLMFallback acted",
  );
  return {
    driver: "LLMFallback",
    action: fallbackAction,
    diagnostics,
    llmFallbackReason: fallbackDeps.lastLlmFallbackReason || null,
    llmFallbackSignature: fallbackDeps.lastLlmFallbackSignature || null,
  };
}

module.exports = {
  dispatch,
  DEFAULT_DRIVERS,
  defaultLlmFallback,
};
