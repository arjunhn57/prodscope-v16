"use strict";

/**
 * Tests for v17/drivers/llm-fallback.js — Phase D.1.
 *
 * 6 cases:
 *   1. buildScreenSignature detects modal classes (BottomSheet).
 *   2. buildScreenSignature detects nav classes (BottomNavigation).
 *   3. buildScreenSignature detects WebView.
 *   4. deriveReason prioritises claimedButNull over signature hints.
 *   5. createLlmFallback forwards to inner, passes observation and state through.
 *   6. createLlmFallback sets deps.lastLlmFallbackReason after call (so dispatcher
 *      can surface it in its return value).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createLlmFallback,
  buildScreenSignature,
  deriveReason,
} = require("../llm-fallback");

function wrap(...nodes) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n${nodes.join("\n")}\n</hierarchy>`;
}

function node({
  cls = "android.widget.Button",
  text = "",
  resourceId = "",
  clickable = true,
  bounds = "[0,0][100,100]",
}) {
  return (
    `<node text="${text}" resource-id="${resourceId}" class="${cls}" ` +
    `clickable="${clickable}" bounds="${bounds}" />`
  );
}

// ── buildScreenSignature ────────────────────────────────────────────────

test("buildScreenSignature: detects BottomSheet modal class", () => {
  const xml = wrap(
    node({ cls: "com.google.android.material.bottomsheet.BottomSheetDialog", clickable: false }),
    node({ cls: "android.widget.Button", text: "Not now" }),
  );
  const sig = buildScreenSignature(xml);
  assert.equal(sig.hasModalHint, true);
});

test("buildScreenSignature: detects BottomNavigationView nav hint", () => {
  const xml = wrap(
    node({
      cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView",
      text: "Home",
    }),
  );
  const sig = buildScreenSignature(xml);
  assert.equal(sig.hasNavHint, true);
});

test("buildScreenSignature: detects WebView presence", () => {
  const xml = wrap(node({ cls: "android.webkit.WebView", clickable: false }));
  const sig = buildScreenSignature(xml);
  assert.equal(sig.hasWebViewHint, true);
});

// ── deriveReason ────────────────────────────────────────────────────────

test("deriveReason: claimedButNull wins over signature hints", () => {
  const reason = deriveReason({
    claimedButNull: [{ driver: "AuthDriver", reason: "decide_returned_null" }],
    claimThrew: [],
    signature: { hasWebViewHint: true, hasModalHint: false, hasNavHint: false, hasAuthHint: false, clickableCount: 3 },
  });
  assert.equal(reason, "driver_claimed_but_null:AuthDriver");
});

// ── createLlmFallback wiring ────────────────────────────────────────────

test("createLlmFallback: forwards obs+state to inner and returns its action", async () => {
  let seen = null;
  const inner = async (obs, state, deps) => {
    seen = { obs, state, deps };
    return { type: "tap", x: 1, y: 2 };
  };
  const handler = createLlmFallback(inner);
  const obs = { xml: "<hierarchy></hierarchy>", packageName: "org.example" };
  const state = { credentials: null };
  const deps = { anthropic: {}, getDiagnostics: () => ({ claimedButNull: [], claimThrew: [] }) };
  const action = await handler(obs, state, deps);
  assert.deepEqual(action, { type: "tap", x: 1, y: 2 });
  assert.equal(seen.obs, obs);
  assert.equal(seen.state, state);
  assert.equal(seen.deps, deps);
});

test("createLlmFallback: annotates deps.lastLlmFallbackReason + signature", async () => {
  const inner = async () => ({ type: "wait" });
  const handler = createLlmFallback(inner);
  const xml = wrap(node({ cls: "android.webkit.WebView", clickable: false }));
  const deps = { getDiagnostics: () => ({ claimedButNull: [], claimThrew: [] }) };
  await handler({ xml, packageName: "com.example" }, {}, deps);
  assert.equal(deps.lastLlmFallbackReason, "no_driver_claimed:webview");
  assert.equal(deps.lastLlmFallbackSignature.hasWebViewHint, true);
});

// ── Phase 2b (2026-04-24): intent validation against v18 plan ──────────
//
// Run 03feb797 showed LLMFallback tapping "Camera" on a compose screen,
// firing ACTION_IMAGE_CAPTURE → com.android.camera2 → drift loop → run
// terminated with 22 unique screens. These tests pin the validator that
// swaps such actions for a safer alternative.

const {
  validateAgainstPlan,
  findClickableAt,
  pickSafeAlternative,
} = require("../llm-fallback");

function makeClickable({ x1, y1, x2, y2, intent, role = "content", priority = 5, label = "", resourceId = "" }) {
  return {
    bounds: { x1, y1, x2, y2 },
    cx: Math.floor((x1 + x2) / 2),
    cy: Math.floor((y1 + y2) / 2),
    intent,
    role,
    priority,
    label,
    resourceId,
  };
}

test("validateAgainstPlan: no plan → action passes through unchanged (backward compat)", () => {
  const action = { type: "tap", x: 100, y: 200 };
  const r = validateAgainstPlan(action, {});
  assert.equal(r.overridden, false);
  assert.deepEqual(r.action, action);
});

test("validateAgainstPlan: tap on write-intent clickable → overridden to safer alternative", () => {
  // This is the step 29 scenario from run 03feb797 — tap on "Camera" (write).
  const classifiedClickables = [
    makeClickable({ x1: 40, y1: 400, x2: 240, y2: 680, intent: "write", role: "content", label: "Camera" }),
    makeClickable({ x1: 40, y1: 2280, x2: 270, y2: 2400, intent: "navigate", role: "nav_tab", label: "Home", priority: 9 }),
  ];
  const plan = { screenType: "compose", allowedIntents: ["navigate"], engineAction: "proceed" };
  const r = validateAgainstPlan(
    { type: "tap", x: 130, y: 540, targetText: "Camera" },
    { plan, classifiedClickables },
  );
  assert.equal(r.overridden, true);
  assert.ok(r.reason && r.reason.includes("Camera"));
  // Safer alternative is the Home nav tab.
  assert.equal(r.action.type, "tap");
  assert.equal(r.action.targetText, "Home");
});

test("validateAgainstPlan: press_back on feed screen → overridden (caused launcher drift)", () => {
  // Step 16 of cf973bc5 — press_back from biztoso home screen dropped to
  // the launcher and triggered the drift storm. Fix: only allow press_back
  // on genuine dead-end screen types.
  const classifiedClickables = [
    makeClickable({ x1: 40, y1: 2280, x2: 270, y2: 2400, intent: "navigate", role: "nav_tab", label: "Home", priority: 9 }),
    makeClickable({ x1: 270, y1: 2280, x2: 540, y2: 2400, intent: "navigate", role: "nav_tab", label: "Search", priority: 9 }),
  ];
  const plan = { screenType: "feed", allowedIntents: ["navigate", "read_only"], engineAction: "proceed" };
  const r = validateAgainstPlan({ type: "press_back" }, { plan, classifiedClickables });
  assert.equal(r.overridden, true);
  assert.equal(r.reason, "press_back_on_feed_screen");
  assert.equal(r.action.type, "tap");
  assert.ok(["Home", "Search"].includes(r.action.targetText));
});

test("validateAgainstPlan: press_back on error screen → passes (valid dead-end)", () => {
  const plan = { screenType: "error", allowedIntents: ["navigate"], engineAction: "proceed" };
  const r = validateAgainstPlan({ type: "press_back" }, { plan, classifiedClickables: [] });
  assert.equal(r.overridden, false);
});

test("validateAgainstPlan: press_back when engine_action=press_back → passes (Haiku authorized it)", () => {
  const plan = { screenType: "feed", allowedIntents: ["navigate"], engineAction: "press_back" };
  const r = validateAgainstPlan({ type: "press_back" }, { plan, classifiedClickables: [] });
  assert.equal(r.overridden, false);
});

test("validateAgainstPlan: no safe alternative → pass through original (no wait-stack)", () => {
  // Only write-intent clickables on screen — no safer tap exists.
  // Regression for run 09eb85c3 (2026-04-24): returning `wait` here stacked
  // three consecutive waits, tripped v17's consecutive-identical guard,
  // forced press_back, drifted to launcher. Now we pass the original tap
  // through; a single write-tap drift is recoverable via drift guard.
  const classifiedClickables = [
    makeClickable({ x1: 40, y1: 400, x2: 240, y2: 680, intent: "write", label: "Post" }),
    makeClickable({ x1: 300, y1: 400, x2: 500, y2: 680, intent: "write", label: "Like" }),
  ];
  const plan = { screenType: "compose", allowedIntents: ["navigate"], engineAction: "proceed" };
  const original = { type: "tap", x: 140, y: 540, targetText: "Post" };
  const r = validateAgainstPlan(original, { plan, classifiedClickables });
  assert.equal(r.overridden, false, "must not substitute wait when no safer tap exists");
  assert.deepEqual(r.action, original);
  assert.ok(r.reason && r.reason.startsWith("pass_through_no_safe_alt"));
});

test("validateAgainstPlan: unknown-intent tap passes through (not overridden)", () => {
  // Silence-default tags un-enumerated clickables as unknown. Rejecting
  // them all blocked progress (run 09eb85c3). Now they pass.
  const classifiedClickables = [
    makeClickable({ x1: 40, y1: 400, x2: 1040, y2: 600, intent: "unknown", label: "Some card" }),
  ];
  const plan = { screenType: "feed", allowedIntents: ["navigate", "read_only"], engineAction: "proceed" };
  const r = validateAgainstPlan(
    { type: "tap", x: 540, y: 500, targetText: "Some card" },
    { plan, classifiedClickables },
  );
  assert.equal(r.overridden, false);
});

test("pickSafeAlternative: prefers navigate, then read_only, then unknown — never write", () => {
  const list = [
    makeClickable({ x1: 0, y1: 0, x2: 100, y2: 100, intent: "write", priority: 10, label: "Send" }),
    makeClickable({ x1: 0, y1: 200, x2: 100, y2: 300, intent: "unknown", priority: 9, label: "Mystery" }),
    makeClickable({ x1: 0, y1: 400, x2: 100, y2: 500, intent: "read_only", priority: 5, label: "Expand" }),
    makeClickable({ x1: 0, y1: 600, x2: 100, y2: 700, intent: "navigate", priority: 3, label: "Home" }),
  ];
  const r = pickSafeAlternative(list);
  // Navigate tier comes first even though its priority is lowest.
  assert.equal(r.targetText, "Home");
});

test("pickSafeAlternative: returns null when only write/destructive present (no wait fallback)", () => {
  const list = [
    makeClickable({ x1: 0, y1: 0, x2: 100, y2: 100, intent: "write", label: "Post" }),
    makeClickable({ x1: 200, y1: 0, x2: 300, y2: 100, intent: "destructive", label: "Delete" }),
  ];
  const r = pickSafeAlternative(list);
  assert.equal(r, null);
});

test("validateAgainstPlan: tap on navigate-intent clickable → passes", () => {
  const classifiedClickables = [
    makeClickable({ x1: 40, y1: 2280, x2: 270, y2: 2400, intent: "navigate", label: "Home" }),
  ];
  const plan = { screenType: "feed", allowedIntents: ["navigate"], engineAction: "proceed" };
  const r = validateAgainstPlan(
    { type: "tap", x: 155, y: 2340, targetText: "Home" },
    { plan, classifiedClickables },
  );
  assert.equal(r.overridden, false);
});

test("findClickableAt: locates clickable by bounds containment", () => {
  const list = [
    makeClickable({ x1: 0, y1: 0, x2: 100, y2: 100, intent: "navigate" }),
    makeClickable({ x1: 200, y1: 200, x2: 400, y2: 400, intent: "write" }),
  ];
  assert.equal(findClickableAt(list, 50, 50).intent, "navigate");
  assert.equal(findClickableAt(list, 300, 300).intent, "write");
  assert.equal(findClickableAt(list, 500, 500), null);
});

test("pickSafeAlternative: picks highest-priority within navigate tier first", () => {
  // Navigate tier comes before read_only regardless of priority.
  const list = [
    makeClickable({ x1: 0, y1: 0, x2: 100, y2: 100, intent: "write", priority: 10, label: "Send" }),
    makeClickable({ x1: 0, y1: 200, x2: 100, y2: 300, intent: "navigate", priority: 5, label: "Home" }),
    makeClickable({ x1: 0, y1: 400, x2: 100, y2: 500, intent: "read_only", priority: 8, label: "Expand" }),
  ];
  const r = pickSafeAlternative(list);
  assert.equal(r.type, "tap");
  assert.equal(r.targetText, "Home"); // navigate tier wins over higher-priority read_only
});
