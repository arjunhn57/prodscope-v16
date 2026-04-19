"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  captureObservation,
  computeFeedback,
  parsePackageFromActivity,
} = require("../observation");

test("parsePackageFromActivity extracts package before slash", () => {
  assert.equal(parsePackageFromActivity("com.foo/.MainActivity"), "com.foo");
  assert.equal(parsePackageFromActivity("com.foo.bar/.X$Y"), "com.foo.bar");
  assert.equal(parsePackageFromActivity("unknown"), "unknown");
  assert.equal(parsePackageFromActivity(""), "unknown");
  assert.equal(parsePackageFromActivity(null), "unknown");
});

test("computeFeedback returns 'none' when no previous observation", () => {
  const cur = { fingerprint: "a", packageName: "p", activity: "a" };
  assert.equal(computeFeedback(null, cur, "p"), "none");
});

test("computeFeedback returns 'no_change' when fingerprints match", () => {
  const prev = { fingerprint: "abc", packageName: "p", activity: "a" };
  const cur = { fingerprint: "abc", packageName: "p", activity: "a" };
  assert.equal(computeFeedback(prev, cur, "p"), "no_change");
});

test("computeFeedback returns 'changed' when fingerprints differ", () => {
  const prev = { fingerprint: "abc", packageName: "p", activity: "a" };
  const cur = { fingerprint: "xyz", packageName: "p", activity: "a" };
  assert.equal(computeFeedback(prev, cur, "p"), "changed");
});

test("computeFeedback returns 'left_app' when package changes", () => {
  const prev = { fingerprint: "abc", packageName: "com.a", activity: "a" };
  const cur = { fingerprint: "xyz", packageName: "com.android.chrome", activity: "x" };
  assert.equal(computeFeedback(prev, cur, "com.a"), "left_app");
});

test("computeFeedback returns 'app_crashed' when packageName goes to unknown", () => {
  const prev = { fingerprint: "abc", packageName: "com.a", activity: "a" };
  const cur = { fingerprint: "xyz", packageName: "unknown", activity: "unknown" };
  assert.equal(computeFeedback(prev, cur, "com.a"), "app_crashed");
});

test("computeFeedback prefers 'left_app' over 'changed' when package differs", () => {
  const prev = { fingerprint: "a", packageName: "com.a", activity: "x" };
  const cur = { fingerprint: "b", packageName: "com.b", activity: "y" };
  assert.equal(computeFeedback(prev, cur, "com.a"), "left_app");
});

// ── captureObservation with mocked adb + screenshotFp ──

function makeMockAdb(overrides) {
  return {
    screencapAsync: async () => true,
    dumpXmlAsync: async () => "<hierarchy/>",
    getCurrentActivityAsync: async () => "com.a/.Main",
    ...overrides,
  };
}

const mockFp = {
  computeExactHash: () => "hash-A",
};

test("captureObservation assembles Observation from adb + fp outputs", async () => {
  const result = await captureObservation(
    {
      targetPackage: "com.a",
      screenshotPath: "/tmp/step-1.png",
      previous: null,
      lastAction: null,
    },
    { adb: makeMockAdb(), screenshotFp: mockFp },
  );

  assert.equal(result.observation.packageName, "com.a");
  assert.equal(result.observation.activity, "com.a/.Main");
  assert.equal(result.observation.xml, "<hierarchy/>");
  assert.equal(result.observation.fingerprint, "hash-A");
  assert.equal(result.feedback, "none");
  assert.equal(result.fingerprintChanged, false);
});

test("captureObservation returns 'no_screenshot' fingerprint on capture failure", async () => {
  const adb = makeMockAdb({ screencapAsync: async () => false });
  const result = await captureObservation(
    {
      targetPackage: "com.a",
      screenshotPath: "/tmp/step.png",
      previous: null,
      lastAction: null,
    },
    { adb, screenshotFp: mockFp },
  );
  assert.equal(result.observation.fingerprint, "no_screenshot");
});

test("captureObservation feedback reflects fingerprint change vs prev", async () => {
  const prev = {
    screenshotPath: "/tmp/s0.png",
    xml: "",
    packageName: "com.a",
    activity: "com.a/.Main",
    fingerprint: "hash-OLD",
    timestampMs: 0,
  };
  const result = await captureObservation(
    {
      targetPackage: "com.a",
      screenshotPath: "/tmp/s1.png",
      previous: prev,
      lastAction: { type: "tap", x: 1, y: 1 },
    },
    { adb: makeMockAdb(), screenshotFp: mockFp },
  );
  assert.equal(result.feedback, "changed");
  assert.equal(result.fingerprintChanged, true);
});

test("captureObservation requires ctx.screenshotPath", async () => {
  await assert.rejects(
    () => captureObservation({ targetPackage: "com.a", previous: null, lastAction: null }, {}),
    /screenshotPath/,
  );
});
