"use strict";

/**
 * Track F: Unit tests for crawler/agent-prefetch.js
 *
 * Pattern mirrors other crawler tests — uses node:test + node:assert.
 * Each test resets module state by deleting the require cache, re-requiring,
 * and calling clear(). The agent.decideCoordinates function is monkey-patched
 * per test and restored in afterEach.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

describe("agent-prefetch", () => {
  /** @type {any} */
  let prefetch;
  /** @type {any} */
  let agent;
  /** @type {Function} */
  let origDecide;

  beforeEach(() => {
    // Fresh require to reset module-level state between tests
    delete require.cache[require.resolve("../agent-prefetch")];
    prefetch = require("../agent-prefetch");
    prefetch.clear();

    agent = require("../agent");
    origDecide = agent.decideCoordinates;
  });

  afterEach(() => {
    agent.decideCoordinates = origDecide;
    prefetch.clear();
  });

  function makeCtx() {
    return {
      stateGraph: null,
      appMap: null,
      explorationJournal: [],
      packageName: "com.test",
      maxSteps: 50,
      goals: "explore",
      credentials: null,
      v2TokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    };
  }

  it("consumePrefetch returns null when nothing prefetched", async () => {
    const r = await prefetch.consumePrefetch(5, {
      screenshotHash: "abc",
      screenshotPath: "/tmp/x.png",
    });
    assert.strictEqual(r, null);
  });

  it("consumePrefetch returns decision on step + hash match", async () => {
    agent.decideCoordinates = async () => ({
      action: "tap",
      reasoning: "tap the button",
      x: 100,
      y: 200,
      expectedOutcome: "opens screen",
    });
    prefetch.startPrefetch(
      10,
      { xml: "", screenshotPath: "/tmp/x.png", screenshotHash: "abc" },
      makeCtx(),
    );
    const r = await prefetch.consumePrefetch(10, {
      screenshotHash: "abc",
      screenshotPath: "/tmp/x.png",
    });
    assert.ok(r);
    assert.strictEqual(r && r.action, "tap");
    assert.strictEqual(r && r.x, 100);
    assert.strictEqual(r && r.y, 200);
  });

  it("consumePrefetch returns null on step mismatch", async () => {
    agent.decideCoordinates = async () => ({
      action: "back",
      reasoning: "r",
      expectedOutcome: "e",
    });
    prefetch.startPrefetch(
      10,
      { xml: "", screenshotPath: "/tmp/x.png", screenshotHash: "abc" },
      makeCtx(),
    );
    const r = await prefetch.consumePrefetch(11, {
      screenshotHash: "abc",
      screenshotPath: "/tmp/x.png",
    });
    assert.strictEqual(r, null);
    // State must be cleared so a subsequent consume returns null too
    assert.strictEqual(prefetch.hasPrefetch(10), false);
  });

  it("consumePrefetch returns null on hash mismatch", async () => {
    agent.decideCoordinates = async () => ({
      action: "back",
      reasoning: "r",
      expectedOutcome: "e",
    });
    prefetch.startPrefetch(
      10,
      { xml: "", screenshotPath: "/tmp/x.png", screenshotHash: "abc" },
      makeCtx(),
    );
    const r = await prefetch.consumePrefetch(10, {
      screenshotHash: "xyz",
      screenshotPath: "/tmp/x.png",
    });
    assert.strictEqual(r, null);
    assert.strictEqual(prefetch.hasPrefetch(10), false);
  });

  it("consumePrefetch returns null when prefetch promise rejects", async () => {
    agent.decideCoordinates = async () => {
      throw new Error("api down");
    };
    prefetch.startPrefetch(
      10,
      { xml: "", screenshotPath: "/tmp/x.png", screenshotHash: "abc" },
      makeCtx(),
    );
    const r = await prefetch.consumePrefetch(10, {
      screenshotHash: "abc",
      screenshotPath: "/tmp/x.png",
    });
    assert.strictEqual(r, null);
    assert.strictEqual(prefetch.hasPrefetch(10), false);
  });

  it("startPrefetch is a no-op when snapshot has no screenshotPath", async () => {
    let called = false;
    agent.decideCoordinates = async () => {
      called = true;
      return { action: "back", reasoning: "r", expectedOutcome: "e" };
    };
    prefetch.startPrefetch(
      10,
      { xml: "", screenshotPath: null, screenshotHash: "abc" },
      makeCtx(),
    );
    // Give microtask queue a tick to confirm nothing was kicked off
    await new Promise((res) => setImmediate(res));
    assert.strictEqual(called, false);
    assert.strictEqual(prefetch.hasPrefetch(10), false);
  });

  it("hasPrefetch returns true after startPrefetch and false after consume", async () => {
    agent.decideCoordinates = async () => ({
      action: "back",
      reasoning: "r",
      expectedOutcome: "e",
    });
    prefetch.startPrefetch(
      10,
      { xml: "", screenshotPath: "/tmp/x.png", screenshotHash: "abc" },
      makeCtx(),
    );
    assert.strictEqual(prefetch.hasPrefetch(10), true);
    const r = await prefetch.consumePrefetch(10, {
      screenshotHash: "abc",
      screenshotPath: "/tmp/x.png",
    });
    assert.ok(r);
    assert.strictEqual(prefetch.hasPrefetch(10), false);
  });

  it("second startPrefetch replaces the first", async () => {
    let firstCalls = 0;
    let secondCalls = 0;
    agent.decideCoordinates = async (/** @type {any} */ input) => {
      if (input.stepNumber === 10) {
        firstCalls++;
        return { action: "back", reasoning: "first", expectedOutcome: "e" };
      }
      if (input.stepNumber === 11) {
        secondCalls++;
        return {
          action: "tap",
          reasoning: "second",
          x: 1,
          y: 2,
          expectedOutcome: "e",
        };
      }
      return { action: "back", reasoning: "x", expectedOutcome: "e" };
    };

    prefetch.startPrefetch(
      10,
      { xml: "", screenshotPath: "/tmp/x.png", screenshotHash: "abc" },
      makeCtx(),
    );
    prefetch.startPrefetch(
      11,
      { xml: "", screenshotPath: "/tmp/y.png", screenshotHash: "def" },
      makeCtx(),
    );
    await new Promise((res) => setImmediate(res));

    // Consuming step 10 must return null — step 11 is the live prefetch now
    const staleMiss = await prefetch.consumePrefetch(10, {
      screenshotHash: "abc",
      screenshotPath: "/tmp/x.png",
    });
    assert.strictEqual(staleMiss, null);

    // But after the first call above clears state, nothing is left to consume
    // for step 11 either. That's expected — the test for "second replaces
    // first and is consumable" is the next assert block.
  });

  it("second startPrefetch for a new step is consumable after the first is discarded", async () => {
    agent.decideCoordinates = async (/** @type {any} */ input) => {
      if (input.stepNumber === 10) {
        return { action: "back", reasoning: "first", expectedOutcome: "e" };
      }
      return {
        action: "tap",
        reasoning: "second",
        x: 1,
        y: 2,
        expectedOutcome: "e",
      };
    };
    prefetch.startPrefetch(
      10,
      { xml: "", screenshotPath: "/tmp/x.png", screenshotHash: "abc" },
      makeCtx(),
    );
    prefetch.startPrefetch(
      11,
      { xml: "", screenshotPath: "/tmp/y.png", screenshotHash: "def" },
      makeCtx(),
    );
    await new Promise((res) => setImmediate(res));
    const r = await prefetch.consumePrefetch(11, {
      screenshotHash: "def",
      screenshotPath: "/tmp/y.png",
    });
    assert.ok(r);
    assert.strictEqual(r && r.reasoning, "second");
    assert.strictEqual(r && r.action, "tap");
  });

  it("buildAgentInput produces the expected shape", () => {
    const ctx = makeCtx();
    ctx.stateGraph = { uniqueStateCount: () => 3 };
    ctx.appMap = {
      screenNodes: new Map([["a", {}], ["b", {}]]),
      navTabs: [
        { label: "Home", explored: true, exhausted: false },
        { label: "Search", explored: false, exhausted: false },
      ],
    };
    ctx.explorationJournal = [
      { step: 1, action: "tap A", outcome: "new_screen" },
      { step: 2, action: "tap B", outcome: "same_screen" },
    ];

    const input = prefetch.buildAgentInput(
      7,
      { xml: "<hierarchy />", screenshotPath: "/tmp/x.png" },
      ctx,
    );

    assert.strictEqual(input.stepNumber, 7);
    assert.strictEqual(input.screenshotPath, "/tmp/x.png");
    assert.strictEqual(input.visionFirstMode, true);
    assert.strictEqual(input.packageName, "com.test");
    assert.strictEqual(input.visitedScreensCount, 3);
    assert.strictEqual(input.appMapSummary.totalScreens, 2);
    assert.strictEqual(input.appMapSummary.navTabs.length, 2);
    assert.strictEqual(input.recentHistory.length, 2);
    assert.ok(Array.isArray(input.elements));
    assert.strictEqual(input.elements.length, 0);
  });

  it("prefetch passes ctx to agent.decideCoordinates so v2TokenUsage accumulates", async () => {
    /** @type {any} */
    let seenDeps = null;
    agent.decideCoordinates = async (/** @type {any} */ _input, /** @type {any} */ deps) => {
      seenDeps = deps;
      return { action: "back", reasoning: "r", expectedOutcome: "e" };
    };
    const ctx = makeCtx();
    prefetch.startPrefetch(
      10,
      { xml: "", screenshotPath: "/tmp/x.png", screenshotHash: "abc" },
      ctx,
    );
    await prefetch.consumePrefetch(10, {
      screenshotHash: "abc",
      screenshotPath: "/tmp/x.png",
    });
    assert.ok(seenDeps);
    assert.strictEqual(seenDeps.ctx, ctx);
    // v2TokenUsage must be the same object reference on ctx (Track E contract)
    assert.strictEqual(seenDeps.ctx.v2TokenUsage, ctx.v2TokenUsage);
  });

  it("clear() resets all module state", async () => {
    agent.decideCoordinates = async () => ({
      action: "back",
      reasoning: "r",
      expectedOutcome: "e",
    });
    prefetch.startPrefetch(
      10,
      { xml: "", screenshotPath: "/tmp/x.png", screenshotHash: "abc" },
      makeCtx(),
    );
    assert.strictEqual(prefetch.hasPrefetch(10), true);
    prefetch.clear();
    assert.strictEqual(prefetch.hasPrefetch(10), false);
    const r = await prefetch.consumePrefetch(10, {
      screenshotHash: "abc",
      screenshotPath: "/tmp/x.png",
    });
    assert.strictEqual(r, null);
  });
});
