"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  classifyButtonRole,
  fieldTypeToRole,
  detectScreenTypeFromXml,
  convertVisionGuidanceToPerception,
  mergePerceptions,
} = require("../auth-perceiver");

// ── classifyButtonRole ─────────────────────────────────────────────────
describe("classifyButtonRole", () => {
  it("classifies 'Login' as login_button", () => {
    assert.strictEqual(classifyButtonRole("Login"), "login_button");
  });

  it("classifies 'Sign In' as login_button", () => {
    assert.strictEqual(classifyButtonRole("Sign In"), "login_button");
  });

  it("classifies 'Sign Up' as signup_button", () => {
    assert.strictEqual(classifyButtonRole("Sign Up"), "signup_button");
  });

  it("classifies 'Register' as signup_button", () => {
    assert.strictEqual(classifyButtonRole("Register"), "signup_button");
  });

  it("classifies 'Continue' as continue_button", () => {
    assert.strictEqual(classifyButtonRole("Continue"), "continue_button");
  });

  it("classifies 'Next' as continue_button", () => {
    assert.strictEqual(classifyButtonRole("Next"), "continue_button");
  });

  it("classifies 'Continue with Email' as use_email_button", () => {
    assert.strictEqual(classifyButtonRole("Continue with Email"), "use_email_button");
  });

  it("classifies 'Sign in with Email' as use_email_button", () => {
    assert.strictEqual(classifyButtonRole("Sign in with Email"), "use_email_button");
  });

  it("classifies 'Continue with Phone' as use_phone_button", () => {
    assert.strictEqual(classifyButtonRole("Continue with Phone"), "use_phone_button");
  });

  it("classifies 'Sign in with Google' as google_button", () => {
    assert.strictEqual(classifyButtonRole("Sign in with Google"), "google_button");
  });

  it("classifies 'Continue with Facebook' as facebook_button", () => {
    assert.strictEqual(classifyButtonRole("Continue with Facebook"), "facebook_button");
  });

  it("classifies 'Continue with Apple' as apple_button", () => {
    assert.strictEqual(classifyButtonRole("Continue with Apple"), "apple_button");
  });

  it("classifies 'Skip' as skip_button", () => {
    assert.strictEqual(classifyButtonRole("Skip"), "skip_button");
  });

  it("classifies 'Not now' as skip_button", () => {
    assert.strictEqual(classifyButtonRole("Not now"), "skip_button");
  });

  it("classifies 'Forgot Password?' as forgot_password_link", () => {
    assert.strictEqual(classifyButtonRole("Forgot Password?"), "forgot_password_link");
  });

  it("classifies 'Submit' as submit_button", () => {
    assert.strictEqual(classifyButtonRole("Submit"), "submit_button");
  });

  it("returns unknown_button for unrecognized labels", () => {
    assert.strictEqual(classifyButtonRole("Settings"), "unknown_button");
  });

  it("returns unknown_button for null/empty", () => {
    assert.strictEqual(classifyButtonRole(""), "unknown_button");
    assert.strictEqual(classifyButtonRole(null), "unknown_button");
  });
});

// ── fieldTypeToRole ────────────────────────────────────────────────────
describe("fieldTypeToRole", () => {
  it("maps forms.js types to selector roles", () => {
    assert.strictEqual(fieldTypeToRole("email"), "email_field");
    assert.strictEqual(fieldTypeToRole("password"), "password_field");
    assert.strictEqual(fieldTypeToRole("phone"), "phone_field");
    assert.strictEqual(fieldTypeToRole("username"), "username_field");
    assert.strictEqual(fieldTypeToRole("otp"), "otp_field");
    assert.strictEqual(fieldTypeToRole("name"), "name_field");
  });

  it("returns unknown_field for unmapped types", () => {
    assert.strictEqual(fieldTypeToRole("address"), "unknown_field");
    assert.strictEqual(fieldTypeToRole("search"), "unknown_field");
    assert.strictEqual(fieldTypeToRole("text"), "unknown_field");
  });
});

