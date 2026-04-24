"use strict";

/**
 * v18/trajectory-memory.js
 *
 * In-run coverage state. Tracks which screen types we've already covered,
 * which hubs remain unexplored, and a short window of recent actions. The
 * classifier consumes `summarise()` as a compact (<300-token) trajectory
 * hint so Haiku can bias its plan toward under-covered sections.
 *
 * This is a pure state helper — no I/O, no Anthropic calls. The agent-loop
 * owns the single instance per run.
 */

/** Default hub catalogue — the "sections a typical app has". Used so the
 *  classifier can nudge toward any UNVISITED type. */
const DEFAULT_HUBS = [
  "feed",
  "search",
  "profile",
  "settings",
  "notifications",
  "compose",
  "detail",
];

/** Cap on recent action history — enough for the classifier to spot loops
 *  without blowing token budget. */
const RECENT_ACTIONS_CAP = 8;

/**
 * @typedef {Object} RecentAction
 * @property {number} step
 * @property {string} driver
 * @property {string} actionType
 * @property {string} [targetText]
 * @property {string} fingerprint
 * @property {string} [screenType]
 * @property {string} [outcome]     - "changed" | "no_change" | null
 *
 * @typedef {Object} TrajectoryMemory
 * @property {Object.<string, number>} seenTypeCounts
 * @property {Set<string>} fingerprintsSeen
 * @property {Set<string>} hubsRemaining
 * @property {RecentAction[]} recentActions
 */

/**
 * Create a fresh trajectory memory for a run.
 *
 * @returns {TrajectoryMemory}
 */
function createMemory() {
  return {
    seenTypeCounts: Object.create(null),
    fingerprintsSeen: new Set(),
    hubsRemaining: new Set(DEFAULT_HUBS),
    recentActions: [],
  };
}

/**
 * Record the fact that we observed a fingerprint with a given screen type.
 * Idempotent on fp — re-visits don't double-count.
 *
 * @param {TrajectoryMemory} memory
 * @param {string} fingerprint
 * @param {string} screenType
 */
function recordScreen(memory, fingerprint, screenType) {
  if (!memory || !fingerprint || !screenType) return;
  if (memory.fingerprintsSeen.has(fingerprint)) return;
  memory.fingerprintsSeen.add(fingerprint);
  memory.seenTypeCounts[screenType] = (memory.seenTypeCounts[screenType] || 0) + 1;
  memory.hubsRemaining.delete(screenType);
}

/**
 * Record an action taken. Keeps the last RECENT_ACTIONS_CAP entries.
 *
 * @param {TrajectoryMemory} memory
 * @param {RecentAction} entry
 */
function recordAction(memory, entry) {
  if (!memory || !entry) return;
  memory.recentActions.push(entry);
  if (memory.recentActions.length > RECENT_ACTIONS_CAP) {
    memory.recentActions.splice(0, memory.recentActions.length - RECENT_ACTIONS_CAP);
  }
}

/**
 * Produce a compact natural-language summary of the trajectory, for use as
 * a field in the classifier's input. Budget: ~200 tokens / ~1000 chars.
 *
 * @param {TrajectoryMemory} memory
 * @returns {string}
 */
function summarise(memory) {
  if (!memory) return "";
  const seenParts = Object.entries(memory.seenTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}×${count}`)
    .join(", ");
  const hubs =
    memory.hubsRemaining.size > 0 ? Array.from(memory.hubsRemaining).join(", ") : "(all hubs visited)";
  const recent = memory.recentActions
    .map((a) => `${a.step}:${a.driver}:${a.actionType}${a.targetText ? `(${truncate(a.targetText, 20)})` : ""}=${a.outcome || "?"}`)
    .join(" | ");
  const parts = [];
  if (seenParts) parts.push(`screens_seen: ${seenParts}`);
  parts.push(`hubs_remaining: ${hubs}`);
  if (recent) parts.push(`recent_actions: ${recent}`);
  return parts.join("\n").slice(0, 1000);
}

function truncate(s, n) {
  if (typeof s !== "string") return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Has the crawler covered enough of the expected hub types to consider the
 * map "wide enough to stop"? Simple heuristic — caller decides what to do.
 */
function coverageRatio(memory) {
  if (!memory) return 0;
  const total = DEFAULT_HUBS.length;
  const covered = total - memory.hubsRemaining.size;
  return covered / total;
}

module.exports = {
  createMemory,
  recordScreen,
  recordAction,
  summarise,
  coverageRatio,
  DEFAULT_HUBS,
  RECENT_ACTIONS_CAP,
};
