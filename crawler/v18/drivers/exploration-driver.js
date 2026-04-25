"use strict";

/**
 * v18/drivers/exploration-driver.js
 *
 * V18 exploration driver. Same structural heuristics as v17 (nav tabs,
 * homogeneous list items, structural bottom bar, scroll budget), but
 * operates on a CLASSIFIED clickable set supplied by the semantic
 * classifier. The difference that matters: clickables tagged
 * intent=write or intent=destructive are invisible to this driver.
 *
 * This is the core V18 change. V17 would tap anything structurally
 * shaped like a nav tab — Reply buttons, Phone action buttons, emoji
 * picker keys — because it had no semantic signal. V18 filters first,
 * so the structural heuristics only fire on safe targets.
 *
 * Interface contract matches v17 exactly: `claim(observation)` returns
 * a boolean, `decide(observation, state, deps)` returns an action or null.
 * The new input is `deps.plan` (ScreenPlan) and `deps.classifiedClickables`
 * (ClassifiedClickable[]). Older code paths that don't provide these
 * degrade to pre-intent behaviour (see `deriveFilterable` below).
 */

const { parseClickableGraph } = require("../../v17/drivers/clickable-graph");
const v17Exploration = require("../../v17/drivers/exploration-driver");
const { untappedClickables, countActivityVisits } = require("../trajectory-memory");
const { logger } = require("../../../lib/logger");

const log = logger.child({ component: "v18-exploration-driver" });

/**
 * 2026-04-25 v6: drill-down preference threshold. After we've recorded
 * `HUB_REVISIT_THRESHOLD` actions on the current activity, prefer a list
 * item (which usually opens a different activity / detail screen) over
 * tapping yet another nav tab in the same activity. Below the threshold,
 * the existing nav-first ordering stays — agent tabs the bottom nav
 * normally, only flipping when it's clearly camped in one hub.
 */
const HUB_REVISIT_THRESHOLD = 3;

/**
 * The intents that ExplorationDriver is allowed to act on. Anything outside
 * this set is filtered out of the candidate pool before structural heuristics
 * run.
 */
const EXPLORATION_INTENTS = new Set(["navigate", "read_only"]);

/**
 * Phase 3 graph exploration: screen types where an empty frontier
 * (every clickable already tapped on this fp) can safely emit press_back
 * without exiting the target app. Detail / dialog / error / other are
 * dead-ends where back-nav is the natural backtrack.
 *
 * Feed / profile / settings / search / compose / auth / permission /
 * onboarding / profile screen-types are hubs — if their frontier empties,
 * yield to LLMFallback so its trajectory-hint prompt can navigate to an
 * unvisited hub (via drawer, nav tab, etc.) rather than press_back out
 * of the app.
 */
const EMPTY_FRONTIER_SAFE_BACK_SCREEN_TYPES = new Set([
  "detail",
  "dialog",
  "error",
  "other",
]);

/**
 * Horizontal-pager detection — classes that host swipeable pages.
 * Presence of any of these in the XML means swipe_horizontal likely
 * reveals a new fp (next page of a carousel / tab / story rail).
 */
const HORIZONTAL_PAGER_XML_REGEX =
  /class="[^"]*(?:ViewPager2|androidx\.viewpager\.widget\.ViewPager|HorizontalPager|LazyRow|HorizontalScrollView)"/;

/** Per-fp horizontal swipe budget (mirror of vertical scroll budget). */
const MAX_HORIZONTAL_SWIPES_PER_FP = 4;

/**
 * WebView detection regex. Matches android.webkit.WebView and the
 * Compose / androidx WebView wrappers. These screens produce few XML
 * clickables but have scrollable HTML content beneath.
 */
const WEBVIEW_XML_REGEX = /class="[^"]*(?:WebView|android\.webkit\.WebView)/;

/**
 * Per-fp WebView scroll budget. Before the back ladder surrenders on a
 * WebView-heavy screen (FAQs, Terms, embedded help content), try a few
 * vertical scrolls so the classifier + screenshot capture surfaces
 * deeper content.
 */
const MAX_WEBVIEW_SCROLLS_PER_FP = 3;

