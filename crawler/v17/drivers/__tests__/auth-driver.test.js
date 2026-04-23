"use strict";

/**
 * Tests for v17/drivers/auth-driver.js.
 *
 * 8 cases per plan nifty-nibbling-widget.md A.2 — all use mocked classifier
 * output (deps.classify is injected), fixtures drawn from ≥3 apps:
 *
 *   1. Auth-choice + creds → taps node with role='auth_option_email' (biztoso).
 *   2. Email form, initial → taps email input, sets authStep='email_focused' (biztoso).
 *   3. Email form, post-focus → types ${EMAIL} (gmail).
 *   4. Full 5-step happy path (biztoso).
 *   5. Auth-choice, no creds, dismiss present → taps dismiss (linkedin).
 *   6. Auth-choice, no creds, no dismiss → done('blocked_by_auth:no_known_path') (duckduckgo).
 *   7. OTP-only screen → done('blocked_by_auth:otp_required') (telegram).
 *   8. Unknown auth layout → returns null (cryptic.app → LLMFallback).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const authDriver = require("../auth-driver");

// ── XML fixture helpers ────────────────────────────────────────────────

function wrap(...nodes) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n${nodes.join("\n")}\n</hierarchy>`;
}

function node({
  text = "",
  desc = "",
  resourceId = "",
  cls = "android.widget.Button",
  pkg = "com.example",
  clickable = true,
  password = false,
  hint = "",
  bounds = "[0,0][0,0]",
}) {
  return (
    `<node text="${text}" resource-id="${resourceId}" class="${cls}" ` +
    `package="${pkg}" content-desc="${desc}" clickable="${clickable}" ` +
    `password="${password}" hint="${hint}" bounds="${bounds}" />`
  );
}

// ── Mock classifier ────────────────────────────────────────────────────
//
// Takes a `roleOf(clickable)` function and returns an injectable
// deps.classify. Preserves all clickable fields and adds role + confidence,
// matching the real node-classifier merge shape.

function makeClassifier(roleOf) {
  const calls = [];
  return {
    calls,
    fn: async (graph, observation, deps) => {
      calls.push({ graph, observation, deps });
      return graph.clickables.map((c, i) => {
        const role = roleOf(c, i) || "unknown";
        return { ...c, role, confidence: 0.95 };
      });
    },
  };
}

// ── Fixtures — 5 distinct apps ──────────────────────────────────────────

// Biztoso email form: Compose BasicTextField + password attr.
const biztosoEmailFormXml = wrap(
  node({
    resourceId: "com.biztoso.app:id/email_input",
    cls: "androidx.compose.foundation.text.BasicTextField",
    pkg: "com.biztoso.app",
    bounds: "[80,500][1000,620]",
  }),
  node({
    resourceId: "com.biztoso.app:id/password_input",
    cls: "androidx.compose.foundation.text.BasicTextField",
    pkg: "com.biztoso.app",
    password: true,
    bounds: "[80,680][1000,800]",
  }),
  node({
    text: "Sign in",
    clickable: true,
    bounds: "[80,900][1000,1020]",
    pkg: "com.biztoso.app",
  }),
);

// Gmail email form: Material TextInputEditText + password attr.
const gmailEmailFormXml = wrap(
  node({
    resourceId: "com.google.android.gm:id/email_address_view",
    cls: "com.google.android.material.textfield.TextInputEditText",
    pkg: "com.google.android.gm",
    bounds: "[80,400][1000,520]",
  }),
  node({
    resourceId: "com.google.android.gm:id/password",
    cls: "com.google.android.material.textfield.TextInputEditText",
    pkg: "com.google.android.gm",
    password: true,
    bounds: "[80,600][1000,720]",
  }),
  node({
    text: "Next",
    clickable: true,
    bounds: "[820,800][1000,920]",
    pkg: "com.google.android.gm",
  }),
);

// Biztoso auth-choice: three SSO options.
const biztosoAuthChoiceXml = wrap(
  node({ text: "Continue with Email", bounds: "[40,900][1040,1050]", pkg: "com.biztoso.app" }),
  node({ text: "Continue with Google", bounds: "[40,1100][1040,1250]", pkg: "com.biztoso.app" }),
  node({ text: "Continue with Apple", bounds: "[40,1300][1040,1450]", pkg: "com.biztoso.app" }),
);

// LinkedIn auth-choice with a Skip affordance (dismiss).
const linkedinAuthChoiceXml = wrap(
  node({ text: "Sign in", bounds: "[80,1200][1000,1350]", pkg: "com.linkedin.android" }),
  node({ text: "Join now", bounds: "[80,1400][1000,1550]", pkg: "com.linkedin.android" }),
  node({ text: "Skip for now", bounds: "[80,1600][1000,1720]", pkg: "com.linkedin.android" }),
);

// DuckDuckGo auth-choice without any dismiss path.
const duckduckgoAuthChoiceXml = wrap(
  node({ text: "Log in", bounds: "[80,1200][1000,1350]", pkg: "com.duckduckgo.mobile.android" }),
  node({ text: "Sign up", bounds: "[80,1400][1000,1550]", pkg: "com.duckduckgo.mobile.android" }),
);

// Telegram OTP-only screen.
const telegramOtpXml = wrap(
  node({
    resourceId: "org.telegram.messenger:id/code_input",
    cls: "android.widget.EditText",
    pkg: "org.telegram.messenger",
    bounds: "[200,400][880,560]",
  }),
);

// Unknown auth layout — a single ambiguous button, no form structure.
const crypticUnknownXml = wrap(
  node({ text: "Tap to begin", bounds: "[80,1400][1000,1520]", pkg: "com.cryptic.app" }),
);

// ── claim() — tightened to require structural auth signals ────────────

test("claim: true when XML has a password input (biztoso email form)", () => {
  assert.equal(authDriver.claim({ xml: biztosoEmailFormXml }), true);
});

test("claim: true when XML has ≥2 auth-option CTAs (biztoso auth-choice)", () => {
  assert.equal(authDriver.claim({ xml: biztosoAuthChoiceXml }), true);
});

test("claim: FALSE on a home screen whose only auth-shaped signal is a Skip button", () => {
  // Post-login feed with a promotional "Not now" modal — this is exactly the
  // pattern that burned 8 steps on biztoso. AuthDriver must NOT claim.
  const postLoginWithModalXml = wrap(
    node({ text: "Welcome back, Arjun", clickable: false, bounds: "[0,200][1080,320]" }),
    node({ text: "Rate this app", clickable: false, bounds: "[80,1200][1000,1320]" }),
    node({ text: "Not now", bounds: "[80,1400][520,1520]" }),
    node({ text: "Rate", bounds: "[560,1400][1000,1520]" }),
  );
  assert.equal(authDriver.claim({ xml: postLoginWithModalXml }), false);
});

test("claim: FALSE when only a single 'Sign out' link exists (profile menu)", () => {
  const profileMenuXml = wrap(
    node({ text: "Edit profile", bounds: "[40,400][1040,520]" }),
    node({ text: "Notification settings", bounds: "[40,540][1040,660]" }),
    node({ text: "Sign out", bounds: "[40,1400][1040,1520]" }),
  );
  assert.equal(authDriver.claim({ xml: profileMenuXml }), false);
});

// ── 1. Auth-choice + creds → taps auth_option_email ────────────────────

test("decide: auth-choice w/ creds → taps auth_option_email (biztoso)", async () => {
  const classifier = makeClassifier((c) => {
    if (c.label === "Continue with Email") return "auth_option_email";
    if (c.label === "Continue with Google") return "auth_option_google";
    if (c.label === "Continue with Apple") return "auth_option_apple";
    return "unknown";
  });
  const state = {
    credentials: { email: "user@test.com", password: "pw" },
    dispatchCount: 1,
  };
  const action = await authDriver.decide(
    { xml: biztosoAuthChoiceXml, packageName: "com.biztoso.app", activity: ".Login" },
    state,
    { classify: classifier.fn },
  );
  assert.ok(action, "expected a non-null action");
  assert.equal(action.type, "tap");
  assert.equal(action.targetText, "Continue with Email");
  // cx = (40+1040)/2 = 540, cy = (900+1050)/2 = 975
  assert.equal(action.x, 540);
  assert.equal(action.y, 975);
  assert.equal(classifier.calls.length, 1, "classifier called exactly once");
});

// ── 2. Email form, initial → taps email input, sets state.authStep ─────

test("decide: email form step 1 → taps email input, sets state.authStep='email_focused' (biztoso)", async () => {
  const classifier = makeClassifier((c) => {
    if (c.isEmail) return "email_input";
    if (c.isPassword) return "password_input";
    if (c.label === "Sign in") return "submit_button";
    return "unknown";
  });
  const state = {
    credentials: { email: "user@test.com", password: "pw" },
    dispatchCount: 1,
  };
  const action = await authDriver.decide(
    { xml: biztosoEmailFormXml, packageName: "com.biztoso.app" },
    state,
    { classify: classifier.fn },
  );
  assert.equal(action.type, "tap");
  // Email input bounds [80,500][1000,620] → cx=540, cy=560.
  assert.equal(action.x, 540);
  assert.equal(action.y, 560);
  assert.equal(state.authStep, "email_focused");
  assert.equal(state.authStepDispatch, 1);
});

// ── 3. Email form, post-focus → types ${EMAIL} ─────────────────────────

test("decide: email form w/ authStep='email_focused' → types ${EMAIL} (gmail)", async () => {
  const classifier = makeClassifier((c) => {
    if (c.isEmail) return "email_input";
    if (c.isPassword) return "password_input";
    if (c.label === "Next") return "submit_button";
    return "unknown";
  });
  const state = {
    credentials: { email: "user@test.com", password: "pw" },
    authStep: "email_focused",
    dispatchCount: 2,
    authStepDispatch: 1,
  };
  const action = await authDriver.decide(
    { xml: gmailEmailFormXml, packageName: "com.google.android.gm" },
    state,
    { classify: classifier.fn },
  );
  assert.equal(action.type, "type");
  assert.equal(action.text, "${EMAIL}");
  assert.equal(state.authStep, "email_typed");
  assert.equal(state.authStepDispatch, 2);
});

// ── 4. Full 5-step happy path on biztoso ───────────────────────────────

test("decide: full happy path (initial → submitted) on biztoso email form", async () => {
  const classifier = makeClassifier((c) => {
    if (c.isEmail) return "email_input";
    if (c.isPassword) return "password_input";
    if (c.label === "Sign in") return "submit_button";
    return "unknown";
  });
  const state = {
    credentials: { email: "a@b.c", password: "pw" },
    dispatchCount: 0,
  };
  const observation = { xml: biztosoEmailFormXml, packageName: "com.biztoso.app" };

  const trace = [];
  for (let i = 1; i <= 5; i++) {
    state.dispatchCount = i;
    const action = await authDriver.decide(observation, state, { classify: classifier.fn });
    trace.push({ step: i, authStep: state.authStep, action });
  }

  // Step 1: tap email input (cx=540, cy=560), authStep='email_focused'.
  assert.equal(trace[0].action.type, "tap");
  assert.equal(trace[0].action.x, 540);
  assert.equal(trace[0].action.y, 560);
  assert.equal(trace[0].authStep, "email_focused");

  // Step 2: type ${EMAIL}, authStep='email_typed'.
  assert.equal(trace[1].action.type, "type");
  assert.equal(trace[1].action.text, "${EMAIL}");
  assert.equal(trace[1].authStep, "email_typed");

  // Step 3: tap password input (cx=540, cy=740), authStep='password_focused'.
  assert.equal(trace[2].action.type, "tap");
  assert.equal(trace[2].action.x, 540);
  assert.equal(trace[2].action.y, 740);
  assert.equal(trace[2].authStep, "password_focused");

  // Step 4: type ${PASSWORD}, authStep='password_typed'.
  assert.equal(trace[3].action.type, "type");
  assert.equal(trace[3].action.text, "${PASSWORD}");
  assert.equal(trace[3].authStep, "password_typed");

  // Step 5: tap "Sign in" (cx=540, cy=960), authStep='submitted'.
  assert.equal(trace[4].action.type, "tap");
  assert.equal(trace[4].action.targetText, "Sign in");
  assert.equal(trace[4].action.x, 540);
  assert.equal(trace[4].action.y, 960);
  assert.equal(trace[4].authStep, "submitted");
});

// ── 5. Auth-choice, no creds, dismiss present → taps dismiss ───────────

test("decide: auth-choice no creds + Skip → taps dismiss (linkedin)", async () => {
  const classifier = makeClassifier((c) => {
    if (c.label === "Sign in") return "auth_option_email";
    if (c.label === "Join now") return "auth_option_other";
    if (c.label === "Skip for now") return "dismiss_button";
    return "unknown";
  });
  // No credentials → driver must skip the email_option path.
  const state = { dispatchCount: 1 };
  const action = await authDriver.decide(
    { xml: linkedinAuthChoiceXml, packageName: "com.linkedin.android" },
    state,
    { classify: classifier.fn },
  );
  assert.equal(action.type, "tap");
  assert.equal(action.targetText, "Skip for now");
  // "Skip for now" bounds [80,1600][1000,1720] → cx=540, cy=1660.
  assert.equal(action.x, 540);
  assert.equal(action.y, 1660);
});

// ── 6. Auth-choice, no creds, no dismiss → done(no_known_path) ─────────

test("decide: auth-choice no creds and no dismiss → done('blocked_by_auth:no_known_path') (duckduckgo)", async () => {
  const classifier = makeClassifier((c) => {
    if (c.label === "Log in") return "auth_option_email";
    if (c.label === "Sign up") return "auth_option_other";
    return "unknown";
  });
  const state = { dispatchCount: 1 };
  const action = await authDriver.decide(
    { xml: duckduckgoAuthChoiceXml, packageName: "com.duckduckgo.mobile.android" },
    state,
    { classify: classifier.fn },
  );
  assert.ok(action);
  assert.equal(action.type, "done");
  assert.equal(action.reason, "blocked_by_auth:no_known_path");
});

// ── 7. OTP-only screen → done(otp_required) ────────────────────────────

test("decide: OTP-only screen → done('blocked_by_auth:otp_required') (telegram)", async () => {
  const classifier = makeClassifier(() => "otp_input");
  const state = { dispatchCount: 1 };
  const action = await authDriver.decide(
    { xml: telegramOtpXml, packageName: "org.telegram.messenger" },
    state,
    { classify: classifier.fn },
  );
  assert.ok(action);
  assert.equal(action.type, "done");
  assert.equal(action.reason, "blocked_by_auth:otp_required");
});

// ── 8. Unknown auth layout → null (LLMFallback) ────────────────────────

test("decide: unknown auth layout → returns null (lets LLMFallback take over)", async () => {
  const classifier = makeClassifier(() => "content");
  const state = { dispatchCount: 1 };
  const action = await authDriver.decide(
    { xml: crypticUnknownXml, packageName: "com.cryptic.app" },
    state,
    { classify: classifier.fn },
  );
  assert.equal(action, null, "unknown layout must yield to LLMFallback");
});
