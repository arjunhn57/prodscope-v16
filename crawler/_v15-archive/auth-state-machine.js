"use strict";

/**
 * auth-state-machine.js — Finite state machine for auth flow management.
 *
 * Replaces 6+ scattered booleans with explicit states, a hard global step
 * budget, and guest-mode detection. Once the machine enters FAILED_GUEST
 * or ABANDONED, all auth actions are permanently suppressed.
 */

const { logger } = require("../lib/logger");
const log = logger.child({ component: "auth-fsm" });

// ── States ──────────────────────────────────────────────────────────────
const STATE = {
  IDLE:              "IDLE",
  CHOOSING_METHOD:   "CHOOSING_METHOD",
  FILLING_FORM:      "FILLING_FORM",
  SUBMITTING:        "SUBMITTING",
  WAITING_REDIRECT:  "WAITING_REDIRECT",
  SUCCEEDED:         "SUCCEEDED",
  FAILED_GUEST:      "FAILED_GUEST",
  ABANDONED:         "ABANDONED",
};

// ── Per-state step budgets (escalation triggers) ────────────────────────
const STATE_BUDGET = {
  [STATE.CHOOSING_METHOD]:  3,
  [STATE.FILLING_FORM]:     8,   // Raised: multi-page forms need more steps
  [STATE.SUBMITTING]:       4,   // Raised: post-submit verification + redirect
  [STATE.WAITING_REDIRECT]: 3,
};

const GLOBAL_AUTH_BUDGET = 16;   // Raised: 5-page auth flow uses ~10 steps

// ── Auth-related screen intent types ────────────────────────────────────
const AUTH_INTENT_TYPES = new Set([
  "auth_choice", "email_login", "email_signup", "email_entry",
  "phone_entry", "otp_verification",
]);

function isAuthIntent(intentType) {
  return AUTH_INTENT_TYPES.has(intentType) ||
    (intentType && (intentType.startsWith("auth") ||
      intentType.includes("login") ||
      intentType.includes("signup")));
}

// ── Auth escape / skip button labels (ordered by specificity) ──────────
const AUTH_ESCAPE_LABELS = [
  // Most specific first
  "continue as guest", "browse as guest", "browse without login",
  "browse without signing in", "continue without account",
  "skip for now", "skip login", "skip sign in",
  "just browsing", "guest mode", "explore as guest",
  // Generic dismissals
  "skip", "not now", "maybe later", "no thanks", "no, thanks",
  "later", "remind me later", "not interested",
  // Additional patterns (C2)
  "browse", "explore", "as guest", "without login",
  "without signing in", "without account",
];

const AUTH_ESCAPE_REGEX = /skip|not now|maybe later|continue as guest|browse without|skip for now|no thanks|later|continue without|guest mode|just browsing|not interested|explore|as guest|browse$/i;

class AuthStateMachine {
  /**
   * @param {{ email?: string, username?: string, password?: string, phone?: string }} credentials
   * @param {{ authBudget?: number }} [options]
   */
  constructor(credentials, options = {}) {
    this.state = STATE.IDLE;
    this.hasCredentials = !!(
      credentials &&
      (credentials.email || credentials.username) &&
      credentials.password
    );
    this.credentials = credentials || {};
    this.globalBudget = options.authBudget || GLOBAL_AUTH_BUDGET;

    // Counters
    this.totalAuthSteps = 0;
    this.stepsInCurrentState = 0;
    this.fillCount = 0;
    this.maxFills = 5;

    // Submit loop tracking
    this.lastSubmitKey = null;
    this.consecutiveSameSubmit = 0;
    this.maxSameSubmit = 3;

    // Auth screen fingerprint tracking
    this.authScreenFps = new Set();
    this.guestHomeFp = null;

    // Auth choice per-screen retry tracking
    this.choiceRetries = new Map();
    this.maxChoiceRetries = 2;

    // Auth exit loop detection (back from auth = exit app)
    this.authSkipBackCount = 0;
    this.maxAuthSkipBacks = 3;

    // Auth escape button tracking
    this.authEscapeAttempts = 0;
    this.maxAuthEscapeAttempts = 3;
  }

  /** Whether we are in a terminal state (auth resolved one way or another). */
  get isTerminal() {
    return this.state === STATE.SUCCEEDED ||
      this.state === STATE.FAILED_GUEST ||
      this.state === STATE.ABANDONED;
  }

