// @ts-check
"use strict";

/**
 * policy-step.js — Action selection via policy + recovery intercept.
 *
 * @typedef {import('./types/crawl-context').CrawlContext} Ctx
 */

const actions = require("./actions");
const policy = require("./policy");
const { SITUATION } = require("./recovery");
const { getPrimaryPackage } = require("./out-of-app");
const agent = require("./agent");
const agentPrefetch = require("./agent-prefetch");

/**
 * @typedef {{ key: string, type?: string, [k: string]: any }} Candidate
 * @typedef {{ action: Candidate, reason: string }} Decision
 */

/**
 * Select an action via policy and intercept backtrack decisions that should
 * trigger recovery instead.
 *
 * @param {Ctx} ctx
 * @param {Candidate[]} candidates
 * @param {Set<string>} tried
 * @param {string} fp
 * @param {number} step
 * @param {{ xml: string }} snapshot
 * @param {{ feature?: string } | null} classification
 * @returns {Promise<{ decision: Decision, directive: 'proceed'|'continue'|'break', breakReason?: string }>}
 */
async function selectAction(ctx, candidates, tried, fp, step, snapshot, classification) {
  const { packageName, actionsTaken } = ctx;
  if (!ctx.stateGraph) throw new Error("selectAction: stateGraph not initialized");
  const stateGraph = /** @type {import('./graph').StateGraph} */ (/** @type {unknown} */ (ctx.stateGraph));

  const agentLoopOn = process.env.AGENT_LOOP === "true";
  const hasSnapshot = !!snapshot;
  const hasScreenshotPath = !!(snapshot && /** @type {any} */ (snapshot).screenshotPath);
  ctx.log.info({
    step,
    agentLoopOn,
    candidatesLen: candidates.length,
    hasSnapshot,
    hasScreenshotPath,
    screenshotPath: snapshot && /** @type {any} */ (snapshot).screenshotPath,
  }, "[agent] gating check");

  if (agentLoopOn && candidates.length > 0 && hasSnapshot) {
    const elements = candidates.map((c, i) => ({
      index: i,
      type: c.type || "unknown",
      label: c.text || c.contentDesc || (c.resourceId ? c.resourceId.split("/").pop() : "") || `(${c.className || "element"})`,
      priority: c.priority || 0,
    }));

    const recentHistory = (ctx.explorationJournal || []).slice(-8).map(j => ({
      step: typeof j.step === "number" ? j.step : 0,
      action: typeof j.action === "string" ? j.action : "",
      outcome: typeof j.outcome === "string" ? j.outcome : "",
    }));

    const appMapSummary = ctx.appMap ? {
      totalScreens: ctx.appMap.screenNodes ? ctx.appMap.screenNodes.size : 0,
      navTabs: (ctx.appMap.navTabs || []).map((/** @type {any} */ t) => ({
        label: t.label,
        explored: !!t.explored,
        exhausted: !!t.exhausted,
      })),
    } : { totalScreens: 0, navTabs: [] };

    let agentDecision = null;
    try {
      agentDecision = await agent.decide({
        goal: ctx.goals || "Explore the app and discover its main features",
        credentials: ctx.credentials || null,
        packageName: ctx.packageName,
        stepNumber: step,
        maxSteps: ctx.maxSteps,
        visitedScreensCount: ctx.stateGraph && typeof ctx.stateGraph.uniqueStateCount === "function" ? ctx.stateGraph.uniqueStateCount() : 0,
        currentScreenType: classification ? (classification.feature || "unknown") : "unknown",
        screenshotPath: /** @type {any} */ (snapshot).screenshotPath || null,
        elements,
        recentHistory,
        appMapSummary,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      ctx.log.error({ err: errMsg, step }, "[agent] decide threw, falling back to policy.choose");
      agentDecision = null;
    }

    if (agentDecision && agentDecision.actionIndex >= 0 && agentDecision.actionIndex < candidates.length) {
      ctx.log.info({ step, actionIndex: agentDecision.actionIndex, reasoning: agentDecision.reasoning }, "[agent] decision used");
      return {
        decision: {
          action: candidates[agentDecision.actionIndex],
          reason: `agent: ${agentDecision.reasoning}`,
          expectedOutcome: agentDecision.expectedOutcome || null,
        },
        directive: "proceed",
      };
    }
  }

  const decision = /** @type {Decision} */ (policy.choose(candidates, stateGraph, fp, {
    goldenPath: ctx.goldenPath,
    goals: ctx.goals,
    painPoints: ctx.painPoints,
    screenMemory: ctx.screenMemory,
  }));

  if (decision.action.type === "stop") {
    ctx.log.info({ reason: decision.reason }, "Policy says stop");
    return { decision, directive: "break", breakReason: decision.reason };
  }

  if (classification && classification.feature === "content_creation") {
    ctx.log.info("Content-creation action selected");
  }

  // Defense-in-depth: intercept back-for-exhaustion when we're still in-app
  const currentPackage = getPrimaryPackage(snapshot.xml);
  const pM = currentPackage === packageName;
  const tM = decision?.action?.type === "back" || decision?.action?.type === actions.ACTION_TYPES.BACK;
  const rM = ["loop_detected", "max_revisits_exceeded", "all_actions_exhausted"].includes(decision.reason);

  const ineffectiveSet = stateGraph.badActionsFor(fp);
  const effectiveUntriedCount = candidates.filter(a => !tried.has(a.key) && !ineffectiveSet.has(a.key)).length;

  ctx.log.debug({ pkgMatch: pM, typeMatch: tM, reasonMatch: rM, effectiveUntried: effectiveUntriedCount }, "Intercept evaluator");

  const shouldSubstituteRecoveryRelaunch = tM && rM && pM && effectiveUntriedCount === 0;

  if (shouldSubstituteRecoveryRelaunch) {
    const situation = decision.reason === "loop_detected" ? SITUATION.LOOP_DETECTED : SITUATION.ALL_EXHAUSTED;
    ctx.log.info({ situation }, "Recovery triggered (0 untried actions)");

    const recResult = await ctx.recoveryManager.recover(situation, fp, ctx);
    actionsTaken.push({
      step,
      type: "recovery",
      description: `recovery_${recResult.strategy}(${recResult.success ? "ok" : "fail"})`,
      reason: `recovery_for_${decision.reason}`,
      actionKey: `recovery_${recResult.strategy}`,
      fromFingerprint: fp,
    });

    if (!recResult.success) {
      ctx.log.warn({ situation }, "All recovery strategies failed");
    }
    ctx.modeManager.recordStep();
    return { decision, directive: "continue" };
  }

  return { decision, directive: "proceed" };
}

/**
 * Extract up to 20 unique advisory text hints from raw UIAutomator XML.
 * On Compose/RN/Flutter apps these will often be empty or generic — the agent
 * must work purely from the screenshot. Hints are advisory only.
 *
 * @param {string} xml
 * @returns {string[]}
 */
function extractXmlTextHints(xml) {
  if (!xml || typeof xml !== "string") return [];
  const hints = new Set();
  const rx = /(?:text|content-desc)="([^"]{2,80})"/g;
  let m;
  while ((m = rx.exec(xml)) !== null && hints.size < 20) {
    const t = m[1].trim();
    if (t && t !== "null" && !/^\s*$/.test(t)) hints.add(t);
  }
  return Array.from(hints);
}

