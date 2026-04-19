"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const { adjustPriorities } = require("../priority-adjustments");

// Suppress console.log during tests
const origLog = console.log;
beforeEach(() => { console.log = () => {}; });
process.on("exit", () => { console.log = origLog; });

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const ACTION_TYPES = {
  TAP: "tap",
  TYPE: "type",
  SCROLL_DOWN: "scroll_down",
  SCROLL_UP: "scroll_up",
  BACK: "back",
  LONG_PRESS: "long_press",
};

function makeCandidate(overrides = {}) {
  return {
    type: ACTION_TYPES.TAP,
    key: `tap_${Math.random().toString(36).slice(2, 6)}`,
    x: 200,
    y: 400,
    text: "Button",
    contentDesc: "",
    priority: 50,
    ...overrides,
  };
}

const noop = () => {};
const noopLog = { info: noop, warn: noop, error: noop, debug: noop, child: () => noopLog };

function makeCtx(overrides = {}) {
  return {
    packageName: "com.test.app",
    homeFingerprint: "fp_home",
    lastNewScreenFp: null,
    actionsOnNewScreen: 0,
    log: noopLog,
    authMachine: {
      isActive: false,
      isTerminal: false,
      hasCredentials: false,
      state: "IDLE",
      fillCount: 0,
    },
    authResolved: false,
    filledFingerprints: new Set(),
    credentials: {},
    plan: null,
    visitedCounts: new Map(),
    recoveryManager: {
      recover: async () => ({
        strategy: "soft_back",
        success: false,
        newFp: null,
        attempts: 1,
        reason: "mock",
      }),
    },
    modeManager: {
      budgetUsedPercent: () => 0.5,
    },
    appState: {
      isDestructiveAction: () => false,
    },
    ...overrides,
  };
}

function makeParams(overrides = {}) {
  return {
    fp: "fp_current",
    classification: { type: "content", feature: "feed" },
    screenIntent: { type: "content" },
    step: 5,
    maxSteps: 80,
    primaryPackage: "com.test.app",
    stateGraph: {
      visitCount: () => 1,
    },
    tried: new Set(),
    snapshot: {},
    planBoost: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("suppressType", () => {
  it("removes TYPE actions on non-auth, non-form screens when TAP exists", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1" }),
      makeCandidate({ type: ACTION_TYPES.TYPE, key: "type1", text: "Search" }),
    ];
    const ctx = makeCtx();
    const params = makeParams({ classification: { type: "content" } });
    const result = await adjustPriorities(candidates, ctx, params);
    const hasType = result.candidates.some((a) => a.type === ACTION_TYPES.TYPE);
    assert.strictEqual(hasType, false, "TYPE actions should be suppressed on content screens");
  });

  it("keeps TYPE actions on search screens", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1" }),
      makeCandidate({ type: ACTION_TYPES.TYPE, key: "type1", text: "Search" }),
    ];
    const ctx = makeCtx();
    const params = makeParams({ classification: { type: "search" } });
    const result = await adjustPriorities(candidates, ctx, params);
    const hasType = result.candidates.some((a) => a.type === ACTION_TYPES.TYPE);
    assert.strictEqual(hasType, true, "TYPE actions should be kept on search screens");
  });

  it("keeps TYPE actions when auth machine is active (suppressType pass)", async () => {
    // suppressType keeps TYPE when auth is active, but handleAuthFlowPriority
    // later filters TYPE in auth flows. Set authResolved=true to isolate suppressType.
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1" }),
      makeCandidate({ type: ACTION_TYPES.TYPE, key: "type1", text: "Email" }),
    ];
    const ctx = makeCtx({
      authMachine: { isActive: true, isTerminal: false, hasCredentials: false },
      authResolved: true, // skip auth flow priority pass to isolate suppressType
    });
    const params = makeParams();
    const result = await adjustPriorities(candidates, ctx, params);
    const hasType = result.candidates.some((a) => a.type === ACTION_TYPES.TYPE);
    assert.strictEqual(hasType, true, "TYPE actions should survive suppressType when auth is active");
  });

  it("keeps only 1 TYPE action on form screens", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TYPE, key: "type1", text: "Name" }),
      makeCandidate({ type: ACTION_TYPES.TYPE, key: "type2", text: "Email" }),
      makeCandidate({ type: ACTION_TYPES.TYPE, key: "type3", text: "Phone" }),
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1" }),
    ];
    const ctx = makeCtx();
    const params = makeParams({ classification: { type: "form" } });
    const result = await adjustPriorities(candidates, ctx, params);
    const typeCount = result.candidates.filter((a) => a.type === ACTION_TYPES.TYPE).length;
    assert.strictEqual(typeCount, 1, "Only 1 TYPE action should remain on form screens");
  });
});

