"use strict";

/**
 * v17/drivers/auth-driver.js
 *
 * First deterministic driver in the V17 dispatcher. Handles login and signup
 * screens: email-form state machine, auth-provider selection, OTP detection.
 *
 * Language-agnostic by delegating label semantics to node-classifier (A.1.5).
 * Structural decisions (which node is an input, which has a password attr)
 * come from clickable-graph (A.1) via Android metadata.
 *
 * Return contract: decide() emits an Action or null. null means "not my
 * screen yet" — the dispatcher falls through to the next driver and
 * ultimately to LLMFallback (v16 agent behavior).
 */

const { parseClickableGraph } = require("./clickable-graph");
const nodeClassifier = require("../node-classifier");
const { computeStructuralFingerprint } = require("../node-classifier");
const {
  AUTH_OPTION_REGEX,
  extractClickableLabels,
  extractPerceptionLabels,
} = require("../../v16/auth-escape");
const { logger } = require("../../../lib/logger");

const log = logger.child({ component: "v17-auth-driver" });

/** Max dispatches we can be stuck in the same authStep before yielding. */
const STUCK_DISPATCH_LIMIT = 2;

/**
 * Password-input XML signature. Android inputs with inputType=textPassword
 * (the system-enforced contract for password entry) or resource-ids that
 * developers conventionally name with "password" / "passwd". No user-visible
 * labels — purely the framework-set metadata.
 */
const HAS_PASSWORD_INPUT_REGEX =
  /inputType="textPassword"|password="true"|resource-id="[^"]*(?:password|passwd|pass_word)"/i;

/**
 * @typedef {import('./clickable-graph').Clickable} Clickable
 * @typedef {import('../node-classifier').ClassifiedClickable} ClassifiedClickable
 *
 * @typedef {Object} Credentials
 * @property {string} [email]
 * @property {string} [password]
 *
 * @typedef {Object} AuthDriverState
 * @property {string} [authStep]              - 'email_focused'|'email_typed'|'password_focused'|'password_typed'|'submitted'
 * @property {number} [authStepDispatch]      - dispatch count when authStep was last set
 * @property {number} [dispatchCount]         - driven by dispatcher; incremented before each decide()
 * @property {Credentials|null} [credentials]
 * @property {boolean} [userSeededGoogleAccount]
 * @property {Set<string>} [authBlockedFingerprints]  - fps AuthDriver gave up on; claim() returns false for these (coverage-regression fix 2026-04-23)
 *
 * @typedef {'tap'|'type'|'done'} ActionType
 * @typedef {{type: 'tap', x: number, y: number, targetText?: string}} TapAction
 * @typedef {{type: 'type', text: string}} TypeAction
 * @typedef {{type: 'done', reason: string}} DoneAction
 * @typedef {TapAction|TypeAction|DoneAction} Action
 *
 * @typedef {Object} AuthDriverDeps
 * @property {any} [anthropic]                - Anthropic client (forwarded to classifier)
 * @property {Map<string, any>} [classifierCache]
 * @property {number} [timeoutMs]             - classifier timeout override
 * @property {typeof nodeClassifier.classify} [classify] - injectable for tests
 */

/**
 * Return true only when the current screen shows *structural* evidence of an
 * auth flow AND we have credentials to drive it — otherwise AuthDriver has no
 * business taking the screen.
 *
 * Coverage-regression fix (2026-04-23): two new gates precede the structural
 * signals to keep AuthDriver from killing no-auth crawls.
 *
 *   (G1) `state.credentials` must have both email and password. No creds =
 *        no auth path we can automate — AuthDriver becomes a no-op and the
 *        dispatcher falls through to ExplorationDriver. This alone disables
 *        the driver on Wikipedia, DuckDuckGo, Firefox, Files, etc. — apps
 *        where an "optional sign in" upsell used to trip Signal 2 and
 *        terminate the crawl with `blocked_by_auth:no_credentials`.
 *
 *   (G2) If AuthDriver has already yielded on this screen's structural
 *        fingerprint (i.e. decide() couldn't find a path forward and added
 *        the fp to `state.authBlockedFingerprints`), refuse to re-claim. This
 *        prevents a claim/yield/claim/yield tight loop on a single screen;
 *        the driver gives up once and stays out of the way.
 *
 * Structural signals (unchanged from before, any one still sufficient after
 * G1 + G2):
 *   1. XML contains a password input (inputType=textPassword, password="true",
 *      or resource-id labelled password). Clean Android-framework contract.
 *   2. ≥2 clickable labels match an auth-option CTA regex. A single match is
 *      not enough — profile menus with a stray "Sign out" link or promotional
 *      "Sign in to sync" chips would otherwise trip the driver.
 *
 * @param {{xml?:string|null, packageName?:string, activity?:string, perceptionCache?:{buttons?:Array<any>}|null}|null} observation
 * @param {AuthDriverState} [state]
 * @returns {boolean}
 */
