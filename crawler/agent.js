// crawler/agent.js
"use strict";
// @ts-check

/**
 * agent.js — LLM brain. Single Anthropic API call per step.
 *
 * Input: screenshot + element list + goal + credentials + recent history + visited-screens summary.
 * Output: { reasoning, actionIndex, expectedOutcome }
 *
 * Called from selectAction() in policy-step.js when AGENT_LOOP=true.
 */

const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "agent" });

const client = new Anthropic.Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Sonnet 4.5 supports Anthropic ephemeral prompt caching; Sonnet 4.6 silently
// ignores cache_control at the time of writing and charges full input tokens
// on every call. For the vision-first loop the cache is the #1 cost lever,
// so we pin to 4.5 until 4.6 ships cache support. Override via AGENT_MODEL.
const MODEL = process.env.AGENT_MODEL || "claude-sonnet-4-5";
const MAX_TOKENS = 1024;

/**
 * @typedef {{ index: number, type: string, label: string, priority: number }} AgentElement
 * @typedef {{ step: number, action: string, outcome: string }} JournalEntry
 * @typedef {{ totalScreens: number, navTabs: Array<{ label: string, explored: boolean, exhausted: boolean }> }} AppMapSummary
 * @typedef {{
 *   goal: string,
 *   credentials: { email?: string, password?: string } | null,
 *   packageName: string,
 *   stepNumber: number,
 *   maxSteps: number,
 *   visitedScreensCount: number,
 *   currentScreenType: string,
 *   screenshotPath: string | null,
 *   elements: AgentElement[],
 *   recentHistory: JournalEntry[],
 *   appMapSummary: AppMapSummary
 * }} AgentInput
 * @typedef {{ reasoning: string, actionIndex: number, expectedOutcome: string }} AgentDecision
 *
 * @typedef {{
 *   goal: string,
 *   credentials: { email?: string, password?: string } | null,
 *   packageName: string,
 *   stepNumber: number,
 *   maxSteps: number,
 *   visitedScreensCount: number,
 *   currentScreenType: string,
 *   screenshotPath: string,
 *   recentHistory: JournalEntry[],
 *   appMapSummary: AppMapSummary,
 *   xmlHints?: string[],
 *   visionFirstMode?: boolean
 * }} AgentCoordInput
 *
 * @typedef {
 *   | { action: 'tap', reasoning: string, x: number, y: number, expectedOutcome: string }
 *   | { action: 'type', reasoning: string, text: string, expectedOutcome: string }
 *   | { action: 'swipe', reasoning: string, x1: number, y1: number, x2: number, y2: number, durationMs?: number, expectedOutcome: string }
 *   | { action: 'long_press', reasoning: string, x: number, y: number, expectedOutcome: string }
 *   | { action: 'back', reasoning: string, expectedOutcome: string }
 *   | { action: 'wait', reasoning: string, durationMs: number, expectedOutcome: string }
 * } AgentCoordDecision
 */

/**
 * @param {AgentInput & { hasScreenshot?: boolean }} input
 * @returns {string}
 */
