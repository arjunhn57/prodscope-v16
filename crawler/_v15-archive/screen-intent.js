/**
 * screen-intent.js
 * Classifies the current screen into a reusable semantic intent.
 *
 * V2 Phase 2: Added detectScreenIntentFromPerception() for vision-based
 * intent detection when XML is unavailable.
 */

/**
 * Detect screen intent from XML text.
 *
 * @param {string} xml - Screen XML dump
 * @returns {{ type: string, confidence: number, signals: object }}
 */
function detectScreenIntent(xml) {
  const text = String(xml || '').toLowerCase();

  const has = (re) => re.test(text);

  const signals = {
    hasEmail: has(/\bemail\b|\be-mail\b|continue with email|login with email|enter email/),
    hasPhone: has(/\bphone\b|\bmobile\b|phone number|mobile number|enter phone|enter mobile/),
    hasPassword: has(/\bpassword\b|\bpasscode\b|\bpin\b/),
    hasOtp: has(/\botp\b|verification code|one time password|enter code|verify otp|verify code/),
    hasLogin: has(/\blogin\b|\blog in\b|\bsign in\b/),
    hasSignup: has(/\bsign up\b|\bregister\b|create account/),
    hasContinue: has(/\bcontinue\b|\bnext\b|\bproceed\b/),
    hasGoogle: has(/google/),
    hasApple: has(/apple/),
    hasPermission: has(/allow|while using the app|permission/),
    hasError: has(/invalid|required|already exists|already registered|incorrect|try again|error|failed/),
  };

  // Count how many distinct auth providers are present — if multiple,
  // this is an auth choice screen (pick your login method), not a form.
  const providerCount = [signals.hasGoogle, signals.hasApple, signals.hasPhone, signals.hasEmail]
    .filter(Boolean).length;

  let type = 'unknown';
  let confidence = 0.4;

  if (signals.hasPermission) {
    type = 'permission_prompt';
    confidence = 0.95;
  } else if (
    providerCount >= 2 &&
    (signals.hasContinue || signals.hasLogin || signals.hasSignup)
  ) {
    // Multiple auth providers present (e.g. Google + phone + email) — this is
    // an auth choice screen, not a login form, even if email/password signals exist.
    type = 'auth_choice';
    confidence = 0.9;
  } else if (signals.hasPhone && !signals.hasPassword) {
    type = 'phone_entry';
    confidence = signals.hasOtp ? 0.92 : 0.85;
  } else if (signals.hasEmail && signals.hasPassword && signals.hasLogin) {
    type = 'email_login';
    confidence = 0.97;
  } else if (signals.hasEmail && signals.hasPassword && signals.hasSignup) {
    type = 'email_signup';
    confidence = 0.97;
  } else if (signals.hasOtp && !signals.hasPhone && !signals.hasEmail) {
    type = 'otp_verification';
    confidence = 0.9;
  } else if (
    (signals.hasGoogle || signals.hasApple || signals.hasEmail || signals.hasPhone) &&
    (signals.hasContinue || signals.hasLogin || signals.hasSignup)
  ) {
    type = 'auth_choice';
    confidence = 0.8;
  } else if (signals.hasEmail && !signals.hasPassword) {
    type = 'email_entry';
    confidence = 0.75;
  }

  return {
    type,
    confidence,
    signals,
  };
}

/**
 * Derive screen intent from a vision perception result.
 * Used when XML is unavailable (screenshot-only mode, Compose apps).
 *
 * Maps perception screenType + isAuthScreen to the same intent types
 * that detectScreenIntent() returns, so the auth state machine and
 * system handler modules work correctly.
 *
 * @param {object} perception - VisionPerception result from perceive()
 * @returns {{ type: string, confidence: number, signals: object }}
 */
function detectScreenIntentFromPerception(perception) {
  if (!perception) {
    return { type: "unknown", confidence: 0, signals: {} };
  }

  const signals = {
    hasEmail: false,
    hasPhone: false,
    hasPassword: false,
    hasOtp: false,
    hasLogin: false,
    hasSignup: false,
    hasContinue: false,
    hasGoogle: false,
    hasApple: false,
    hasPermission: false,
    hasError: false,
  };

  // Map perception screenType to intent type
  let type = "unknown";
  let confidence = 0.6; // vision-derived confidence baseline

  if (perception.isAuthScreen) {
    // Vision detected auth — map screenType to specific auth intent
    if (perception.screenType === "login") {
      type = "email_login";
      confidence = 0.8;
      signals.hasLogin = true;
      signals.hasEmail = true;
      signals.hasPassword = true;
    } else if (perception.screenType === "form") {
      // Auth form — could be login or signup
      type = "auth_choice";
      confidence = 0.7;
      signals.hasLogin = true;
    } else {
      type = "auth_choice";
      confidence = 0.7;
      signals.hasLogin = true;
    }
  } else if (perception.screenType === "login") {
    // screenType=login but isAuthScreen=false — unusual, trust screenType
    type = "email_login";
    confidence = 0.7;
    signals.hasLogin = true;
    signals.hasEmail = true;
  } else if (perception.screenType === "dialog") {
    // Check description for permission-like content
    const desc = (perception.screenDescription || "").toLowerCase();
    if (/permission|allow|while using/i.test(desc)) {
      type = "permission_prompt";
      confidence = 0.75;
      signals.hasPermission = true;
    }
  } else if (perception.screenType === "error") {
    signals.hasError = true;
  }

  return {
    type,
    confidence,
    signals,
  };
}

module.exports = { detectScreenIntent, detectScreenIntentFromPerception };