function claim(observation, state) {
  if (!observation || typeof observation !== "object") return false;

  // (G1) Credentials gate — no creds, no AuthDriver.
  const creds = state && state.credentials;
  if (!creds || !creds.email || !creds.password) return false;

  const xml = typeof observation.xml === "string" ? observation.xml : "";
  const hasXml = xml.length > 0;

  // (G2) Blocked-fingerprint gate — if we've yielded here before, stay out.
  //      Compute fp lazily only when we have XML (the cheap path through).
  if (hasXml && state && state.authBlockedFingerprints instanceof Set) {
    const graph = parseClickableGraph(xml);
    const fp = computeStructuralFingerprint(
      graph,
      observation.packageName,
      observation.activity,
    );
    if (state.authBlockedFingerprints.has(fp)) return false;
  }

  // (1) Password-input XML contract — unambiguous auth form signal.
  if (hasXml && HAS_PASSWORD_INPUT_REGEX.test(xml)) return true;

  // (2) Auth-option CTA labels — require ≥2 to suppress false positives.
  //     No fast-path regex: "Continue with Email" has no verb like "sign in",
  //     so any word-level filter would miss it. The full extract pass is
  //     O(n) over XML nodes and returns early on the second match.
  if (hasXml) {
    const xmlCandidates = extractClickableLabels(xml);
    let count = 0;
    for (const c of xmlCandidates) {
      if (AUTH_OPTION_REGEX.test(c.label)) {
        count += 1;
        if (count >= 2) return true;
      }
    }
  }

  // (3) Perception-cache fallback — for Compose/Canvas apps where the
  //     accessibility tree doesn't expose labels but the vision pass did.
  const perc = observation && observation.perceptionCache;
  if (perc) {
    const percCandidates = extractPerceptionLabels(perc);
    let percCount = 0;
    for (const c of percCandidates) {
      if (AUTH_OPTION_REGEX.test(c.label)) {
        percCount += 1;
        if (percCount >= 2) return true;
      }
    }
  }

  return false;
}

/**
 * Record a fingerprint as one AuthDriver could not drive to completion. Future
 * claim() calls on the same fp will return false, so the dispatcher falls
 * through to ExplorationDriver / LLMFallback instead of re-entering a loop.
 *
 * Called when decide() would otherwise have emitted a terminal
 * `done('blocked_by_auth:*')` — coverage-regression fix 2026-04-23.
 *
 * @param {AuthDriverState} state
 * @param {{xml?:string|null, packageName?:string, activity?:string}} observation
 * @param {string} reason  Used only for logging.
 * @returns {null}         Convenience: call sites `return markBlocked(...)`.
 */
function markFingerprintBlocked(state, observation, reason) {
  if (!state || typeof state !== "object") return null;
  if (!(state.authBlockedFingerprints instanceof Set)) {
    state.authBlockedFingerprints = new Set();
  }
  const xml = typeof observation.xml === "string" ? observation.xml : "";
  if (!xml) {
    log.warn({ reason }, "AuthDriver: yielding without fp (empty XML)");
    return null;
  }
  const graph = parseClickableGraph(xml);
  const fp = computeStructuralFingerprint(
    graph,
    observation.packageName,
    observation.activity,
  );
  state.authBlockedFingerprints.add(fp);
  log.info(
    { fingerprint: fp, reason, pkg: observation.packageName || "" },
    "AuthDriver: yielding to ExplorationDriver, fingerprint blocked",
  );
  return null;
}