// ── detectScreenTypeFromXml ────────────────────────────────────────────
describe("detectScreenTypeFromXml", () => {
  it("detects login screens", () => {
    assert.strictEqual(detectScreenTypeFromXml('<node text="Login With Email" />'), "login");
    assert.strictEqual(detectScreenTypeFromXml('<node text="Sign In" />'), "login");
  });

  it("detects signup screens", () => {
    assert.strictEqual(detectScreenTypeFromXml('<node text="Sign Up With Email" />'), "signup");
    assert.strictEqual(detectScreenTypeFromXml('<node text="Create Account" />'), "signup");
  });

  it("detects OTP screens", () => {
    assert.strictEqual(detectScreenTypeFromXml('<node text="Enter verification code" />'), "otp");
  });

  it("detects method choice screens", () => {
    assert.strictEqual(detectScreenTypeFromXml('<node text="Continue with Email" />'), "method_choice");
    assert.strictEqual(detectScreenTypeFromXml('<node text="Sign in with Google" />'), "method_choice");
  });

  it("returns unknown for non-auth XML", () => {
    assert.strictEqual(detectScreenTypeFromXml('<node text="Home Feed" />'), "unknown");
  });

  it("handles null XML", () => {
    assert.strictEqual(detectScreenTypeFromXml(null), "unknown");
  });
});

// ── convertVisionGuidanceToPerception ──────────────────────────────────
describe("convertVisionGuidanceToPerception", () => {
  it("classifies input-like actions as fields", () => {
    const guidance = {
      screenType: "login",
      mainActions: [
        { description: "Tap email input field to enter email", x: 540, y: 500 },
        { description: "Tap password input field", x: 540, y: 600 },
      ],
      isLoading: false,
      observation: "Login screen with email and password fields",
    };
    const p = convertVisionGuidanceToPerception(guidance);
    assert.strictEqual(p.fields.length, 2);
    assert.strictEqual(p.fields[0].role, "email_field");
    assert.strictEqual(p.fields[1].role, "password_field");
    assert.strictEqual(p.buttons.length, 0);
  });

  it("classifies button-like actions as buttons", () => {
    const guidance = {
      screenType: "login",
      mainActions: [
        { description: "Tap Login button to submit", x: 540, y: 1100 },
        { description: "Continue with Google", x: 540, y: 1300 },
      ],
      isLoading: false,
      observation: "",
    };
    const p = convertVisionGuidanceToPerception(guidance);
    assert.strictEqual(p.fields.length, 0);
    assert.strictEqual(p.buttons.length, 2);
    assert.strictEqual(p.buttons[0].role, "login_button");
    assert.strictEqual(p.buttons[1].role, "google_button");
  });

  it("mixes fields and buttons on a login form", () => {
    const guidance = {
      screenType: "login",
      mainActions: [
        { description: "Tap the email input field", x: 540, y: 500 },
        { description: "Tap the password input field", x: 540, y: 600 },
        { description: "Tap Sign In button", x: 540, y: 800 },
      ],
      isLoading: false,
      observation: "",
    };
    const p = convertVisionGuidanceToPerception(guidance);
    assert.strictEqual(p.fields.length, 2);
    assert.strictEqual(p.buttons.length, 1);
    assert.strictEqual(p.buttons[0].role, "login_button");
  });

  it("detects errors from observation text", () => {
    const guidance = {
      screenType: "login",
      mainActions: [],
      isLoading: false,
      observation: "Login form shows error: incorrect password",
    };
    const p = convertVisionGuidanceToPerception(guidance);
    assert.strictEqual(p.hasError, true);
    assert.ok(p.errorText.includes("incorrect password"));
  });

  it("detects loading state", () => {
    const guidance = {
      screenType: "loading",
      mainActions: [],
      isLoading: true,
      observation: "Loading spinner visible",
    };
    const p = convertVisionGuidanceToPerception(guidance);
    assert.strictEqual(p.isLoading, true);
  });

  it("handles empty guidance", () => {
    const p = convertVisionGuidanceToPerception({});
    assert.strictEqual(p.fields.length, 0);
    assert.strictEqual(p.buttons.length, 0);
    assert.strictEqual(p.screenType, "unknown");
  });

  it("classifies 'Continue with Email' button correctly", () => {
    const guidance = {
      screenType: "other",
      mainActions: [
        { description: "Continue with Email", x: 540, y: 800 },
      ],
      isLoading: false,
      observation: "",
    };
    const p = convertVisionGuidanceToPerception(guidance);
    assert.strictEqual(p.buttons.length, 1);
    assert.strictEqual(p.buttons[0].role, "use_email_button");
  });

  it("classifies 'Tap Continue button to proceed to password entry' as a button NOT a field", () => {
    // This was the Biztoso bug — vision says "Continue button" but old code typed password
    const guidance = {
      screenType: "signup",
      mainActions: [
        { description: "Tap Continue button to proceed to password entry", x: 540, y: 685 },
      ],
      isLoading: false,
      observation: "",
    };
    const p = convertVisionGuidanceToPerception(guidance);
    assert.strictEqual(p.buttons.length, 1);
    assert.strictEqual(p.fields.length, 0);
    assert.strictEqual(p.buttons[0].role, "continue_button");
  });
});