describe("handleSparseScreen", () => {
  it("triggers recovery when only BACK available on in-app screen", async () => {
    let recoverCalled = false;
    const candidates = [makeCandidate({ type: ACTION_TYPES.BACK, key: "back" })];
    const ctx = makeCtx({
      recoveryManager: {
        recover: async () => {
          recoverCalled = true;
          return { strategy: "soft_back", success: false, newFp: null, attempts: 1, reason: "mock" };
        },
      },
    });
    const params = makeParams({ primaryPackage: "com.test.app" });
    const result = await adjustPriorities(candidates, ctx, params);
    assert.strictEqual(recoverCalled, true, "Recovery should be triggered");
    assert.strictEqual(result.shouldContinue, true, "Should continue after first sparse attempt");
  });

  it("stops after persistent sparse screen", async () => {
    const candidates = [makeCandidate({ type: ACTION_TYPES.BACK, key: "back" })];
    const ctx = makeCtx();
    // Pre-set sparse count to 2 so next call (3rd) triggers break
    ctx.visitedCounts.set("sparse::fp_current", 2);
    const params = makeParams();
    const result = await adjustPriorities(candidates, ctx, params);
    assert.strictEqual(result.shouldBreak, true, "Should break after persistent sparse screen");
  });

  it("does not trigger for screens with multiple candidates", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1" }),
      makeCandidate({ type: ACTION_TYPES.BACK, key: "back" }),
    ];
    const ctx = makeCtx();
    const params = makeParams();
    const result = await adjustPriorities(candidates, ctx, params);
    assert.strictEqual(result.shouldBreak, false, "Should not break with multiple candidates");
  });
});

describe("deprioritizeContentCreation", () => {
  it("reduces priority during early exploration on content_creation screens", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1", priority: 90 }),
    ];
    const ctx = makeCtx();
    const params = makeParams({
      classification: { type: "content", feature: "content_creation" },
      step: 5,
      maxSteps: 80,
    });
    const result = await adjustPriorities(candidates, ctx, params);
    const tap = result.candidates.find((a) => a.key === "tap1");
    assert.ok(tap.priority < 90, "TAP priority should be reduced on content_creation early");
  });

  it("does not reduce priority in late exploration", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1", priority: 90 }),
    ];
    const ctx = makeCtx();
    const params = makeParams({
      classification: { type: "content", feature: "content_creation" },
      step: 60,
      maxSteps: 80,
    });
    const result = await adjustPriorities(candidates, ctx, params);
    const tap = result.candidates.find((a) => a.key === "tap1");
    assert.strictEqual(tap.priority, 90, "Priority should not change in late exploration");
  });
});

describe("adjustHomeScreen", () => {
  it("suppresses BACK on home screen", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1" }),
      makeCandidate({ type: ACTION_TYPES.BACK, key: "back" }),
    ];
    const ctx = makeCtx();
    const params = makeParams({ fp: "fp_home" });
    const result = await adjustPriorities(candidates, ctx, params);
    const hasBack = result.candidates.some((a) => a.type === ACTION_TYPES.BACK);
    assert.strictEqual(hasBack, false, "BACK should be suppressed on home screen");
  });

  it("does not suppress BACK on non-home screens", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1" }),
      makeCandidate({ type: ACTION_TYPES.BACK, key: "back" }),
    ];
    const ctx = makeCtx();
    const params = makeParams({ fp: "fp_other" });
    const result = await adjustPriorities(candidates, ctx, params);
    const hasBack = result.candidates.some((a) => a.type === ACTION_TYPES.BACK);
    assert.strictEqual(hasBack, true, "BACK should be kept on non-home screens");
  });

  it("boosts scroll when all taps tried on home screen", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1" }),
      makeCandidate({ type: ACTION_TYPES.SCROLL_DOWN, key: "scroll_down_1", priority: 30 }),
    ];
    const tried = new Set(["tap1"]); // tap1 is tried
    const ctx = makeCtx();
    const params = makeParams({
      fp: "fp_home",
      tried,
      stateGraph: { visitCount: () => 5 }, // visited > 3 times
    });
    const result = await adjustPriorities(candidates, ctx, params);
    const scroll = result.candidates.find((a) => a.type === ACTION_TYPES.SCROLL_DOWN);
    assert.ok(scroll.priority > 30, "Scroll priority should be boosted when all taps tried");
  });
});

