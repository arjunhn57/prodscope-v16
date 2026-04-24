"use strict";

/**
 * Tests for v17/drivers/exploration-driver.js.
 *
 * 12 cases per Phase C.2 plan:
 *   1. claim: true on BottomNavigationView XML.
 *   2. claim: true on TabLayout XML.
 *   3. claim: true on NavigationMenuItemView (drawer) XML.
 *   4. claim: true on homogeneous list (≥3 same-class siblings, aligned).
 *   5. claim: false on plain content screen.
 *   6. decide: first call taps the first unvisited nav tab and records key.
 *   7. decide: second call on same screen taps a DIFFERENT nav tab (state memory).
 *   8. decide: all tabs tapped + list items present → taps list item.
 *   9. decide: scroll-exhaustion — after a scroll with identical fingerprint on
 *      next call, the fingerprint is marked exhausted and decide returns null.
 *  10. decide: plain content with nav but no unvisited targets + no scrollable
 *      container → returns null (yields to LLMFallback).
 *  11. claim: true on Compose-style bottom nav (generic android.view.View cluster
 *      in bottom band, no recognisable nav className).
 *  12. decide: structural bottom-bar path taps the leftmost candidate when
 *      className-based nav detection finds nothing.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const explorationDriver = require("../exploration-driver");

// ── XML fixture helpers ─────────────────────────────────────────────────

function wrap(...nodes) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n${nodes.join("\n")}\n</hierarchy>`;
}

function node({
  text = "",
  desc = "",
  resourceId = "",
  cls = "android.widget.FrameLayout",
  pkg = "com.example",
  clickable = true,
  bounds = "[0,0][100,100]",
}) {
  return (
    `<node text="${text}" resource-id="${resourceId}" class="${cls}" ` +
    `package="${pkg}" content-desc="${desc}" clickable="${clickable}" ` +
    `bounds="${bounds}" />`
  );
}

// ── Fixtures — wikipedia-style bottom nav, news-app tabs, file-explorer drawer ─

// Wikipedia bottom nav — 4 BottomNavigationItemView children at y ~ 2300.
const wikipediaBottomNavXml = wrap(
  node({
    resourceId: "org.wikipedia:id/nav_tab_explore",
    cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView",
    pkg: "org.wikipedia",
    text: "Explore",
    bounds: "[0,2280][270,2400]",
  }),
  node({
    resourceId: "org.wikipedia:id/nav_tab_saved",
    cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView",
    pkg: "org.wikipedia",
    text: "Saved",
    bounds: "[270,2280][540,2400]",
  }),
  node({
    resourceId: "org.wikipedia:id/nav_tab_search",
    cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView",
    pkg: "org.wikipedia",
    text: "Search",
    bounds: "[540,2280][810,2400]",
  }),
  node({
    resourceId: "org.wikipedia:id/nav_tab_edits",
    cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView",
    pkg: "org.wikipedia",
    text: "Edits",
    bounds: "[810,2280][1080,2400]",
  }),
);

// Twitter-style top TabLayout — 3 TabView children at top.
const topTabsXml = wrap(
  node({
    resourceId: "com.twitter.android:id/tab_for_you",
    cls: "com.google.android.material.tabs.TabLayout$TabView",
    pkg: "com.twitter.android",
    text: "For You",
    bounds: "[0,140][360,260]",
  }),
  node({
    resourceId: "com.twitter.android:id/tab_following",
    cls: "com.google.android.material.tabs.TabLayout$TabView",
    pkg: "com.twitter.android",
    text: "Following",
    bounds: "[360,140][720,260]",
  }),
  node({
    resourceId: "com.twitter.android:id/tab_subscribe",
    cls: "com.google.android.material.tabs.TabLayout$TabView",
    pkg: "com.twitter.android",
    text: "Subscribe",
    bounds: "[720,140][1080,260]",
  }),
);

// File-manager drawer — 3 NavigationMenuItemView rows.
const drawerXml = wrap(
  node({
    resourceId: "com.files.app:id/drawer_internal",
    cls: "com.google.android.material.internal.NavigationMenuItemView",
    pkg: "com.files.app",
    text: "Internal storage",
    bounds: "[0,400][900,520]",
  }),
  node({
    resourceId: "com.files.app:id/drawer_sd",
    cls: "com.google.android.material.internal.NavigationMenuItemView",
    pkg: "com.files.app",
    text: "SD Card",
    bounds: "[0,520][900,640]",
  }),
  node({
    resourceId: "com.files.app:id/drawer_downloads",
    cls: "com.google.android.material.internal.NavigationMenuItemView",
    pkg: "com.files.app",
    text: "Downloads",
    bounds: "[0,640][900,760]",
  }),
);

// Homogeneous list — 4 same-class clickable cards, aligned at x=40.
const listXml = wrap(
  node({
    resourceId: "com.news.app:id/article_1",
    cls: "com.news.app.ArticleCardView",
    pkg: "com.news.app",
    text: "Article 1",
    bounds: "[40,400][1040,560]",
  }),
  node({
    resourceId: "com.news.app:id/article_2",
    cls: "com.news.app.ArticleCardView",
    pkg: "com.news.app",
    text: "Article 2",
    bounds: "[40,580][1040,740]",
  }),
  node({
    resourceId: "com.news.app:id/article_3",
    cls: "com.news.app.ArticleCardView",
    pkg: "com.news.app",
    text: "Article 3",
    bounds: "[40,760][1040,920]",
  }),
  node({
    resourceId: "com.news.app:id/article_4",
    cls: "com.news.app.ArticleCardView",
    pkg: "com.news.app",
    text: "Article 4",
    bounds: "[40,940][1040,1100]",
  }),
);

// Wikipedia article body inside a NestedScrollView — scrollable content,
// no nav (so claim() falls to the list-item secondary check and finds none).
const articleBodyXml = wrap(
  node({
    cls: "androidx.core.widget.NestedScrollView",
    pkg: "org.wikipedia",
    clickable: false,
    bounds: "[0,200][1080,2200]",
  }),
  node({
    cls: "android.widget.TextView",
    pkg: "org.wikipedia",
    text: "Android is a mobile operating system...",
    clickable: false,
    bounds: "[40,260][1040,1800]",
  }),
);

// Settings screen — no nav widget class, no homogeneous list.
const plainContentXml = wrap(
  node({
    resourceId: "com.app:id/setting_title",
    cls: "android.widget.TextView",
    pkg: "com.app",
    text: "Account settings",
    clickable: false,
    bounds: "[0,100][1080,200]",
  }),
  node({
    resourceId: "com.app:id/save_button",
    cls: "android.widget.Button",
    pkg: "com.app",
    text: "Save",
    bounds: "[800,2200][1040,2360]",
  }),
);

// Compose-style bottom navigation — 4 plain `android.view.View` children at
// y ~ 2340. Real Jetpack Compose NavigationBar items are rendered this way:
// no BottomNavigationItemView className, no resource-id, often just a
// content-desc. The structural-bottom-bar fallback is the only detector that
// can claim this screen.
const composeBottomNavXml = wrap(
  node({
    cls: "android.view.View",
    pkg: "com.example.compose",
    desc: "Home",
    bounds: "[0,2280][270,2400]",
  }),
  node({
    cls: "android.view.View",
    pkg: "com.example.compose",
    desc: "Search",
    bounds: "[270,2280][540,2400]",
  }),
  node({
    cls: "android.view.View",
    pkg: "com.example.compose",
    desc: "Library",
    bounds: "[540,2280][810,2400]",
  }),
  node({
    cls: "android.view.View",
    pkg: "com.example.compose",
    desc: "Profile",
    bounds: "[810,2280][1080,2400]",
  }),
);

// Bottom nav + a list of articles on the Explore tab (combined screen).
const wikipediaExploreTabXml = wrap(
  // Two article cards (homogeneous list under the nav bar)
  node({
    resourceId: "org.wikipedia:id/explore_article_1",
    cls: "org.wikipedia.explore.ArticleFeedCard",
    pkg: "org.wikipedia",
    text: "Featured article",
    bounds: "[40,400][1040,800]",
  }),
  node({
    resourceId: "org.wikipedia:id/explore_article_2",
    cls: "org.wikipedia.explore.ArticleFeedCard",
    pkg: "org.wikipedia",
    text: "Top read",
    bounds: "[40,820][1040,1220]",
  }),
  node({
    resourceId: "org.wikipedia:id/explore_article_3",
    cls: "org.wikipedia.explore.ArticleFeedCard",
    pkg: "org.wikipedia",
    text: "On this day",
    bounds: "[40,1240][1040,1640]",
  }),
  // The 4 bottom nav tabs
  node({
    resourceId: "org.wikipedia:id/nav_tab_explore",
    cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView",
    pkg: "org.wikipedia",
    text: "Explore",
    bounds: "[0,2280][270,2400]",
  }),
  node({
    resourceId: "org.wikipedia:id/nav_tab_saved",
    cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView",
    pkg: "org.wikipedia",
    text: "Saved",
    bounds: "[270,2280][540,2400]",
  }),
);

// ── Tests ──────────────────────────────────────────────────────────────

test("ExplorationDriver.claim: true on BottomNavigationView XML (wikipedia)", () => {
  assert.equal(explorationDriver.claim({ xml: wikipediaBottomNavXml }), true);
});

test("ExplorationDriver.claim: true on TabLayout XML (twitter)", () => {
  assert.equal(explorationDriver.claim({ xml: topTabsXml }), true);
});

test("ExplorationDriver.claim: true on NavigationMenuItemView drawer XML (files)", () => {
  assert.equal(explorationDriver.claim({ xml: drawerXml }), true);
});

test("ExplorationDriver.claim: true on homogeneous list (≥3 same-class aligned siblings)", () => {
  assert.equal(explorationDriver.claim({ xml: listXml }), true);
});

test("ExplorationDriver.claim: false on plain content with no nav/list", () => {
  assert.equal(explorationDriver.claim({ xml: plainContentXml }), false);
});

test("ExplorationDriver.claim: true on Compose-style bottom nav (generic android.view.View cluster)", () => {
  assert.equal(explorationDriver.claim({ xml: composeBottomNavXml }), true);
});

test("ExplorationDriver.decide: first call taps first unvisited nav tab and records key", async () => {
  const state = {};
  const action = await explorationDriver.decide(
    { xml: wikipediaBottomNavXml, packageName: "org.wikipedia" },
    state,
  );
  assert.ok(action, "should produce an action");
  assert.equal(action.type, "tap");
  // First tab = Explore at cy=(2280+2400)/2 = 2340, cx=(0+270)/2=135
  assert.equal(action.y, 2340);
  assert.equal(action.x, 135);
  // State memory should contain the tapped nav's key
  assert.ok(state.explorationMemory);
  assert.equal(state.explorationMemory.tabsTapped.size, 1);
  assert.ok(
    state.explorationMemory.tabsTapped.has("rid:org.wikipedia:id/nav_tab_explore"),
  );
});

test("ExplorationDriver.decide: second call on same screen taps a DIFFERENT nav tab (state memory)", async () => {
  const state = {};
  // First call taps Explore
  const a1 = await explorationDriver.decide(
    { xml: wikipediaBottomNavXml, packageName: "org.wikipedia" },
    state,
  );
  // Second call — same XML, same state → must pick the next unvisited tab (Saved)
  const a2 = await explorationDriver.decide(
    { xml: wikipediaBottomNavXml, packageName: "org.wikipedia" },
    state,
  );
  assert.notEqual(a1.x, a2.x, "must tap a different x coord on second call");
  // Saved tab cx = (270+540)/2 = 405
  assert.equal(a2.x, 405);
  assert.equal(state.explorationMemory.tabsTapped.size, 2);
});

test("ExplorationDriver.decide: after all nav tabs tapped → picks an unvisited list item", async () => {
  const state = {};
  // Pre-populate memory with all 2 nav tabs visited
  explorationDriver.initMemory(state);
  state.explorationMemory.tabsTapped.add("rid:org.wikipedia:id/nav_tab_explore");
  state.explorationMemory.tabsTapped.add("rid:org.wikipedia:id/nav_tab_saved");

  const action = await explorationDriver.decide(
    { xml: wikipediaExploreTabXml, packageName: "org.wikipedia" },
    state,
  );
  assert.ok(action, "should produce an action");
  assert.equal(action.type, "tap");
  // The first article card cy = (400+800)/2 = 600
  assert.equal(action.y, 600);
});

test("ExplorationDriver.decide: scroll-exhaustion — after MAX_SCROLLS_PER_FP same-fp scrolls, fp is marked exhausted and decide returns null", async () => {
  const state = {};
  // Pre-populate memory so nav + list are "visited", forcing scroll path.
  explorationDriver.initMemory(state);
  const obs = { xml: articleBodyXml, packageName: "org.wikipedia" };

  // Directly simulate: last action was scroll on this same fingerprint,
  // and the driver has already scrolled MAX_SCROLLS_PER_FP - 1 times
  // without progress. One more same-fp scroll trips the budget.
  const { computeStructuralFingerprint } = require("../../node-classifier");
  const { parseClickableGraph } = require("../clickable-graph");
  const graph = parseClickableGraph(articleBodyXml);
  const fp = computeStructuralFingerprint(graph, "org.wikipedia", undefined);
  state.explorationMemory.lastActionKind = "scroll";
  state.explorationMemory.lastFingerprint = fp;
  state.explorationMemory.scrollRetryByFp.set(
    fp,
    explorationDriver.MAX_SCROLLS_PER_FP - 1,
  );

  // Next decide() after the stale scroll: increments to the budget → exhausted.
  const firstAction = await explorationDriver.decide(obs, state);
  // Since there are no nav items and no homogeneous list in articleBodyXml,
  // and scroll is now exhausted for this fp, decide must return null.
  assert.equal(firstAction, null);
  assert.ok(state.explorationMemory.scrollExhausted.has(fp));
});

test("ExplorationDriver.decide: plain content with no nav/list/scroll → returns null", async () => {
  const state = {};
  const action = await explorationDriver.decide(
    { xml: plainContentXml, packageName: "com.app" },
    state,
  );
  assert.equal(action, null);
});

test("ExplorationDriver.decide: structural bottom-bar path taps leftmost Compose nav candidate", async () => {
  const state = {};
  const action = await explorationDriver.decide(
    { xml: composeBottomNavXml, packageName: "com.example.compose" },
    state,
  );
  assert.ok(action, "should produce a tap action from structural bottom-bar");
  assert.equal(action.type, "tap");
  // Leftmost tab: cx = (0+270)/2 = 135, cy = (2280+2400)/2 = 2340
  assert.equal(action.x, 135);
  assert.equal(action.y, 2340);
  // Memory must record the tapped key so subsequent calls pick the next tab
  assert.ok(state.explorationMemory);
  assert.equal(state.explorationMemory.tabsTapped.size, 1);
  assert.equal(state.explorationMemory.lastActionKind, "tap_nav");
});

test("ExplorationDriver.decide: second call on Compose bottom-bar picks next candidate (left-to-right)", async () => {
  const state = {};
  const a1 = await explorationDriver.decide(
    { xml: composeBottomNavXml, packageName: "com.example.compose" },
    state,
  );
  const a2 = await explorationDriver.decide(
    { xml: composeBottomNavXml, packageName: "com.example.compose" },
    state,
  );
  assert.notEqual(a1.x, a2.x, "must advance to a different x on second call");
  // Second tab cx = (270+540)/2 = 405
  assert.equal(a2.x, 405);
  assert.equal(state.explorationMemory.tabsTapped.size, 2);
});

test("ExplorationDriver.decide: emits scroll on scrollable content when nothing unvisited remains", async () => {
  const state = {};
  // No nav, no list items in articleBodyXml — but it has a NestedScrollView.
  const action = await explorationDriver.decide(
    { xml: articleBodyXml, packageName: "org.wikipedia" },
    state,
  );
  assert.ok(action, "should emit scroll on a scrollable-only screen");
  assert.equal(action.type, "swipe");
  assert.ok(action.y1 > action.y2, "scroll-down swipe goes from lower y to upper y");
  // State memory updated to track this scroll
  assert.equal(state.explorationMemory.lastActionKind, "scroll");
});

// ── Scroll budget + feed list-item dedup (2026-04-24) ──────────────────
//
// Feed-type screens (Biztoso home feed, LinkedIn timeline, Twitter For
// You) were under-explored because:
//   1. elementKey returned rid-first → all feed cards sharing a container
//      rid collapsed into one key → only 1 card tapped per fp.
//   2. The scroll-exhaustion threshold was 1 → after a single scroll with
//      an identical fp (typical for homogeneous feeds, where the
//      structural fingerprint ignores text and so is stable across
//      scrolls), we marked the fp exhausted and yielded before surfacing
//      below-the-fold content.
// listItemKey appends the label so visually distinct cards remain
// individually tappable, and MAX_SCROLLS_PER_FP=4 gives feeds room to
// scroll through 3-4 screenfuls of content.

// 5 RecyclerView children all sharing the same container rid but distinct
// text labels — the real-world pattern in Biztoso / LinkedIn / Twitter.
const feedXml = wrap(
  node({
    resourceId: "com.biztoso:id/feed_item",
    cls: "com.biztoso.FeedItemView",
    pkg: "com.biztoso",
    text: "Post from Alice",
    bounds: "[40,400][1040,560]",
  }),
  node({
    resourceId: "com.biztoso:id/feed_item",
    cls: "com.biztoso.FeedItemView",
    pkg: "com.biztoso",
    text: "Post from Bob",
    bounds: "[40,580][1040,740]",
  }),
  node({
    resourceId: "com.biztoso:id/feed_item",
    cls: "com.biztoso.FeedItemView",
    pkg: "com.biztoso",
    text: "Post from Carol",
    bounds: "[40,760][1040,920]",
  }),
  node({
    resourceId: "com.biztoso:id/feed_item",
    cls: "com.biztoso.FeedItemView",
    pkg: "com.biztoso",
    text: "Post from Dave",
    bounds: "[40,940][1040,1100]",
  }),
  node({
    resourceId: "com.biztoso:id/feed_item",
    cls: "com.biztoso.FeedItemView",
    pkg: "com.biztoso",
    text: "Post from Eve",
    bounds: "[40,1120][1040,1280]",
  }),
);

test("ExplorationDriver.decide: feed cards with shared rid but distinct labels are tapped individually (listItemKey)", async () => {
  const state = {};
  const obs = { xml: feedXml, packageName: "com.biztoso" };
  const tappedY = [];
  for (let i = 0; i < 5; i++) {
    const a = await explorationDriver.decide(obs, state);
    assert.ok(a, `iteration ${i}: should produce a tap action`);
    assert.equal(a.type, "tap", `iteration ${i}: expected tap`);
    tappedY.push(a.y);
  }
  // 5 distinct y-coords → 5 distinct cards tapped despite shared rid.
  assert.equal(
    new Set(tappedY).size,
    5,
    "expected 5 distinct card taps, not 1 tap + 4 scrolls",
  );
});

test("ExplorationDriver.decide: scroll budget per fp is MAX_SCROLLS_PER_FP", async () => {
  const state = {};
  const obs = { xml: articleBodyXml, packageName: "org.wikipedia" };
  const actions = [];
  // Drive decide() past the budget. Expect exactly MAX swipes, then nulls.
  for (let i = 0; i < explorationDriver.MAX_SCROLLS_PER_FP + 2; i++) {
    actions.push(await explorationDriver.decide(obs, state));
  }
  const swipes = actions.filter((a) => a && a.type === "swipe");
  const nulls = actions.filter((a) => a === null);
  assert.equal(
    swipes.length,
    explorationDriver.MAX_SCROLLS_PER_FP,
    "should emit exactly MAX_SCROLLS_PER_FP swipes before yielding",
  );
  assert.equal(nulls.length, 2, "decide should return null after the budget is hit");
});

test("ExplorationDriver.decide: nav tabs dedup on resource-id alone, not label (listItemKey is list-only)", async () => {
  const state = {};
  const obs = { xml: wikipediaBottomNavXml, packageName: "org.wikipedia" };
  // Tap all 4 bottom-nav tabs — each should be recorded as a separate key.
  for (let i = 0; i < 4; i++) {
    const a = await explorationDriver.decide(obs, state);
    assert.ok(a, `iteration ${i}: should tap a nav tab`);
    assert.equal(a.type, "tap");
  }
  assert.equal(state.explorationMemory.tabsTapped.size, 4);
  for (const key of state.explorationMemory.tabsTapped) {
    assert.ok(key.startsWith("rid:"), `tab key should start with "rid:", got: ${key}`);
    assert.ok(
      !key.includes("|lbl:"),
      `tab key should not carry a label suffix (that's listItemKey's job); got: ${key}`,
    );
  }
});

// ── Profile contact-actions row rejection (2026-04-24) ──────────────
//
// Biztoso runs 6965d9f4 (step 59) and 498c93ca (step 26) both tapped a
// "Phone" button clustered with Email / Message at cy ≈ 1970 on a
// 2400-tall screen. findStructuralBottomBar matched the cluster as if
// it were a Compose NavigationBar (old threshold was 80% of screen
// height), the tap fired ACTION_DIAL, and the emulator drifted into
// the system dialer. Real Android NavigationBars sit ≥ 95% down the
// window; raising BOTTOM_BAR_Y_FRACTION to 0.88 rejects these
// mid-screen action rows without false-negating genuine Compose navs.

// Three buttons (Phone/Email/Message) at cy≈1970 on a 2400-tall screen
// (82% of height). The avatar ImageView is a clickable that pins the
// inferred screen dimensions via inferScreenSize (which uses the max
// bounds from clickables) so the driver's bottom-fraction math resolves
// against a real 2400px tall window, not just the action-row y-span.
const profileContactActionsRowXml = wrap(
  node({
    cls: "android.widget.ImageView",
    pkg: "com.biztoso.app",
    desc: "avatar",
    bounds: "[0,0][1080,2400]",
  }),
  node({
    cls: "android.view.View",
    pkg: "com.biztoso.app",
    desc: "Phone",
    bounds: "[40,1920][300,2020]",
  }),
  node({
    cls: "android.view.View",
    pkg: "com.biztoso.app",
    desc: "Email",
    bounds: "[400,1920][680,2020]",
  }),
  node({
    cls: "android.view.View",
    pkg: "com.biztoso.app",
    desc: "Message",
    bounds: "[780,1920][1040,2020]",
  }),
);

test("ExplorationDriver.findStructuralBottomBar: rejects a profile actions row at 82% height (biztoso dialer drift)", () => {
  const { parseClickableGraph } = require("../clickable-graph");
  const graph = parseClickableGraph(profileContactActionsRowXml);
  // Screen inferred as 2400 tall from the anchor FrameLayout.
  const bar = explorationDriver.findStructuralBottomBar(graph, 2400);
  assert.deepEqual(
    bar,
    [],
    "action-button row at 82% height must not be misread as a bottom nav",
  );
});

test("ExplorationDriver.decide: profile actions row does not trigger a tap (claim yields)", async () => {
  const state = {};
  const action = await explorationDriver.decide(
    { xml: profileContactActionsRowXml, packageName: "com.biztoso.app" },
    state,
  );
  // With no nav tab match, no homogeneous list, no structural bottom bar,
  // and no recognised scrollable container, decide must yield.
  assert.equal(
    action,
    null,
    "no driver target should be produced for a profile action row",
  );
});
