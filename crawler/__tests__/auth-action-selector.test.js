"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  selectAuthAction,
  matchCredentialToField,
  isCredentialEntered,
  markCredentialEntered,
  createCredentialState,
  findBestSubmitButton,
} = require("../auth-action-selector");

// ── Helpers ────────────────────────────────────────────────────────────
const CREDS = { email: "a6zev@dollicons.com", password: "Test@123" };
const CREDS_PHONE = { phone: "+1234567890", password: "Test@123" };
const CREDS_WITH_OTP = { email: "a@b.com", password: "p", otp: "123456" };

function field(role, opts = {}) {
  return { role, x: opts.x || 540, y: opts.y || 800, filled: !!opts.filled, focused: !!opts.focused };
}

function button(role, label, opts = {}) {
  return { role, label, x: opts.x || 540, y: opts.y || 1200 };
}

function perception(overrides = {}) {
  return {
    screenType: "login",
    fields: [],
    buttons: [],
    hasError: false,
    errorText: null,
    isLoading: false,
    ...overrides,
  };
}

// ── matchCredentialToField ─────────────────────────────────────────────
describe("matchCredentialToField", () => {
  it("maps email_field to email credential", () => {
    assert.strictEqual(matchCredentialToField("email_field", CREDS), "a6zev@dollicons.com");
  });

  it("maps email_field to username if no email", () => {
    assert.strictEqual(matchCredentialToField("email_field", { username: "user1" }), "user1");
  });

  it("maps password_field to password", () => {
    assert.strictEqual(matchCredentialToField("password_field", CREDS), "Test@123");
  });

  it("maps phone_field to phone credential", () => {
    assert.strictEqual(matchCredentialToField("phone_field", CREDS_PHONE), "+1234567890");
  });

  it("maps phone_field to email as fallback", () => {
    assert.strictEqual(matchCredentialToField("phone_field", CREDS), "a6zev@dollicons.com");
  });

  it("maps username_field to username", () => {
    assert.strictEqual(matchCredentialToField("username_field", { username: "user1" }), "user1");
  });

  it("maps username_field to email as fallback", () => {
    assert.strictEqual(matchCredentialToField("username_field", CREDS), "a6zev@dollicons.com");
  });

  it("maps otp_field to otp", () => {
    assert.strictEqual(matchCredentialToField("otp_field", CREDS_WITH_OTP), "123456");
  });

  it("returns empty for otp_field without otp", () => {
    assert.strictEqual(matchCredentialToField("otp_field", CREDS), "");
  });

  it("maps unknown_field to email", () => {
    assert.strictEqual(matchCredentialToField("unknown_field", CREDS), "a6zev@dollicons.com");
  });
});

// ── isCredentialEntered / markCredentialEntered ─────────────────────────
describe("CredentialState helpers", () => {
  it("createCredentialState returns all false", () => {
    const s = createCredentialState();
    assert.strictEqual(s.emailEntered, false);
    assert.strictEqual(s.passwordEntered, false);
    assert.strictEqual(s.submittedCount, 0);
  });

  it("isCredentialEntered checks correct flags", () => {
    const s = { ...createCredentialState(), emailEntered: true };
    assert.strictEqual(isCredentialEntered(s, "email_field"), true);
    assert.strictEqual(isCredentialEntered(s, "password_field"), false);
  });

  it("markCredentialEntered returns new object", () => {
    const s = createCredentialState();
    const next = markCredentialEntered(s, "email_field");
    assert.strictEqual(s.emailEntered, false); // original unchanged
    assert.strictEqual(next.emailEntered, true);
  });

  it("markCredentialEntered handles password", () => {
    const s = createCredentialState();
    const next = markCredentialEntered(s, "password_field");
    assert.strictEqual(next.passwordEntered, true);
  });
});

