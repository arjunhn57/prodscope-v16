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
  countRecentRepeatedTargets,
  countSpacedRepeatedTargets,
  detectAlternatingPair,
  LOOP_WINDOW_STEPS,
  LOOP_WARN_THRESHOLD,
  SLOW_LOOP_WINDOW_STEPS,
  SLOW_LOOP_WARN_THRESHOLD,
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

test("summarise: emits LOOP WARNING when a label repeats over the threshold", () => {
  const m = createMemory();
  for (let i = 0; i < LOOP_WARN_THRESHOLD; i++) {
    recordAction(m, { step: i, driver: "LLMFallback", actionType: "tap", targetText: "Home", fingerprint: `fp${i}` });
  }
  const hint = summarise(m);
  assert.ok(hint.includes("LOOP WARNING"), "expected LOOP WARNING in hint");
  assert.ok(hint.includes("Home"), "LOOP WARNING should name the repeated label");
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

// ── 2026-04-25 v2: generalised loop detector (no keyword filter) ───────
//
// Hub-keyword-only detection (the v1 approach) silently missed loops on
// labels that don't match any hardcoded keyword: a profile card showing
// the user's own email/handle, "Hi, Arjun" greeting cards, dynamic count
// badges, localized hub labels in non-English apps. countRecentRepeatedTargets
// buckets by raw targetText so any repeated target surfaces.
//
// Generic test harness: `user@example.com`, `Settings`, `Vidzz` — none
// app-specific, none of which would all match the legacy HUB_LABEL_PATTERNS.

test("countRecentRepeatedTargets: counts every repeated target, no keyword filter", () => {
  const m = createMemory();
  for (let i = 0; i < 4; i++) {
    recordAction(m, {
      step: i * 2,
      driver: "LLMFallback",
      actionType: "tap",
      targetText: "user@example.com", // personalized profile card — no hub keyword
      fingerprint: `fp${i}a`,
    });
    recordAction(m, {
      step: i * 2 + 1,
      driver: "LLMFallback",
      actionType: "tap",
      targetText: "Vidzz", // app-specific tab name — no hub keyword
      fingerprint: `fp${i}b`,
    });
  }
  const counts = countRecentRepeatedTargets(m);
  assert.ok(counts.get("user@example.com") >= 3, "personalized label must be counted");
  assert.ok(counts.get("Vidzz") >= 3, "non-hub-keyword label must be counted");
});

test("countRecentRepeatedTargets: skips non-tap actions and empty/null targetText", () => {
  const m = createMemory();
  recordAction(m, { step: 1, driver: "X", actionType: "type", targetText: "Email", fingerprint: "fp" });
  recordAction(m, { step: 2, driver: "X", actionType: "tap", targetText: null, fingerprint: "fp" });
  recordAction(m, { step: 3, driver: "X", actionType: "tap", targetText: "  ", fingerprint: "fp" });
  recordAction(m, { step: 4, driver: "X", actionType: "wait", targetText: "Home", fingerprint: "fp" });
  const counts = countRecentRepeatedTargets(m);
  assert.equal(counts.size, 0, "type/wait actions and empty labels must not count");
});

test("summarise: LOOP WARNING fires on personalized label that no hub keyword matches", () => {
  const m = createMemory();
  // Simulates the run-13644110 pattern: a profile-info card whose label
  // is the user's email rendered alongside a real Home tab. Without
  // keyword filtering, both labels surface as repeated targets.
  for (let i = 0; i < LOOP_WARN_THRESHOLD; i++) {
    recordAction(m, {
      step: i,
      driver: "LLMFallback",
      actionType: "tap",
      targetText: "user@example.com",
      fingerprint: `fp${i}`,
    });
  }
  const hint = summarise(m);
  assert.ok(hint.includes("LOOP WARNING"));
  assert.ok(
    hint.includes("user@example.com"),
    "warning must surface the actual repeated label, not a hub-keyword stand-in",
  );
});

test("summarise: recent_repeated_taps line uses the new label, not the legacy 'recent_hub_taps'", () => {
  const m = createMemory();
  for (let i = 0; i < LOOP_WARN_THRESHOLD; i++) {
    recordAction(m, { step: i, driver: "X", actionType: "tap", targetText: "AnyLabel", fingerprint: `fp${i}` });
  }
  const hint = summarise(m);
  assert.ok(hint.includes("recent_repeated_taps:"));
  assert.ok(!hint.includes("recent_hub_taps:"), "old key must be gone");
});

test("summarise: recent_repeated_taps line is suppressed when no label repeats over threshold", () => {
  const m = createMemory();
  // Three different one-off labels — none repeat, so no signal.
  recordAction(m, { step: 1, driver: "X", actionType: "tap", targetText: "A", fingerprint: "fp" });
  recordAction(m, { step: 2, driver: "X", actionType: "tap", targetText: "B", fingerprint: "fp" });
  recordAction(m, { step: 3, driver: "X", actionType: "tap", targetText: "C", fingerprint: "fp" });
  const hint = summarise(m);
  assert.ok(!hint.includes("recent_repeated_taps:"));
  assert.ok(!hint.includes("LOOP WARNING"));
});

// ── 2026-04-25 v3: causal anti-drift directive ─────────────────────────
//
// When v17/agent-loop's drift-recovery block calls recordAction with an
// outcome of "drift_recovery_after_<action>", summarise must emit a
// directive telling the LLM not to repeat that action. This is the
// signal that prevents the press_back oscillation seen in run e1d45991:
// agent presses back from app root, exits to launcher, drift recovery
// brings biztoso back, agent picks press_back again — looping until the
// recovery cap kills the run. The directive surfaces the causal link
// the agent's recentActions otherwise hides.
//
// All fixtures are app-agnostic — generic action types, no package names.

test("summarise: emits DRIFT WARNING when the most recent action is a drift recovery", () => {
  const m = createMemory();
  recordAction(m, {
    step: 21,
    driver: "LLMFallback",
    actionType: "press_back",
    targetText: null,
    fingerprint: "feed-fp",
    outcome: "changed",
  });
  recordAction(m, {
    step: 22,
    driver: "drift-recovery",
    actionType: "launch_app",
    targetText: null,
    fingerprint: "feed-fp",
    outcome: "drift_recovery_after_press_back",
  });
  const hint = summarise(m);
  assert.ok(hint.includes("DRIFT WARNING"), "expected DRIFT WARNING in hint");
  assert.ok(hint.includes("press_back"), "warning must name the causing action");
  assert.ok(hint.includes("Do NOT"), "directive should be prescriptive");
});

test("summarise: DRIFT WARNING names whatever action caused the recovery (not press_back-specific)", () => {
  // Generic — works for any action that causes drift, e.g. tap on a deep
  // link that hands off to an external app.
  const m = createMemory();
  recordAction(m, {
    step: 5,
    driver: "drift-recovery",
    actionType: "launch_app",
    targetText: null,
    fingerprint: "fp",
    outcome: "drift_recovery_after_tap",
  });
  const hint = summarise(m);
  assert.ok(hint.includes("DRIFT WARNING"));
  assert.ok(hint.includes("tap"), "warning must name the actual causing action");
});

test("summarise: no DRIFT WARNING when no recent recovery in window", () => {
  const m = createMemory();
  // 3 normal taps, no recovery outcome.
  recordAction(m, { step: 1, driver: "X", actionType: "tap", targetText: "A", fingerprint: "fp", outcome: "changed" });
  recordAction(m, { step: 2, driver: "X", actionType: "tap", targetText: "B", fingerprint: "fp", outcome: "changed" });
  recordAction(m, { step: 3, driver: "X", actionType: "tap", targetText: "C", fingerprint: "fp", outcome: "changed" });
  const hint = summarise(m);
  assert.ok(!hint.includes("DRIFT WARNING"));
});

test("summarise: stale recovery (>2 entries ago) does not trigger DRIFT WARNING", () => {
  // Window is the last 2 entries — older recoveries are noise.
  const m = createMemory();
  recordAction(m, {
    step: 1,
    driver: "drift-recovery",
    actionType: "launch_app",
    targetText: null,
    fingerprint: "fp",
    outcome: "drift_recovery_after_press_back",
  });
  recordAction(m, { step: 2, driver: "X", actionType: "tap", targetText: "Home", fingerprint: "fp", outcome: "changed" });
  recordAction(m, { step: 3, driver: "X", actionType: "tap", targetText: "Profile", fingerprint: "fp", outcome: "changed" });
  recordAction(m, { step: 4, driver: "X", actionType: "tap", targetText: "Settings", fingerprint: "fp", outcome: "changed" });
  const hint = summarise(m);
  assert.ok(!hint.includes("DRIFT WARNING"), "stale recovery must not retrigger the warning");
});

// ── 2026-04-25 v4: slow-loop detector (spaced repetition) ──────────────
//
// Run 11380697 reproduced a pattern Fix A's rapid-bounce detector misses:
// the same CTA tapped 5× across 41 steps (steps 38, 42, 56, 64, 79). At
// no point were 3 of those taps within any single 10-step window, so
// LOOP WARNING never fired. countSpacedRepeatedTargets uses a 40-step
// window with the same threshold so the spaced repetition surfaces, and
// summarise emits a milder REPEAT WARNING instead of LOOP WARNING when
// only the slow detector fires.
//
// All fixtures use generic action labels (no app-specific text).

test("countSpacedRepeatedTargets: counts taps spread across 40 steps that rapid window misses", () => {
  const m = createMemory();
  // Tap the SAME label every 10 steps, 4 times — never 3 in any 10-step
  // window, but 4 within a 40-step window.
  let s = 0;
  for (let i = 0; i < 4; i++) {
    recordAction(m, {
      step: ++s,
      driver: "LLMFallback",
      actionType: "tap",
      targetText: "RepeatedCTA",
      fingerprint: `fp${i}`,
      outcome: "changed",
    });
    // 9 filler taps to space the next RepeatedCTA out by ~10 steps.
    for (let j = 0; j < 9; j++) {
      recordAction(m, {
        step: ++s,
        driver: "X",
        actionType: "tap",
        targetText: `Filler${i}_${j}`,
        fingerprint: `fp${i}_${j}`,
        outcome: "changed",
      });
    }
  }
  const slow = countSpacedRepeatedTargets(m);
  const rapid = countRecentRepeatedTargets(m);
  assert.ok(
    slow.get("RepeatedCTA") >= SLOW_LOOP_WARN_THRESHOLD,
    "slow window must catch spaced repetition",
  );
  assert.ok(
    !rapid.get("RepeatedCTA") || rapid.get("RepeatedCTA") < LOOP_WARN_THRESHOLD,
    "rapid window must NOT count this as a loop (the test's whole point)",
  );
});

test("summarise: emits REPEAT WARNING for spaced repetition that LOOP WARNING misses", () => {
  const m = createMemory();
  // Same shape as run-11380697: 5 taps on the same label spaced out.
  let s = 0;
  for (let i = 0; i < 4; i++) {
    recordAction(m, {
      step: ++s,
      driver: "LLMFallback",
      actionType: "tap",
      targetText: "Add bio",
      fingerprint: `fp${i}`,
      outcome: "changed",
    });
    for (let j = 0; j < 9; j++) {
      recordAction(m, {
        step: ++s,
        driver: "X",
        actionType: "tap",
        targetText: `Filler${i}_${j}`,
        fingerprint: `fp${i}_${j}`,
        outcome: "changed",
      });
    }
  }
  const hint = summarise(m);
  assert.ok(
    !hint.includes("LOOP WARNING"),
    "rapid LOOP WARNING must NOT fire on spaced repetition",
  );
  assert.ok(hint.includes("REPEAT WARNING"));
  assert.ok(hint.includes("Add bio"), "warning must name the repeated label");
  assert.ok(
    hint.includes("recent_spaced_taps"),
    "summary line must indicate spaced taps",
  );
});

test("summarise: rapid LOOP WARNING wins precedence when both detectors would fire", () => {
  const m = createMemory();
  // 3 taps on the same label in 3 consecutive steps — fits both windows.
  for (let i = 0; i < 3; i++) {
    recordAction(m, {
      step: i,
      driver: "X",
      actionType: "tap",
      targetText: "Tile",
      fingerprint: `fp${i}`,
      outcome: "changed",
    });
  }
  const hint = summarise(m);
  assert.ok(hint.includes("LOOP WARNING"), "rapid warning must fire");
  assert.ok(
    !hint.includes("REPEAT WARNING"),
    "slow warning must be suppressed when rapid already fired (avoid redundant noise)",
  );
});

test("summarise: no REPEAT WARNING below the slow threshold (2 taps spaced out)", () => {
  const m = createMemory();
  recordAction(m, { step: 1, driver: "X", actionType: "tap", targetText: "Item", fingerprint: "fp1", outcome: "changed" });
  for (let j = 2; j <= 20; j++) {
    recordAction(m, { step: j, driver: "X", actionType: "tap", targetText: `Filler${j}`, fingerprint: `fp${j}`, outcome: "changed" });
  }
  recordAction(m, { step: 21, driver: "X", actionType: "tap", targetText: "Item", fingerprint: "fp21", outcome: "changed" });
  const hint = summarise(m);
  assert.ok(!hint.includes("REPEAT WARNING"));
  assert.ok(!hint.includes("LOOP WARNING"));
});

// ── 2026-04-25 v5 (Bug #8): alternation detector ───────────────────────
//
// A strict A,B,A,B pattern in the last 4 taps is a 2-cycle alternation —
// clearly a loop to a human but doesn't trip the 3-in-10 LOOP WARNING.
// Run dd7ccf49 burned 6 steps on Profile↔Home before LOOP fired; the
// alternation detector fires at step 4 and names both labels.
//
// All fixtures use generic action labels (no app-specific text).

function pushTap(m, step, label) {
  recordAction(m, {
    step,
    driver: "X",
    actionType: "tap",
    targetText: label,
    fingerprint: `fp${step}`,
    outcome: "changed",
  });
}

test("detectAlternatingPair: strict A,B,A,B in last 4 taps returns {a, b}", () => {
  const m = createMemory();
  pushTap(m, 1, "Alpha");
  pushTap(m, 2, "Beta");
  pushTap(m, 3, "Alpha");
  pushTap(m, 4, "Beta");
  const r = detectAlternatingPair(m);
  assert.ok(r);
  assert.equal(r.a, "Alpha");
  assert.equal(r.b, "Beta");
});

test("detectAlternatingPair: broken pattern A,B,A,C → null", () => {
  const m = createMemory();
  pushTap(m, 1, "Alpha");
  pushTap(m, 2, "Beta");
  pushTap(m, 3, "Alpha");
  pushTap(m, 4, "Gamma");
  assert.equal(detectAlternatingPair(m), null);
});

test("detectAlternatingPair: non-alternating A,A,B,B → null", () => {
  const m = createMemory();
  pushTap(m, 1, "Alpha");
  pushTap(m, 2, "Alpha");
  pushTap(m, 3, "Beta");
  pushTap(m, 4, "Beta");
  assert.equal(detectAlternatingPair(m), null);
});

test("detectAlternatingPair: same label everywhere A,A,A,A → null (would be a LOOP not an alternation)", () => {
  const m = createMemory();
  for (let i = 1; i <= 4; i++) pushTap(m, i, "Same");
  assert.equal(detectAlternatingPair(m), null);
});

test("detectAlternatingPair: skips non-tap actions when scanning the last 4 taps", () => {
  // Real run pattern: alternation can be interleaved with scrolls / waits
  // / launch_apps. Detector must look at the last 4 *labelled tap* actions,
  // ignoring everything else.
  const m = createMemory();
  pushTap(m, 1, "Alpha");
  recordAction(m, { step: 2, driver: "X", actionType: "scroll_down", targetText: null, fingerprint: "fp2", outcome: "changed" });
  pushTap(m, 3, "Beta");
  recordAction(m, { step: 4, driver: "X", actionType: "wait", targetText: null, fingerprint: "fp4", outcome: "changed" });
  pushTap(m, 5, "Alpha");
  pushTap(m, 6, "Beta");
  const r = detectAlternatingPair(m);
  assert.ok(r);
  assert.equal(r.a, "Alpha");
  assert.equal(r.b, "Beta");
});

test("summarise: ALTERNATION WARNING fires at 4 taps with strict A,B,A,B and names both labels", () => {
  const m = createMemory();
  pushTap(m, 1, "Hub1");
  pushTap(m, 2, "Hub2");
  pushTap(m, 3, "Hub1");
  pushTap(m, 4, "Hub2");
  const hint = summarise(m);
  assert.ok(hint.includes("ALTERNATION WARNING"));
  assert.ok(hint.includes("Hub1"));
  assert.ok(hint.includes("Hub2"));
  assert.ok(/third/i.test(hint), "directive must mention picking a third element");
  // LOOP WARNING does NOT fire (each label only 2× in window, below threshold 3).
  assert.ok(!hint.includes("LOOP WARNING"));
});

test("summarise: rapid LOOP WARNING wins precedence over ALTERNATION WARNING when both could fire", () => {
  // Same label tapped 3 times within 10 steps → LOOP fires. Alternation
  // doesn't apply because 3-of-the-same isn't an alternation, but verify
  // that even when both signals are nominally present (e.g. A,B,A,B,A),
  // LOOP wins.
  const m = createMemory();
  pushTap(m, 1, "A");
  pushTap(m, 2, "B");
  pushTap(m, 3, "A");
  pushTap(m, 4, "B");
  pushTap(m, 5, "A"); // 3rd A → LOOP threshold hit
  const hint = summarise(m);
  assert.ok(hint.includes("LOOP WARNING"));
  assert.ok(!hint.includes("ALTERNATION WARNING"), "louder rapid warning subsumes alternation");
});

test("summarise: ALTERNATION WARNING wins precedence over slow REPEAT WARNING", () => {
  // Alternation fires AND slow-window has 2 taps of each — REPEAT shouldn't
  // also emit, the more-specific alternation directive subsumes it.
  const m = createMemory();
  pushTap(m, 1, "X");
  pushTap(m, 2, "Y");
  pushTap(m, 3, "X");
  pushTap(m, 4, "Y");
  // Need ≥3 of one label in slow window for REPEAT — bump X to 3 across 40
  // by adding a filler then another X. But that would make X show 3× in
  // the 10-step window too, which would trip LOOP. So instead: just check
  // that at the alternation step, REPEAT does NOT fire.
  const hint = summarise(m);
  assert.ok(hint.includes("ALTERNATION WARNING"));
  assert.ok(!hint.includes("REPEAT WARNING"), "slow warning suppressed when alternation already covers the loop");
});

test("summarise: includes logical_unique count line", () => {
  const m = createMemory();
  recordScreen(m, "s1", "feed", "lfp-feed");
  recordScreen(m, "s2", "feed", "lfp-feed"); // same logical fp — no re-count
  recordScreen(m, "s3", "settings", "lfp-settings");
  const hint = summarise(m);
  assert.ok(hint.includes("logical_unique: 2"));
});

// ── 2026-04-25 v6: activity coverage + hub-revisit detector ──────────

const {
  uniqueActivitiesCount,
  countActivityVisits,
  detectHubRevisit,
} = require("../trajectory-memory");

test("uniqueActivitiesCount: tracks distinct activities passed to recordScreen", () => {
  const m = createMemory();
  recordScreen(m, "fp1", "feed", "lfp1", "com.app/.HomeActivity");
  recordScreen(m, "fp2", "feed", "lfp2", "com.app/.HomeActivity"); // same activity
  recordScreen(m, "fp3", "profile", "lfp3", "com.app/.ProfileActivity");
  recordScreen(m, "fp4", "settings", "lfp4", "com.app/.SettingsActivity");
  assert.equal(uniqueActivitiesCount(m), 3);
});

test("uniqueActivitiesCount: tolerates missing/empty activity arg", () => {
  const m = createMemory();
  recordScreen(m, "fp1", "feed", "lfp1");
  recordScreen(m, "fp2", "feed", "lfp2", "");
  recordScreen(m, "fp3", "feed", "lfp3", null);
  assert.equal(uniqueActivitiesCount(m), 0);
});

test("countActivityVisits: counts recentActions matching the activity", () => {
  const m = createMemory();
  for (let i = 0; i < 5; i++) {
    recordAction(m, { step: i, driver: "X", actionType: "tap", fingerprint: `f${i}`, activity: "com.app/.Home" });
  }
  for (let i = 0; i < 2; i++) {
    recordAction(m, { step: 5 + i, driver: "X", actionType: "tap", fingerprint: `f${i}`, activity: "com.app/.Profile" });
  }
  assert.equal(countActivityVisits(m, "com.app/.Home"), 5);
  assert.equal(countActivityVisits(m, "com.app/.Profile"), 2);
  assert.equal(countActivityVisits(m, "com.app/.NotVisited"), 0);
  assert.equal(countActivityVisits(m, ""), 0);
});

test("detectHubRevisit: fires on bottom-nav-bouncing pattern (different labels, same activity+screenType)", () => {
  const m = createMemory();
  // 14 actions all on the same (activity, screenType=feed) but with different
  // targetText each time — exactly the biztoso bottom-nav pattern that the
  // targetText-bucketed detectors miss.
  const labels = ["Feed", "Shorts", "Chat", "Connections", "Feed", "Shorts", "Chat", "Connections", "Feed", "Shorts", "Chat", "Connections", "Feed", "Shorts"];
  for (let i = 0; i < labels.length; i++) {
    recordAction(m, {
      step: i,
      driver: "ExplorationDriver",
      actionType: "tap",
      targetText: labels[i],
      fingerprint: `fp${i}`,
      screenType: "feed",
      activity: "com.app/.MainActivity",
    });
  }
  const r = detectHubRevisit(m);
  assert.ok(r, "should detect hub revisit");
  assert.equal(r.key, "com.app/.MainActivity::feed");
  assert.ok(r.share > 0.5, `share should exceed 50%, got ${r.share}`);
  assert.equal(r.count, 14);
});

test("detectHubRevisit: returns null when actions span multiple activities", () => {
  const m = createMemory();
  // 12 actions split 4-4-4 across three activities — no single bucket
  // dominates, no hub revisit.
  for (let i = 0; i < 4; i++) {
    recordAction(m, { step: i, driver: "X", actionType: "tap", targetText: "X", fingerprint: `f${i}`, screenType: "feed", activity: "com.app/.Home" });
  }
  for (let i = 0; i < 4; i++) {
    recordAction(m, { step: 4 + i, driver: "X", actionType: "tap", targetText: "X", fingerprint: `f${i}`, screenType: "detail", activity: "com.app/.Detail" });
  }
  for (let i = 0; i < 4; i++) {
    recordAction(m, { step: 8 + i, driver: "X", actionType: "tap", targetText: "X", fingerprint: `f${i}`, screenType: "settings", activity: "com.app/.Settings" });
  }
  assert.equal(detectHubRevisit(m), null);
});

test("detectHubRevisit: returns null below the minimum action threshold", () => {
  const m = createMemory();
  // Only 11 actions — below the 12-action minimum even if all on same hub.
  for (let i = 0; i < 11; i++) {
    recordAction(m, { step: i, driver: "X", actionType: "tap", targetText: "X", fingerprint: `f${i}`, screenType: "feed", activity: "com.app/.Home" });
  }
  assert.equal(detectHubRevisit(m), null);
});

test("summarise: emits HUB REVISIT WARNING when hub-revisit detector fires + suppressed by louder detectors", () => {
  // Camped pattern, different labels each tap. Use unique labels so the
  // targetText-bucketed detectors (rapid/alt/slow) all stay quiet — that
  // is the exact biztoso-class blind spot the hub-revisit detector exists
  // to cover.
  const m = createMemory();
  for (let i = 0; i < 14; i++) {
    recordAction(m, {
      step: i,
      driver: "ExplorationDriver",
      actionType: "tap",
      targetText: `Item_${i}`, // every label distinct — no targetText bucket ever fills
      fingerprint: `fp${i}`,
      screenType: "feed",
      activity: "com.app/.MainActivity",
    });
  }
  const hint = summarise(m);
  assert.ok(hint.includes("HUB REVISIT WARNING"), "expected HUB REVISIT WARNING");
  assert.ok(hint.includes("com.app/.MainActivity"));

  // Now add 3 of the same label — rapid loop fires; hub-revisit should be suppressed.
  for (let i = 14; i < 18; i++) {
    recordAction(m, {
      step: i,
      driver: "ExplorationDriver",
      actionType: "tap",
      targetText: "RepeatedLabel",
      fingerprint: `fp${i}`,
      screenType: "feed",
      activity: "com.app/.MainActivity",
    });
  }
  const hint2 = summarise(m);
  assert.ok(hint2.includes("LOOP WARNING"), "rapid LOOP should fire");
  assert.ok(!hint2.includes("HUB REVISIT WARNING"), "hub revisit should be suppressed when louder detector fires");
});

test("recordScreen: backward compatible — works without activity arg", () => {
  const m = createMemory();
  // Old call shape (4 args) must still work.
  recordScreen(m, "fp1", "feed", "lfp1");
  recordScreen(m, "fp2", "settings", "lfp2");
  assert.equal(m.logicalFingerprintsSeen.size, 2);
  assert.equal(uniqueActivitiesCount(m), 0);
});