// ── mergePerceptions ──────────────────────────────────────────────────
describe("mergePerceptions", () => {
  it("prefers XML fields over vision fields", () => {
    const xml = {
      screenType: "login",
      fields: [{ role: "email_field", x: 540, y: 500, source: "xml" }],
      buttons: [],
      hasError: false, errorText: null, isLoading: false,
    };
    const vis = {
      screenType: "login",
      fields: [{ role: "email_field", x: 530, y: 510, source: "vision" }],
      buttons: [{ role: "login_button", label: "Login", x: 540, y: 1000, source: "vision" }],
      hasError: false, errorText: null, isLoading: false,
    };
    const merged = mergePerceptions(xml, vis);
    assert.strictEqual(merged.fields.length, 1);
    assert.strictEqual(merged.fields[0].source, "xml"); // XML wins
    assert.strictEqual(merged.buttons.length, 1); // Vision button added
    assert.strictEqual(merged.buttons[0].role, "login_button");
  });

  it("uses vision fields when XML has none", () => {
    const xml = {
      screenType: "unknown", fields: [], buttons: [],
      hasError: false, errorText: null, isLoading: false,
    };
    const vis = {
      screenType: "login",
      fields: [{ role: "email_field", x: 540, y: 500, source: "vision" }],
      buttons: [],
      hasError: false, errorText: null, isLoading: false,
    };
    const merged = mergePerceptions(xml, vis);
    assert.strictEqual(merged.fields.length, 1);
    assert.strictEqual(merged.fields[0].source, "vision");
    assert.strictEqual(merged.screenType, "login"); // Vision screenType used
  });

  it("deduplicates buttons near each other", () => {
    const xml = {
      screenType: "login", fields: [],
      buttons: [{ role: "login_button", label: "Login", x: 540, y: 1000, source: "xml" }],
      hasError: false, errorText: null, isLoading: false,
    };
    const vis = {
      screenType: "login", fields: [],
      buttons: [
        { role: "login_button", label: "Login", x: 545, y: 1005, source: "vision" }, // near XML button
        { role: "google_button", label: "Google", x: 540, y: 1200, source: "vision" }, // unique
      ],
      hasError: false, errorText: null, isLoading: false,
    };
    const merged = mergePerceptions(xml, vis);
    assert.strictEqual(merged.buttons.length, 2); // XML login + vision Google (deduped login)
    assert.strictEqual(merged.buttons[0].source, "xml");
    assert.strictEqual(merged.buttons[1].role, "google_button");
  });

  it("merges error signals from both sources", () => {
    const xml = {
      screenType: "login", fields: [], buttons: [],
      hasError: true, errorText: "Invalid password", isLoading: false,
    };
    const vis = {
      screenType: "login", fields: [], buttons: [],
      hasError: false, errorText: null, isLoading: false,
    };
    const merged = mergePerceptions(xml, vis);
    assert.strictEqual(merged.hasError, true);
    assert.strictEqual(merged.errorText, "Invalid password");
  });
});
