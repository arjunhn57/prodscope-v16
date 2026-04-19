"use strict";

/**
 * app-map.js — Hierarchical app map for strategic exploration.
 *
 * Tracks a tree of screens (parent-child relationships), nav tab assignments,
 * per-screen exhaustion state, and the current navigation path (breadcrumb).
 *
 * Provides exploration directives:
 *   - "explore"     — screen has untried actions, keep exploring
 *   - "backtrack"   — screen exhausted, go back to parent
 *   - "switch_tab"  — current tab exhausted, switch to next unexhausted tab
 *   - "revisit"     — all tabs visited, revisit least-explored
 *
 * Pure data structure. Zero side effects, zero LLM calls, fully unit-testable.
 */

const { logger } = require("../lib/logger");
const log = logger.child({ component: "app-map" });

const EXHAUSTION_THRESHOLD = 0.8; // 80% of actions tried = exhausted
const MAX_DEPTH = 6;              // Force backtrack beyond this depth

class AppMap {
  constructor() {
    /** @type {Array<{ label: string, cx: number, cy: number, rootFp: string|null, explored: boolean, childScreenCount: number, exhausted: boolean }>} */
    this.navTabs = [];

    /** @type {Map<string, { parentFp: string|null, parentAction: string|null, navTabIndex: number, depth: number, actionsTotal: number, actionsTried: Set<string>, children: Set<string>, visits: number, exhausted: boolean }>} */
    this.screenNodes = new Map();

    /** @type {string[]} — Stack of fingerprints representing current navigation path */
    this.currentPath = [];

    /** @type {number} — Index of the nav tab we're currently exploring (-1 = unknown) */
    this.currentNavTabIndex = -1;

    /** @type {number} — Total tab switches performed */
    this.tabSwitchCount = 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Registration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Register a screen in the map. If already registered, updates visit count
   * and actionsTotal (if the new value is higher).
   *
   * @param {string} fp - Screen fingerprint
   * @param {number} actionsTotal - Number of extractable actions on this screen
   * @param {string|null} parentFp - Fingerprint of the screen we navigated FROM
   * @param {string|null} parentAction - Action key that brought us here
   */
  registerScreen(fp, actionsTotal, parentFp, parentAction) {
    if (this.screenNodes.has(fp)) {
      const node = this.screenNodes.get(fp);
      node.visits++;
      // Update actionsTotal if new snapshot reveals more actions
      if (actionsTotal > node.actionsTotal) {
        node.actionsTotal = actionsTotal;
        node.exhausted = this._checkExhausted(node);
      }
      return;
    }

    // Compute depth from parent
    let depth = 0;
    let navTabIndex = -1;

    if (parentFp && this.screenNodes.has(parentFp)) {
      const parentNode = this.screenNodes.get(parentFp);
      depth = parentNode.depth + 1;
      navTabIndex = parentNode.navTabIndex;
      // Record this screen as a child of its parent
      parentNode.children.add(fp);
    }

    this.screenNodes.set(fp, {
      parentFp: parentFp || null,
      parentAction: parentAction || null,
      navTabIndex,
      depth,
      actionsTotal,
      actionsTried: new Set(),
      children: new Set(),
      visits: 1,
      exhausted: actionsTotal === 0, // no actions = exhausted immediately
    });

    // Update tab stats
    if (navTabIndex >= 0 && navTabIndex < this.navTabs.length) {
      this.navTabs[navTabIndex].childScreenCount++;
    }

    log.info({
      fp: fp.slice(0, 12),
      depth,
      tab: navTabIndex >= 0 ? this.navTabs[navTabIndex]?.label : "unknown",
      actions: actionsTotal,
    }, "Registered screen");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation path tracking
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Push a screen onto the navigation path (navigated forward).
   * @param {string} fp
   */
  pushScreen(fp) {
    // Avoid duplicate pushes (same screen re-registered)
    if (this.currentPath.length > 0 && this.currentPath[this.currentPath.length - 1] === fp) {
      return;
    }
    this.currentPath.push(fp);
  }

  /**
   * Pop the top screen from the navigation path (went back).
   * @returns {string|null} The popped fingerprint, or null if empty
   */
  popScreen() {
    if (this.currentPath.length === 0) return null;
    return this.currentPath.pop();
  }

  /**
   * Pop the path back to a known screen (e.g., after pressing back multiple times).
   * If fp is found in the path, pops everything above it.
   * @param {string} fp
   */
  popToScreen(fp) {
    const idx = this.currentPath.lastIndexOf(fp);
    if (idx >= 0) {
      this.currentPath.length = idx + 1;
    }
  }

  /**
   * Check if a fingerprint is in the current navigation path.
   * @param {string} fp
   * @returns {boolean}
   */
  isInCurrentPath(fp) {
    return this.currentPath.includes(fp);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Nav tab management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set the nav tabs detected from navigator.js or vision.
   * Only sets once (first detection wins).
   *
   * @param {Array<{ label: string, cx: number, cy: number }>} tabs
   */
  setNavTabs(tabs) {
    if (this.navTabs.length > 0) return; // Already set
    if (!tabs || tabs.length < 2) return; // Not a real nav bar

    this.navTabs = tabs.map((t) => ({
      label: t.label,
      cx: t.cx,
      cy: t.cy,
      rootFp: null,
      explored: false,
      childScreenCount: 0,
      exhausted: false,
    }));

    log.info({ tabCount: this.navTabs.length, labels: this.navTabs.map((t) => t.label) }, "Nav tabs registered");
  }

  /**
   * Register a tab root screen (called when survey or tab switch lands on a tab).
   *
   * @param {number} tabIndex
   * @param {string} fp - Root fingerprint for this tab
   */
  registerTabRoot(tabIndex, fp) {
    if (tabIndex < 0 || tabIndex >= this.navTabs.length) return;

    const tab = this.navTabs[tabIndex];
    tab.rootFp = fp;
    tab.explored = true;

    // Update the screen node's tab assignment
    if (this.screenNodes.has(fp)) {
      const node = this.screenNodes.get(fp);
      node.navTabIndex = tabIndex;
      node.depth = 0; // Tab root is depth 0
    }

    this.currentNavTabIndex = tabIndex;

    log.info({ tab: tab.label, fp: fp.slice(0, 12) }, "Tab root registered");
  }

  /**
   * Get the next unexhausted tab for round-robin exploration.
   * Starts searching from the tab after currentNavTabIndex.
   *
   * @returns {{ label: string, cx: number, cy: number, index: number }|null}
   */
  getNextTab() {
    if (this.navTabs.length === 0) return null;

    const start = this.currentNavTabIndex + 1;

    // First pass: find unvisited tab
    for (let i = 0; i < this.navTabs.length; i++) {
      const idx = (start + i) % this.navTabs.length;
      const tab = this.navTabs[idx];
      if (!tab.explored) {
        return { label: tab.label, cx: tab.cx, cy: tab.cy, index: idx };
      }
    }

    // Second pass: find visited but not exhausted tab
    for (let i = 0; i < this.navTabs.length; i++) {
      const idx = (start + i) % this.navTabs.length;
      const tab = this.navTabs[idx];
      if (!tab.exhausted) {
        return { label: tab.label, cx: tab.cx, cy: tab.cy, index: idx };
      }
    }

    // Third pass: revisit least-explored tab
    let leastExplored = null;
    let minScreens = Infinity;
    for (let i = 0; i < this.navTabs.length; i++) {
      const tab = this.navTabs[i];
      if (tab.childScreenCount < minScreens) {
        minScreens = tab.childScreenCount;
        leastExplored = { label: tab.label, cx: tab.cx, cy: tab.cy, index: i };
      }
    }

    return leastExplored;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Per-screen exhaustion
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Mark an action as tried on a screen.
   * @param {string} fp
   * @param {string} actionKey
   */
  markActionTried(fp, actionKey) {
    const node = this.screenNodes.get(fp);
    if (!node) return;

    node.actionsTried.add(actionKey);
    node.exhausted = this._checkExhausted(node);

    // If this screen just became exhausted, check if its tab is now exhausted
    if (node.exhausted && node.navTabIndex >= 0) {
      this._checkTabExhaustion(node.navTabIndex);
    }
  }

  /**
   * Update the actionsTotal for a screen (when re-visiting reveals more/fewer actions).
   * @param {string} fp
   * @param {number} actionsTotal
   */
  updateActionsTotal(fp, actionsTotal) {
    const node = this.screenNodes.get(fp);
    if (!node) return;
    if (actionsTotal > node.actionsTotal) {
      const prev = node.actionsTotal;
      node.actionsTotal = actionsTotal;
      node.exhausted = this._checkExhausted(node);
      log.info({ fp: fp.slice(0, 12), prev, now: actionsTotal, exhausted: node.exhausted }, "Updated actionsTotal");
    }
  }

  /**
   * Check if a screen is exhausted (80%+ actions tried).
   * @param {string} fp
   * @returns {boolean}
   */
  isScreenExhausted(fp) {
    const node = this.screenNodes.get(fp);
    if (!node) return false;
    return node.exhausted;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Strategy — the brain
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the exploration directive for the current screen.
   *
   * @param {string} fp - Current screen fingerprint
   * @param {Array} candidates - Available action candidates
   * @returns {{ type: 'explore'|'backtrack'|'switch_tab'|'revisit', reason: string }}
   */
  getExplorationDirective(fp, candidates) {
    const node = this.screenNodes.get(fp);

    // Unknown screen — just explore
    if (!node) {
      return { type: "explore", reason: "unknown_screen" };
    }

    // Depth limit exceeded — force backtrack
    if (node.depth > MAX_DEPTH) {
      return { type: "backtrack", reason: `depth_limit_exceeded (${node.depth} > ${MAX_DEPTH})` };
    }

    // Screen has untried candidates — explore
    const untriedCandidates = candidates.filter((c) => !node.actionsTried.has(c.key));
    if (untriedCandidates.length > 0 && !node.exhausted) {
      return { type: "explore", reason: `${untriedCandidates.length} untried actions` };
    }

    // Screen exhausted — backtrack or switch tab
    if (node.exhausted || untriedCandidates.length === 0) {
      // If we're at a tab root (depth 0), switch to next tab
      if (node.depth === 0 && this.navTabs.length > 0) {
        const nextTab = this.getNextTab();
        if (nextTab && nextTab.index !== this.currentNavTabIndex) {
          return { type: "switch_tab", reason: `tab_root_exhausted (${node.actionsTried.size}/${node.actionsTotal} tried)` };
        }
        // All tabs exhausted — revisit least explored
        if (nextTab) {
          return { type: "revisit", reason: "all_tabs_exhausted" };
        }
      }

      // Not at tab root — backtrack to parent
      if (node.parentFp) {
        return { type: "backtrack", reason: `screen_exhausted (${node.actionsTried.size}/${node.actionsTotal} tried)` };
      }

      // No parent, no tabs — we're stuck at root with nothing to do
      if (this.navTabs.length > 0) {
        return { type: "switch_tab", reason: "root_exhausted_has_tabs" };
      }

      // Truly nothing left
      return { type: "explore", reason: "no_alternatives" };
    }

    return { type: "explore", reason: "default" };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Coverage statistics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get coverage statistics for the crawl.
   * @returns {{ totalScreens: number, exhaustedScreens: number, tabStats: Array }}
   */
  getCoverageStats() {
    let exhaustedScreens = 0;
    for (const node of this.screenNodes.values()) {
      if (node.exhausted) exhaustedScreens++;
    }

    const tabStats = this.navTabs.map((tab, i) => ({
      label: tab.label,
      explored: tab.explored,
      exhausted: tab.exhausted,
      childScreenCount: tab.childScreenCount,
      rootFp: tab.rootFp ? tab.rootFp.slice(0, 12) : null,
    }));

    return {
      totalScreens: this.screenNodes.size,
      exhaustedScreens,
      tabStats,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if a node meets the exhaustion threshold.
   * @param {object} node
   * @returns {boolean}
   */
  _checkExhausted(node) {
    if (node.actionsTotal === 0) return true;
    return node.actionsTried.size >= Math.ceil(node.actionsTotal * EXHAUSTION_THRESHOLD);
  }

  /**
   * Check if all screens in a tab are exhausted.
   * @param {number} tabIndex
   */
  _checkTabExhaustion(tabIndex) {
    if (tabIndex < 0 || tabIndex >= this.navTabs.length) return;

    const tab = this.navTabs[tabIndex];
    if (!tab.explored || !tab.rootFp) return;

    // Check all screens belonging to this tab
    let allExhausted = true;
    let screenCount = 0;
    for (const node of this.screenNodes.values()) {
      if (node.navTabIndex === tabIndex) {
        screenCount++;
        if (!node.exhausted) {
          allExhausted = false;
          break;
        }
      }
    }

    // Only mark exhausted if we've discovered at least 1 screen
    if (screenCount > 0 && allExhausted) {
      tab.exhausted = true;
      log.info({ tab: tab.label, screens: screenCount }, "Tab exhausted");
    }
  }
}

module.exports = { AppMap, EXHAUSTION_THRESHOLD, MAX_DEPTH };
