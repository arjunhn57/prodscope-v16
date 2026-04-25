"use strict";

/**
 * v17/node-classifier.js
 *
 * Haiku-powered language-agnostic role classifier. Takes a ClickableGraph +
 * observation and returns the clickables with a `.role` field populated.
 * Language-independent by design — "ログイン", "Anmelden", "Iniciar sesión"
 * all resolve to `submit_button` on an email form.
 *
 * Pipeline:
 *   1. Compute structural fingerprint (ignores all dynamic text).
 *   2. Cache hit → merge cached roles and return.
 *   3. Deterministic short-circuit for Android-standard metadata (password
 *      attr, email resource-id, dismiss content-desc) — zero LLM cost.
 *   4. Haiku call with 3s AbortController timeout for remaining nodes.
 *   5. Confidence + structural cross-check filter → suspect roles downgraded
 *      to 'unknown'.
 *   6. Persist to cache, return merged clickables.
 *   7. On timeout/error → return null (dispatcher falls to LLMFallback).
 */

const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const { logger } = require("../../lib/logger");

const log = logger.child({ component: "v17-classifier" });

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const HAIKU_TIMEOUT_MS = 3000;
const HAIKU_MAX_TOKENS = 400;
const BOUNDS_BUCKET = 32;
const CONFIDENCE_THRESHOLD = 0.7;
/** If more than this many nodes fail the cross-check, discard the whole classification. */
const CROSS_CHECK_FAIL_LIMIT = 3;

/** Valid role values the driver understands. 'unknown' triggers LLMFallback. */
const VALID_ROLES = [
  "email_input",
  "password_input",
  "otp_input",
  "submit_button",
  "auth_option_email",
  "auth_option_google",
  "auth_option_apple",
  "auth_option_other",
  "dismiss_button",
  "nav_tab",
  "content",
  "unknown",
];
const VALID_ROLES_SET = new Set(VALID_ROLES);

/** Anthropic tool schema — forces structured output from the classifier. */
const CLASSIFY_TOOL = {
  name: "classify_nodes",
  description:
    "Assign a role to each UI node based on its visible label, class, resource-id, and position. " +
    "This is a language-agnostic classification: labels may be in any language — classify by MEANING, not by matching English strings.",
  input_schema: {
    type: "object",
    properties: {
      assignments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            nodeIndex: { type: "number" },
            role: { type: "string", enum: VALID_ROLES },
            confidence: { type: "number", description: "0.0-1.0 confidence score." },
          },
          required: ["nodeIndex", "role", "confidence"],
        },
      },
    },
    required: ["assignments"],
  },
};

const SYSTEM_PROMPT = `You are a UI element classifier for a mobile app crawler.

You receive a JSON list of interactable UI nodes (buttons, inputs, labels). For each node, assign exactly one role from the provided enum.

Rules:
1. Labels may be in ANY language (English, Japanese, Spanish, Chinese, Korean, etc.). Classify by MEANING, not by matching English strings. "ログイン" / "Sign in" / "Iniciar sesión" / "登录" all = 'submit_button' on a login form.
2. email_input / password_input / otp_input: form input fields (EditText, TextField).
3. submit_button: primary form action on an auth screen — "Sign in", "Continue", "Next", "Log in".
4. auth_option_email / auth_option_google / auth_option_apple / auth_option_other: provider selector buttons ("Continue with Email", "Sign in with Google").
5. dismiss_button: "Not now", "Skip", "Later", "✕", "×", "Close".
6. nav_tab: bottom-nav / top-tabs items — "Home", "Search", "Profile", "Settings".
7. content: non-interactive labels, or interactive elements that don't fit the above.
8. unknown: when genuinely unsure.

Output a confidence score 0.0-1.0 for each assignment. If confidence < 0.7, prefer 'unknown' over guessing.`;

