"use strict";

/**
 * vision.js — Gated vision-in-the-loop for ambiguous screens.
 *
 * When the XML gives insufficient information (obfuscated Compose/RN/Flutter,
 * all-blank actions, unknown screen type), sends the screenshot to Haiku
 * for action guidance.
 *
 * Budget: dynamic per framework — 20 (native), 40 (obfuscated), 60 max (configurable).
 */

const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");
const { VISION_MODEL, MAX_VISION_CALLS_PER_CRAWL, VISION_BUDGET_NATIVE, VISION_BUDGET_OBFUSCATED } = require("../config/defaults");
const { isBlankScreenshot, generateWireframeText } = require("./wireframe");
const adb = require("./adb");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "vision" });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let callsUsed = 0;
let recoveryCallsUsed = 0;
let dynamicBudget = null; // set by setDynamicBudget() based on framework detection

// H3: Budget reservation — exploration and recovery draw from separate pools
const RECOVERY_BUDGET = 10;

/**
 * Get the effective vision budget for this crawl.
 * @returns {number}
 */
function getEffectiveBudget() {
  if (dynamicBudget !== null) return dynamicBudget;
  return MAX_VISION_CALLS_PER_CRAWL || 60;
}

/**
 * Reset the vision call counter (call at crawl start).
 */
function resetBudget() {
  callsUsed = 0;
  recoveryCallsUsed = 0;
  dynamicBudget = null;
}

/**
 * Set a dynamic vision budget based on app framework.
 * Call once after framework detection (first classified screen).
 * @param {boolean} isObfuscated - true for Compose/Flutter/RN
 */
function setDynamicBudget(isObfuscated) {
  if (dynamicBudget !== null) return; // only set once
  dynamicBudget = isObfuscated
    ? (VISION_BUDGET_OBFUSCATED || 40)
    : (VISION_BUDGET_NATIVE || 20);
  log.info({ budget: dynamicBudget, framework: isObfuscated ? "obfuscated" : "native" }, "Dynamic budget set");
}

/**
 * How many vision calls remain.
 * @returns {number}
 */
function budgetRemaining() {
  return getEffectiveBudget() - callsUsed;
}

/**
 * Decide whether this screen needs a vision call.
 *
 * @param {string} xml - Current screen XML
 * @param {{ type: string, confidence: number }} classification - Screen classifier result
 * @param {Array} candidates - Extracted actions from actions.extract()
 * @returns {boolean}
 */
function needsVision(xml, classification, candidates) {
  if (callsUsed >= getEffectiveBudget()) return false;
  if (!process.env.ANTHROPIC_API_KEY) return false;

  // Trigger 1: Unknown screen with low confidence
  if (classification.type === "unknown" && classification.confidence < 0.3) return true;

  // Trigger 2: Many XML nodes but very few extractable actions
  const nodeCount = (xml || "").match(/<node/g)?.length || 0;
  const actionCount = candidates.filter((a) => a.type !== "back").length;
  if (nodeCount > 20 && actionCount < 3) return true;

  // Trigger 3: All actions are blank elements (priority < 10)
  const nonBackCandidates = candidates.filter((a) => a.type !== "back");
  if (nonBackCandidates.length > 0) {
    const maxPriority = Math.max(...nonBackCandidates.map((a) => a.priority));
    if (maxPriority < 10) return true;
  }

  // Trigger 4: Obfuscated framework detected
  if (isObfuscatedFramework(xml)) return true;

  return false;
}

/**
 * Detect if the XML suggests an obfuscated UI framework (Compose, RN, Flutter).
 *
 * @param {string} xml
 * @returns {boolean}
 */
function isObfuscatedFramework(xml) {
  if (!xml) return false;

  const nodes = (xml.match(/<node/g) || []).length;
  if (nodes < 5) return false;

  const standardClasses = (xml.match(/class="android\.widget\.\w+"|class="android\.view\.\w+"/gi) || []).length;
  const withResourceIds = (xml.match(/resource-id="[^"]+[a-zA-Z][^"]*"/gi) || []).length;

  const classRatio = standardClasses / nodes;
  const idRatio = withResourceIds / nodes;

  return classRatio < 0.3 && idRatio < 0.2;
}

