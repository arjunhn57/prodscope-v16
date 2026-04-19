"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateAction,
  executeAction,
  substituteCredentials,
  VALID_TYPES,
} = require("../executor");

test("validateAction rejects non-object input", () => {
  assert.equal(validateAction(null).valid, false);
  assert.equal(validateAction("tap").valid, false);
  assert.equal(validateAction(undefined).valid, false);
});

test("validateAction rejects unknown type", () => {
  const r = validateAction({ type: "shake" });
  assert.equal(r.valid, false);
  assert.match(r.error, /unknown action type/);
});

test("validateAction accepts all documented types", () => {
  const cases = [
    { type: "tap", x: 10, y: 20 },
    { type: "long_press", x: 10, y: 20 },
    { type: "swipe", x1: 0, y1: 0, x2: 10, y2: 10 },
    { type: "type", text: "hello" },
    { type: "press_back" },
    { type: "press_home" },
    { type: "launch_app" },
    { type: "wait", ms: 500 },
    { type: "done", reason: "exhausted" },
  ];
  for (const a of cases) {
    const r = validateAction(a);
    assert.equal(r.valid, true, `${a.type} should validate: ${JSON.stringify(r)}`);
  }
});

test("validateAction requires numeric coordinates for tap/long_press/swipe", () => {
  assert.equal(validateAction({ type: "tap", x: "abc", y: 0 }).valid, false);
  assert.equal(validateAction({ type: "tap", x: 10 }).valid, false); // missing y
  assert.equal(validateAction({ type: "long_press", x: 10, y: "x" }).valid, false);
  assert.equal(validateAction({ type: "swipe", x1: 0, y1: 0, x2: 10 }).valid, false);
});

test("validateAction requires non-empty text for type", () => {
  assert.equal(validateAction({ type: "type", text: "" }).valid, false);
  assert.equal(validateAction({ type: "type" }).valid, false);
  assert.equal(validateAction({ type: "type", text: 5 }).valid, false);
});

test("validateAction rejects wait outside 0..3000", () => {
  assert.equal(validateAction({ type: "wait", ms: -1 }).valid, false);
  assert.equal(validateAction({ type: "wait", ms: 3001 }).valid, false);
  assert.equal(validateAction({ type: "wait", ms: 0 }).valid, true);
  assert.equal(validateAction({ type: "wait", ms: 3000 }).valid, true);
});

test("validateAction requires reason string for done", () => {
  assert.equal(validateAction({ type: "done" }).valid, false);
  assert.equal(validateAction({ type: "done", reason: "" }).valid, false);
  assert.equal(validateAction({ type: "done", reason: "exhausted" }).valid, true);
});

test("VALID_TYPES has exactly the 9 documented action types", () => {
  assert.equal(VALID_TYPES.size, 9);
  for (const t of [
    "tap",
    "type",
    "swipe",
    "long_press",
    "press_back",
    "press_home",
    "launch_app",
    "wait",
    "done",
  ]) {
    assert.ok(VALID_TYPES.has(t), `missing type: ${t}`);
  }
});

test("substituteCredentials replaces ${EMAIL} and ${PASSWORD}", () => {
  const creds = { email: "a@b.c", password: "p@ss" };
  assert.equal(substituteCredentials("${EMAIL}", creds), "a@b.c");
  assert.equal(substituteCredentials("${PASSWORD}", creds), "p@ss");
  assert.equal(
    substituteCredentials("user=${EMAIL}&pw=${PASSWORD}", creds),
    "user=a@b.c&pw=p@ss",
  );
});

test("substituteCredentials handles missing fields", () => {
  assert.equal(substituteCredentials("${EMAIL}", null), "${EMAIL}");
  assert.equal(substituteCredentials("${EMAIL}", {}), "${EMAIL}");
  assert.equal(substituteCredentials("x ${PASSWORD}", { email: "e" }), "x ${PASSWORD}");
});

test("substituteCredentials does not alter text without placeholders", () => {
  assert.equal(substituteCredentials("plain text", { email: "a", password: "b" }), "plain text");
});

// ── executeAction: integration with a mock adb ──

function makeMockAdb() {
  const calls = [];
  return {
    calls,
    tap: (x, y) => calls.push({ m: "tap", x, y }),
    swipe: (x1, y1, x2, y2, d) => calls.push({ m: "swipe", x1, y1, x2, y2, d }),
    pressBack: () => calls.push({ m: "pressBack" }),
    pressHome: () => calls.push({ m: "pressHome" }),
    inputText: (t) => calls.push({ m: "inputText", t }),
    launchApp: (p) => calls.push({ m: "launchApp", p }),
  };
}

test("executeAction: done is terminal with agent_done: reason", async () => {
  // done doesn't call adb, so we can use real module
  const r = await executeAction({ type: "done", reason: "exhausted" }, { targetPackage: "com.a" });
  assert.equal(r.terminal, true);
  assert.equal(r.ok, true);
  assert.equal(r.stopReason, "agent_done:exhausted");
});

test("executeAction: invalid action returns ok=false, not terminal", async () => {
  const r = await executeAction({ type: "nope" }, { targetPackage: "com.a" });
  assert.equal(r.ok, false);
  assert.equal(r.terminal, false);
  assert.match(r.error, /unknown action type/);
});

test("executeAction: launch_app without targetPackage returns error", async () => {
  const r = await executeAction({ type: "launch_app" }, { targetPackage: "" });
  assert.equal(r.ok, false);
  assert.match(r.error, /targetPackage/);
});

test("executeAction: wait resolves after ms (bounded)", async () => {
  const start = Date.now();
  const r = await executeAction({ type: "wait", ms: 50 }, { targetPackage: "com.a" });
  const elapsed = Date.now() - start;
  assert.equal(r.ok, true);
  assert.ok(elapsed >= 45, `wait too short: ${elapsed}ms`);
});