// ── selectAuthAction: Phase 0 (Error detection) ───────────────────────
describe("selectAuthAction — Phase 0: Error detection", () => {
  it("aborts on credential rejection error after submit", () => {
    const state = { ...createCredentialState(), submittedCount: 1 };
    const p = perception({ hasError: true, errorText: "Incorrect password" });
    const action = selectAuthAction(p, state, CREDS);
    assert.strictEqual(action.type, "abort");
    assert.strictEqual(action.reason, "credentials_rejected");
  });

  it("does NOT abort on error before any submit", () => {
    const state = createCredentialState();
    const p = perception({
      hasError: true, errorText: "Incorrect password",
      fields: [field("email_field")],
    });
    const action = selectAuthAction(p, state, CREDS);
    assert.notStrictEqual(action.type, "abort");
  });

  it("tries to switch to login on 'account exists' error", () => {
    const state = { ...createCredentialState(), submittedCount: 1 };
    const loginBtn = button("login_button", "Log In");
    const p = perception({
      hasError: true, errorText: "Email already registered",
      buttons: [loginBtn],
    });
    const action = selectAuthAction(p, state, CREDS);
    assert.strictEqual(action.type, "tap_button");
    assert.strictEqual(action.reason, "switch_to_login");
  });

  it("aborts after persistent errors", () => {
    const state = { ...createCredentialState(), submittedCount: 1, errors: ["err1", "err2"] };
    const p = perception({ hasError: true, errorText: "Something went wrong" });
    const action = selectAuthAction(p, state, CREDS);
    assert.strictEqual(action.type, "abort");
    assert.strictEqual(action.reason, "persistent_error");
  });
});

// ── selectAuthAction: Phase 1 (Loading) ───────────────────────────────
describe("selectAuthAction — Phase 1: Loading", () => {
  it("waits when page is loading", () => {
    const action = selectAuthAction(
      perception({ isLoading: true }),
      createCredentialState(), CREDS,
    );
    assert.strictEqual(action.type, "wait");
    assert.strictEqual(action.reason, "page_loading");
  });
});

// ── selectAuthAction: Phase 2 (Method choice) ─────────────────────────
describe("selectAuthAction — Phase 2: Method choice", () => {
  it("selects email method when credentials have email", () => {
    const p = perception({
      screenType: "method_choice",
      buttons: [
        button("use_email_button", "Continue with Email"),
        button("google_button", "Continue with Google"),
      ],
    });
    const action = selectAuthAction(p, createCredentialState(), CREDS);
    assert.strictEqual(action.type, "tap_button");
    assert.strictEqual(action.buttonRole, "use_email_button");
    assert.strictEqual(action.reason, "select_auth_method");
  });

  it("selects phone method when only phone credentials", () => {
    const p = perception({
      screenType: "method_choice",
      buttons: [
        button("use_email_button", "Continue with Email"),
        button("use_phone_button", "Continue with Phone"),
      ],
    });
    const action = selectAuthAction(p, createCredentialState(), CREDS_PHONE);
    assert.strictEqual(action.buttonRole, "use_phone_button");
  });

  it("does NOT select method if fields are present (form, not choice)", () => {
    const p = perception({
      fields: [field("email_field")],
      buttons: [button("use_email_button", "Continue with Email")],
    });
    const action = selectAuthAction(p, createCredentialState(), CREDS);
    // Should fill the field, not tap the method button
    assert.strictEqual(action.type, "fill_field");
    assert.strictEqual(action.fieldRole, "email_field");
  });
});

// ── selectAuthAction: Phase 3 (Fill fields) ───────────────────────────
describe("selectAuthAction — Phase 3: Fill fields", () => {
  it("fills email field first on single-page login", () => {
    const p = perception({
      fields: [field("email_field"), field("password_field", { y: 900 })],
      buttons: [button("login_button", "Login")],
    });
    const action = selectAuthAction(p, createCredentialState(), CREDS);
    assert.strictEqual(action.type, "fill_field");
    assert.strictEqual(action.fieldRole, "email_field");
    assert.strictEqual(action.value, "a6zev@dollicons.com");
  });

  it("fills password after email is entered", () => {
    const state = { ...createCredentialState(), emailEntered: true };
    const p = perception({
      fields: [field("email_field", { filled: true }), field("password_field", { y: 900 })],
      buttons: [button("login_button", "Login")],
    });
    const action = selectAuthAction(p, state, CREDS);
    assert.strictEqual(action.type, "fill_field");
    assert.strictEqual(action.fieldRole, "password_field");
    assert.strictEqual(action.value, "Test@123");
  });

  it("skips already-filled fields", () => {
    const state = { ...createCredentialState(), emailEntered: true };
    const p = perception({
      fields: [field("email_field", { filled: true }), field("password_field", { y: 900, filled: true })],
      buttons: [button("login_button", "Login")],
    });
    // Both fields filled + email entered → should submit, not try to fill
    const action = selectAuthAction(p, state, CREDS);
    assert.strictEqual(action.type, "tap_button");
    assert.strictEqual(action.reason, "submit_form");
  });

  it("skips fields with no matching credential", () => {
    const p = perception({
      fields: [field("otp_field")], // No OTP credential in CREDS
      buttons: [button("submit_button", "Verify")],
    });
    const action = selectAuthAction(p, createCredentialState(), CREDS);
    // Can't fill OTP → falls through. Fields present but all unfillable.
    // emptyFields has otp (not entered), but no value → skip.
    // Falls to Phase 4: emptyFields.length > 0 → skip submit.
    // Falls to Phase 7: press_back.
    assert.strictEqual(action.type, "press_back");
  });
});

