/**
 * policy.js — Crawl policy / action selection
 * Decides what action to take given the current state, history, and user goals.
 * Never picks randomly — uses deterministic scoring and backtracking.
 */

const { ACTION_TYPES } = require('./actions');
const { logger } = require("../lib/logger");
const log = logger.child({ component: "policy" });

/**
 * Boost an action's priority if it matches crawl guidance keywords.
 * @param {object} action
 * @param {object} guidance - { goldenPath, goals, painPoints }
 * @returns {number} Bonus priority
 */
function computeGuidanceBoost(action, guidance) {
  if (!guidance) return 0;

  const text = `${action.text || ''} ${action.contentDesc || ''} ${action.resourceId || ''}`.toLowerCase();
  if (!text.trim()) return 0;

  let boost = 0;
  const sources = [
    guidance.goldenPath,
    guidance.goals,
    guidance.painPoints,
  ].filter(Boolean);

  for (const source of sources) {
    const keywords = source.toLowerCase().split(/[\s,;|]+/).filter(w => w.length > 2);
    for (const kw of keywords) {
      if (text.includes(kw)) {
        boost += 15;
        break; // one boost per source
      }
    }
  }

  return boost;
}

/**
 * Score an action using cross-crawl historical outcomes from screen memory.
 *
 * Confidence-weighted bonus derived from accumulated (ok, bad, newScreen) counts
 * across previous crawls of the same app. The signal is intentionally secondary
 * to in-session scoring — it nudges, it doesn't dominate.
 *
 * Noise floor: requires at least 3 total observations (ok + bad) before emitting
 * a signal, so a single lucky crawl can't pin the policy to one path.
 *
 * Score formula:
 *   raw = successRate * 8 + noveltyRate * 4
 *   confidence = min(totalObservations / 10, 1)
 *   score = round(raw * confidence)
 *
 * Result is capped at +12 in practice, always below the in-session novelty bonus
 * (+10) plus new-screen bonus (+5), so fresh exploration still wins ties.
 *
 * @param {object} action - Must have a `.key` property
 * @param {Map<string, { actionOutcomes: Object }> | null} screenMemory
 * @param {string | null} fingerprint - Current screen fingerprint
 * @returns {number} Non-negative bonus
 */
function getHistoricalScore(action, screenMemory, fingerprint) {
  if (!screenMemory || !fingerprint || !action.key) return 0;

  const screenEntry = screenMemory.get(fingerprint);
  if (!screenEntry || !screenEntry.actionOutcomes) return 0;

  const entry = screenEntry.actionOutcomes[action.key];
  if (!entry || typeof entry !== "object") return 0;

  const ok = entry.ok || 0;
  const bad = entry.bad || 0;
  const newScreen = entry.newScreen || 0;
  const total = ok + bad;

  if (total < 3) return 0;

  const successRate = ok / total;
  const noveltyRate = newScreen / total;
  const confidence = Math.min(total / 10, 1);

  return Math.round((successRate * 8 + noveltyRate * 4) * confidence);
}

/**
 * Score an action based on historical outcomes in the state graph.
 *
 * Combines three signals:
 *   +10  novelty bonus   — action has never been tried on this screen
 *    +5  new-screen bonus — action previously led to a screen with visitCount <= 1
 *   -15  cross-screen penalty — same action key had a bad outcome on ANY other
 *        node that shares the same activity as the current node
 *
 * @param {object} action          - Must have a `.key` property
 * @param {import('./graph').StateGraph | null} stateGraph
 * @param {string | null} fingerprint - Current screen fingerprint
 * @returns {number} Combined score (may be negative)
 */
function computeOutcomeScore(action, stateGraph, fingerprint) {
  if (!stateGraph || !fingerprint || !action.key) return 0;

  let score = 0;

  // --- Novelty bonus (+10): action never tried on this screen ---
  const tried = stateGraph.triedActionsFor(fingerprint);
  if (!tried.has(action.key)) {
    score += 10;
  }

  // --- New-screen bonus (+5): action previously led to a screen with visitCount <= 1 ---
  const matchingTransitions = stateGraph.transitions.filter(
    t => t.from === fingerprint && t.action === action.key
  );
  for (const t of matchingTransitions) {
    const targetVisitCount = stateGraph.visitCount(t.to);
    if (targetVisitCount <= 1) {
      score += 5;
      break; // one bonus is enough
    }
  }

  // --- Cross-screen penalty (-15): same action key has a bad outcome on another node with the same activity ---
  const currentNode = stateGraph.nodes.get(fingerprint);
  const currentActivity = currentNode?.screenData?.activity;

  if (currentActivity) {
    const BAD_OUTCOMES = new Set(['out_of_app', 'crash', 'ineffective']);

    for (const [fp, node] of stateGraph.nodes) {
      if (fp === fingerprint) continue;
      if (node.screenData?.activity !== currentActivity) continue;

      const outcome = node.actionOutcomes.get(action.key);
      if (outcome && BAD_OUTCOMES.has(outcome)) {
        score -= 15;
        break; // one penalty is enough
      }
    }
  }

  return score;
}