describe("forceNewScreenExploration", () => {
  it("removes BACK when on a new screen with < 2 actions taken", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1" }),
      makeCandidate({ type: ACTION_TYPES.BACK, key: "back" }),
    ];
    const ctx = makeCtx({ lastNewScreenFp: "fp_current", actionsOnNewScreen: 0 });
    const params = makeParams({ fp: "fp_current" });
    const result = await adjustPriorities(candidates, ctx, params);
    const hasBack = result.candidates.some((a) => a.type === ACTION_TYPES.BACK);
    assert.strictEqual(hasBack, false, "BACK should be suppressed on new screens");
  });

  it("allows BACK after 2 actions on new screen", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1" }),
      makeCandidate({ type: ACTION_TYPES.BACK, key: "back" }),
    ];
    const ctx = makeCtx({ lastNewScreenFp: "fp_current", actionsOnNewScreen: 2 });
    const params = makeParams({ fp: "fp_current" });
    const result = await adjustPriorities(candidates, ctx, params);
    const hasBack = result.candidates.some((a) => a.type === ACTION_TYPES.BACK);
    assert.strictEqual(hasBack, true, "BACK should be allowed after 2 actions");
  });

  it("does not affect non-new screens", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1" }),
      makeCandidate({ type: ACTION_TYPES.BACK, key: "back" }),
    ];
    const ctx = makeCtx({ lastNewScreenFp: "fp_other", actionsOnNewScreen: 0 });
    const params = makeParams({ fp: "fp_current" });
    const result = await adjustPriorities(candidates, ctx, params);
    const hasBack = result.candidates.some((a) => a.type === ACTION_TYPES.BACK);
    assert.strictEqual(hasBack, true, "BACK should be kept on non-new screens");
  });
});

describe("deprioritizeHomeButton", () => {
  it("reduces Home button priority after many home visits", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "home_btn", text: "Home", priority: 80 }),
      makeCandidate({ type: ACTION_TYPES.TAP, key: "tap1", text: "Profile", priority: 50 }),
    ];
    const ctx = makeCtx();
    const params = makeParams({
      stateGraph: { visitCount: (fp) => (fp === "fp_home" ? 5 : 1) },
    });
    const result = await adjustPriorities(candidates, ctx, params);
    const home = result.candidates.find((a) => a.key === "home_btn");
    assert.ok(home.priority < 80, "Home button priority should be reduced");
  });

  it("does not reduce Home button priority with few visits", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "home_btn", text: "Home", priority: 80 }),
    ];
    const ctx = makeCtx();
    const params = makeParams({
      stateGraph: { visitCount: () => 2 },
    });
    const result = await adjustPriorities(candidates, ctx, params);
    const home = result.candidates.find((a) => a.key === "home_btn");
    assert.strictEqual(home.priority, 80, "Home button priority should be unchanged with few visits");
  });
});