function buildPrompt(input) {
  const hasCreds = !!(input.credentials && (input.credentials.email || input.credentials.password));
  const hasScreenshot = input.hasScreenshot !== false;
  const credBlock = hasCreds
    ? `LOGIN CREDENTIALS AVAILABLE:
- email: ${input.credentials.email || "(none)"}
- password: ${input.credentials.password || "(none)"}

*** TOP PRIORITY UNTIL LOGGED IN ***
Your FIRST job is to log in using these credentials. Do NOT explore anything else until login completes.
1. If you see a "Continue with Email", "Sign in with Email", "Log in", "Sign up with Email", or similar EMAIL-based login option — TAP IT. Ignore phone / Google / Apple / Facebook / social options unless email is literally not available.
2. Once on the email+password form: tap the email field → next step type the email → tap the password field → next step type the password → tap the Submit / Log in / Continue button.
3. If the current screen is a welcome / onboarding / landing screen with a "Log in" or "Sign in" button — tap it to get to the login form.
4. Only AFTER the feed / home / main app is visible should you start exploring features.`
    : "(no login credentials provided)";

  const journalBlock = input.recentHistory.length > 0
    ? input.recentHistory
        .map(h => `  step ${h.step}: ${h.action} → ${h.outcome}`)
        .join("\n")
    : "  (no actions yet — this is the start of the crawl)";

  const elementsBlock = input.elements.length > 0
    ? input.elements
        .map(e => `  [${e.index}] ${e.type}: "${e.label}" (priority ${e.priority})`)
        .join("\n")
    : "  (no actions available)";

  const navBlock = input.appMapSummary && input.appMapSummary.navTabs.length > 0
    ? input.appMapSummary.navTabs
        .map(t => `  - ${t.label}${t.explored ? " (explored)" : ""}${t.exhausted ? " (exhausted)" : ""}`)
        .join("\n")
    : "  (no nav tabs detected yet)";

  const screenshotNote = hasScreenshot
    ? ""
    : "\nNOTE: No screenshot is available for this step (capture failed). Decide purely from the element list below — the labels, types, and priorities tell you what's on screen.\n";

  return `You are exploring an Android app like a curious human user testing it for the first time.

App: ${input.packageName}
Goal: ${input.goal || "Explore the app and discover its main features"}
Step: ${input.stepNumber} of ${input.maxSteps}
Unique screens visited so far: ${input.visitedScreensCount}
Current screen type: ${input.currentScreenType}
${screenshotNote}
${credBlock}

APP MAP SO FAR:
Total screens visited: ${input.appMapSummary.totalScreens}
Nav tabs:
${navBlock}

RECENT ACTIONS (oldest first, most recent last):
${journalBlock}

CURRENT SCREEN — AVAILABLE ACTIONS (pick ONE by index):
${elementsBlock}

GUIDELINES:
- Look at the screenshot. Pick the action a curious human would take next.
${hasCreds ? "- *** LOGIN FIRST ***: if credentials are available and you are NOT yet inside the logged-in app, your only job this step is to move one click closer to a completed email+password login. Tap the email-login entry point, tap the email field, tap the password field, or tap the submit button — in that order depending on where you are." : ""}
- PRIORITIZE main features ONLY AFTER login is complete: bottom navigation tabs, primary call-to-action buttons, content cards.
- AVOID repeating actions that just failed in recent history.
- If you've already explored a feature (see APP MAP), come BACK and try a different one.
- If everything looks the same as 3 steps ago, pick "back" or scroll to find new content.
- If there's nothing new to explore on this screen, pick the "back" action.

Respond with JSON ONLY (no markdown fences, no prose before or after):
{"reasoning": "<one sentence: what you see and why you picked this>", "actionIndex": <integer index from the list above>, "expectedOutcome": "<one sentence: what you expect to happen>"}`;
}

/**
 * @param {string} text
 * @returns {AgentDecision | null}
 */
function parseDecision(text) {
  const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    if (typeof obj.actionIndex !== "number" || !Number.isInteger(obj.actionIndex) || obj.actionIndex < 0) return null;
    if (typeof obj.reasoning !== "string") return null;
    return {
      reasoning: obj.reasoning,
      actionIndex: obj.actionIndex,
      expectedOutcome: typeof obj.expectedOutcome === "string" ? obj.expectedOutcome : "",
    };
  } catch {
    return null;
  }
}

/**
 * @param {AgentInput} input
 * @param {{ apiClient?: { messages: { create: Function } }, readFile?: (path: string) => Buffer }} [deps]
 * @returns {Promise<AgentDecision>}
 */