  /** Whether auth is actively in progress (not idle, not terminal). */
  get isActive() {
    return !this.isTerminal && this.state !== STATE.IDLE;
  }

  /** Whether the machine will allow auth attempts. */
  shouldAttemptAuth() {
    if (!this.hasCredentials) return false;
    if (this.isTerminal) return false;
    if (this.totalAuthSteps >= this.globalBudget) return false;
    if (this.fillCount >= this.maxFills) return false;
    return true;
  }

  /** Whether this screen should be skipped (it's auth but we've given up). */
  shouldSuppressAuth(intentType) {
    if (!isAuthIntent(intentType)) return false;
    // Terminal states: always suppress
    if (this.state === STATE.FAILED_GUEST || this.state === STATE.ABANDONED) return true;
    // No credentials and not in a flow: suppress
    if (!this.hasCredentials && this.state === STATE.IDLE) return true;
    return false;
  }

  /** Whether an action leading to a known auth screen should be deprioritized. */
  isKnownAuthScreen(fp) {
    return this.authScreenFps.has(fp);
  }

  /**
   * Main tick — call once per crawl step with the current screen context.
   * Returns { action?: string, reason: string } with an optional directive.
   *
   * @param {string} intentType - Screen intent type
   * @param {string} fp - Current screen fingerprint
   * @returns {{ action?: 'back'|'skip', reason: string }}
   */
  tick(intentType, fp) {
    const isAuth = isAuthIntent(intentType);

    // ── Terminal state: suppress any auth screen ──
    if (this.isTerminal) {
      if (isAuth) {
        return { action: "back", reason: `auth_suppressed_${this.state.toLowerCase()}` };
      }
      return { reason: "auth_resolved" };
    }

    // ── Budget exhausted: abandon ──
    if (this.totalAuthSteps >= this.globalBudget && this.isActive) {
      this._transition(STATE.ABANDONED, `global budget exhausted (${this.totalAuthSteps}/${this.globalBudget})`);
      if (isAuth) return { action: "back", reason: "auth_budget_exhausted" };
      return { reason: "auth_abandoned" };
    }

    // ── Not on an auth screen ──
    if (!isAuth) {
      if (this.isActive) {
        // Was in auth, now on non-auth screen
        this._detectGuestTransition(fp);
      }
      return { reason: "not_auth_screen" };
    }

    // ── On an auth screen ──
    this.authScreenFps.add(fp);
    this.totalAuthSteps++;

    // No credentials: immediate transition to FAILED_GUEST
    if (!this.hasCredentials) {
      this._transition(STATE.FAILED_GUEST, "no credentials provided");
      return { action: "back", reason: "no_credentials" };
    }

    // Fill count exceeded
    if (this.fillCount >= this.maxFills) {
      this._transition(STATE.ABANDONED, `max fills reached (${this.fillCount}/${this.maxFills})`);
      return { action: "back", reason: "max_fills_exceeded" };
    }

    // Enter auth flow if idle
    if (this.state === STATE.IDLE) {
      this._transition(STATE.CHOOSING_METHOD, "auth screen detected");
    }

    // Per-state escalation
    this.stepsInCurrentState++;
    const budget = STATE_BUDGET[this.state];
    if (budget && this.stepsInCurrentState > budget) {
      log.warn({ state: this.state, stepsInCurrentState: this.stepsInCurrentState, budget }, "State exceeded budget");
      this._transition(STATE.FAILED_GUEST, `${this.state} budget exceeded`);
      return { action: "back", reason: `auth_state_budget_exceeded_${this.state.toLowerCase()}` };
    }

    return { reason: `auth_active_${this.state.toLowerCase()}` };
  }

  /**
   * Notify the machine that an auth choice button was tapped.
   * @param {string} fp - Screen fingerprint
   * @param {string} method - "email"|"phone"|"google"|etc
   */
  onChoiceTapped(fp, method) {
    const key = `choice::${fp}`;
    const attempts = (this.choiceRetries.get(key) || 0) + 1;
    this.choiceRetries.set(key, attempts);
    this._transition(STATE.FILLING_FORM, `tapped ${method} login option`);
  }

  /** Whether we should retry auth choice on this screen. */
  canRetryChoice(fp) {
    const key = `choice::${fp}`;
    return (this.choiceRetries.get(key) || 0) < this.maxChoiceRetries;
  }

