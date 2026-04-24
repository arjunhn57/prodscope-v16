"use strict";

/**
 * Tests for v18/semantic-classifier.js — 8 cases per V18 Phase 1 plan.
 *
 *  1. Valid plan round-trips (screen-level + per-node fields parsed).
 *  2. Plan validation rejects missing screen_type.
 *  3. Plan validation rejects allowed_intents containing "destructive".
 *  4. Plan validation rejects invalid intent value on a node.
 *  5. Empty clickables short-circuit — no Haiku call made.
 *  6. Haiku timeout → default plan returned (allowedIntents=[navigate,read_only]).
 *  7. Cache hit on second call with same fingerprint — zero Haiku calls.
 *  8. Input-type short-circuit overrides Haiku output on password/email fields.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyScreen,
  validatePlan,
  buildDefaultPlan,
  applyInputTypeShortCircuit,
  createCache,
  computeStructuralFingerprint,
  CLASSIFY_TOOL,
  LOW_CONFIDENCE_THRESHOLD,
} = require("../semantic-classifier");
const { parseClickableGraph } = require("../../v17/drivers/clickable-graph");

// ── Mock Anthropic client ─────────────────────────────────────────────

function makeMockClient(scriptedInputs) {
  const calls = [];
  const remaining = Array.isArray(scriptedInputs) ? scriptedInputs.slice() : [];
  return {
    calls,
    messages: {
      create: async (body, options) => {
        calls.push({ body, options });
        if (options && options.signal && options.signal.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        const next = remaining.shift();
        if (!next) throw new Error(`mock exhausted; ${calls.length} calls made but no more scripted`);
        return {
          content: [
            {
              type: "tool_use",
              name: CLASSIFY_TOOL.name,
              id: "mock-id",
              input: next,
            },
          ],
          usage: { input_tokens: 200, output_tokens: 150 },
          stop_reason: "tool_use",
        };
      },
    },
  };
}

function makeTimeoutClient() {
  const calls = [];
  return {
    calls,
    messages: {
      create: (body, options) =>
        new Promise((_resolve, reject) => {
          calls.push({ body, options });
          if (options && options.signal) {
            options.signal.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        }),
    },
  };
}

// ── XML fixture helpers ───────────────────────────────────────────────

function wrap(...nodes) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n${nodes.join("\n")}\n</hierarchy>`;
}

function node({
  text = "",
  desc = "",
  resourceId = "",
  cls = "android.widget.Button",
  pkg = "com.example",
  clickable = true,
  password = false,
  bounds = "[0,0][100,100]",
}) {
  return (
    `<node text="${text}" resource-id="${resourceId}" class="${cls}" ` +
    `package="${pkg}" content-desc="${desc}" clickable="${clickable}" ` +
    `password="${password}" bounds="${bounds}" />`
  );
}

// Biztoso-style comment list with Reply buttons — the real-world pattern
// this whole V18 effort targets.
const biztosoCommentListXml = wrap(
  node({ text: "Great post!", resourceId: "com.biztoso:id/comment_body", cls: "android.widget.TextView", pkg: "com.biztoso", clickable: false, bounds: "[40,200][1040,360]" }),
  node({ text: "Reply", resourceId: "com.biztoso:id/reply_button", cls: "android.widget.Button", pkg: "com.biztoso", bounds: "[40,400][400,500]" }),
  node({ text: "Reply", resourceId: "com.biztoso:id/reply_button", cls: "android.widget.Button", pkg: "com.biztoso", bounds: "[40,620][400,720]" }),
  node({ text: "Reply", resourceId: "com.biztoso:id/reply_button", cls: "android.widget.Button", pkg: "com.biztoso", bounds: "[40,840][400,940]" }),
  node({ text: "Home", resourceId: "com.biztoso:id/nav_home", cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView", pkg: "com.biztoso", bounds: "[0,2280][270,2400]" }),
);

// Auth form — password + email short-circuit territory.
const authFormXml = wrap(
  node({ resourceId: "com.app:id/email_input", cls: "androidx.compose.foundation.text.BasicTextField", pkg: "com.app", bounds: "[80,500][1000,620]" }),
  node({ resourceId: "com.app:id/password_input", cls: "androidx.compose.foundation.text.BasicTextField", pkg: "com.app", password: true, bounds: "[80,680][1000,800]" }),
  node({ text: "Sign in", pkg: "com.app", bounds: "[80,900][1000,1020]" }),
);

// Empty screen — cold-start splash.
const emptyScreenXml = wrap();

// ── 1. Valid plan round-trips ─────────────────────────────────────────

test("classifyScreen: parses a valid Haiku plan end-to-end", async () => {
  const graph = parseClickableGraph(biztosoCommentListXml);
  const scriptedPlan = {
    screen_type: "feed",
    screen_summary: "Biztoso comment list with 3 Reply buttons plus home nav.",
    allowed_intents: ["navigate", "read_only"],
    action_budget: 3,
    exit_condition: "navigate home after seeing the comment thread",
    confidence: 0.85,
    nodes: graph.clickables.map((c, i) => ({
      nodeIndex: i,
      role: (c.label || "").toLowerCase() === "home" ? "nav_tab" : "content",
      intent: (c.label || "").toLowerCase() === "reply" ? "write" : "navigate",
      priority: (c.label || "").toLowerCase() === "reply" ? 0 : 8,
    })),
  };
  const client = makeMockClient([scriptedPlan]);
  const { plan, clickables } = await classifyScreen(
    graph,
    { packageName: "com.biztoso", activity: "MainActivity" },
    biztosoCommentListXml,
    { anthropic: client, cache: createCache() },
  );

  assert.equal(plan.screenType, "feed");
  assert.deepEqual(plan.allowedIntents, ["navigate", "read_only"]);
  assert.equal(plan.actionBudget, 3);
  assert.equal(plan.confidence, 0.85);
  assert.ok(plan.fingerprint && plan.fingerprint.length === 12);
  // Every Reply button came back with intent=write → ExplorationDriver's filter will drop them.
  const replies = clickables.filter((c) => (c.label || "").toLowerCase() === "reply");
  assert.equal(replies.length, 3);
  for (const r of replies) assert.equal(r.intent, "write");
  // Home tab came back navigate.
  const home = clickables.find((c) => (c.label || "").toLowerCase() === "home");
  assert.ok(home);
  assert.equal(home.intent, "navigate");
});

// ── 2. Plan validation rejects missing screen_type ────────────────────

test("validatePlan: rejects missing screen_type", () => {
  const r = validatePlan(
    {
      allowed_intents: ["navigate"],
      action_budget: 3,
      confidence: 0.8,
      nodes: [],
    },
    0,
    "abc123",
  );
  assert.equal(r, null);
});

// ── 3. allowed_intents with "destructive" is rejected ──────────────────

test("validatePlan: rejects allowed_intents containing 'destructive'", () => {
  const r = validatePlan(
    {
      screen_type: "settings",
      allowed_intents: ["navigate", "destructive"],
      action_budget: 3,
      confidence: 0.9,
      nodes: [],
    },
    0,
    "abc123",
  );
  assert.equal(r, null);
});

// ── 4. Invalid intent value on a node ──────────────────────────────────

test("validatePlan: drops a node with invalid intent (keeps the rest)", () => {
  const r = validatePlan(
    {
      screen_type: "feed",
      allowed_intents: ["navigate"],
      action_budget: 3,
      confidence: 0.9,
      nodes: [
        { nodeIndex: 0, role: "content", intent: "navigate", priority: 5 },
        { nodeIndex: 1, role: "content", intent: "launch_nukes", priority: 10 }, // invalid
        { nodeIndex: 2, role: "content", intent: "read_only", priority: 4 },
      ],
    },
    3,
    "abc123",
  );
  assert.ok(r);
  assert.equal(r.nodeClassifications.size, 2);
  assert.ok(r.nodeClassifications.has(0));
  assert.ok(!r.nodeClassifications.has(1));
  assert.ok(r.nodeClassifications.has(2));
});

// ── 5. Empty clickables short-circuit ─────────────────────────────────

test("classifyScreen: empty clickables → trivial plan, zero LLM calls", async () => {
  const graph = parseClickableGraph(emptyScreenXml);
  const client = makeMockClient([]);
  const { plan, clickables } = await classifyScreen(
    graph,
    { packageName: "com.app" },
    emptyScreenXml,
    { anthropic: client },
  );
  assert.equal(client.calls.length, 0);
  assert.equal(clickables.length, 0);
  assert.equal(plan.screenType, "other");
  assert.equal(plan.actionBudget, 1);
  assert.deepEqual(plan.allowedIntents, ["navigate", "read_only"]);
});

// Regression: run d0bbce69 (2026-04-24) hit a WebView-only screen with a
// single clickable. The old classifier burned a Haiku call + Sonnet
// escalation on it and timed out on both, consuming escalation budget on a
// benign screen. Threshold short-circuit prevents the waste.
test("classifyScreen: tiny graph (<3 clickables) → skipped, zero LLM calls", async () => {
  const tinyXml = wrap(
    node({ text: "Loading", resourceId: "com.app:id/webview", cls: "android.webkit.WebView", pkg: "com.app", bounds: "[0,0][1080,2400]" }),
  );
  const graph = parseClickableGraph(tinyXml);
  assert.ok(graph.clickables.length >= 1 && graph.clickables.length < 3, "fixture must have 1-2 clickables");
  const client = makeMockClient([]);
  const { plan, clickables } = await classifyScreen(graph, { packageName: "com.app" }, tinyXml, { anthropic: client });
  assert.equal(client.calls.length, 0, "tiny graph must not trigger a Haiku call");
  assert.equal(plan.confidence, 1.0, "high confidence so Sonnet escalation does NOT fire");
  assert.equal(plan.screenType, "other");
  assert.equal(clickables.length, graph.clickables.length);
});

// ── 6. Timeout → default plan ─────────────────────────────────────────

test("classifyScreen: Haiku timeout → default plan returned (allowed=navigate,read_only)", async () => {
  const graph = parseClickableGraph(biztosoCommentListXml);
  const client = makeTimeoutClient();
  const { plan, clickables } = await classifyScreen(
    graph,
    { packageName: "com.biztoso" },
    biztosoCommentListXml,
    { anthropic: client, timeoutMs: 50 },
  );
  assert.equal(client.calls.length, 1, "must have attempted the Haiku call once");
  assert.equal(plan.screenType, "other");
  assert.deepEqual(plan.allowedIntents, ["navigate", "read_only"]);
  assert.equal(plan.confidence, 0.0);
  assert.ok(plan.confidence < LOW_CONFIDENCE_THRESHOLD, "default-plan confidence must trigger Sonnet escalation");
  // Clickables still present with fallback tags — missing indices default to navigate.
  assert.equal(clickables.length, graph.clickables.length);
  for (const c of clickables) {
    assert.ok(["navigate", "write"].includes(c.intent), `unexpected intent ${c.intent}`);
  }
});

// ── 7. Cache hit → zero additional Haiku calls ────────────────────────

test("classifyScreen: cache hit on second call with same fingerprint — zero additional calls", async () => {
  const graph = parseClickableGraph(biztosoCommentListXml);
  const cache = createCache();
  const scriptedPlan = {
    screen_type: "feed",
    allowed_intents: ["navigate"],
    action_budget: 3,
    confidence: 0.9,
    nodes: graph.clickables.map((c, i) => ({ nodeIndex: i, role: "content", intent: "navigate", priority: 5 })),
  };
  const client = makeMockClient([scriptedPlan]); // only one scripted plan

  const first = await classifyScreen(graph, { packageName: "com.biztoso" }, biztosoCommentListXml, {
    anthropic: client,
    cache,
  });
  const second = await classifyScreen(graph, { packageName: "com.biztoso" }, biztosoCommentListXml, {
    anthropic: client,
    cache,
  });
  assert.equal(client.calls.length, 1, "second call must hit the cache, not Haiku");
  assert.equal(first.plan.fingerprint, second.plan.fingerprint);
  assert.equal(first.plan.screenType, second.plan.screenType);
});

// ── 8. Input-type short-circuit overrides Haiku ───────────────────────

test("classifyScreen: password/email short-circuit overrides whatever Haiku said", async () => {
  const graph = parseClickableGraph(authFormXml);
  // Haiku (hypothetically) mislabels the password field as content/navigate.
  // The short-circuit layer must still tag it as password_input/write.
  const badPlan = {
    screen_type: "auth",
    allowed_intents: ["navigate", "write"],
    action_budget: 4,
    confidence: 0.8,
    nodes: graph.clickables.map((c, i) => ({
      nodeIndex: i,
      role: "content",
      intent: "navigate",
      priority: 5,
    })),
  };
  const client = makeMockClient([badPlan]);
  const { clickables } = await classifyScreen(graph, { packageName: "com.app" }, authFormXml, {
    anthropic: client,
    cache: createCache(),
  });
  // Find the password field (it has isPassword:true by the parser).
  const pw = clickables.find((c) => c.isPassword);
  assert.ok(pw, "expected a password clickable in the parsed graph");
  assert.equal(pw.role, "password_input", "short-circuit must win over Haiku");
  assert.equal(pw.intent, "write");
  const em = clickables.find((c) => c.isEmail);
  assert.ok(em, "expected an email clickable");
  assert.equal(em.role, "email_input");
  assert.equal(em.intent, "write");
});

// ── Extra coverage on applyInputTypeShortCircuit directly ──────────────

test("applyInputTypeShortCircuit: deterministic classification of password/email/close affordances", () => {
  const graph = parseClickableGraph(authFormXml);
  const r = applyInputTypeShortCircuit(graph.clickables);
  // email + password fields should be classified; the Sign in button should NOT
  // be in the short-circuit map (Haiku handles it).
  const pwIdx = graph.clickables.findIndex((c) => c.isPassword);
  const emIdx = graph.clickables.findIndex((c) => c.isEmail);
  assert.ok(r.has(pwIdx));
  assert.equal(r.get(pwIdx).role, "password_input");
  assert.equal(r.get(pwIdx).intent, "write");
  assert.ok(r.has(emIdx));
  assert.equal(r.get(emIdx).role, "email_input");
  assert.equal(r.get(emIdx).intent, "write");
});

// ── Fingerprint stability (regression guard shared with v17) ──────────

test("computeStructuralFingerprint: stable across different dynamic text", () => {
  const a = parseClickableGraph(
    wrap(
      node({ text: "Welcome Alice!", resourceId: "com.app:id/greeting", cls: "android.widget.TextView", clickable: false, bounds: "[0,100][1080,180]" }),
      node({ text: "Home", resourceId: "com.app:id/nav_home", cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView", bounds: "[0,2280][270,2400]" }),
    ),
  );
  const b = parseClickableGraph(
    wrap(
      node({ text: "Welcome Bob!", resourceId: "com.app:id/greeting", cls: "android.widget.TextView", clickable: false, bounds: "[0,100][1080,180]" }),
      node({ text: "Home", resourceId: "com.app:id/nav_home", cls: "com.google.android.material.bottomnavigation.BottomNavigationItemView", bounds: "[0,2280][270,2400]" }),
    ),
  );
  assert.equal(
    computeStructuralFingerprint(a, "com.app", "Main"),
    computeStructuralFingerprint(b, "com.app", "Main"),
  );
});
