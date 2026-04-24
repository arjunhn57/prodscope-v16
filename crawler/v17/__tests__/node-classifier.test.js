"use strict";

/**
 * Tests for v17/node-classifier.js.
 *
 * 6 cases per plan nifty-nibbling-widget.md A.1.5:
 *  1. Input-type short-circuit → zero mock LLM calls.
 *  2. Structural fingerprint stability across dynamic text (personalization).
 *  3. Different resource-ids → different fingerprints.
 *  4. Mocked Haiku returns roles → clickables get .role populated.
 *  5. Haiku timeout → classifier returns null.
 *  6. Cache hit on second call with same fingerprint.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classify,
  computeStructuralFingerprint,
  computeLogicalFingerprint,
  applyInputTypeShortCircuit,
  createCache,
  HAIKU_MODEL,
  CLASSIFY_TOOL,
} = require("../node-classifier");
const { parseClickableGraph } = require("../drivers/clickable-graph");

// ── Mock Anthropic client ─────────────────────────────────────────────

function makeMockClient(scriptedAssignments) {
  const calls = [];
  const remaining = Array.isArray(scriptedAssignments) ? scriptedAssignments.slice() : [];
  return {
    calls,
    messages: {
      create: async (body, options) => {
        calls.push({ body, options });
        // Respect abort signal — if pre-aborted, reject immediately.
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
              input: { assignments: next },
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
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
          // Never resolves — only abort can reject.
        }),
    },
  };
}

// ── XML fixture helpers (shared shape with clickable-graph tests) ─────

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

// Biztoso email form (Compose) — password attr + email resource-id set.
const biztosoEmailFormXml = wrap(
  node({ resourceId: "com.biztoso.app:id/email_input", cls: "androidx.compose.foundation.text.BasicTextField", pkg: "com.biztoso.app", bounds: "[80,500][1000,620]" }),
  node({ resourceId: "com.biztoso.app:id/password_input", cls: "androidx.compose.foundation.text.BasicTextField", pkg: "com.biztoso.app", password: true, bounds: "[80,680][1000,800]" }),
  node({ text: "Sign in", pkg: "com.biztoso.app", bounds: "[80,900][1000,1020]" }),
);

// Gmail email form (Material) — password attr + email resource-id set.
const gmailEmailFormXml = wrap(
  node({ resourceId: "com.google.android.gm:id/email_address_view", cls: "com.google.android.material.textfield.TextInputEditText", pkg: "com.google.android.gm", bounds: "[80,400][1000,520]" }),
  node({ resourceId: "com.google.android.gm:id/password", cls: "com.google.android.material.textfield.TextInputEditText", pkg: "com.google.android.gm", password: true, bounds: "[80,600][1000,720]" }),
  node({ text: "Next", pkg: "com.google.android.gm", bounds: "[820,800][1000,920]" }),
);

// ── 1. Input-type short-circuit: deterministic, zero LLM calls ────────

test("classify: short-circuits password + email from structural metadata — zero LLM calls (biztoso + gmail)", async () => {
  for (const [name, xml] of [["biztoso", biztosoEmailFormXml], ["gmail", gmailEmailFormXml]]) {
    const graph = parseClickableGraph(xml);
    // Reduce graph to only short-circuitable nodes (drop the submit button).
    const shortCircuitOnlyClickables = graph.clickables.filter((c) => c.isPassword || c.isEmail);
    const shortCircuitOnlyGraph = {
      clickables: shortCircuitOnlyClickables,
      groups: {
        inputs: shortCircuitOnlyClickables.filter((c) => c.isInput),
        emailInputs: shortCircuitOnlyClickables.filter((c) => c.isEmail),
        passwordInputs: shortCircuitOnlyClickables.filter((c) => c.isPassword),
      },
    };
    const mock = makeMockClient([]);
    const cache = createCache();
    const classified = await classify(
      shortCircuitOnlyGraph,
      { packageName: "com.example", activity: "com.example/.Main" },
      { anthropic: mock, cache },
    );
    assert.ok(classified, `${name}: classify returned null`);
    assert.equal(mock.calls.length, 0, `${name}: no LLM call expected for fully short-circuitable inputs`);
    const roles = classified.map((c) => c.role).sort();
    assert.deepEqual(roles, ["email_input", "password_input"], `${name}: roles`);
  }

  // Also verify applyInputTypeShortCircuit directly.
  const biztoso = parseClickableGraph(biztosoEmailFormXml);
  const resolved = applyInputTypeShortCircuit(biztoso.clickables);
  const email = biztoso.clickables.findIndex((c) => c.isEmail);
  const pwd = biztoso.clickables.findIndex((c) => c.isPassword);
  assert.equal(resolved.get(email).role, "email_input");
  assert.equal(resolved.get(pwd).role, "password_input");
});

// ── 2. Fingerprint ignores dynamic text (personalization) ─────────────

test("computeStructuralFingerprint: identical fingerprint when only dynamic text changes", () => {
  // Same app/screen; only the greeting text differs between users.
  const forUser = (greeting) =>
    wrap(
      node({ text: greeting, clickable: false, cls: "android.widget.TextView", bounds: "[100,100][900,200]", pkg: "com.biztoso.app" }),
      node({ resourceId: "com.biztoso.app:id/email_input", cls: "androidx.compose.foundation.text.BasicTextField", pkg: "com.biztoso.app", bounds: "[80,500][1000,620]" }),
      node({ text: "Sign in", pkg: "com.biztoso.app", bounds: "[80,900][1000,1020]" }),
    );
  const arjunGraph = parseClickableGraph(forUser("Welcome, Arjun"));
  const janeGraph = parseClickableGraph(forUser("Welcome, Jane"));
  const fpArjun = computeStructuralFingerprint(arjunGraph, "com.biztoso.app", "com.biztoso.app/.Login");
  const fpJane = computeStructuralFingerprint(janeGraph, "com.biztoso.app", "com.biztoso.app/.Login");
  assert.equal(fpArjun, fpJane, "personalized greeting must not fragment the cache");

  // Sanity: locale change also produces same fingerprint.
  const jaGraph = parseClickableGraph(forUser("ようこそ、Arjunさん"));
  const fpJa = computeStructuralFingerprint(jaGraph, "com.biztoso.app", "com.biztoso.app/.Login");
  assert.equal(fpArjun, fpJa, "localized text must not fragment the cache");
});

// ── 3. Different resource-ids → different fingerprints ─────────────────

test("computeStructuralFingerprint: different resource-ids produce different fingerprints (biztoso vs gmail vs linkedin)", () => {
  const biztoso = parseClickableGraph(biztosoEmailFormXml);
  const gmail = parseClickableGraph(gmailEmailFormXml);
  const linkedinXml = wrap(
    node({ resourceId: "com.linkedin.android:id/session_key", cls: "android.widget.EditText", pkg: "com.linkedin.android", bounds: "[80,500][1000,620]" }),
    node({ resourceId: "com.linkedin.android:id/session_password", cls: "android.widget.EditText", pkg: "com.linkedin.android", password: true, bounds: "[80,680][1000,800]" }),
    node({ text: "Sign in", pkg: "com.linkedin.android", bounds: "[80,900][1000,1020]" }),
  );
  const linkedin = parseClickableGraph(linkedinXml);

  const fpB = computeStructuralFingerprint(biztoso, "com.biztoso.app", "com.biztoso.app/.Login");
  const fpG = computeStructuralFingerprint(gmail, "com.google.android.gm", "com.google.android.gm/.Auth");
  const fpL = computeStructuralFingerprint(linkedin, "com.linkedin.android", "com.linkedin.android/.Login");

  const fps = new Set([fpB, fpG, fpL]);
  assert.equal(fps.size, 3, "biztoso, gmail, and linkedin should produce distinct fingerprints");
});

// ── 4. Mocked Haiku returns known roles → clickables carry .role ───────

test("classify: mocked Haiku populates .role on clickables and preserves bounds (biztoso auth-choice)", async () => {
  const biztosoAuthChoiceXml = wrap(
    node({ text: "Continue with Email", bounds: "[40,900][1040,1050]", pkg: "com.biztoso.app" }),
    node({ text: "Continue with Google", bounds: "[40,1100][1040,1250]", pkg: "com.biztoso.app" }),
    node({ text: "Continue with Apple", bounds: "[40,1300][1040,1450]", pkg: "com.biztoso.app" }),
  );
  const graph = parseClickableGraph(biztosoAuthChoiceXml);
  const mock = makeMockClient([
    [
      { nodeIndex: 0, role: "auth_option_email", confidence: 0.95 },
      { nodeIndex: 1, role: "auth_option_google", confidence: 0.95 },
      { nodeIndex: 2, role: "auth_option_apple", confidence: 0.95 },
    ],
  ]);
  const classified = await classify(
    graph,
    { packageName: "com.biztoso.app", activity: "com.biztoso.app/.Login" },
    { anthropic: mock, cache: createCache() },
  );
  assert.ok(classified);
  assert.equal(classified.length, 3);
  assert.equal(classified[0].role, "auth_option_email");
  assert.equal(classified[1].role, "auth_option_google");
  assert.equal(classified[2].role, "auth_option_apple");
  // Bounds preserved through merge.
  assert.equal(classified[0].cx, 540);
  assert.equal(classified[0].cy, 975);
  // Haiku was called exactly once with the right model.
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].body.model, HAIKU_MODEL);
});

// ── 5. Haiku timeout → classify returns null ──────────────────────────

test("classify: timeout aborts the Haiku call and returns null (biztoso auth-choice)", async () => {
  const biztosoAuthChoiceXml = wrap(
    node({ text: "Continue with Email", bounds: "[40,900][1040,1050]", pkg: "com.biztoso.app" }),
    node({ text: "Continue with Google", bounds: "[40,1100][1040,1250]", pkg: "com.biztoso.app" }),
  );
  const graph = parseClickableGraph(biztosoAuthChoiceXml);
  const mock = makeTimeoutClient();

  const startedAt = Date.now();
  const result = await classify(
    graph,
    { packageName: "com.biztoso.app", activity: "com.biztoso.app/.Login" },
    { anthropic: mock, cache: createCache(), timeoutMs: 40 },
  );
  const elapsed = Date.now() - startedAt;

  assert.equal(result, null, "classify must return null on timeout");
  assert.equal(mock.calls.length, 1, "Haiku was attempted once");
  assert.ok(elapsed < 500, `timeout elapsed ${elapsed}ms — should abort quickly (<500ms)`);
});

// ── 6. Cache hit on second call → zero LLM calls ──────────────────────

test("classify: second call with same fingerprint hits cache — zero LLM calls", async () => {
  const biztosoAuthChoiceXml = wrap(
    node({ text: "Continue with Email", bounds: "[40,900][1040,1050]", pkg: "com.biztoso.app" }),
    node({ text: "Continue with Google", bounds: "[40,1100][1040,1250]", pkg: "com.biztoso.app" }),
  );
  const graph = parseClickableGraph(biztosoAuthChoiceXml);
  const mock = makeMockClient([
    [
      { nodeIndex: 0, role: "auth_option_email", confidence: 0.95 },
      { nodeIndex: 1, role: "auth_option_google", confidence: 0.95 },
    ],
  ]);
  const cache = createCache();
  const observation = { packageName: "com.biztoso.app", activity: "com.biztoso.app/.Login" };

  // First call → fresh, 1 LLM call.
  const first = await classify(graph, observation, { anthropic: mock, cache });
  assert.ok(first);
  assert.equal(mock.calls.length, 1, "first call should hit Haiku once");

  // Second call with same fingerprint → cache hit, 0 LLM calls.
  const second = await classify(graph, observation, { anthropic: mock, cache });
  assert.ok(second);
  assert.equal(mock.calls.length, 1, "second call must not hit Haiku again");
  assert.equal(second[0].role, "auth_option_email");
  assert.equal(second[1].role, "auth_option_google");

  // Third call with a structurally different graph → cache miss, 2nd LLM call.
  // (Not strictly required by the 6-test plan but catches a regression where
  // the cache ignores fingerprint.)
  const otherXml = wrap(
    node({ text: "Sign up", bounds: "[40,900][1040,1050]", pkg: "com.other.app", resourceId: "com.other.app:id/signup" }),
  );
  mock.messages.create = async () => {
    mock.calls.push({ body: null, options: null });
    return {
      content: [
        {
          type: "tool_use",
          name: CLASSIFY_TOOL.name,
          id: "mock-id",
          input: { assignments: [{ nodeIndex: 0, role: "auth_option_other", confidence: 0.9 }] },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  };
  const third = await classify(
    parseClickableGraph(otherXml),
    { packageName: "com.other.app", activity: "com.other.app/.Signup" },
    { anthropic: mock, cache },
  );
  assert.ok(third);
  assert.equal(mock.calls.length, 2, "different fingerprint must trigger a fresh LLM call");
});

// ── Phase 4: logical fingerprint (2026-04-25) ──────────────────────────

test("computeLogicalFingerprint: stable across scroll position / item count variance on the same screen", () => {
  // Home feed at two different scroll positions — same clickables
  // (resource-ids, className prefixes) but different bounds / positions.
  const homeAtTop = parseClickableGraph(wrap(
    node({ resourceId: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,200][1040,400]" }),
    node({ resourceId: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,410][1040,610]" }),
    node({ resourceId: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,620][1040,820]" }),
    node({ resourceId: "com.app:id/nav_home", cls: "androidx.compose.material.BottomNavigationItem", bounds: "[0,2280][270,2400]" }),
  ));
  const homeAfterScroll = parseClickableGraph(wrap(
    // Different number of cards visible, different y positions — same classes/rids.
    node({ resourceId: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,800][1040,1000]" }),
    node({ resourceId: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,1010][1040,1210]" }),
    node({ resourceId: "com.app:id/nav_home", cls: "androidx.compose.material.BottomNavigationItem", bounds: "[0,2280][270,2400]" }),
  ));
  const a = computeLogicalFingerprint(homeAtTop, "com.app", "HomeActivity");
  const b = computeLogicalFingerprint(homeAfterScroll, "com.app", "HomeActivity");
  assert.equal(a, b, "scroll-position variance must NOT change the logical fp");
});

test("computeLogicalFingerprint: different screens produce different fps", () => {
  const home = parseClickableGraph(wrap(
    node({ resourceId: "com.app:id/feed_item", cls: "com.app.FeedCard", bounds: "[40,200][1040,400]" }),
    node({ resourceId: "com.app:id/nav_home", cls: "com.app.NavTab", bounds: "[0,2280][270,2400]" }),
  ));
  const settings = parseClickableGraph(wrap(
    node({ resourceId: "com.app:id/settings_row_notifications", cls: "com.app.SettingsRow", bounds: "[40,200][1040,360]" }),
    node({ resourceId: "com.app:id/settings_row_privacy",     cls: "com.app.SettingsRow", bounds: "[40,380][1040,540]" }),
  ));
  const a = computeLogicalFingerprint(home, "com.app", "HomeActivity");
  const b = computeLogicalFingerprint(settings, "com.app", "SettingsActivity");
  assert.notEqual(a, b);
});

test("computeLogicalFingerprint: collapses className prefixes (same first-2-segments)", () => {
  // Different exact classNames but same prefix — should produce same fp.
  const a = parseClickableGraph(wrap(
    node({ resourceId: "com.app:id/card", cls: "com.app.FeedCard", bounds: "[40,200][1040,400]" }),
  ));
  const b = parseClickableGraph(wrap(
    node({ resourceId: "com.app:id/card", cls: "com.app.FeedItemView", bounds: "[40,200][1040,400]" }),
  ));
  const fpA = computeLogicalFingerprint(a, "com.app", "HomeActivity");
  const fpB = computeLogicalFingerprint(b, "com.app", "HomeActivity");
  assert.equal(fpA, fpB, "className prefix collapse (com.app) should yield same logical fp");
});