/**
 * Produce the next action for an auth screen, or null if we can't decide.
 *
 * @param {{xml?:string, packageName?:string, activity?:string, perceptionCache?:any}} observation
 * @param {AuthDriverState} state
 * @param {AuthDriverDeps} [deps]
 * @returns {Promise<Action|null>}
 */
async function decide(observation, state, deps = {}) {
  if (!observation || typeof observation !== "object") return null;

  // Stuck detection: if state.authStep hasn't moved in >=2 dispatches, yield.
  if (
    state &&
    state.authStep &&
    typeof state.dispatchCount === "number" &&
    typeof state.authStepDispatch === "number" &&
    state.dispatchCount - state.authStepDispatch >= STUCK_DISPATCH_LIMIT
  ) {
    log.warn(
      { authStep: state.authStep, dispatchCount: state.dispatchCount },
      "AuthDriver: stuck — yielding to LLMFallback",
    );
    return null;
  }

  const graph = parseClickableGraph(observation.xml);
  if (graph.clickables.length === 0) return null;

  const classifyFn = deps.classify || nodeClassifier.classify;
  const classified = await classifyFn(graph, observation, {
    anthropic: deps.anthropic,
    cache: deps.classifierCache,
    timeoutMs: deps.timeoutMs,
  });
  if (!classified) return null;

  const screenType = classifyScreen(classified);
  log.debug({ screenType, authStep: state && state.authStep }, "AuthDriver classified screen");

  switch (screenType) {
    case "email_form":
      return executeEmailFlow(classified, state, observation);
    case "auth_choice":
      return executeAuthChoice(classified, state, observation);
    case "otp":
      // OTP screens cannot be driven without a phone/email the user controls.
      // Yield, mark the fp blocked, and let ExplorationDriver / LLMFallback
      // try press_back or other nav. The agent-loop's fp_revisit_loop guard
      // still terminates the run if we truly can't progress.
      return markFingerprintBlocked(state, observation, "otp_required");
    default:
      return null;
  }
}

/**
 * Classify the overall screen shape from the per-node roles.
 *
 * @param {Array<ClassifiedClickable>} classified
 * @returns {'email_form'|'auth_choice'|'otp'|'unknown'}
 */
function classifyScreen(classified) {
  const emailInputs = classified.filter((c) => c.role === "email_input");
  const passwordInputs = classified.filter((c) => c.role === "password_input");
  const authOptions = classified.filter((c) => typeof c.role === "string" && c.role.startsWith("auth_option_"));
  const otpInputs = classified.filter((c) => c.role === "otp_input");

  if (emailInputs.length >= 1 && passwordInputs.length >= 1) return "email_form";
  if (authOptions.length >= 2 && passwordInputs.length === 0) return "auth_choice";
  if (otpInputs.length >= 1) return "otp";
  return "unknown";
}

/**
 * Email-form state machine. Each call advances exactly one step.
 *
 * States: undefined → email_focused → email_typed → password_focused → password_typed → submitted.
 * After submitted, the driver yields (returns null) if the screen is still an email form.
 *
 * Coverage-regression fix (2026-04-23): no-credentials branches that used to
 * emit `done('blocked_by_auth:no_credentials')` now yield null + mark the fp
 * blocked. Terminal `done()` from a driver kills the whole crawl; yielding
 * lets ExplorationDriver take over.
 *
 * @param {Array<ClassifiedClickable>} classified
 * @param {AuthDriverState} state
 * @param {{xml?:string|null, packageName?:string, activity?:string}} observation
 * @returns {Action|null}
 */
