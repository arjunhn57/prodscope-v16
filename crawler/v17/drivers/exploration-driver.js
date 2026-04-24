"use strict";

/**
 * v17/drivers/exploration-driver.js
 *
 * Deterministic exploration driver. Zero AI for standard Android navigation:
 * BottomNavigationView, TabLayout, NavigationDrawer, and homogeneous list
 * containers (RecyclerView / ListView / Compose LazyColumn) are detected by
 * className patterns and structural bounds only.
 *
 * Design principles per Phase C plan:
 *   1. State memory prevents tab-dancing: the set `tabsTapped` is keyed by
 *      resource-id (stable across screens) or bounds-bucket label (fallback).
 *      Once we tap a nav element we never tap it again in this run.
 *   2. Zero LLM calls here. className pattern matching is language-agnostic
 *      by definition.
 *   3. End-of-scroll detector: we remember the screen fingerprint emitted on
 *      our previous scroll. If the fingerprint is IDENTICAL on the next
 *      decide(), the scroll didn't advance content → mark the fingerprint as
 *      scroll-exhausted and yield to LLMFallback.
 *
 * Decision priority (first non-null wins):
 *   a. Unvisited nav tab (bottom-nav / top-tab / drawer)
 *   b. Unvisited list item on the current screen
 *   c. Scroll down (if current fp is not already scroll-exhausted)
 *   d. Return null → dispatcher falls through to LLMFallback
 */

const { parseClickableGraph } = require("./clickable-graph");
const { computeStructuralFingerprint } = require("../node-classifier");
const { logger } = require("../../../lib/logger");

const log = logger.child({ component: "v17-exploration-driver" });

// ── Android navigation className patterns ───────────────────────────────
// Language-agnostic: these are the developer-facing widget class names,
// not user-visible labels.

const BOTTOM_NAV_CLASS_PATTERNS = [
  /BottomNavigationItemView/,
  /BottomNavigationView/,
  /NavigationBarItem/, // Jetpack Compose NavigationBar child
];

const TAB_CLASS_PATTERNS = [
  /TabLayout\$TabView/,
  /TabLayout\$Tab(?!\w)/, // \bTab\b boundary — match TabLayout$Tab but not TabLayout$TabView (already matched)
  /\bTabView(?!\w)/,
];

const DRAWER_ITEM_CLASS_PATTERNS = [
  /NavigationMenuItemView/,
  /NavigationDrawerItem/, // Compose
];

const LIST_CONTAINER_CLASS_PATTERNS = [
  /RecyclerView(?!\w)/,
  /ListView(?!\w)/,
  /LazyColumn/,
  /LazyList/,
];

/** Regex hot-path for the claim() XML smell-test — one bit cheaper than parsing. */
const NAV_OR_LIST_XML_REGEX = /class="[^"]*(?:BottomNavigation|NavigationBarItem|TabLayout|NavigationMenuItemView|NavigationDrawerItem|RecyclerView|ListView|LazyColumn|LazyRow|LazyList)/;

/** Scroll gesture padding — keep away from the navigation bars at top/bottom. */
const SCROLL_VERTICAL_MARGIN_PCT = 0.25;

/**
 * Structural bottom-bar parameters. A Jetpack Compose app typically renders
 * NavigationBar children as plain `android.view.View` leaves with no
 * recognisable className, so the class-match path can't see them. Instead we
 * detect a row of ≥3 clickables clustered in the bottom BOTTOM_BAR_Y_FRACTION
 * of the screen sharing a y-bucket (rounded to BOTTOM_BAR_Y_BUCKET_PX).
 *
 * These are intentionally conservative — a spurious ≥3-row cluster would
 * normally be real nav, since most content layouts don't place 3 clickables
 * on a single row at the very bottom of the screen.
 */
const BOTTOM_BAR_Y_FRACTION = 0.80;
const BOTTOM_BAR_Y_BUCKET_PX = 32;
const BOTTOM_BAR_MIN_SIBLINGS = 3;

// ── Memory initialization ───────────────────────────────────────────────

/**
 * @typedef {Object} ExplorationMemory
 * @property {Set<string>} tabsTapped         - nav tabs we've already tapped
 * @property {Map<string, Set<string>>} listItemsByFp - fp → set of tapped item keys
 * @property {Set<string>} scrollExhausted    - fingerprints where scrolling is a no-op
 * @property {string|null} lastActionKind     - 'tap_nav'|'tap_item'|'scroll'|null
 * @property {string|null} lastFingerprint    - fp observed when lastAction was emitted
 * @property {Map<string, number>} scrollRetryByFp - per-fp scroll retry count
 *
 * @typedef {Object} ExplorationState
 * @property {ExplorationMemory} [explorationMemory]
 */

