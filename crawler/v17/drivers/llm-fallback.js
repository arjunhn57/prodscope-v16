"use strict";

/**
 * v17/drivers/llm-fallback.js
 *
 * Named wrapper around the v16 LLM-per-step agent. Exists so that:
 *   1. the dispatcher can treat LLMFallback as a peer of the real drivers
 *      (same signature, uniform tracing);
 *   2. every escalation is preceded by a compact log record describing WHY
 *      the deterministic drivers didn't handle the screen (which drivers
 *      claimed-but-returned-null, what classes / roles / inputs were on
 *      screen). This is the Phase D telemetry that tells us what is eating
 *      our cost budget.
 *
 * NOTE: this module intentionally does not own token-accounting or Sonnet-
 * escalation state. The agent-loop already owns that via a shared
 * `lastLlmCall` closure; this module is strictly a logging-and-routing seam.
 *
 * Export contract:
 *   createLlmFallback(inner, { getDiagnostics }) → async (obs, state, deps)
 *     where `inner` is the async fn that actually calls Haiku/Sonnet
 *     (agent-loop's existing closure) and `getDiagnostics()` returns the
 *     per-dispatch diagnostics that the dispatcher has filled in.
 */

const { parseClickableGraph } = require("./clickable-graph");
const { logger } = require("../../../lib/logger");

const log = logger.child({ component: "v17-llm-fallback" });

/** Max node-type buckets we log so the line stays readable. */
const MAX_CLASS_BUCKETS = 8;

/**
 * Phase 2b (2026-04-24): screen types where press_back is safe. On feed /
 * profile / settings / search / detail / compose / auth / permission, the
 * LLM's press_back emission means "exit the app" — which causes drift loops.
 * Only these screen types may receive a press_back from LLMFallback:
 */
const PRESS_BACK_SAFE_SCREEN_TYPES = new Set([
  "error",    // genuine dead-end
  "dialog",   // overlay on top of a real screen — dismiss is fine
  "other",    // uncategorised, give the LLM benefit of the doubt
]);

/**
 * Phase 2b: intents LLMFallback may tap. Includes "unknown" — the silence-
 * default (v18/semantic-classifier.js mergeClassifications) tags nodes the
 * classifier didn't enumerate as unknown, and on many biztoso screens that's
 * most of the graph. Rejecting all unknown taps blocks progress and causes
 * wait-stacks that v17's consecutive-identical guard escalates to press_back
 * → drift (see run 09eb85c3, 2026-04-24).
 *
 * Only "write" and "destructive" are definitively blocked here.
 */
const FALLBACK_ALLOWED_INTENTS = new Set(["navigate", "read_only", "unknown"]);

/**
 * Derive a compact screen signature from the XML. The returned object is
 * log-friendly (small, no free-text user content) and is the primary artefact
 * we use after the run to diagnose what forced the escalation.
 *
 * Fields:
 *   classes       : top-N className → count (trimmed; ordered by count desc)
 *   clickableCount: total clickable nodes
 *   inputCount    : total EditText / TextField nodes
 *   passwordCount : input nodes with inputType=textPassword or id/~password/i
 *   hasModalHint  : XML contains BottomSheet / Dialog / Popup / Overlay
 *   hasNavHint    : XML contains BottomNavigation / TabLayout / Drawer
 *   hasWebViewHint: XML contains a WebView node (common LLMFallback trigger
 *                   because the accessibility tree beneath is opaque)
 *
 * @param {string} xml
 * @returns {object}
 */
function buildScreenSignature(xml) {
  const signature = {
    classes: {},
    clickableCount: 0,
    inputCount: 0,
    passwordCount: 0,
    hasModalHint: false,
    hasNavHint: false,
    hasWebViewHint: false,
    hasAuthHint: false,
  };
  if (typeof xml !== "string" || !xml) return signature;

  signature.hasModalHint = /class="[^"]*(?:BottomSheet|PopupWindow|Dialog|ModalLayer|Overlay|Popup)/i.test(xml);
  signature.hasNavHint = /class="[^"]*(?:BottomNavigation|NavigationBarItem|TabLayout|NavigationMenuItemView|NavigationDrawerItem|RecyclerView|LazyColumn|LazyList)/.test(xml);
  signature.hasWebViewHint = /class="[^"]*WebView"/i.test(xml);
  signature.hasAuthHint = /inputType="textPassword"|type="password"|resource-id="[^"]*pass(?:word)?"|resource-id="[^"]*email"/i.test(xml);

  let graph;
  try {
    graph = parseClickableGraph(xml);
  } catch (_err) {
    return signature;
  }

  signature.clickableCount = graph.clickables.length;
  const classCounts = new Map();
  for (const c of graph.clickables) {
    if (c.isInput) signature.inputCount += 1;
    if (c.isPassword) signature.passwordCount += 1;
    const cls = typeof c.className === "string" ? c.className : "";
    const short = shortClassName(cls);
    classCounts.set(short, (classCounts.get(short) || 0) + 1);
  }
  signature.classes = Object.fromEntries(
    Array.from(classCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CLASS_BUCKETS),
  );
  return signature;
}

