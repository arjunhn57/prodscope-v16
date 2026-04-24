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

test("VALID_TYPES contains all action types including the 2026-04-25 gesture expansion", () => {
  const expected = [
    // Core pointer
    "tap", "double_tap", "long_press", "drag",
    // Swipes
    "swipe", "scroll_up", "scroll_down", "swipe_horizontal", "pull_to_refresh",
    // Edge swipes
    "edge_swipe_back", "edge_swipe_drawer", "edge_swipe_home",
    // Text
    "type", "clear_field",
    // Keys
    "press_back", "press_home", "press_menu", "press_app_switch", "press_escape", "ime_action",
    // Lifecycle
    "launch_app", "wait", "done", "request_human_input",
  ];
  for (const t of expected) {
    assert.ok(VALID_TYPES.has(t), `missing type: ${t}`);
  }
  assert.equal(VALID_TYPES.size, expected.length);
});

test("validateAction: request_human_input accepts valid shape for each field", () => {
  for (const field of ["otp", "email_code", "2fa", "captcha"]) {
    const r = validateAction({
      type: "request_human_input",
      field,
      prompt: "Enter the code",
    });
    assert.equal(r.valid, true, `${field} should validate: ${JSON.stringify(r)}`);
  }
});

test("validateAction: request_human_input rejects missing/invalid field", () => {
  assert.equal(
    validateAction({ type: "request_human_input", prompt: "x" }).valid,
    false,
  );
  assert.equal(
    validateAction({ type: "request_human_input", field: "", prompt: "x" }).valid,
    false,
  );
  assert.equal(
    validateAction({ type: "request_human_input", field: "face_id", prompt: "x" }).valid,
    false,
  );
  assert.equal(
    validateAction({ type: "request_human_input", field: 42, prompt: "x" }).valid,
    false,
  );
});

