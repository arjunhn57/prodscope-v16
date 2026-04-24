"use strict";

/**
 * agent-loop-drift.test.js — package-drift guard (Commit-1, 2026-04-24).
 *
 * Background: biztoso run a172f1e0 navigated out of com.biztoso.app into
 * com.google.android.dialer at step 28 (phone-sign-up intent handoff) and
 * kept exploring the dialer's bottom tabs. Inflated uniqueScreens with
 * zero product-analysis value.
 *
 * The guard lives in crawler/v17/agent-loop.js — after captureObservation,
 * compare observation.packageName with opts.targetPackage. On drift,
 * increment a counter and call relaunchApp(). After
 * MAX_PACKAGE_DRIFT_RECOVERIES attempts, terminate with
 * stopReason = "package_drift_unrecoverable".
 *
 * These cases pin the PURE detector (detectPackageDrift) and the exported
 * allowlist / cap constant. The integration is small enough that an
 * end-to-end test would be mostly mock wiring; we cover the recovery
 * wiring via the runner's existing mockEmulatorManager.relaunchApp
 * assertions + a live smoke on the VM after deploy.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  detectPackageDrift,
  DRIFT_ALLOWLIST,
  MAX_PACKAGE_DRIFT_RECOVERIES,
} = require("../agent-loop");

// ── detectPackageDrift ─────────────────────────────────────────────────

test("detectPackageDrift: same package — no drift", () => {
  const obs = { packageName: "com.biztoso.app" };
  assert.equal(detectPackageDrift(obs, "com.biztoso.app"), false);
});

test("detectPackageDrift: different non-allowlisted package — drift fires", () => {
  const obs = { packageName: "com.google.android.dialer" };
  assert.equal(detectPackageDrift(obs, "com.biztoso.app"), true);
});

test("detectPackageDrift: permission controller is allowlisted", () => {
  const obs = { packageName: "com.google.android.permissioncontroller" };
  assert.equal(detectPackageDrift(obs, "com.biztoso.app"), false);
});

test("detectPackageDrift: pixel launcher is allowlisted (home-screen bounce is valid transit)", () => {
  const obs = { packageName: "com.google.android.apps.nexuslauncher" };
  assert.equal(detectPackageDrift(obs, "com.biztoso.app"), false);
});

test("detectPackageDrift: IME (Gboard) is allowlisted", () => {
  const obs = { packageName: "com.google.android.inputmethod.latin" };
  assert.equal(detectPackageDrift(obs, "com.biztoso.app"), false);
});

test("detectPackageDrift: missing packageName — cannot detect, no drift", () => {
  assert.equal(detectPackageDrift({ packageName: null }, "com.biztoso.app"), false);
  assert.equal(detectPackageDrift({ packageName: "" }, "com.biztoso.app"), false);
  assert.equal(detectPackageDrift({}, "com.biztoso.app"), false);
});

test("detectPackageDrift: missing targetPackage — can't compare, no drift", () => {
  const obs = { packageName: "com.whatever" };
  assert.equal(detectPackageDrift(obs, null), false);
  assert.equal(detectPackageDrift(obs, undefined), false);
  assert.equal(detectPackageDrift(obs, ""), false);
});

test("detectPackageDrift: null observation — safe, no drift", () => {
  assert.equal(detectPackageDrift(null, "com.biztoso.app"), false);
});

test("detectPackageDrift: packageName='unknown' is NOT drift (adb activity resolver failed)", () => {
  // Regression for run 8708eddb (2026-04-24 09:46). v16/observation.js
  // returns the literal "unknown" string when getCurrentActivityAsync()
  // can't resolve the foreground (common race during app boot / adb
  // reconnect). Treating it as drift caused a relaunch storm — every
  // step tried recovery, agent-loop never advanced past step 0.
  const obs = { packageName: "unknown" };
  assert.equal(detectPackageDrift(obs, "com.biztoso.app"), false);
});

// ── allowlist shape ────────────────────────────────────────────────────

test("DRIFT_ALLOWLIST: includes every package a real crawl can legitimately hit", () => {
  // Minimum set that must never trigger drift — mapped to real intents:
  //   permissioncontroller: runtime permission dialogs (PermissionDriver)
  //   packageinstaller:     install prompts (rare in crawl, but seen)
  //   nexuslauncher/launcher: home-screen bounce during app switch
  //   inputmethod.latin:    Gboard popping up on EditText focus
  //   systemui:             status-bar / notification-panel transients
  const required = [
    "com.google.android.permissioncontroller",
    "com.android.permissioncontroller",
    "com.google.android.packageinstaller",
    "com.android.packageinstaller",
    "com.google.android.apps.nexuslauncher",
    "com.android.launcher",
    "com.android.launcher3",
    "com.google.android.inputmethod.latin",
    "com.android.inputmethod.latin",
    "com.android.systemui",
  ];
  for (const pkg of required) {
    assert.ok(DRIFT_ALLOWLIST.has(pkg), `${pkg} must be in DRIFT_ALLOWLIST`);
  }
});

test("DRIFT_ALLOWLIST: does NOT include obvious escape targets (dialer, browser, gmail)", () => {
  // These are real escape destinations we saw today. None of them belong on
  // the allowlist — a biztoso crawl should not keep exploring the dialer
  // just because it was invoked via intent.
  const escapeTargets = [
    "com.google.android.dialer",
    "com.android.chrome",
    "com.google.android.gm",
    "com.android.contacts",
    "com.android.messaging",
  ];
  for (const pkg of escapeTargets) {
    assert.ok(!DRIFT_ALLOWLIST.has(pkg), `${pkg} must NOT be in DRIFT_ALLOWLIST`);
  }
});

// ── recovery-cap constant ──────────────────────────────────────────────

test("MAX_PACKAGE_DRIFT_RECOVERIES: exported and set to a sane value (per spec: 4)", () => {
  assert.equal(typeof MAX_PACKAGE_DRIFT_RECOVERIES, "number");
  assert.equal(MAX_PACKAGE_DRIFT_RECOVERIES, 4);
});
