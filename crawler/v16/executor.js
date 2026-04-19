"use strict";

/**
 * v16/executor.js — Validates agent actions and executes them via ADB.
 *
 * Tool vocabulary (see plan):
 *   tap(x, y)
 *   type(text)             — substitutes ${EMAIL} / ${PASSWORD} from creds
 *   swipe(x1,y1,x2,y2)
 *   long_press(x, y)       — 800ms swipe from (x,y) to (x,y)
 *   press_back()
 *   press_home()
 *   launch_app()
 *   wait(ms)               — 0..3000
 *   done(reason)           — terminal
 *
 * Credential substitution lives here so the agent prompt never contains
 * plaintext passwords (stable prompt cache + safety).
 */

const defaultAdb = require("../adb");
const { sleep } = require("../../utils/sleep");
const { logger } = require("../../lib/logger");
const log = logger.child({ component: "v16-executor" });

const VALID_TYPES = new Set([
  "tap",
  "type",
  "swipe",
  "long_press",
  "press_back",
  "press_home",
  "launch_app",
  "wait",
  "done",
]);

const MAX_WAIT_MS = 3000;
const LONG_PRESS_MS = 800;

/**
 * @param {object} action
 * @returns {{ valid: boolean, error?: string }}
 */
function validateAction(action) {
  if (!action || typeof action !== "object") {
    return { valid: false, error: "action must be an object" };
  }
  if (!VALID_TYPES.has(action.type)) {
    return { valid: false, error: `unknown action type: ${action.type}` };
  }

  switch (action.type) {
    case "tap":
    case "long_press":
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) {
        return { valid: false, error: `${action.type} requires numeric x,y` };
      }
      return { valid: true };

    case "swipe":
      if (
        !Number.isFinite(action.x1) ||
        !Number.isFinite(action.y1) ||
        !Number.isFinite(action.x2) ||
        !Number.isFinite(action.y2)
      ) {
        return { valid: false, error: "swipe requires numeric x1,y1,x2,y2" };
      }
      return { valid: true };

    case "type":
      if (typeof action.text !== "string" || action.text.length === 0) {
        return { valid: false, error: "type requires non-empty text" };
      }
      return { valid: true };

    case "wait":
      if (!Number.isFinite(action.ms) || action.ms < 0 || action.ms > MAX_WAIT_MS) {
        return { valid: false, error: `wait.ms must be 0..${MAX_WAIT_MS}` };
      }
      return { valid: true };

    case "done":
      if (typeof action.reason !== "string" || action.reason.length === 0) {
        return { valid: false, error: "done requires reason string" };
      }
      return { valid: true };

    case "press_back":
    case "press_home":
    case "launch_app":
      return { valid: true };

    default:
      return { valid: false, error: `unhandled type: ${action.type}` };
  }
}

/**
 * Substitute credential placeholders in typed text.
 * Replaces ${EMAIL} and ${PASSWORD} with actual values from ctx.credentials.
 * @param {string} text
 * @param {{email?:string, password?:string}|null} credentials
 * @returns {string}
 */
function substituteCredentials(text, credentials) {
  let out = text;
  if (credentials && typeof credentials.email === "string") {
    out = out.split("${EMAIL}").join(credentials.email);
  }
  if (credentials && typeof credentials.password === "string") {
    out = out.split("${PASSWORD}").join(credentials.password);
  }
  return out;
}

/**
 * Execute a validated action.
 * @param {object} action
 * @param {{ targetPackage: string, credentials?: {email?:string,password?:string}, adb?: object }} ctx
 * @returns {Promise<{terminal:boolean, stopReason:string|null, ok:boolean, error:string|null}>}
 */
async function executeAction(action, ctx) {
  const v = validateAction(action);
  if (!v.valid) {
    return { terminal: false, stopReason: null, ok: false, error: v.error };
  }
  const adb = (ctx && ctx.adb) || defaultAdb;

  try {
    switch (action.type) {
      case "tap":
        adb.tap(Math.round(action.x), Math.round(action.y));
        return { terminal: false, stopReason: null, ok: true, error: null };

      case "long_press": {
        const x = Math.round(action.x);
        const y = Math.round(action.y);
        adb.swipe(x, y, x, y, LONG_PRESS_MS);
        return { terminal: false, stopReason: null, ok: true, error: null };
      }

      case "swipe":
        adb.swipe(
          Math.round(action.x1),
          Math.round(action.y1),
          Math.round(action.x2),
          Math.round(action.y2),
          300,
        );
        return { terminal: false, stopReason: null, ok: true, error: null };

      case "type": {
        const text = substituteCredentials(action.text, ctx.credentials || null);
        adb.inputText(text);
        return { terminal: false, stopReason: null, ok: true, error: null };
      }

      case "press_back":
        adb.pressBack();
        return { terminal: false, stopReason: null, ok: true, error: null };

      case "press_home":
        adb.pressHome();
        return { terminal: false, stopReason: null, ok: true, error: null };

      case "launch_app":
        if (!ctx.targetPackage) {
          return { terminal: false, stopReason: null, ok: false, error: "no targetPackage" };
        }
        adb.launchApp(ctx.targetPackage);
        return { terminal: false, stopReason: null, ok: true, error: null };

      case "wait":
        await sleep(action.ms);
        return { terminal: false, stopReason: null, ok: true, error: null };

      case "done":
        return {
          terminal: true,
          stopReason: `agent_done:${action.reason}`,
          ok: true,
          error: null,
        };

      default:
        return { terminal: false, stopReason: null, ok: false, error: "unhandled type" };
    }
  } catch (err) {
    log.warn({ err: err.message, action }, "action execution threw");
    return { terminal: false, stopReason: null, ok: false, error: err.message };
  }
}

module.exports = {
  validateAction,
  executeAction,
  substituteCredentials,
  VALID_TYPES,
  MAX_WAIT_MS,
};
