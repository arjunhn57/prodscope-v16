"use strict";

/**
 * screen-intelligence.js — Screen analysis orchestrator.
 *
 * Coordinates classification, vision, coverage, navigation, and survey
 * to produce a directive for the crawl loop: "proceed" to action selection
 * or "continue" to skip this step.
 *
 * Internal logic extracted into focused modules:
 *   - screen-classify.js:       classification helpers
 *   - screen-vision-resolver.js: vision API + caching
 *   - screen-coverage.js:       saturation + plan lifecycle
 *   - screen-survey.js:         survey mode
 */

const adb = require("./adb");
const readiness = require("./readiness");
const vision = require("./vision");
const screenshotFp = require("./screenshot-fp");
const { detectNavigationStructure, buildNavFromVision } = require("./navigator");
const { MODE } = require("./modes");

const { hasClassifier, classifyScreen, classifyFromPerception, getPrimaryPackage } = require("./screen-classify");
const { computeEffectiveFp, resolveVision, resolveVisionPerception } = require("./screen-vision-resolver");
const { handleSaturation, handlePlan } = require("./screen-coverage");
const { handleSurveyMode } = require("./screen-survey");

const log = require("../lib/logger").logger.child({ component: "screen-intelligence" });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ── Navigation detection ──────────────────────────────────────────── */

async function detectNav(ctx, snapshot, classification, step, fp, perception) {
  if (ctx.navStructure && ctx.navStructure.type !== "none") return;

  if (!ctx._navDetectionAttempts) ctx._navDetectionAttempts = 0;
  if (ctx._navDetectionAttempts >= 3) return;
  if (ctx.authMachine && ctx.authMachine.isActive) return;

  const isHome = ctx.homeFingerprint && fp === ctx.homeFingerprint;

  if (classification) {
    const isNavCandidate = isHome ||
      classification.type === "navigation_hub" ||
      classification.type === "feed" ||
      classification.type === "other" ||
      classification.type === "unknown";
    if (!isNavCandidate) return;
  } else if (!ctx.screenshotOnlyMode && snapshot.xml) {
    return;
  }

  ctx._navDetectionAttempts++;

  // Use perception nav data if available
  if (perception && perception.navBar && perception.navBar.hasNav && perception.navBar.tabs.length >= 2) {
    ctx.log.info({ tabCount: perception.navBar.tabs.length, tabs: perception.navBar.tabs.map(t => t.label) }, "[navigator] Using perception nav data");
    ctx.navStructure = buildNavFromVision(perception.navBar.tabs);
    return;
  }

  // Try XML-based detection
  if (snapshot.xml) {
    ctx.navStructure = detectNavigationStructure(snapshot.xml);
    if (ctx.navStructure.type !== "none") {
      ctx.log.info({ type: ctx.navStructure.type, sectionCount: ctx.navStructure.sections.length }, "[navigator] Detected navigation structure");
      return;
    }
  }

  // Vision fallback
  if (snapshot.screenshotPath && vision.budgetRemaining() > 0) {
    ctx.log.info("[navigator] XML nav detection found nothing — trying vision fallback");
    try {
      const visionTabs = await vision.detectNavTabs(snapshot.screenshotPath);
      if (visionTabs) {
        ctx.navStructure = buildNavFromVision(visionTabs);
      }
    } catch (e) {
      ctx.log.warn({ err: e }, "[navigator] Vision nav detection failed");
    }
  }
}

/* ── Positional nav detection (E8) ─────────────────────────────────── */

/**
 * Detect navigation tabs by position when vision nav detection fails.
 * Looks for 3+ clickable elements in the bottom 10% of the screen,
 * spread horizontally > 400px.
 *
 * @param {string} xml
 * @returns {{ hasNav: boolean, tabs: Array<{ cx: number, cy: number, label: string }> }}
 */
