"use strict";

/**
 * v18/semantic-classifier.js
 *
 * LLM-first semantic layer. ONE Haiku tool_use call per fp produces BOTH
 * per-node tags (role + intent + priority) AND screen-level planning
 * fields (type, allowed_intents, action_budget, exit_condition).
 *
 * This replaces v17/node-classifier.js for the v18 engine. V17's
 * classifier stays alongside; the engine choice is controlled by the
 * USE_V18_ENGINE feature flag in jobs/runner.js.
 *
 * Design per plan draft 2 (2026-04-24):
 *   - Intent axis orthogonal to role: navigate | read_only | write | destructive.
 *   - Exploration driver consumes intent filter to stop tapping Reply /
 *     Like / Post / Dial / Delete buttons — bugs the V17 ExplorationDriver
 *     couldn't solve structurally.
 *   - Optimistic-on-ambiguity (user's call): ambiguous → "navigate". Max
 *     coverage for a dev tool. `destructive` remains strict — only for
 *     clearly-irreversible actions.
 *   - confidence field drives Sonnet escalation (sonnet-escalation.js).
 *   - Screenshot + XML both sent to Haiku — the screenshot carries layout
 *     / affordance information the XML alone misses (especially on
 *     heavily-Compose apps where className is uninformative).
 *   - Cache by fp (same structural key as v17) so plans amortise across
 *     revisits.
 *
 * Failure modes:
 *   - Haiku timeout / abort → returns null (caller falls back to a
 *     conservative default plan or the v17 classifier path).
 *   - Schema validation failure → returns null.
 *   - Missing screenshot → still proceeds with XML only.
 */

const fs = require("fs");
const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const { logger } = require("../../lib/logger");

const log = logger.child({ component: "v18-semantic-classifier" });

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
// 15s (was 5s 2026-04-24) — first production run d0bbce69 timed out on every
// step at 5000ms because a full 1080×2400 base64 PNG pushes Haiku vision
// latency to ~8-12s on the hot path. Empirical P95 ~10s, so 15s gives
// comfortable headroom while still short-circuiting genuinely broken calls.
const HAIKU_TIMEOUT_MS = 15000;
const HAIKU_MAX_TOKENS = 1200; // larger because plan + per-node fields
const BOUNDS_BUCKET = 32;

/**
 * Skip Haiku entirely on near-empty graphs — WebView covers, cold splashes,
 * and trivial modals with a single close icon. LLMFallback handles those
 * fine and it's wasteful to pay vision-API latency for a 1-element plan.
 */
const MIN_CLICKABLES_FOR_CLASSIFICATION = 3;

/** Confidence below this triggers Sonnet escalation (see sonnet-escalation.js). */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

/** Valid role values shared with v17 for cross-compat. */
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

/** Intent axis — the v18 contribution. */
const VALID_INTENTS = ["navigate", "read_only", "write", "destructive"];
const VALID_INTENTS_SET = new Set(VALID_INTENTS);

/**
 * Screen types where `write` intent is legitimately required for the crawl
 * to make progress. Any other screen type — profile, settings, form,
 * compose, search, etc. — gets `write` stripped from allowed_intents server-
 * side regardless of what Haiku returned. The crawl can navigate around
 * those screens without mutating user data; tapping Save / Submit on a
 * profile-edit form only writes to the user's account and produces zero
 * coverage. This is a structural rule, not a per-app pattern: every app's
 * auth gates the rest of the experience, every app's user-data forms do
 * not (2026-04-25 v4).
 */
const WRITE_INTENT_ALLOWED_SCREEN_TYPES = new Set(["auth", "permission"]);

/** Screen type taxonomy. */
const VALID_SCREEN_TYPES = [
  "feed",
  "compose",
  "form",
  "settings",
  "detail",
  "auth",
  "permission",
  "dialog",
  "profile",
  "search",
  "onboarding",
  "error",
  "other",
];
const VALID_SCREEN_TYPES_SET = new Set(VALID_SCREEN_TYPES);

