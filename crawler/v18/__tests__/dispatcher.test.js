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

// ── Phase 2: engine_action routing — LLM-decided, BEFORE drivers run ──

test("dispatch: engine_action=relaunch → emits launch_app, drivers never run", async () => {
  // Screen is the Android launcher (we've drifted). Haiku decides relaunch.
  const xml = wrap(
    n({ text: "Phone",    rid: "com.google.android.apps.nexuslauncher:id/phone",    bounds: "[0,2280][216,2400]", cls: "android.widget.TextView" }),
    n({ text: "Messages", rid: "com.google.android.apps.nexuslauncher:id/messages", bounds: "[216,2280][432,2400]", cls: "android.widget.TextView" }),
    n({ text: "Chrome",   rid: "com.google.android.apps.nexuslauncher:id/chrome",   bounds: "[432,2280][648,2400]", cls: "android.widget.TextView" }),
    n({ text: "Camera",   rid: "com.google.android.apps.nexuslauncher:id/camera",   bounds: "[648,2280][864,2400]", cls: "android.widget.TextView" }),
    n({ text: "Settings", rid: "com.google.android.apps.nexuslauncher:id/settings", bounds: "[864,2280][1080,2400]", cls: "android.widget.TextView" }),
  );
  const plan = {
    screen_type: "other",
    screen_summary: "Android home launcher — drifted out of target app",
    allowed_intents: ["navigate"],
    action_budget: 1,
    confidence: 0.95,
    engine_action: "relaunch",
    engine_action_reason: "launcher package, not target",
    nodes: [],
  };
  const anthropic = makeMockAnthropic([plan]);
  const driverCalls = [];
  const spyDriver = {
    name: "SpyDriver",
    claim: () => { driverCalls.push("claim"); return true; },
    decide: () => { driverCalls.push("decide"); return { type: "tap", x: 0, y: 0 }; },
  };
  const r = await dispatch(
    { xml, packageName: "com.google.android.apps.nexuslauncher", targetPackage: "com.biztoso.app" },
    {},
    {
      anthropic,
      classifierCache: new Map(),
      targetPackage: "com.biztoso.app",
      drivers: [spyDriver],
    },
  );
  assert.equal(r.action.type, "launch_app");
  assert.equal(r.driver, "EngineAction:relaunch");
  assert.deepEqual(driverCalls, [], "drivers must NOT be consulted when engineAction=relaunch");
});

test("dispatch: engine_action=press_back → emits press_back, drivers never run", async () => {
  const xml = wrap(
    n({ text: "Page not found", rid: "com.app:id/error", bounds: "[40,400][1040,600]", cls: "android.widget.TextView" }),
    n({ text: "OK", rid: "com.app:id/ok", bounds: "[400,800][680,900]" }),
    n({ text: "Retry", rid: "com.app:id/retry", bounds: "[400,950][680,1050]" }),
  );
  const plan = {
    screen_type: "error",
    allowed_intents: ["navigate"],
    action_budget: 1,
    confidence: 0.9,
    engine_action: "press_back",
    engine_action_reason: "dead-end error screen with no new navigation",
    nodes: [],
  };
  const anthropic = makeMockAnthropic([plan]);
  let driverClaimCalled = false;
  const spyDriver = {
    name: "SpyDriver",
    claim: () => { driverClaimCalled = true; return true; },
    decide: () => ({ type: "tap", x: 0, y: 0 }),
  };
  const r = await dispatch(
    { xml, packageName: "com.app", targetPackage: "com.app" },
    {},
    { anthropic, classifierCache: new Map(), targetPackage: "com.app", drivers: [spyDriver] },
  );
  assert.equal(r.action.type, "press_back");
  assert.equal(r.driver, "EngineAction:press_back");
  assert.equal(driverClaimCalled, false, "drivers must NOT be consulted when engineAction=press_back");
});

test("dispatch: engine_action=wait → emits wait action", async () => {
  const xml = wrap(
    n({ text: "Loading", rid: "com.app:id/loader", bounds: "[0,0][1080,2400]", cls: "android.widget.ProgressBar" }),
    n({ text: "Please wait", rid: "com.app:id/msg", bounds: "[100,1000][980,1100]" }),
    n({ text: "", rid: "com.app:id/spinner", bounds: "[480,1200][600,1320]" }),
  );
  const plan = {
    screen_type: "other",
    allowed_intents: ["navigate"],
    action_budget: 1,
    confidence: 0.95,
    engine_action: "wait",
    engine_action_reason: "loading spinner visible",
    nodes: [],
  };
  const anthropic = makeMockAnthropic([plan]);
  const r = await dispatch(
    { xml, packageName: "com.app", targetPackage: "com.app" },
    {},
    { anthropic, classifierCache: new Map(), targetPackage: "com.app" },
  );
  assert.equal(r.action.type, "wait");
  assert.equal(r.action.ms, 1500);
  assert.equal(r.driver, "EngineAction:wait");
});