async function decide(input, deps = {}) {
  if (!input.elements || input.elements.length === 0) {
    return { reasoning: "no elements available", actionIndex: -1, expectedOutcome: "press back" };
  }

  const apiClient = deps.apiClient || client;
  const readFile = deps.readFile || fs.readFileSync;

  let screenshotB64 = null;
  if (input.screenshotPath) {
    try {
      const screenshotBuf = readFile(input.screenshotPath);
      screenshotB64 = screenshotBuf.toString("base64");
    } catch (err) {
      log.warn({ err: err && err.message, path: input.screenshotPath }, "agent screenshot read failed, continuing text-only");
      screenshotB64 = null;
    }
  }

  const prompt = buildPrompt({ ...input, hasScreenshot: !!screenshotB64 });

  const content = screenshotB64
    ? [
        { type: "image", source: { type: "base64", media_type: "image/png", data: screenshotB64 } },
        { type: "text", text: prompt },
      ]
    : [{ type: "text", text: prompt }];

  const startedAt = Date.now();
  let response;
  try {
    response = await apiClient.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    log.error({ err: err && err.message }, "agent API call failed");
    throw err;
  }
  const elapsedMs = Date.now() - startedAt;

  const text = response.content[0] && response.content[0].type === "text"
    ? response.content[0].text
    : "";

  let decision = parseDecision(text);
  if (!decision) {
    log.warn({ text: text.slice(0, 500) }, "agent returned unparseable JSON, falling back to highest-priority element");
    decision = {
      reasoning: "fallback (parse failure): picking highest-priority candidate",
      actionIndex: 0,
      expectedOutcome: "unknown",
    };
  }

  if (decision.actionIndex < 0 || decision.actionIndex >= input.elements.length) {
    log.warn({ actionIndex: decision.actionIndex, max: input.elements.length - 1 }, "agent picked invalid index, falling back");
    decision = {
      ...decision,
      actionIndex: 0,
      reasoning: "(out-of-range fallback) " + decision.reasoning,
    };
  }

  log.info({
    step: input.stepNumber,
    actionIndex: decision.actionIndex,
    elementType: input.elements[decision.actionIndex].type,
    elementLabel: input.elements[decision.actionIndex].label,
    elapsedMs,
    inputTokens: response.usage && response.usage.input_tokens,
    outputTokens: response.usage && response.usage.output_tokens,
    reasoning: decision.reasoning,
  }, "[agent] decision");

  return decision;
}

/**
 * Build a prompt for vision-only mode where XML extraction failed.
 * Agent must pick a tap coordinate from the screenshot or press back.
 *
 * Splits the prompt into a stable PREFIX (goal, credentials, schema) and a
 * per-step SUFFIX (step counter, history, app map, hints). The prefix is
 * byte-identical across every step of a single crawl so Anthropic's
 * ephemeral prompt cache (5-minute TTL) can hit on every request after the
 * first. See decideCoordinates() for how cache_control is applied.
 *
 * @param {AgentCoordInput} input
 * @returns {{ prefix: string, suffix: string }}
 */