/**
 * Lazy-initialize the exploration memory on the shared state object.
 *
 * @param {ExplorationState} state
 * @returns {ExplorationMemory|null}
 */
function initMemory(state) {
  if (!state || typeof state !== "object") return null;
  if (!state.explorationMemory) {
    state.explorationMemory = {
      tabsTapped: new Set(),
      listItemsByFp: new Map(),
      scrollExhausted: new Set(),
      lastActionKind: null,
      lastFingerprint: null,
      scrollRetryByFp: new Map(),
    };
  }
  return state.explorationMemory;
}

// ── Element classification (strict structural) ───────────────────────────

function matchesAny(patterns, className) {
  if (!className) return false;
  return patterns.some((r) => r.test(className));
}

function isBottomNavItem(c) {
  return matchesAny(BOTTOM_NAV_CLASS_PATTERNS, c.className);
}

function isTabItem(c) {
  return matchesAny(TAB_CLASS_PATTERNS, c.className);
}

function isDrawerItem(c) {
  return matchesAny(DRAWER_ITEM_CLASS_PATTERNS, c.className);
}

function isListContainer(c) {
  return matchesAny(LIST_CONTAINER_CLASS_PATTERNS, c.className);
}

function isNavElement(c) {
  return isBottomNavItem(c) || isTabItem(c) || isDrawerItem(c);
}

/**
 * Deterministic cross-screen element identity.
 *
 * @param {any} c
 * @returns {string}
 */
function elementKey(c) {
  if (c && c.resourceId) return `rid:${c.resourceId}`;
  const label = (c && c.label) || "";
  const bx = Math.floor(((c && c.cx) || 0) / 32);
  const by = Math.floor(((c && c.cy) || 0) / 32);
  return `bb:${label}:${bx},${by}`;
}

// ── List-item heuristic (no AI) ─────────────────────────────────────────

/**
 * Find candidate list items by grouping clickables with identical className and
 * consistent left alignment. Requires ≥3 siblings to count — a single card is
 * just a button, not a list.
 *
 * @param {any} graph
 * @returns {Array<any>}
 */
function findListItemTargets(graph) {
  const byClass = new Map();
  for (const c of graph.clickables) {
    if (!c.className) continue;
    // Skip nav / list container itself
    if (isNavElement(c) || isListContainer(c)) continue;
    const arr = byClass.get(c.className) || [];
    arr.push(c);
    byClass.set(c.className, arr);
  }
  const items = [];
  for (const group of byClass.values()) {
    if (group.length < 3) continue;
    group.sort((a, b) => a.cy - b.cy);
    const refX = group[0].bounds.x1;
    const aligned = group.filter((c) => Math.abs(c.bounds.x1 - refX) <= 40);
    if (aligned.length >= 3) items.push(...aligned);
  }
  return items;
}

// ── Structural bottom-bar fallback (Compose / custom widgets) ────────────

/**
 * Class-agnostic bottom-bar detector. Finds a row of ≥3 clickables clustered
 * in the bottom band of the screen sharing a y-bucket. Handles Jetpack
 * Compose apps whose nav children are plain `android.view.View` leaves.
 *
 * Excludes inputs, password fields, and any clickable already matched by
 * className-based nav detection (we don't want duplicate candidates).
 *
 * @param {any} graph
 * @param {number} screenHeight
 * @returns {Array<any>}
 */
function findStructuralBottomBar(graph, screenHeight) {
  if (!graph || !Array.isArray(graph.clickables)) return [];
  if (!Number.isFinite(screenHeight) || screenHeight <= 0) return [];
  const threshold = screenHeight * BOTTOM_BAR_Y_FRACTION;
  const candidates = graph.clickables.filter((c) => {
    if (!c || !c.bounds) return false;
    if (isNavElement(c) || isListContainer(c)) return false;
    if (c.isInput || c.isPassword) return false;
    return typeof c.cy === "number" && c.cy >= threshold;
  });
  if (candidates.length < BOTTOM_BAR_MIN_SIBLINGS) return [];

  const byBucket = new Map();
  for (const c of candidates) {
    const k = Math.floor(c.cy / BOTTOM_BAR_Y_BUCKET_PX);
    const arr = byBucket.get(k) || [];
    arr.push(c);
    byBucket.set(k, arr);
  }
  let best = [];
  for (const group of byBucket.values()) {
    if (group.length > best.length) best = group;
  }
  if (best.length < BOTTOM_BAR_MIN_SIBLINGS) return [];
  // Return left-to-right so tapping picks predictable tab order.
  return best.slice().sort((a, b) => a.cx - b.cx);
}