/**
 * Engine-level actions — LLM-decided, evaluated by the dispatcher BEFORE
 * drivers run. Replaces the historical DRIFT_ALLOWLIST + press_back regex
 * guardrails. The LLM looking at a screenshot knows instantly that it's
 * the Android launcher or Chrome; no package-name list needed.
 *
 * - "proceed": normal dispatch. Drivers run on the classified clickables.
 * - "relaunch": we're on the wrong app (launcher, browser, dialer, ...).
 *   Emit launch_app for the target package, bypass drivers.
 * - "press_back": this screen is a dead-end or we mis-navigated here.
 *   Emit press_back, bypass drivers.
 * - "wait": something is loading (empty tree, spinner, splash). Emit a
 *   short wait.
 */
const VALID_ENGINE_ACTIONS = ["proceed", "relaunch", "press_back", "wait"];
const VALID_ENGINE_ACTIONS_SET = new Set(VALID_ENGINE_ACTIONS);

/**
 * Anthropic tool_use schema. One call → per-node and screen-level fields.
 */
const CLASSIFY_TOOL = {
  name: "classify_screen",
  description:
    "Classify the current mobile app screen AND each interactive node. " +
    "Produces both screen-level planning fields (type, allowed intents, action " +
    "budget, exit condition) and per-node classifications (role, intent, priority). " +
    "This is the single source of truth that drives the dispatcher on this screen. " +
    "Be language-agnostic: classify by MEANING, not by matching English strings.",
  input_schema: {
    type: "object",
    properties: {
      screen_type: { type: "string", enum: VALID_SCREEN_TYPES },
      screen_summary: { type: "string" },
      allowed_intents: {
        type: "array",
        items: { type: "string", enum: VALID_INTENTS },
      },
      action_budget: { type: "integer", minimum: 1, maximum: 20 },
      exit_condition: { type: "string" },
      confidence: { type: "number" },
      // Phase 2: engine-level decision evaluated BEFORE drivers run.
      engine_action: {
        type: "string",
        enum: VALID_ENGINE_ACTIONS,
        description:
          "'proceed' (default) lets drivers run. 'relaunch' when this screen is NOT the target app (launcher, browser, dialer, another app). 'press_back' when this is a dead-end. 'wait' when content is still loading.",
      },
      engine_action_reason: { type: "string" },
      nodes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            nodeIndex: { type: "integer" },
            role: { type: "string", enum: VALID_ROLES },
            intent: { type: "string", enum: VALID_INTENTS },
            priority: { type: "integer", minimum: 0, maximum: 10 },
            note: { type: "string" },
          },
          required: ["nodeIndex", "role", "intent"],
        },
      },
    },
    required: [
      "screen_type",
      "allowed_intents",
      "action_budget",
      "confidence",
      "nodes",
    ],
  },
};