/**
 * Back-edge escalation ladder for empty-frontier on safe screen types.
 * On the first empty-frontier hit we press_back; on the second (same fp
 * after press_back failed to change it) we try gesture-nav edge-swipe-back;
 * on the third we yield.
 */
const BACK_LADDER_ATTEMPTS = ["press_back", "edge_swipe_back", "yield"];

/**
 * Build the filtered clickable graph the v17 heuristics will operate on.
 * We run findListItemTargets etc. against the filtered set so:
 *   - Homogeneous Reply buttons (intent=write) never form a "list" group.
 *   - Emoji picker keys (intent=write) never cluster in the bottom-bar.
 *   - A mid-screen profile contact row (Phone/Email/Message, write) drops out.
 *
 * If the plan's allowed_intents narrows further (e.g. compose sheet →
 * navigate only), intersect with the plan. When plan is missing (degraded
 * mode), fall back to v17 behaviour on the full set.
 *
 * @param {object} graph
 * @param {object[]} classifiedClickables
 * @param {object|null} plan
 * @returns {object}
 */
function deriveFilterable(graph, classifiedClickables, plan) {
  if (!classifiedClickables || classifiedClickables.length === 0) {
    // Degraded mode — no classification. Use v17 behaviour.
    return graph;
  }
  const allowed = plan && Array.isArray(plan.allowedIntents) && plan.allowedIntents.length > 0
    ? new Set(plan.allowedIntents.filter((i) => EXPLORATION_INTENTS.has(i)))
    : EXPLORATION_INTENTS;

  // Empty intersection = nothing the driver may tap (e.g. auth screen where
  // only `write` is allowed). Return an empty filterable graph.
  if (allowed.size === 0) {
    return { clickables: [], groups: graph.groups || {} };
  }

  const filteredClickables = classifiedClickables.filter((c) => allowed.has(c.intent));
  return {
    clickables: filteredClickables,
    groups: graph.groups || {},
  };
}

/**
 * claim() — defer to v17's structural logic. The claim/decide split means
 * v18 only tightens decide(); claim's cheap XML smell-tests still apply.
 */
function claim(observation) {
  return v17Exploration.claim(observation);
}

/**
 * decide — run v17's existing decision tree on a pre-filtered graph so the
 * structural heuristics (pickNavTab / findListItemTargets /
 * findStructuralBottomBar / scroll) can never fire on intent=write nodes.
 *
 * @param {object} observation
 * @param {object} state
 * @param {object} deps
 * @returns {Promise<object|null>}
 */
