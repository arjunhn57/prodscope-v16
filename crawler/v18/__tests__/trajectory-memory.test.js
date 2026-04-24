"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createMemory,
  recordScreen,
  recordAction,
  summarise,
  coverageRatio,
  elementKey,
  recordTap,
  isTapped,
  untappedClickables,
  tappedLabelsOnFp,
  RECENT_ACTIONS_CAP,
  DEFAULT_HUBS,
} = require("../trajectory-memory");

test("trajectory-memory: recordScreen dedups by fingerprint", () => {
  const m = createMemory();
  recordScreen(m, "abc", "feed");
  recordScreen(m, "abc", "feed"); // duplicate — should not double-count
  recordScreen(m, "def", "feed");
  recordScreen(m, "ghi", "settings");
  assert.equal(m.seenTypeCounts.feed, 2);
  assert.equal(m.seenTypeCounts.settings, 1);
  assert.equal(m.fingerprintsSeen.size, 3);
  // hubs visited disappear from remaining
  assert.ok(!m.hubsRemaining.has("feed"));
  assert.ok(!m.hubsRemaining.has("settings"));
  assert.ok(m.hubsRemaining.has("profile"));
});

test("trajectory-memory: recordAction caps at RECENT_ACTIONS_CAP", () => {
  const m = createMemory();
  for (let i = 0; i < RECENT_ACTIONS_CAP + 5; i++) {
    recordAction(m, {
      step: i,
      driver: "ExplorationDriver",
      actionType: "tap",
      fingerprint: `fp${i}`,
      outcome: "changed",
    });
  }
  assert.equal(m.recentActions.length, RECENT_ACTIONS_CAP);
  // Oldest entries should be dropped — first remaining step should be 5
  assert.equal(m.recentActions[0].step, 5);
  assert.equal(m.recentActions[m.recentActions.length - 1].step, RECENT_ACTIONS_CAP + 4);
});

test("trajectory-memory: summarise produces a bounded string <1000 chars", () => {
  const m = createMemory();
  recordScreen(m, "a", "feed");
  recordScreen(m, "b", "settings");
  for (let i = 0; i < 20; i++) {
    recordAction(m, { step: i, driver: "NavDriver", actionType: "tap", targetText: `target ${i}`, fingerprint: `fp${i}`, outcome: "changed" });
  }
  const s = summarise(m);
  assert.ok(s.length <= 1000);
  assert.ok(s.includes("screens_seen"));
  assert.ok(s.includes("hubs_remaining"));
  assert.ok(s.includes("recent_actions"));
});

test("trajectory-memory: coverageRatio scales with hubs visited", () => {
  const m = createMemory();
  assert.equal(coverageRatio(m), 0);
  recordScreen(m, "a", "feed");
  recordScreen(m, "b", "settings");
  const expected = 2 / DEFAULT_HUBS.length;
  assert.equal(coverageRatio(m), expected);
});

// ── Phase 3 graph exploration (2026-04-25) ────────────────────────────

function click({ rid = "", label = "", x1 = 0, y1 = 0, x2 = 100, y2 = 100 }) {
  return {
    resourceId: rid,
    label,
    cx: Math.floor((x1 + x2) / 2),
    cy: Math.floor((y1 + y2) / 2),
    bounds: { x1, y1, x2, y2 },
  };
}

test("elementKey: stable across observations; prefers rid+label when available", () => {
  const c = click({ rid: "com.app:id/home", label: "Home", x1: 0, y1: 2280, x2: 270, y2: 2400 });
  const k1 = elementKey(c);
  const k2 = elementKey(click({ rid: "com.app:id/home", label: "Home", x1: 0, y1: 2280, x2: 270, y2: 2400 }));
  assert.equal(k1, k2);
  assert.ok(k1.startsWith("rid:"));
  assert.ok(k1.includes("|lbl:Home"));
});

test("elementKey: distinguishes homogeneous-rid feed cards by label", () => {
  const a = click({ rid: "com.biztoso:id/feed_item", label: "Post by Alice" });
  const b = click({ rid: "com.biztoso:id/feed_item", label: "Post by Bob" });
  assert.notEqual(elementKey(a), elementKey(b));
});