function buildCoordPromptParts(input) {
  const hasCreds = !!(input.credentials && (input.credentials.email || input.credentials.password));
  // Credentials are split into two blocks:
  //   - credStrategyBlock: stable login-priority guidance, goes in the cached
  //     PREFIX. Contains NO plaintext email/password — only the strategy.
  //   - credValuesBlock: plaintext email/password, goes in the per-step SUFFIX
  //     so the values are never stored in Anthropic's 5-minute ephemeral
  //     prompt cache. (Security fix: previously the full credBlock — including
  //     the raw values — lived in the cached prefix.)
  const credStrategyBlock = hasCreds
    ? `LOGIN CREDENTIALS WILL BE SUPPLIED IN THE STEP STATE BLOCK BELOW.

*** TOP PRIORITY UNTIL LOGGED IN ***
Your FIRST job is to log in using the supplied credentials. Do NOT explore anything else until login completes.
1. If you see a "Continue with Email", "Sign in with Email", "Log in", "Sign up with Email", or similar EMAIL-based login option — TAP ITS CENTER. Ignore phone / Google / Apple / Facebook / social options unless email is literally not available.
2. Once on the email+password form: tap the email field (next step you'll be able to type the email) → then tap the password field → then tap Submit / Log in / Continue.
3. On a welcome / onboarding / landing screen with a "Log in" or "Sign in" button — tap it.
4. Only AFTER the feed / home / main app is visible should you start exploring.
Note: in this mode you can only TAP coordinates or press BACK. You cannot type yet — typing happens as a follow-up step once a field is focused.`
    : "(no login credentials provided)";

  const credValuesBlock = hasCreds
    ? `LOGIN CREDENTIALS (use these when filling the email / password form):
- email: ${input.credentials.email || "(none)"}
- password: ${input.credentials.password || "(none)"}`
    : "";

  const journalBlock = input.recentHistory.length > 0
    ? input.recentHistory
        .map(h => `  step ${h.step}: ${h.action} → ${h.outcome}`)
        .join("\n")
    : "  (no actions yet — this is the start of the crawl)";

  const navBlock = input.appMapSummary && input.appMapSummary.navTabs.length > 0
    ? input.appMapSummary.navTabs
        .map(t => `  - ${t.label}${t.explored ? " (explored)" : ""}${t.exhausted ? " (exhausted)" : ""}`)
        .join("\n")
    : "  (no nav tabs detected yet)";

  const visionFirstNote = input.visionFirstMode
    ? "You have full gesture control: tap, type, swipe, long-press, back, wait. You can interact like a human."
    : "XML EXTRACTION FAILED for this screen — no element list. Decide purely from the screenshot.";

  const hintsBlock = (input.xmlHints && input.xmlHints.length > 0)
    ? `ADVISORY TEXT HINTS (extracted from accessibility XML — may be empty or misleading on Compose/RN apps; trust the screenshot):
${input.xmlHints.map((h, i) => `  [${i}] "${h}"`).join("\n")}`
    : "(no XML text hints available — trust the screenshot entirely)";

  const actionSchemaBlock = `ACTION VOCABULARY — pick exactly ONE action. Respond with JSON ONLY (no markdown fences, no prose before or after).

TAP a point on screen:
{"reasoning": "<one sentence>", "action": "tap", "x": <int pixel x>, "y": <int pixel y>, "expectedOutcome": "<one sentence>"}

TYPE text into the currently focused input field (you must tap the field in a previous step first):
{"reasoning": "<one sentence>", "action": "type", "text": "<exact text to type, 1-500 chars>", "expectedOutcome": "<one sentence>"}

SWIPE from one point to another (for scrolling, carousels, or dismissing):
{"reasoning": "<one sentence>", "action": "swipe", "x1": <int>, "y1": <int>, "x2": <int>, "y2": <int>, "durationMs": 300, "expectedOutcome": "<one sentence>"}

LONG-PRESS a point (for context menus):
{"reasoning": "<one sentence>", "action": "long_press", "x": <int>, "y": <int>, "expectedOutcome": "<one sentence>"}

PRESS the system BACK button:
{"reasoning": "<one sentence>", "action": "back", "expectedOutcome": "<one sentence>"}

WAIT for animations or async content to settle (0-3000 ms):
{"reasoning": "<one sentence>", "action": "wait", "durationMs": <int 0-3000>, "expectedOutcome": "<one sentence>"}
`;

  // PREFIX — byte-identical across every step of one crawl. Contains only
  // values that are constant within a crawl: goal, package, maxSteps, action
  // schema, guidelines, and credential STRATEGY (not values). Credential
  // VALUES (plaintext email/password) live in the SUFFIX instead, so they
  // are never stored in Anthropic's ephemeral prompt cache. Anything per-step
  // also goes in SUFFIX.
  // MUST exceed 1024 tokens for Sonnet prompt cache to engage. Below that
  // threshold Anthropic silently ignores cache_control and the cache does
  // not hit — measurable as cacheCreationInputTokens staying at 0.
  const prefix = `You are exploring an Android app like a curious human user testing it for the first time.

${visionFirstNote}

App: ${input.packageName}
Goal: ${input.goal || "Explore the app and discover its main features"}
Max steps in this crawl: ${input.maxSteps}

${credStrategyBlock}

GUIDELINES:
- Look at the screenshot. Pick the next action a curious human would take.
- Typical Android screen is 1080 wide x 2400 tall (portrait). Coordinates are in pixels from top-left.
${hasCreds ? "- *** LOGIN FIRST ***: if credentials are available and you are NOT yet inside the logged-in app, every action this phase must move you closer to a completed email+password login. Tap the email-login entry point, then the email field, then the password field, then submit — in that order." : ""}
- PRIORITIZE main features ONLY AFTER login is complete: bottom navigation tabs, primary call-to-action buttons, content cards.
- AVOID repeating actions that just failed in recent history.
- If everything looks the same as 3 steps ago or there's nothing new, choose action: "back".
- DO NOT tap status bar, system buttons, ads, or app close buttons.

HOW TO LOOK AT A SCREEN:
1. First, orient yourself: what screen type is this? Login / onboarding / feed / detail / settings / modal / error / loading?
2. Identify the primary call-to-action. It's usually a big button near the bottom or top-right, often colored differently from the rest of the UI.
3. Identify secondary interactive elements: nav tabs (bottom bar, top tabs), input fields, menu icons (hamburger, kebab, profile avatar).
4. Check for overlays: modals, toasts, keyboard, bottom sheets, cookie banners. These block the rest of the UI and must be dismissed or interacted with first.
5. Pick the ONE action that moves the exploration forward most — into unseen territory, not back to where you came from unless the current screen is a dead end.

COMMON COORDINATES ON A 1080x2400 PORTRAIT SCREEN:
- Status bar: y 0-80. NEVER tap here.
- Top app bar / toolbar: y 80-220. Hamburger menu usually (80, 150). Back arrow (80, 150). Overflow/kebab (990, 150). Search icon (880, 150).
- Hero / header content: y 220-600.
- Main content / feed cards: y 600-2000. First card top around y 650. Second card around y 1150.
- Floating action button (FAB): typically bottom-right, around (960, 2050).
- Bottom navigation bar: y 2200-2360. Tabs are usually 3-5 evenly spaced. For 5 tabs: (108, 2280), (324, 2280), (540, 2280), (756, 2280), (972, 2280).
- System nav bar: y 2360-2400. NEVER tap here — press BACK instead.
- Screen center: (540, 1200). Safe fallback for dismissing overlays by tapping outside.

EXAMPLE DECISIONS:

Scenario A — Login screen with "Continue with email" button visible at (540, 1450):
{"reasoning":"Email login is the credentialed path; tapping it opens the form","action":"tap","x":540,"y":1450,"expectedOutcome":"email+password form appears"}

Scenario B — Feed is visible, haven't tried the Search tab yet (4th bottom nav tab of 5):
{"reasoning":"Search tab is unexplored; tapping it reveals a new screen","action":"tap","x":756,"y":2280,"expectedOutcome":"search screen loads"}

Scenario C — Long list with more content below the fold, nothing new visible:
{"reasoning":"Need to scroll to reveal more feed items","action":"swipe","x1":540,"y1":1800,"x2":540,"y2":600,"durationMs":300,"expectedOutcome":"feed scrolls up"}

Scenario D — Modal dialog open, dismiss button visible at top-right (990, 200):
{"reasoning":"Close the modal to return to the underlying screen","action":"tap","x":990,"y":200,"expectedOutcome":"modal closes"}

Scenario E — Loading spinner fills the screen:
{"reasoning":"Content is still loading; give it time to render","action":"wait","durationMs":2000,"expectedOutcome":"content finishes loading"}

Scenario F — Dead-end detail screen, already explored, nothing else to tap:
{"reasoning":"Nothing new on this screen; go back to explore other branches","action":"back","expectedOutcome":"returns to previous screen"}

ANTI-PATTERNS (do NOT do these):
- Tapping the same coordinate twice in a row when the previous tap produced no change — that screen has nothing at those pixels.
- Tapping the status bar (y < 80) or system nav bar (y > 2360). These are OS chrome, not app UI.
- Tapping ads, "Upgrade to Premium" banners, or "Close app" X buttons. These don't advance exploration.
- Picking action: "back" on step 1. You haven't explored anything yet — tap something first.
- Typing without first tapping an input field. The "type" action only works when a field is already focused.
- Swiping horizontally on a feed that scrolls vertically. Match gesture direction to the content layout.
- Ignoring the recent history block. If the last 3 actions all produced outcome: "no_change", you are stuck — try something radically different.

EXPLORATION HEURISTIC:
On a new screen: try the primary CTA first. If that leads nowhere, try the nav tabs in order. If those are exhausted, scroll to reveal hidden content. If the screen is genuinely exhausted, press back. After 2-3 back presses with no new content, you may be at the app root — try a nav tab you haven't opened yet.

${actionSchemaBlock}`;

  // SUFFIX — per-step variable state. Must NOT be cached. Also carries the
  // plaintext credential values (when present) so they are never stored in
  // Anthropic's ephemeral prompt cache.
  const suffix = `
=== STEP STATE ===
Step: ${input.stepNumber} of ${input.maxSteps}
Unique screens visited so far: ${input.visitedScreensCount}
Current screen type: ${input.currentScreenType}
${hasCreds ? `\n${credValuesBlock}\n` : ""}
APP MAP SO FAR:
Total screens visited: ${input.appMapSummary.totalScreens}
Nav tabs:
${navBlock}

RECENT ACTIONS (oldest first, most recent last):
${journalBlock}

${hintsBlock}

Pick your action now.`;

  return { prefix, suffix };
}

