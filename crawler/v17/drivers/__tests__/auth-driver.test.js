"use strict";

/**
 * Tests for v17/drivers/auth-driver.js.
 *
 * 8 core cases (A.2) + F4 regression cases (2026-04-23 coverage fix).
 * All use mocked classifier output (deps.classify injected); fixtures
 * drawn from ≥3 apps so no single-app overfitting can sneak in.
 *
 * Core (per plan A.2):
 *   1. claim: password input + creds → true (biztoso).
 *   2. claim: ≥2 auth-option CTAs + creds → true (biztoso).
 *   3. claim: home screen with stray "Not now" → false.
 *   4. claim: lone "Sign out" in profile menu → false.
 *   5. decide: auth-choice + creds → taps auth_option_email (biztoso).
 *   6. decide: email form initial → taps email input (biztoso).
 *   7. decide: email form post-focus → types ${EMAIL} (gmail).
 *   8. decide: full 5-step happy path (biztoso).
 *   9. decide: auth-choice no creds + Skip → taps dismiss (linkedin).
 *  10. decide: auth-choice no creds, no dismiss → null + fp blocked (duckduckgo).
 *  11. decide: OTP-only → null + fp blocked (telegram).
 *  12. decide: unknown layout → null.
 *
 * F4 regression (coverage fix 2026-04-23):
 *  13. claim: no creds → false (gate closes AuthDriver on no-auth apps).
 *  14. claim: credentials missing email-only → false.
 *  15. claim: fp in authBlockedFingerprints → false (no re-claim loop).
 *  16. markFingerprintBlocked: adds structural fp to state Set, returns null.
 *  17. Wikipedia-style upsell: decide then re-claim → second claim is false.
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

// Shared credentials state for claim tests that should reach structural signals.
// AuthDriver's F2 gate (2026-04-23) makes claim a no-op unless both email+password
// are present, so every test that wants to exercise Signal 1 / Signal 2 MUST pass
// a creds-bearing state. Tests that want to verify the F2 gate itself pass no creds.
function credsState(extra) {
  return {
    credentials: { email: "u@test.com", password: "pw" },
    dispatchCount: 1,
    ...(extra || {}),
  };
}

// ── claim() — tightened to require structural auth signals + F2 creds gate ───

test("claim: true when XML has a password input + creds (biztoso email form)", () => {
  assert.equal(authDriver.claim({ xml: biztosoEmailFormXml }, credsState()), true);
});

test("claim: true when XML has ≥2 auth-option CTAs + creds (biztoso auth-choice)", () => {
  assert.equal(authDriver.claim({ xml: biztosoAuthChoiceXml }, credsState()), true);
});

test("claim: FALSE on a home screen whose only auth-shaped signal is a Skip button", () => {
  // Post-login feed with a promotional "Not now" modal — this is exactly the
  // pattern that burned 8 steps on biztoso. AuthDriver must NOT claim even
  // when credentials are available.
  const postLoginWithModalXml = wrap(
    node({ text: "Welcome back, Arjun", clickable: false, bounds: "[0,200][1080,320]" }),
    node({ text: "Rate this app", clickable: false, bounds: "[80,1200][1000,1320]" }),
    node({ text: "Not now", bounds: "[80,1400][520,1520]" }),
    node({ text: "Rate", bounds: "[560,1400][1000,1520]" }),
  );
  assert.equal(authDriver.claim({ xml: postLoginWithModalXml }, credsState()), false);
});

test("claim: FALSE when only a single 'Sign out' link exists (profile menu)", () => {
  const profileMenuXml = wrap(
    node({ text: "Edit profile", bounds: "[40,400][1040,520]" }),
    node({ text: "Notification settings", bounds: "[40,540][1040,660]" }),
    node({ text: "Sign out", bounds: "[40,1400][1040,1520]" }),
  );
  assert.equal(authDriver.claim({ xml: profileMenuXml }, credsState()), false);
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

// ── 6. Auth-choice, no creds, no dismiss → null + fp blocked ───────────
// Behavior change (2026-04-23 coverage fix): AuthDriver used to emit
// done('blocked_by_auth:no_known_path') here, which killed the whole run.
// It now yields null and adds the screen's fingerprint to
// state.authBlockedFingerprints so the next claim() on the same screen
// returns false and the dispatcher falls through to ExplorationDriver.

test("decide: auth-choice no creds and no dismiss → null + fp blocked (duckduckgo)", async () => {
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
  assert.equal(action, null, "must yield, not terminate the run");
  assert.ok(
    state.authBlockedFingerprints instanceof Set,
    "authBlockedFingerprints must be lazily initialized",
  );
  assert.equal(
    state.authBlockedFingerprints.size,
    1,
    "screen fp must be recorded so re-claim is suppressed",
  );
});

// ── 7. OTP-only screen → null + fp blocked ─────────────────────────────
// Same coverage fix: OTP screens can't be auto-driven without user input,
// but killing the run with terminal done() robs the rest of the app of
// crawl coverage. Yield, record the fp, let other drivers try press_back
// or alternate paths.

test("decide: OTP-only screen → null + fp blocked (telegram)", async () => {
  const classifier = makeClassifier(() => "otp_input");
  const state = {
    credentials: { email: "u@test.com", password: "pw" },
    dispatchCount: 1,
  };
  const action = await authDriver.decide(
    { xml: telegramOtpXml, packageName: "org.telegram.messenger" },
    state,
    { classify: classifier.fn },
  );
  assert.equal(action, null, "OTP yield must not terminate the run");
  assert.ok(state.authBlockedFingerprints instanceof Set);
  assert.equal(state.authBlockedFingerprints.size, 1);
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

// ── F4 regression cases (2026-04-23 coverage fix) ──────────────────────
//
// These exist because Phase D.1 regressed Wikipedia from 26 → 10 unique
// screens: AuthDriver claimed the "Sign in to sync" optional upsell
// (which has 2+ AUTH_OPTION_REGEX-matching CTAs) and then emitted
// terminal done('blocked_by_auth:no_credentials') on a no-auth app. The
// F2 credentials gate + F3 fp-blocked set are the structural fix, and
// these tests lock them in so future edits can't re-introduce the regression.

test("claim: no credentials → false (F2 gate disables driver on no-auth apps)", () => {
  // Even on an XML that looks like a password form, no credentials means
  // AuthDriver has nothing to do. This is how Wikipedia, DuckDuckGo,
  // Firefox, Files, Forecast, and Opera-Mini get AuthDriver out of their way.
  assert.equal(authDriver.claim({ xml: biztosoEmailFormXml }, { dispatchCount: 1 }), false);
  assert.equal(authDriver.claim({ xml: biztosoEmailFormXml }, {}), false);
  assert.equal(authDriver.claim({ xml: biztosoEmailFormXml }, null), false);
  assert.equal(authDriver.claim({ xml: biztosoEmailFormXml }), false);
});

test("claim: partial credentials (email only, password only) → false", () => {
  assert.equal(
    authDriver.claim(
      { xml: biztosoEmailFormXml },
      { credentials: { email: "u@test.com" }, dispatchCount: 1 },
    ),
    false,
  );
  assert.equal(
    authDriver.claim(
      { xml: biztosoEmailFormXml },
      { credentials: { password: "pw" }, dispatchCount: 1 },
    ),
    false,
  );
});

test("claim: fp in authBlockedFingerprints → false (no re-claim loop)", async () => {
  // Drive the DuckDuckGo no-known-path flow once so the fp is blocked,
  // then re-claim the same screen — it must NOT re-enter AuthDriver.
  const classifier = makeClassifier((c) => {
    if (c.label === "Log in") return "auth_option_email";
    if (c.label === "Sign up") return "auth_option_other";
    return "unknown";
  });
  // Creds present so claim would otherwise succeed via Signal 2 (≥2 CTAs).
  const state = credsState();
  const observation = {
    xml: duckduckgoAuthChoiceXml,
    packageName: "com.duckduckgo.mobile.android",
    activity: "com.duckduckgo.mobile.android/.MainActivity",
  };

  // First pass: decide yields null and marks fp.
  // With creds present + email auth_option, the driver taps email — so to
  // force the "no known path" branch we temporarily clear creds before decide.
  const noCreds = { ...state, credentials: null };
  const action = await authDriver.decide(observation, noCreds, { classify: classifier.fn });
  assert.equal(action, null);
  assert.ok(noCreds.authBlockedFingerprints instanceof Set);
  assert.equal(noCreds.authBlockedFingerprints.size, 1);

  // Second pass: reinstate creds and re-claim — must be false (fp is blocked).
  const reclaimState = {
    ...credsState(),
    authBlockedFingerprints: noCreds.authBlockedFingerprints,
  };
  assert.equal(authDriver.claim(observation, reclaimState), false);
});

test("markFingerprintBlocked: adds structural fp to state Set, returns null", () => {
  const state = {};
  const observation = {
    xml: duckduckgoAuthChoiceXml,
    packageName: "com.duckduckgo.mobile.android",
    activity: ".MainActivity",
  };
  const ret = authDriver.markFingerprintBlocked(state, observation, "test-reason");
  assert.equal(ret, null, "must return null so call sites `return markBlocked(...)`");
  assert.ok(state.authBlockedFingerprints instanceof Set);
  assert.equal(state.authBlockedFingerprints.size, 1);
  // Second call with same fp is idempotent.
  authDriver.markFingerprintBlocked(state, observation, "test-reason");
  assert.equal(state.authBlockedFingerprints.size, 1, "duplicate fp must not grow the Set");
});

test("Wikipedia-upsell scenario: upsell XML → claim false when no creds, no terminal done() on crawl", async () => {
  // Simulates Wikipedia's "Sign in to sync" upsell: two auth-option CTAs
  // ("Sign in", "Create account") plus some article content, no password
  // input. Phase D.1 claimed this screen on Signal 2 and killed the run.
  const wikipediaUpsellXml = wrap(
    node({ text: "Featured article", clickable: false, bounds: "[0,100][1080,200]" }),
    node({ text: "Read more", bounds: "[80,300][1000,420]", pkg: "org.wikipedia" }),
    node({ text: "Sign in", bounds: "[80,1400][500,1520]", pkg: "org.wikipedia" }),
    node({ text: "Create account", bounds: "[540,1400][1000,1520]", pkg: "org.wikipedia" }),
  );

  // No credentials (Wikipedia golden-suite config) → claim must be false.
  assert.equal(authDriver.claim({ xml: wikipediaUpsellXml }, { dispatchCount: 1 }), false);
  assert.equal(authDriver.claim({ xml: wikipediaUpsellXml }), false);
});

// ── 2026-04-25: terminal-state fp blocking + classifier-noise filtering ────
//
// Two general-driver bugs:
//
//  (A) A multi-step driver can reach a terminal state where it has no next
//      action on this screen but its claim() signal still matches. Returning
//      plain null causes claim→decide→null forever and the dispatcher
//      records driver_claimed_but_null on every dispatch. Fix: terminal
//      states must call markFingerprintBlocked so claim() returns false on
//      re-entry.
//
//  (B) The LLM classifier can mis-tag overlay UI (Android autofill /
//      credential-manager / IME suggestion chips, Chrome autocomplete
//      popups) as primary form controls because the overlay structurally
//      resembles the real control. The chip's label is a literal email
//      address or masked password — never the label of a real submit
//      button or empty input. Fix: filter classifier output by semantic
//      plausibility (looksLikeEmail) before drivers act on it.
//
// All fixtures below use com.example.app + user@example.com to make the
// app-agnostic intent explicit.
//
// New cases:
//   18. looksLikeEmail: address-shaped strings → true; real labels → false.
//   19. pickSubmitButton: email-labeled submit_button candidates filtered.
//   20. pickEmailInput: prefers empty-label input over autofill chip.
//   21. decide authStep='submitted' → blocks fp instead of null-loop.
//   22. decide stuck-detection → blocks fp instead of null-loop.
//   23. Autofill-chip replay: classified chip at email slot does not hijack.

// Generic email form. No real-app naming — pure "what an Android email
// form looks like structurally" so the test reads as a property of the
// driver, not a property of one app.
const genericEmailFormXml = wrap(
  node({
    resourceId: "com.example.app:id/email_input",
    cls: "android.widget.EditText",
    pkg: "com.example.app",
    bounds: "[80,500][1000,620]",
  }),
  node({
    resourceId: "com.example.app:id/password_input",
    cls: "android.widget.EditText",
    pkg: "com.example.app",
    password: true,
    bounds: "[80,680][1000,800]",
  }),
  node({
    text: "Sign in",
    clickable: true,
    bounds: "[80,900][1000,1020]",
    pkg: "com.example.app",
  }),
);

test("looksLikeEmail: only real address-shaped strings return true", () => {
  assert.equal(authDriver.looksLikeEmail("user@example.com"), true);
  assert.equal(authDriver.looksLikeEmail("user+tag@example.co.uk"), true);
  // Real submit / input labels must be false.
  assert.equal(authDriver.looksLikeEmail(""), false);
  assert.equal(authDriver.looksLikeEmail(undefined), false);
  assert.equal(authDriver.looksLikeEmail(null), false);
  assert.equal(authDriver.looksLikeEmail("Email"), false);
  assert.equal(authDriver.looksLikeEmail("Sign in"), false);
  assert.equal(authDriver.looksLikeEmail("Continue with Email"), false);
  assert.equal(authDriver.looksLikeEmail("@example"), false); // no tld
  assert.equal(authDriver.looksLikeEmail("user@"), false); // no tld
});

test("pickSubmitButton: filters out candidates whose label looks like an email", () => {
  const classified = [
    { role: "submit_button", label: "user@example.com", cx: 540, cy: 818 },
    { role: "submit_button", label: "Sign in", cx: 540, cy: 1400 },
  ];
  const picked = authDriver.pickSubmitButton(classified);
  assert.ok(picked);
  assert.equal(picked.label, "Sign in", "autofill-chip candidate must be filtered");

  // Only-chip case returns null, not the chip.
  const onlyChip = [
    { role: "submit_button", label: "user@example.com", cx: 540, cy: 818 },
  ];
  assert.equal(authDriver.pickSubmitButton(onlyChip), null);
});

test("pickEmailInput: prefers empty-label input over email-addressed autofill chip", () => {
  const classified = [
    { role: "email_input", label: "user@example.com", cx: 540, cy: 500 },
    { role: "email_input", label: "", cx: 540, cy: 818 },
  ];
  const picked = authDriver.pickEmailInput(classified);
  assert.ok(picked);
  assert.equal(picked.cy, 818, "real empty input wins over chip");

  // All-chip fallback: return something rather than yield.
  const onlyChips = [
    { role: "email_input", label: "user@example.com", cx: 540, cy: 500 },
  ];
  const fallback = authDriver.pickEmailInput(onlyChips);
  assert.ok(fallback, "must fall back rather than yield when no empty input exists");
});

test("decide: authStep='submitted' on email form → blocks fp and returns null", async () => {
  // Simulates post-submit re-dispatch when the form is still visible
  // (invalid creds, captcha, server error, network). Before the fix
  // this returned null without blocking, so claim() kept returning true
  // and LLMFallback drove forever.
  const classifier = makeClassifier((c) => {
    if (c.isEmail) return "email_input";
    if (c.isPassword) return "password_input";
    if (c.label === "Sign in") return "submit_button";
    return "unknown";
  });
  const state = {
    credentials: { email: "user@example.com", password: "pw" },
    authStep: "submitted",
    dispatchCount: 5,
    authStepDispatch: 4,
  };
  const observation = {
    xml: genericEmailFormXml,
    packageName: "com.example.app",
    activity: ".Login",
  };
  const action = await authDriver.decide(observation, state, { classify: classifier.fn });
  assert.equal(action, null, "must yield, not terminate the run");
  assert.ok(state.authBlockedFingerprints instanceof Set);
  assert.equal(state.authBlockedFingerprints.size, 1, "post-submit fp must be blocked");

  // Re-claim on the same screen must now be false — no infinite claim+null loop.
  assert.equal(authDriver.claim(observation, state), false);
});

test("decide: stuck-dispatch limit blocks fp instead of yielding in place", async () => {
  // authStep set but not moved in >=STUCK_DISPATCH_LIMIT dispatches.
  const classifier = makeClassifier((c) => {
    if (c.isEmail) return "email_input";
    if (c.isPassword) return "password_input";
    if (c.label === "Sign in") return "submit_button";
    return "unknown";
  });
  const state = {
    credentials: { email: "user@example.com", password: "pw" },
    authStep: "email_focused",
    dispatchCount: 10,
    authStepDispatch: 5, // delta=5 ≥ STUCK_DISPATCH_LIMIT (2)
  };
  const observation = {
    xml: genericEmailFormXml,
    packageName: "com.example.app",
    activity: ".Login",
  };
  const action = await authDriver.decide(observation, state, { classify: classifier.fn });
  assert.equal(action, null);
  assert.ok(state.authBlockedFingerprints instanceof Set);
  assert.equal(state.authBlockedFingerprints.size, 1);
  assert.equal(authDriver.claim(observation, state), false);
});

test("decide: autofill-chip replay — chip at email slot does not hijack initial tap", async () => {
  // Generic Android autofill chip rendered above the real input. The chip
  // is a clickable whose label is a remembered email address. The classifier
  // mis-tags it as email_input (alongside the real input). pickEmailInput
  // must prefer the empty-label real input.
  const chipXml = wrap(
    node({
      text: "user@example.com",
      resourceId: "com.example.app:id/autofill_chip_0",
      bounds: "[40,380][1040,470]", // cy=425 — chip
      pkg: "com.example.app",
    }),
    node({
      resourceId: "com.example.app:id/email_input",
      cls: "android.widget.EditText",
      pkg: "com.example.app",
      bounds: "[80,500][1000,620]", // cy=560 — real input
    }),
    node({
      resourceId: "com.example.app:id/password_input",
      cls: "android.widget.EditText",
      pkg: "com.example.app",
      password: true,
      bounds: "[80,680][1000,800]",
    }),
    node({
      text: "Sign in",
      clickable: true,
      bounds: "[80,900][1000,1020]",
      pkg: "com.example.app",
    }),
  );

  const classifier = makeClassifier((c) => {
    // Both the chip and the real input get role=email_input — the same
    // misclassification an LLM classifier produces under autofill noise.
    if (c.label === "user@example.com") return "email_input";
    if (c.isEmail) return "email_input";
    if (c.isPassword) return "password_input";
    if (c.label === "Sign in") return "submit_button";
    return "unknown";
  });
  const state = {
    credentials: { email: "user@example.com", password: "pw" },
    dispatchCount: 1,
  };
  const action = await authDriver.decide(
    { xml: chipXml, packageName: "com.example.app", activity: ".Login" },
    state,
    { classify: classifier.fn },
  );

  assert.equal(action.type, "tap");
  assert.equal(
    action.y,
    560,
    "must tap the real empty email input (cy=560), not the chip (cy=425)",
  );
  assert.notEqual(
    action.targetText,
    "user@example.com",
    "autofill chip label must never leak into the tap action",
  );
  assert.equal(state.authStep, "email_focused");
});
