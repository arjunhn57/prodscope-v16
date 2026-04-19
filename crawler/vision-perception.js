"use strict";

/**
 * vision-perception.js — Unified vision perception module.
 *
 * Consolidates screen classification + action extraction + nav detection
 * into a single Haiku vision call, doubling the effective vision budget.
 *
 * Returns a VisionPerception object:
 *   { screenType, screenDescription, navBar, mainActions, isAuthScreen, isLoading, contentDensity }
 *
 * Two-tier screenshot cache:
 *   Tier 1: Exact screenshot hash (hamming 0) → skip vision call
 *   Tier 2: Fuzzy match (hamming ≤ 8) → use cached, mark fuzzy: true
 */

const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");
const { VISION_MODEL, MAX_VISION_CALLS_PER_CRAWL } = require("../config/defaults");
const { isBlankScreenshot, generateWireframeText } = require("./wireframe");
const screenshotFp = require("./screenshot-fp");
const { parsePerceptionJson, normalizePerception } = require("./schemas/perception");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "vision-perception" });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Budget tracked by vision.js — we import and defer to it
const vision = require("./vision");

/**
 * Two-tier cache: keyed by screenshot hash, stores VisionPerception results.
 * Shared across the crawl via CrawlContext.
 */
class PerceptionCache {
  /**
   * @param {{ fuzzyThreshold?: number }} [opts]
   */
  constructor(opts) {
    this._entries = new Map(); // ssHash → { perception, timestamp }
    this._fuzzyThreshold = (opts && opts.fuzzyThreshold) || 8;
  }

  /**
   * E8: Set the fuzzy threshold dynamically (e.g., 12 for framework-adaptive mode).
   * @param {number} threshold
   */
  setFuzzyThreshold(threshold) {
    this._fuzzyThreshold = threshold;
  }

  /**
   * Exact lookup (Tier 1): hamming distance 0.
   * @param {string} ssHash
   * @returns {{ perception: object, fuzzy: boolean }|null}
   */
  get(ssHash) {
    if (!ssHash || ssHash === "no_screenshot") return null;

    // Tier 1: exact match
    if (this._entries.has(ssHash)) {
      return { perception: this._entries.get(ssHash).perception, fuzzy: false };
    }

    // Tier 2: fuzzy match (hamming ≤ threshold)
    for (const [cachedHash, entry] of this._entries) {
      if (screenshotFp.isSameScreen(ssHash, cachedHash, this._fuzzyThreshold)) {
        return { perception: entry.perception, fuzzy: true };
      }
    }

    return null;
  }

  /**
   * Store a perception result keyed by screenshot hash.
   * @param {string} ssHash
   * @param {object} perception
   */
  set(ssHash, perception) {
    if (!ssHash || ssHash === "no_screenshot") return;
    this._entries.set(ssHash, { perception, timestamp: Date.now() });
  }

  get size() {
    return this._entries.size;
  }
}

const adb = require("./adb");
const MARGIN = 10;

/**
 * Build the unified perception prompt.
 *
 * @param {object} opts
 * @param {boolean} opts.isBlank - Whether the screenshot is blocked (FLAG_SECURE)
 * @param {string} [opts.wireframe] - Wireframe text for blank screenshots
 * @param {string} [opts.classification] - Current XML-based classification (if available)
 * @param {number} [opts.triedCount] - Steps so far
 * @param {string} [opts.goal] - Current exploration target
 * @param {string} [opts.previousAction] - Formatted previous action + outcome
 * @param {string} [opts.journal] - Formatted exploration history
 * @returns {string}
 */
