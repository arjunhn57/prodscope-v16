"use strict";

/**
 * v17/drivers/clickable-graph.js
 *
 * Structural XML parser for the v17 driver-first agent loop. Builds a rich
 * clickable graph with language-agnostic field detection via Android-standard
 * metadata (class names, password attr, resource-ids).
 *
 * Language principle: free-text labels are NOT regex-matched here. Any
 * semantic decision about what a label *means* (submit / auth_option / dismiss)
 * is delegated to node-classifier (A.1.5), which calls Haiku and handles any
 * language. Structural flags set here come from Android-standard metadata that
 * is language-independent by design:
 *   - class names (e.g. "android.widget.EditText")
 *   - password="true" attribute
 *   - resource-id (developer-set identifiers, typically English even in
 *     localised apps, so regexing them is a safe language-agnostic heuristic)
 *
 * Reuses parseBounds from crawler/v16/auth-escape.js.
 */

const { parseBounds } = require("../../v16/auth-escape");

/**
 * @typedef {Object} ClickableBounds
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 * @property {number} cx
 * @property {number} cy
 */

/**
 * @typedef {Object} Clickable
 * @property {string} text          - `<node text="...">` raw
 * @property {string} contentDesc   - `<node content-desc="...">`
 * @property {string} resourceId    - `<node resource-id="...">`
 * @property {string} className     - `<node class="...">`
 * @property {string} packageName   - `<node package="...">`
 * @property {string} hint          - `<node hint="...">` (API 26+, may be "")
 * @property {ClickableBounds} bounds
 * @property {number} cx
 * @property {number} cy
 * @property {boolean} clickable    - raw `clickable="true"` attribute
 * @property {boolean} isInput      - EditText-like class
 * @property {boolean} isPassword   - password attr OR resource-id matches
 * @property {boolean} isEmail      - EditText + resource-id hints email + not password
 * @property {boolean} isButton     - Button class OR clickable without input role
 * @property {boolean} isCheckbox   - CheckBox class
 * @property {string} label         - Resolved: own text/desc → smallest child text/desc
 * @property {'self'|'child'|'none'} labelSource
 */

/**
 * @typedef {Object} ClickableGraph
 * @property {Array<Clickable>} clickables
 * @property {{
 *   inputs: Array<Clickable>,
 *   emailInputs: Array<Clickable>,
 *   passwordInputs: Array<Clickable>
 * }} groups
 */

/** resource-id substrings that strongly indicate a password field. */
const PASSWORD_ID_REGEX = /(^|[^a-z])pass(word|wd)?($|[^a-z])/i;

/** resource-id substrings that strongly indicate an email field. */
const EMAIL_ID_REGEX = /(^|[^a-z])(e[-_]?mail|emailid|mail[-_]?id|emailaddress)($|[^a-z])/i;

/**
 * Parse a UIAutomator XML dump into a structured graph of interactable nodes.
 *
 * Never throws. Returns an empty graph if xml is null/empty/unparseable.
 *
 * @param {string|null|undefined} xml
 * @returns {ClickableGraph}
 */
function parseClickableGraph(xml) {
  const empty = {
    clickables: [],
    groups: { inputs: [], emailInputs: [], passwordInputs: [] },
  };
  if (!xml || typeof xml !== "string") return empty;

  const all = extractAllNodes(xml);
  const clickables = buildClickables(all);
  const groups = {
    inputs: clickables.filter((c) => c.isInput),
    emailInputs: clickables.filter((c) => c.isEmail),
    passwordInputs: clickables.filter((c) => c.isPassword),
  };
  return { clickables, groups };
}

/**
 * Pass 1 — collect every `<node>` with parseable bounds. Clickable flag and
 * class are recorded but not used to filter yet; pass 2 does filtering.
 *
 * @param {string} xml
 * @returns {Array<RawNode>}
 */
function extractAllNodes(xml) {
  /**
   * @typedef {Object} RawNode
   * @property {string} text
   * @property {string} contentDesc
   * @property {string} resourceId
   * @property {string} className
   * @property {string} packageName
   * @property {string} hint
   * @property {boolean} clickable
   * @property {boolean} passwordAttr
   * @property {ClickableBounds} bounds
   * @property {number} area
   */
  /** @type {Array<RawNode>} */
  const all = [];
  // Matches both self-closing `<node ... />` and opening `<node ...>` forms.
  const NODE_RE = /<node\s+([^>]+?)\/?>/g;
  for (const m of xml.matchAll(NODE_RE)) {
    const attrs = m[1];
    const bounds = parseBounds(getAttr(attrs, "bounds"));
    if (!bounds) continue;
    const area = (bounds.x2 - bounds.x1) * (bounds.y2 - bounds.y1);
    all.push({
      text: getAttr(attrs, "text"),
      contentDesc: getAttr(attrs, "content-desc"),
      resourceId: getAttr(attrs, "resource-id"),
      className: getAttr(attrs, "class"),
      packageName: getAttr(attrs, "package"),
      hint: getAttr(attrs, "hint"),
      clickable: getAttr(attrs, "clickable") === "true",
      passwordAttr: getAttr(attrs, "password") === "true",
      bounds,
      area,
    });
  }
  return all;
}

