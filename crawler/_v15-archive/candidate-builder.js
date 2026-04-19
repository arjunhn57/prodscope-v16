"use strict";

/**
 * candidate-builder.js — Builds the action candidate list from XML + vision.
 *
 * V2 Phase 2: Two modes:
 *   - XML-primary: extract from XML, inject vision on top (existing behavior)
 *   - Vision-primary: vision actions ARE the candidate list (XML is secondary accelerator)
 */

const actions = require("./actions");
const adb = require("./adb");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "candidate-builder" });

/**
 * Build the action candidate list for the current screen.
 *
 * @param {object} ctx - CrawlContext
 * @param {object} snapshot - Screen snapshot
 * @param {string} fp - Current fingerprint
 * @param {object} stateGraph - State graph instance
 * @returns {{ candidates: Array, tried: Set }}
 */
function buildCandidates(ctx, snapshot, fp, stateGraph) {
  const tried = stateGraph.triedActionsFor(fp);

  // ═══ Vision-primary mode: when XML is unavailable or unreliable ═══
  if (ctx.screenshotOnlyMode || !snapshot.xml) {
    return buildVisionPrimaryCandidates(ctx, tried, stateGraph, fp);
  }

  // ═══ XML-primary mode (existing behavior) ═══
  let candidates = actions.extract(snapshot.xml, tried);

  // Filter permanently bad actions (ineffective, out_of_app, crash, dead_end)
  const badActions = stateGraph.badActionsFor(fp);
  if (badActions.size > 0) {
    const beforeCount = candidates.length;
    candidates = candidates.filter((c) => !badActions.has(c.key));
    if (candidates.length < beforeCount) {
      log.info({ filtered: beforeCount - candidates.length, badCount: badActions.size }, "Filtered permanently bad actions");
    }
  }

  // Suppress exhausted scroll actions
  const triedScrollDown = tried.has("scroll_down_1") && tried.has("scroll_down_2") && tried.has("scroll_down_3");
  const triedScrollUp = tried.has("scroll_up_1") && tried.has("scroll_up_2");
  if (triedScrollDown && triedScrollUp) {
    const nonScrollCandidates = candidates.filter(
      (a) => a.type !== actions.ACTION_TYPES.SCROLL_DOWN && a.type !== actions.ACTION_TYPES.SCROLL_UP
    );
    if (nonScrollCandidates.length > 0) {
      candidates = nonScrollCandidates;
      log.info("Scroll budget exhausted for this screen — suppressing scroll actions");
    }
  }

  // Inject vision-guided actions (vision as accelerator for XML-primary)
  candidates = injectVisionActions(ctx, candidates, tried);

  return { candidates, tried };
}

/**
 * Build candidates entirely from vision perception results.
 * Vision actions are first-class — they ARE the candidate list.
 *
 * @param {object} ctx - CrawlContext
 * @param {Set} tried - Already-tried action keys
 * @returns {{ candidates: Array, tried: Set }}
 */
function buildVisionPrimaryCandidates(ctx, tried, stateGraph, fp) {
  const vr = ctx.visionResult;
  if (!vr || !vr.mainActions || vr.mainActions.length === 0) {
    if (ctx.screenshotOnlyMode) {
      return buildHeuristicCandidates(tried);
    }
    return { candidates: [], tried };
  }

  const candidates = vr.mainActions.map((va) => {
    const fx = Math.round(va.x / 20) * 20;
    const fy = Math.round(va.y / 20) * 20;
    return {
      type: actions.ACTION_TYPES.TAP,
      bounds: { cx: va.x, cy: va.y, x1: va.x - 20, y1: va.y - 20, x2: va.x + 20, y2: va.y + 20 },
      text: va.description || "",
      contentDesc: va.description || "",
      resourceId: "",
      className: "",
      priority: va.priority === "high" ? 95 : va.priority === "medium" ? 75 : 45,
      key: `tap:vision:${fx},${fy}`,
      visionGuided: true,
      packageName: ctx.packageName,
    };
  });

  let newCandidates = candidates.filter((c) => !tried.has(c.key));
  if (newCandidates.length < candidates.length) {
    log.info({ filtered: candidates.length - newCandidates.length }, "Vision actions already tried — filtered");
  }

  // Filter permanently bad actions
  if (stateGraph && fp) {
    const badActions = stateGraph.badActionsFor(fp);
    if (badActions.size > 0) {
      const beforeCount = newCandidates.length;
      newCandidates = newCandidates.filter((c) => !badActions.has(c.key));
      if (newCandidates.length < beforeCount) {
        log.info({ filtered: beforeCount - newCandidates.length }, "Filtered permanently bad vision actions");
      }
    }
  }

  if (newCandidates.length > 0) {
    log.info({ count: newCandidates.length }, "Vision-only candidates");
  }

  return { candidates: newCandidates, tried };
}