// ── selectAuthAction: Phase 4 (Submit) ────────────────────────────────
describe("selectAuthAction — Phase 4: Submit", () => {
  it("taps login button when all fields filled", () => {
    const state = { ...createCredentialState(), emailEntered: true, passwordEntered: true };
    const p = perception({
      fields: [field("email_field", { filled: true }), field("password_field", { filled: true })],
      buttons: [button("login_button", "Sign In")],
    });
    const action = selectAuthAction(p, state, CREDS);
    assert.strictEqual(action.type, "tap_button");
    assert.strictEqual(action.buttonRole, "login_button");
    assert.strictEqual(action.reason, "submit_form");
  });

  it("presses enter if no submit button visible", () => {
    const state = { ...createCredentialState(), emailEntered: true, passwordEntered: true };
    const p = perception({
      fields: [field("email_field", { filled: true }), field("password_field", { filled: true })],
      buttons: [], // No buttons
    });
    const action = selectAuthAction(p, state, CREDS);
    assert.strictEqual(action.type, "press_enter");
    assert.strictEqual(action.reason, "submit_via_ime");
  });
});

// ── selectAuthAction: Phase 5 (Advance) ───────────────────────────────
describe("selectAuthAction — Phase 5: Advance interstitial", () => {
  it("taps continue on empty page with continue button", () => {
    const p = perception({
      buttons: [button("continue_button", "Continue")],
    });
    const action = selectAuthAction(p, createCredentialState(), CREDS);
    assert.strictEqual(action.type, "tap_button");
    assert.strictEqual(action.buttonRole, "continue_button");
    assert.strictEqual(action.reason, "advance_interstitial");
  });
});

// ── selectAuthAction: Phase 6 (OTP) ──────────────────────────────────
describe("selectAuthAction — Phase 6: OTP", () => {
  it("aborts on OTP screen without code", () => {
    const p = perception({
      screenType: "otp",
      fields: [field("otp_field")],
    });
    const action = selectAuthAction(p, createCredentialState(), CREDS);
    assert.strictEqual(action.type, "abort");
    assert.strictEqual(action.reason, "otp_required_no_code");
  });

  it("fills OTP field when code available", () => {
    const p = perception({
      screenType: "otp",
      fields: [field("otp_field")],
    });
    const action = selectAuthAction(p, createCredentialState(), CREDS_WITH_OTP);
    assert.strictEqual(action.type, "fill_field");
    assert.strictEqual(action.fieldRole, "otp_field");
    assert.strictEqual(action.value, "123456");
  });
});

// ── selectAuthAction: Phase 7 (Stuck) ─────────────────────────────────
describe("selectAuthAction — Phase 7: Stuck", () => {
  it("presses back when nothing actionable", () => {
    const action = selectAuthAction(perception(), createCredentialState(), CREDS);
    assert.strictEqual(action.type, "press_back");
    assert.strictEqual(action.reason, "no_actionable_elements");
  });
});