test("dispatch: engine_action=proceed (default) → drivers dispatch normally", async () => {
  const xml = wrap(
    n({ text: "Home",    rid: "com.app:id/nav_home",    cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView", bounds: "[0,2280][270,2400]" }),
    n({ text: "Search",  rid: "com.app:id/nav_search",  cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView", bounds: "[270,2280][540,2400]" }),
    n({ text: "Profile", rid: "com.app:id/nav_profile", cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView", bounds: "[540,2280][810,2400]" }),
  );
  const plan = {
    screen_type: "feed",
    allowed_intents: ["navigate", "read_only"],
    action_budget: 3,
    confidence: 0.9,
    engine_action: "proceed",
    nodes: [
      { nodeIndex: 0, role: "nav_tab", intent: "navigate", priority: 9 },
      { nodeIndex: 1, role: "nav_tab", intent: "navigate", priority: 9 },
      { nodeIndex: 2, role: "nav_tab", intent: "navigate", priority: 9 },
    ],
  };
  const anthropic = makeMockAnthropic([plan]);
  const r = await dispatch(
    { xml, packageName: "com.app", targetPackage: "com.app" },
    {},
    { anthropic, classifierCache: new Map(), targetPackage: "com.app" },
  );
  assert.equal(r.driver, "ExplorationDriver");
  assert.equal(r.action.type, "tap");
});

// ── Phase 3: dispatcher records tapped edges into trajectory memory ──

test("dispatch: after driver emits a tap, the tapped clickable is recorded in trajectory memory", async () => {
  const { createMemory, isTapped } = require("../trajectory-memory");
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
  const trajectory = createMemory();
  const r = await dispatch(
    { xml, packageName: "com.app" },
    {},
    { anthropic, classifierCache: new Map(), trajectory },
  );
  assert.equal(r.action.type, "tap");
  // One of the 3 cards is now marked tapped on this fp.
  const fp = r.plan.fingerprint;
  assert.ok(trajectory.tappedEdgesByFp.has(fp));
  assert.equal(trajectory.tappedEdgesByFp.get(fp).size, 1);
});

test("dispatch: classifier cache hit on second call — second tap records second edge (frontier BFS)", async () => {
  const { createMemory } = require("../trajectory-memory");
  // 5 cards — large enough that after tapping one, findListItemTargets
  // still sees ≥3 aligned siblings and keeps picking.
  const xml = wrap(
    n({ text: "Post A", rid: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,400][1040,560]" }),
    n({ text: "Post B", rid: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,580][1040,740]" }),
    n({ text: "Post C", rid: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,760][1040,920]" }),
    n({ text: "Post D", rid: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,940][1040,1100]" }),
    n({ text: "Post E", rid: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,1120][1040,1280]" }),
  );
  const plan = {
    screen_type: "feed",
    allowed_intents: ["navigate", "read_only"],
    action_budget: 5,
    confidence: 0.9,
    nodes: Array.from({ length: 5 }, (_, i) => ({ nodeIndex: i, role: "content", intent: "navigate", priority: 8 })),
  };
  const anthropic = makeMockAnthropic([plan]); // Only ONE scripted plan — subsequent calls must be cache hits.
  const cache = new Map();
  const trajectory = createMemory();
  const r1 = await dispatch({ xml, packageName: "com.app" }, {}, { anthropic, classifierCache: cache, trajectory });
  const r2 = await dispatch({ xml, packageName: "com.app" }, {}, { anthropic, classifierCache: cache, trajectory });
  const fp = r1.plan.fingerprint;
  assert.notEqual(r1.action.y, r2.action.y, "second call must pick a different card via frontier filter");
  assert.equal(trajectory.tappedEdgesByFp.get(fp).size, 2);
});

test("dispatch: frontier empty on detail screen → ExplorationDriver emits press_back (safe back-edge)", async () => {
  const { createMemory, recordTap } = require("../trajectory-memory");
  const xml = wrap(
    n({ text: "Item A", rid: "com.app:id/row", cls: "com.app.DetailRow", bounds: "[40,200][1040,360]" }),
    n({ text: "Item B", rid: "com.app:id/row", cls: "com.app.DetailRow", bounds: "[40,380][1040,540]" }),
    n({ text: "Item C", rid: "com.app:id/row", cls: "com.app.DetailRow", bounds: "[40,560][1040,720]" }),
  );
  const plan = {
    screen_type: "detail",
    allowed_intents: ["navigate", "read_only"],
    action_budget: 3,
    confidence: 0.9,
    nodes: Array.from({ length: 3 }, (_, i) => ({ nodeIndex: i, role: "content", intent: "navigate", priority: 5 })),
  };
  const anthropic = makeMockAnthropic([plan]);
  const trajectory = createMemory();
  // Pre-seed the trajectory: all 3 rows tapped (frontier is empty).
  const { parseClickableGraph } = require("../../v17/drivers/clickable-graph");
  const graph = parseClickableGraph(xml);
  const fakeFp = "pre-seed-fp";
  for (const c of graph.clickables) recordTap(trajectory, fakeFp, c);

  // Dispatch — classifier will compute its own fp. We need both pre-seed and
  // live fp to match. Simpler: dispatch first to learn the fp, then pre-seed
  // trajectory on that fp and dispatch again.
  const r1 = await dispatch({ xml, packageName: "com.app" }, {}, { anthropic, classifierCache: new Map(), trajectory });
  const fp = r1.plan.fingerprint;
  // Pre-seed all graph clickables as tapped on the real fp.
  for (const c of graph.clickables) recordTap(trajectory, fp, c);
  // Dispatch again with the same xml + fresh anthropic (need a second plan scripted).
  const anthropic2 = makeMockAnthropic([plan]);
  const cache2 = new Map();
  const r2 = await dispatch({ xml, packageName: "com.app" }, {}, { anthropic: anthropic2, classifierCache: cache2, trajectory });
  // r2 should emit press_back because frontier is empty on a detail screen.
  assert.equal(r2.action.type, "press_back");
  assert.equal(r2.driver, "ExplorationDriver");
});

test("dispatch: detail screen with ViewPager + empty frontier → emits swipe_horizontal before press_back", async () => {
  const { createMemory, recordTap } = require("../trajectory-memory");
  // 3 rows + a ViewPager wrapper in the XML. After tapping all 3 rows,
  // the frontier is empty; next call should swipe_horizontal because
  // the screen hosts a pager.
  const xml = `<?xml version="1.0"?>\n<hierarchy rotation="0">\n` +
    `<node class="androidx.viewpager2.widget.ViewPager2" package="com.app" clickable="false" bounds="[0,0][1080,2400]" />` +
    `<node text="Item A" resource-id="com.app:id/row" class="com.app.DetailRow" package="com.app" clickable="true" bounds="[40,200][1040,360]" />` +
    `<node text="Item B" resource-id="com.app:id/row" class="com.app.DetailRow" package="com.app" clickable="true" bounds="[40,380][1040,540]" />` +
    `<node text="Item C" resource-id="com.app:id/row" class="com.app.DetailRow" package="com.app" clickable="true" bounds="[40,560][1040,720]" />` +
    `</hierarchy>`;
  const plan = {
    screen_type: "detail",
    allowed_intents: ["navigate", "read_only"],
    action_budget: 3,
    confidence: 0.9,
    nodes: Array.from({ length: 3 }, (_, i) => ({ nodeIndex: i, role: "content", intent: "navigate", priority: 5 })),
  };
  const trajectory = createMemory();
  const { parseClickableGraph } = require("../../v17/drivers/clickable-graph");
  const graph = parseClickableGraph(xml);
  const r0 = await dispatch({ xml, packageName: "com.app" }, {}, {
    anthropic: makeMockAnthropic([plan]), classifierCache: new Map(), trajectory,
  });
  const fp = r0.plan.fingerprint;
  for (const c of graph.clickables) recordTap(trajectory, fp, c);
  // Now frontier is empty. Expect swipe_horizontal (pager detected).
  const r = await dispatch({ xml, packageName: "com.app" }, {}, {
    anthropic: makeMockAnthropic([plan]), classifierCache: new Map(), trajectory,
  });
  assert.equal(r.action.type, "swipe_horizontal");
  assert.equal(r.action.direction, "left");
});

test("dispatch: detail screen (no pager) empty frontier → press_back first, then edge_swipe_back on persistence, then yield", async () => {
  const { createMemory, recordTap } = require("../trajectory-memory");
  const xml = wrap(
    n({ text: "Item A", rid: "com.app:id/row", cls: "com.app.DetailRow", bounds: "[40,200][1040,360]" }),
    n({ text: "Item B", rid: "com.app:id/row", cls: "com.app.DetailRow", bounds: "[40,380][1040,540]" }),
    n({ text: "Item C", rid: "com.app:id/row", cls: "com.app.DetailRow", bounds: "[40,560][1040,720]" }),
  );
  const plan = {
    screen_type: "detail",
    allowed_intents: ["navigate", "read_only"],
    action_budget: 3,
    confidence: 0.9,
    nodes: Array.from({ length: 3 }, (_, i) => ({ nodeIndex: i, role: "content", intent: "navigate", priority: 5 })),
  };
  const trajectory = createMemory();
  const { parseClickableGraph } = require("../../v17/drivers/clickable-graph");
  const graph = parseClickableGraph(xml);
  const r0 = await dispatch({ xml, packageName: "com.app" }, {}, {
    anthropic: makeMockAnthropic([plan]), classifierCache: new Map(), trajectory,
  });
  const fp = r0.plan.fingerprint;
  for (const c of graph.clickables) recordTap(trajectory, fp, c);
  // Share driver state so back-ladder progresses across calls.
  const sharedState = {};
  // 1st empty-frontier: press_back
  const r1 = await dispatch({ xml, packageName: "com.app" }, sharedState, {
    anthropic: makeMockAnthropic([plan]), classifierCache: new Map(), trajectory,
  });
  assert.equal(r1.action.type, "press_back", "step 1 of ladder must be press_back");
  // 2nd empty-frontier on same fp: edge_swipe_back
  const r2 = await dispatch({ xml, packageName: "com.app" }, sharedState, {
    anthropic: makeMockAnthropic([plan]), classifierCache: new Map(), trajectory,
  });
  assert.equal(r2.action.type, "edge_swipe_back", "step 2 of ladder must be edge_swipe_back");
  // 3rd: yields → LLMFallback (default returns done). The assertion here is
  // just that it's NOT another press_back / edge_swipe_back loop.
  let fallbackCalled = false;
  const llmFallback = async () => {
    fallbackCalled = true;
    return { type: "wait", ms: 500 };
  };
  const r3 = await dispatch({ xml, packageName: "com.app" }, sharedState, {
    anthropic: makeMockAnthropic([plan]), classifierCache: new Map(), trajectory, llmFallback,
  });
  assert.equal(fallbackCalled, true, "ladder must yield to LLMFallback after 2 attempts");
  assert.notEqual(r3.action.type, "press_back");
  assert.notEqual(r3.action.type, "edge_swipe_back");
});

test("dispatch: frontier empty on feed screen → ExplorationDriver yields to LLMFallback (hub routing)", async () => {
  const { createMemory, recordTap } = require("../trajectory-memory");
  const xml = wrap(
    n({ text: "Post A", rid: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,400][1040,560]" }),
    n({ text: "Post B", rid: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,580][1040,740]" }),
    n({ text: "Post C", rid: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,760][1040,920]" }),
  );
  const plan = {
    screen_type: "feed",
    allowed_intents: ["navigate", "read_only"],
    action_budget: 3,
    confidence: 0.9,
    nodes: Array.from({ length: 3 }, (_, i) => ({ nodeIndex: i, role: "content", intent: "navigate", priority: 8 })),
  };
  const trajectory = createMemory();
  const { parseClickableGraph } = require("../../v17/drivers/clickable-graph");
  const graph = parseClickableGraph(xml);
  // Discover fp via a dry-run dispatch, then pre-seed all cards.
  const r0 = await dispatch({ xml, packageName: "com.app" }, {}, {
    anthropic: makeMockAnthropic([plan]), classifierCache: new Map(), trajectory,
  });
  const fp = r0.plan.fingerprint;
  for (const c of graph.clickables) recordTap(trajectory, fp, c);
  // Now dispatch with empty frontier on a feed screen → should hit LLMFallback.
  let fallbackCalled = false;
  const llmFallback = async () => {
    fallbackCalled = true;
    return { type: "press_back" };
  };
  const r = await dispatch(
    { xml, packageName: "com.app" },
    {},
    { anthropic: makeMockAnthropic([plan]), classifierCache: new Map(), trajectory, llmFallback },
  );
  assert.equal(fallbackCalled, true, "LLMFallback should be invoked when frontier is empty on a feed screen");
  assert.equal(r.driver, "LLMFallback");
});

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
