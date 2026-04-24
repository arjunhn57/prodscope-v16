"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldEscalate,
  escalate,
  createBudget,
  MAX_SONNET_ESCALATIONS_PER_CRAWL,
} = require("../sonnet-escalation");
const { CLASSIFY_TOOL } = require("../semantic-classifier");
const { parseClickableGraph } = require("../../v17/drivers/clickable-graph");

function wrap(...nodes) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n${nodes.join("\n")}\n</hierarchy>`;
}
function n({ text = "", rid = "", cls = "android.widget.Button", bounds = "[0,0][100,100]", pkg = "com.app" }) {
  return `<node text="${text}" resource-id="${rid}" class="${cls}" package="${pkg}" clickable="true" bounds="${bounds}" />`;
}

function makeMockClient(scripted) {
  const calls = [];
  const remaining = Array.isArray(scripted) ? scripted.slice() : [];
  return {
    calls,
    messages: {
      create: async (body, options) => {
        calls.push({ body, options });
        const next = remaining.shift();
        if (!next) throw new Error(`mock exhausted; ${calls.length} calls made, no more scripted`);
        return {
          content: [{ type: "tool_use", name: CLASSIFY_TOOL.name, id: "m", input: next }],
          usage: { input_tokens: 500, output_tokens: 300 },
          stop_reason: "tool_use",
        };
      },
    },
  };
}

const simpleXml = wrap(
  n({ text: "Home", rid: "com.app:id/home", bounds: "[0,2280][270,2400]" }),
  n({ text: "Search", rid: "com.app:id/search", bounds: "[270,2280][540,2400]" }),
  n({ text: "Profile", rid: "com.app:id/profile", bounds: "[540,2280][810,2400]" }),
);

// ── shouldEscalate ──

test("shouldEscalate: true when plan is missing", () => {
  assert.equal(shouldEscalate(null, {}), true);
});

test("shouldEscalate: true when confidence below threshold", () => {
  assert.equal(shouldEscalate({ confidence: 0.3 }, {}), true);
});

test("shouldEscalate: false when confidence is high and not stuck", () => {
  assert.equal(shouldEscalate({ confidence: 0.9 }, {}), false);
});

test("shouldEscalate: true when crawler is stuck on this fp-family", () => {
  assert.equal(shouldEscalate({ confidence: 0.9 }, { stuckFingerprintFamily: true }), true);
});

// ── escalate ──

test("escalate: budget exhausted → returns null without calling Sonnet", async () => {
  const budget = createBudget(1);
  budget.used = 1;
  const client = makeMockClient([]);
  const graph = parseClickableGraph(simpleXml);
  const r = await escalate(
    graph,
    { packageName: "com.app", screenshotPath: null },
    simpleXml,
    { fingerprint: "abc", confidence: 0.2 },
    { anthropic: client, escalationBudget: budget },
  );
  assert.equal(r, null);
  assert.equal(client.calls.length, 0, "no Sonnet call should have been made");
});

test("escalate: consumes budget and returns a plan on success", async () => {
  const budget = createBudget(2);
  const client = makeMockClient([
    {
      screen_type: "feed",
      allowed_intents: ["navigate", "read_only"],
      action_budget: 3,
      exit_condition: "move to unvisited hub after 3 items",
      confidence: 0.9,
      nodes: [
        { nodeIndex: 0, role: "nav_tab", intent: "navigate", priority: 9 },
        { nodeIndex: 1, role: "nav_tab", intent: "navigate", priority: 9 },
        { nodeIndex: 2, role: "nav_tab", intent: "navigate", priority: 9 },
      ],
    },
  ]);
  const graph = parseClickableGraph(simpleXml);
  const cache = new Map();
  const r = await escalate(
    graph,
    { packageName: "com.app", screenshotPath: null },
    simpleXml,
    { fingerprint: "stable-fp", confidence: 0.3 },
    { anthropic: client, escalationBudget: budget, cache },
  );
  assert.ok(r);
  assert.equal(r.plan.screenType, "feed");
  assert.equal(r.plan.confidence, 0.9);
  assert.equal(budget.used, 1);
  assert.ok(cache.has("stable-fp"), "Sonnet's plan should overwrite the Haiku cache entry");
});

test("escalate: counts budget even when Sonnet returns malformed output", async () => {
  const budget = createBudget(2);
  // Scripted payload missing screen_type → validation fails.
  const client = makeMockClient([
    {
      allowed_intents: ["navigate"],
      action_budget: 2,
      confidence: 0.9,
      nodes: [],
    },
  ]);
  const graph = parseClickableGraph(simpleXml);
  const r = await escalate(
    graph,
    { packageName: "com.app" },
    simpleXml,
    { fingerprint: "fp1", confidence: 0.2 },
    { anthropic: client, escalationBudget: budget },
  );
  assert.equal(r, null);
  assert.equal(budget.used, 1, "budget still consumed so we don't retry the same bad screen");
});

test("MAX_SONNET_ESCALATIONS_PER_CRAWL default is 2", () => {
  assert.equal(MAX_SONNET_ESCALATIONS_PER_CRAWL, 2);
});
