"use strict";

/**
 * v16/auth-escape.js — Find skip/guest/close buttons on auth walls.
 *
 * Ported from v15's auth-state-machine.js + system-handlers.js, stripped of
 * v15 state machine deps. The v16 flow is different: we don't drive tap
 * decisions directly — we inject a hint into the agent prompt so the model
 * knows an escape route is visible.
 *
 * Strategy (synchronous tiers — vision tier is async and lives at caller):
 *   1. XML text / content-desc match against AUTH_ESCAPE_LABELS (pixel-perfect).
 *   2. Perception cache match against the same labels (for Compose / Canvas
 *      apps where clickable text doesn't appear in the accessibility tree).
 *
 * Labels are ordered most-specific first so "continue as guest" wins over
 * a nearby generic "skip".
 */

// ── Auth escape / skip button labels (most specific first) ──────────────
const AUTH_ESCAPE_LABELS = [
  // Most specific first — phrases are less likely to false-match
  "continue as guest",
  "browse as guest",
  "browse without login",
  "browse without signing in",
  "continue without account",
  "skip for now",
  "skip login",
  "skip sign in",
  "just browsing",
  "guest mode",
  "explore as guest",
  // Generic dismissals
  "skip",
  "not now",
  "maybe later",
  "no thanks",
  "no, thanks",
  "later",
  "remind me later",
  "not interested",
  // Additional short patterns (lowest specificity)
  "browse",
  "explore",
  "as guest",
  "without login",
  "without signing in",
  "without account",
];

// Regex for quick pre-check; anchored `browse$` prevents matching "browser"
const AUTH_ESCAPE_REGEX = /skip|not now|maybe later|continue as guest|browse without|skip for now|no thanks|later|continue without|guest mode|just browsing|not interested|explore|as guest|browse$/i;

// ── Bounds parsing ──────────────────────────────────────────────────────

/**
 * Parse UIAutomator bounds string "[x1,y1][x2,y2]" → center + rect.
 * @param {string} boundsStr
 * @returns {{x1:number,y1:number,x2:number,y2:number,cx:number,cy:number}|null}
 */
function parseBounds(boundsStr) {
  if (typeof boundsStr !== "string") return null;
  const m = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  const x1 = parseInt(m[1], 10);
  const y1 = parseInt(m[2], 10);
  const x2 = parseInt(m[3], 10);
  const y2 = parseInt(m[4], 10);
  // Reject degenerate zero-size bounds — they aren't tappable
  if (x1 === x2 && y1 === y2) return null;
  return { x1, y1, x2, y2, cx: Math.floor((x1 + x2) / 2), cy: Math.floor((y1 + y2) / 2) };
}

// ── XML button extraction ──────────────────────────────────────────────

/**
 * Extract clickable nodes with a human-readable label from a UIAutomator XML dump.
 * Mirrors the v15 extractButtons logic so we get the same match behavior.
 * @param {string} xml
 * @returns {Array<{label:string,labelLower:string,bounds:{cx:number,cy:number,x1:number,y1:number,x2:number,y2:number}}>}
 */
function extractClickableLabels(xml) {
  /** @type {Array<{label:string,labelLower:string,bounds:{cx:number,cy:number,x1:number,y1:number,x2:number,y2:number}}>} */
  const out = [];
  if (!xml || typeof xml !== "string") return out;

  const nodeRegex = /<node\s+([^>]+?)\/?>/g;
  const getAttr = (attrs, name) => {
    const re = new RegExp(name + '="([^"]*)"');
    const m = attrs.match(re);
    return m ? m[1] : "";
  };

  for (const match of xml.matchAll(nodeRegex)) {
    const attrs = match[1];
    if (getAttr(attrs, "clickable") !== "true") continue;
    const text = getAttr(attrs, "text").trim();
    const desc = getAttr(attrs, "content-desc").trim();
    const label = text || desc;
    if (!label) continue;
    const bounds = parseBounds(getAttr(attrs, "bounds"));
    if (!bounds) continue;
    out.push({ label, labelLower: label.toLowerCase(), bounds });
  }
  return out;
}

// ── Perception-cache button extraction ──────────────────────────────────

/**
 * Normalize perception-cache buttons into the same shape as extractClickableLabels.
 * Accepts `bounds: {x1,y1,x2,y2}` or `{cx,cy}` shapes.
 */
function extractPerceptionLabels(perceptionCache) {
  /** @type {Array<{label:string,labelLower:string,bounds:{cx:number,cy:number}}>} */
  const out = [];
  if (!perceptionCache || !Array.isArray(perceptionCache.buttons)) return out;
  for (const btn of perceptionCache.buttons) {
    if (!btn || typeof btn.label !== "string") continue;
    const label = btn.label.trim();
    if (!label) continue;
    let cx;
    let cy;
    if (btn.bounds && typeof btn.bounds.cx === "number" && typeof btn.bounds.cy === "number") {
      cx = btn.bounds.cx;
      cy = btn.bounds.cy;
    } else if (
      btn.bounds &&
      typeof btn.bounds.x1 === "number" &&
      typeof btn.bounds.y1 === "number" &&
      typeof btn.bounds.x2 === "number" &&
      typeof btn.bounds.y2 === "number"
    ) {
      cx = Math.floor((btn.bounds.x1 + btn.bounds.x2) / 2);
      cy = Math.floor((btn.bounds.y1 + btn.bounds.y2) / 2);
    } else {
      continue;
    }
    out.push({ label, labelLower: label.toLowerCase(), bounds: { cx, cy } });
  }
  return out;
}

// ── Label matcher ──────────────────────────────────────────────────────

/**
 * Find the first button whose label matches AUTH_ESCAPE_LABELS, in order of
 * specificity. Returns the matched entry or null.
 * @template {{labelLower:string}} T
 * @param {Array<T>} candidates
 * @returns {T|null}
 */
function pickBestMatch(candidates) {
  if (candidates.length === 0) return null;
  for (const pattern of AUTH_ESCAPE_LABELS) {
    const hit = candidates.find((c) => c.labelLower === pattern || c.labelLower.includes(pattern));
    if (hit) return hit;
  }
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} AuthEscape
 * @property {string} label
 * @property {'xml'|'perception'} source
 * @property {number} x
 * @property {number} y
 */

/**
 * Find a visible skip/guest/close button. Returns null if none present.
 * Caller decides what to do — typically inject an observation hint into the
 * agent prompt so the model can choose to tap it.
 *
 * @param {{xml?:string|null, perceptionCache?:{buttons?:Array<any>}|null}|null} observation
 * @returns {AuthEscape|null}
 */
function findAuthEscapeButton(observation) {
  if (!observation || typeof observation !== "object") return null;

  // Tier 1: XML (pixel-perfect, always preferred when present)
  const xmlCandidates = extractClickableLabels(observation.xml);
  const xmlHit = pickBestMatch(xmlCandidates);
  if (xmlHit) {
    return {
      label: xmlHit.label,
      source: "xml",
      x: xmlHit.bounds.cx,
      y: xmlHit.bounds.cy,
    };
  }

  // Tier 2: perception cache (Compose / Canvas apps)
  const percCandidates = extractPerceptionLabels(observation.perceptionCache);
  const percHit = pickBestMatch(percCandidates);
  if (percHit) {
    return {
      label: percHit.label,
      source: "perception",
      x: percHit.bounds.cx,
      y: percHit.bounds.cy,
    };
  }

  return null;
}

module.exports = {
  findAuthEscapeButton,
  AUTH_ESCAPE_LABELS,
  AUTH_ESCAPE_REGEX,
  extractClickableLabels,
  parseBounds,
};