/**
 * @typedef {import('./drivers/clickable-graph').Clickable} Clickable
 * @typedef {import('./drivers/clickable-graph').ClickableGraph} ClickableGraph
 *
 * @typedef {Object} RoleAssignment
 * @property {string} role          - One of VALID_ROLES
 * @property {number} confidence    - 0.0-1.0
 *
 * @typedef {Clickable & { role: string, confidence: number }} ClassifiedClickable
 *
 * @typedef {Object} ClassifierDeps
 * @property {any} [anthropic]         - Anthropic client; defaults to a singleton
 * @property {Map<string, Map<number, RoleAssignment>>} [cache] - fingerprint -> nodeIndex -> role
 * @property {number} [timeoutMs]      - override HAIKU_TIMEOUT_MS (tests only)
 *
 * @typedef {Object} ObservationLike
 * @property {string} [packageName]
 * @property {string} [activity]
 */

let _defaultClient = null;
function getDefaultClient() {
  if (!_defaultClient) {
    _defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _defaultClient;
}

/**
 * Create a fresh cache. Callers are expected to own one cache per run and pass
 * it via deps.cache.
 *
 * @returns {Map<string, Map<number, RoleAssignment>>}
 */
function createCache() {
  return new Map();
}

/**
 * Compute a structural fingerprint that ignores dynamic text. Screens that
 * differ only by user name, date, count, or locale MUST hash identically so
 * the cache doesn't fragment.
 *
 * Includes: package, activity, sorted resource-ids, sorted class names,
 * bucketed (cx, cy) positions, input count, clickable count.
 * Excludes: text, contentDesc, pixel-exact bounds.
 *
 * @param {ClickableGraph} graph
 * @param {string} packageName
 * @param {string} activity
 * @returns {string} 12-char sha256 prefix
 */
function computeStructuralFingerprint(graph, packageName, activity) {
  const clickables = (graph && graph.clickables) || [];
  const resourceIds = clickables.map((c) => c.resourceId || "").sort();
  const classNames = clickables.map((c) => c.className || "").sort();
  const buckets = clickables
    .map((c) => `${Math.floor((c.cx || 0) / BOUNDS_BUCKET)}:${Math.floor((c.cy || 0) / BOUNDS_BUCKET)}`)
    .sort();
  const inputCount = (graph && graph.groups && graph.groups.inputs && graph.groups.inputs.length) || 0;
  const clickableCount = clickables.length;

  const material = JSON.stringify({
    pkg: packageName || "",
    act: activity || "",
    resourceIds,
    classNames,
    buckets,
    inputCount,
    clickableCount,
  });

  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 12);
}

/**
 * Phase 4 (2026-04-25): position- and content-insensitive LOGICAL
 * fingerprint. The same logical screen (e.g. Home feed) produces the
 * same logical fp regardless of scroll offset, dynamic list items, or
 * rendered text variance.
 *
 * Used by v18/trajectory-memory for the "have I seen this screen?"
 * coverage tracking. Distinct from `computeStructuralFingerprint`:
 *   - Structural fp includes bucketed (x,y) positions → needed for
 *     per-fp edge tracking (don't re-tap the same Reply button after
 *     the feed re-renders) but inflates the "unique screens" count
 *     because Home@scroll-0 and Home@scroll-500 produce different fps
 *     despite being the same logical screen.
 *   - Logical fp excludes positions and item counts → same logical
 *     screen produces same fp across scroll / content variance.
 *
 * Keyed on:
 *   - packageName
 *   - activity
 *   - DISTINCT resource-ids (sorted, deduped)
 *   - DISTINCT className prefixes (first two dotted segments —
 *     `com.biztoso.FeedCard` and `com.biztoso.FeedItemView` collapse
 *     into `com.biztoso`; `androidx.compose.*` groups together)
 *   - input-count bucket ("0" / "1" / "2+") so a form's identity
 *     depends on having-inputs, not exact input count.
 *
 * @param {ClickableGraph} graph
 * @param {string} [packageName]
 * @param {string} [activity]
 * @returns {string} 12-char sha256 prefix
 */