async function decide(observation, state, deps = {}) {
  if (!observation || typeof observation !== "object") return null;
  const rawGraph = parseClickableGraph(observation.xml);
  if (rawGraph.clickables.length === 0) {
    // Still let v17 handle the "NestedScrollView with no clickables" scroll path.
    return v17Exploration.decide(observation, state, deps);
  }

  const classified = Array.isArray(deps.classifiedClickables)
    ? deps.classifiedClickables
    : rawGraph.clickables.map((c) => Object.assign({}, c, { intent: "navigate", role: "unknown", priority: 3 }));

  const filterable = deriveFilterable(rawGraph, classified, deps.plan || null);

  // Count the filtered-out size purely for logging — it's the main evidence
  // that the V18 intent filter is doing its job on this screen.
  const dropped = rawGraph.clickables.length - filterable.clickables.length;
  if (dropped > 0) {
    log.info(
      { dropped, kept: filterable.clickables.length, fingerprint: deps.plan && deps.plan.fingerprint },
      "ExplorationDriver: intent filter dropped write/destructive candidates",
    );
  }

  // Phase 3 graph exploration: drop clickables we've already tapped on
  // this fp (the frontier is the set of untried edges). When the frontier
  // is empty the driver yields — dispatcher's post-driver fallback either
  // emits press_back on safe screen types or lets LLMFallback pick an
  // unvisited hub via trajectory hint.
  // 2026-04-25 v2: prefer logical fp so feed/list content rotation doesn't
  // revive the frontier. Fall back to structural fp for older callers /
  // tests that don't set logicalFingerprint on the plan.
  const fp =
    (deps.plan && (deps.plan.logicalFingerprint || deps.plan.fingerprint)) || null;
  const trajectory = deps.trajectory || null;
  let frontierGraph = filterable;
  if (fp && trajectory) {
    const frontier = untappedClickables(trajectory, fp, filterable.clickables);
    const frontierDropped = filterable.clickables.length - frontier.length;
    if (frontierDropped > 0) {
      log.info(
        {
          frontierDropped,
          frontierSize: frontier.length,
          kept: filterable.clickables.length,
          fingerprint: fp,
        },
        "ExplorationDriver: frontier filter dropped already-tapped edges",
      );
    }
    frontierGraph = { clickables: frontier, groups: filterable.groups || {} };

    if (frontier.length === 0 && filterable.clickables.length > 0) {
      const screenType = deps.plan && deps.plan.screenType;

      // Before any back-nav, try a horizontal swipe if the screen hosts a
      // ViewPager / HorizontalPager / LazyRow — a new page may reveal
      // entirely new screens with their own frontier.
      const v17Memory = v17Exploration.initMemory(state);
      if (hasHorizontalPager(observation.xml) && v17Memory) {
        if (!v17Memory.horizontalSwipeByFp) v17Memory.horizontalSwipeByFp = new Map();
        const count = v17Memory.horizontalSwipeByFp.get(fp) || 0;
        if (count < MAX_HORIZONTAL_SWIPES_PER_FP) {
          v17Memory.horizontalSwipeByFp.set(fp, count + 1);
          const { width, height } = inferScreenSize(filterable);
          log.info(
            { fingerprint: fp, screenType, swipes: count + 1 },
            "ExplorationDriver: horizontal-pager detected — swiping to next page",
          );
          return {
            type: "swipe_horizontal",
            direction: "left", // finger right→left = NEXT page
            screenWidth: width,
            screenHeight: height,
          };
        }
      }

      // Phase 4: WebView-heavy screens (FAQs, Terms, in-app browser
      // content) expose few XML clickables even though there's scrollable
      // content. Before the back ladder gives up, try 2-3 vertical scrolls
      // to surface deeper content for the classifier + report capture.
      if (
        EMPTY_FRONTIER_SAFE_BACK_SCREEN_TYPES.has(screenType) &&
        v17Memory &&
        hasWebViewContent(observation.xml)
      ) {
        if (!v17Memory.webviewScrollByFp) v17Memory.webviewScrollByFp = new Map();
        const count = v17Memory.webviewScrollByFp.get(fp) || 0;
        if (count < MAX_WEBVIEW_SCROLLS_PER_FP) {
          v17Memory.webviewScrollByFp.set(fp, count + 1);
          const { width, height } = inferScreenSize(filterable);
          log.info(
            { fingerprint: fp, screenType, scrolls: count + 1 },
            "ExplorationDriver: WebView detected — scrolling down before back-nav",
          );
          return {
            type: "scroll_down",
            screenWidth: width,
            screenHeight: height,
          };
        }
      }

      // Back-nav ladder on safe screen types: press_back → edge_swipe_back → yield.
      if (EMPTY_FRONTIER_SAFE_BACK_SCREEN_TYPES.has(screenType) && v17Memory) {
        if (!v17Memory.backLadderByFp) v17Memory.backLadderByFp = new Map();
        const attempt = v17Memory.backLadderByFp.get(fp) || 0;
        const next = BACK_LADDER_ATTEMPTS[Math.min(attempt, BACK_LADDER_ATTEMPTS.length - 1)];
        v17Memory.backLadderByFp.set(fp, attempt + 1);
        if (next === "press_back") {
          log.info(
            { fingerprint: fp, screenType },
            "ExplorationDriver: frontier empty on safe screen — emitting press_back (ladder step 1)",
          );
          return { type: "press_back" };
        }
        if (next === "edge_swipe_back") {
          const { width, height } = inferScreenSize(filterable);
          log.info(
            { fingerprint: fp, screenType },
            "ExplorationDriver: press_back didn't advance — trying edge_swipe_back (ladder step 2)",
          );
          return {
            type: "edge_swipe_back",
            screenWidth: width,
            screenHeight: height,
          };
        }
        // next === "yield"
        log.info(
          { fingerprint: fp, screenType },
          "ExplorationDriver: back ladder exhausted on safe screen — yielding to LLMFallback",
        );
        return null;
      }

      // Hub screen with empty frontier → yield so LLMFallback can route
      // to an unvisited hub via trajectory hint.
      log.info(
        { fingerprint: fp, screenType },
        "ExplorationDriver: frontier empty on hub screen — yielding to LLMFallback",
      );
      return null;
    }
  }

  // Stash a wrapper observation that exposes the filtered graph. v17's
  // driver reads observation.xml and reparses, which means it'll see the
  // raw clickables again. To keep the heuristics on the filtered set we
  // instead inline v17's decide logic against our graph.
  return decideOnFilteredGraph(observation, state, frontierGraph, deps);
}