function buildPerceptionPrompt(opts) {
  const parts = [];

  parts.push(
    opts.isBlank
      ? "You are a QA tester exploring an Android app. The screenshot is blocked (FLAG_SECURE) — use the wireframe below."
      : "You are a QA tester exploring an Android app. Look at this screenshot."
  );

  parts.push("");
  if (opts.classification) parts.push(`Current XML classification hint: ${opts.classification}`);
  if (opts.triedCount != null) parts.push(`Steps explored so far: ${opts.triedCount}`);
  if (opts.goal) parts.push(`Goal: ${opts.goal}`);

  if (opts.previousAction) {
    parts.push("");
    parts.push(opts.previousAction);
  }

  if (opts.journal) {
    parts.push("");
    parts.push(opts.journal);
  }

  if (opts.isBlank && opts.wireframe) {
    parts.push("");
    parts.push(opts.wireframe);
  }

  const { w: SW, h: SH } = adb.getScreenSize();
  parts.push("");
  parts.push(`Analyze this ${SW}x${SH} pixel screen and return a single JSON object with ALL of these fields:
{
  "screenType": "feed|settings|detail|login|search|dialog|form|nav_hub|error|loading|other",
  "screenDescription": "Brief description of what this screen shows",
  "navBar": { "hasNav": true, "tabs": [{"label": "Home", "x": ${Math.round(SW * 0.12)}, "y": ${Math.round(SH * 0.96)}}] },
  "mainActions": [{"description": "what to tap", "x": ${Math.round(SW / 2)}, "y": ${Math.round(SH / 2)}, "priority": "high|medium|low"}],
  "isAuthScreen": false,
  "isLoading": false,
  "contentDensity": "high|medium|low|empty"
}

IMPORTANT: All x,y coordinates must be PIXEL values for the ${SW}x${SH} screen. x=${Math.round(SW / 2)} means horizontal center, y=${SH - 120} means near bottom. UI content may only fill part of the screen — estimate position on the FULL screen, not relative to content.

Rules:
- navBar.tabs: list bottom navigation tabs if visible (icons/labels at screen bottom for switching sections). If none, set hasNav=false and tabs=[]
- mainActions: up to 5 tappable UI elements that would lead to NEW screens or features. Prioritize unexplored areas.
- isAuthScreen: true if this is a login, signup, or auth choice screen
- contentDensity: how much content is on screen (empty=blank/loading, low=1-2 items, medium=3-5 items, high=many items)
- Return ONLY valid JSON, no markdown fences`);

  return parts.join("\n");
}

/**
 * Parse and validate the unified perception response.
 *
 * Structural validation is delegated to the Zod schema in
 * `schemas/perception.js`. Runtime-dependent normalization
 * (percentage → pixel conversion, clamping) lives here because it
 * needs the current viewport dims from `adb.getScreenSize()`.
 *
 * @param {string} text - Raw response text
 * @returns {object|null} Validated perception or null
 */
function parsePerceptionResponse(text) {
  const parsed = parsePerceptionJson(text);
  if (!parsed) {
    log.warn("Failed to parse response as JSON");
    return null;
  }
  return normalizePerception(parsed, adb.getScreenSize(), MARGIN);
}

/**
 * Run unified vision perception on a screenshot.
 *
 * @param {string} screenshotPath - Path to the screenshot PNG
 * @param {string|null} xml - Current XML (for wireframe fallback)
 * @param {object} context
 * @param {string} [context.classification] - XML classification hint
 * @param {number} [context.triedCount] - Steps so far
 * @param {string} [context.goal] - Current exploration target
 * @param {object} [context.previousAction] - Previous action outcome
 * @param {string} [context.journal] - Exploration history
 * @param {string|null} ssHash - Screenshot perceptual hash (for caching)
 * @param {PerceptionCache} cache - Perception cache instance
 * @returns {Promise<{ perception: object, fromCache: boolean, fuzzy: boolean }|null>}
 */