const SYSTEM_PROMPT = `You are the semantic layer for a mobile app crawler. Given a mobile app screen (XML hierarchy + screenshot + interactable clickables + trajectory summary), produce BOTH:

1. A screen-level plan — what kind of screen this is, what exploration budget is appropriate, and what intents the crawler may act on.

2. Per-node tags — role and intent for every interactive clickable.

The crawler's goal is to MAP the app, not USE it. It explores to build a coverage report for developers. Behave like a senior QA engineer: enumerate screens by navigating, tap items that open new screens, skip items that modify state or create content.

── Intent taxonomy (most important axis) ──
- navigate: moving between screens without changing data — tabs, drawer items, pagination, opening a detail view, back buttons.
- read_only: reveals more info without mutating state — expand/collapse, "Show more", toggle view modes within the same screen.
- write: CREATES or MODIFIES data — Reply, Comment, Post, Send, Like, Repost, Emoji-react, Follow, Subscribe, Save, Add to cart, Dial/Call, Submit (unless an auth form), typing content.
- destructive: IRREVERSIBLE data loss — Delete, Remove, Block, Unfriend, Sign out, Clear data, Reset, Revoke.

Intent rules:
- When genuinely unsure between navigate and write, PREFER navigate. The crawler is used by developers, not end users; max coverage matters more than occasional accidental state changes.
- destructive is STRICT — only assign when the element clearly triggers irreversible data loss. When in doubt about destructive → assign write instead.
- Labels may be in ANY language (Japanese, Spanish, Chinese, Korean, Arabic, ...). Classify by meaning, not English matching.

── Role taxonomy (same as v17) ──
- email_input / password_input / otp_input: form input fields.
- submit_button: primary form action on an auth screen.
- auth_option_email / auth_option_google / auth_option_apple / auth_option_other: provider selector buttons.
- dismiss_button: "Not now", "Skip", "Later", "✕", "Close sheet".
- nav_tab: bottom-nav / top-tab / drawer items.
- content: non-interactive labels, or interactive elements that don't fit the above.
- unknown: genuinely unsure.

── Screen types ──
- feed: homogeneous list of items (posts, articles, products, messages).
- compose: text input sheet for creating content — SKIP, never navigate; the crawler should dismiss these.
- form: data-entry (non-auth) — user info, checkout, profile edit.
- settings: toggles + sub-screen entries.
- detail: view-one-item screen.
- auth: login / signup / OTP / SSO.
- permission: system permission dialog.
- dialog: in-app modal.
- profile: user's own or another user's profile page.
- search: search box + results.
- onboarding: first-run tutorials / tooltips.
- error: error state / empty state.
- other: anything that doesn't fit.

── Plan fields ──
- allowed_intents: intents the dispatcher may act on here. For feed/detail/profile/settings/search/form: ["navigate", "read_only"]. For compose/dialog (crawler's job is to dismiss): ["navigate"] (navigate here includes tapping the close button). For auth/permission ONLY: ["navigate", "read_only", "write"] (write is needed to pass the gate). Never include "destructive". CRITICAL: "write" must NEVER appear on form/profile/settings/compose/search — Save / Submit on a user-data form only mutates the user's account and produces zero crawl coverage. The crawl can navigate around those screens without writing.
- action_budget: reasonable number of actions before the dispatcher re-plans or moves to a new hub. Feed: 3-5. Settings: up to number of items. Compose: 1 (just dismiss). Dialog: 1-2.
- exit_condition: one-line natural-language condition that signals we're done here (e.g. "after 3 feed items opened, press back and navigate to an unvisited hub").
- confidence: 0.0-1.0 — your confidence in the plan. Low confidence (< 0.5) triggers an escalation to Sonnet.

── Per-node priority ──
- priority: 0-10, higher = tap-first. Assign 8-10 to promising navigate targets (nav tabs, feed items, new hubs). Assign 0 to write / destructive items so the filter drops them early.

── Engine action (engine_action) — CRITICAL ──
You ALSO decide what the engine should do BEFORE drivers run. Pick ONE:

- "relaunch": the screen is NOT the target app. This happens when the user pressed back out of the app, or an intent handoff took us to a browser / launcher / dialer / another app entirely. Obvious signals: home-screen launcher dock (3-5 rows of app icons, "Google app" pill), Chrome address bar, Google Discover feed with news headlines, dialer number pad, the generic Android "All apps" drawer. The target package is provided — compare it to what you see. If they don't match, relaunch.

- "press_back": the current screen is a dead-end (empty state, error page, "content not available", end-of-list with no navigation) AND we reached it by mistake (e.g., tapped a broken link). This is rare — prefer "proceed" and let the driver decide whether to back-nav.

- "wait": the screen shows a loading indicator, splash, or transient empty tree. Give the UI a moment to settle.

- "proceed" (DEFAULT): normal case. Drivers should run on this screen.

Rule of thumb: if the screen IS the target app (any screen, any depth), use "proceed". Only deviate when the screen is structurally wrong (not the target app) or temporarily invalid (loading, dead-end). When in doubt, "proceed" — drivers and LLMFallback can recover.

Output engine_action_reason as one short sentence. Not a full paragraph.

Be conservative on budgets (small numbers) — the dispatcher will re-plan when budgets run out. Be generous on classifications — mark every clickable.`;

/**
 * @typedef {import('../v17/drivers/clickable-graph').Clickable} Clickable
 * @typedef {import('../v17/drivers/clickable-graph').ClickableGraph} ClickableGraph
 *
 * @typedef {Object} NodeClassification
 * @property {string} role
 * @property {string} intent
 * @property {number} priority
 * @property {string} [note]
 *
 * @typedef {Object} ScreenPlan
 * @property {string} screenType
 * @property {string} [screenSummary]
 * @property {string[]} allowedIntents
 * @property {number} actionBudget
 * @property {string} [exitCondition]
 * @property {number} confidence
 * @property {string} fingerprint
 * @property {Map<number, NodeClassification>} nodeClassifications
 *
 * @typedef {Clickable & NodeClassification} ClassifiedClickable
 *
 * @typedef {Object} ClassifierDeps
 * @property {any} [anthropic]
 * @property {Map<string, ScreenPlan>} [cache]
 * @property {number} [timeoutMs]
 *
 * @typedef {Object} ObservationLike
 * @property {string} [packageName]
 * @property {string} [activity]
 * @property {string} [screenshotPath]
 * @property {string} [trajectorySummary]
 */

