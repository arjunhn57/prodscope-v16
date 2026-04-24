"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createMemory,
  recordScreen,
  recordAction,
  summarise,
  coverageRatio,
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