// ── Screen dimensions (from max bounds in graph) ────────────────────────

/**
 * Infer screen width/height from the union of all clickable bounds. Good enough
 * for scroll-gesture coordinates even if slightly off — executor clamps.
 *
 * @param {any} graph
 * @returns {{width:number, height:number}}
 */
function inferScreenSize(graph) {
  let width = 0;
  let height = 0;
  for (const c of graph.clickables) {
    if (c.bounds && Number.isFinite(c.bounds.x2)) width = Math.max(width, c.bounds.x2);
    if (c.bounds && Number.isFinite(c.bounds.y2)) height = Math.max(height, c.bounds.y2);
  }
  // Fall back to typical Android values if the graph is empty / malformed
  if (!width) width = 1080;
  if (!height) height = 2400;
  return { width, height };
}

// ── Driver contract ─────────────────────────────────────────────────────

/**
 * True when the XML has any known nav/list widget class. Cheap smell test.
 *
 * @param {{xml?:string|null}} observation
 * @returns {boolean}
 */
function claim(observation) {
  if (!observation || typeof observation !== "object") return false;
  const xml = typeof observation.xml === "string" ? observation.xml : "";
  if (!xml) return false;
  if (NAV_OR_LIST_XML_REGEX.test(xml)) return true;
  // Secondary check: parse and look for homogeneous list items (cheap).
  const graph = parseClickableGraph(xml);
  if (graph.clickables.length === 0) return false;
  if (findListItemTargets(graph).length >= BOTTOM_BAR_MIN_SIBLINGS) return true;
  // Tertiary check: class-agnostic bottom-bar fallback for Compose apps whose
  // NavigationBar children don't expose a recognisable className.
  const { height } = inferScreenSize(graph);
  if (findStructuralBottomBar(graph, height).length >= BOTTOM_BAR_MIN_SIBLINGS) return true;
  return false;
}

/**
 * Produce the next exploration action or null.
 *
 * @param {any} observation
 * @param {ExplorationState} state
 * @returns {Promise<any|null>}
 */
