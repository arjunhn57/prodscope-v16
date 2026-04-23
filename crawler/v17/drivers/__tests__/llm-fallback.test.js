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