/**
 * Convert an AgentCoordDecision into an executor-compatible action object.
 *
 * @param {import('./agent').AgentCoordDecision} d
 * @returns {{ type: string, key: string, [k: string]: any }}
 */
function coordDecisionToAction(d) {
  switch (d.action) {
    case "tap":
      return {
        type: actions.ACTION_TYPES.AGENT_TAP,
        x: d.x, y: d.y,
        key: `agent_tap_${d.x}_${d.y}`,
        text: `tap(${d.x},${d.y})`,
      };
    case "type":
      return {
        type: actions.ACTION_TYPES.AGENT_TYPE,
        text: d.text,
        key: `agent_type_${(d.text || "").slice(0, 20)}`,
      };
    case "swipe":
      return {
        type: actions.ACTION_TYPES.AGENT_SWIPE,
        x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2,
        durationMs: d.durationMs || 300,
        key: `agent_swipe_${d.x1}_${d.y1}_${d.x2}_${d.y2}`,
        text: `swipe(${d.x1},${d.y1}->${d.x2},${d.y2})`,
      };
    case "long_press":
      return {
        type: actions.ACTION_TYPES.AGENT_LONG_PRESS,
        x: d.x, y: d.y,
        key: `agent_long_press_${d.x}_${d.y}`,
        text: `long_press(${d.x},${d.y})`,
      };
    case "back":
      return { type: actions.ACTION_TYPES.AGENT_BACK, key: "agent_back", text: "back" };
    case "wait":
      return {
        type: actions.ACTION_TYPES.AGENT_WAIT,
        durationMs: d.durationMs,
        key: `agent_wait_${d.durationMs}`,
        text: `wait(${d.durationMs}ms)`,
      };
    default:
      throw new Error(`coordDecisionToAction: unknown action ${/** @type {any} */ (d).action}`);
  }
}