let _defaultClient = null;
function getDefaultClient() {
  if (!_defaultClient) {
    _defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _defaultClient;
}

function createCache() {
  return new Map();
}

/**
 * Compute a structural fingerprint that ignores dynamic text. Matches v17's
 * algorithm so plans can be shared if we ever converge engines.
 *
 * @param {ClickableGraph} graph
 * @param {string} [packageName]
 * @param {string} [activity]
 * @returns {string}
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
 * Read a screenshot from disk and return a base64 data block for Anthropic
 * vision input. Missing / unreadable files → null (classifier proceeds with
 * XML only).
 *
 * @param {string} [screenshotPath]
 * @returns {{type:string, source:object}|null}
 */
function loadScreenshotBlock(screenshotPath) {
  if (!screenshotPath || typeof screenshotPath !== "string") return null;
  try {
    const data = fs.readFileSync(screenshotPath);
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: data.toString("base64"),
      },
    };
  } catch (err) {
    log.warn({ err: err.message, screenshotPath }, "classifier: screenshot load failed — XML only");
    return null;
  }
}

/**
 * Short-circuit deterministic roles for Android-standard inputs. These are
 * always {role:password_input, intent:write} or {role:email_input, intent:write}
 * — AuthDriver owns them, ExplorationDriver's intent filter keeps its hands off.
 *
 * @param {Clickable[]} clickables
 * @returns {Map<number, NodeClassification>}
 */
function applyInputTypeShortCircuit(clickables) {
  const resolved = new Map();
  for (let i = 0; i < clickables.length; i++) {
    const c = clickables[i];
    if (c.isPassword) {
      resolved.set(i, { role: "password_input", intent: "write", priority: 9, note: "password field" });
      continue;
    }
    if (c.isEmail) {
      resolved.set(i, { role: "email_input", intent: "write", priority: 9, note: "email field" });
      continue;
    }
    const desc = c.contentDesc || "";
    const rid = c.resourceId || "";
    if (/close|dismiss|✕|×/i.test(desc) || /close|dismiss/i.test(rid)) {
      resolved.set(i, { role: "dismiss_button", intent: "navigate", priority: 8, note: "close affordance" });
    }
  }
  return resolved;
}

/**
 * Pull the tool_use block out of an Anthropic message.
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
 * Validate and normalise the Haiku output into a ScreenPlan. Returns null
 * if the response is structurally broken (missing required fields, invalid
 * enums, etc.).
 *
 * @param {object} toolInput
 * @param {number} clickableCount
 * @param {string} fingerprint
 * @returns {ScreenPlan|null}
 */