function detectNavByPosition(xml) {
  if (!xml) return { hasNav: false, tabs: [] };

  const SCREEN_HEIGHT = 2400;
  const bottomThreshold = SCREEN_HEIGHT * 0.9;
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;
  const bottomClickables = [];

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    if (!/clickable="true"/i.test(attrs)) continue;

    const boundsMatch = attrs.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!boundsMatch) continue;

    const cy = (parseInt(boundsMatch[2], 10) + parseInt(boundsMatch[4], 10)) / 2;
    if (cy < bottomThreshold) continue;

    const cx = (parseInt(boundsMatch[1], 10) + parseInt(boundsMatch[3], 10)) / 2;
    const text = ((attrs.match(/text="([^"]*)"/i) || [])[1] || "").trim();
    const desc = ((attrs.match(/content-desc="([^"]*)"/i) || [])[1] || "").trim();
    const label = text || desc || `tab_${Math.round(cx)}`;

    bottomClickables.push({ cx, cy, label });
  }

  if (bottomClickables.length < 3) return { hasNav: false, tabs: [] };

  const xs = bottomClickables.map((t) => t.cx);
  const spread = Math.max(...xs) - Math.min(...xs);
  if (spread < 400) return { hasNav: false, tabs: [] };

  bottomClickables.sort((a, b) => a.cx - b.cx);
  return { hasNav: true, tabs: bottomClickables };
}

/* ═══════════════════════════════════════════════════════════════════
 * Main entry point — analyzeScreen
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Analyze the current screen and decide whether to proceed to action
 * selection or take an immediate navigation action.
 *
 * @param {object} ctx - CrawlContext
 * @param {object} snapshot - Screen snapshot
 * @param {string} fp - Exact fingerprint
 * @param {string} fuzzyFp - Fuzzy fingerprint
 * @param {string} ssFp - Screenshot perceptual hash
 * @param {boolean} isNew - Whether this screen is new
 * @param {number} step - Current step number
 * @param {Function} formatJournal - Returns exploration journal string
 * @returns {Promise<{ directive: 'proceed'|'continue', classification: object|null }>}
 */