test("validateAction: request_human_input rejects missing/empty prompt", () => {
  assert.equal(
    validateAction({ type: "request_human_input", field: "otp" }).valid,
    false,
  );
  assert.equal(
    validateAction({ type: "request_human_input", field: "otp", prompt: "" }).valid,
    false,
  );
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

test("substituteCredentials falls back to credentials.username when email missing", () => {
  // Users copying the frontend placeholder type {"username":"...","password":"..."}.
  // Without this fallback, ${EMAIL} stays literal and the agent can't type the login.
  assert.equal(
    substituteCredentials("${EMAIL}", { username: "arjun@example.com", password: "p" }),
    "arjun@example.com",
  );
  assert.equal(
    substituteCredentials("user=${EMAIL}&pw=${PASSWORD}", {
      username: "arjun@example.com",
      password: "p@ss",
    }),
    "user=arjun@example.com&pw=p@ss",
  );
});

test("substituteCredentials prefers email over username when both are present", () => {
  assert.equal(
    substituteCredentials("${EMAIL}", { email: "primary@x.com", username: "fallback@x.com" }),
    "primary@x.com",
  );
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
    pressEnter: () => calls.push({ m: "pressEnter" }),
    keyEvent: (code) => calls.push({ m: "keyEvent", code }),
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

test("executeAction: request_human_input fails when no resolveHumanInput handler", async () => {
  const adb = makeMockAdb();
  const r = await executeAction(
    { type: "request_human_input", field: "otp", prompt: "Enter OTP" },
    { targetPackage: "com.a", adb },
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /resolveHumanInput/);
});

test("executeAction: request_human_input dispatches inputText with resolved value and tags source", async () => {
  const adb = makeMockAdb();
  const r = await executeAction(
    { type: "request_human_input", field: "otp", prompt: "Enter OTP" },
    {
      targetPackage: "com.a",
      adb,
      resolveHumanInput: async ({ field, prompt }) => {
        assert.equal(field, "otp");
        assert.equal(prompt, "Enter OTP");
        return { value: "987654", source: "static" };
      },
    },
  );
  assert.equal(r.ok, true);
  assert.equal(r.terminal, false);
  assert.deepEqual(r.humanInput, { field: "otp", source: "static" });
  assert.deepEqual(adb.calls, [{ m: "inputText", t: "987654" }]);
});

test("executeAction: request_human_input returns error on empty resolved value", async () => {
  const adb = makeMockAdb();
  const r = await executeAction(
    { type: "request_human_input", field: "otp", prompt: "Enter OTP" },
    {
      targetPackage: "com.a",
      adb,
      resolveHumanInput: async () => ({ value: "", source: "popup" }),
    },
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /empty value/);
  assert.equal(adb.calls.length, 0);
});

test("executeAction: request_human_input maps INPUT_TIMEOUT to blocked_by_auth:timeout terminal", async () => {
  const adb = makeMockAdb();
  const r = await executeAction(
    { type: "request_human_input", field: "otp", prompt: "Enter OTP" },
    {
      targetPackage: "com.a",
      adb,
      resolveHumanInput: async () => {
        throw new Error("INPUT_TIMEOUT");
      },
    },
  );
  assert.equal(r.ok, true);
  assert.equal(r.terminal, true);
  assert.equal(r.stopReason, "agent_done:blocked_by_auth:timeout");
  assert.equal(r.humanInput.source, "timeout");
});

test("executeAction: request_human_input maps INPUT_CANCELLED to blocked_by_auth:user_cancelled terminal", async () => {
  const adb = makeMockAdb();
  const r = await executeAction(
    { type: "request_human_input", field: "captcha", prompt: "What do you see?" },
    {
      targetPackage: "com.a",
      adb,
      resolveHumanInput: async () => {
        throw new Error("INPUT_CANCELLED");
      },
    },
  );
  assert.equal(r.ok, true);
  assert.equal(r.terminal, true);
  assert.equal(r.stopReason, "agent_done:blocked_by_auth:user_cancelled");
  assert.equal(r.humanInput.source, "cancel");
});

// ── tap-target-resolver integration ────────────────────────────────────

test("executeAction: tap without targetText uses vision coords verbatim", async () => {
  const adb = makeMockAdb();
  const r = await executeAction(
    { type: "tap", x: 100, y: 200 },
    { targetPackage: "com.a", adb },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(adb.calls, [{ m: "tap", x: 100, y: 200 }]);
});

test("executeAction: tap with targetText but no ctx.xml still uses vision coords", async () => {
  const adb = makeMockAdb();
  const r = await executeAction(
    { type: "tap", x: 100, y: 200, targetText: "Continue with Email" },
    { targetPackage: "com.a", adb },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(adb.calls, [{ m: "tap", x: 100, y: 200 }]);
});

test("executeAction: tap with targetText + matching xml snaps to XML center", async () => {
  const adb = makeMockAdb();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
<node index="0" text="Continue with Email" resource-id="" class="android.widget.Button" package="com.example" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[40,1640][1040,1790]" />
</hierarchy>`;
  const r = await executeAction(
    { type: "tap", x: 352, y: 1006, targetText: "Continue with Email" },
    { targetPackage: "com.a", adb, xml },
  );
  assert.equal(r.ok, true);
  assert.equal(adb.calls.length, 1);
  assert.equal(adb.calls[0].m, "tap");
  assert.equal(adb.calls[0].x, 540);
  assert.equal(adb.calls[0].y, 1715);
});

test("executeAction: long_press uses resolver the same as tap", async () => {
  const adb = makeMockAdb();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
<node index="0" text="Delete" resource-id="" class="android.widget.Button" package="com.example" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[100,500][500,700]" />
</hierarchy>`;
  const r = await executeAction(
    { type: "long_press", x: 50, y: 50, targetText: "Delete" },
    { targetPackage: "com.a", adb, xml },
  );
  assert.equal(r.ok, true);
  assert.equal(adb.calls.length, 1);
  assert.equal(adb.calls[0].m, "swipe");
  assert.equal(adb.calls[0].x1, 300);
  assert.equal(adb.calls[0].y1, 600);
  assert.equal(adb.calls[0].x2, 300);
  assert.equal(adb.calls[0].y2, 600);
});

// ── 2026-04-25 gesture-taxonomy expansion ──────────────────────────────

test("executeAction: double_tap emits two taps at the same coords", async () => {
  const adb = makeMockAdb();
  const r = await executeAction(
    { type: "double_tap", x: 540, y: 1200 },
    { targetPackage: "com.a", adb },
  );
  assert.equal(r.ok, true);
  assert.equal(adb.calls.length, 2);
  assert.deepEqual(adb.calls[0], { m: "tap", x: 540, y: 1200 });
  assert.deepEqual(adb.calls[1], { m: "tap", x: 540, y: 1200 });
});

test("executeAction: drag issues a swipe with the caller's coords", async () => {
  const adb = makeMockAdb();
  const r = await executeAction(
    { type: "drag", x1: 100, y1: 500, x2: 100, y2: 1500, durationMs: 800 },
    { targetPackage: "com.a", adb },
  );
  assert.equal(r.ok, true);
  assert.equal(adb.calls[0].m, "swipe");
  assert.equal(adb.calls[0].d, 800);
});

test("executeAction: scroll_down swipes bottom→top at screen center", async () => {
  const adb = makeMockAdb();
  const r = await executeAction(
    { type: "scroll_down", screenWidth: 1080, screenHeight: 2400 },
    { targetPackage: "com.a", adb },
  );
  assert.equal(r.ok, true);
  assert.equal(adb.calls[0].m, "swipe");
  // Default formula: cx=540, y1=bottom(1800), y2=top(600).
  assert.equal(adb.calls[0].x1, 540);
  assert.equal(adb.calls[0].x2, 540);
  assert.ok(adb.calls[0].y1 > adb.calls[0].y2);
});

test("executeAction: scroll_up swipes top→bottom (opposite of scroll_down)", async () => {
  const adb = makeMockAdb();
  const r = await executeAction(
    { type: "scroll_up", screenWidth: 1080, screenHeight: 2400 },
    { targetPackage: "com.a", adb },
  );
  assert.equal(r.ok, true);
  assert.ok(adb.calls[0].y1 < adb.calls[0].y2);
});

test("executeAction: swipe_horizontal direction='left' swipes right→left (next page)", async () => {
  const adb = makeMockAdb();
  const r = await executeAction(
    { type: "swipe_horizontal", direction: "left", screenWidth: 1080, screenHeight: 2400 },
    { targetPackage: "com.a", adb },
  );
  assert.equal(r.ok, true);
  // finger right→left: x1 > x2
  assert.ok(adb.calls[0].x1 > adb.calls[0].x2);
});

test("executeAction: swipe_horizontal direction='right' swipes left→right (prev page)", async () => {
  const adb = makeMockAdb();
  await executeAction(
    { type: "swipe_horizontal", direction: "right", screenWidth: 1080, screenHeight: 2400 },
    { targetPackage: "com.a", adb },
  );
  assert.ok(adb.calls[0].x1 < adb.calls[0].x2);
});

test("executeAction: edge_swipe_back swipes from x=0 inward at middle y", async () => {
  const adb = makeMockAdb();
  await executeAction(
    { type: "edge_swipe_back", screenWidth: 1080, screenHeight: 2400 },
    { targetPackage: "com.a", adb },
  );
  assert.equal(adb.calls[0].x1, 0, "edge-swipe-back must start at left edge x=0");
  assert.ok(adb.calls[0].x2 > 0 && adb.calls[0].x2 < 1080);
  assert.equal(adb.calls[0].y1, 1200);
  assert.equal(adb.calls[0].y2, 1200);
});

test("executeAction: edge_swipe_drawer swipes from right edge inward", async () => {
  const adb = makeMockAdb();
  await executeAction(
    { type: "edge_swipe_drawer", screenWidth: 1080, screenHeight: 2400 },
    { targetPackage: "com.a", adb },
  );
  assert.equal(adb.calls[0].x1, 1079);
  assert.ok(adb.calls[0].x2 < adb.calls[0].x1 && adb.calls[0].x2 > 0);
});

test("executeAction: edge_swipe_home swipes from bottom edge upward", async () => {
  const adb = makeMockAdb();
  await executeAction(
    { type: "edge_swipe_home", screenWidth: 1080, screenHeight: 2400 },
    { targetPackage: "com.a", adb },
  );
  assert.equal(adb.calls[0].y1, 2399);
  assert.ok(adb.calls[0].y2 < adb.calls[0].y1);
});

test("executeAction: pull_to_refresh swipes short→long vertically at screen center", async () => {
  const adb = makeMockAdb();
  await executeAction(
    { type: "pull_to_refresh", screenWidth: 1080, screenHeight: 2400 },
    { targetPackage: "com.a", adb },
  );
  assert.equal(adb.calls[0].m, "swipe");
  assert.ok(adb.calls[0].y2 > adb.calls[0].y1, "pull_to_refresh swipes downward");
});

test("executeAction: ime_action presses Enter", async () => {
  const adb = makeMockAdb();
  await executeAction({ type: "ime_action" }, { targetPackage: "com.a", adb });
  assert.deepEqual(adb.calls, [{ m: "pressEnter" }]);
});

test("executeAction: press_menu emits KEYCODE_MENU", async () => {
  const adb = makeMockAdb();
  await executeAction({ type: "press_menu" }, { targetPackage: "com.a", adb });
  assert.deepEqual(adb.calls, [{ m: "keyEvent", code: "KEYCODE_MENU" }]);
});

test("executeAction: press_app_switch + press_escape emit their keycodes", async () => {
  const adb = makeMockAdb();
  await executeAction({ type: "press_app_switch" }, { targetPackage: "com.a", adb });
  await executeAction({ type: "press_escape" }, { targetPackage: "com.a", adb });
  assert.deepEqual(adb.calls, [
    { m: "keyEvent", code: "KEYCODE_APP_SWITCH" },
    { m: "keyEvent", code: "KEYCODE_ESCAPE" },
  ]);
});

test("executeAction: clear_field moves caret to end then issues DELs", async () => {
  const adb = makeMockAdb();
  await executeAction({ type: "clear_field" }, { targetPackage: "com.a", adb });
  assert.equal(adb.calls[0].code, "KEYCODE_MOVE_END");
  // Remaining calls are all DELs.
  for (let i = 1; i < adb.calls.length; i++) {
    assert.equal(adb.calls[i].code, "KEYCODE_DEL");
  }
  assert.ok(adb.calls.length > 10, "should emit many DELs to cover realistic field lengths");
});

test("validateAction: swipe_horizontal without direction is invalid", () => {
  assert.equal(validateAction({ type: "swipe_horizontal" }).valid, false);
  assert.equal(validateAction({ type: "swipe_horizontal", direction: "up" }).valid, false);
  assert.equal(validateAction({ type: "swipe_horizontal", direction: "left" }).valid, true);
  assert.equal(validateAction({ type: "swipe_horizontal", direction: "right" }).valid, true);
});

test("validateAction: drag requires numeric coords", () => {
  assert.equal(validateAction({ type: "drag" }).valid, false);
  assert.equal(validateAction({ type: "drag", x1: 0, y1: 0 }).valid, false);
  assert.equal(validateAction({ type: "drag", x1: 0, y1: 0, x2: 100, y2: 100 }).valid, true);
});

test("validateAction: edge swipes need no params — executor computes coords from screen dims", () => {
  for (const t of ["edge_swipe_back", "edge_swipe_drawer", "edge_swipe_home", "pull_to_refresh", "scroll_up", "scroll_down"]) {
    assert.equal(validateAction({ type: t }).valid, true, `${t} should be valid with no args`);
  }
});