function validatePlan(toolInput, clickableCount, fingerprint) {
  if (!toolInput || typeof toolInput !== "object") return null;

  // Screen-level fields
  if (!VALID_SCREEN_TYPES_SET.has(toolInput.screen_type)) return null;
  if (!Array.isArray(toolInput.allowed_intents) || toolInput.allowed_intents.length === 0) return null;
  for (const intent of toolInput.allowed_intents) {
    if (!VALID_INTENTS_SET.has(intent)) return null;
  }
  // Destructive must never appear in allowed_intents.
  if (toolInput.allowed_intents.includes("destructive")) return null;

  // 2026-04-25 v4: write intent is allowed only on auth-class screens.
  // Strip it server-side on any other screen_type so a Haiku slip can't
  // turn an Edit-Profile / Settings / Compose form into a write loop that
  // mutates user data. Logged at info so we can monitor classifier drift
  // — if the strip fires often, the prompt change isn't taking hold.
  if (
    !WRITE_INTENT_ALLOWED_SCREEN_TYPES.has(toolInput.screen_type) &&
    toolInput.allowed_intents.includes("write")
  ) {
    toolInput.allowed_intents = toolInput.allowed_intents.filter(
      (i) => i !== "write",
    );
    if (toolInput.allowed_intents.length === 0) return null;
    log.info(
      { fingerprint, screenType: toolInput.screen_type },
      "classifier: stripped 'write' intent on non-auth screen",
    );
  }
  const actionBudget = Number(toolInput.action_budget);
  if (!Number.isFinite(actionBudget) || actionBudget < 1 || actionBudget > 20) return null;
  const confidence = Number(toolInput.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;

  // Per-node fields
  const nodeClassifications = new Map();
  if (Array.isArray(toolInput.nodes)) {
    for (const n of toolInput.nodes) {
      if (!n || typeof n.nodeIndex !== "number") continue;
      if (n.nodeIndex < 0 || n.nodeIndex >= clickableCount) continue;
      if (!VALID_ROLES_SET.has(n.role)) continue;
      if (!VALID_INTENTS_SET.has(n.intent)) continue;
      const priority = Number.isFinite(n.priority) ? Math.max(0, Math.min(10, Math.floor(n.priority))) : 5;
      nodeClassifications.set(n.nodeIndex, {
        role: n.role,
        intent: n.intent,
        priority,
        note: typeof n.note === "string" ? n.note.slice(0, 120) : undefined,
      });
    }
  }

  // Phase 2: engine_action — LLM decides what the engine should do BEFORE
  // drivers run. Optional with "proceed" default to preserve backwards-compat
  // with older Haiku responses that predate the schema extension.
  let engineAction = "proceed";
  if (typeof toolInput.engine_action === "string") {
    if (VALID_ENGINE_ACTIONS_SET.has(toolInput.engine_action)) {
      engineAction = toolInput.engine_action;
    }
    // Silently ignore invalid values — default "proceed" is the safe choice.
  }
  const engineActionReason =
    typeof toolInput.engine_action_reason === "string"
      ? toolInput.engine_action_reason.slice(0, 200)
      : undefined;

  return {
    screenType: toolInput.screen_type,
    screenSummary: typeof toolInput.screen_summary === "string" ? toolInput.screen_summary.slice(0, 240) : undefined,
    allowedIntents: toolInput.allowed_intents.slice(),
    actionBudget,
    exitCondition: typeof toolInput.exit_condition === "string" ? toolInput.exit_condition.slice(0, 200) : undefined,
    confidence,
    engineAction,
    engineActionReason,
    fingerprint,
    nodeClassifications,
  };
}

/**
 * Build the Haiku request. Includes:
 *   - System prompt (intent + role + screen type + engine action rules).
 *   - User content: target package (for engine_action=relaunch comparison),
 *     XML (truncated to ~8k), screenshot (optional), trajectory summary
 *     (optional, ≤300 tokens).
 *
 * @param {ClickableGraph} graph
 * @param {string} xmlText
 * @param {ObservationLike} observation
 * @param {{type:string, source:object}|null} screenshotBlock
 */
function buildRequest(graph, xmlText, observation, screenshotBlock) {
  const nodesForPrompt = graph.clickables.map((c, i) => ({
    index: i,
    label: c.label || "",
    resourceId: c.resourceId || "",
    className: c.className || "",
    bounds: c.bounds
      ? { x1: c.bounds.x1, y1: c.bounds.y1, x2: c.bounds.x2, y2: c.bounds.y2 }
      : null,
    isInput: !!c.isInput,
    isButton: !!c.isButton,
    isCheckbox: !!c.isCheckbox,
  }));

  const trajectorySummary =
    observation && typeof observation.trajectorySummary === "string"
      ? observation.trajectorySummary.slice(0, 1200)
      : "";

  const truncatedXml = typeof xmlText === "string" ? xmlText.slice(0, 8000) : "";

  const textBlock = {
    type: "text",
    text: JSON.stringify({
      // Current observed package — derived from adb / XML fallback.
      package: (observation && observation.packageName) || "",
      activity: (observation && observation.activity) || "",
      // Target package the crawl is supposed to stay in. Compare this to
      // `package` above when deciding engine_action (relaunch if mismatched).
      targetPackage: (observation && observation.targetPackage) || "",
      trajectorySummary,
      nodes: nodesForPrompt,
      xmlExcerpt: truncatedXml,
    }),
  };

  const content = screenshotBlock ? [screenshotBlock, textBlock] : [textBlock];

  return {
    model: HAIKU_MODEL,
    max_tokens: HAIKU_MAX_TOKENS,
    temperature: 0,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: CLASSIFY_TOOL.name },
    messages: [{ role: "user", content }],
  };
}