async function perceive(screenshotPath, xml, context, ssHash, cache) {
  // Check cache first
  if (ssHash && cache) {
    const cached = cache.get(ssHash);
    if (cached) {
      const tag = cached.fuzzy ? "fuzzy cache hit" : "exact cache hit";
      log.info({ cacheType: tag, actions: (cached.perception.mainActions || []).length, screenType: cached.perception.screenType }, "Perception cache hit");
      return { perception: cached.perception, fromCache: true, fuzzy: cached.fuzzy };
    }
  }

  // Budget check — uses vision.js budget
  if (vision.budgetRemaining() <= 0) {
    log.warn("Vision budget exhausted");
    return null;
  }

  if (!screenshotPath || !fs.existsSync(screenshotPath)) {
    log.warn("No screenshot available");
    return null;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    log.warn("No API key");
    return null;
  }

  // Detect blank/FLAG_SECURE screenshots
  const blank = isBlankScreenshot(screenshotPath);
  if (blank) {
    log.info("Blank screenshot (FLAG_SECURE?) - using wireframe fallback");
  }

  // Build prompt
  let previousActionText = "";
  if (context.previousAction) {
    const pa = context.previousAction;
    const actionDesc = pa.action
      ? `${pa.action.type || "unknown"} on "${pa.action.target || "unknown"}"`
      : "unknown";
    const outcomeDesc = pa.outcome ? pa.outcome.type || "unknown" : "unknown";
    const postActivity = pa.outcome && pa.outcome.postActivity
      ? ` (now on ${pa.outcome.postActivity})`
      : "";
    previousActionText = `PREVIOUS ACTION: ${actionDesc}\nRESULT: ${outcomeDesc}${postActivity}`;
  }

  const promptText = buildPerceptionPrompt({
    isBlank: blank,
    wireframe: blank ? generateWireframeText(xml) : null,
    classification: context.classification || null,
    triedCount: context.triedCount,
    goal: context.goal,
    previousAction: previousActionText || null,
    journal: context.journal || null,
  });

  // Build content parts
  const contentParts = [];
  if (!blank) {
    const imgData = fs.readFileSync(screenshotPath).toString("base64");
    contentParts.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: imgData },
    });
  }
  contentParts.push({ type: "text", text: promptText });

  // Call vision API — use vision.js budget tracking internally
  // We call the Anthropic API directly but consume from vision's budget
  try {
    const budgetBefore = vision.budgetRemaining();
    if (budgetBefore <= 0) return null;

    log.info({ budgetRemaining: budgetBefore, budgetTotal: MAX_VISION_CALLS_PER_CRAWL || 60 }, "Calling Haiku unified perception");

    // E5: Use streaming API for incremental response
    const stream = await anthropic.messages.stream({
      model: VISION_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 600,
      temperature: 0,
      messages: [{ role: "user", content: contentParts }],
    });

    let raw = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        raw += event.delta.text;
      }
    }

    // Extract token usage from completed stream
    let usage = { input_tokens: 0, output_tokens: 0 };
    try {
      const finalMsg = await stream.finalMessage();
      usage = finalMsg.usage || usage;
    } catch (_) {}

    // Consume 1 from shared vision budget
    vision.consumeBudget();
    const perception = parsePerceptionResponse(raw);
    if (perception) perception._tokenUsage = usage;

    if (!perception) {
      log.warn("Failed to parse response - falling back to separate calls");
      return null;
    }

    log.info({
      screenType: perception.screenType,
      actions: perception.mainActions.length,
      nav: perception.navBar.hasNav ? perception.navBar.tabs.length : 0,
      auth: perception.isAuthScreen,
      density: perception.contentDensity,
    }, "Perception result");

    // Cache the result
    if (ssHash && cache) {
      cache.set(ssHash, perception);
    }

    return { perception, fromCache: false, fuzzy: false };
  } catch (e) {
    log.error({ err: e.message }, "API call failed");
    vision.consumeBudget(); // still counts against budget on failure
    return null;
  }
}

module.exports = {
  PerceptionCache,
  perceive,
  parsePerceptionResponse,
  buildPerceptionPrompt,
};