describe("credentialAwareBoost", () => {
  it("boosts email button when email credentials provided on auth_choice screen", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "email_btn", text: "Continue with Email", priority: 50 }),
      makeCandidate({ type: ACTION_TYPES.TAP, key: "google_btn", text: "Continue with Google", priority: 50 }),
    ];
    const ctx = makeCtx({
      authMachine: { isActive: false, isTerminal: false, hasCredentials: true },
      credentials: { email: "test@test.com", password: "pass" },
    });
    const params = makeParams({ screenIntent: { type: "auth_choice" } });
    const result = await adjustPriorities(candidates, ctx, params);
    const email = result.candidates.find((a) => a.key === "email_btn");
    const google = result.candidates.find((a) => a.key === "google_btn");
    assert.ok(email.priority > 50, "Email button should be boosted");
    assert.ok(google.priority < 50, "Google button should be deprioritized");
  });

  it("does not boost on non-auth_choice screens", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "email_btn", text: "Email", priority: 50 }),
    ];
    const ctx = makeCtx({
      authMachine: { isActive: false, isTerminal: false, hasCredentials: true },
      credentials: { email: "test@test.com" },
    });
    const params = makeParams({ screenIntent: { type: "content" } });
    const result = await adjustPriorities(candidates, ctx, params);
    const email = result.candidates.find((a) => a.key === "email_btn");
    assert.strictEqual(email.priority, 50, "Should not boost on non-auth screens");
  });
});

describe("applyPlanAndDestructiveFilters", () => {
  it("applies planBoost function when plan exists", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "settings_btn", text: "Settings", priority: 50 }),
    ];
    const ctx = makeCtx({ plan: { targets: ["settings"] } });
    const planBoost = (action, plan) => {
      if (action.text && action.text.toLowerCase().includes("settings")) return 30;
      return 0;
    };
    const params = makeParams({ planBoost });
    const result = await adjustPriorities(candidates, ctx, params);
    const settings = result.candidates.find((a) => a.key === "settings_btn");
    assert.strictEqual(settings.priority, 80, "Plan-boosted priority should be 50 + 30");
  });

  it("defers destructive actions when budget < 85%", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "delete_btn", text: "Delete" }),
      makeCandidate({ type: ACTION_TYPES.TAP, key: "save_btn", text: "Save" }),
    ];
    const ctx = makeCtx({
      modeManager: { budgetUsedPercent: () => 0.5 },
      appState: {
        isDestructiveAction: (a) => a.key === "delete_btn",
      },
    });
    const params = makeParams();
    const result = await adjustPriorities(candidates, ctx, params);
    const hasDelete = result.candidates.some((a) => a.key === "delete_btn");
    assert.strictEqual(hasDelete, false, "Destructive action should be deferred");
  });

  it("allows destructive actions when budget >= 85%", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "delete_btn", text: "Delete" }),
      makeCandidate({ type: ACTION_TYPES.TAP, key: "save_btn", text: "Save" }),
    ];
    const ctx = makeCtx({
      modeManager: { budgetUsedPercent: () => 0.9 },
      appState: {
        isDestructiveAction: (a) => a.key === "delete_btn",
      },
    });
    const params = makeParams();
    const result = await adjustPriorities(candidates, ctx, params);
    const hasDelete = result.candidates.some((a) => a.key === "delete_btn");
    assert.strictEqual(hasDelete, true, "Destructive action should be allowed when budget >= 85%");
  });
});

describe("adjustPriorities — auth skip when resolved (E4)", () => {
  it("skips auth passes when authResolved is true", async () => {
    const candidates = [
      makeCandidate({ type: ACTION_TYPES.TAP, key: "login_btn", text: "Log in", priority: 50 }),
    ];
    const ctx = makeCtx({ authResolved: true });
    const params = makeParams({ screenIntent: { type: "auth_choice" } });
    const result = await adjustPriorities(candidates, ctx, params);
    // boostAuthIntent, handleAuthFlowPriority, credentialAwareBoost are all skipped
    const login = result.candidates.find((a) => a.key === "login_btn");
    assert.strictEqual(login.priority, 50, "Auth boost should be skipped when resolved");
  });
});

describe("adjustPriorities — return shape", () => {
  it("returns correct shape for normal flow", async () => {
    const candidates = [makeCandidate()];
    const ctx = makeCtx();
    const params = makeParams();
    const result = await adjustPriorities(candidates, ctx, params);
    assert.ok(Array.isArray(result.candidates), "Should return candidates array");
    assert.strictEqual(typeof result.shouldContinue, "boolean");
    assert.strictEqual(typeof result.shouldBreak, "boolean");
    assert.strictEqual(result.shouldContinue, false);
    assert.strictEqual(result.shouldBreak, false);
  });
});
