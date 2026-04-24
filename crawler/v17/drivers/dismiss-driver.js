"use strict";

/**
 * v17/drivers/dismiss-driver.js
 *
 * Handles in-app upsell / announcement / prompt modals that sit on top of
 * real content. Leaves full-screen auth walls and non-modal screens to
 * AuthDriver and LLMFallback respectively.
 *
 * Design per Phase B.2 plan:
 *   - Claim is a cheap XML-structural gate: a modal-like class name (Dialog /
 *     BottomSheet / PopupWindow / ModalLayer) OR an explicit close-icon
 *     content-desc / resource-id. This keeps the classifier off the hot path
 *     for screens that couldn't possibly be modals.
 *   - Decide delegates semantic label interpretation to node-classifier. The
 *     classifier's Haiku prompt already teaches it that "Not Now" / "Skip" /
 *     "Later" / "✕" in any language → dismiss_button. Cross-run cache means
 *     each modal layout pays the Haiku cost once.
 *   - Dispatcher priority places DismissDriver BEFORE AuthDriver so upsell
 *     modals stacked on top of an auth wall get dismissed first.
 */

const { parseClickableGraph } = require("./clickable-graph");
const nodeClassifier = require("../node-classifier");
const { logger } = require("../../../lib/logger");

const log = logger.child({ component: "v17-dismiss-driver" });

/**
 * Class-name fragments that signal a modal / overlay container. Matched
 * against the raw XML for speed — parsing every node to check class would
 * cost more than the substring scan.
 */
const MODAL_CLASS_HINTS_REGEX = /class="[^"]*(?:BottomSheet|PopupWindow|Dialog|ModalLayer|Overlay|Popup)/;

/** Content-desc values that mean "this is a close/dismiss affordance." */
const CLOSE_DESC_REGEX = /content-desc="[^"]*(?:close|dismiss|×|✕|✖)/i;

/** resource-id fragments for dismiss affordances (developer-chosen, typically English). */
const CLOSE_ID_REGEX = /resource-id="[^"]*(?:close|dismiss|skip_button|not_now|maybe_later)/i;

/**
 * Plain-text dismiss labels that appear on ordinary `android.widget.Button`
 * or Compose `NavigationBarItem`-style clickables WITHOUT any of the
 * structural modal-class / close-icon signals above.
 *
 * Production bug (run b004fbdf, 2026-04-24 09:54): biztoso's first in-app
 * surface is a notification dialog with a "Remind me later" button. The
 * three structural gates above all missed it — no modal class in the XML
 * tree, no close-glyph content-desc, no matching resource-id — so
 * DismissDriver never claimed, the screen fell through to LLMFallback,
 * and the crawl conceded after the next step when the post-dismiss auth
 * screen triggered the press_back guardrail. This regex captures the
 * plain-text CTA variants we observe in the wild.
 *
 * Scope is deliberately narrow to dismiss-a-notification phrases only.
 * "Cancel" and "Close" are NOT matched here because they commonly
 * appear on legitimate auth screens (OTP "Cancel", profile-edit "Close")
 * where the user's creds-provided intent is to log in, not to back out.
 * Leave those to the structural CLOSE_DESC_REGEX / CLOSE_ID_REGEX checks
 * above — those require an actual close-glyph or dismiss-named rid,
 * which is a stronger signal than free-form label text.
 *
 * decide() still gates on the classifier's dismiss_button role, so a
 * false claim here costs one classifier call, never a wrong tap.
 */
const DISMISS_LABEL_REGEX =
  /(?:text|content-desc)="(?:[^"]*\s)?(?:remind\s+me\s+later|maybe\s+later|not\s+now|not\s+right\s+now|skip\s+for\s+now|no\s+thanks|no,?\s*thanks|dismiss)(?:\s[^"]*)?"/i;

/**
 * @typedef {import('./clickable-graph').Clickable} Clickable
 * @typedef {import('../node-classifier').ClassifiedClickable} ClassifiedClickable
 *
 * @typedef {Object} DismissDriverDeps
 * @property {any} [anthropic]
 * @property {Map<string, any>} [classifierCache]
 * @property {number} [timeoutMs]
 * @property {typeof nodeClassifier.classify} [classify] - injectable for tests
 */

/**
 * Cheap structural claim: only continue if the XML smells like a modal with a
 * dismiss element. Avoids firing the classifier on every full-screen page.
 *
 * @param {{xml?:string|null}} observation
 * @returns {boolean}
 */
function claim(observation) {
  if (!observation || typeof observation !== "object") return false;
  const xml = typeof observation.xml === "string" ? observation.xml : "";
  if (!xml) return false;
  if (MODAL_CLASS_HINTS_REGEX.test(xml)) return true;
  if (CLOSE_DESC_REGEX.test(xml)) return true;
  if (CLOSE_ID_REGEX.test(xml)) return true;
  // Plain-text label fallback — catches "Remind me later" / "Maybe later"
  // style CTAs on non-modal dialogs that ship without close-glyphs or
  // matching resource-ids. See DISMISS_LABEL_REGEX comment block above.
  if (DISMISS_LABEL_REGEX.test(xml)) return true;
  return false;
}

/**
 * Run the classifier, find the dismiss_button with the lowest y (top-right /
 * top-of-modal is the conventional close position), and emit a tap.
 *
 * Returns null if:
 *   - classifier timed out / errored (falls to next driver, NOT to tap-
 *     anything-that-looks-modal — safer)
 *   - no node was classified as dismiss_button
 *
 * @param {{xml?:string|null, packageName?:string, activity?:string}} observation
 * @param {Object} _state
 * @param {DismissDriverDeps} [deps]
 * @returns {Promise<{type:'tap', x:number, y:number, targetText?:string}|null>}
 */
async function decide(observation, _state, deps = {}) {
  if (!observation || typeof observation !== "object") return null;
  const graph = parseClickableGraph(observation.xml);
  if (graph.clickables.length === 0) return null;

  const classifyFn = deps.classify || nodeClassifier.classify;
  const classified = await classifyFn(graph, observation, {
    anthropic: deps.anthropic,
    cache: deps.classifierCache,
    timeoutMs: deps.timeoutMs,
  });
  if (!classified) return null;

  const dismissNodes = classified.filter((c) => c.role === "dismiss_button");
  if (dismissNodes.length === 0) return null;

  // Modal close icons sit at the top (lowest cy). If the classifier tagged
  // several (e.g. top-right "✕" + in-modal "Not Now" footer), prefer the
  // explicit corner-close over the text button.
  const target = dismissNodes.reduce((a, b) => (a.cy < b.cy ? a : b));

  log.info(
    {
      count: dismissNodes.length,
      label: target.label || "",
      cx: target.cx,
      cy: target.cy,
    },
    "DismissDriver: tapping dismiss_button",
  );

  const action = { type: "tap", x: target.cx, y: target.cy };
  if (target.label) action.targetText = target.label;
  return action;
}

module.exports = {
  name: "DismissDriver",
  claim,
  decide,
  // exported for direct testing
  MODAL_CLASS_HINTS_REGEX,
  CLOSE_DESC_REGEX,
  CLOSE_ID_REGEX,
  DISMISS_LABEL_REGEX,
};
