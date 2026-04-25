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

/** Cap on recent action history — must be ≥ SLOW_LOOP_WINDOW_STEPS so the
 *  longer-window slow-loop detector can scan a full window. */
const RECENT_ACTIONS_CAP = 44;

/**
 * Phase 4 (2026-04-25): well-known nav / hub labels — kept for the legacy
 * `countRecentHubTaps` helper, no longer used by `summarise`. Hub-keyword
 * matching is fundamentally fragile: any app rendering a hub element with a
 * personalized label (user's name, email, dynamic count badge, localized
 * text) bypasses it. The detector now buckets by raw targetText (see
 * `countRecentRepeatedTargets`) so loops are caught regardless of label.
 */
const HUB_LABEL_PATTERNS = [
  /\bhome\b/i,
  /\bprofile\b/i,
  /\bsettings?\b/i,
  /\bsearch\b/i,
  /\bnotifications?\b/i,
  /\binbox\b/i,
  /\bchat\b/i,
  /\bmessages?\b/i,
  /\bfeed\b/i,
  /\bdiscover\b/i,
  /\bexplore\b/i,
  /\bshorts?\b/i,
  /\bconnections?\b/i,
  /\bback\b/i,
];

/** Rapid-bounce window — short window catches tight ping-pong loops. */
const LOOP_WINDOW_STEPS = 10;
/** Number of taps on the same target within the rapid window before we warn. */
const LOOP_WARN_THRESHOLD = 3;

/**
 * Slow-loop window — longer window catches spaced repetition. Run 11380697
 * tapped "Add a bio to introduce yourself" 5× across 41 steps; never 3 in
 * any 10-step window so the rapid-bounce LOOP WARNING never fired. The
 * slow-loop counter scans 40 steps with the same threshold (3) and emits
 * a milder REPEAT WARNING so the LLM sees the spaced repetition.
 */
const SLOW_LOOP_WINDOW_STEPS = 40;
/** Number of taps on the same target across the slow window before we warn. */
const SLOW_LOOP_WARN_THRESHOLD = 3;

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
 *
 *   2026-04-25 v2: keyed on LOGICAL fp, not structural. Structural fp
 *   churns when feed / list / timeline content rotates between visits,
 *   so a structurally-keyed map revived its frontier on every revisit
 *   and let bounce-loops persist. Logical fp is position- and content-
 *   insensitive — the same screen across content variance maps to the
 *   same key, so once an edge is tapped it stays tapped on revisits.
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
    // Phase 4: position- and content-insensitive unique-screen count.
    // User-facing `uniqueScreens` metric should reflect THIS, not
    // fingerprintsSeen which inflates on scroll-position drift.
    logicalFingerprintsSeen: new Set(),
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
 * Phase 4: `logicalFingerprint` is the primary coverage key. When provided,
 * `seenTypeCounts` and hub visited-tracking are indexed on it (not the
 * structural fp) so Home@scroll-0 and Home@scroll-500 count as ONE screen.
 *
 * @param {TrajectoryMemory} memory
 * @param {string} fingerprint            Structural fp (backwards-compat)
 * @param {string} screenType
 * @param {string} [logicalFingerprint]   Phase 4 — position-insensitive fp
 */
function recordScreen(memory, fingerprint, screenType, logicalFingerprint) {
  if (!memory || !fingerprint || !screenType) return;

  // Structural fp tracking (backwards-compat — drivers still use this).
  if (!memory.fingerprintsSeen.has(fingerprint)) {
    memory.fingerprintsSeen.add(fingerprint);
  }

  // Logical fp is the primary coverage key. First time we see the
  // logical fp is when we count the screen for coverage.
  if (!memory.logicalFingerprintsSeen) memory.logicalFingerprintsSeen = new Set();
  const effectiveLogical = logicalFingerprint || fingerprint;
  if (memory.logicalFingerprintsSeen.has(effectiveLogical)) return;
  memory.logicalFingerprintsSeen.add(effectiveLogical);

  memory.seenTypeCounts[screenType] = (memory.seenTypeCounts[screenType] || 0) + 1;
  memory.hubsRemaining.delete(screenType);
}