/**
 * Inlined version of v17's decide() operating on a pre-filtered graph.
 * Mirrors the decision priority (nav tab → structural bottom bar → list
 * item → scroll) from crawler/v17/drivers/exploration-driver.js decide().
 */
async function decideOnFilteredGraph(observation, state, graph, deps) {
  const { computeStructuralFingerprint } = require("../../v17/node-classifier");
  const memory = v17Exploration.initMemory(state);
  if (!memory) return null;

  const fp = computeStructuralFingerprint(
    graph,
    observation.packageName,
    observation.activity,
  );

  // Interpret the scroll-exhaustion gate (same as v17).
  if (memory.lastActionKind === "scroll" && memory.lastFingerprint === fp) {
    const count = (memory.scrollRetryByFp.get(fp) || 0) + 1;
    memory.scrollRetryByFp.set(fp, count);
    if (count >= 4) {
      memory.scrollExhausted.add(fp);
      log.info({ fingerprint: fp, scrolls: count }, "ExplorationDriver: scroll budget reached");
    }
  }

  // 2026-04-25 v6: drill-down preference. If the current activity has
  // been recorded ≥ HUB_REVISIT_THRESHOLD times, the agent has already
  // tabbed through the bottom nav enough — prefer a list item that opens
  // a detail / new activity over yet another nav tab. This is the load-
  // bearing fix for biztoso-class apps where each nav tap is a different
  // targetText so no targetText-bucketed loop detector ever fires.
  const trajectory2 = deps.trajectory || null;
  const currentActivity = observation && observation.activity;
  if (trajectory2 && currentActivity) {
    const activityVisits = countActivityVisits(trajectory2, currentActivity);
    if (activityVisits >= HUB_REVISIT_THRESHOLD) {
      const listTapEarly = v17Exploration.pickListItem(graph, memory, fp);
      if (listTapEarly) {
        let visited2 = memory.listItemsByFp.get(fp);
        if (!visited2) {
          visited2 = new Set();
          memory.listItemsByFp.set(fp, visited2);
        }
        visited2.add(listTapEarly.key);
        memory.lastActionKind = "tap_item";
        memory.lastFingerprint = fp;
        log.info(
          {
            activityVisits,
            currentActivity,
            label: listTapEarly.item.label || "",
            fingerprint: fp,
            intent: listTapEarly.item.intent,
          },
          "ExplorationDriver: drill-down preference — list item over nav (camped in hub)",
        );
        return tapAction(listTapEarly.item);
      }
    }
  }

  // (a) Prefer unvisited nav tab.
  const navTap = v17Exploration.pickNavTab(graph, memory);
  if (navTap) {
    memory.tabsTapped.add(navTap.key);
    memory.lastActionKind = "tap_nav";
    memory.lastFingerprint = fp;
    log.info(
      { key: navTap.key, label: navTap.nav.label || "", cy: navTap.nav.cy, intent: navTap.nav.intent },
      "ExplorationDriver: tapping unvisited nav",
    );
    return tapAction(navTap.nav);
  }

  // (a.5) Structural bottom-bar fallback (Compose / custom widgets).
  const { height } = inferScreenSize(graph);
  const structuralBar = v17Exploration.findStructuralBottomBar(graph, height);
  for (const c of structuralBar) {
    const key = v17Exploration.elementKey(c);
    if (!memory.tabsTapped.has(key)) {
      memory.tabsTapped.add(key);
      memory.lastActionKind = "tap_nav";
      memory.lastFingerprint = fp;
      log.info(
        { key, label: c.label || "", cy: c.cy, source: "structural_bottom_bar", intent: c.intent },
        "ExplorationDriver: tapping structural bottom-bar candidate",
      );
      return tapAction(c);
    }
  }

  // (b) Unvisited list item.
  const listTap = v17Exploration.pickListItem(graph, memory, fp);
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
      { key: listTap.key, label: listTap.item.label || "", cy: listTap.item.cy, fingerprint: fp, intent: listTap.item.intent },
      "ExplorationDriver: tapping unvisited list item",
    );
    return tapAction(listTap.item);
  }

  // (c) Scroll to reveal more content.
  if (!memory.scrollExhausted.has(fp) && hasScrollableContent(graph, observation.xml)) {
    memory.lastActionKind = "scroll";
    memory.lastFingerprint = fp;
    const { width, height: h } = inferScreenSize(graph);
    const cx = Math.floor(width / 2);
    const y1 = Math.floor(h * 0.75);
    const y2 = Math.floor(h * 0.25);
    log.info({ fingerprint: fp, cx, y1, y2 }, "ExplorationDriver: scrolling down");
    return { type: "swipe", x1: cx, y1, x2: cx, y2 };
  }

  // (d) Nothing to do.
  log.debug({ fingerprint: fp }, "ExplorationDriver: no unvisited target, yielding");
  return null;
}