/**
 * Choose the best action from candidates given graph state and guidance.
 *
 * Decision logic:
 * 1. If in a loop → backtrack (press back)
 * 2. If no untried actions available → backtrack
 * 3. Otherwise → highest-priority untried action, boosted by guidance keywords
 *    AND by cross-crawl historical signal (if screenMemory is provided)
 *
 * @param {Array<object>} candidates - Ranked actions from actions.extract()
 * @param {import('./graph').StateGraph} graph
 * @param {string} currentFingerprint
 * @param {object} config - { goldenPath, goals, painPoints, maxRevisits, screenMemory }
 * @returns {{ action: object, reason: string } | { action: { type: 'stop' }, reason: string }}
 */
function choose(candidates, graph, currentFingerprint, config = {}) {
  const maxRevisits = config.maxRevisits || 4;

  // Step 1: Get untried actions, filtering out bad-outcome actions (ineffective, out-of-app, crash, dead-end)
  const tried = graph.triedActionsFor(currentFingerprint);
  const badActions = graph.badActionsFor(currentFingerprint);
  const allUntried = candidates.filter(a => !tried.has(a.key));
  const effectiveUntried = allUntried.filter(a => !badActions.has(a.key));

  // Step 2: If we have effective untried actions, ALWAYS try them — regardless of loops
  if (effectiveUntried.length > 0) {
    const guidance = {
      goldenPath: config.goldenPath,
      goals: config.goals,
      painPoints: config.painPoints,
    };
    const screenMemory = config.screenMemory || null;

    const boosted = effectiveUntried.map(a => {
      const guidanceBoost = computeGuidanceBoost(a, guidance);
      const historicalBoost = getHistoricalScore(a, screenMemory, currentFingerprint);
      return {
        ...a,
        effectivePriority: a.priority + guidanceBoost + historicalBoost,
        _guidanceBoost: guidanceBoost,
        _historicalBoost: historicalBoost,
      };
    });

    boosted.sort((a, b) => b.effectivePriority - a.effectivePriority);

    const chosen = boosted[0];
    log.info(
      {
        type: chosen.type,
        text: chosen.text || chosen.resourceId || "",
        priority: chosen.effectivePriority,
        basePriority: chosen.priority,
        guidanceBoost: chosen._guidanceBoost,
        historicalBoost: chosen._historicalBoost,
        untried: effectiveUntried.length,
        badSkipped: badActions.size,
      },
      "Action chosen"
    );

    return {
      action: chosen,
      reason: 'highest_priority_untried',
    };
  }

  // Step 3: No effective untried actions — check if we should backtrack or stop
  const skippedCount = allUntried.length - effectiveUntried.length;
  if (skippedCount > 0) {
    log.info({ skippedCount }, "Untried actions skipped (bad outcomes)");
  }

  // Loop detection — only checked when no untried actions remain
  if (graph.detectLoop(10, 2)) {
    log.info("Loop detected (no untried actions) — backtracking");
    return {
      action: { type: ACTION_TYPES.BACK, key: 'back' },
      reason: 'loop_detected',
    };
  }

  // Max revisits check
  if (graph.visitCount(currentFingerprint) > maxRevisits) {
    log.info({ visits: graph.visitCount(currentFingerprint) }, "Max revisits exceeded — backtracking");
    return {
      action: { type: ACTION_TYPES.BACK, key: 'back' },
      reason: 'max_revisits_exceeded',
    };
  }

  if (graph.uniqueStateCount() <= 1) {
    return {
      action: { type: 'stop' },
      reason: 'no_actions_available',
    };
  }

  log.info("All actions tried/ineffective — backtracking");
  return {
    action: { type: ACTION_TYPES.BACK, key: 'back' },
    reason: 'all_actions_exhausted',
  };
}

module.exports = { choose, computeGuidanceBoost, computeOutcomeScore, getHistoricalScore };
