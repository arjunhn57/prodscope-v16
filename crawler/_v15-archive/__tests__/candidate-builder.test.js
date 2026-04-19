"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { buildCandidates, buildHeuristicCandidates } = require("../candidate-builder");

// ── Mock helpers ────────────────────────────────────────────────────────────

function makeStateGraph(triedKeys = [], badKeys = []) {
  return {
    triedActionsFor: () => new Set(triedKeys),
    badActionsFor: () => new Set(badKeys),
  };
}

function makeCtx(overrides = {}) {
  return {
    screenshotOnlyMode: false,
    visionResult: null,
    packageName: "com.test.app",
    ...overrides,
  };
}

// Minimal XML that produces at least one tap action
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="Login" resource-id="btn_login" class="android.widget.Button"
        package="com.test.app" content-desc="" checkable="false" checked="false"
        clickable="true" enabled="true" focusable="true" focused="false"
        scrollable="false" long-clickable="false" password="false" selected="false"
        bounds="[100,200][300,400]" />
  <node index="1" text="Sign Up" resource-id="btn_signup" class="android.widget.Button"
        package="com.test.app" content-desc="" checkable="false" checked="false"
        clickable="true" enabled="true" focusable="true" focused="false"
        scrollable="false" long-clickable="false" password="false" selected="false"
        bounds="[100,500][300,600]" />
</hierarchy>`;

// ── buildCandidates (XML-primary) ───────────────────────────────────────────

describe("buildCandidates (XML-primary)", () => {
  it("extracts candidates from XML", () => {
    const ctx = makeCtx();
    const snapshot = { xml: SAMPLE_XML };
    const graph = makeStateGraph();
    const result = buildCandidates(ctx, snapshot, "fp_1", graph);
    assert.ok(result.candidates.length >= 2, "Should extract at least 2 tap candidates");
    assert.ok(result.tried instanceof Set);
  });

  it("filters permanently bad actions", () => {
    const ctx = makeCtx();
    const snapshot = { xml: SAMPLE_XML };
    // Extract first to see what keys are generated, then mark one as bad
    const graph1 = makeStateGraph();
    const { candidates: allCandidates } = buildCandidates(ctx, snapshot, "fp_1", graph1);
    assert.ok(allCandidates.length >= 2);

    const badKey = allCandidates[0].key;
    const graph2 = makeStateGraph([], [badKey]);
    const { candidates: filtered } = buildCandidates(ctx, snapshot, "fp_1", graph2);
    assert.strictEqual(filtered.length, allCandidates.length - 1);
    assert.ok(!filtered.some((c) => c.key === badKey));
  });

  it("filters already-tried actions", () => {
    const ctx = makeCtx();
    const snapshot = { xml: SAMPLE_XML };
    const graph1 = makeStateGraph();
    const { candidates: allCandidates } = buildCandidates(ctx, snapshot, "fp_1", graph1);

    const triedKey = allCandidates[0].key;
    const graph2 = makeStateGraph([triedKey]);
    const { candidates: filtered } = buildCandidates(ctx, snapshot, "fp_1", graph2);
    assert.strictEqual(filtered.length, allCandidates.length - 1);
  });

  it("injects vision actions on top of XML candidates", () => {
    const ctx = makeCtx({
      visionResult: {
        mainActions: [
          { x: 500, y: 600, description: "Vision button", priority: "high" },
        ],
      },
    });
    const snapshot = { xml: SAMPLE_XML };
    const graph = makeStateGraph();
    const { candidates } = buildCandidates(ctx, snapshot, "fp_1", graph);
    const visionOnes = candidates.filter((c) => c.visionGuided);
    assert.ok(visionOnes.length >= 1, "Vision actions should be injected");
    // Vision actions should be first (higher priority)
    assert.ok(candidates[0].visionGuided, "Vision action should be first");
  });
});

// ── buildCandidates (vision-primary) ────────────────────────────────────────

describe("buildCandidates (vision-primary)", () => {
  it("uses vision actions when in screenshotOnlyMode", () => {
    const ctx = makeCtx({
      screenshotOnlyMode: true,
      visionResult: {
        mainActions: [
          { x: 100, y: 200, description: "Tap here", priority: "medium" },
          { x: 300, y: 400, description: "Other", priority: "low" },
        ],
      },
    });
    const snapshot = { xml: "" };
    const graph = makeStateGraph();
    const { candidates } = buildCandidates(ctx, snapshot, "fp_1", graph);
    assert.strictEqual(candidates.length, 2);
    assert.ok(candidates.every((c) => c.visionGuided));
  });

  it("falls back to heuristic candidates when no vision result in screenshotOnlyMode", () => {
    const ctx = makeCtx({
      screenshotOnlyMode: true,
      visionResult: null,
    });
    const snapshot = { xml: "" };
    const graph = makeStateGraph();
    const { candidates } = buildCandidates(ctx, snapshot, "fp_1", graph);
    assert.ok(candidates.length > 0, "Should generate heuristic candidates");
    assert.ok(candidates.some((c) => c.key.startsWith("tap:heuristic:")));
  });

  it("returns empty when no vision and not screenshotOnlyMode", () => {
    const ctx = makeCtx({
      screenshotOnlyMode: false,
      visionResult: null,
    });
    const snapshot = { xml: "" };
    const graph = makeStateGraph();
    const { candidates } = buildCandidates(ctx, snapshot, "fp_1", graph);
    assert.strictEqual(candidates.length, 0);
  });
});

// ── buildHeuristicCandidates ────────────────────────────────────────────────

describe("buildHeuristicCandidates", () => {
  it("generates 12 position-based candidates", () => {
    const { candidates } = buildHeuristicCandidates(new Set());
    assert.strictEqual(candidates.length, 12);
  });

  it("all keys start with tap:heuristic:", () => {
    const { candidates } = buildHeuristicCandidates(new Set());
    assert.ok(candidates.every((c) => c.key.startsWith("tap:heuristic:")));
  });

  it("all have priority 30", () => {
    const { candidates } = buildHeuristicCandidates(new Set());
    assert.ok(candidates.every((c) => c.priority === 30));
  });

  it("filters already-tried positions", () => {
    const tried = new Set(["tap:heuristic:540,1200", "tap:heuristic:270,600"]);
    const { candidates } = buildHeuristicCandidates(tried);
    assert.strictEqual(candidates.length, 10);
    assert.ok(!candidates.some((c) => c.key === "tap:heuristic:540,1200"));
  });

  it("includes tab bar positions", () => {
    const { candidates } = buildHeuristicCandidates(new Set());
    const tabKeys = candidates.filter((c) => c.contentDesc.startsWith("heuristic_tab"));
    assert.strictEqual(tabKeys.length, 5);
  });
});
