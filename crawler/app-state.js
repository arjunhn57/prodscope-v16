"use strict";

/**
 * app-state.js — High-level app state tracking across crawl steps.
 *
 * Tracks authentication status, onboarding, paywall detection,
 * and destructive action classification.
 */

class AppState {
  constructor() {
    this.authenticated = false;
    this.authAttempts = 0;
    this.authMethod = null;
    this.onboardingComplete = false;
    this.paywallHit = false;
    this.paywallScreenFps = new Set();
    this.mainContentReached = false;
  }

  /**
   * Verify whether authentication succeeded after a form submission.
   *
   * @param {string} prevIntentType - Screen intent BEFORE submit (from screen-intent.js)
   * @param {string} currentScreenType - Screen type AFTER submit (from screen-classifier.js)
   * @param {string} currentIntentType - Screen intent AFTER submit
   * @returns {{ success: boolean|null, reason: string }}
   */
  verifyAuthSuccess(prevIntentType, currentScreenType, currentIntentType) {
    const authIntents = [
      "email_login", "email_signup", "phone_entry",
      "otp_verification", "auth_choice", "email_entry",
    ];
    const wasAuth = authIntents.includes(prevIntentType);
    const isStillAuth = authIntents.includes(currentIntentType);
    const isMainContent = ["feed", "navigation_hub", "profile", "search", "settings"]
      .includes(currentScreenType);

    if (wasAuth && !isStillAuth) {
      this.authenticated = true;
      if (isMainContent) this.mainContentReached = true;
      return { success: true, reason: "screen_changed_to_content" };
    }

    if (wasAuth && isStillAuth) {
      this.authAttempts++;
      return { success: false, reason: "still_on_auth_screen" };
    }

    return { success: null, reason: "inconclusive" };
  }

  /**
   * Detect paywall/subscription gate from XML.
   *
   * @param {string} xml
   * @param {string} exactFp
   * @returns {boolean}
   */
  checkPaywall(xml, exactFp) {
    if (!xml) return false;
    const lower = xml.toLowerCase();

    const signals = [
      "subscribe", "subscription", "premium", "upgrade", "pro plan",
      "free trial", "start trial", "purchase", "buy now", "unlock",
      "pricing", "per month", "/month", "/year", "annual plan",
    ];
    const matchCount = signals.filter((s) => lower.includes(s)).length;

    if (matchCount >= 2) {
      this.paywallHit = true;
      this.paywallScreenFps.add(exactFp);
      return true;
    }
    return false;
  }

  /**
   * Check if an action is destructive (should be deferred to VERIFY mode).
   *
   * @param {object} action - Action from actions.extract()
   * @returns {boolean}
   */
  isDestructiveAction(action) {
    const combined = `${action.text || ""} ${action.contentDesc || ""} ${action.resourceId || ""}`.toLowerCase();
    const keywords = [
      "delete", "remove", "unsubscribe", "deactivate",
      "sign out", "sign-out", "log out", "log-out", "logout",
      "clear data", "clear cache", "block", "report",
      "close account", "reset", "uninstall",
    ];
    return keywords.some((kw) => combined.includes(kw));
  }
}

module.exports = { AppState };