async function analyzeScreen(ctx, snapshot, fp, fuzzyFp, ssFp, isNew, step, formatJournal) {
  const stateGraph = ctx.stateGraph;
  const actionsTaken = ctx.actionsTaken;
  const maxSteps = ctx.maxSteps;

  let classification = null;
  let perception = null;

  // ═══ PATH A: XML classification available ═══
  if (hasClassifier() && snapshot.xml) {
    classification = classifyScreen(snapshot, fp);
    const { xmlQ, effectiveFp, preVisionCandidates } = computeEffectiveFp(
      snapshot, classification, fp, ssFp, stateGraph
    );

    // E8: Framework-adaptive mode
    if (xmlQ.visionPrimary && step > 3 && !ctx._frameworkAdaptive) {
      ctx._frameworkAdaptive = true;
      if (ctx.perceptionCache && ctx.perceptionCache.setFuzzyThreshold) {
        ctx.perceptionCache.setFuzzyThreshold(12);
      }
      log.info("Framework-adaptive mode enabled (obfuscated framework detected, fuzzy threshold → 12)");
    }

    await resolveVision(ctx, snapshot, classification, step, effectiveFp, ssFp, xmlQ, preVisionCandidates, formatJournal);
  }

  // ═══ PATH B: No XML classification — use unified vision perception ═══
  if (!classification && snapshot.screenshotPath) {
    perception = await resolveVisionPerception(ctx, snapshot, ssFp, step, formatJournal);
    if (perception) {
      classification = classifyFromPerception(perception, snapshot);
    }
  }

  // ═══ UNIFIED DOWNSTREAM LOGIC ═══
  if (classification) {
    // Saturation cooldown
    if (ctx.saturationCooldown > 0) ctx.saturationCooldown--;

    // Split "other" by fingerprint
    if (classification.feature === "other") {
      classification.feature = `other_${fp.slice(0, 8)}`;
      snapshot.feature = classification.feature;
    }

    // Coverage tracking + saturation-back
    const satResult = handleSaturation(ctx, classification, fp, isNew, step, actionsTaken);
    if (satResult === "continue") {
      await sleep(500);
      ctx.modeManager.recordStep();
      return { directive: "continue", classification };
    }

    // Dedup
    if (ctx.dedup && fuzzyFp && ctx.coverageTracker) {
      const cat = ctx.coverageTracker.categories[classification.feature];
      const seenFuzzyFps = cat ? cat.uniqueFingerprints : new Set();
      const dupResult = ctx.dedup.shouldSkipScreen(classification.feature, fuzzyFp, seenFuzzyFps, snapshot.xml);
      if (dupResult.skip && !isNew && fp !== ctx.homeFingerprint) {
        ctx.log.info({ reason: dupResult.reason }, "[dedup] Skipping fuzzy duplicate");
        adb.pressBack();
        actionsTaken.push({ step, type: "back", description: "press_back", reason: "dedup_skip", fromFingerprint: fp });
        ctx.modeManager.recordStep();
        await readiness.waitForScreenReady({ timeoutMs: 1500 });
        return { directive: "continue", classification };
      }
      ctx.dedup.updateFeatureProfile(classification.feature, snapshot.xml);
    }

    // Plan lifecycle
    await handlePlan(ctx, classification, step);

    // Navigation detection
    await detectNav(ctx, snapshot, classification, step, fp, perception);

    // Flow tracking
    if (ctx.flowTracker) {
      ctx.flowTracker.addStep(classification.type, "", "", fp);
      if (classification.type === "navigation_hub") {
        ctx.flowTracker.checkFlowComplete(classification.type, true);
      }
    }

    // Paywall detection
    if (snapshot.xml && ctx.appState.checkPaywall(snapshot.xml, fp)) {
      ctx.log.info("[appState] Paywall detected — pressing back");
      adb.pressBack();
      await readiness.waitForScreenReady({ timeoutMs: 2000 });
      ctx.modeManager.recordStep();
      return { directive: "continue", classification };
    }
    if (ctx.appState.paywallScreenFps.has(fp)) {
      ctx.log.info("[appState] Returning to known paywall — pressing back");
      adb.pressBack();
      ctx.modeManager.recordStep();
      return { directive: "continue", classification };
    }

    // Survey mode
    const surveyResult = await handleSurveyMode(ctx, classification, fp, step, actionsTaken, stateGraph);
    if (surveyResult === "continue") return { directive: "continue", classification };

    // Verify mode check
    if (ctx.modeManager.shouldEnterVerify()) {
      ctx.modeManager.enterMode(MODE.VERIFY);
    }
  }

  // Overlay detection
  if (snapshot.xml) {
    const overlayPkg = getPrimaryPackage(snapshot.xml);
    const isOverlay = overlayPkg === "com.android.documentsui" ||
      overlayPkg === "com.android.chooser" ||
      /emoji_picker|share_sheet/i.test(snapshot.xml);
    if (isOverlay) {
      ctx.log.info("[crawler] Overlay/picker detected — dismissing");
      adb.pressBack();
      await readiness.waitForScreenReady({ timeoutMs: 2000 });
      ctx.modeManager.recordStep();
      return { directive: "continue", classification };
    }
  }

  // Content creation suppression
  if (classification && classification.feature === "content_creation" && step < Math.floor(maxSteps * 0.6)) {
    const createVisits = ctx.coverageTracker ? (ctx.coverageTracker.categories["content_creation"]?.visits || 0) : 0;
    if (createVisits > 3) {
      ctx.log.info("[brain] Content creation area well-visited — pressing back");
      adb.pressBack();
      await readiness.waitForScreenReady({ timeoutMs: 2000 });
      ctx.modeManager.recordStep();
      return { directive: "continue", classification };
    }
  }

  // Form loop escape
  if (classification && classification.feature === "data_entry") {
    ctx.consecutiveFormVisits++;
    if (ctx.consecutiveFormVisits >= 4 && !isNew) {
      ctx.log.info({ consecutiveFormVisits: ctx.consecutiveFormVisits }, "[brain] Consecutive form visits — forcing BACK to escape form loop");
      adb.pressBack();
      actionsTaken.push({ step, type: "back", description: "press_back", reason: "form_loop_escape", fromFingerprint: fp });
      await sleep(500);
      ctx.consecutiveFormVisits = 0;
      ctx.modeManager.recordStep();
      return { directive: "continue", classification };
    }
  } else {
    ctx.consecutiveFormVisits = 0;
  }

  return { directive: "proceed", classification };
}

module.exports = { analyzeScreen, detectNavByPosition };