function computeLogicalFingerprint(graph, packageName, activity) {
  const clickables = (graph && graph.clickables) || [];
  // 2026-04-25 v5 (Bug #7): canonicalize resource-ids before deduping so
  // dynamic numeric / hash suffixes don't drift the fingerprint between
  // visits. Without this, a feed-item rid like `feed_item_42` differs from
  // `feed_item_99` and the home feed produces a different logical fp every
  // time content rotates — defeating Fix B's frontier dedup.
  const resourceIds = Array.from(
    new Set(
      clickables
        .map((c) => canonicalizeResourceId(c.resourceId || ""))
        .filter(Boolean),
    ),
  ).sort();
  const classPrefixes = Array.from(
    new Set(
      clickables
        .map((c) => c.className || "")
        .filter(Boolean)
        .map((cls) => {
          // Strip anonymous-class suffixes (`$1`, `$inner`) and trailing
          // numeric suffixes that Compose / RecyclerView emit.
          const stripped = cls
            .replace(/\$[A-Za-z0-9_]+$/, "")
            .replace(/_\d+$/, "");
          const parts = stripped.split(".");
          return parts.slice(0, Math.min(2, parts.length)).join(".");
        }),
    ),
  ).sort();
  const inputCount = (graph && graph.groups && graph.groups.inputs && graph.groups.inputs.length) || 0;
  const inputBucket = inputCount === 0 ? "0" : inputCount === 1 ? "1" : "2+";

  const material = JSON.stringify({
    pkg: packageName || "",
    act: activity || "",
    resourceIds,
    classPrefixes,
    inputBucket,
  });

  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 12);
}

/**
 * Strip dynamic suffixes from a resource-id so the same logical element
 * produces the same canonical id across visits. Conservative — only
 * strips suffix shapes that are demonstrably dynamic content markers, not
 * the rid's semantic part. Examples:
 *
 *   com.app:id/feed_item_42        → com.app:id/feed_item
 *   com.app:id/post_card_8a3f2b    → com.app:id/post_card
 *   com.app:id/row:5               → com.app:id/row
 *   com.app:id/email_input         → com.app:id/email_input  (unchanged)
 *
 * Applies multiple passes — `feed_item_8a3f2b_42` collapses both. Bare
 * `:id/` prefix is preserved because it's the Android convention.
 *
 * @param {string} rid
 * @returns {string}
 */
function canonicalizeResourceId(rid) {
  if (typeof rid !== "string" || !rid) return "";
  let out = rid;
  // Loop a couple of times so chained suffixes (e.g. `_8a3f_42`) collapse.
  for (let i = 0; i < 3; i++) {
    const prev = out;
    // Trailing _<digits>
    out = out.replace(/_\d+$/, "");
    // Trailing _<hex 6+ chars> — uuid fragments, hashes
    out = out.replace(/_[a-f0-9]{6,}$/i, "");
    // Trailing :<digits> — RecyclerView position-style suffix
    out = out.replace(/:\d+$/, "");
    if (out === prev) break;
  }
  return out;
}

/**
 * Deterministic role short-circuit based on Android-standard metadata.
 * Resolves password fields (password attr), email fields (resource-id regex
 * via the parser), and dismiss buttons (content-desc/resource-id) without any
 * LLM call.
 *
 * @param {Array<Clickable>} clickables
 * @returns {Map<number, RoleAssignment>}
 */
function applyInputTypeShortCircuit(clickables) {
  const resolved = new Map();
  for (let i = 0; i < clickables.length; i++) {
    const c = clickables[i];
    if (c.isPassword) {
      resolved.set(i, { role: "password_input", confidence: 1.0 });
      continue;
    }
    if (c.isEmail) {
      resolved.set(i, { role: "email_input", confidence: 1.0 });
      continue;
    }
    const desc = c.contentDesc || "";
    const rid = c.resourceId || "";
    if (/close|dismiss|✕|×/i.test(desc) || /close|dismiss/i.test(rid)) {
      resolved.set(i, { role: "dismiss_button", confidence: 0.9 });
    }
  }
  return resolved;
}

