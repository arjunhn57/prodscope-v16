"use strict";

/**
 * action-executor.js — Executes actions on the emulator and records them.
 */

const adb = require("./adb");
const actions = require("./actions");
const gestures = require("./gestures");
const { findScrollableElement } = require("./scroll-explorer");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "action-executor" });

/**
 * Execute an action on the emulator.
 *
 * @param {object} action - Action object with type, bounds, text, resourceId, etc.
 * @returns {string} Description of what was executed
 */
function executeAction(action) {
  switch (action.type) {
    case actions.ACTION_TYPES.TAP:
      adb.tap(action.bounds.cx, action.bounds.cy);
      return `tap(${action.bounds.cx}, ${action.bounds.cy}) on "${action.text || action.resourceId || "element"}"`;

    case actions.ACTION_TYPES.TYPE:
      adb.tap(action.bounds.cx, action.bounds.cy);
      return `focus field "${action.resourceId || "edittext"}" (filling handled by forms module)`;

    case actions.ACTION_TYPES.SCROLL_DOWN: {
      const scrollEl = findScrollableElement(null);
      gestures.scrollInBounds(scrollEl.bounds, "down");
      return "scroll_down";
    }

    case actions.ACTION_TYPES.SCROLL_UP: {
      const scrollEl = findScrollableElement(null);
      gestures.scrollInBounds(scrollEl.bounds, "up");
      return "scroll_up";
    }

    case actions.ACTION_TYPES.LONG_PRESS:
      gestures.longPress(action.bounds.cx, action.bounds.cy);
      return `long_press(${action.bounds.cx}, ${action.bounds.cy}) on "${action.text || action.resourceId || "element"}"`;

    case actions.ACTION_TYPES.SWIPE_LEFT:
      gestures.swipeLeft(action.bounds);
      return "swipe_left";

    case actions.ACTION_TYPES.SWIPE_RIGHT:
      gestures.swipeRight(action.bounds);
      return "swipe_right";

    case actions.ACTION_TYPES.BACK:
      adb.pressBack();
      return "press_back";

    case actions.ACTION_TYPES.AGENT_TAP:
      adb.tap(action.x, action.y);
      return `agent_tap(${action.x}, ${action.y})`;

    case actions.ACTION_TYPES.AGENT_TYPE:
      adb.inputText(action.text || "");
      return `agent_type(${(action.text || "").slice(0, 40)}${(action.text || "").length > 40 ? "..." : ""})`;

    case actions.ACTION_TYPES.AGENT_SWIPE:
      adb.swipe(action.x1, action.y1, action.x2, action.y2, action.durationMs || 300);
      return `agent_swipe(${action.x1},${action.y1} → ${action.x2},${action.y2}, ${action.durationMs || 300}ms)`;

    case actions.ACTION_TYPES.AGENT_LONG_PRESS:
      gestures.longPress(action.x, action.y);
      return `agent_long_press(${action.x}, ${action.y})`;

    case actions.ACTION_TYPES.AGENT_BACK:
      adb.pressBack();
      return "agent_back";

    case actions.ACTION_TYPES.AGENT_WAIT:
      // No-op: STAGE 16 readiness wait covers actual delays. We just record intent.
      return `agent_wait(${action.durationMs || 0}ms)`;

    default:
      log.warn({ actionType: action.type }, "Unknown action type");
      return `unknown(${action.type})`;
  }
}

module.exports = { executeAction };
