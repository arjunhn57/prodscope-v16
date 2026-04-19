"use strict";

/**
 * planner.js — Strategic exploration planner
 *
 * Makes 1 LLM call at crawl start to produce an exploration plan based on
 * app metadata + user goals. The plan guides the action ranker to prioritize
 * untested features.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { ANALYSIS_MODEL } = require("../config/defaults");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "planner" });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Create an initial exploration plan.
 * @param {object} appProfile - { packageName, activities, permissions, appName }
 * @param {object} userConfig - { goals, painPoints, goldenPath }
 * @param {string} appCategory - Heuristic category (e.g. "social", "ecommerce")
 * @returns {Promise<{ targets: string[], priority: string, notes: string }>}
 */
async function createInitialPlan(appProfile, userConfig, appCategory) {
  const prompt = `You are a QA test planner. Given an Android app profile, produce a test plan.

App: ${appProfile.packageName || "unknown"}
Name: ${appProfile.appName || "unknown"}
Category: ${appCategory || "unknown"}
Declared activities: ${(appProfile.activities || []).slice(0, 20).join(", ") || "unknown"}
Permissions: ${(appProfile.permissions || []).slice(0, 15).join(", ") || "none"}
User goals: ${userConfig.goals || "General QA review"}
User pain points: ${userConfig.painPoints || "None specified"}
Golden path: ${userConfig.goldenPath || "Not specified"}

Return JSON only: { "targets": ["auth", "main_feed", ...], "priority": "breadth_first" | "depth_first", "notes": "..." }

Rules:
- targets should be feature areas to test (auth, feed, search, settings, profile, content_creation, etc.)
- Order targets by importance
- Max 8 targets
- Keep notes under 100 words`;

  try {
    const response = await anthropic.messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].text;
    const planTokenUsage = response.usage || { input_tokens: 0, output_tokens: 0 };
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const plan = JSON.parse(cleaned);

    // Validate shape
    if (!Array.isArray(plan.targets) || plan.targets.length === 0) {
      const fb = fallbackPlan();
      fb._tokenUsage = planTokenUsage;
      return fb;
    }

    return {
      targets: plan.targets.slice(0, 8),
      priority: plan.priority || "breadth_first",
      notes: plan.notes || "",
      currentTargetIndex: 0,
      _tokenUsage: planTokenUsage,
    };
  } catch (e) {
    log.error({ err: e }, "LLM plan failed, using fallback");
    return fallbackPlan();
  }
}

/**
 * Deterministic fallback plan when LLM is unavailable.
 */
function fallbackPlan() {
  return {
    targets: ["auth", "main_feed", "search", "settings", "profile", "content_creation"],
    priority: "breadth_first",
    notes: "Fallback plan — LLM unavailable",
    currentTargetIndex: 0,
  };
}

/**
 * Get the current target from the plan.
 */
function currentTarget(plan) {
  if (!plan || !plan.targets) return null;
  if (plan.currentTargetIndex >= plan.targets.length) return null;
  return plan.targets[plan.currentTargetIndex];
}

/**
 * Advance to the next target (call when current target is covered/saturated).
 */
function advanceTarget(plan) {
  if (plan && plan.currentTargetIndex < plan.targets.length) {
    plan.currentTargetIndex++;
  }
}

/**
 * Compute a priority boost for an action based on the current plan target.
 * @param {object} action - Action object with text/resourceId/contentDesc
 * @param {object} plan - The exploration plan
 * @returns {number} Boost amount (0 or 20)
 */
function planBoost(action, plan) {
  const target = currentTarget(plan);
  if (!target) return 0;

  const haystack = `${action.text || ""} ${action.contentDesc || ""} ${action.resourceId || ""}`.toLowerCase();
  const targetLower = target.toLowerCase().replace(/_/g, " ");

  // Direct keyword match
  if (haystack.includes(targetLower) || haystack.includes(target.toLowerCase())) {
    return 20;
  }

  // Partial keyword match (e.g. "content_creation" matches "create", "post", "compose")
  const synonyms = TARGET_SYNONYMS[target] || [];
  for (const syn of synonyms) {
    if (haystack.includes(syn)) return 15;
  }

  return 0;
}

/**
 * Re-plan exploration strategy at navigation hubs.
 * Called every ~15 steps when the crawler is at a navigation hub screen.
 * Uses coverage data to adjust priorities — ~1,500 tokens per call.
 *
 * @param {object} currentPlan - The current plan object
 * @param {object} coverageSummary - From coverageTracker.summary()
 * @param {object} screen - { screenType, activity, keyLabels }
 * @returns {Promise<object>} Updated plan
 */