/**
 * Phase 4: how many unique (logical) screens have we covered? This is
 * the honest user-facing metric — no position-drift inflation.
 *
 * @param {TrajectoryMemory} memory
 * @returns {number}
 */
function uniqueLogicalScreensCount(memory) {
  if (!memory || !memory.logicalFingerprintsSeen) return 0;
  return memory.logicalFingerprintsSeen.size;
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
  parts.push(`logical_unique: ${uniqueLogicalScreensCount(memory)}`);
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

  // 2026-04-25 v3: causal anti-drift directive. The drift-recovery block
  // in v17/agent-loop records a synthetic launch_app entry with outcome
  // "drift_recovery_after_<action>" whenever it had to relaunch the
  // target package. If the most recent ≤2 entries include such a recovery,
  // the prior action just exited the app — emit a directive so the next
  // decision doesn't repeat it. App-agnostic: works for any action that
  // drifts (press_back, an external intent tap, a deep-link, etc.).
  const driftDirective = buildDriftDirective(memory);
  if (driftDirective) parts.push(driftDirective);

  // Phase 4 (2026-04-25 v2): anti-loop pressure. Count recent taps on the
  // SAME targetText regardless of whether the label matches a hub keyword.
  // Hub-keyword filtering missed loops on personalized labels (the user's
  // own email rendered as a profile card, "Hi, Arjun" greetings, dynamic
  // count badges, localized hub text). We now bucket by raw targetText so
  // any element tapped LOOP_WARN_THRESHOLD+ times in LOOP_WINDOW_STEPS
  // surfaces as a loop — generalised, no keyword list to maintain.
  let rapidBounceFired = false;
  const repeatedTaps = countRecentRepeatedTargets(memory);
  if (repeatedTaps.size > 0) {
    // Only surface entries that hit the threshold — single-tap labels would
    // dominate the line otherwise and dilute the signal.
    const overThreshold = Array.from(repeatedTaps.entries())
      .filter(([, count]) => count >= LOOP_WARN_THRESHOLD)
      .sort((a, b) => b[1] - a[1]);
    if (overThreshold.length > 0) {
      rapidBounceFired = true;
      const summary = overThreshold
        .map(([label, count]) => `${label}×${count}`)
        .join(", ");
      parts.push(`recent_repeated_taps: ${summary} in last ${LOOP_WINDOW_STEPS} steps`);
      const loopedLabels = overThreshold
        .map(([label]) => `"${label}"`)
        .join(" and ");
      const remainingHubs =
        memory.hubsRemaining.size > 0
          ? ` Unvisited hubs: ${Array.from(memory.hubsRemaining).join(", ")}.`
          : "";
      parts.push(
        `LOOP WARNING: You have been repeatedly tapping ${loopedLabels}. ` +
          `Do NOT tap ${loopedLabels} next. ` +
          `Try a list item, a drawer, a detail row, a "More"/overflow menu, ` +
          `edge_swipe_back, or a previously-untapped element — even if you are ` +
          `not certain where it leads.${remainingHubs}`,
      );
    }
  }

  // 2026-04-25 v5 (Bug #8): alternation detector. A strict A,B,A,B
  // pattern (4 taps, 2 of each) is a clear loop but doesn't trip the
  // 3-in-10 rapid LOOP WARNING. Fires at step 4 vs step 6 and names
  // both labels so the LLM sees the joint pattern. Precedence: rapid
  // LOOP WARNING wins if it already fired (it's louder and covers the
  // 3-in-10 case which subsumes alternation at high counts); otherwise
  // alternation fires here, before the slow REPEAT WARNING below.
  let alternationFired = false;
  if (!rapidBounceFired) {
    const alt = detectAlternatingPair(memory);
    if (alt) {
      alternationFired = true;
      parts.push(`alternation_detected: "${alt.a}" ↔ "${alt.b}" in last 4 taps`);
      parts.push(
        "ALTERNATION WARNING: You are bouncing between \"" + alt.a + "\" " +
          "and \"" + alt.b + "\". These two together aren't producing new " +
          "screens — pick a THIRD different element (a list item, a drawer, " +
          "a detail row, an unvisited hub) before tapping either one again.",
      );
    }
  }

  // 2026-04-25 v4: slow-loop pressure. Same bucketing as above but with a
  // wider window (40 vs 10) to catch spaced repetition like the run-11380697
  // pattern: 5 taps on the same CTA across 41 steps that the rapid-bounce
  // detector missed. Suppressed when LOOP WARNING or ALTERNATION already
  // fired — the louder/more-specific directives subsume the milder slow one.
  if (!rapidBounceFired && !alternationFired) {
    const spacedTaps = countSpacedRepeatedTargets(memory);
    if (spacedTaps.size > 0) {
      const overSlow = Array.from(spacedTaps.entries())
        .filter(([, count]) => count >= SLOW_LOOP_WARN_THRESHOLD)
        .sort((a, b) => b[1] - a[1]);
      if (overSlow.length > 0) {
        const summary = overSlow
          .map(([label, count]) => `${label}×${count}`)
          .join(", ");
        parts.push(
          `recent_spaced_taps: ${summary} in last ${SLOW_LOOP_WINDOW_STEPS} steps`,
        );
        const repeatLabels = overSlow.map(([label]) => `"${label}"`).join(" and ");
        parts.push(
          "REPEAT WARNING: You keep returning to " + repeatLabels + " every " +
            "few steps without finding new screens through it. Pick a " +
            "different list item or hub instead — re-entering the same " +
            "element across a long horizon usually means it leads back to " +
            "where you already were.",
        );
      }
    }
  }

  return parts.join("\n").slice(0, 1600);
}

