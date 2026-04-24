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
const { resolveTapTarget } = require("./tap-target-resolver");
const log = logger.child({ component: "v16-executor" });

const VALID_TYPES = new Set([
  // Core pointer gestures
  "tap",
  "double_tap",
  "long_press",
  "drag",
  // Directional swipes (vertical / horizontal content)
  "swipe",
  "scroll_up",
  "scroll_down",
  "swipe_horizontal",
  "pull_to_refresh",
  // Edge swipes (gesture-nav)
  "edge_swipe_back",
  "edge_swipe_drawer",
  "edge_swipe_home",
  // Text input
  "type",
  "clear_field",
  // Keys
  "press_back",
  "press_home",
  "press_menu",
  "press_app_switch",
  "press_escape",
  "ime_action",
  // Lifecycle
  "launch_app",
  "wait",
  "done",
  "request_human_input",
]);

/** Default screen dimensions when an action doesn't carry its own. */
const DEFAULT_SCREEN_W = 1080;
const DEFAULT_SCREEN_H = 2400;

/** Edge-swipe tuning — small start-offset from the edge so the system
 *  gesture detector reliably fires, and generous drag distance. */
const EDGE_SWIPE_DURATION_MS = 200;
const HORIZONTAL_SWIPE_DURATION_MS = 280;
const VERTICAL_SCROLL_DURATION_MS = 300;
const PULL_TO_REFRESH_DURATION_MS = 500;
const DOUBLE_TAP_GAP_MS = 80;

const KNOWN_INPUT_FIELDS = new Set(["otp", "email_code", "2fa", "captcha"]);

const MAX_WAIT_MS = 3000;
const LONG_PRESS_MS = 800;
// Threshold above which XML override vs vision coord is interesting enough to
// log. Noise below ~50px is typical rounding / center-point jitter.
const TAP_DRIFT_WARN_PX = 50;

/**
 * Resolve tap coords, preferring XML when the model emitted an action.targetText
 * and ctx.xml is available. Falls back to model (x, y) when XML misses.
 *
 * @param {{type:string, x:number, y:number, targetText?:string}} action
 * @param {{xml?:string|null}} ctx
 * @returns {{x:number, y:number}}
 */
function resolveTapCoords(action, ctx) {
  const visionX = action.x;
  const visionY = action.y;
  const xml = ctx && typeof ctx.xml === "string" ? ctx.xml : null;
  const targetText = typeof action.targetText === "string" ? action.targetText : null;
  if (!targetText || !xml) {
    return { x: visionX, y: visionY };
  }
  const resolved = resolveTapTarget(xml, targetText, { x: visionX, y: visionY });
  if (resolved.source !== "xml") {
    return { x: visionX, y: visionY };
  }
  const dx = Math.abs(resolved.x - visionX);
  const dy = Math.abs(resolved.y - visionY);
  if (dx > TAP_DRIFT_WARN_PX || dy > TAP_DRIFT_WARN_PX) {
    log.info(
      {
        actionType: action.type,
        targetText,
        vision: { x: visionX, y: visionY },
        xml: { x: resolved.x, y: resolved.y },
        drift: Math.max(dx, dy),
        confidence: resolved.confidence,
      },
      "tap-target: xml override",
    );
  }
  return { x: resolved.x, y: resolved.y };
}

/**
 * Resolve the screen dimensions for coord-computing gestures. Order:
 *   1. Action-level override (action.screenWidth / action.screenHeight)
 *   2. Context (ctx.screenWidth / ctx.screenHeight) — agent-loop can thread
 *      these from the inferred-screen-size helper in ExplorationDriver
 *   3. Default (1080×2400)
 *
 * @param {object} action
 * @param {object} ctx
 * @returns {{w:number, h:number}}
 */
