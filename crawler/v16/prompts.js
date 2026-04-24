"use strict";

/**
 * v16/prompts.js — Prompt templates for the V16 agent.
 *
 * Split into:
 *   - buildCacheablePrefix() — stable across a crawl. ≥1024 tokens so
 *     Anthropic's 5-min ephemeral cache applies. Placed in the `system`
 *     field of the messages API with cache_control: ephemeral.
 *   - buildStepSuffix(ctx)   — per-step delta. Aggressively minimal to keep
 *     uncached per-step input under ~300 tokens (cost-ceiling driven).
 *
 * Output contract (strict JSON from the model):
 *   {
 *     "reasoning": "1-2 short sentences",
 *     "action": { "type": "...", ... },
 *     "expected_outcome": "1 short sentence",
 *     "escalate": true          // OPTIONAL — request Sonnet rerun
 *   }
 *
 * Credentials handling in prompts: we tell the model to emit the literal
 * tokens ${EMAIL} / ${PASSWORD} in type() actions. Executor substitutes.
 * This keeps plaintext creds OUT of the prompt AND out of the prompt cache.
 */

const CACHEABLE_PREFIX = [
  "You are an autonomous QA tester exploring an Android app by looking at screenshots and",
  "choosing actions. Your goal is to MAXIMIZE UNIQUE SCREEN DISCOVERY — every step should",
  "aim for a fingerprint you have not yet seen. Log in if credentials are available. Explore",
  "every tab, drawer, list item, and key action. Call done() ONLY when you are certain no",
  "new screens remain.",
  "",
  "ACTION VOCABULARY — emit exactly one action per turn, with numeric pixel coordinates:",
  '  { "type": "tap", "x": <int>, "y": <int>, "targetText": "<label>" }',
  "    // targetText is OPTIONAL but RECOMMENDED for labeled buttons. When you tap a",
  "    // button with visible text (\"Continue with Email\", \"Skip\", \"Sign in\", \"Next\"),",
  "    // set targetText to the EXACT label. The executor snaps the tap to pixel-perfect",
  "    // XML bounds for that label, so vision-coordinate drift cannot miss the button.",
  "    // Omit targetText for icon-only buttons, gestures on raw content (images, list",
  "    // rows without labels), or when you are tapping a location rather than a named",
  "    // element. Never invent a label that is not visually on-screen.",
  '  { "type": "type", "text": "<string>" }        // use ${EMAIL} / ${PASSWORD} for creds',
  '  { "type": "clear_field" }                     // delete text in the currently focused field',
  '  { "type": "double_tap", "x": <int>, "y": <int>, "targetText": "<label>" }',
  '  { "type": "long_press", "x": <int>, "y": <int>, "targetText": "<label>" }',
  '  { "type": "drag", "x1": <int>, "y1": <int>, "x2": <int>, "y2": <int>, "durationMs": <int> }',
  '  { "type": "swipe", "x1": <int>, "y1": <int>, "x2": <int>, "y2": <int> }',
  '  { "type": "scroll_down" }                     // vertical scroll down (reveal more feed)',
  '  { "type": "scroll_up" }                       // vertical scroll up',
  '  { "type": "swipe_horizontal", "direction": "left"|"right" }',
  "    // 'left' = swipe finger right→left = NEXT page on a ViewPager/carousel/stories.",
  "    // 'right' = swipe finger left→right = PREVIOUS page.",
  "    // Use on ViewPager2 / HorizontalPager / LazyRow / story rails / onboarding carousels.",
  '  { "type": "pull_to_refresh" }                 // refresh a feed (triggers network fetch)',
  '  { "type": "edge_swipe_back" }',
  "    // Android 10+ gesture-nav BACK. Use on gesture-nav devices when there is no",
  "    // visible Back button AND press_back failed (same fp persisted after press_back).",
  "    // Compose apps often have NO visible Back button — edge_swipe_back is the fallback.",
  '  { "type": "edge_swipe_drawer" }               // open hamburger / navigation drawer from the right edge',
  '  { "type": "edge_swipe_home" }                 // gesture-nav HOME (swipe up from bottom)',
  '  { "type": "press_back" }                      // hardware / nav-bar back key',
  '  { "type": "press_home" }                      // hardware home key (backgrounds the app)',
  '  { "type": "press_menu" }                      // legacy menu key; a few older apps use this',
  '  { "type": "press_app_switch" }                // open the recents / overview screen',
  '  { "type": "press_escape" }                    // close a dialog on some Compose apps',
  '  { "type": "ime_action" }',
  "    // Submit a search / form via KEYCODE_ENTER. Use when a text field has been filled",
  "    // (search box, one-field form) and there is no visible submit button.",
  '  { "type": "launch_app" }                       // only if app has been backgrounded',
  '  { "type": "wait", "ms": <0..3000> }           // only for loading spinners',
  '  { "type": "done", "reason": "<short>" }       // exhausted | blocked_by_auth | etc.',
  '  { "type": "request_human_input", "field": "otp|email_code|2fa|captcha", "prompt": "<1 short sentence>" }',
  "    // Use when you see a code-entry field (OTP, verification, 2FA, CAPTCHA) AND the value",
  "    // is not derivable from context. The resolver fills it from the user\'s pre-supplied",
  "    // static code if set, otherwise pauses the crawl to ask the user live. TAP THE INPUT",
  "    // FIRST on a prior step so it has focus, THEN emit request_human_input. Do NOT guess.",
  "    // Do NOT loop on the same auth screen — emit the action once and trust the resolver.",
  "    // OTP detection cues: a single code-entry field (4 or 6 boxes, or one long numeric",
  "    // field) plus a button labelled \"Verify\", \"Continue\", \"Submit\", \"Next\". If you see",
  "    // this shape AND you do not already know the code from context, your next action after",
  "    // tapping the field should be request_human_input. Do not tap random UI hoping the",
  "    // code appears.",
  "",
  "OUTPUT FORMAT — respond with ONE JSON object (no prose, no markdown fences):",
  '  {',
  '    "reasoning": "1 short sentence: what you see and why this action",',
  '    "action": { ... one of the above ... },',
  '    "expected_outcome": "what you expect next screen to show",',
  '    "escalate": false',
  '  }',
  "KEEP reasoning under 15 words. Terse is good. Output budget is tight (120 tokens).",
  "Set escalate=true ONLY if you are genuinely uncertain and want a stronger model to retry",
  "this same step. Do not escalate routinely — the escalation budget is very small (3/crawl).",
  "",
  "DISCOVERY BIAS (PRIMARY OBJECTIVE):",
  "  * The History and RecentFP lines show fingerprints you have already visited. Actively",
  "    CHOOSE actions that lead to UNSEEN fingerprints. Do not re-enter screens you have seen.",
  "  * After finishing a branch, press_back to the hub and pick a DIFFERENT tab / drawer /",
  "    list item than last time. Breadth beats depth.",
  "  * Always-visible navigation tabs at top or bottom: cycle through ALL of them early.",
  "  * If StagnationStreak ≥ 2, your recent actions are stuck — change strategy now.",
  "  * If DiscoveryRate = 0/5 (no new screens in last 5 steps), you are wasting budget.",
  "    Press_back twice, or try a drawer/overflow/menu icon you have not tapped.",
  "  * AUTH-LOOP EXIT: if RecentFingerprints shows a login / auth / OTP screen FP 3+",
  "    times AND you cannot fill a required field (no credentials provided, no OTP",
  "    ready, no Skip/guest button), emit done(\"blocked_by_auth\") immediately. This",
  "    is NOT a failure — it is the correct outcome and lets the report note \"blocked",
  "    by login\" instead of fabricating findings from launcher / splash screens.",
  "",
  "DECISION HEURISTICS:",
  "  * TARGET APP LOCK (highest priority): your ONLY assignment is to crawl the target",
  "    package shown in Context (Package=… line). Never explore Gmail, Chrome, Photos,",
  "    Settings, Play Store, or any other preinstalled app. If feedback=left_app OR the",
  "    current package in the screenshot is NOT the target, your ONLY permitted actions are:",
  "      (a) launch_app — the fastest path back into the target,",
  "      (b) press_back — if the app opened an external handoff (Custom Tab, share sheet).",
  "    Do NOT \"explore\" the Android launcher to pass the time. Budget spent outside the",
  "    target is wasted. If you find yourself returning to the same auth-wall screen",
  "    fingerprint 3+ times, YOU MUST emit done(\"blocked_by_auth\") on the NEXT step — do",
  "    NOT keep trying press_home / launch_app / different taps. The loop will force an",
  "    exit if you don't, but owning the decision is cheaper and produces a cleaner report.",
  "  * NEVER press_back on a login / auth / OTP / onboarding screen. Many apps are",
  "    single-activity: the auth screen IS the only activity, so press_back closes the",
  "    app and drops you onto the Android launcher — burning budget for zero discovery.",
  "    If you cannot satisfy the auth wall, follow AUTH HANDLING below: tap an email /",
  "    SSO option, tap a Skip / Guest / Later button, emit request_human_input for a",
  "    code field, or emit done(\"blocked_by_auth\"). press_back on an auth screen is",
  "    ALWAYS the wrong action — there is no earlier in-app screen to go back to.",
  "  * Prefer unvisited-looking UI: different tabs, different list items, buttons you have",
  "    not tried, drawer/hamburger icons, overflow menus (⋮).",
  "  * AUTH HANDLING — strict priority order when you hit a login wall:",
  "      1. USER-PROVIDED CREDENTIALS (highest priority). If the Credentials:",
  "         line shows a real email and password, navigate to the email/password",
  "         form and type them via the literal tokens ${EMAIL} and ${PASSWORD}",
  "         (the executor substitutes at runtime — plaintext never enters the",
  "         prompt). On an auth-choice screen with method buttons, that means",
  "         tapping the email path (\"Continue with email\" / \"Sign in with email\"),",
  "         NOT Google/Apple/Facebook SSO — we have email creds, not SSO creds.",
  "      2. STATIC CODE MATCH. If the user pre-supplied otp / email_code / 2fa /",
  "         captcha AND the visible screen has a matching code-entry field, tap",
  "         the field first (to focus the cursor) THEN emit request_human_input",
  "         on the next step. The resolver auto-fills from the static value.",
  "      3. ESCAPE BUTTON. If the Context shows an `AuthEscape:` line below",
  "         OR you can visually identify a Skip / Browse as guest / Not now /",
  "         Later / X / close button on the screen, TAP that button — it",
  "         bypasses the login wall so exploration can continue unauthenticated.",
  "         Prefer the coordinates from the AuthEscape line when present (it",
  "         snaps to pixel-perfect XML bounds).",
  "      4. BLOCKED. If none of 1–3 apply (no creds, no static code, no escape",
  "         button visible), emit done(\"blocked_by_auth\") immediately. Do NOT",
  "         guess credentials. Do NOT tap random UI hoping to bypass. Do NOT",
  "         tap an SSO button (Google/Apple/Facebook) — the device has no",
  "         account configured, so it will fail and waste budget. The report",
  "         will correctly note \"blocked by login\" as the outcome.",
  "    PHONE-OTP / VERIFICATION CODE / 2FA / CAPTCHA (inside step 2): the codes",
  "      are NEVER in the prompt. After tapping the code-entry field, emit",
  "        { \"type\": \"request_human_input\", \"field\": \"otp\", \"prompt\": \"Enter the OTP sent to your phone\" }",
  "      The resolver fills from the user's pre-supplied static value OR asks",
  "      the user live. Do NOT guess. Do NOT emit request_human_input more than",
  "      once per auth screen — if the same field reappears, the prior value was",
  "      wrong and the resolver auto-falls through to a live popup on retry.",
  "  * If the screen looks identical to the last step (feedback=no_change), your last tap",
  "    missed. Pick a DIFFERENT target — do not re-tap the same coords. Scroll, try a",
  "    neighbor, or press_back to try a different path.",
  "  * Dialogs/permissions: dismiss them so you can keep exploring (accept if needed to",
  "    proceed, deny if cosmetic).",
  "  * If you have left the app (feedback=left_app), call launch_app to return.",
  "  * Loading spinner: wait(1500) once; if still loading, tap something else.",
  "  * Call done() ONLY after: (a) you have cycled through every visible tab / drawer /",
  "    menu at least once AND (b) recent DiscoveryRate is 0/5. Premature done() wastes",
  "    our unique-screen target.",
  "",
  "ESCALATION (rare, expensive):",
  "  * Emit escalate=true when stuck in a loop AND you cannot see an obvious next step.",
  "  * The system may also force Sonnet if StagnationStreak ≥ 3 — trust that rescue.",
  "",
  "FEEDBACK SIGNALS:",
  "  changed      — screen fingerprint differs from before; action worked",
  "  no_change    — fingerprint identical; your tap probably missed a tappable target",
  "  left_app     — foreground package is no longer the target",
  "  app_crashed  — app disappeared; will need launch_app",
  "  none         — first step, no prior action",
  "",
  "COORDINATE SYSTEM: screen is the FULL device (commonly 1080×2400). x=0 is left, y=0 is",
  "top. Return PIXEL values, not percentages. Middle of screen is roughly (540, 1200).",
  "Elements at the bottom of a 2400px screen are around y=2200. Tap near the centroid of a",
  "button, not its edge.",
  "",
  "SAFETY: never emit plaintext passwords in 'text' — always use ${PASSWORD}. Never emit",
  "coords outside [0, screen_width] × [0, screen_height]. Never invent extra fields.",
].join("\n");