/**
 * Extract the tool_use block's input from an Anthropic message.
 * @param {object} message
 * @returns {object|null}
 */
function extractToolInput(message) {
  if (!message || !Array.isArray(message.content)) return null;
  for (const block of message.content) {
    if (block && block.type === "tool_use" && block.name === CLASSIFY_TOOL.name) {
      return block.input || null;
    }
  }
  return null;
}

/**
 * Call Haiku with a hard AbortController timeout. Returns the parsed
 * `assignments` array on success, null on timeout/error/malformed response.
 *
 * @param {Array<Clickable>} unresolvedNodes
 * @param {Array<number>} unresolvedIndices — their positions in the original graph.clickables
 * @param {{anthropic: any, timeoutMs?: number}} deps
 * @returns {Promise<Array<{nodeIndex:number, role:string, confidence:number}>|null>}
 */
async function callHaiku(unresolvedNodes, unresolvedIndices, deps) {
  if (unresolvedNodes.length === 0) return [];
  const timeoutMs = typeof deps.timeoutMs === "number" ? deps.timeoutMs : HAIKU_TIMEOUT_MS;

  const nodesForPrompt = unresolvedNodes.map((c, i) => ({
    index: unresolvedIndices[i],
    label: c.label || "",
    resourceId: c.resourceId || "",
    className: c.className || "",
    bounds: { x1: c.bounds.x1, y1: c.bounds.y1, x2: c.bounds.x2, y2: c.bounds.y2 },
    isInput: !!c.isInput,
    isButton: !!c.isButton,
    isCheckbox: !!c.isCheckbox,
  }));

  const userText = JSON.stringify({ nodes: nodesForPrompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await deps.anthropic.messages.create(
      {
        model: HAIKU_MODEL,
        max_tokens: HAIKU_MAX_TOKENS,
        temperature: 0,
        system: SYSTEM_PROMPT,
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: "tool", name: CLASSIFY_TOOL.name },
        messages: [{ role: "user", content: userText }],
      },
      { signal: controller.signal },
    );
    const durationMs = Date.now() - startedAt;
    const toolInput = extractToolInput(response);
    if (!toolInput || !Array.isArray(toolInput.assignments)) {
      log.warn(
        { stopReason: response && response.stop_reason, durationMs },
        "classifier: no tool_use block",
      );
      return null;
    }
    log.info(
      {
        durationMs,
        nodes: unresolvedNodes.length,
        assignments: toolInput.assignments.length,
        timeoutMs,
      },
      "classifier: haiku call ok",
    );
    return toolInput.assignments;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const msg = (err && err.message) || "";
    if ((err && err.name === "AbortError") || /aborted|abort/i.test(msg)) {
      log.warn({ durationMs, timeoutMs }, "classifier: timeout");
    } else {
      log.warn({ err: msg, durationMs }, "classifier: haiku call failed");
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Return true if the role is plausible given the node's structural flags.
 * email/password/otp must be on an input; buttons/tabs/dismiss must not.
 *
 * @param {Clickable} node
 * @param {string} role
 * @returns {boolean}
 */
function roleCrossCheck(node, role) {
  switch (role) {
    case "email_input":
    case "password_input":
    case "otp_input":
      return !!node.isInput;
    case "submit_button":
    case "auth_option_email":
    case "auth_option_google":
    case "auth_option_apple":
    case "auth_option_other":
    case "dismiss_button":
    case "nav_tab":
      return !node.isInput;
    default:
      return true;
  }
}

/**
 * Merge a roleMap into a clickables array, producing ClassifiedClickable[].
 *
 * @param {Array<Clickable>} clickables
 * @param {Map<number, RoleAssignment>} roleMap
 * @returns {Array<ClassifiedClickable>}
 */
function mergeRoles(clickables, roleMap) {
  return clickables.map((c, i) => {
    const assignment = roleMap.get(i) || { role: "unknown", confidence: 0 };
    return Object.assign({}, c, { role: assignment.role, confidence: assignment.confidence });
  });
}

/**
 * Classify every clickable in the graph with a role.
 *
 * @param {ClickableGraph} graph
 * @param {ObservationLike} observation
 * @param {ClassifierDeps} [deps]
 * @returns {Promise<Array<ClassifiedClickable>|null>}
 */
async function classify(graph, observation, deps = {}) {
  if (!graph || !Array.isArray(graph.clickables)) return null;
  if (graph.clickables.length === 0) return [];

  const cache = deps.cache;
  const anthropic = deps.anthropic || getDefaultClient();

  const fp = computeStructuralFingerprint(
    graph,
    observation && observation.packageName,
    observation && observation.activity,
  );

  if (cache && cache.has(fp)) {
    const roleMap = cache.get(fp);
    log.info(
      { fingerprint: fp, source: "cache", roles: roleMap.size },
      "classifier: cache hit",
    );
    return mergeRoles(graph.clickables, roleMap);
  }

  const shortCircuited = applyInputTypeShortCircuit(graph.clickables);
  const unresolvedIndices = [];
  const unresolvedNodes = [];
  for (let i = 0; i < graph.clickables.length; i++) {
    if (!shortCircuited.has(i)) {
      unresolvedIndices.push(i);
      unresolvedNodes.push(graph.clickables[i]);
    }
  }

  const roleMap = new Map(shortCircuited);
  let crossCheckFailures = 0;

  if (unresolvedNodes.length > 0) {
    const assignments = await callHaiku(unresolvedNodes, unresolvedIndices, {
      anthropic,
      timeoutMs: deps.timeoutMs,
    });
    if (assignments === null) return null;

    for (const a of assignments) {
      if (typeof a.nodeIndex !== "number") continue;
      if (a.nodeIndex < 0 || a.nodeIndex >= graph.clickables.length) continue;
      if (!VALID_ROLES_SET.has(a.role)) {
        roleMap.set(a.nodeIndex, { role: "unknown", confidence: 0 });
        continue;
      }
      const confidence = typeof a.confidence === "number" ? a.confidence : 0;
      let role = a.role;
      const node = graph.clickables[a.nodeIndex];
      if (confidence < CONFIDENCE_THRESHOLD || !roleCrossCheck(node, role)) {
        if (role !== "unknown") crossCheckFailures += 1;
        role = "unknown";
      }
      roleMap.set(a.nodeIndex, { role, confidence });
    }
    // Nodes Haiku didn't assign → unknown.
    for (const idx of unresolvedIndices) {
      if (!roleMap.has(idx)) roleMap.set(idx, { role: "unknown", confidence: 0 });
    }

    if (crossCheckFailures > CROSS_CHECK_FAIL_LIMIT) {
      log.warn(
        { fingerprint: fp, crossCheckFailures },
        "classifier: too many cross-check failures, discarding classification",
      );
      return null;
    }
  }

  if (cache) cache.set(fp, roleMap);
  log.info(
    {
      fingerprint: fp,
      source: "fresh",
      roles: roleMap.size,
      shortCircuited: shortCircuited.size,
    },
    "classifier: fresh classification",
  );
  return mergeRoles(graph.clickables, roleMap);
}

module.exports = {
  classify,
  computeStructuralFingerprint,
  computeLogicalFingerprint,
  canonicalizeResourceId,
  applyInputTypeShortCircuit,
  createCache,
  mergeRoles,
  roleCrossCheck,
  CLASSIFY_TOOL,
  HAIKU_MODEL,
  HAIKU_TIMEOUT_MS,
  CONFIDENCE_THRESHOLD,
  CROSS_CHECK_FAIL_LIMIT,
  VALID_ROLES,
  VALID_ROLES_SET,
};