/**
 * Deterministic safety net for the vision-first loop.
 *
 * When Claude misreads a button position by tens of pixels the tap lands on
 * empty space, the screen does not change, and on the next step Claude
 * re-examines the same screenshot and picks the same coordinate again. That
 * loop can eat an entire crawl on a single dead pixel. This override breaks
 * the loop on the client side.
 *
 *   - First repeat of an identical failed tap/long_press: shift y by +120px
 *     (text labels usually sit above their tappable targets on mobile forms).
 *   - Second consecutive repeat: fall back to pressing back.
 *
 * @param {any} action
 * @param {Array<{ step: number, action: string, outcome: string }>} recentHistory
 * @returns {{ action: any, overridden: boolean, note: string }}
 */
function dedupeRepeatedFailedTap(action, recentHistory) {
  if (!action || !recentHistory || recentHistory.length === 0) {
    return { action, overridden: false, note: "" };
  }
  if (action.type !== actions.ACTION_TYPES.AGENT_TAP && action.type !== actions.ACTION_TYPES.AGENT_LONG_PRESS) {
    return { action, overridden: false, note: "" };
  }
  const currentLabel = action.text || "";
  const last = recentHistory[recentHistory.length - 1];
  if (!last || last.outcome !== "no_change") return { action, overridden: false, note: "" };
  if (last.action !== currentLabel) return { action, overridden: false, note: "" };

  const secondLast = recentHistory.length >= 2 ? recentHistory[recentHistory.length - 2] : null;
  const twoInARow = !!(secondLast && secondLast.action === currentLabel && secondLast.outcome === "no_change");

  if (twoInARow) {
    return {
      action: { type: actions.ACTION_TYPES.AGENT_BACK, key: "agent_back_deduped", text: "back" },
      overridden: true,
      note: `dedupe: ${currentLabel} failed twice -> back`,
    };
  }
  const shiftedY = Math.min(2300, action.y + 120);
  return {
    action: {
      ...action,
      y: shiftedY,
      key: `agent_tap_${action.x}_${shiftedY}`,
      text: `tap(${action.x},${shiftedY})`,
    },
    overridden: true,
    note: `dedupe: shifted ${currentLabel} y -> ${shiftedY}`,
  };
}

/**
 * Vision-first decision path. Skips candidate extraction entirely; goes straight
 * from snapshot to LLM coord decision to action. Used when ctx.visionFirstMode === true.
 *
 * Track F will add a parallel-prefetch short-circuit at the top of this function;
 * for now it's a straight sync call.
 *
 * @param {Ctx} ctx
 * @param {{ xml: string, screenshotPath: string | null, screenshotHash?: string }} snapshot
 * @param {number} step
 * @param {{ feature?: string } | null} classification
 * @returns {Promise<{ decision: { action: any, reason: string }, directive: 'proceed'|'continue'|'break' }>}
 */
