"use strict";

/**
 * screen-survey.js — Survey mode logic for nav tab exploration.
 *
 * Extracted from screen-intelligence.js for maintainability.
 */

const adb = require("./adb");
const readiness = require("./readiness");
const fingerprint = require("./fingerprint");
const screenshotFp = require("./screenshot-fp");
const { nextUnvisitedSection, markSectionVisited } = require("./navigator");
const { exploreScrollDepth } = require("./scroll-explorer");
const { MODE } = require("./modes");
const log = require("../lib/logger").logger.child({ component: "screen-survey" });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Explore scroll depth using screenshot hash comparison (vision-only fallback).
 */
async function exploreScrollDepthScreenshotOnly(maxScrolls = 3) {
  const prePath = `/tmp/survey_scroll_pre_${Date.now()}.png`;
  adb.screencap(prePath);
  let prevHash = screenshotFp.computeHash(prePath);
  let scrollCount = 0;

  for (let i = 0; i < maxScrolls; i++) {
    adb.swipe(540, 1600, 540, 800, 400);
    await sleep(800);

    const postPath = `/tmp/survey_scroll_${Date.now()}_${i}.png`;
    adb.screencap(postPath);
    const postHash = screenshotFp.computeHash(postPath);

    if (screenshotFp.hammingDistance(prevHash, postHash) > 8) {
      scrollCount++;
      prevHash = postHash;
    } else {
      break;
    }
  }

  if (scrollCount > 0) {
    log.info({ scrollCount }, "[survey] Explored scroll depth (vision-only)");
  }
}

/**
 * Handle survey mode: visit unvisited nav sections.
 * @returns {'continue'|null}
 */
async function handleSurveyMode(ctx, classification, fp, step, actionsTaken, stateGraph) {
  if (!ctx.navStructure || ctx.navStructure.type === "none") return null;

  const hasUnvisitedSections = !!nextUnvisitedSection(ctx.navStructure);

  // Enter SURVEY from BOOT
  const classType = classification ? classification.type : null;
  if (ctx.modeManager.currentMode === MODE.BOOT && hasUnvisitedSections &&
    (classType === "navigation_hub" || fp === ctx.homeFingerprint)) {
    ctx.modeManager.enterMode(MODE.SURVEY);
  }

  // Re-enter SURVEY when repeatedly landing on home with unvisited tabs
  if (fp === ctx.homeFingerprint && hasUnvisitedSections &&
    stateGraph.visitCount(fp) > 3 && ctx.modeManager.currentMode !== MODE.SURVEY) {
    ctx.log.info({ visitCount: stateGraph.visitCount(fp) }, "[survey] Home visited repeatedly with unvisited tabs — re-entering SURVEY");
    ctx.modeManager.enterMode(MODE.SURVEY);
  }

  if (ctx.modeManager.currentMode === MODE.SURVEY) {
    const nextSection = nextUnvisitedSection(ctx.navStructure);
    if (nextSection) {
      ctx.log.info({ section: nextSection.label }, "[survey] Visiting section");
      adb.tap(nextSection.bounds.cx, nextSection.bounds.cy);
      await readiness.waitForScreenReady({ timeoutMs: 3000 });
      const sectionIdx = ctx.navStructure.sections.indexOf(nextSection);
      const postXml = adb.dumpXml();
      let postFp;
      if (postXml) {
        postFp = fingerprint.compute(postXml);
      } else {
        const surveySSPath = `/tmp/survey_tab_${sectionIdx}_${Date.now()}.png`;
        adb.screencap(surveySSPath);
        const surveyHash = screenshotFp.computeHash(surveySSPath);
        postFp = `ss_${surveyHash}`;
      }
      markSectionVisited(ctx.navStructure, sectionIdx, postFp);

      // ── AppMap: Ensure nav tabs are set, then register tab root ──
      if (ctx.appMap) {
        if (ctx.appMap.navTabs.length === 0 && ctx.navStructure && ctx.navStructure.sections) {
          ctx.appMap.setNavTabs(ctx.navStructure.sections.map((s) => ({
            label: s.label, cx: s.bounds.cx, cy: s.bounds.cy,
          })));
        }
        ctx.appMap.registerTabRoot(sectionIdx, postFp);
      }

      if (postXml) {
        await exploreScrollDepth(postXml, new Set());
      } else {
        await exploreScrollDepthScreenshotOnly();
      }
      actionsTaken.push({
        step, type: "survey_nav", description: `survey: ${nextSection.label}`,
        actionKey: nextSection.actionKey, fromFingerprint: fp,
      });
      ctx.modeManager.recordStep();
      return "continue";
    }
    // All sections visited — advance to EXPLORE
    ctx.modeManager.enterMode(MODE.EXPLORE);
  }

  return null;
}

module.exports = { exploreScrollDepthScreenshotOnly, handleSurveyMode };
