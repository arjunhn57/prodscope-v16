"use strict";

/**
 * triage.js — Decide which screens warrant LLM vision analysis
 *
 * Filters the full screen set down to max 5 screens for AI analysis.
 * Selection criteria: unique screen types, screens with deterministic flags,
 * critical paths, and diversity. Skips system dialogs and saturated types.
 */

const { MAX_AI_TRIAGE_SCREENS } = require("../config/defaults");

/**
 * Triage screens for AI analysis.
 *
 * @param {Array} screens - All captured screens from crawl
 * @param {Object} oracleFindings - Map of step → findings array
 * @param {Object} coverageSummary - Coverage tracker summary
 * @param {Object} [stateGraph] - Optional state graph for path info
 * @returns {{ screensToAnalyze: Array, skippedScreens: Array, triageLog: Array }}
 */
function triageForAI(screens, oracleFindings, coverageSummary, stateGraph) {
  const maxScreens = MAX_AI_TRIAGE_SCREENS;
  const triageLog = [];
  const scored = [];

  // Track seen screen types to enforce diversity
  const seenTypes = new Set();
  // Track seen fuzzy fingerprints to skip near-duplicates
  const seenFuzzyFps = new Set();

  for (const screen of screens) {
    const screenType = screen.screenType || "unknown";
    const fuzzyFp = screen.fuzzyFp || "";
    const step = screen.step;
    const findings = oracleFindings[step] || [];

    // Skip 1: System dialogs — not useful for AI analysis
    if (screenType === "dialog" || screenType === "system_dialog") {
      triageLog.push({ step, action: "skip", reason: "system_dialog" });
      continue;
    }

    // Skip 2: Duplicate fuzzy fingerprint (same structure, different content)
    if (fuzzyFp && seenFuzzyFps.has(fuzzyFp)) {
      triageLog.push({ step, action: "skip", reason: "duplicate_fuzzy_fp" });
      continue;
    }

    // Score this screen for prioritization
    let score = 0;

    // Boost: has deterministic findings (crash, ANR, UX issues)
    const hasCrash = findings.some((f) => f.type === "crash");
    const hasANR = findings.some((f) => f.type === "anr");
    const hasHighSev = findings.some((f) => f.severity === "high" || f.severity === "critical");
    const hasUxIssues = findings.some(
      (f) => f.type === "missing_content_description" || f.type === "small_tap_target" || f.type === "empty_screen"
    );

    if (hasCrash) score += 100;
    if (hasANR) score += 80;
    if (hasHighSev) score += 60;
    if (hasUxIssues) score += 30;

    // Boost: new screen type (diversity)
    if (!seenTypes.has(screenType)) {
      score += 40;
    }

    // Boost: error screens always interesting
    if (screenType === "error") score += 50;

    // Boost: screens on under-covered features
    const feature = screen.feature || "other";
    const featureCov = coverageSummary[feature];
    if (featureCov && featureCov.status === "exploring") {
      score += 20;
    }

    // Slight boost for earlier screens (more likely to be important entry points)
    score += Math.max(0, 10 - step);

    scored.push({ screen, step, screenType, fuzzyFp, score, findings });
    seenTypes.add(screenType);
    if (fuzzyFp) seenFuzzyFps.add(fuzzyFp);
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Take top N with screen type diversity: max 2 screens per type
  const selected = [];
  const skipped = [];
  const typeCount = {};
  for (const s of scored) {
    const t = s.screenType || "unknown";
    typeCount[t] = (typeCount[t] || 0) + 1;
    if (selected.length < maxScreens && typeCount[t] <= 2) {
      selected.push(s);
    } else {
      skipped.push(s);
    }
  }

  for (const s of selected) {
    triageLog.push({
      step: s.step,
      action: "analyze",
      reason: `score=${s.score}, type=${s.screenType}`,
    });
  }

  for (const s of skipped) {
    triageLog.push({
      step: s.step,
      action: "skip",
      reason: `below_cutoff (score=${s.score})`,
    });
  }

  return {
    screensToAnalyze: selected.map((s) => s.screen),
    skippedScreens: skipped.map((s) => ({ step: s.step, reason: "below_cutoff" })),
    triageLog,
  };
}

module.exports = { triageForAI };
