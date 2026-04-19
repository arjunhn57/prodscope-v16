"use strict";

/**
 * scroll-explorer.js — Multi-scroll content exploration.
 *
 * Replaces the one-shot scroll_down/scroll_up with systematic scrolling
 * that re-extracts actions after each scroll and detects content changes.
 */

const adb = require("./adb");
const fingerprint = require("./fingerprint");
const actions = require("./actions");
const readiness = require("./readiness");
const gestures = require("./gestures");
const { sleep } = require("../utils/sleep");
const { MAX_SCROLLS_PER_SCREEN, SCROLL_UNCHANGED_LIMIT } = require("../config/defaults");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "scroll-explorer" });

/**
 * Find the primary scrollable element from XML.
 * Returns its bounds, or a screen-center fallback.
 *
 * @param {string} xml
 * @returns {{ bounds: { x1: number, y1: number, x2: number, y2: number }, isDefault: boolean }}
 */
function findScrollableElement(xml) {
  if (!xml) return { bounds: { x1: 0, y1: 200, x2: 1080, y2: 1800 }, isDefault: true };

  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;
  let largestScrollable = null;
  let largestArea = 0;

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    if (!/scrollable="true"/i.test(attrs)) continue;

    const boundsMatch = attrs.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!boundsMatch) continue;

    const b = {
      x1: parseInt(boundsMatch[1], 10),
      y1: parseInt(boundsMatch[2], 10),
      x2: parseInt(boundsMatch[3], 10),
      y2: parseInt(boundsMatch[4], 10),
    };
    const area = (b.x2 - b.x1) * (b.y2 - b.y1);

    if (area > largestArea) {
      largestArea = area;
      largestScrollable = b;
    }
  }

  if (largestScrollable) {
    return { bounds: largestScrollable, isDefault: false };
  }

  return { bounds: { x1: 0, y1: 200, x2: 1080, y2: 1800 }, isDefault: true };
}

/**
 * Detect horizontally-scrollable elements (carousels, image galleries).
 *
 * @param {string} xml
 * @returns {Array<{ bounds: object, className: string, resourceId: string }>}
 */
function detectHorizontalScrollables(xml) {
  if (!xml) return [];

  const results = [];
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    if (!/scrollable="true"/i.test(attrs)) continue;

    const boundsMatch = attrs.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!boundsMatch) continue;

    const b = {
      x1: parseInt(boundsMatch[1], 10),
      y1: parseInt(boundsMatch[2], 10),
      x2: parseInt(boundsMatch[3], 10),
      y2: parseInt(boundsMatch[4], 10),
    };

    const width = b.x2 - b.x1;
    const height = b.y2 - b.y1;

    // Horizontal scrollable: wider than tall, or known horizontal classes
    const cls = (attrs.match(/class="([^"]*)"/i) || [])[1] || "";
    const isHorizontal =
      width > height * 1.5 ||
      /HorizontalScrollView|ViewPager|TabLayout/i.test(cls);

    if (isHorizontal) {
      const rid = (attrs.match(/resource-id="([^"]*)"/i) || [])[1] || "";
      results.push({ bounds: b, className: cls, resourceId: rid });
    }
  }

  return results;
}

/**
 * Explore scroll depth of the current screen.
 *
 * Scrolls down repeatedly, re-extracting actions after each scroll.
 * Stops when content stops changing or maxScrolls is reached.
 *
 * @param {string} initialXml - XML before scrolling
 * @param {Set<string>} triedActions - Actions already tried (to filter duplicates)
 * @param {{ maxScrolls?: number, direction?: 'down'|'up' }} opts
 * @returns {Promise<{ scrollCount: number, newActions: Array, contentChanged: boolean }>}
 */
async function exploreScrollDepth(initialXml, triedActions, opts = {}) {
  const maxScrolls = opts.maxScrolls || MAX_SCROLLS_PER_SCREEN || 4;
  const direction = opts.direction || "down";
  const ctx = opts.ctx || null;
  const baseFp = opts.baseFp || null;

  // E4: Check per-screen scroll depth limit
  if (ctx && baseFp) {
    const prevDepth = ctx.scrollDepthByFp.get(baseFp) || 0;
    if (prevDepth >= maxScrolls) {
      log.info({ baseFp: baseFp.slice(0, 8), prevDepth, maxScrolls }, "Screen already fully scrolled — skipping");
      return { scrollCount: 0, newActions: [], contentChanged: false };
    }
  }

  const scrollTarget = findScrollableElement(initialXml);
  const allNewActions = [];
  let prevFp = fingerprint.compute(initialXml);
  let unchangedCount = 0;
  let scrollCount = 0;
  let consecutiveNoNewActions = 0;

  for (let i = 0; i < maxScrolls; i++) {
    gestures.scrollInBounds(scrollTarget.bounds, direction);
    await sleep(800);

    const readyResult = await readiness.waitForScreenReady({ timeoutMs: 3000 });
    const xml = readyResult.xml || adb.dumpXml();
    if (!xml) continue;

    scrollCount++;
    const currentFp = fingerprint.compute(xml);

    if (currentFp === prevFp) {
      unchangedCount++;
      if (unchangedCount >= (SCROLL_UNCHANGED_LIMIT || 2)) {
        log.info({ scrollCount }, "Content stopped changing");
        break;
      }
    } else {
      unchangedCount = 0;
      // Extract new actions revealed by scrolling
      const revealed = actions.extract(xml, triedActions);
      const newOnes = revealed.filter(
        (a) => a.type !== actions.ACTION_TYPES.SCROLL_DOWN &&
               a.type !== actions.ACTION_TYPES.SCROLL_UP &&
               a.type !== actions.ACTION_TYPES.BACK
      );
      if (newOnes.length > 0) {
        log.info({ scrollCount, newActions: newOnes.length }, "Scroll revealed new actions");
        allNewActions.push(...newOnes);
        consecutiveNoNewActions = 0;
      } else {
        consecutiveNoNewActions++;
        // E4: Scroll fatigue — content changes but no new actions (infinite feed)
        if (consecutiveNoNewActions >= 3) {
          log.info({ scrollCount, consecutiveNoNewActions }, "Scroll fatigue — no new actions despite content changes");
          break;
        }
      }
    }

    prevFp = currentFp;
  }

  // E4: Update per-screen scroll depth tracking
  if (ctx && baseFp) {
    const prevDepth = ctx.scrollDepthByFp.get(baseFp) || 0;
    ctx.scrollDepthByFp.set(baseFp, prevDepth + scrollCount);
  }

  return {
    scrollCount,
    newActions: allNewActions,
    contentChanged: scrollCount > 0 && unchangedCount < (SCROLL_UNCHANGED_LIMIT || 2),
  };
}

module.exports = {
  findScrollableElement,
  detectHorizontalScrollables,
  exploreScrollDepth,
};