/**
 * Inject vision-guided actions on top of XML candidates (XML-primary mode).
 *
 * @param {object} ctx - CrawlContext
 * @param {Array} candidates - Existing XML candidates
 * @param {Set} tried - Already-tried action keys
 * @returns {Array} Merged candidates with vision on top
 */
function injectVisionActions(ctx, candidates, tried) {
  if (!ctx.visionResult || !ctx.visionResult.mainActions || ctx.visionResult.mainActions.length === 0) {
    return candidates;
  }

  const visionActions = ctx.visionResult.mainActions.map((va) => {
    const fx = Math.round(va.x / 20) * 20;
    const fy = Math.round(va.y / 20) * 20;
    return {
      type: actions.ACTION_TYPES.TAP,
      bounds: { cx: va.x, cy: va.y, x1: va.x - 20, y1: va.y - 20, x2: va.x + 20, y2: va.y + 20 },
      text: va.description || "",
      contentDesc: va.description || "",
      resourceId: "",
      className: "",
      priority: va.priority === "high" ? 95 : va.priority === "medium" ? 75 : 45,
      key: `tap:vision:${fx},${fy}`,
      visionGuided: true,
      packageName: ctx.packageName,
    };
  });

  const newVisionActions = visionActions.filter((va) => !tried.has(va.key));
  if (newVisionActions.length > 0) {
    candidates = [...newVisionActions, ...candidates];
    log.info({ count: newVisionActions.length }, "Injected vision-guided actions");
  }

  return candidates;
}

/**
 * Generate heuristic tap candidates when vision is unavailable in screenshot-only mode.
 * Taps at common UI positions to enable blind exploration.
 *
 * @param {Set} tried - Already-tried action keys
 * @returns {{ candidates: Array, tried: Set }}
 */
function buildHeuristicCandidates(tried) {
  // Device-aware positions — adapts to any screen resolution
  const { w, h } = adb.getScreenSize();
  const positions = [
    // Screen center
    { x: Math.round(w * 0.5), y: Math.round(h * 0.5), label: "center" },
    // Four quadrants
    { x: Math.round(w * 0.25), y: Math.round(h * 0.25), label: "top_left" },
    { x: Math.round(w * 0.75), y: Math.round(h * 0.25), label: "top_right" },
    { x: Math.round(w * 0.25), y: Math.round(h * 0.75), label: "bottom_left" },
    { x: Math.round(w * 0.75), y: Math.round(h * 0.75), label: "bottom_right" },
    // Tab bar positions (bottom nav — 5 evenly spaced)
    { x: Math.round(w * 0.1), y: Math.round(h * 0.97), label: "tab1" },
    { x: Math.round(w * 0.3), y: Math.round(h * 0.97), label: "tab2" },
    { x: Math.round(w * 0.5), y: Math.round(h * 0.97), label: "tab3" },
    { x: Math.round(w * 0.7), y: Math.round(h * 0.97), label: "tab4" },
    { x: Math.round(w * 0.9), y: Math.round(h * 0.97), label: "tab5" },
    // Top-right close/action button
    { x: Math.round(w * 0.94), y: Math.round(h * 0.05), label: "close" },
    // Bottom-center OK/action button
    { x: Math.round(w * 0.5), y: Math.round(h * 0.9), label: "action" },
  ];

  const candidates = positions
    .map((pos) => ({
      type: actions.ACTION_TYPES.TAP,
      bounds: { cx: pos.x, cy: pos.y, x1: pos.x - 20, y1: pos.y - 20, x2: pos.x + 20, y2: pos.y + 20 },
      text: pos.label,
      contentDesc: `heuristic_${pos.label}`,
      resourceId: "",
      className: "",
      priority: 30,
      key: `tap:heuristic:${pos.x},${pos.y}`,
      visionGuided: false,
      packageName: "",
    }))
    .filter((c) => !tried.has(c.key));

  if (candidates.length > 0) {
    log.info({ count: candidates.length }, "Heuristic blind candidates (vision budget exhausted)");
  }

  return { candidates, tried };
}

module.exports = { buildCandidates, buildHeuristicCandidates };