/**
 * Backwards-compatible wrapper that returns the full concatenated prompt.
 * New callers should prefer buildCoordPromptParts() so they can apply
 * Anthropic cache_control on the prefix block.
 *
 * @param {AgentCoordInput} input
 * @returns {string}
 */
function buildCoordPrompt(input) {
  const { prefix, suffix } = buildCoordPromptParts(input);
  return prefix + suffix;
}

/**
 * @param {string} text
 * @returns {AgentCoordDecision | null}
 */
function parseCoordDecision(text) {
  const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof obj.reasoning !== "string") return null;
  const expectedOutcome = typeof obj.expectedOutcome === "string" ? obj.expectedOutcome : "";

  switch (obj.action) {
    case "tap": {
      if (typeof obj.x !== "number" || typeof obj.y !== "number") return null;
      if (!Number.isFinite(obj.x) || !Number.isFinite(obj.y)) return null;
      if (obj.x < 0 || obj.y < 0 || obj.x > 5000 || obj.y > 5000) return null;
      return { action: "tap", reasoning: obj.reasoning, x: Math.round(obj.x), y: Math.round(obj.y), expectedOutcome };
    }
    case "type": {
      if (typeof obj.text !== "string") return null;
      if (obj.text.length < 1 || obj.text.length > 500) return null;
      return { action: "type", reasoning: obj.reasoning, text: obj.text, expectedOutcome };
    }
    case "swipe": {
      const { x1, y1, x2, y2 } = obj;
      if ([x1, y1, x2, y2].some(v => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 5000)) return null;
      const durationMs = typeof obj.durationMs === "number" && obj.durationMs >= 50 && obj.durationMs <= 3000
        ? Math.round(obj.durationMs)
        : 300;
      return {
        action: "swipe",
        reasoning: obj.reasoning,
        x1: Math.round(x1),
        y1: Math.round(y1),
        x2: Math.round(x2),
        y2: Math.round(y2),
        durationMs,
        expectedOutcome,
      };
    }
    case "long_press": {
      if (typeof obj.x !== "number" || typeof obj.y !== "number") return null;
      if (!Number.isFinite(obj.x) || !Number.isFinite(obj.y)) return null;
      if (obj.x < 0 || obj.y < 0 || obj.x > 5000 || obj.y > 5000) return null;
      return { action: "long_press", reasoning: obj.reasoning, x: Math.round(obj.x), y: Math.round(obj.y), expectedOutcome };
    }
    case "back": {
      return { action: "back", reasoning: obj.reasoning, expectedOutcome };
    }
    case "wait": {
      if (typeof obj.durationMs !== "number" || !Number.isFinite(obj.durationMs)) return null;
      const d = Math.max(0, Math.min(3000, Math.round(obj.durationMs)));
      return { action: "wait", reasoning: obj.reasoning, durationMs: d, expectedOutcome };
    }
    default:
      return null;
  }
}