/**
 * 2026-04-25 v3: build the causal anti-drift directive for summarise.
 * Looks at the last few recentActions entries; if any has an outcome
 * of "drift_recovery_after_<action>", the named action just caused
 * the app to exit. Emit a one-line directive telling the LLM not to
 * repeat that action from the current screen. Returns null if no recent
 * recovery is in scope.
 *
 * Window: last 2 entries. Tighter than LOOP_WINDOW_STEPS because the
 * causal signal only matters relative to the immediately preceding
 * decision — older recoveries are stale.
 *
 * @param {TrajectoryMemory} memory
 * @returns {string|null}
 */
function buildDriftDirective(memory) {
  if (!memory || !Array.isArray(memory.recentActions)) return null;
  const recent = memory.recentActions.slice(-2);
  for (const a of recent) {
    if (!a || typeof a.outcome !== "string") continue;
    const m = /^drift_recovery_after_(.+)$/.exec(a.outcome);
    if (!m) continue;
    const causing = m[1];
    return (
      "DRIFT WARNING: the previous " + causing + " caused the target app to " +
      "exit and required a forced relaunch. Do NOT issue " + causing + " " +
      "again from this screen — it has no back-stack from here. Pick a " +
      "different action: tap a list item, a navigation hub, or an " +
      "unvisited element."
    );
  }
  return null;
}

/**
 * Detect a strict A,B,A,B alternation in the last 4 tap actions. Returns
 * `{ a, b }` if the pattern matches with `A !== B` and both non-empty;
 * null otherwise.
 *
 * 2026-04-25 v5 (Bug #8): a 2-cycle alternation (4 taps total, only 2 of
 * each label) is a clear loop to a human but doesn't trip the rapid
 * LOOP WARNING (3 of the same in 10). Run dd7ccf49 burned 6 steps on
 * Profile↔Home before LOOP fired. Detecting alternation explicitly
 * fires at step 4 instead, naming both labels so the LLM sees the joint
 * pattern and is told to pick a third element.
 *
 * Window: last 4 *tap* actions only. Non-tap actions (wait, scroll,
 * launch_app) and null-label taps are filtered out before counting, so
 * an interleaved scroll between two A-B-A-B taps doesn't break the
 * detection.
 *
 * @param {TrajectoryMemory} memory
 * @returns {{a: string, b: string}|null}
 */
