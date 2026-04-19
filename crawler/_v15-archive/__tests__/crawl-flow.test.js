"use strict";

/**
 * Integration test for the crawl pipeline.
 *
 * Validates data flow from CrawlContext → StateGraph → assembleReport,
 * using real StateGraph but mocked ADB/API. Verifies:
 *   1. CrawlContext initializes correctly
 *   2. StateGraph builds as screens are discovered
 *   3. assembleReport produces valid output structure
 *   4. Quality tiers (full/degraded/minimal) work correctly
 *   5. Stop reason flows through correctly
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Suppress console.log during tests
const origLog = console.log;
beforeEach(() => { console.log = () => {}; });
process.on("exit", () => { console.log = origLog; });

// ---------------------------------------------------------------------------
// Real modules under test
// ---------------------------------------------------------------------------
const { StateGraph } = require("../../crawler/graph");
const { CrawlContext } = require("../../crawler/crawl-context");
const { assembleReport } = require("../../crawler/report-assembler");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "prodscope-test-"));
}

function simulateScreenDiscovery(graph, ctx, count) {
  for (let i = 0; i < count; i++) {
    const fp = `fp_screen_${i}`;
    const xml = `<hierarchy><node package="com.test.app" text="Screen ${i}" /></hierarchy>`;
    const screen = {
      index: i,
      step: i,
      screenshotPath: `${ctx.screenshotDir}/step_${i}.png`,
      activity: `com.test.app/.Screen${i}Activity`,
      timestamp: Date.now() + i * 1000,
      xml,
      screenType: i === 0 ? "login" : "content",
      feature: i === 0 ? "auth_flow" : "browsing",
      fuzzyFp: fp,
    };
    ctx.screens.push(screen);

    // Register in state graph (real API: addState)
    graph.addState(fp, screen);

    // Add transitions between consecutive screens (real API: fromFp, actionKey, toFp)
    if (i > 0) {
      const prevFp = `fp_screen_${i - 1}`;
      graph.addTransition(prevFp, `tap:btn_${i}:200,${300 + i * 50}`, fp);
    }

    ctx.actionsTaken.push({
      step: i,
      type: "tap",
      key: `tap:btn_${i}:200,${300 + i * 50}`,
      fromFp: i > 0 ? `fp_screen_${i - 1}` : null,
      toFp: fp,
    });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CrawlContext initialization", () => {
  it("initializes with required config fields", () => {
    const tmpDir = makeTempDir();
    try {
      const ctx = new CrawlContext({
        screenshotDir: tmpDir,
        packageName: "com.test.app",
        credentials: { email: "test@test.com", password: "pass123" },
        maxSteps: 80,
      });

      assert.strictEqual(ctx.packageName, "com.test.app");
      assert.strictEqual(ctx.maxSteps, 80);
      assert.strictEqual(ctx.hasValidCredentials, true);
      assert.deepStrictEqual(ctx.screens, []);
      assert.deepStrictEqual(ctx.actionsTaken, []);
      assert.strictEqual(ctx.stopReason, "max_steps_reached");
      assert.strictEqual(ctx.globalRecoveryAttempts, 0);
      assert.ok(ctx.authMachine, "authMachine should be initialized");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles missing credentials gracefully", () => {
    const tmpDir = makeTempDir();
    try {
      const ctx = new CrawlContext({
        screenshotDir: tmpDir,
        packageName: "com.test.app",
        credentials: {},
        maxSteps: 20,
      });
      assert.strictEqual(ctx.hasValidCredentials, false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("StateGraph building", () => {
  it("tracks unique states correctly", () => {
    const graph = new StateGraph();
    graph.addState("fp_a", { activity: "Activity1" });
    graph.addState("fp_b", { activity: "Activity2" });
    graph.addState("fp_c", { activity: "Activity3" });

    assert.strictEqual(graph.uniqueStateCount(), 3);
  });

  it("does not double-count revisited states", () => {
    const graph = new StateGraph();
    graph.addState("fp_a", { activity: "Activity1" });
    graph.addState("fp_b", { activity: "Activity2" });
    graph.addState("fp_a", { activity: "Activity1" }); // revisit

    assert.strictEqual(graph.uniqueStateCount(), 2);
  });

  it("records transitions between screens", () => {
    const graph = new StateGraph();
    graph.addState("fp_a", { activity: "A" });
    graph.addState("fp_b", { activity: "B" });
    graph.addTransition("fp_a", "tap:btn:100,200", "fp_b");

    assert.strictEqual(graph.transitions.length, 1);
    assert.strictEqual(graph.transitions[0].from, "fp_a");
    assert.strictEqual(graph.transitions[0].to, "fp_b");
  });

  it("toJSON returns serializable structure", () => {
    const graph = new StateGraph();
    graph.addState("fp_a", { activity: "A" });
    graph.addState("fp_b", { activity: "B" });
    graph.addTransition("fp_a", "tap:btn:100,200", "fp_b");

    const json = graph.toJSON();
    assert.ok(json.nodes, "Should have nodes");
    assert.ok(json.edges || json.transitions, "Should have edges/transitions");

    // Verify JSON roundtrip works
    const serialized = JSON.stringify(json);
    const parsed = JSON.parse(serialized);
    assert.ok(parsed);
  });

  it("visit count increments on revisit", () => {
    const graph = new StateGraph();
    graph.addState("fp_a", { activity: "A" });
    graph.addState("fp_a", { activity: "A" }); // revisit
    graph.addState("fp_a", { activity: "A" }); // revisit again

    assert.strictEqual(graph.visitCount("fp_a"), 3);
  });
});

describe("assembleReport — full pipeline", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces valid report with 15+ screens (full quality)", () => {
    const ctx = new CrawlContext({
      screenshotDir: tmpDir,
      packageName: "com.test.app",
      credentials: {},
      maxSteps: 80,
    });

    const graph = new StateGraph();
    ctx.stateGraph = graph;
    ctx.recoveryManager = { getStats: () => ({}) };
    ctx.coverageTracker = { summary: () => ({ totalFeatures: 5, covered: 4 }) };
    ctx.flowTracker = { getFlows: () => [] };
    ctx.metrics = { summary: () => ({ duration: 120, avgStepTime: 8 }) };
    ctx.oracleFindingsByStep = {};
    ctx.stopReason = "max_steps_reached";

    simulateScreenDiscovery(graph, ctx, 18);

    const result = assembleReport(ctx);

    // Structure validation
    assert.ok(result.screens, "Should have screens");
    assert.strictEqual(result.screens.length, 18);
    assert.ok(result.graph, "Should have graph");
    assert.ok(result.stats, "Should have stats");
    assert.ok(result.actionsTaken, "Should have actionsTaken");

    // Stats validation
    assert.strictEqual(result.stats.totalSteps, 18);
    assert.strictEqual(result.stats.uniqueStates, 18);
    assert.ok(result.stats.totalTransitions >= 17, "Should have at least 17 transitions");

    // Quality tier
    assert.strictEqual(result.crawlQuality, "full", "18 unique states should be 'full'");

    // Stop reason flows through
    assert.strictEqual(result.stopReason, "max_steps_reached");

    // Screen data shape
    const screen = result.screens[0];
    assert.ok(screen.index !== undefined);
    assert.ok(screen.step !== undefined);
    assert.ok(screen.path);
    assert.ok(screen.activity);
    assert.ok(screen.timestamp);
    assert.ok(screen.screenType);
    assert.ok(screen.feature);

    // Artifact file saved
    const artifactPath = path.join(tmpDir, "crawl_artifacts.json");
    assert.ok(fs.existsSync(artifactPath), "Artifacts should be saved to disk");
    const saved = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    assert.strictEqual(saved.screens.length, 18);
  });

  it("produces degraded quality with 5-14 screens", () => {
    const ctx = new CrawlContext({
      screenshotDir: tmpDir,
      packageName: "com.test.app",
      credentials: {},
      maxSteps: 80,
    });

    const graph = new StateGraph();
    ctx.stateGraph = graph;
    ctx.recoveryManager = { getStats: () => ({}) };
    ctx.coverageTracker = null;
    ctx.flowTracker = null;
    ctx.metrics = { summary: () => ({}) };
    ctx.oracleFindingsByStep = {};
    ctx.stopReason = "stuck_detected";

    simulateScreenDiscovery(graph, ctx, 8);

    const result = assembleReport(ctx);

    assert.strictEqual(result.crawlQuality, "degraded");
    assert.strictEqual(result.stats.uniqueStates, 8);
    assert.strictEqual(result.stopReason, "stuck_detected");
  });

  it("produces minimal quality with < 5 screens", () => {
    const ctx = new CrawlContext({
      screenshotDir: tmpDir,
      packageName: "com.test.app",
      credentials: {},
      maxSteps: 80,
    });

    const graph = new StateGraph();
    ctx.stateGraph = graph;
    ctx.recoveryManager = { getStats: () => ({}) };
    ctx.coverageTracker = null;
    ctx.flowTracker = null;
    ctx.metrics = { summary: () => ({}) };
    ctx.oracleFindingsByStep = {};
    ctx.stopReason = "auth_required_no_guest";

    simulateScreenDiscovery(graph, ctx, 3);

    const result = assembleReport(ctx);

    assert.strictEqual(result.crawlQuality, "minimal");
    assert.strictEqual(result.stats.uniqueStates, 3);
    assert.strictEqual(result.stopReason, "auth_required_no_guest");
  });

  it("includes oracle findings in report", () => {
    const ctx = new CrawlContext({
      screenshotDir: tmpDir,
      packageName: "com.test.app",
      credentials: {},
      maxSteps: 80,
    });

    const graph = new StateGraph();
    ctx.stateGraph = graph;
    ctx.recoveryManager = { getStats: () => ({}) };
    ctx.coverageTracker = null;
    ctx.flowTracker = null;
    ctx.metrics = { summary: () => ({}) };
    ctx.oracleFindingsByStep = {
      3: [
        { type: "crash", severity: "critical", description: "App crashed on screen 3" },
      ],
      7: [
        { type: "slow_load", severity: "warning", description: "Screen 7 took 5s to load" },
      ],
    };
    ctx.stopReason = "max_steps_reached";

    simulateScreenDiscovery(graph, ctx, 10);

    const result = assembleReport(ctx);

    assert.strictEqual(result.oracleFindings.length, 2);
    assert.ok(result.oracleFindings.some((f) => f.type === "crash"));
    assert.ok(result.oracleFindings.some((f) => f.type === "slow_load"));
  });

  it("calls onProgress with analyzing phase", () => {
    let progressCalled = false;
    let progressData = null;

    const ctx = new CrawlContext({
      screenshotDir: tmpDir,
      packageName: "com.test.app",
      credentials: {},
      maxSteps: 80,
      onProgress: (data) => {
        progressCalled = true;
        progressData = data;
      },
    });

    const graph = new StateGraph();
    ctx.stateGraph = graph;
    ctx.recoveryManager = { getStats: () => ({}) };
    ctx.coverageTracker = null;
    ctx.flowTracker = null;
    ctx.metrics = { summary: () => ({}) };
    ctx.oracleFindingsByStep = {};
    ctx.stopReason = "max_steps_reached";

    simulateScreenDiscovery(graph, ctx, 5);

    assembleReport(ctx);

    assert.strictEqual(progressCalled, true, "onProgress should be called");
    assert.strictEqual(progressData.phase, "analyzing");
    assert.strictEqual(progressData.packageName, "com.test.app");
  });
});

describe("CrawlContext + StateGraph — recovery stats flow", () => {
  it("recovery stats appear in assembled report", () => {
    const tmpDir = makeTempDir();
    try {
      const ctx = new CrawlContext({
        screenshotDir: tmpDir,
        packageName: "com.test.app",
        credentials: {},
        maxSteps: 80,
      });

      const graph = new StateGraph();
      ctx.stateGraph = graph;
      ctx.recoveryManager = {
        getStats: () => ({
          soft_back: { attempts: 3, successes: 2 },
          relaunch_branch: { attempts: 1, successes: 1 },
        }),
      };
      ctx.coverageTracker = null;
      ctx.flowTracker = null;
      ctx.metrics = { summary: () => ({}) };
      ctx.oracleFindingsByStep = {};

      simulateScreenDiscovery(graph, ctx, 5);

      const result = assembleReport(ctx);

      assert.deepStrictEqual(result.stats.recoveryStats, {
        soft_back: { attempts: 3, successes: 2 },
        relaunch_branch: { attempts: 1, successes: 1 },
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("End-to-end data flow: context → graph → report", () => {
  it("simulates a 20-step crawl with correct data flow", () => {
    const tmpDir = makeTempDir();
    try {
      // Step 1: Initialize context (like runner.js would)
      const ctx = new CrawlContext({
        screenshotDir: tmpDir,
        packageName: "com.biztoso",
        credentials: { email: "user@test.com", password: "pass123" },
        goals: "Test login flow",
        painPoints: "Slow loading",
        maxSteps: 80,
      });

      assert.strictEqual(ctx.hasValidCredentials, true);

      // Step 2: Create and attach state graph (like run.js would)
      const graph = new StateGraph();
      ctx.stateGraph = graph;
      ctx.recoveryManager = { getStats: () => ({}) };
      ctx.coverageTracker = { summary: () => ({ totalFeatures: 5, covered: 3 }) };
      ctx.flowTracker = { getFlows: () => [{ name: "login", steps: 4 }] };
      ctx.metrics = {
        summary: (input) => ({
          duration: 180,
          avgStepTime: 9,
          totalSteps: input.totalSteps,
        }),
      };
      ctx.oracleFindingsByStep = {};

      // Step 3: Simulate discovery (like the crawl loop would)
      simulateScreenDiscovery(graph, ctx, 20);
      ctx.stopReason = "max_steps_reached";

      // Step 4: Assemble report (like run.js ending)
      const result = assembleReport(ctx);

      // Verify complete data chain
      assert.strictEqual(result.screens.length, 20, "All 20 screens");
      assert.strictEqual(result.stats.uniqueStates, 20, "20 unique states");
      assert.strictEqual(result.stats.totalTransitions, 19, "19 transitions");
      assert.strictEqual(result.crawlQuality, "full", "20 screens = full quality");
      assert.strictEqual(result.stopReason, "max_steps_reached");
      assert.ok(result.graph, "Graph serialized");
      assert.ok(result.coverage, "Coverage included");
      assert.deepStrictEqual(result.flows, [{ name: "login", steps: 4 }]);
      assert.strictEqual(result.metrics.totalSteps, 20);

      // Verify artifact on disk
      const artifactPath = path.join(tmpDir, "crawl_artifacts.json");
      assert.ok(fs.existsSync(artifactPath));
      const onDisk = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      assert.strictEqual(onDisk.screens.length, 20);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