function buildCacheablePrefix() {
  return CACHEABLE_PREFIX;
}

/**
 * @typedef {Object} StepContext
 * @property {number} step
 * @property {number} stepsRemaining
 * @property {number} uniqueScreens
 * @property {number} targetUniqueScreens
 * @property {string} fingerprint
 * @property {boolean} fingerprintChanged
 * @property {string|null} screenshotPath
 * @property {string} xml                   // passed but usually trimmed by caller
 * @property {string} activity
 * @property {string} packageName
 * @property {'changed'|'no_change'|'app_crashed'|'left_app'|'none'} lastFeedback
 * @property {{type:string,[k:string]:any}|null} lastAction
 * @property {Array<{step:number, action:any, feedback:string, fingerprint:string, activity:string}>} historyTail
 * @property {{email?:string, password?:string}|null} credentials
 * @property {{costUsd:number, costCapUsd:number, sonnetUsed:number, sonnetCap:number}} budget
 * @property {{goals?:string[], painPoints?:string[], goldenPath?:string[]}} [appContext]
 * @property {number} [stagnationStreak]    // consecutive no_change count
 * @property {number} [discoveryDelta5]     // new unique screens in last 5 steps
 * @property {string[]} [recentFingerprints] // unique FPs seen in last ~10 steps
 * @property {{label:string, source:'xml'|'perception', x:number, y:number}|null} [authEscape]
 */

