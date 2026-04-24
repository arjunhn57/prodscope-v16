"use strict";

/**
 * defaults.test.js — structural guard for config/defaults.js.
 *
 * These constants are read in many places and their shape / presence is
 * load-bearing. Pins the Phase 3.1 oracle additions so a rename or
 * accidental deletion fails CI instead of silently changing runtime
 * behavior.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

function loadDefaults(envOverrides = {}) {
  const snapshot = {};
  for (const k of Object.keys(envOverrides)) {
    snapshot[k] = process.env[k];
    if (envOverrides[k] === undefined) delete process.env[k];
    else process.env[k] = envOverrides[k];
  }
  delete require.cache[require.resolve("../defaults")];
  try {
    return require("../defaults");
  } finally {
    for (const k of Object.keys(snapshot)) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  }
}

test("defaults — Phase 3.1 oracle constants are exported with safe defaults", () => {
  const d = loadDefaults({
    MAX_DEEP_ANALYZE_SCREENS: undefined,
    ORACLE_STAGE1_ENABLED: undefined,
    SONNET_SKIP_CONFIDENCE_THRESHOLD: undefined,
    SONNET_SKIP_MIN_CRITICAL_BUGS: undefined,
  });
  assert.equal(d.MAX_DEEP_ANALYZE_SCREENS, 10);
  assert.equal(d.ORACLE_STAGE1_ENABLED, true);
  assert.equal(d.SONNET_SKIP_CONFIDENCE_THRESHOLD, 0.8);
  assert.equal(d.SONNET_SKIP_MIN_CRITICAL_BUGS, 3);
});

test("defaults — ORACLE_STAGE1_ENABLED=false disables the feature flag", () => {
  const d = loadDefaults({ ORACLE_STAGE1_ENABLED: "false" });
  assert.equal(d.ORACLE_STAGE1_ENABLED, false);
});

test("defaults — ORACLE_STAGE1_ENABLED defaults to true when unset or any non-'false' value", () => {
  assert.equal(loadDefaults({ ORACLE_STAGE1_ENABLED: undefined }).ORACLE_STAGE1_ENABLED, true);
  assert.equal(loadDefaults({ ORACLE_STAGE1_ENABLED: "true" }).ORACLE_STAGE1_ENABLED, true);
  assert.equal(loadDefaults({ ORACLE_STAGE1_ENABLED: "1" }).ORACLE_STAGE1_ENABLED, true);
});

test("defaults — numeric overrides are coerced from env strings", () => {
  const d = loadDefaults({
    MAX_DEEP_ANALYZE_SCREENS: "15",
    SONNET_SKIP_CONFIDENCE_THRESHOLD: "0.9",
    SONNET_SKIP_MIN_CRITICAL_BUGS: "5",
  });
  assert.equal(d.MAX_DEEP_ANALYZE_SCREENS, 15);
  assert.equal(d.SONNET_SKIP_CONFIDENCE_THRESHOLD, 0.9);
  assert.equal(d.SONNET_SKIP_MIN_CRITICAL_BUGS, 5);
});

test("defaults — legacy MAX_AI_TRIAGE_SCREENS still exported (fallback path)", () => {
  const d = loadDefaults();
  assert.equal(d.MAX_AI_TRIAGE_SCREENS, 5);
});
