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
  '  { "type": "tap", "x": <int>, "y": <int> }',
  '  { "type": "type", "text": "<string>" }        // use ${EMAIL} / ${PASSWORD} for creds',
  '  { "type": "swipe", "x1": <int>, "y1": <int>, "x2": <int>, "y2": <int> }',
  '  { "type": "long_press", "x": <int>, "y": <int> }',
  '  { "type": "press_back" }',
  '  { "type": "press_home" }',
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
  "",
  "DECISION HEURISTICS:",
  "  * TARGET APP LOCK (highest priority): your ONLY assignment is to crawl the target",
  "    package shown in Context (Package=… line). Never explore Gmail, Chrome, Photos,",
  "    Settings, Play Store, or any other preinstalled app. If feedback=left_app OR the",
  "    current package in the screenshot is NOT the target, your ONLY permitted actions are:",
  "      (a) launch_app — the fastest path back into the target,",
  "      (b) press_back — if the app opened an external handoff (Custom Tab, share sheet).",
  "    Do NOT \"explore\" the Android launcher to pass the time. Budget spent outside the",
  "    target is wasted — prefer done(\"blocked_by_auth\") over orbit.",
  "  * Prefer unvisited-looking UI: different tabs, different list items, buttons you have",
  "    not tried, drawer/hamburger icons, overflow menus (⋮).",
  "  * AUTH HANDLING — important product behaviour:",
  "    The device has a pre-configured generic test account.",
  "      Email: 'flowarjun21@gmail.com', Password: 'Prodscope@123'.",
  "    When you see 'Sign in with Google' or 'Continue with Google', prefer it",
  "    over manual sign-up. If an app requires manual email/password entry, you",
  "    may use these credentials to log in and explore.",
  "    CRITICAL RULE: If the user explicitly provided specific credentials for",
  "    this crawl run, ALWAYS prioritize the user's credentials over these",
  "    default ones. The Credentials: line below tells you what the user passed.",
  "      - If Credentials: shows a real email/password pair, use ${EMAIL} and",
  "        ${PASSWORD} tokens (the executor substitutes at runtime) — ignore the",
  "        Google button and ignore the default generic creds above.",
  "      - If Credentials: shows (none provided), you may type the literal",
  "        generic creds above into email/password fields. Prefer Google sign-in",
  "        first if it's visible; fall back to manual entry only if there is no",
  "        Google option.",
  "      - If there is no Google option AND no credentials help, dismiss the",
  "        login wall via \"Skip\", \"Browse as guest\", X/close icon, or press_back",
  "        so you can keep exploring unauthenticated.",
  "    PHONE-OTP / VERIFICATION CODE / 2FA / CAPTCHA: these codes are NEVER in the prompt.",
  "      If you identify such a field and already tapped it (cursor is in the field), emit",
  "        { \"type\": \"request_human_input\", \"field\": \"otp\", \"prompt\": \"Enter the OTP sent to your phone\" }",
  "      The resolver fills the code from the user's pre-supplied static value OR asks the",
  "      user live. Do NOT guess codes. Do NOT emit request_human_input more than once per",
  "      auth screen — if the same field reappears, it means the prior value was wrong and",
  "      the resolver will automatically fall through to live-popup on the next attempt.",
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