/**
 * Call Haiku with a hard AbortController timeout.
 *
 * @param {object} request
 * @param {{anthropic:any, timeoutMs?:number}} deps
 * @returns {Promise<object|null>}
 */
async function callHaiku(request, deps) {
  const timeoutMs = typeof deps.timeoutMs === "number" ? deps.timeoutMs : HAIKU_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await deps.anthropic.messages.create(request, {
      signal: controller.signal,
    });
    const durationMs = Date.now() - startedAt;
    const toolInput = extractToolInput(response);
    if (!toolInput) {
      log.warn(
        { stopReason: response && response.stop_reason, durationMs },
        "classifier: no tool_use block",
      );
      return null;
    }
    log.info({ durationMs, timeoutMs }, "classifier: haiku call ok");
    return toolInput;
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
 * Merge a classification map into the clickables array, producing the
 * ClassifiedClickable[] consumed by downstream drivers.
 *
 * Missing indices default to intent: "unknown" (NOT "navigate"). The
 * optimistic-on-ambiguity rule in the user-facing prompt applies to cases
 * where Haiku HAS an opinion but low confidence — "unsure, prefer
 * navigate". When Haiku returns nothing at all about a node (silence,
 * not ambiguity), we have literally no signal, so the safest default is
 * "unknown" — which is NOT in EXPLORATION_INTENTS, so the driver will
 * yield and let LLMFallback make a smarter choice.
 *
 * Regression: run a1dba69e (2026-04-24) hit a compose/detail screen
 * with 16 clickables where Haiku returned the screen-level plan but
 * ZERO per-node classifications. Defaulting those to "navigate" let the
 * emoji picker sail through the filter and produced a 4-step revisit
 * loop. The unknown default fixes this.
 *
 * @param {Clickable[]} clickables
 * @param {Map<number, NodeClassification>} nodeClassifications
 * @returns {ClassifiedClickable[]}
 */
function mergeClassifications(clickables, nodeClassifications) {
  return clickables.map((c, i) => {
    const n = nodeClassifications.get(i) || {
      role: "unknown",
      intent: "unknown",
      priority: 0,
    };
    return Object.assign({}, c, {
      role: n.role,
      intent: n.intent,
      priority: n.priority,
      note: n.note,
    });
  });
}

/**
 * Build a conservative default plan used when the Haiku call fails, times out,
 * or produces invalid output. Keeps the crawler moving rather than stalling —
 * we fall through to v17-like behaviour with an optimistic intent filter.
 *
 * @param {Clickable[]} clickables
 * @param {string} fingerprint
 * @returns {ScreenPlan}
 */
function buildDefaultPlan(clickables, fingerprint) {
  const shortCircuited = applyInputTypeShortCircuit(clickables);
  return {
    screenType: "other",
    screenSummary: "default plan (classifier unavailable)",
    allowedIntents: ["navigate", "read_only"],
    actionBudget: 3,
    exitCondition: "explore conservatively, then move to next hub",
    confidence: 0.0, // forces Sonnet escalation if anyone checks
    engineAction: "proceed", // default — let drivers + LLMFallback handle it
    fingerprint,
    nodeClassifications: shortCircuited,
  };
}

/**
 * Classify a screen end-to-end. Returns a ScreenPlan + the classified
 * clickables. On total failure, returns a conservative default plan.
 *
 * @param {ClickableGraph} graph
 * @param {ObservationLike} observation
 * @param {string} xmlText
 * @param {ClassifierDeps} [deps]
 * @returns {Promise<{plan:ScreenPlan, clickables:ClassifiedClickable[]}>}
 */