async function selectActionVisionFirst(ctx, snapshot, step, classification) {
  if (!ctx.stateGraph) throw new Error("selectActionVisionFirst: stateGraph not initialized");

  if (!snapshot || !snapshot.screenshotPath) {
    ctx.log.warn({ step }, "[vision-first] no screenshot, pressing back as safe default");
    return {
      decision: {
        action: { type: actions.ACTION_TYPES.AGENT_BACK, key: "agent_back_nosnap" },
        reason: "vision_first_no_snapshot",
      },
      directive: "proceed",
    };
  }

  // Track F: Try prefetched decision first. Falls back to sync call on miss.
  /** @type {any} */
  let coordDecision = null;
  /** @type {boolean} */
  let fromPrefetch = false;
  try {
    coordDecision = await agentPrefetch.consumePrefetch(step, snapshot);
    if (coordDecision) fromPrefetch = true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    ctx.log.debug({ err: errMsg, step }, "[vision-first] prefetch consume failed, will call sync");
    coordDecision = null;
  }

  if (!coordDecision) {
    // Cache miss — build input and call agent.decideCoordinates sync.
    const xmlHints = extractXmlTextHints(snapshot.xml || "");

    const recentHistory = (ctx.explorationJournal || []).slice(-8).map((/** @type {any} */ j) => ({
      step: typeof j.step === "number" ? j.step : 0,
      action: typeof j.action === "string" ? j.action : "",
      outcome: typeof j.outcome === "string" ? j.outcome : "",
    }));

    const appMapSummary = ctx.appMap ? {
      totalScreens: ctx.appMap.screenNodes ? ctx.appMap.screenNodes.size : 0,
      navTabs: (ctx.appMap.navTabs || []).map((/** @type {any} */ t) => ({
        label: t.label,
        explored: !!t.explored,
        exhausted: !!t.exhausted,
      })),
    } : { totalScreens: 0, navTabs: [] };

    try {
      coordDecision = await agent.decideCoordinates({
        goal: ctx.goals || "Explore the app and discover its main features",
        credentials: ctx.credentials || null,
        packageName: ctx.packageName,
        stepNumber: step,
        maxSteps: ctx.maxSteps,
        visitedScreensCount: ctx.stateGraph && typeof ctx.stateGraph.uniqueStateCount === "function" ? ctx.stateGraph.uniqueStateCount() : 0,
        currentScreenType: classification ? (classification.feature || "unknown") : "unknown",
        screenshotPath: snapshot.screenshotPath,
        recentHistory,
        appMapSummary,
        xmlHints,
        visionFirstMode: true,
      }, { ctx });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      ctx.log.error({ err: errMsg, step }, "[vision-first] agent.decideCoordinates threw, falling back to back");
      coordDecision = { action: "back", reasoning: "agent error fallback", expectedOutcome: "navigate back" };
    }
  }

  const rawAction = coordDecisionToAction(coordDecision);
  const reasonText = coordDecision.reasoning || "vision-first";
  const sourceLabel = fromPrefetch ? "prefetch" : "sync";

  // Deterministic safety net: break identical-failed-tap loops before they
  // waste the whole crawl on a single miscalibrated button coordinate.
  const dedupHistory = (ctx.explorationJournal || []).slice(-4).map((/** @type {any} */ j) => ({
    step: typeof j.step === "number" ? j.step : 0,
    action: typeof j.action === "string" ? j.action : "",
    outcome: typeof j.outcome === "string" ? j.outcome : "",
  }));
  const { action, overridden, note } = dedupeRepeatedFailedTap(rawAction, dedupHistory);
  if (overridden) {
    ctx.log.info({ step, note, original: rawAction.text, override: action.text }, "[vision-first] dedup override");
  }

  ctx.log.info({
    step,
    actionType: action.type,
    actionLabel: action.text,
    reasoning: reasonText,
    source: sourceLabel,
    overridden,
  }, "[vision-first] decision");

  return {
    decision: {
      action,
      reason: `vision-first${fromPrefetch ? "-prefetched" : ""}${overridden ? "-deduped" : ""}: ${reasonText}`,
      expectedOutcome: (coordDecision && typeof coordDecision.expectedOutcome === 'string' && coordDecision.expectedOutcome) || null,
    },
    directive: "proceed",
  };
}

module.exports = { selectAction, selectActionVisionFirst, coordDecisionToAction, extractXmlTextHints };