  /**
   * Notify the machine that a form was filled and submitted.
   * @param {string} submitKey - Unique key for the submit button
   */
  onFormFilled(submitKey) {
    this.fillCount++;
    this._transition(STATE.SUBMITTING, "form filled and submitted");

    if (submitKey) {
      if (submitKey === this.lastSubmitKey) {
        this.consecutiveSameSubmit++;
      } else {
        this.lastSubmitKey = submitKey;
        this.consecutiveSameSubmit = 1;
      }
    }
  }

  /** Whether the submit loop threshold has been reached. */
  isSubmitLooping() {
    return this.consecutiveSameSubmit >= this.maxSameSubmit;
  }

  /**
   * Notify the machine that auth failed (validation error, submit loop, etc.).
   * Transitions to FAILED_GUEST and disables credentials.
   */
  onAuthFailed(reason) {
    this.hasCredentials = false;
    this.consecutiveSameSubmit = 0;
    this.lastSubmitKey = null;
    this._transition(STATE.FAILED_GUEST, reason);
  }

  /**
   * Notify the machine that auth succeeded (non-auth screen after form fill).
   */
  onAuthSucceeded() {
    this._transition(STATE.SUCCEEDED, "non-auth screen after auth submission");
  }

  /**
   * Detect transition from auth to guest mode.
   * Called when we were in an active auth state and land on a non-auth screen.
   */
  _detectGuestTransition(fp) {
    if (this.state === STATE.SUBMITTING || this.state === STATE.WAITING_REDIRECT) {
      // Post-submit, landed on non-auth screen — could be success or guest
      // If form was filled, call it success
      if (this.fillCount > 0) {
        this.onAuthSucceeded();
      } else {
        this.guestHomeFp = fp;
        this._transition(STATE.FAILED_GUEST, "landed on non-auth screen without completing auth");
      }
    } else if (this.state === STATE.CHOOSING_METHOD) {
      // Left auth choice without choosing — guest mode
      this.guestHomeFp = fp;
      this._transition(STATE.FAILED_GUEST, "left auth choice screen");
    }
  }

  /**
   * Internal state transition with logging.
   */
  _transition(newState, reason) {
    const oldState = this.state;
    this.state = newState;
    // Only reset counter on actual state changes — self-transitions must
    // keep incrementing so per-state budgets can fire.
    if (oldState !== newState) {
      this.stepsInCurrentState = 0;
    }
    log.info({ from: oldState, to: newState, reason }, "Auth state transition");
  }

  /**
   * Track a back press from an auth-suppressed screen.
   * Returns true if the app keeps relaunching to auth (exit loop detected).
   */
  recordAuthSkipBack() {
    this.authSkipBackCount++;
    return this.authSkipBackCount >= this.maxAuthSkipBacks;
  }

  /**
   * Record that a skip/escape button was tapped.
   * Resets the back counter (escape is a better signal than BACK)
   * unless max escape attempts exceeded.
   */
  recordAuthEscapeTapped() {
    this.authEscapeAttempts++;
    if (this.authEscapeAttempts < this.maxAuthEscapeAttempts) {
      this.authSkipBackCount = 0;
    }
  }

  /**
   * Transition to FAILED_GUEST after successfully escaping auth via skip button.
   * @param {string} [reason]
   */
  onAuthEscaped(reason) {
    this._transition(STATE.FAILED_GUEST, reason || "escaped auth via skip button");
    this.authSkipBackCount = 0;
  }

  /** Whether the auth exit loop has been detected (app requires auth, no guest mode). */
  get isAuthExitLoop() {
    return this.isTerminal && this.authSkipBackCount >= this.maxAuthSkipBacks;
  }

  /** Snapshot for logging/debugging. */
  toJSON() {
    return {
      state: this.state,
      totalAuthSteps: this.totalAuthSteps,
      globalBudget: this.globalBudget,
      fillCount: this.fillCount,
      hasCredentials: this.hasCredentials,
      authScreenCount: this.authScreenFps.size,
      isTerminal: this.isTerminal,
      authEscapeAttempts: this.authEscapeAttempts,
    };
  }
}

module.exports = { AuthStateMachine, STATE, isAuthIntent, AUTH_ESCAPE_LABELS, AUTH_ESCAPE_REGEX };