async function classifyScreen(graph, observation, xmlText, deps = {}) {
  const clickables = (graph && graph.clickables) || [];
  const fingerprint = computeStructuralFingerprint(
    graph,
    observation && observation.packageName,
    observation && observation.activity,
  );

  const cache = deps.cache;
  if (cache && cache.has(fingerprint)) {
    const cached = cache.get(fingerprint);
    log.info({ fingerprint, source: "cache", screenType: cached.screenType }, "classifier: cache hit");
    return { plan: cached, clickables: mergeClassifications(clickables, cached.nodeClassifications) };
  }

  // Tiny graphs → trivial plan without burning a Haiku call.
  //
  // Production run d0bbce69 (2026-04-24): step 2 had 1 clickable (a WebView
  // cover). Classifier timed out at 5s, Sonnet escalation timed out at 8s,
  // escalation budget burned before any real screen was reached. Waste.
  // Tiny graphs rarely need semantic planning — LLMFallback + specialist
  // drivers handle them well. Short-circuit below MIN_CLICKABLES_FOR_CLASSIFICATION.
  if (clickables.length < MIN_CLICKABLES_FOR_CLASSIFICATION) {
    const shortCircuited = applyInputTypeShortCircuit(clickables);
    const plan = {
      screenType: "other",
      screenSummary: `trivial screen (${clickables.length} clickables) — classifier skipped`,
      allowedIntents: ["navigate", "read_only"],
      actionBudget: 1,
      exitCondition: "let specialist drivers or LLMFallback route one action",
      // High confidence on purpose — don't trigger Sonnet escalation here.
      // These screens are benign and the cost of a wrong intent tag is nil
      // because no homogeneous write-shaped clusters are present to filter.
      confidence: 1.0,
      engineAction: "proceed",
      fingerprint,
      nodeClassifications: shortCircuited,
    };
    if (cache) cache.set(fingerprint, plan);
    return { plan, clickables: mergeClassifications(clickables, shortCircuited) };
  }

  const anthropic = deps.anthropic || getDefaultClient();
  const screenshotBlock = loadScreenshotBlock(observation && observation.screenshotPath);
  const request = buildRequest(graph, xmlText, observation, screenshotBlock);

  const toolInput = await callHaiku(request, { anthropic, timeoutMs: deps.timeoutMs });
  if (!toolInput) {
    const plan = buildDefaultPlan(clickables, fingerprint);
    log.warn({ fingerprint, reason: "haiku_unavailable" }, "classifier: using default plan");
    return { plan, clickables: mergeClassifications(clickables, plan.nodeClassifications) };
  }

  const plan = validatePlan(toolInput, clickables.length, fingerprint);
  if (!plan) {
    const fallback = buildDefaultPlan(clickables, fingerprint);
    log.warn({ fingerprint, reason: "schema_validation_failed" }, "classifier: using default plan");
    return { plan: fallback, clickables: mergeClassifications(clickables, fallback.nodeClassifications) };
  }

  // Layer short-circuit classifications on top — they're deterministic and
  // trump whatever Haiku said about password/email fields.
  const shortCircuited = applyInputTypeShortCircuit(clickables);
  for (const [idx, cls] of shortCircuited.entries()) {
    plan.nodeClassifications.set(idx, cls);
  }

  if (cache) cache.set(fingerprint, plan);
  log.info(
    {
      fingerprint,
      source: "fresh",
      screenType: plan.screenType,
      confidence: plan.confidence,
      allowedIntents: plan.allowedIntents.join(","),
      budget: plan.actionBudget,
      classifiedNodes: plan.nodeClassifications.size,
    },
    "classifier: fresh classification",
  );
  return { plan, clickables: mergeClassifications(clickables, plan.nodeClassifications) };
}

module.exports = {
  classifyScreen,
  computeStructuralFingerprint,
  applyInputTypeShortCircuit,
  buildDefaultPlan,
  validatePlan,
  mergeClassifications,
  loadScreenshotBlock,
  createCache,
  CLASSIFY_TOOL,
  HAIKU_MODEL,
  HAIKU_TIMEOUT_MS,
  LOW_CONFIDENCE_THRESHOLD,
  WRITE_INTENT_ALLOWED_SCREEN_TYPES,
  VALID_ROLES,
  VALID_ROLES_SET,
  VALID_INTENTS,
  VALID_INTENTS_SET,
  VALID_SCREEN_TYPES,
  VALID_SCREEN_TYPES_SET,
  VALID_ENGINE_ACTIONS,
  VALID_ENGINE_ACTIONS_SET,
};
