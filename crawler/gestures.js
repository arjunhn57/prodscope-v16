"use strict";

/**
 * gestures.js — Rich gesture vocabulary beyond tap/scroll/back.
 * Adds long-press, horizontal swipe, pull-to-refresh.
 */

const adb = require("./adb");

/**
 * Long-press at (x, y) for the given duration.
 * Android long-press threshold is 500ms; we use 800ms for reliability.
 * Implemented as a zero-distance swipe.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} durationMs
 */
function longPress(x, y, durationMs = 800) {
  adb.swipe(x, y, x, y, durationMs);
}

/**
 * Swipe left within the given bounds (e.g., carousel, dismiss card).
 * @param {{ x1: number, y1: number, x2: number, y2: number }} bounds
 */
function swipeLeft(bounds) {
  const cy = Math.floor((bounds.y1 + bounds.y2) / 2);
  const startX = bounds.x2 - 30;
  const endX = bounds.x1 + 30;
  adb.swipe(startX, cy, endX, cy, 300);
}

/**
 * Swipe right within the given bounds.
 * @param {{ x1: number, y1: number, x2: number, y2: number }} bounds
 */
function swipeRight(bounds) {
  const cy = Math.floor((bounds.y1 + bounds.y2) / 2);
  const startX = bounds.x1 + 30;
  const endX = bounds.x2 - 30;
  adb.swipe(startX, cy, endX, cy, 300);
}

/**
 * Pull-to-refresh from the top of the screen.
 * Uses the center of the screen horizontally, top third vertically.
 */
function pullToRefresh() {
  adb.swipe(540, 400, 540, 1200, 500);
}

/**
 * Scroll vertically using the bounds of a specific scrollable element.
 * Avoids hardcoded coordinates.
 *
 * @param {{ x1: number, y1: number, x2: number, y2: number }} bounds
 * @param {'down'|'up'} direction
 */
function scrollInBounds(bounds, direction = "down") {
  const cx = Math.floor((bounds.x1 + bounds.x2) / 2);
  const topY = bounds.y1 + Math.floor((bounds.y2 - bounds.y1) * 0.2);
  const botY = bounds.y1 + Math.floor((bounds.y2 - bounds.y1) * 0.8);

  if (direction === "down") {
    adb.swipe(cx, botY, cx, topY, 400);
  } else {
    adb.swipe(cx, topY, cx, botY, 400);
  }
}

/**
 * Scroll horizontally using the bounds of a specific scrollable element.
 *
 * @param {{ x1: number, y1: number, x2: number, y2: number }} bounds
 * @param {'left'|'right'} direction
 */
function scrollHorizontalInBounds(bounds, direction = "left") {
  const cy = Math.floor((bounds.y1 + bounds.y2) / 2);
  const leftX = bounds.x1 + Math.floor((bounds.x2 - bounds.x1) * 0.2);
  const rightX = bounds.x1 + Math.floor((bounds.x2 - bounds.x1) * 0.8);

  if (direction === "left") {
    adb.swipe(rightX, cy, leftX, cy, 300);
  } else {
    adb.swipe(leftX, cy, rightX, cy, 300);
  }
}

module.exports = {
  longPress,
  swipeLeft,
  swipeRight,
  pullToRefresh,
  scrollInBounds,
  scrollHorizontalInBounds,
};
