/**
 * graph.js — Visited-state graph with loop detection
 * Tracks every screen the crawler visits as a node (keyed by fingerprint)
 * and every action as a directed edge. Provides loop detection and
 * backtrack target computation.
 */

class StateGraph {
  constructor() {
    /** Map<fingerprint, { screenData, visitCount, triedActions: Set<string> }> */
    this.nodes = new Map();
    /** Array<{ from, action, to, timestamp }> */
    this.transitions = [];
    /** Ordered list of fingerprints visited (with repeats) */
    this.history = [];
    /** Map<fromFp, Map<actionKey, toFp>> — adjacency list for navigation */
    this.adjacency = new Map();
    /** Map<toFp, { fromFp, actionKey }> — first-discovery parent (for path reconstruction) */
    this.parentMap = new Map();
  }

  /**
   * Register a state. If already visited, increments visit count.
   * @param {string} fingerprint
   * @param {object} screenData - { screenshotPath, xml, activity, ... }
   */
  addState(fingerprint, screenData) {
    if (this.nodes.has(fingerprint)) {
      const node = this.nodes.get(fingerprint);
      node.visitCount++;
    } else {
      this.nodes.set(fingerprint, {
        screenData,
        visitCount: 1,
        triedActions: new Set(),
        ineffectiveActions: new Set(),
        actionOutcomes: new Map(),
      });
    }
    this.history.push(fingerprint);
  }

  /**
   * Record an action taken from one state leading to another.
   */
  addTransition(fromFingerprint, actionKey, toFingerprint) {
    this.transitions.push({
      from: fromFingerprint,
      action: actionKey,
      to: toFingerprint,
      timestamp: Date.now(),
    });

    // Mark this action as tried on the source state
    const node = this.nodes.get(fromFingerprint);
    if (node) node.triedActions.add(actionKey);

    // Auto-detect self-loops (tap did nothing) → mark action as ineffective
    if (fromFingerprint === toFingerprint) {
      if (node) {
        node.ineffectiveActions.add(actionKey);
        node.actionOutcomes.set(actionKey, 'ineffective');
      }
    }

    // Build adjacency and parentMap for non-self-loops
    if (fromFingerprint !== toFingerprint) {
      if (!this.adjacency.has(fromFingerprint)) {
        this.adjacency.set(fromFingerprint, new Map());
      }
      this.adjacency.get(fromFingerprint).set(actionKey, toFingerprint);

      // First discovery wins — only set parent if toFp is not already tracked
      if (!this.parentMap.has(toFingerprint)) {
        this.parentMap.set(toFingerprint, { fromFp: fromFingerprint, actionKey });
      }
    }
  }

  /**
   * Manually mark an action as ineffective on a given screen.
   */
  markIneffective(fingerprint, actionKey) {
    const node = this.nodes.get(fingerprint);
    if (node) node.ineffectiveActions.add(actionKey);
  }

  /**
   * Get the set of ineffective action keys for a given state.
   * These are actions that were tried but produced no screen change.
   */
  ineffectiveActionsFor(fingerprint) {
    const node = this.nodes.get(fingerprint);
    return node ? node.ineffectiveActions : new Set();
  }

  /**
   * Record the outcome of an action on a given screen.
   * @param {string} fingerprint
   * @param {string} actionKey
   * @param {string} outcome - 'ok' | 'ineffective' | 'out_of_app' | 'crash' | 'dead_end_1' | 'dead_end'
   */
  recordOutcome(fingerprint, actionKey, outcome) {
    const node = this.nodes.get(fingerprint);
    if (node) node.actionOutcomes.set(actionKey, outcome);
  }

  /**
   * Get the recorded outcome for a specific action on a screen.
   */
  getOutcome(fingerprint, actionKey) {
    const node = this.nodes.get(fingerprint);
    return node ? (node.actionOutcomes.get(actionKey) || null) : null;
  }

  /**
   * Get action keys with permanently bad outcomes (for filtering).
   * 'dead_end_1' is NOT filtered — allows one retry after relaunch.
   */
  badActionsFor(fingerprint) {
    const node = this.nodes.get(fingerprint);
    if (!node) return new Set();
    const bad = new Set();
    const permanent = ['ineffective', 'out_of_app', 'crash', 'dead_end'];
    for (const [key, outcome] of node.actionOutcomes) {
      if (permanent.includes(outcome)) bad.add(key);
    }
    return bad;
  }

  /**
   * Walk parentMap backwards from targetFp to the root node (no parent).
   * Returns array of { fp, actionKey } from root to target.
   * Returns null if targetFp is not in nodes.
   * Returns [{ fp: targetFp, actionKey: null }] for root (no parent).
   */
  getPathTo(targetFp) {
    if (!this.nodes.has(targetFp)) return null;

    const path = [];
    let current = targetFp;

    while (this.parentMap.has(current)) {
      const { fromFp, actionKey } = this.parentMap.get(current);
      path.push({ fp: current, actionKey });
      current = fromFp;
    }

    // current is now the root (no parent entry)
    path.push({ fp: current, actionKey: null });
    path.reverse();
    return path;
  }