function detectAlternatingPair(memory) {
  if (!memory || !Array.isArray(memory.recentActions)) return null;
  const labelledTaps = memory.recentActions
    .filter((a) => a && a.actionType === "tap" && typeof a.targetText === "string" && a.targetText.trim().length > 0)
    .slice(-4)
    .map((a) => a.targetText.trim());
  if (labelledTaps.length < 4) return null;
  const [w, x, y, z] = labelledTaps;
  if (w === x) return null; // Need two distinct labels
  if (w !== y) return null; // First and third must match
  if (x !== z) return null; // Second and fourth must match
  return { a: w, b: x };
}

/**
 * Slow-loop variant of countRecentRepeatedTargets — same bucketing but a
 * wider window so spaced repetition surfaces (2026-04-25 v4). Run 11380697
 * tapped one CTA at steps 38, 42, 56, 64, 79 — the rapid-bounce window
 * (10 steps) only ever saw ≤2 of those at once. The slow window (40)
 * sees ≥3 at any of steps 56+, so REPEAT WARNING fires there.
 *
 * @param {TrajectoryMemory} memory
 * @returns {Map<string, number>}
 */
function countSpacedRepeatedTargets(memory) {
  const out = new Map();
  if (!memory || !Array.isArray(memory.recentActions)) return out;
  const recent = memory.recentActions.slice(-SLOW_LOOP_WINDOW_STEPS);
  for (const a of recent) {
    if (!a || a.actionType !== "tap") continue;
    const label = typeof a.targetText === "string" ? a.targetText.trim() : "";
    if (!label) continue;
    out.set(label, (out.get(label) || 0) + 1);
  }
  return out;
}

/**
 * Bucket recent tap actions by targetText, ignoring nulls/empties. Returns
 * Map<label, count> over the last LOOP_WINDOW_STEPS actions. No keyword
 * filter — any repeated label surfaces. This is the primary loop detector
 * (2026-04-25 v2).
 *
 * Why no keyword filter: hub-bounce loops can involve any clickable a
 * model is biased to revisit, including elements with personalized labels
 * (user's name/email on a profile card, "Hi, Arjun", dynamic count
 * badges) or localized labels in non-English apps. Keyword matching
 * silently misses these; raw-label bucketing catches them.
 *
 * @param {TrajectoryMemory} memory
 * @returns {Map<string, number>}
 */
function countRecentRepeatedTargets(memory) {
  const out = new Map();
  if (!memory || !Array.isArray(memory.recentActions)) return out;
  const recent = memory.recentActions.slice(-LOOP_WINDOW_STEPS);
  for (const a of recent) {
    if (!a || a.actionType !== "tap") continue;
    const label = typeof a.targetText === "string" ? a.targetText.trim() : "";
    if (!label) continue;
    out.set(label, (out.get(label) || 0) + 1);
  }
  return out;
}

/**
 * @deprecated Use countRecentRepeatedTargets. Kept exported for callers
 * (and tests) that haven't migrated yet. Same window/threshold semantics
 * but only counts labels matching HUB_LABEL_PATTERNS.
 *
 * @param {TrajectoryMemory} memory
 * @returns {Map<string, number>}
 */
function countRecentHubTaps(memory) {
  const out = new Map();
  if (!memory || !Array.isArray(memory.recentActions)) return out;
  const recent = memory.recentActions.slice(-LOOP_WINDOW_STEPS);
  for (const a of recent) {
    if (!a || a.actionType !== "tap") continue;
    const label = typeof a.targetText === "string" ? a.targetText.trim() : "";
    if (!label) continue;
    let matched = null;
    for (const re of HUB_LABEL_PATTERNS) {
      if (re.test(label)) {
        matched = label;
        break;
      }
    }
    if (!matched) continue;
    out.set(matched, (out.get(matched) || 0) + 1);
  }
  return out;
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
  // Phase 4 (logical fp + anti-loop):
  uniqueLogicalScreensCount,
  countRecentRepeatedTargets,
  countSpacedRepeatedTargets,
  detectAlternatingPair,
  countRecentHubTaps,
  HUB_LABEL_PATTERNS,
  LOOP_WINDOW_STEPS,
  LOOP_WARN_THRESHOLD,
  SLOW_LOOP_WINDOW_STEPS,
  SLOW_LOOP_WARN_THRESHOLD,
  DEFAULT_HUBS,
  RECENT_ACTIONS_CAP,
};