async function decide(observation, state) {
  if (!observation || typeof observation !== "object") return null;
  const graph = parseClickableGraph(observation.xml);

  // NOTE: do not early-return on empty clickables. A text-only article inside a
  // NestedScrollView has zero clickable nodes but is still a legitimate scroll
  // target, and we still need the scroll-exhaustion detector to run.

  const memory = initMemory(state);
  if (!memory) return null;

  const fp = computeStructuralFingerprint(
    graph,
    observation.packageName,
    observation.activity,
  );

  // First, interpret what happened since our last action: if we scrolled and
  // the fingerprint is unchanged, the scroll was a no-op → mark exhausted.
  if (
    memory.lastActionKind === "scroll" &&
    memory.lastFingerprint === fp
  ) {
    const count = (memory.scrollRetryByFp.get(fp) || 0) + 1;
    memory.scrollRetryByFp.set(fp, count);
    // One repeat is enough — a second scroll at the same fingerprint means the
    // first didn't advance content. Don't waste budget on a third try.
    if (count >= 1) {
      memory.scrollExhausted.add(fp);
      log.info({ fingerprint: fp }, "ExplorationDriver: scroll exhausted");
    }
  }

  // (a) Prefer an unvisited nav tab (className-matched).
  const navTap = pickNavTab(graph, memory);
  if (navTap) {
    memory.tabsTapped.add(navTap.key);
    memory.lastActionKind = "tap_nav";
    memory.lastFingerprint = fp;
    log.info(
      { key: navTap.key, label: navTap.nav.label || "", cy: navTap.nav.cy, kind: "nav" },
      "ExplorationDriver: tapping unvisited nav",
    );
    return tapAction(navTap.nav);
  }

  // (a.5) Class-agnostic bottom-bar fallback for Compose / custom-widget apps
  //       that don't emit a recognisable NavigationBar className.
  const { height } = inferScreenSize(graph);
  const structuralBar = findStructuralBottomBar(graph, height);
  for (const c of structuralBar) {
    const key = elementKey(c);
    if (!memory.tabsTapped.has(key)) {
      memory.tabsTapped.add(key);
      memory.lastActionKind = "tap_nav";
      memory.lastFingerprint = fp;
      log.info(
        { key, label: c.label || "", cy: c.cy, source: "structural_bottom_bar" },
        "ExplorationDriver: tapping structural bottom-bar candidate",
      );
      return tapAction(c);
    }
  }

  // (b) Prefer an unvisited list item on this fingerprint's screen.
  const listTap = pickListItem(graph, memory, fp);
  if (listTap) {
    let visited = memory.listItemsByFp.get(fp);
    if (!visited) {
      visited = new Set();
      memory.listItemsByFp.set(fp, visited);
    }
    visited.add(listTap.key);
    memory.lastActionKind = "tap_item";
    memory.lastFingerprint = fp;
    log.info(
      {
        key: listTap.key,
        label: listTap.item.label || "",
        cy: listTap.item.cy,
        fingerprint: fp,
      },
      "ExplorationDriver: tapping unvisited list item",
    );
    return tapAction(listTap.item);
  }

  // (c) Scroll to reveal more content, unless this screen is already exhausted.
  if (!memory.scrollExhausted.has(fp) && hasScrollableContent(graph, observation.xml)) {
    memory.lastActionKind = "scroll";
    memory.lastFingerprint = fp;
    const { width, height: h } = inferScreenSize(graph);
    const cx = Math.floor(width / 2);
    const y1 = Math.floor(h * (1 - SCROLL_VERTICAL_MARGIN_PCT));
    const y2 = Math.floor(h * SCROLL_VERTICAL_MARGIN_PCT);
    log.info(
      { fingerprint: fp, cx, y1, y2 },
      "ExplorationDriver: scrolling down",
    );
    return { type: "swipe", x1: cx, y1, x2: cx, y2 };
  }

  // (d) Nothing to do → LLMFallback.
  log.debug({ fingerprint: fp }, "ExplorationDriver: no unvisited target, yielding");
  return null;
}

/**
 * @param {any} graph
 * @param {ExplorationMemory} memory
 * @returns {{nav:any, key:string}|null}
 */
function pickNavTab(graph, memory) {
  const navs = graph.clickables.filter(isNavElement);
  for (const nav of navs) {
    const key = elementKey(nav);
    if (!memory.tabsTapped.has(key)) return { nav, key };
  }
  return null;
}

/**
 * @param {any} graph
 * @param {ExplorationMemory} memory
 * @param {string} fp
 * @returns {{item:any, key:string}|null}
 */
function pickListItem(graph, memory, fp) {
  const items = findListItemTargets(graph);
  const visited = memory.listItemsByFp.get(fp) || new Set();
  for (const item of items) {
    const key = elementKey(item);
    if (!visited.has(key)) return { item, key };
  }
  return null;
}

/**
 * Is there a scrollable container on screen? Relies on className only —
 * detecting a list container is sufficient evidence.
 */
function hasScrollableContent(graph, xml) {
  if (graph.clickables.some(isListContainer)) return true;
  return /class="[^"]*(?:ScrollView|NestedScrollView|LazyColumn|LazyList|RecyclerView)/.test(xml || "");
}

/**
 * Build a tap action + targetText for the executor's resolver.
 *
 * @param {any} clickable
 * @returns {{type:'tap', x:number, y:number, targetText?:string}}
 */
function tapAction(clickable) {
  const action = { type: "tap", x: clickable.cx, y: clickable.cy };
  if (clickable.label) action.targetText = clickable.label;
  return action;
}

module.exports = {
  name: "ExplorationDriver",
  claim,
  decide,
  // exported for direct testing
  initMemory,
  findListItemTargets,
  findStructuralBottomBar,
  pickNavTab,
  pickListItem,
  elementKey,
  isNavElement,
  isBottomNavItem,
  isTabItem,
  isDrawerItem,
  isListContainer,
  BOTTOM_NAV_CLASS_PATTERNS,
  TAB_CLASS_PATTERNS,
  DRAWER_ITEM_CLASS_PATTERNS,
  LIST_CONTAINER_CLASS_PATTERNS,
  BOTTOM_BAR_Y_FRACTION,
  BOTTOM_BAR_MIN_SIBLINGS,
};