async function replan(currentPlan, coverageSummary, screen, explorationMap) {
  const covLines = Object.entries(coverageSummary || {})
    .map(([k, v]) => `${k}: ${v.uniqueScreens || 0} screens, ${v.status || "unknown"}`)
    .join("\n");

  const remaining = (currentPlan.targets || [])
    .slice(currentPlan.currentTargetIndex || 0)
    .join(", ");

  const prompt = `You are a QA test planner re-evaluating an Android app exploration strategy mid-crawl.

Current plan targets (remaining): ${remaining || "none"}
Current screen: ${screen.screenType || "unknown"} (${screen.activity || "unknown"})
Visible elements: ${(screen.keyLabels || []).slice(0, 10).join(", ") || "none"}

Coverage so far:
${covLines || "No coverage data yet"}
${explorationMap ? `\n${explorationMap}\n` : ""}
Based on coverage gaps, re-prioritize the remaining targets. Drop targets that are already "saturated" or "covered". Add any new targets visible from the current screen that weren't in the original plan.

Return JSON only: { "targets": ["target1", "target2", ...], "priority": "breadth_first" | "depth_first", "reason": "short explanation" }

Rules:
- Max 6 targets
- Order by importance (uncovered first)
- Keep reason under 50 words`;

  try {
    const response = await anthropic.messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].text;
    const replanTokenUsage = response.usage || { input_tokens: 0, output_tokens: 0 };
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const result = JSON.parse(cleaned);

    if (!Array.isArray(result.targets) || result.targets.length === 0) {
      log.info("Replan returned empty targets, keeping current plan");
      return { ...currentPlan, _tokenUsage: replanTokenUsage };
    }

    log.info({ targets: result.targets, reason: result.reason }, "Replanned");

    return {
      ...currentPlan,
      targets: result.targets.slice(0, 6),
      priority: result.priority || currentPlan.priority,
      currentTargetIndex: 0,
      replanCount: (currentPlan.replanCount || 0) + 1,
      lastReplanReason: result.reason || "",
      _tokenUsage: replanTokenUsage,
    };
  } catch (e) {
    log.error({ err: e }, "Replan LLM call failed");
    return currentPlan; // keep current plan on failure
  }
}

const TARGET_SYNONYMS = {
  auth: ["login", "sign in", "sign up", "register", "email", "password"],
  main_feed: ["home", "feed", "timeline", "stream"],
  search: ["search", "find", "discover", "explore"],
  settings: ["settings", "preferences", "account", "config"],
  profile: ["profile", "my account", "avatar", "edit profile"],
  content_creation: ["create", "compose", "post", "upload", "new", "write", "camera"],
  messaging: ["message", "chat", "inbox", "conversation"],
  commerce: ["cart", "checkout", "buy", "purchase", "shop", "order"],
  notifications: ["notification", "alert", "bell"],
};

/**
 * Build a compact exploration map string from coverage, graph, and mode data.
 * Zero LLM cost — pure formatting for vision/replan context.
 */
function buildExplorationMap(coverageTracker, stateGraph, modeManager) {
  const summary = coverageTracker ? coverageTracker.summary() : {};
  const lines = Object.entries(summary)
    .filter(([f]) => !f.startsWith("other_"))
    .map(([f, v]) => `${f} (${v.uniqueScreens || 0} screens, ${v.status || "unknown"})`)
    .join(", ");

  const totalScreens = stateGraph ? stateGraph.uniqueStateCount() : 0;
  const totalSteps = modeManager ? modeManager.stepsUsed : 0;
  const budgetPct = modeManager ? Math.round(modeManager.budgetUsedPercent() * 100) : 0;
  const currentMode = modeManager ? modeManager.currentMode : "UNKNOWN";
  const leastCovered = coverageTracker ? coverageTracker.leastCoveredCategory() : null;

  return [
    "EXPLORATION MAP:",
    `  Features: ${lines || "none"}`,
    `  Total: ${totalScreens} unique screens in ${totalSteps} steps`,
    leastCovered ? `  Least covered: ${leastCovered}` : null,
    `  Mode: ${currentMode} (${budgetPct}% budget used)`,
  ].filter(Boolean).join("\n");
}

/**
 * Re-evaluate the plan at crawl midpoint.
 * Drops covered targets, reprioritizes based on coverage gaps.
 * Budget: 1 Haiku call (~800 tokens).
 *
 * @param {object} currentPlan
 * @param {object} coverageSummary
 * @param {number} uniqueScreens
 * @returns {Promise<object>} Updated plan
 */
async function replanMidCrawl(currentPlan, coverageSummary, uniqueScreens, explorationMap) {
  try {
    const prompt = `You are a QA test planner. A crawl is 50% complete. Update the plan.

Current targets: ${JSON.stringify(currentPlan.targets)}
Current target index: ${currentPlan.currentTargetIndex}
Coverage: ${JSON.stringify(coverageSummary)}
Unique screens found: ${uniqueScreens}
${explorationMap ? `\n${explorationMap}\n` : ""}

Rules:
- Drop targets with status "saturated"
- Keep targets with status "exploring"
- Add targets for features with 0 visits that seem reachable
- Reorder by priority (most important first)
- Max 6 targets

Return JSON only: {"targets":["..."],"priority":"breadth_first","dropped":["..."],"reason":"brief"}`;

    const response = await anthropic.messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].text;
    const midTokenUsage = response.usage || { input_tokens: 0, output_tokens: 0 };
    const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const result = JSON.parse(cleaned);

    if (!Array.isArray(result.targets) || result.targets.length === 0) {
      return { ...currentPlan, _tokenUsage: midTokenUsage };
    }

    log.info({ dropped: result.dropped, targets: result.targets }, "Mid-crawl replan complete");

    return {
      ...currentPlan,
      targets: result.targets.slice(0, 6),
      priority: result.priority || currentPlan.priority,
      currentTargetIndex: 0,
      _tokenUsage: midTokenUsage,
    };
  } catch (e) {
    log.error({ err: e }, "Mid-crawl replan failed");
    return currentPlan;
  }
}

module.exports = { createInitialPlan, replan, replanMidCrawl, currentTarget, advanceTarget, planBoost, fallbackPlan, buildExplorationMap };
