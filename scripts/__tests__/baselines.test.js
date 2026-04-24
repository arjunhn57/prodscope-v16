"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { compareToBaselines } = require("../baselines");

// ── test fixtures ──────────────────────────────────────────────────────────

function mkApp(label, overrides = {}) {
  return {
    label,
    pkg: `com.test.${label}`,
    note: null,
    stopReason: "max_steps_reached",
    uniqueScreens: 20,
    steps: 25,
    costUsd: 0.02,
    durationMs: 120000,
    driverHits: { ExplorationDriver: 10, LLMFallback: 5 },
    llmFallbackRate: 0.2,
    llmFallbackReasons: {},
    llmModels: {},
    crossedBoundary: true,
    ...overrides,
  };
}

function mkAgg(overrides = {}) {
  return {
    appsAttempted: 2,
    appsIncluded: 2,
    appsSkipped: 0,
    appsCrossedBoundary: 2,
    meanCostUsd: 0.02,
    totalCostUsd: 0.04,
    overallLlmFallbackRate: 0.2,
    durationMs: 240000,
    gates: {},
    ...overrides,
  };
}

const STANDARD_BASELINES = {
  apps: {
    wikipedia: {
      minUniqueScreens: 20,
      maxCostUsd: 0.04,
      maxLlmFallbackRate: 0.3,
      mustCrossBoundary: true,
    },
    biztoso: {
      minUniqueScreens: 14,
      maxCostUsd: 0.04,
      maxLlmFallbackRate: 0.3,
      mustCrossBoundary: true,
    },
  },
  aggregate: {
    maxMeanCostUsd: 0.04,
    maxOverallLlmFallbackRate: 0.3,
    minCrossedBoundaryRatio: 0.8,
  },
};

// ── green path ─────────────────────────────────────────────────────────────

test("compareToBaselines — no regressions on a healthy run", () => {
  const perApp = [mkApp("wikipedia"), mkApp("biztoso", { uniqueScreens: 16 })];
  const regressions = compareToBaselines(perApp, mkAgg(), STANDARD_BASELINES);
  assert.deepEqual(regressions, []);
});

// ── per-app regressions ────────────────────────────────────────────────────

test("compareToBaselines — flags uniqueScreens below minimum", () => {
  const perApp = [mkApp("wikipedia", { uniqueScreens: 10 })];
  const regressions = compareToBaselines(perApp, mkAgg(), STANDARD_BASELINES);
  assert.equal(regressions.length, 1);
  assert.match(regressions[0], /wikipedia.*uniqueScreens=10.*baseline 20/);
});

test("compareToBaselines — flags costUsd above maximum", () => {
  const perApp = [mkApp("biztoso", { costUsd: 0.08, uniqueScreens: 14 })];
  const regressions = compareToBaselines(perApp, mkAgg(), STANDARD_BASELINES);
  assert.equal(regressions.length, 1);
  assert.match(regressions[0], /biztoso.*costUsd=\$0.08.*baseline \$0.04/);
});

test("compareToBaselines — flags llmFallbackRate above maximum", () => {
  const perApp = [mkApp("wikipedia", { llmFallbackRate: 0.45 })];
  const regressions = compareToBaselines(perApp, mkAgg(), STANDARD_BASELINES);
  assert.equal(regressions.length, 1);
  assert.match(regressions[0], /wikipedia.*llmFallbackRate=0.45.*baseline 0.3/);
});

test("compareToBaselines — flags failure to cross first decision boundary", () => {
  const perApp = [mkApp("biztoso", {
    crossedBoundary: false,
    stopReason: "blocked_by_auth:otp_required",
    uniqueScreens: 14,
  })];
  const regressions = compareToBaselines(perApp, mkAgg(), STANDARD_BASELINES);
  assert.equal(regressions.length, 1);
  assert.match(regressions[0], /biztoso.*did not cross.*stopReason=blocked_by_auth:otp_required/);
});

test("compareToBaselines — collects ALL violations for one app, not just the first", () => {
  const perApp = [mkApp("biztoso", {
    uniqueScreens: 5,
    costUsd: 0.20,
    llmFallbackRate: 0.50,
    crossedBoundary: false,
  })];
  const regressions = compareToBaselines(perApp, mkAgg(), STANDARD_BASELINES);
  assert.equal(regressions.length, 4);
});

// ── aggregate regressions ──────────────────────────────────────────────────

test("compareToBaselines — flags aggregate meanCostUsd above maximum", () => {
  const regressions = compareToBaselines(
    [mkApp("wikipedia", { costUsd: 0.03 })],
    mkAgg({ meanCostUsd: 0.10 }),
    STANDARD_BASELINES,
  );
  assert.ok(regressions.some((r) => /aggregate.*meanCostUsd/.test(r)));
});

test("compareToBaselines — flags aggregate overallLlmFallbackRate above maximum", () => {
  const regressions = compareToBaselines(
    [mkApp("wikipedia")],
    mkAgg({ overallLlmFallbackRate: 0.5 }),
    STANDARD_BASELINES,
  );
  assert.ok(regressions.some((r) => /aggregate.*overallLlmFallbackRate/.test(r)));
});

test("compareToBaselines — flags aggregate crossedBoundaryRatio below minimum", () => {
  const regressions = compareToBaselines(
    [mkApp("wikipedia")],
    mkAgg({ appsAttempted: 10, appsCrossedBoundary: 3 }),
    STANDARD_BASELINES,
  );
  assert.ok(regressions.some((r) => /crossedBoundaryRatio/.test(r)));
});

// ── edge cases ─────────────────────────────────────────────────────────────

test("compareToBaselines — skipped apps (with note) cannot regress", () => {
  const perApp = [mkApp("wikipedia", {
    note: "emulator unreachable",
    uniqueScreens: 0,
    costUsd: 0,
  })];
  const regressions = compareToBaselines(perApp, mkAgg(), STANDARD_BASELINES);
  assert.deepEqual(regressions, []);
});

test("compareToBaselines — apps not in baselines pass silently", () => {
  const perApp = [mkApp("chrome", { uniqueScreens: 2, costUsd: 0.15 })];
  const regressions = compareToBaselines(perApp, mkAgg(), STANDARD_BASELINES);
  assert.deepEqual(regressions, []);
});

test("compareToBaselines — empty baselines never reports regressions", () => {
  const perApp = [mkApp("wikipedia", { uniqueScreens: 1 })];
  const regressions = compareToBaselines(perApp, mkAgg(), {});
  assert.deepEqual(regressions, []);
});

// ── baseline file integrity ────────────────────────────────────────────────

test("scripts/golden-suite-baselines.json is valid and enforces required shape", () => {
  const filePath = path.resolve(__dirname, "..", "golden-suite-baselines.json");
  const contents = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(contents);
  assert.ok(parsed.apps, "baselines must have an apps map");
  assert.ok(parsed.apps.biztoso, "baselines must include biztoso");
  assert.ok(parsed.apps.wikipedia, "baselines must include wikipedia");
  assert.equal(parsed.apps.wikipedia.minUniqueScreens, 20);
  assert.equal(parsed.apps.biztoso.minUniqueScreens, 14);
  assert.ok(parsed.aggregate, "baselines must have an aggregate block");
  assert.equal(parsed.aggregate.maxMeanCostUsd, 0.04);
});