/**
 * Trim verbose Android class paths to the final segment so log lines stay
 * within a reasonable width. "androidx.appcompat.widget.AppCompatImageButton"
 * → "AppCompatImageButton".
 */
function shortClassName(cls) {
  if (!cls) return "";
  const last = cls.split(".").pop();
  // Also trim inner-class tails: "TabLayout$TabView" → "TabLayout$TabView"
  // (keep both halves — the $ delimiter is meaningful for dispatch logic).
  return typeof last === "string" ? last : cls;
}

/**
 * Find the clickable whose bounds contain the tap coordinates.
 *
 * @param {Array<{bounds?:{x1:number,y1:number,x2:number,y2:number}}>} clickables
 * @param {number} x
 * @param {number} y
 * @returns {object|null}
 */
function findClickableAt(clickables, x, y) {
  if (!Array.isArray(clickables) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const c of clickables) {
    const b = c && c.bounds;
    if (!b) continue;
    if (x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2) return c;
  }
  return null;
}

/**
 * Pick the safest alternative tap action for this screen when the LLM's
 * choice violates the plan. Tiered preference:
 *   1. Highest-priority navigate-intent clickable.
 *   2. Highest-priority read_only-intent clickable.
 *   3. Highest-priority unknown-intent clickable (benefit of the doubt).
 *
 * Returns null if no non-write/destructive clickable exists. Callers should
 * treat null as "let the original action pass through" — emitting `wait`
 * here caused wait-stacks (3 consecutive waits → v17 forces press_back →
 * drift, see run 09eb85c3).
 *
 * @param {Array<object>} classifiedClickables
 * @returns {{type:'tap', x:number, y:number, targetText?:string}|null}
 */
function pickSafeAlternative(classifiedClickables) {
  if (!Array.isArray(classifiedClickables) || classifiedClickables.length === 0) {
    return null;
  }
  // Tier by intent. Within a tier, pick highest priority.
  const tiers = ["navigate", "read_only", "unknown"];
  for (const intent of tiers) {
    const candidates = classifiedClickables
      .filter((c) => c && c.intent === intent)
      .slice()
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    if (candidates.length > 0) {
      const safe = candidates[0];
      const action = { type: "tap", x: safe.cx, y: safe.cy };
      if (safe.label) action.targetText = safe.label;
      return action;
    }
  }
  return null;
}

/**
 * Phase 2b validation. If the inner LLM picked an action that would break
 * out of the target app (tap on write/destructive intent, or press_back
 * on a non-dead-end screen), swap for a safer action. Returns
 * { action, overridden: bool, reason: string|null }.
 *
 * @param {object} action
 * @param {{plan?:object, classifiedClickables?:object[]}} deps
 */
function validateAgainstPlan(action, deps) {
  if (!action || !deps || !deps.plan) {
    return { action, overridden: false, reason: null };
  }
  const plan = deps.plan;
  const classifiedClickables = Array.isArray(deps.classifiedClickables)
    ? deps.classifiedClickables
    : [];

  // Rule 1: tap on a write/destructive-intent clickable → override.
  // Pass through on unknown intent — silence-default tags many valid taps
  // as unknown on partially-classified screens.
  if (action.type === "tap") {
    const hit = findClickableAt(classifiedClickables, action.x, action.y);
    if (hit && hit.intent && !FALLBACK_ALLOWED_INTENTS.has(hit.intent)) {
      const safe = pickSafeAlternative(classifiedClickables);
      if (safe) {
        return {
          action: safe,
          overridden: true,
          reason: `tap_on_${hit.intent}_intent:${hit.label || hit.resourceId || "unknown"}`,
        };
      }
      // No safer tap exists. Let the original pass — a single write-tap that
      // drifts to another app is recoverable (drift guard + relaunchApp).
      // Substituting `wait` caused wait-stacks → forced press_back → drift.
      return {
        action,
        overridden: false,
        reason: `pass_through_no_safe_alt_after_tap_on_${hit.intent}`,
      };
    }
  }

  // Rule 2: press_back on a non-dead-end screen — press_back exits the
  // target app from feed/profile/settings/etc. Only safe on error/dialog/
  // other screen types. Exception: if Haiku itself said engine_action=
  // press_back, trust the strategist.
  if (
    action.type === "press_back" &&
    plan.engineAction !== "press_back" &&
    !PRESS_BACK_SAFE_SCREEN_TYPES.has(plan.screenType)
  ) {
    const safe = pickSafeAlternative(classifiedClickables);
    if (safe) {
      return {
        action: safe,
        overridden: true,
        reason: `press_back_on_${plan.screenType}_screen`,
      };
    }
    // No safer tap exists. Press_back will drift to the launcher and trip
    // drift guard — but that's still preferable to wait-stack-loop, and
    // the drift counter caps terminate cleanly.
    return {
      action,
      overridden: false,
      reason: `pass_through_no_safe_alt_for_press_back_on_${plan.screenType}`,
    };
  }

  return { action, overridden: false, reason: null };
}

