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

    const action = await inner(obs, state, deps);

    log.info(
      {
        action: action && action.type,
        reason,
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
};