function executeEmailFlow(classified, state, observation) {
  const emailInput = classified.find((c) => c.role === "email_input");
  const passwordInput = classified.find((c) => c.role === "password_input");
  const submitButton = pickSubmitButton(classified);
  const creds = state && state.credentials;
  const step = (state && state.authStep) || "initial";

  switch (step) {
    case "initial": {
      if (!emailInput) return null;
      advanceStep(state, "email_focused");
      return tapAction(emailInput);
    }
    case "email_focused": {
      if (!creds || !creds.email) {
        return markFingerprintBlocked(state, observation, "no_credentials_email");
      }
      advanceStep(state, "email_typed");
      return { type: "type", text: "${EMAIL}" };
    }
    case "email_typed": {
      if (!passwordInput) return null;
      advanceStep(state, "password_focused");
      return tapAction(passwordInput);
    }
    case "password_focused": {
      if (!creds || !creds.password) {
        return markFingerprintBlocked(state, observation, "no_credentials_password");
      }
      advanceStep(state, "password_typed");
      return { type: "type", text: "${PASSWORD}" };
    }
    case "password_typed": {
      if (!submitButton) return null;
      advanceStep(state, "submitted");
      return tapAction(submitButton);
    }
    case "submitted":
      // Still on the form — probably invalid creds or a captcha. Yield.
      return null;
    default:
      return null;
  }
}

/**
 * Auth-choice routing. Honors the user-creds-priority memory: user-provided
 * email/password always beats Google SSO, which beats dismiss/skip.
 *
 * Coverage-regression fix (2026-04-23): the no-known-path exit yields null +
 * blocks the fp instead of emitting terminal `done('blocked_by_auth:*')` so
 * ExplorationDriver can attempt the screen rather than the whole crawl
 * ending.
 *
 * @param {Array<ClassifiedClickable>} classified
 * @param {AuthDriverState} state
 * @param {{xml?:string|null, packageName?:string, activity?:string}} observation
 * @returns {Action|null}
 */
function executeAuthChoice(classified, state, observation) {
  const creds = state && state.credentials;
  const seededGoogle = !!(state && state.userSeededGoogleAccount);

  const emailOption = classified.find((c) => c.role === "auth_option_email");
  const googleOption = classified.find((c) => c.role === "auth_option_google");
  const dismissOptions = classified.filter((c) => c.role === "dismiss_button");

  if (creds && creds.email && creds.password && emailOption) {
    return tapAction(emailOption);
  }
  if (seededGoogle && googleOption) {
    return tapAction(googleOption);
  }
  if (dismissOptions.length > 0) {
    const topmost = dismissOptions.reduce((a, b) => (a.cy < b.cy ? a : b));
    return tapAction(topmost);
  }
  return markFingerprintBlocked(state, observation, "no_known_path");
}

/**
 * If the classifier tagged multiple submit buttons, tiebreak by picking the
 * lowest y-coordinate (conventional form-bottom placement).
 *
 * @param {Array<ClassifiedClickable>} classified
 * @returns {ClassifiedClickable|null}
 */
function pickSubmitButton(classified) {
  const candidates = classified.filter((c) => c.role === "submit_button");
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  return candidates.reduce((a, b) => (a.cy > b.cy ? a : b));
}

/**
 * Build a tap action from a classified clickable. Passes the label as
 * targetText so the executor's XML resolver can verify the coordinate.
 *
 * @param {ClassifiedClickable} clickable
 * @returns {TapAction}
 */
function tapAction(clickable) {
  const action = { type: "tap", x: clickable.cx, y: clickable.cy };
  if (clickable.label) action.targetText = clickable.label;
  return action;
}

/**
 * Advance the state machine and record the dispatch count for stuck detection.
 *
 * @param {AuthDriverState} state
 * @param {string} next
 */
function advanceStep(state, next) {
  if (!state) return;
  state.authStep = next;
  if (typeof state.dispatchCount === "number") {
    state.authStepDispatch = state.dispatchCount;
  }
}

module.exports = {
  name: "AuthDriver",
  claim,
  decide,
  // exported for direct testing
  classifyScreen,
  executeEmailFlow,
  executeAuthChoice,
  pickSubmitButton,
  markFingerprintBlocked,
  STUCK_DISPATCH_LIMIT,
};