  /**
   * Return nodes sorted by visitCount ascending (least visited first).
   * Excludes currentFp. Each result: { fp, visitCount, path }.
   * @param {string} currentFp - fingerprint to exclude
   * @param {number} limit - max results to return
   */
  getUnexploredTargets(currentFp, limit) {
    const candidates = [];
    for (const [fp, data] of this.nodes) {
      if (fp === currentFp) continue;
      candidates.push({ fp, visitCount: data.visitCount });
    }

    candidates.sort((a, b) => a.visitCount - b.visitCount);

    const results = candidates.slice(0, limit).map((c) => ({
      fp: c.fp,
      visitCount: c.visitCount,
      path: this.getPathTo(c.fp),
    }));

    return results;
  }

  /**
   * Merge remembered action outcomes from cross-crawl memory.
   * Only imports permanent-bad outcomes that the current crawl hasn't seen yet.
   *
   * Accepts two shapes for backwards compatibility:
   *   - v1 legacy: { actionKey: "ineffective" } (string)
   *   - v2 rich:   { actionKey: { ok, bad, newScreen, lastOutcome } }
   *
   * For rich entries, an action is treated as permanent-bad only if it has
   * NEVER succeeded (ok === 0) AND its lastOutcome is a permanent-bad value.
   *
   * @param {string} fingerprint
   * @param {Object} outcomes — { actionKey: outcome | richEntry } from screen-memory
   * @returns {number} count of merged entries
   */
  mergeRememberedOutcomes(fingerprint, outcomes) {
    const node = this.nodes.get(fingerprint);
    if (!node) return 0;
    const permanent = ["ineffective", "out_of_app", "crash", "dead_end"];
    let merged = 0;
    for (const [actionKey, value] of Object.entries(outcomes)) {
      if (node.actionOutcomes.has(actionKey)) continue;

      // Resolve the effective outcome from either v1 or v2 shape
      let effectiveOutcome = null;
      if (typeof value === "string") {
        if (permanent.includes(value)) effectiveOutcome = value;
      } else if (value && typeof value === "object") {
        // Only treat as bad if it has never succeeded and last seen outcome was bad
        if (value.ok === 0 && value.bad > 0 && permanent.includes(value.lastOutcome)) {
          effectiveOutcome = value.lastOutcome;
        }
      }

      if (effectiveOutcome) {
        node.actionOutcomes.set(actionKey, effectiveOutcome);
        node.triedActions.add(actionKey);
        if (effectiveOutcome === "ineffective") {
          node.ineffectiveActions.add(actionKey);
        }
        merged++;
      }
    }
    return merged;
  }

  /** Check whether a fingerprint has been visited. */
  isVisited(fingerprint) {
    return this.nodes.has(fingerprint);
  }

  /** Get the visit count for a fingerprint. */
  visitCount(fingerprint) {
    const node = this.nodes.get(fingerprint);
    return node ? node.visitCount : 0;
  }

  /** Get the set of already-tried action keys for a given state. */
  triedActionsFor(fingerprint) {
    const node = this.nodes.get(fingerprint);
    return node ? node.triedActions : new Set();
  }

  /**
   * Detect if the crawler is stuck in a loop.
   * Returns true if the last `windowSize` states contain `threshold` or fewer
   * unique fingerprints (meaning the crawler is cycling between 1-2 screens).
   */
  detectLoop(windowSize = 6, threshold = 2) {
    if (this.history.length < windowSize) return false;
    const recent = this.history.slice(-windowSize);
    const unique = new Set(recent);
    return unique.size <= threshold;
  }

  /**
   * Find a backtrack target — the most recent state in history that still
   * has untried actions, excluding the current state.
   * Returns the fingerprint or null.
   */
  getBacktrackTarget(currentFingerprint) {
    // Walk history backwards looking for a state with untried potential
    for (let i = this.history.length - 1; i >= 0; i--) {
      const fp = this.history[i];
      if (fp === currentFingerprint) continue;
      // We can't really know if it has untried actions without re-extracting XML,
      // but we can check if it was visited fewer times
      const node = this.nodes.get(fp);
      if (node && node.visitCount < 3) return fp;
    }
    return null;
  }

  /** Total unique states discovered. */
  uniqueStateCount() {
    return this.nodes.size;
  }

  /** Serialize the graph for crawl artifacts. */
  toJSON() {
    const nodes = [];
    for (const [fp, data] of this.nodes) {
      nodes.push({
        fingerprint: fp,
        activity: data.screenData?.activity || 'unknown',
        screenshotPath: data.screenData?.screenshotPath || null,
        visitCount: data.visitCount,
        triedActions: Array.from(data.triedActions),
        actionOutcomes: Object.fromEntries(data.actionOutcomes),
      });
    }
    const pm = {};
    for (const [fp, data] of this.parentMap) {
      pm[fp] = data;
    }

    return {
      nodes,
      transitions: this.transitions,
      totalSteps: this.history.length,
      uniqueStates: this.nodes.size,
      parentMap: pm,
    };
  }
}

module.exports = { StateGraph };
