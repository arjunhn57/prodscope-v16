"use strict";

/**
 * V18 dispatcher tests — validate the intent filter end-to-end.
 *
 * Cases:
 *   1. Feed cards with intent=navigate → ExplorationDriver taps a card.
 *   2. Comment list with Reply buttons (intent=write) → driver skips them;
 *      falls through to LLMFallback (or yields null if no other target).
 *   3. Mixed screen (Phone write + Home navigate) → taps Home, not Phone.
 *   4. Plan `allowedIntents=["navigate"]` on a compose sheet → exploration
 *      driver yields, Dismiss driver handles it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { dispatch } = require("../dispatcher");
const { CLASSIFY_TOOL } = require("../semantic-classifier");

function wrap(...nodes) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n${nodes.join("\n")}\n</hierarchy>`;
}
function n({ text = "", desc = "", rid = "", cls = "android.widget.Button", bounds = "[0,0][100,100]", pkg = "com.app", clickable = "true", password = "false" }) {
  return `<node text="${text}" resource-id="${rid}" class="${cls}" package="${pkg}" content-desc="${desc}" clickable="${clickable}" password="${password}" bounds="${bounds}" />`;
}

function makeMockAnthropic(plans) {
  const calls = [];
  const queue = plans.slice();
  return {
    calls,
    messages: {
      create: async (body, options) => {
        calls.push({ body, options });
        const next = queue.shift();
        if (!next) throw new Error("mock exhausted");
        return {
          content: [{ type: "tool_use", name: CLASSIFY_TOOL.name, id: "m", input: next }],
          stop_reason: "tool_use",
        };
      },
    },
  };
}

// ── 1. Feed cards: intent=navigate → driver acts ──

test("dispatch: navigate-intent feed cards → ExplorationDriver taps a card", async () => {
  const xml = wrap(
    n({ text: "Post by Alice", rid: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,400][1040,560]" }),
    n({ text: "Post by Bob",   rid: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,580][1040,740]" }),
    n({ text: "Post by Carol", rid: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,760][1040,920]" }),
  );
  const plan = {
    screen_type: "feed",
    allowed_intents: ["navigate", "read_only"],
    action_budget: 3,
    confidence: 0.9,
    nodes: [
      { nodeIndex: 0, role: "content", intent: "navigate", priority: 8 },
      { nodeIndex: 1, role: "content", intent: "navigate", priority: 8 },
      { nodeIndex: 2, role: "content", intent: "navigate", priority: 8 },
    ],
  };
  const anthropic = makeMockAnthropic([plan]);
  const r = await dispatch(
    { xml, packageName: "com.app" },
    {},
    { anthropic, classifierCache: new Map() },
  );
  assert.equal(r.driver, "ExplorationDriver");
  assert.equal(r.action.type, "tap");
  assert.equal(r.plan.screenType, "feed");
});

// ── 2. Reply buttons tagged write → driver filters them all out ──

test("dispatch: all-write reply buttons → ExplorationDriver yields; dispatcher hits LLMFallback", async () => {
  const xml = wrap(
    n({ text: "Reply", rid: "com.app:id/reply", cls: "android.widget.Button", bounds: "[40,400][400,500]" }),
    n({ text: "Reply", rid: "com.app:id/reply", cls: "android.widget.Button", bounds: "[40,620][400,720]" }),
    n({ text: "Reply", rid: "com.app:id/reply", cls: "android.widget.Button", bounds: "[40,840][400,940]" }),
  );
  const plan = {
    screen_type: "feed",
    allowed_intents: ["navigate", "read_only"],
    action_budget: 3,
    confidence: 0.9,
    nodes: [
      { nodeIndex: 0, role: "content", intent: "write", priority: 0 },
      { nodeIndex: 1, role: "content", intent: "write", priority: 0 },
      { nodeIndex: 2, role: "content", intent: "write", priority: 0 },
    ],
  };
  const anthropic = makeMockAnthropic([plan]);
  let llmFallbackCalled = false;
  const llmFallback = async () => {
    llmFallbackCalled = true;
    return { type: "press_back" };
  };
  const r = await dispatch(
    { xml, packageName: "com.app" },
    {},
    { anthropic, classifierCache: new Map(), llmFallback },
  );
  assert.equal(r.driver, "LLMFallback", "no driver should tap a write-intent Reply button");
  assert.equal(llmFallbackCalled, true);
  assert.equal(r.action.type, "press_back");
});

// ── 3. Mixed: Phone (write) + Home (navigate) → taps Home ──

test("dispatch: mixed intents → navigate-tagged Home is picked, write-tagged Phone is skipped", async () => {
  const xml = wrap(
    n({ text: "Phone",  rid: "com.app:id/phone",  cls: "android.view.View",  bounds: "[40,1920][300,2020]",  desc: "Phone" }),
    n({ text: "Email",  rid: "com.app:id/email",  cls: "android.view.View",  bounds: "[400,1920][680,2020]", desc: "Email" }),
    n({ text: "Message",rid: "com.app:id/msg",    cls: "android.view.View",  bounds: "[780,1920][1040,2020]",desc: "Message" }),
    // Genuine bottom nav
    n({ text: "Home",    rid: "com.app:id/nav_home",    cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView", bounds: "[0,2280][270,2400]" }),
    n({ text: "Search",  rid: "com.app:id/nav_search",  cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView", bounds: "[270,2280][540,2400]" }),
    n({ text: "Profile", rid: "com.app:id/nav_profile", cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView", bounds: "[540,2280][810,2400]" }),
  );
  const plan = {
    screen_type: "profile",
    allowed_intents: ["navigate", "read_only"],
    action_budget: 3,
    confidence: 0.9,
    nodes: [
      { nodeIndex: 0, role: "content", intent: "write", priority: 0, note: "phone action" },
      { nodeIndex: 1, role: "content", intent: "write", priority: 0, note: "email action" },
      { nodeIndex: 2, role: "content", intent: "write", priority: 0, note: "message action" },
      { nodeIndex: 3, role: "nav_tab", intent: "navigate", priority: 9 },
      { nodeIndex: 4, role: "nav_tab", intent: "navigate", priority: 9 },
      { nodeIndex: 5, role: "nav_tab", intent: "navigate", priority: 9 },
    ],
  };
  const anthropic = makeMockAnthropic([plan]);
  const r = await dispatch(
    { xml, packageName: "com.app" },
    {},
    { anthropic, classifierCache: new Map() },
  );
  assert.equal(r.driver, "ExplorationDriver");
  assert.equal(r.action.type, "tap");
  // Home tab center: x = (0+270)/2 = 135
  assert.equal(r.action.x, 135);
  assert.equal(r.action.y, 2340);
  assert.notEqual(r.action.targetText, "Phone", "must never tap the Phone action button");
});

// ── 4. Compose sheet with "Close sheet" → DismissDriver takes it ──

test("dispatch: compose sheet with a close affordance → DismissDriver acts, not Exploration", async () => {
  const xml = wrap(
    n({ text: "Close sheet", rid: "com.app:id/close", desc: "Close sheet", cls: "android.widget.Button", bounds: "[40,100][200,180]" }),
    n({ text: "Send", rid: "com.app:id/send", cls: "android.widget.Button", bounds: "[900,100][1040,180]" }),
    n({ text: "", rid: "com.app:id/compose_input", cls: "android.widget.EditText", bounds: "[40,300][1040,2000]" }),
    // Emoji picker at bottom
    n({ text: "😊", cls: "android.view.View", bounds: "[40,1920][200,2060]" }),
    n({ text: "🎉", cls: "android.view.View", bounds: "[240,1920][400,2060]" }),
    n({ text: "🦖", cls: "android.view.View", bounds: "[440,1920][600,2060]" }),
  );
  const plan = {
    screen_type: "compose",
    screen_summary: "Comment compose sheet — crawler should dismiss, not send.",
    allowed_intents: ["navigate"],  // deliberately narrow — only navigate-intent clickables
    action_budget: 1,
    exit_condition: "dismiss and return to parent",
    confidence: 0.95,
    nodes: [
      { nodeIndex: 0, role: "dismiss_button", intent: "navigate", priority: 10 }, // Close
      { nodeIndex: 1, role: "submit_button",  intent: "write",    priority: 0  }, // Send
      { nodeIndex: 2, role: "content",        intent: "write",    priority: 0  }, // Input
      { nodeIndex: 3, role: "content",        intent: "write",    priority: 0  }, // emoji
      { nodeIndex: 4, role: "content",        intent: "write",    priority: 0  }, // emoji
      { nodeIndex: 5, role: "content",        intent: "write",    priority: 0  }, // emoji
    ],
  };
  const anthropic = makeMockAnthropic([plan]);
  const r = await dispatch(
    { xml, packageName: "com.app" },
    {},
    { anthropic, classifierCache: new Map() },
  );
  assert.equal(r.driver, "DismissDriver", "Dismiss owns close-sheet on compose screens");
  assert.equal(r.action.type, "tap");
  assert.equal(r.plan.screenType, "compose");
});