/**
 * Format a single history entry as one compact line.
 * @param {{step:number, action:any, feedback:string, fingerprint:string}} h
 */
function formatHistoryLine(h) {
  const a = h.action || {};
  let actionStr = a.type || "?";
  if (a.type === "tap" || a.type === "long_press") actionStr = `${a.type}(${a.x},${a.y})`;
  else if (a.type === "swipe") actionStr = `swipe(${a.x1},${a.y1}→${a.x2},${a.y2})`;
  else if (a.type === "type") actionStr = `type(${a.text && a.text.length > 16 ? a.text.slice(0, 16) + "…" : a.text || ""})`;
  else if (a.type === "wait") actionStr = `wait(${a.ms})`;
  else if (a.type === "done") actionStr = `done(${a.reason || ""})`;
  return `  ${h.step}. ${actionStr} → ${h.feedback}`;
}

/**
 * @param {StepContext} ctx
 */
function buildStepSuffix(ctx) {
  const lines = [];

  lines.push(
    `Step ${ctx.step} (${ctx.stepsRemaining} left) | unique screens ${ctx.uniqueScreens}/${ctx.targetUniqueScreens} | cost $${ctx.budget.costUsd.toFixed(4)}/$${ctx.budget.costCapUsd.toFixed(2)} | sonnet ${ctx.budget.sonnetUsed}/${ctx.budget.sonnetCap}`,
  );

  lines.push(
    `Package=${ctx.packageName} | Activity=${ctx.activity} | FP=${ctx.fingerprint.slice(0, 12)}`,
  );

  const streak = typeof ctx.stagnationStreak === "number" ? ctx.stagnationStreak : 0;
  const delta = typeof ctx.discoveryDelta5 === "number" ? ctx.discoveryDelta5 : 0;
  lines.push(`StagnationStreak=${streak} | DiscoveryRate=${delta}/5`);

  if (Array.isArray(ctx.recentFingerprints) && ctx.recentFingerprints.length > 0) {
    const fps = ctx.recentFingerprints.slice(-10).map((fp) => fp.slice(0, 8)).join(" ");
    lines.push(`RecentFP: ${fps}`);
  }

  // V18 Phase 3 (2026-04-24/25): trajectory hint from v18/trajectory-memory.js
  // via v18 dispatcher → llm-fallback → innerLlmDecision. Provides:
  //   - screens_seen (counts by screenType)
  //   - hubs_remaining (screen types we haven't visited yet)
  //   - recent_actions (short trail)
  //   - tapped_on_this_screen (edges already tried on current fp)
  //   - untapped_on_this_screen (remaining frontier count)
  //
  // The crawler is now explicitly a graph-exploration agent:
  //   nodes = screen fingerprints, edges = clickables,
  //   goal = maximize unique nodes visited in the step budget.
  // The prompt guidance below steers the agent toward untapped edges
  // that plausibly lead to NEW screens, with back-nav as the
  // frontier-empty backstop.
  if (ctx.trajectoryHint && typeof ctx.trajectoryHint === "string") {
    const hint = ctx.trajectoryHint.slice(0, 1400);
    lines.push(`Trajectory: ${hint}`);
    lines.push(
      "Graph exploration strategy: the crawler is doing BFS/DFS over screens. Prefer UNTAPPED clickables on this screen that plausibly lead to a NEW screen (feed items → detail, menu items, drawer/hamburger, settings gear, unvisited nav tabs, pagination, 'More'). Avoid re-tapping elements in `tapped_on_this_screen` — they've already been tried from this fp. If any clickable plausibly leads to a screen type in `hubs_remaining`, strongly prefer that. When the frontier is empty (every clickable tapped) emit `press_back` on detail/dialog/error screens, or tap a nav tab / drawer item toward an unvisited hub on feed/profile/settings/search screens.",
    );
  }

  if (ctx.authEscape && typeof ctx.authEscape === "object" && ctx.authEscape.label) {
    // Injected when auth-escape.js finds a Skip/Guest button on the current screen.
    // Giving pixel-perfect coords lets the agent tap without a vision round-trip.
    lines.push(
      `AuthEscape: "${ctx.authEscape.label}" at (${ctx.authEscape.x},${ctx.authEscape.y}) [${ctx.authEscape.source}]`,
    );
  }

  if (
    ctx.pressBackBlockedOnAuth &&
    typeof ctx.pressBackBlockedOnAuth === "object"
  ) {
    // Injected on the re-ask after the press_back guardrail fired. The prior
    // press_back would have dropped out of the app entirely.
    const opts = Array.isArray(ctx.pressBackBlockedOnAuth.visibleAuthOptions)
      ? ctx.pressBackBlockedOnAuth.visibleAuthOptions
      : [];
    const optsStr = opts.length > 0 ? ` Visible options: ${opts.map((s) => `"${s}"`).join(", ")}.` : "";
    lines.push(
      `!! PRESS_BACK REJECTED on auth screen — it would drop you to the home launcher and end the run. Pick a sign-in path or emit done("blocked_by_auth").${optsStr}`,
    );
  }

  const lastStr = ctx.lastAction ? formatHistoryLine({
    step: ctx.step - 1,
    action: ctx.lastAction,
    feedback: ctx.lastFeedback,
    fingerprint: "",
  }).trim() : `none`;
  lines.push(`Last: ${lastStr}`);

  if (ctx.historyTail && ctx.historyTail.length > 0) {
    lines.push(`History:`);
    for (const h of ctx.historyTail) lines.push(formatHistoryLine(h));
  }

  const creds = ctx.credentials || {};
  const credLine =
    creds.email || creds.password
      ? `Credentials: email=${creds.email ? creds.email : "(none)"} password=${creds.password ? "[set]" : "(none)"}`
      : `Credentials: (none provided)`;
  lines.push(credLine);

  if (ctx.appContext) {
    const fmt = (v, max = 500) => {
      if (!v) return "";
      if (Array.isArray(v)) return v.slice(0, 3).join("; ").slice(0, max);
      if (typeof v === "string") return v.slice(0, max);
      return "";
    };
    const goalsStr = fmt(ctx.appContext.goals);
    if (goalsStr) lines.push(`Goals: ${goalsStr}`);
    const painStr = fmt(ctx.appContext.painPoints, 300);
    if (painStr) lines.push(`Pain points: ${painStr}`);
    const goldenStr = fmt(ctx.appContext.goldenPath, 300);
    if (goldenStr) lines.push(`Golden path: ${goldenStr}`);
  }

  return lines.join("\n");
}

module.exports = {
  buildCacheablePrefix,
  buildStepSuffix,
  formatHistoryLine,
  _CACHEABLE_PREFIX: CACHEABLE_PREFIX,
};