// ── CRITICAL: Biztoso regression test ─────────────────────────────────
describe("Biztoso regression — multi-page signup", () => {
  it("does NOT type password when only email field + Continue button visible", () => {
    // Scenario: after login fails, app shows "Sign Up With Email" with
    // one email field + Continue button. Password field is on the NEXT page.
    const state = createCredentialState(); // nothing entered yet
    const p = perception({
      screenType: "signup",
      fields: [field("email_field", { y: 541 })],
      buttons: [button("continue_button", "Continue", { y: 685 })],
    });

    // Step 1: should fill email
    const action1 = selectAuthAction(p, state, CREDS);
    assert.strictEqual(action1.type, "fill_field");
    assert.strictEqual(action1.fieldRole, "email_field");
    assert.strictEqual(action1.value, "a6zev@dollicons.com");

    // Step 2: email entered, field now filled — should tap Continue, NOT type password
    const state2 = { ...markCredentialEntered(state, "email_field") };
    const p2 = perception({
      screenType: "signup",
      fields: [field("email_field", { y: 541, filled: true })],
      buttons: [button("continue_button", "Continue", { y: 685 })],
    });

    const action2 = selectAuthAction(p2, state2, CREDS);
    assert.strictEqual(action2.type, "tap_button");
    assert.strictEqual(action2.buttonRole, "continue_button");
    assert.strictEqual(action2.reason, "submit_form");
    // CRITICAL: action2 must NOT be fill_field with password value
    assert.notStrictEqual(action2.fieldRole, "password_field");
  });

  it("types password on next page when password field appears", () => {
    // After tapping Continue, new page shows password field
    const state = { ...createCredentialState(), emailEntered: true, submittedCount: 0 };
    const p = perception({
      screenType: "signup",
      fields: [field("password_field", { y: 800 })],
      buttons: [button("submit_button", "Sign Up", { y: 1100 })],
    });

    const action = selectAuthAction(p, state, CREDS);
    assert.strictEqual(action.type, "fill_field");
    assert.strictEqual(action.fieldRole, "password_field");
    assert.strictEqual(action.value, "Test@123");
  });
});

// ── Multi-page login flow end-to-end ──────────────────────────────────
describe("Multi-page login flow", () => {
  it("handles 3-page flow: method choice → email → password", () => {
    // Page 1: Method choice
    const state0 = createCredentialState();
    const page1 = perception({
      screenType: "method_choice",
      buttons: [
        button("use_email_button", "Continue with Email"),
        button("google_button", "Sign in with Google"),
      ],
    });
    const a1 = selectAuthAction(page1, state0, CREDS);
    assert.strictEqual(a1.type, "tap_button");
    assert.strictEqual(a1.buttonRole, "use_email_button");

    // Page 2: Email only
    const page2 = perception({
      fields: [field("email_field")],
      buttons: [button("continue_button", "Continue")],
    });
    const a2 = selectAuthAction(page2, state0, CREDS);
    assert.strictEqual(a2.type, "fill_field");
    assert.strictEqual(a2.fieldRole, "email_field");

    // After typing email
    const state2 = markCredentialEntered(state0, "email_field");
    const page2b = perception({
      fields: [field("email_field", { filled: true })],
      buttons: [button("continue_button", "Continue")],
    });
    const a2b = selectAuthAction(page2b, state2, CREDS);
    assert.strictEqual(a2b.type, "tap_button");
    assert.strictEqual(a2b.buttonRole, "continue_button");

    // Page 3: Password only
    const page3 = perception({
      fields: [field("password_field")],
      buttons: [button("login_button", "Log In")],
    });
    const a3 = selectAuthAction(page3, state2, CREDS);
    assert.strictEqual(a3.type, "fill_field");
    assert.strictEqual(a3.fieldRole, "password_field");

    // After typing password
    const state3 = markCredentialEntered(state2, "password_field");
    const page3b = perception({
      fields: [field("password_field", { filled: true })],
      buttons: [button("login_button", "Log In")],
    });
    const a3b = selectAuthAction(page3b, state3, CREDS);
    assert.strictEqual(a3b.type, "tap_button");
    assert.strictEqual(a3b.buttonRole, "login_button");
    assert.strictEqual(a3b.reason, "submit_form");
  });
});

// ── findBestSubmitButton ──────────────────────────────────────────────
describe("findBestSubmitButton", () => {
  it("prefers login_button over continue_button", () => {
    const btns = [
      button("continue_button", "Continue"),
      button("login_button", "Sign In"),
    ];
    const best = findBestSubmitButton(btns);
    assert.strictEqual(best.role, "login_button");
  });

  it("falls back to label matching", () => {
    const btns = [button("unknown_button", "Sign In Now")];
    const best = findBestSubmitButton(btns);
    assert.strictEqual(best.label, "Sign In Now");
  });

  it("returns null when no submit buttons", () => {
    const btns = [button("google_button", "Google")];
    const best = findBestSubmitButton(btns);
    assert.strictEqual(best, null);
  });
});
