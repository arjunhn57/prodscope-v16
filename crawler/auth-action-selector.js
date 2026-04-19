"use strict";

/**
 * auth-action-selector.js — Deterministic action selection for auth screens.
 *
 * Pure functions only. Given (ScreenPerception, CredentialState, Credentials),
 * returns exactly one AuthAction. No side effects, no ADB calls, no vision calls.
 *
 * Algorithm phases (first match wins):
 *   0. Error detection — abort if credentials rejected
 *   1. Loading — wait
 *   2. Method choice — tap matching auth method button
 *   3. Fill fields — type credential into empty field
 *   4. Submit — tap submit/continue when all visible fields filled
 *   5. Advance — tap continue/next on interstitial pages
 *   6. OTP — abort if OTP required but no code available
 *   7. Stuck — press back
 */

// ── Credential rejection patterns ──────────────────────────────────────
const REJECTION_PATTERNS = /incorrect|wrong password|invalid.*password|invalid.*credentials|authentication failed|login failed|sign.?in failed|account.*not found|no account|user not found/i;
const ACCOUNT_EXISTS_PATTERNS = /already registered|already exists|account exists|email.*taken|email.*use|try.*log.?in/i;

// ── Method button roles that indicate auth method selection ─────────────
const METHOD_ROLES = new Set([
  "use_email_button", "use_phone_button",
  "google_button", "facebook_button", "apple_button",
]);

// ── Submit/continue button roles ───────────────────────────────────────
const SUBMIT_ROLES = new Set([
  "submit_button", "login_button", "signup_button", "continue_button", "next_button",
]);

// ── Field roles that map to specific credentials ───────────────────────
const FIELD_CREDENTIAL_MAP = {
  email_field:    (c) => c.email || c.username || "",
  password_field: (c) => c.password || "",
  phone_field:    (c) => c.phone || c.email || "",
  username_field: (c) => c.username || c.email || "",
  otp_field:      (c) => c.otp || "",
  name_field:     (c) => c.name || "Test User",
};

/**
 * Match a field role to the appropriate credential value.
 *
 * @param {string} fieldRole - e.g. "email_field", "password_field"
 * @param {object} credentials - { email, username, password, phone, otp, name }
 * @returns {string} Credential value or empty string
 */
function matchCredentialToField(fieldRole, credentials) {
  const getter = FIELD_CREDENTIAL_MAP[fieldRole];
  if (getter) return getter(credentials);

  // unknown_field: infer from context — email if nothing entered yet
  if (fieldRole === "unknown_field") {
    return credentials.email || credentials.username || "";
  }
  return "";
}

/**
 * Check whether a credential for a given field role has already been entered.
 *
 * @param {object} credState - CredentialState
 * @param {string} fieldRole - e.g. "email_field", "password_field"
 * @returns {boolean}
 */
function isCredentialEntered(credState, fieldRole) {
  switch (fieldRole) {
    case "email_field":    return credState.emailEntered;
    case "password_field": return credState.passwordEntered;
    case "phone_field":    return credState.phoneEntered;
    case "username_field": return credState.usernameEntered || credState.emailEntered;
    case "otp_field":      return credState.otpEntered;
    default:               return false;
  }
}

/**
 * Mark a credential as entered in the state.
 * Returns a NEW state object (immutable).
 *
 * @param {object} credState - Current CredentialState
 * @param {string} fieldRole - Which field was filled
 * @returns {object} New CredentialState
 */
function markCredentialEntered(credState, fieldRole) {
  const next = { ...credState };
  switch (fieldRole) {
    case "email_field":    next.emailEntered = true; break;
    case "password_field": next.passwordEntered = true; break;
    case "phone_field":    next.phoneEntered = true; break;
    case "username_field": next.usernameEntered = true; break;
    case "otp_field":      next.otpEntered = true; break;
  }
  return next;
}

/**
 * Create a fresh CredentialState.
 * @returns {object}
 */
function createCredentialState() {
  return {
    emailEntered: false,
    passwordEntered: false,
    phoneEntered: false,
    usernameEntered: false,
    otpEntered: false,
    submittedCount: 0,
    lastSubmittedHash: null,
    pagesTraversed: 0,
    errors: [],
  };
}

/**
 * Select the best auth action given current screen state and credential state.
 *
 * @param {object} perception - ScreenPerception { fields[], buttons[], hasError, errorText, isLoading, screenType }
 * @param {object} credState - CredentialState
 * @param {object} credentials - { email, username, password, phone, otp }
 * @returns {{ type: string, target?: object, value?: string, fieldRole?: string, buttonRole?: string, reason: string }}
 */