/**
 * Pass 2 — emit one Clickable per interactable node. An "interactable" node is
 * clickable=true OR an EditText-like input (inputs aren't always marked
 * clickable but they ARE tappable to focus). Labels inherit from the smallest
 * non-interactable descendant whose bounds lie strictly inside, handling the
 * Compose parent-clickable + child-TextView pattern.
 *
 * @param {Array<RawNode>} all
 * @returns {Array<Clickable>}
 */
function buildClickables(all) {
  /** @type {Array<Clickable>} */
  const out = [];

  const isContained = (inner, outer) =>
    inner.bounds.x1 >= outer.bounds.x1 &&
    inner.bounds.y1 >= outer.bounds.y1 &&
    inner.bounds.x2 <= outer.bounds.x2 &&
    inner.bounds.y2 <= outer.bounds.y2 &&
    inner.area < outer.area;

  for (const node of all) {
    const isEditText = isEditTextClass(node.className);
    // Skip nodes that are neither clickable nor an input field.
    if (!node.clickable && !isEditText) continue;

    const isPassword = Boolean(
      node.passwordAttr || (node.resourceId && PASSWORD_ID_REGEX.test(node.resourceId)),
    );
    const isEmail =
      !isPassword && isEditText && !!node.resourceId && EMAIL_ID_REGEX.test(node.resourceId);
    const isInput = isEditText || isPassword;
    const isCheckbox = isCheckBoxClass(node.className);
    const isButton = !isInput && !isCheckbox && (isButtonClass(node.className) || node.clickable);

    // Label resolution — own first, else smallest contained child.
    const ownLabel = (node.text || node.contentDesc || "").trim();
    let label = ownLabel;
    /** @type {'self'|'child'|'none'} */
    let labelSource = ownLabel ? "self" : "none";

    if (!label) {
      let smallest = null;
      let smallestArea = Infinity;
      for (const child of all) {
        if (child === node) continue;
        const childLabel = (child.text || child.contentDesc || "").trim();
        if (!childLabel) continue;
        if (!isContained(child, node)) continue;
        if (child.area < smallestArea) {
          smallest = { label: childLabel };
          smallestArea = child.area;
        }
      }
      if (smallest) {
        label = smallest.label;
        labelSource = "child";
      }
    }

    out.push({
      text: node.text,
      contentDesc: node.contentDesc,
      resourceId: node.resourceId,
      className: node.className,
      packageName: node.packageName,
      hint: node.hint,
      bounds: node.bounds,
      cx: node.bounds.cx,
      cy: node.bounds.cy,
      clickable: node.clickable,
      isInput,
      isPassword,
      isEmail,
      isButton,
      isCheckbox,
      label,
      labelSource,
    });
  }

  return out;
}

/**
 * Class-name tests for Android-standard + Compose + React-Native + Flutter
 * input widgets. Language-agnostic by construction.
 *
 * @param {string} cls
 * @returns {boolean}
 */
function isEditTextClass(cls) {
  if (!cls) return false;
  return (
    cls === "android.widget.EditText" ||
    cls === "androidx.compose.foundation.text.BasicTextField" ||
    /\bEditText\b/.test(cls) ||
    /TextField/i.test(cls) ||
    /TextInput/i.test(cls)
  );
}

/**
 * @param {string} cls
 * @returns {boolean}
 */
function isButtonClass(cls) {
  if (!cls) return false;
  return (
    cls === "android.widget.Button" ||
    /\bButton\b/.test(cls) ||
    /\.Button/.test(cls) ||
    /ImageButton$/.test(cls)
  );
}

/**
 * @param {string} cls
 * @returns {boolean}
 */
function isCheckBoxClass(cls) {
  if (!cls) return false;
  return cls === "android.widget.CheckBox" || /\bCheckBox\b/.test(cls);
}

/**
 * Extract a named attribute from a `<node>` tag's attribute string. Attr names
 * are limited to Android-standard identifiers (letters, digits, dash), so
 * escaping in the regex is not required.
 *
 * @param {string} attrs
 * @param {string} name
 * @returns {string}
 */
function getAttr(attrs, name) {
  const re = new RegExp(name + '="([^"]*)"');
  const m = attrs.match(re);
  return m ? m[1] : "";
}

module.exports = {
  parseClickableGraph,
  // exported for direct testing
  isEditTextClass,
  isButtonClass,
  isCheckBoxClass,
  PASSWORD_ID_REGEX,
  EMAIL_ID_REGEX,
};