function screenSize(action, ctx) {
  const w =
    (action && Number.isFinite(action.screenWidth) && action.screenWidth) ||
    (ctx && Number.isFinite(ctx.screenWidth) && ctx.screenWidth) ||
    DEFAULT_SCREEN_W;
  const h =
    (action && Number.isFinite(action.screenHeight) && action.screenHeight) ||
    (ctx && Number.isFinite(ctx.screenHeight) && ctx.screenHeight) ||
    DEFAULT_SCREEN_H;
  return { w, h };
}

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

    case "request_human_input":
      if (typeof action.field !== "string" || action.field.length === 0) {
        return { valid: false, error: "request_human_input requires field string" };
      }
      if (!KNOWN_INPUT_FIELDS.has(action.field)) {
        return { valid: false, error: `request_human_input.field must be one of ${[...KNOWN_INPUT_FIELDS].join("|")}` };
      }
      if (typeof action.prompt !== "string" || action.prompt.length === 0) {
        return { valid: false, error: "request_human_input requires prompt string" };
      }
      return { valid: true };

    case "press_back":
    case "press_home":
    case "press_menu":
    case "press_app_switch":
    case "press_escape":
    case "ime_action":
    case "launch_app":
    case "clear_field":
      return { valid: true };

    case "double_tap":
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) {
        return { valid: false, error: "double_tap requires numeric x,y" };
      }
      return { valid: true };

    case "drag":
      if (
        !Number.isFinite(action.x1) || !Number.isFinite(action.y1) ||
        !Number.isFinite(action.x2) || !Number.isFinite(action.y2)
      ) {
        return { valid: false, error: "drag requires numeric x1,y1,x2,y2" };
      }
      return { valid: true };

    // Directional swipes. All accept optional screenWidth/screenHeight —
    // callers that know the emulator dimensions pass them; otherwise the
    // executor uses DEFAULT_SCREEN_W/H.
    case "scroll_up":
    case "scroll_down":
    case "edge_swipe_back":
    case "edge_swipe_drawer":
    case "edge_swipe_home":
    case "pull_to_refresh":
      return { valid: true };

    case "swipe_horizontal":
      if (action.direction !== "left" && action.direction !== "right") {
        return { valid: false, error: "swipe_horizontal requires direction='left'|'right'" };
      }
      return { valid: true };

    default:
      return { valid: false, error: `unhandled type: ${action.type}` };
  }
}

/**
 * Substitute credential placeholders in typed text.
 * Replaces ${EMAIL} and ${PASSWORD} with actual values from ctx.credentials.
 * ${EMAIL} prefers credentials.email, falling back to credentials.username —
 * the upload UI accepts both, and some users paste { "username": "...", ... }.
 * @param {string} text
 * @param {{email?:string, username?:string, password?:string}|null} credentials
 * @returns {string}
 */