function selectAuthAction(perception, credState, credentials) {
  const { fields = [], buttons = [], hasError, errorText, isLoading, screenType } = perception;

  // ── Phase 0: Error detection ─────────────────────────────────────────
  if (hasError && credState.submittedCount > 0) {
    if (errorText && REJECTION_PATTERNS.test(errorText)) {
      return { type: "abort", reason: "credentials_rejected", errorText };
    }
    if (errorText && ACCOUNT_EXISTS_PATTERNS.test(errorText)) {
      // On signup page but account exists — look for login link
      const loginBtn = buttons.find((b) =>
        b.role === "login_button" || (b.label && /log.?in|sign.?in/i.test(b.label))
      );
      if (loginBtn) {
        return { type: "tap_button", target: loginBtn, buttonRole: loginBtn.role, reason: "switch_to_login" };
      }
    }
    // Persistent error after multiple attempts — abort
    if (credState.errors.length >= 2) {
      return { type: "abort", reason: "persistent_error", errorText };
    }
  }

  // ── Phase 1: Loading ─────────────────────────────────────────────────
  if (isLoading) {
    return { type: "wait", reason: "page_loading" };
  }

  // ── Phase 2: Method choice ───────────────────────────────────────────
  // Triggers when: (a) no fields + method buttons, OR
  // (b) fields present but don't match our credentials and a method button does.
  // Example: phone_field visible + "Continue with Email" button, but we only have email creds.
  const methodButtons = buttons.filter((b) => METHOD_ROLES.has(b.role));
  if (methodButtons.length > 0) {
    const hasEmail = !!(credentials.email || credentials.username);
    const hasPhone = !!credentials.phone;

    // Check if visible fields can be filled with our credentials
    const fillableFields = fields.filter((f) => {
      if (f.filled) return false;
      if (isCredentialEntered(credState, f.role)) return false;
      const val = matchCredentialToField(f.role, credentials);
      // phone_field with email-as-fallback doesn't count as a real match
      if (f.role === "phone_field" && !hasPhone) return false;
      return !!val;
    });

    // Don't trigger method choice if all fields are already entered and
    // a submit button exists — that's "ready to submit", not "choose method"
    const allFieldsEntered = fields.length > 0 &&
      fields.every((f) => f.filled || isCredentialEntered(credState, f.role));
    const hasSubmitBtn = buttons.some((b) => SUBMIT_ROLES.has(b.role));

    const shouldChooseMethod = !allFieldsEntered &&
      (fields.length === 0 || fillableFields.length === 0);

    if (shouldChooseMethod) {
      // Pick the method matching available credentials
      let preferred = null;
      if (hasEmail) {
        preferred = methodButtons.find((b) => b.role === "use_email_button");
      }
      if (!preferred && hasPhone) {
        preferred = methodButtons.find((b) => b.role === "use_phone_button");
      }
      if (!preferred) {
        // Pick first non-social method, or first available
        preferred = methodButtons.find((b) => b.role === "use_email_button" || b.role === "use_phone_button") ||
          methodButtons[0];
      }
      if (preferred) {
        return { type: "tap_button", target: preferred, buttonRole: preferred.role, reason: "select_auth_method" };
      }
    }
  }

  // ── Phase 3: Fill empty fields with matching credentials ─────────────
  // Sort fields top-to-bottom for natural form order
  const sortedFields = [...fields].sort((a, b) => (a.y || 0) - (b.y || 0));
  for (const field of sortedFields) {
    if (field.filled) continue;
    if (isCredentialEntered(credState, field.role)) continue;

    const value = matchCredentialToField(field.role, credentials);
    if (!value) continue;

    return {
      type: "fill_field",
      target: field,
      value,
      fieldRole: field.role,
      reason: `fill_${field.role}`,
    };
  }

  // ── Phase 4: All visible fields filled — submit ──────────────────────
  const emptyFields = sortedFields.filter((f) => !f.filled && !isCredentialEntered(credState, f.role));
  if (emptyFields.length === 0 && fields.length > 0) {
    // Look for submit/continue button
    const submitBtn = findBestSubmitButton(buttons);
    if (submitBtn) {
      return { type: "tap_button", target: submitBtn, buttonRole: submitBtn.role, reason: "submit_form" };
    }
    // No visible submit button — try IME enter
    return { type: "press_enter", reason: "submit_via_ime" };
  }

  // ── Phase 5: No fields, has continue/next/skip button ────────────────
  if (fields.length === 0) {
    const advanceBtn = buttons.find((b) =>
      b.role === "continue_button" || b.role === "next_button" || b.role === "skip_button"
    );
    if (advanceBtn) {
      return { type: "tap_button", target: advanceBtn, buttonRole: advanceBtn.role, reason: "advance_interstitial" };
    }
  }

  // ── Phase 6: OTP screen without code ─────────────────────────────────
  if (screenType === "otp") {
    const otpField = fields.find((f) => f.role === "otp_field");
    if (otpField && credentials.otp) {
      return { type: "fill_field", target: otpField, value: credentials.otp, fieldRole: "otp_field", reason: "fill_otp" };
    }
    return { type: "abort", reason: "otp_required_no_code" };
  }

  // ── Phase 7: Nothing actionable ──────────────────────────────────────
  return { type: "press_back", reason: "no_actionable_elements" };
}

/**
 * Find the best submit/continue button from a list.
 * Prefers: login > signup > submit > continue > next.
 *
 * @param {Array} buttons
 * @returns {object|null}
 */
function findBestSubmitButton(buttons) {
  const priority = ["login_button", "signup_button", "submit_button", "continue_button", "next_button"];
  for (const role of priority) {
    const btn = buttons.find((b) => b.role === role);
    if (btn) return btn;
  }
  // Fallback: any button with submit-like label
  return buttons.find((b) =>
    b.label && /sign.?in|log.?in|submit|continue|next|register|create account|\bgo\b|enter/i.test(b.label)
  ) || null;
}

module.exports = {
  selectAuthAction,
  matchCredentialToField,
  isCredentialEntered,
  markCredentialEntered,
  createCredentialState,
  findBestSubmitButton,
  // Exported for testing
  REJECTION_PATTERNS,
  ACCOUNT_EXISTS_PATTERNS,
};