/**
 * Ask Haiku (vision) what actions are available on this screen.
 *
 * @param {string} screenshotPath - Path to the screenshot PNG
 * @param {string} xml - Current XML (for context)
 * @param {object} context
 * @param {string} context.classification - Current screen classification
 * @param {number} context.triedCount - Actions tried on this screen so far
 * @param {string} context.goal - Current exploration target
 * @param {object} [context.previousAction] - What happened on the last step (outcome feedback)
 * @param {string} [context.journal] - Formatted exploration history (spatial memory)
 * @returns {Promise<{ screenType: string, mainActions: Array<{ description: string, x: number, y: number, priority: string }>, isLoading: boolean, observation: string }|null>}
 */
async function getVisionGuidance(screenshotPath, xml, context) {
  if (callsUsed >= getEffectiveBudget()) return null;
  if (!screenshotPath || !fs.existsSync(screenshotPath)) return null;

  callsUsed++;
  log.info({ callsUsed, budget: getEffectiveBudget() }, "Calling Haiku vision");

  try {
    // ── FLAG_SECURE detection: use wireframe text when screenshot is blank ──
    const blank = isBlankScreenshot(screenshotPath);
    if (blank) {
      log.info("Blank screenshot detected (FLAG_SECURE?) — using wireframe fallback");
    }

    // ── Build prompt sections ──
    let previousActionSection = "";
    if (context.previousAction) {
      const pa = context.previousAction;
      const actionDesc = pa.action
        ? `${pa.action.type || "unknown"} on "${pa.action.target || "unknown"}"`
        : "unknown";
      const outcomeDesc = pa.outcome ? pa.outcome.type || "unknown" : "unknown";
      const postActivity = pa.outcome && pa.outcome.postActivity
        ? ` (now on ${pa.outcome.postActivity})`
        : "";
      previousActionSection = `\nPREVIOUS ACTION: ${actionDesc}\nRESULT: ${outcomeDesc}${postActivity}\n`;
    }

    let journalSection = "";
    if (context.journal) {
      journalSection = `\n${context.journal}\n`;
    }

    let wireframeSection = "";
    if (blank) {
      wireframeSection = `\n${generateWireframeText(xml)}\n`;
    }

    const { w: SW, h: SH } = adb.getScreenSize();
    const promptText = `You are a QA tester exploring an Android app.${blank ? " The screenshot is blocked (FLAG_SECURE) — use the wireframe below." : " Look at this screenshot."}
IMPORTANT: The screen is ${SW}x${SH} pixels. Return all x,y coordinates as PIXEL values in this coordinate space. x=0 is left edge, x=${SW} is right edge, y=0 is top edge, y=${SH} is bottom edge. x=${Math.round(SW / 2)} is horizontal center. UI content may only fill part of the screen — estimate position on the FULL screen, not relative to content.

Current classification: ${context.classification || "unknown"}
Actions tried so far: ${context.triedCount || 0}
Goal: ${context.goal || "explore the app"}
${previousActionSection}${journalSection}${wireframeSection}
Return JSON only:
{"screenType":"login|feed|settings|detail|search|dialog|form|nav_hub|error|loading|other","mainActions":[{"description":"what to tap","x":${Math.round(SW / 2)},"y":${Math.round(SH / 2)},"priority":"high|medium|low"}],"isLoading":false,"observation":"brief note"}`;

    // ── Build message content — image + text, or text-only for blank screenshots ──
    const contentParts = [];
    if (!blank) {
      const imgData = fs.readFileSync(screenshotPath).toString("base64");
      contentParts.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: imgData },
      });
    }
    contentParts.push({ type: "text", text: promptText });

    // E5: Use streaming API for incremental response
    const stream = await anthropic.messages.stream({
      model: VISION_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 400,
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

    // Accumulate into module-level total (captured via drainTokenUsage at crawl end)
    _accumulateModuleTokens(usage);

    const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = safeParseVisionResponse(cleaned);
    if (parsed) parsed._tokenUsage = usage;
    return parsed;
  } catch (e) {
    log.error({ err: e }, "API call failed");
    return null;
  }
}

/**
 * Parse and validate vision API response. Strips markdown fences,
 * requires valid JSON, validates required fields and coordinate bounds.
 *
 * @param {string} text - Raw response text from the API
 * @returns {object|null} Validated response or null
 */