/**
 * Vision-only decision: agent picks tap coordinates from a screenshot when
 * UIAutomator XML is unavailable. Used by capture-step.js fallback path.
 *
 * Applies Anthropic prompt caching by marking the prefix (constant within a
 * crawl) with `cache_control: { type: "ephemeral" }`. The cached prefix must
 * come BEFORE the image block so the per-step image is not part of the
 * cached blob — otherwise the cache would miss every step.
 *
 * If `deps.ctx.v2TokenUsage` is present, input/output/cache token counts
 * are accumulated into it (V2 camelCase accumulator; V1 still owns
 * `ctx.tokenUsage` with snake_case).
 *
 * @param {AgentCoordInput} input
 * @param {{ apiClient?: { messages: { create: Function } }, readFile?: (path: string) => Buffer, ctx?: any }} [deps]
 * @returns {Promise<AgentCoordDecision>}
 */
async function decideCoordinates(input, deps = {}) {
  const apiClient = deps.apiClient || client;
  const readFile = deps.readFile || fs.readFileSync;
  const ctx = deps.ctx || null;

  const { prefix, suffix } = buildCoordPromptParts(input);
  const screenshotBuf = readFile(input.screenshotPath);
  const screenshotB64 = screenshotBuf.toString("base64");

  // ORDER MATTERS: cache_control marks the END of a cacheable prefix, and
  // everything up to and including that block is cached. Put the stable
  // prefix text FIRST with cache_control, then the per-step image, then the
  // per-step suffix. If the image came before the prefix, the cache would
  // include the image and miss on every step.
  const content = [
    {
      type: "text",
      text: prefix,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: screenshotB64 },
    },
    {
      type: "text",
      text: suffix,
    },
  ];

  const startedAt = Date.now();
  let response;
  try {
    response = await apiClient.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    log.error({ err: err && err.message }, "agent coordinate API call failed");
    throw err;
  }
  const elapsedMs = Date.now() - startedAt;

  const text = response.content[0] && response.content[0].type === "text"
    ? response.content[0].text
    : "";

  let decision = parseCoordDecision(text);
  if (!decision) {
    log.warn({ text: text.slice(0, 500) }, "agent coordinate returned unparseable JSON, defaulting to back");
    decision = {
      reasoning: "fallback (parse failure): pressing back",
      action: "back",
      expectedOutcome: "navigate back",
    };
  }

  const usage = response.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheCreationInputTokens = usage.cache_creation_input_tokens || 0;
  const cacheReadInputTokens = usage.cache_read_input_tokens || 0;

  if (ctx && ctx.v2TokenUsage) {
    ctx.v2TokenUsage.inputTokens += inputTokens;
    ctx.v2TokenUsage.outputTokens += outputTokens;
    ctx.v2TokenUsage.cacheCreationInputTokens += cacheCreationInputTokens;
    ctx.v2TokenUsage.cacheReadInputTokens += cacheReadInputTokens;
  }

  log.info({
    step: input.stepNumber,
    action: decision.action,
    x: decision.action === "tap" ? decision.x : undefined,
    y: decision.action === "tap" ? decision.y : undefined,
    elapsedMs,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    cacheHit: cacheReadInputTokens > 0,
    reasoning: decision.reasoning,
  }, "[agent] coordinate decision");

  return decision;
}

module.exports = { decide, decideCoordinates, buildPrompt, parseDecision, buildCoordPrompt, buildCoordPromptParts, parseCoordDecision };