function substituteCredentials(text, credentials) {
  let out = text;
  const emailLike =
    credentials && typeof credentials.email === "string" && credentials.email
      ? credentials.email
      : credentials && typeof credentials.username === "string" && credentials.username
        ? credentials.username
        : null;
  if (emailLike) {
    out = out.split("${EMAIL}").join(emailLike);
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
      case "tap": {
        const { x, y } = resolveTapCoords(action, ctx);
        adb.tap(Math.round(x), Math.round(y));
        return { terminal: false, stopReason: null, ok: true, error: null };
      }

      case "long_press": {
        const { x, y } = resolveTapCoords(action, ctx);
        const rx = Math.round(x);
        const ry = Math.round(y);
        adb.swipe(rx, ry, rx, ry, LONG_PRESS_MS);
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

      case "double_tap": {
        const { x, y } = resolveTapCoords(action, ctx);
        const rx = Math.round(x);
        const ry = Math.round(y);
        adb.tap(rx, ry);
        await sleep(DOUBLE_TAP_GAP_MS);
        adb.tap(rx, ry);
        return { terminal: false, stopReason: null, ok: true, error: null };
      }

      case "drag":
        adb.swipe(
          Math.round(action.x1),
          Math.round(action.y1),
          Math.round(action.x2),
          Math.round(action.y2),
          action.durationMs || 700,
        );
        return { terminal: false, stopReason: null, ok: true, error: null };

      case "scroll_up":
      case "scroll_down": {
        const { w, h } = screenSize(action, ctx);
        const cx = Math.floor(w / 2);
        const yTop = Math.floor(h * 0.25);
        const yBottom = Math.floor(h * 0.75);
        const [y1, y2] = action.type === "scroll_down"
          ? [yBottom, yTop]
          : [yTop, yBottom];
        adb.swipe(cx, y1, cx, y2, VERTICAL_SCROLL_DURATION_MS);
        return { terminal: false, stopReason: null, ok: true, error: null };
      }

      case "swipe_horizontal": {
        const { w, h } = screenSize(action, ctx);
        const cy = Math.floor(h / 2);
        const xLeft = Math.floor(w * 0.2);
        const xRight = Math.floor(w * 0.8);
        const [x1, x2] = action.direction === "left"
          ? [xRight, xLeft]   // swipe from right to left = "next page"
          : [xLeft, xRight];  // swipe from left to right = "prev page"
        adb.swipe(x1, cy, x2, cy, HORIZONTAL_SWIPE_DURATION_MS);
        return { terminal: false, stopReason: null, ok: true, error: null };
      }

      case "pull_to_refresh": {
        const { w, h } = screenSize(action, ctx);
        const cx = Math.floor(w / 2);
        adb.swipe(cx, Math.floor(h * 0.3), cx, Math.floor(h * 0.75), PULL_TO_REFRESH_DURATION_MS);
        return { terminal: false, stopReason: null, ok: true, error: null };
      }

      case "edge_swipe_back": {
        // Android 10+ gesture-nav BACK — swipe from left edge inward.
        const { w, h } = screenSize(action, ctx);
        const cy = Math.floor(h / 2);
        adb.swipe(0, cy, Math.floor(w * 0.4), cy, EDGE_SWIPE_DURATION_MS);
        return { terminal: false, stopReason: null, ok: true, error: null };
      }

      case "edge_swipe_drawer": {
        // Open hamburger drawer (Material DrawerLayout or gesture-nav forward).
        const { w, h } = screenSize(action, ctx);
        const cy = Math.floor(h / 2);
        adb.swipe(Math.max(0, w - 1), cy, Math.floor(w * 0.6), cy, EDGE_SWIPE_DURATION_MS);
        return { terminal: false, stopReason: null, ok: true, error: null };
      }

      case "edge_swipe_home": {
        // Android 10+ gesture-nav HOME — swipe up from bottom edge.
        const { w, h } = screenSize(action, ctx);
        const cx = Math.floor(w / 2);
        adb.swipe(cx, Math.max(0, h - 1), cx, Math.floor(h * 0.3), EDGE_SWIPE_DURATION_MS);
        return { terminal: false, stopReason: null, ok: true, error: null };
      }

      case "clear_field": {
        // Move caret to end of field, then DEL repeatedly. 200 iterations
        // covers most realistic field lengths without being catastrophic
        // on short fields (extra DELs are no-ops on empty fields).
        adb.keyEvent("KEYCODE_MOVE_END");
        for (let i = 0; i < 200; i++) adb.keyEvent("KEYCODE_DEL");
        return { terminal: false, stopReason: null, ok: true, error: null };
      }

      case "press_menu":
        adb.keyEvent("KEYCODE_MENU");
        return { terminal: false, stopReason: null, ok: true, error: null };

      case "press_app_switch":
        adb.keyEvent("KEYCODE_APP_SWITCH");
        return { terminal: false, stopReason: null, ok: true, error: null };

      case "press_escape":
        adb.keyEvent("KEYCODE_ESCAPE");
        return { terminal: false, stopReason: null, ok: true, error: null };

      case "ime_action":
        // KEYCODE_ENTER triggers the IME action on most search boxes
        // (Search / Go / Next / Done). Much cheaper than guessing which
        // on-screen button submits a search.
        adb.pressEnter();
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

      case "request_human_input": {
        if (typeof ctx.resolveHumanInput !== "function") {
          return {
            terminal: false,
            stopReason: null,
            ok: false,
            error: "no resolveHumanInput handler wired",
          };
        }
        try {
          const resolved = await ctx.resolveHumanInput({
            field: action.field,
            prompt: action.prompt,
          });
          if (!resolved || typeof resolved.value !== "string" || resolved.value.length === 0) {
            return {
              terminal: false,
              stopReason: null,
              ok: false,
              error: "resolveHumanInput returned empty value",
            };
          }
          adb.inputText(resolved.value);
          return {
            terminal: false,
            stopReason: null,
            ok: true,
            error: null,
            humanInput: { field: action.field, source: resolved.source || "unknown" },
          };
        } catch (err) {
          const isTimeout = err && err.message === "INPUT_TIMEOUT";
          const isCancel = err && err.message === "INPUT_CANCELLED";
          if (isTimeout || isCancel) {
            return {
              terminal: true,
              stopReason: `agent_done:blocked_by_auth:${isTimeout ? "timeout" : "user_cancelled"}`,
              ok: true,
              error: null,
              humanInput: { field: action.field, source: isTimeout ? "timeout" : "cancel" },
            };
          }
          return { terminal: false, stopReason: null, ok: false, error: err.message };
        }
      }

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
  KNOWN_INPUT_FIELDS,
  MAX_WAIT_MS,
};