function safeParseVisionResponse(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    log.warn({ err: e }, "Failed to parse response as JSON");
    return null;
  }

  // Validate screenType is a known value
  const VALID_SCREEN_TYPES = new Set([
    "login", "feed", "settings", "detail", "search",
    "dialog", "form", "nav_hub", "error", "loading", "other",
  ]);
  if (!obj.screenType || !VALID_SCREEN_TYPES.has(obj.screenType)) {
    log.warn({ screenType: obj.screenType }, "Invalid screenType — defaulting to \"other\"");
    obj.screenType = "other";
  }

  // Validate mainActions array
  if (!Array.isArray(obj.mainActions)) {
    obj.mainActions = [];
  }

  // Cap at 5 actions and validate/clamp coordinates
  // Vision returns percentages (0-100) — convert to device pixels
  const { w: SCREEN_W, h: SCREEN_H } = adb.getScreenSize();
  const MARGIN = 10;
  obj.mainActions = obj.mainActions.slice(0, 5).filter((a) => {
    if (typeof a.x !== "number" || typeof a.y !== "number" || isNaN(a.x) || isNaN(a.y)) {
      log.warn({ action: a }, "Dropping action with missing/invalid coordinates");
      return false;
    }

    // Convert percentages to pixels if values are in 0-100 range
    // (pixel values would be >100 for any meaningful tap on a 1080x2400 screen)
    if (a.x <= 100 && a.y <= 100) {
      a.x = Math.round((a.x / 100) * SCREEN_W);
      a.y = Math.round((a.y / 100) * SCREEN_H);
    }

    // Clamp to safe screen area
    a.x = Math.max(MARGIN, Math.min(SCREEN_W - MARGIN, Math.round(a.x)));
    a.y = Math.max(MARGIN, Math.min(SCREEN_H - MARGIN, Math.round(a.y)));

    if (!a.description) a.description = "tap";
    if (!a.priority) a.priority = "medium";

    const VALID_PRIORITIES = new Set(["high", "medium", "low"]);
    if (!VALID_PRIORITIES.has(a.priority)) a.priority = "medium";

    return true;
  });

  // Ensure isLoading is boolean
  obj.isLoading = !!obj.isLoading;

  // Ensure observation is string
  if (typeof obj.observation !== "string") obj.observation = "";

  return obj;
}

/**
 * Ask vision to detect bottom navigation tabs and their tap coordinates.
 * Used when XML-based nav detection fails (Compose/Flutter/RN).
 *
 * @param {string} screenshotPath - Path to the screenshot PNG
 * @returns {Promise<Array<{ label: string, x: number, y: number }>|null>}
 */
async function detectNavTabs(screenshotPath) {
  if (callsUsed >= getEffectiveBudget()) return null;
  if (!screenshotPath || !fs.existsSync(screenshotPath)) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  // Skip blank screenshots (FLAG_SECURE) — vision can't see the nav bar
  if (isBlankScreenshot(screenshotPath)) {
    log.info("Blank screenshot (FLAG_SECURE?) — skipping nav detection");
    return null;
  }

  callsUsed++;
  log.info({ callsUsed, budget: getEffectiveBudget() }, "Calling Haiku nav detection");

  try {
    const imgData = fs.readFileSync(screenshotPath).toString("base64");

    // E5: Use streaming API
    const stream = await anthropic.messages.stream({
      model: VISION_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 300,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: imgData },
            },
            {
              type: "text",
              text: `Look at this Android app screenshot (${adb.getScreenSize().w}x${adb.getScreenSize().h} pixels). The app may use Jetpack Compose, Flutter, or React Native — the bottom nav bar might look non-traditional but still function as navigation.

Is there a bottom navigation bar (a row of icons/labels at the bottom used to switch between main sections)? If yes, list each tab with its label and center (x,y) as PIXEL coordinates. Return JSON only:
{"hasNav":true,"tabs":[{"label":"Home","x":${Math.round(adb.getScreenSize().w * 0.12)},"y":${Math.round(adb.getScreenSize().h * 0.96)}},{"label":"Search","x":${Math.round(adb.getScreenSize().w * 0.37)},"y":${Math.round(adb.getScreenSize().h * 0.96)}}]}
If there is no bottom nav bar, return: {"hasNav":false,"tabs":[]}`,
            },
          ],
        },
      ],
    });

    let raw = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        raw += event.delta.text;
      }
    }

    // Extract token usage from completed stream
    try {
      const finalMsg = await stream.finalMessage();
      if (finalMsg.usage) {
        _accumulateModuleTokens(finalMsg.usage);
      }
    } catch (_) {}

    const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.hasNav || !Array.isArray(parsed.tabs) || parsed.tabs.length < 2) {
      return null;
    }

    // Validate and clamp coordinates
    const { w: SCREEN_W, h: SCREEN_H } = adb.getScreenSize();
    const validTabs = parsed.tabs
      .filter((t) => typeof t.x === "number" && typeof t.y === "number" && t.label)
      .map((t) => {
        let x = t.x, y = t.y;
        if (x <= 100 && y <= 100) {
          x = Math.round((x / 100) * SCREEN_W);
          y = Math.round((y / 100) * SCREEN_H);
        }
        return {
          label: String(t.label),
          x: Math.max(10, Math.min(SCREEN_W - 10, x)),
          y: Math.max(10, Math.min(SCREEN_H - 10, y)),
        };
      });

    if (validTabs.length < 2) return null;

    log.info({ tabCount: validTabs.length, tabs: validTabs.map((t) => t.label) }, "Nav detection complete");
    return validTabs;
  } catch (e) {
    log.error({ err: e }, "Nav detection failed");
    return null;
  }
}