/**
 * Build the wrapped LLMFallback the dispatcher will call.
 *
 * @param {(obs:any, state:any, deps:any) => Promise<any>} inner
 *   Underlying Haiku/Sonnet invocation closure; agent-loop provides this.
 *
 * @returns {(obs:any, state:any, deps:any) => Promise<any>}
 *
 * The dispatcher exposes its per-dispatch diagnostics on `deps.getDiagnostics`
 * — we call it once per escalation to derive the reason code.
 */
function createLlmFallback(inner) {
  if (typeof inner !== "function") {
    throw new TypeError("createLlmFallback: inner must be an async function");
  }

  return async function llmFallback(obs, state, deps) {
    const signature = buildScreenSignature(obs && obs.xml);
    const diagnostics =
      deps && typeof deps.getDiagnostics === "function" ? deps.getDiagnostics() || {} : {};
    const claimedButNull = Array.isArray(diagnostics.claimedButNull) ? diagnostics.claimedButNull : [];
    const claimThrew = Array.isArray(diagnostics.claimThrew) ? diagnostics.claimThrew : [];

    const reason = deriveReason({ claimedButNull, claimThrew, signature });

    log.info(
      {
        reason,
        claimedButNull: claimedButNull.map((x) => `${x.driver}:${x.reason || "null"}`),
        claimThrew: claimThrew.map((x) => x.driver),
        packageName: obs && obs.packageName,
        activity: obs && obs.activity,
        signature,
      },
      "llm-fallback: escalating",
    );

    const rawAction = await inner(obs, state, deps);

    // Phase 2b: validate against the v18 plan if the dispatcher threaded one
    // through. This catches the v16 agent's write-intent taps (e.g. "Camera"
    // on a compose screen) and press_back on non-dead-end screens that
    // previously caused drift loops.
    const { action, overridden, reason: overrideReason } = validateAgainstPlan(rawAction, deps);
    if (overridden) {
      log.warn(
        {
          overrideReason,
          originalAction: rawAction && rawAction.type,
          originalTarget: rawAction && rawAction.targetText,
          newAction: action && action.type,
          screenType: deps && deps.plan && deps.plan.screenType,
        },
        "llm-fallback: intent/screen validation overrode LLM action",
      );
    }

    log.info(
      {
        action: action && action.type,
        reason,
        overridden,
      },
      "llm-fallback: produced action",
    );

    // Surface the reason back through the deps object so the harness /
    // agent-loop can collect it without needing a second channel.
    if (deps && typeof deps === "object") {
      deps.lastLlmFallbackReason = reason;
      deps.lastLlmFallbackSignature = signature;
    }

    return action;
  };
}

/**
 * @param {{claimedButNull:Array<{driver:string,reason:string}>, claimThrew:Array<any>, signature:any}} ctx
 * @returns {string}
 */
function deriveReason(ctx) {
  if (ctx.claimThrew.length > 0) return "driver_threw";
  if (ctx.claimedButNull.length > 0) {
    return `driver_claimed_but_null:${ctx.claimedButNull.map((x) => x.driver).join("+")}`;
  }
  if (ctx.signature.hasWebViewHint) return "no_driver_claimed:webview";
  if (ctx.signature.hasAuthHint) return "no_driver_claimed:auth_like";
  if (ctx.signature.hasModalHint) return "no_driver_claimed:modal";
  if (ctx.signature.hasNavHint) return "no_driver_claimed:nav_unhandled";
  if (ctx.signature.clickableCount === 0) return "no_driver_claimed:empty_tree";
  return "no_driver_claimed:other";
}

module.exports = {
  name: "LLMFallback",
  createLlmFallback,
  buildScreenSignature,
  deriveReason,
  // Phase 2b exports for direct testing.
  validateAgainstPlan,
  findClickableAt,
  pickSafeAlternative,
  PRESS_BACK_SAFE_SCREEN_TYPES,
  FALLBACK_ALLOWED_INTENTS,
};