function inferScreenSize(graph) {
  let width = 0;
  let height = 0;
  for (const c of graph.clickables || []) {
    if (c.bounds && Number.isFinite(c.bounds.x2)) width = Math.max(width, c.bounds.x2);
    if (c.bounds && Number.isFinite(c.bounds.y2)) height = Math.max(height, c.bounds.y2);
  }
  if (!width) width = 1080;
  if (!height) height = 2400;
  return { width, height };
}

function hasScrollableContent(graph, xml) {
  if (graph.clickables.some(v17Exploration.isListContainer)) return true;
  return /class="[^"]*(?:ScrollView|NestedScrollView|LazyColumn|LazyList|RecyclerView)/.test(xml || "");
}

function tapAction(clickable) {
  const action = { type: "tap", x: clickable.cx, y: clickable.cy };
  if (clickable.label) action.targetText = clickable.label;
  return action;
}

/**
 * True when the XML carries a ViewPager-style container — a swipeable
 * page host where swipe_horizontal changes content.
 *
 * @param {string|null|undefined} xml
 * @returns {boolean}
 */
function hasHorizontalPager(xml) {
  if (typeof xml !== "string" || !xml) return false;
  return HORIZONTAL_PAGER_XML_REGEX.test(xml);
}

/**
 * True when the XML includes a WebView node. These screens expose few
 * clickables to the classifier (HTML content isn't in the accessibility
 * tree) so "empty frontier" is misleading — there's content to scroll.
 *
 * @param {string|null|undefined} xml
 * @returns {boolean}
 */
function hasWebViewContent(xml) {
  if (typeof xml !== "string" || !xml) return false;
  return WEBVIEW_XML_REGEX.test(xml);
}

/**
 * Infer screen width/height from the max bounds of the clickables in
 * graph. Fallback to common phone dimensions when the graph is empty or
 * bounds-less.
 */
function inferScreenSize(graph) {
  let w = 0;
  let h = 0;
  if (graph && Array.isArray(graph.clickables)) {
    for (const c of graph.clickables) {
      if (c && c.bounds) {
        if (Number.isFinite(c.bounds.x2)) w = Math.max(w, c.bounds.x2);
        if (Number.isFinite(c.bounds.y2)) h = Math.max(h, c.bounds.y2);
      }
    }
  }
  if (!w || w < 320) w = 1080;
  if (!h || h < 480) h = 2400;
  return { width: w, height: h };
}

module.exports = {
  name: "ExplorationDriver", // keep same name for dispatcher logging compat
  claim,
  decide,
  deriveFilterable,
  hasHorizontalPager,
  hasWebViewContent,
  inferScreenSize,
  EXPLORATION_INTENTS,
  EMPTY_FRONTIER_SAFE_BACK_SCREEN_TYPES,
  HORIZONTAL_PAGER_XML_REGEX,
  WEBVIEW_XML_REGEX,
  MAX_HORIZONTAL_SWIPES_PER_FP,
  MAX_WEBVIEW_SCROLLS_PER_FP,
  BACK_LADDER_ATTEMPTS,
};