/**
 * Consume one budget slot from external callers (e.g. vision-perception.js).
 * Allows shared budget tracking across modules.
 */
function consumeBudget() {
  callsUsed++;
}

/**
 * H3: Consume one recovery-specific budget slot.
 */
function consumeRecoveryBudget() {
  recoveryCallsUsed++;
  callsUsed++; // also counts toward total
}

/**
 * H3: How many recovery-specific vision calls remain.
 * Recovery draws from its own pool first.
 * @returns {number}
 */
function recoveryBudgetRemaining() {
  return Math.max(0, RECOVERY_BUDGET - recoveryCallsUsed);
}

/**
 * C5: Check if vision budget is exhausted.
 * @returns {boolean}
 */
function isBudgetExhausted() {
  return callsUsed >= getEffectiveBudget();
}

// ── Module-level token accumulator (for calls that don't return parsed objects) ──
const _moduleTokens = { input_tokens: 0, output_tokens: 0 };

function _accumulateModuleTokens(usage) {
  if (usage) {
    _moduleTokens.input_tokens += usage.input_tokens || 0;
    _moduleTokens.output_tokens += usage.output_tokens || 0;
  }
}

/**
 * Get and reset accumulated token usage from all vision calls.
 * Call this at crawl end to merge into the total token count.
 */
function drainTokenUsage() {
  const snapshot = { ..._moduleTokens };
  _moduleTokens.input_tokens = 0;
  _moduleTokens.output_tokens = 0;
  return snapshot;
}

/**
 * Raw vision API call — sends a custom prompt directly without the wrapper.
 * Used by auth-perceiver for observation-first prompts that need a different
 * JSON format and higher token limit than getVisionGuidance().
 *
 * @param {string} screenshotPath - Path to PNG screenshot
 * @param {string} prompt - Full prompt text (caller controls format)
 * @param {{ maxTokens?: number }} [opts]
 * @returns {Promise<string|null>} Raw response text, or null on failure
 */
async function callVisionRaw(screenshotPath, prompt, opts = {}) {
  if (callsUsed >= getEffectiveBudget()) return null;
  if (!screenshotPath || !fs.existsSync(screenshotPath)) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  callsUsed++;
  log.info({ callsUsed, budget: getEffectiveBudget() }, "Calling Haiku vision (raw)");

  try {
    const imgData = fs.readFileSync(screenshotPath).toString("base64");
    const stream = await anthropic.messages.stream({
      model: VISION_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: opts.maxTokens || 1500,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: imgData } },
          { type: "text", text: prompt },
        ],
      }],
    });

    let raw = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        raw += event.delta.text;
      }
    }

    let usage = { input_tokens: 0, output_tokens: 0 };
    try {
      const finalMsg = await stream.finalMessage();
      usage = finalMsg.usage || usage;
    } catch (_) {}
    _accumulateModuleTokens(usage);

    return raw.trim() || null;
  } catch (e) {
    log.error({ err: e }, "Raw vision API call failed");
    return null;
  }
}

module.exports = {
  resetBudget,
  setDynamicBudget,
  budgetRemaining,
  recoveryBudgetRemaining,
  consumeBudget,
  consumeRecoveryBudget,
  isBudgetExhausted,
  needsVision,
  isObfuscatedFramework,
  getVisionGuidance,
  safeParseVisionResponse,
  detectNavTabs,
  callVisionRaw,
  drainTokenUsage,
};