test("recordTap / isTapped: round-trip on a single fp", () => {
  const m = createMemory();
  const fp = "abc123";
  const home = click({ rid: "com.app:id/home", label: "Home" });
  assert.equal(isTapped(m, fp, home), false);
  recordTap(m, fp, home);
  assert.equal(isTapped(m, fp, home), true);
  // Idempotent — re-recording doesn't grow the set.
  recordTap(m, fp, home);
  assert.equal(m.tappedEdgesByFp.get(fp).size, 1);
});

test("recordTap: isolates edges per fp (same element on different fps)", () => {
  const m = createMemory();
  const home = click({ rid: "com.app:id/home", label: "Home" });
  recordTap(m, "fp1", home);
  assert.equal(isTapped(m, "fp1", home), true);
  assert.equal(isTapped(m, "fp2", home), false, "same element on different fp is NOT tapped");
});

test("untappedClickables: returns the frontier after some taps", () => {
  const m = createMemory();
  const fp = "home-fp";
  const cards = [
    click({ rid: "com.biztoso:id/feed_item", label: "Post by Alice" }),
    click({ rid: "com.biztoso:id/feed_item", label: "Post by Bob" }),
    click({ rid: "com.biztoso:id/feed_item", label: "Post by Carol" }),
  ];
  // Initially all 3 are in the frontier.
  assert.equal(untappedClickables(m, fp, cards).length, 3);
  // Tap first two — frontier shrinks to just Carol.
  recordTap(m, fp, cards[0]);
  recordTap(m, fp, cards[1]);
  const frontier = untappedClickables(m, fp, cards);
  assert.equal(frontier.length, 1);
  assert.equal(frontier[0].label, "Post by Carol");
});

test("untappedClickables: empty frontier when all edges tapped", () => {
  const m = createMemory();
  const fp = "fp";
  const clicks = [
    click({ rid: "com.app:id/a" }),
    click({ rid: "com.app:id/b" }),
  ];
  for (const c of clicks) recordTap(m, fp, c);
  assert.equal(untappedClickables(m, fp, clicks).length, 0);
});

test("summarise: emits tapped_on_this_screen + untapped_on_this_screen when opts.currentFp provided", () => {
  const m = createMemory();
  recordScreen(m, "fp1", "feed");
  const cards = [
    click({ rid: "com.app:id/item", label: "Post A" }),
    click({ rid: "com.app:id/item", label: "Post B" }),
    click({ rid: "com.app:id/item", label: "Post C" }),
  ];
  recordTap(m, "fp1", cards[0]);
  const hint = summarise(m, { currentFp: "fp1", currentClickables: cards });
  assert.ok(hint.includes("tapped_on_this_screen"));
  assert.ok(hint.includes("Post A"));
  assert.ok(hint.includes("untapped_on_this_screen: 2"));
});

test("summarise: no tapped/untapped lines when opts missing (backwards compat)", () => {
  const m = createMemory();
  recordScreen(m, "fp1", "feed");
  const hint = summarise(m);
  assert.ok(!hint.includes("tapped_on_this_screen"));
  assert.ok(!hint.includes("untapped_on_this_screen"));
  assert.ok(hint.includes("screens_seen"));
});

test("tappedLabelsOnFp: returns labels of tapped clickables in current observation", () => {
  const m = createMemory();
  const a = click({ rid: "com.app:id/a", label: "Home" });
  const b = click({ rid: "com.app:id/b", label: "Profile" });
  const c = click({ rid: "com.app:id/c", label: "Settings" });
  recordTap(m, "fp", a);
  recordTap(m, "fp", c);
  const labels = tappedLabelsOnFp(m, "fp", [a, b, c]);
  // Should include the two tapped, not the untapped "Profile".
  assert.deepEqual(labels.sort(), ["Home", "Settings"]);
});

// ── Phase 4: logical fp + anti-loop (2026-04-25) ───────────────────────

