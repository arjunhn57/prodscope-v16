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
 * @property {Map<string, Set<string>>} tappedEdgesByFp
 *   Phase 3 graph-exploration state: per fp, the set of elementKeys
 *   we've tapped. `ExplorationDriver` and `LLMFallback` use this to
 *   prefer untapped clickables (frontier) on a revisited screen.
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
    tappedEdgesByFp: new Map(),
  };
}

// ── Graph exploration (Phase 3, 2026-04-25) ─────────────────────────────
//
// Formalise the crawl as graph traversal: fp = node, clickable = edge,
// tapped = visited edge. Helpers below manage the per-fp edge state so
// drivers and LLMFallback can prefer untapped clickables on revisited
// screens, and emit press_back when a screen's frontier is empty.

/**
 * Compute a stable element key for a clickable — mirrors the key scheme
 * used by `v17/drivers/exploration-driver.js:elementKey` / `listItemKey`
 * so a driver and the trajectory agree on identity.
 *
 * Order: resourceId first; then label+bounds bucket; bare bounds bucket
 * as last resort.
 *
 * @param {{resourceId?:string, label?:string, cx?:number, cy?:number, bounds?:{x1:number,y1:number,x2:number,y2:number}}} c
 * @returns {string}
 */
function elementKey(c) {
  if (!c || typeof c !== "object") return "";
  const rid = typeof c.resourceId === "string" ? c.resourceId : "";
  const label = typeof c.label === "string" ? c.label : "";
  const cx = typeof c.cx === "number" ? c.cx : (c.bounds ? (c.bounds.x1 + c.bounds.x2) / 2 : 0);
  const cy = typeof c.cy === "number" ? c.cy : (c.bounds ? (c.bounds.y1 + c.bounds.y2) / 2 : 0);
  const bx = Math.floor(cx / 32);
  const by = Math.floor(cy / 32);
  // If rid+label are both distinctive, use both — catches homogeneous-rid
  // feeds (com.app:id/feed_item × 5) where label differentiates cards.
  if (rid && label) return `rid:${rid}|lbl:${label}`;
  if (rid) return `rid:${rid}|bb:${bx},${by}`;
  if (label) return `bb:${label}:${bx},${by}`;
  return `bb::${bx},${by}`;
}

/**
 * Record that we tapped a clickable element while on a particular fp.
 * Idempotent — re-tapping on the same fp is a no-op on the set.
 *
 * @param {TrajectoryMemory} memory
 * @param {string} fp
 * @param {object} element
 */
function recordTap(memory, fp, element) {
  if (!memory || !fp || !element) return;
  if (!memory.tappedEdgesByFp) memory.tappedEdgesByFp = new Map();
  const key = elementKey(element);
  if (!key) return;
  let edges = memory.tappedEdgesByFp.get(fp);
  if (!edges) {
    edges = new Set();
    memory.tappedEdgesByFp.set(fp, edges);
  }
  edges.add(key);
}

/**
 * Has this element been tapped on this fp already?
 *
 * @param {TrajectoryMemory} memory
 * @param {string} fp
 * @param {object} element
 * @returns {boolean}
 */
function isTapped(memory, fp, element) {
  if (!memory || !memory.tappedEdgesByFp || !fp || !element) return false;
  const edges = memory.tappedEdgesByFp.get(fp);
  if (!edges || edges.size === 0) return false;
  return edges.has(elementKey(element));
}

/**
 * Return the untapped clickables on the current fp (the frontier).
 * Preserves input order so callers can keep their own priority ranking.
 *
 * @param {TrajectoryMemory} memory
 * @param {string} fp
 * @param {object[]} clickables
 * @returns {object[]}
 */
function untappedClickables(memory, fp, clickables) {
  if (!Array.isArray(clickables) || clickables.length === 0) return [];
  if (!memory || !memory.tappedEdgesByFp) return clickables.slice();
  const edges = memory.tappedEdgesByFp.get(fp);
  if (!edges || edges.size === 0) return clickables.slice();
  return clickables.filter((c) => !edges.has(elementKey(c)));
}

/**
 * Labels of elements already tapped on this fp — used for prompt hints.
 *
 * @param {TrajectoryMemory} memory
 * @param {string} fp
 * @param {object[]} [clickables]  If provided, returns labels of tapped
 *   clickables in current observation order; else returns raw keys.
 * @returns {string[]}
 */
function tappedLabelsOnFp(memory, fp, clickables) {
  if (!memory || !memory.tappedEdgesByFp || !fp) return [];
  const edges = memory.tappedEdgesByFp.get(fp);
  if (!edges || edges.size === 0) return [];
  if (Array.isArray(clickables)) {
    const out = [];
    for (const c of clickables) {
      if (edges.has(elementKey(c))) {
        const label = (c && c.label) || (c && c.resourceId) || "";
        if (label) out.push(label);
      }
    }
    return out;
  }
  return Array.from(edges);
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
function summarise(memory, opts) {
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

  // Phase 3: per-fp frontier state for graph exploration. Only emitted
  // when the caller passes the current fp + clickables (dispatcher /
  // llm-fallback have this context).
  if (opts && opts.currentFp && Array.isArray(opts.currentClickables)) {
    const fp = opts.currentFp;
    const clickables = opts.currentClickables;
    const tapped = tappedLabelsOnFp(memory, fp, clickables);
    const untapped = untappedClickables(memory, fp, clickables);
    if (tapped.length > 0) {
      const short = tapped
        .slice(0, 10)
        .map((l) => `"${truncate(l, 24)}"`)
        .join(", ");
      parts.push(`tapped_on_this_screen: [${short}]`);
    }
    parts.push(`untapped_on_this_screen: ${untapped.length}`);
  }

  return parts.join("\n").slice(0, 1400);
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
  // Phase 3 (graph exploration):
  elementKey,
  recordTap,
  isTapped,
  untappedClickables,
  tappedLabelsOnFp,
  DEFAULT_HUBS,
  RECENT_ACTIONS_CAP,
};