const {
  uniqueLogicalScreensCount,
  countRecentHubTaps,
  LOOP_WINDOW_STEPS,
  LOOP_WARN_THRESHOLD,
} = require("../trajectory-memory");

test("recordScreen: counts a screen once per LOGICAL fp, even if structural fp varies (scroll drift)", () => {
  const m = createMemory();
  // Two structural fps (different scroll offsets) but same logical fp —
  // should count as ONE screen for coverage.
  recordScreen(m, "structural-A", "feed", "logical-home");
  recordScreen(m, "structural-B", "feed", "logical-home");
  recordScreen(m, "structural-C", "feed", "logical-home");
  assert.equal(uniqueLogicalScreensCount(m), 1);
  assert.equal(m.seenTypeCounts.feed, 1, "feed should be counted once, not three times");
});

test("recordScreen: different logical fps are counted separately", () => {
  const m = createMemory();
  recordScreen(m, "s1", "feed", "logical-home");
  recordScreen(m, "s2", "profile", "logical-profile");
  recordScreen(m, "s3", "settings", "logical-settings");
  assert.equal(uniqueLogicalScreensCount(m), 3);
});

test("recordScreen: logicalFingerprint omitted falls back to structural (backwards compat)", () => {
  const m = createMemory();
  recordScreen(m, "s1", "feed");
  recordScreen(m, "s2", "feed");
  assert.equal(uniqueLogicalScreensCount(m), 2);
});

test("countRecentHubTaps: counts Home/Profile taps in the recent window", () => {
  const m = createMemory();
  for (let i = 0; i < 4; i++) {
    recordAction(m, { step: i * 2, driver: "LLMFallback", actionType: "tap", targetText: "Home", fingerprint: `fp${i}` });
    recordAction(m, { step: i * 2 + 1, driver: "LLMFallback", actionType: "tap", targetText: "Profile", fingerprint: `fp${i}` });
  }
  const counts = countRecentHubTaps(m);
  assert.ok(counts.get("Home") >= 3);
  assert.ok(counts.get("Profile") >= 3);
});

test("countRecentHubTaps: non-hub labels (e.g. 'Post A') don't trigger", () => {
  const m = createMemory();
  for (let i = 0; i < 5; i++) {
    recordAction(m, { step: i, driver: "ExplorationDriver", actionType: "tap", targetText: `Post ${i}`, fingerprint: `fp${i}` });
  }
  const counts = countRecentHubTaps(m);
  assert.equal(counts.size, 0);
});

test("summarise: emits LOOP WARNING when a hub tap count hits the threshold", () => {
  const m = createMemory();
  for (let i = 0; i < LOOP_WARN_THRESHOLD; i++) {
    recordAction(m, { step: i, driver: "LLMFallback", actionType: "tap", targetText: "Home", fingerprint: `fp${i}` });
  }
  const hint = summarise(m);
  assert.ok(hint.includes("LOOP WARNING"), "expected LOOP WARNING in hint");
  assert.ok(hint.includes("Home"), "LOOP WARNING should name the looped label");
  assert.ok(hint.includes("Do NOT tap"), "directive should be prescriptive");
});

test("summarise: no LOOP WARNING below the threshold (2 taps only)", () => {
  const m = createMemory();
  for (let i = 0; i < LOOP_WARN_THRESHOLD - 1; i++) {
    recordAction(m, { step: i, driver: "LLMFallback", actionType: "tap", targetText: "Home", fingerprint: `fp${i}` });
  }
  const hint = summarise(m);
  assert.ok(!hint.includes("LOOP WARNING"), "no warning should fire below threshold");
});

test("summarise: includes logical_unique count line", () => {
  const m = createMemory();
  recordScreen(m, "s1", "feed", "lfp-feed");
  recordScreen(m, "s2", "feed", "lfp-feed"); // same logical fp — no re-count
  recordScreen(m, "s3", "settings", "lfp-settings");
  const hint = summarise(m);
  assert.ok(hint.includes("logical_unique: 2"));
});
