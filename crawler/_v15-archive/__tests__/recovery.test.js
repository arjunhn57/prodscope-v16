"use strict";

const { describe, it, beforeEach, mock } = require("node:test");
const assert = require("node:assert");

// Suppress console.log during tests
const origLog = console.log;
const origError = console.error;
beforeEach(() => {
  console.log = () => {};
  console.error = () => {};
});
process.on("exit", () => {
  console.log = origLog;
  console.error = origError;
});

// ---------------------------------------------------------------------------
// Mock screenshot-fp so we don't need real image processing
// ---------------------------------------------------------------------------
const screenshotFp = require("../screenshot-fp");
// We'll mock these in tests that need them

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeAdb(overrides = {}) {
  return {
    pressBack: () => {},
    screencap: () => {},
    dumpXml: () => '<hierarchy><node package="com.test.app" /></hierarchy>',
    getCurrentPackage: () => "com.test.app",
    isUiAutomatorDegraded: () => false,
    restartUiAutomator: () => true,
    run: () => "",
    swipe: () => {},
    tap: () => {},
    ...overrides,
  };
}

function makeReadiness(overrides = {}) {
  return {
    waitForScreenReady: async () => ({
      xml: '<hierarchy><node package="com.test.app" /></hierarchy>',
    }),
    waitForAppForeground: async () => ({ success: true }),
    ...overrides,
  };
}

function makeFingerprint(overrides = {}) {
  let callCount = 0;
  return {
    compute: (xml) => {
      callCount++;
      return overrides.compute ? overrides.compute(xml, callCount) : `fp_${callCount}`;
    },
  };
}

function makeGraph(overrides = {}) {
  return {
    getUnexploredTargets: () => [],
    recordOutcome: () => {},
    ...overrides,
  };
}

function makeCtx(overrides = {}) {
  return {
    globalRecoveryAttempts: 0,
    ...overrides,
  };
}

function createRecoveryManager(depOverrides = {}) {
  const { RecoveryManager } = require("../recovery");
  return new RecoveryManager({
    packageName: "com.test.app",
    launcherActivity: ".MainActivity",
    stateGraph: makeGraph(depOverrides.stateGraph),
    adb: makeAdb(depOverrides.adb),
    readiness: makeReadiness(depOverrides.readiness),
    fingerprint: makeFingerprint(depOverrides.fingerprint),
    getHomeFingerprint: depOverrides.getHomeFingerprint || (() => "fp_home"),
    sleep: depOverrides.sleep || (async () => {}),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RecoveryManager — ESCALATION map", () => {
  it("covers all 8 situations", () => {
    const { ESCALATION, SITUATION } = require("../recovery");
    const situations = Object.values(SITUATION);
    assert.strictEqual(situations.length, 8);
    for (const s of situations) {
      assert.ok(ESCALATION[s], `ESCALATION missing entry for ${s}`);
      assert.ok(Array.isArray(ESCALATION[s]), `ESCALATION[${s}] should be array`);
      assert.ok(ESCALATION[s].length > 0, `ESCALATION[${s}] should not be empty`);
    }
  });

  it("STUCK_SAME_SCREEN starts with soft_back", () => {
    const { ESCALATION, SITUATION, STRATEGY } = require("../recovery");
    assert.strictEqual(ESCALATION[SITUATION.STUCK_SAME_SCREEN][0], STRATEGY.SOFT_BACK);
  });

  it("EMPTY_SCREEN starts with restart_uiautomator", () => {
    const { ESCALATION, SITUATION, STRATEGY } = require("../recovery");
    assert.strictEqual(ESCALATION[SITUATION.EMPTY_SCREEN][0], STRATEGY.RESTART_UIAUTOMATOR);
  });

  it("all referenced strategies are valid", () => {
    const { ESCALATION, STRATEGY } = require("../recovery");
    const validStrategies = new Set(Object.values(STRATEGY));
    for (const [situation, strategies] of Object.entries(ESCALATION)) {
      for (const s of strategies) {
        assert.ok(validStrategies.has(s), `Invalid strategy "${s}" in ${situation}`);
      }
    }
  });
});

describe("RecoveryManager — constructor", () => {
  it("instantiates with valid deps", () => {
    const rm = createRecoveryManager();
    assert.ok(rm);
    assert.strictEqual(rm.packageName, "com.test.app");
    assert.strictEqual(rm.launcherActivity, ".MainActivity");
  });

  it("initializes empty stats map", () => {
    const rm = createRecoveryManager();
    assert.ok(rm.stats instanceof Map);
    assert.strictEqual(rm.stats.size, 0);
  });
});

describe("RecoveryManager — _softBack", () => {
  it("succeeds when fingerprint changes after back press", async () => {
    let callCount = 0;
    const rm = createRecoveryManager({
      fingerprint: {
        compute: () => {
          callCount++;
          return callCount === 1 ? "fp_new" : "fp_new";
        },
      },
    });
    const result = await rm._softBack("fp_old");
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reason, "screen_changed");
    assert.strictEqual(result.newFp, "fp_new");
  });

  it("succeeds when reaching home fingerprint", async () => {
    const rm = createRecoveryManager({
      fingerprint: { compute: () => "fp_home" },
      getHomeFingerprint: () => "fp_home",
    });
    const result = await rm._softBack("fp_current");
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reason, "reached_home");
  });

  it("fails when fingerprint never changes", async () => {
    const rm = createRecoveryManager({
      fingerprint: { compute: () => "fp_same" },
      getHomeFingerprint: () => null,
    });
    const result = await rm._softBack("fp_same");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "no_change_after_backs");
  });

  it("fails when leaving the app", async () => {
    const rm = createRecoveryManager({
      adb: {
        pressBack: () => {},
        isUiAutomatorDegraded: () => false,
      },
      readiness: {
        waitForScreenReady: async () => ({
          xml: '<hierarchy><node package="com.other.app" /></hierarchy>',
        }),
      },
      fingerprint: { compute: () => "fp_other" },
    });
    const result = await rm._softBack("fp_current");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "left_app");
  });

  it("handles adb.pressBack() throwing gracefully", async () => {
    const rm = createRecoveryManager({
      adb: {
        pressBack: () => {
          throw new Error("device offline");
        },
        isUiAutomatorDegraded: () => false,
      },
    });
    // _softBack doesn't have internal try-catch, but recover() wraps it
    const ctx = makeCtx();
    const result = await rm.recover("stuck_same_screen", "fp_current", ctx);
    // Should not crash — the recover() wrapper catches the error
    assert.ok(result);
  });

  it("uses screenshot-based detection when UIAutomator is degraded", async () => {
    let screencapCalled = false;
    const originalComputeHash = screenshotFp.computeHash;
    const originalHammingDistance = screenshotFp.hammingDistance;

    // Temporarily replace
    screenshotFp.computeHash = () => "hash_new";
    screenshotFp.hammingDistance = () => 0;

    const rm = createRecoveryManager({
      adb: {
        pressBack: () => {},
        isUiAutomatorDegraded: () => true,
        screencap: () => {
          screencapCalled = true;
        },
        getCurrentPackage: () => "com.test.app",
      },
      getHomeFingerprint: () => null,
    });
    const result = await rm._softBack("fp_current");
    assert.strictEqual(screencapCalled, true);
    // newFp should be screenshot-based
    assert.ok(result.newFp === null || result.newFp.startsWith("ss_") || result.reason === "no_change_after_backs");

    // Restore
    screenshotFp.computeHash = originalComputeHash;
    screenshotFp.hammingDistance = originalHammingDistance;
  });
});

describe("RecoveryManager — _restartUiAutomator", () => {
  it("succeeds when UIAutomator restarts and XML returns", async () => {
    const rm = createRecoveryManager({
      adb: {
        restartUiAutomator: () => true,
        dumpXml: () => '<hierarchy><node text="hi" /></hierarchy>',
      },
    });
    const result = await rm._restartUiAutomator("fp_empty");
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reason, "uiautomator_restarted");
    assert.ok(result.newFp);
  });

  it("fails when restartUiAutomator returns false", async () => {
    const rm = createRecoveryManager({
      adb: { restartUiAutomator: () => false },
    });
    const result = await rm._restartUiAutomator("fp_empty");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "uiautomator_restart_failed");
  });

  it("fails when no XML after restart", async () => {
    const rm = createRecoveryManager({
      adb: {
        restartUiAutomator: () => true,
        dumpXml: () => null,
      },
    });
    const result = await rm._restartUiAutomator("fp_empty");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "still_no_xml_after_restart");
  });
});

describe("RecoveryManager — _relaunchBranch", () => {
  it("succeeds when app relaunches and is in foreground", async () => {
    const rm = createRecoveryManager({
      readiness: {
        waitForScreenReady: async () => ({
          xml: '<hierarchy><node package="com.test.app" /></hierarchy>',
        }),
        waitForAppForeground: async () => ({ success: true }),
      },
    });
    const result = await rm._relaunchBranch();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reason, "relaunched");
  });

  it("fails when wrong package after relaunch", async () => {
    const rm = createRecoveryManager({
      readiness: {
        waitForScreenReady: async () => ({
          xml: '<hierarchy><node package="com.wrong.app" /></hierarchy>',
        }),
        waitForAppForeground: async () => ({ success: true }),
      },
    });
    const result = await rm._relaunchBranch();
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "wrong_package_after_relaunch");
  });

  it("fails when no XML after relaunch and app not in foreground", async () => {
    const rm = createRecoveryManager({
      readiness: {
        waitForScreenReady: async () => ({ xml: "" }),
        waitForAppForeground: async () => ({ success: true }),
      },
      adb: {
        pressBack: () => {},
        run: () => "",
        getCurrentPackage: () => "com.other.app",
        screencap: () => {},
        dumpXml: () => null,
        isUiAutomatorDegraded: () => false,
      },
    });
    const result = await rm._relaunchBranch();
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "no_xml_after_relaunch");
  });

  it("succeeds via screenshot when no XML but app is in foreground", async () => {
    const originalComputeHash = screenshotFp.computeHash;
    screenshotFp.computeHash = () => "hash_relaunch";

    const rm = createRecoveryManager({
      readiness: {
        waitForScreenReady: async () => ({ xml: "" }),
        waitForAppForeground: async () => ({ success: true }),
      },
      adb: {
        pressBack: () => {},
        run: () => "",
        getCurrentPackage: () => "com.test.app",
        screencap: () => {},
        dumpXml: () => null,
        isUiAutomatorDegraded: () => false,
      },
    });
    const result = await rm._relaunchBranch();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reason, "relaunched_screenshot_only");
    assert.ok(result.newFp.startsWith("ss_"));

    screenshotFp.computeHash = originalComputeHash;
  });
});

describe("RecoveryManager — _deepScroll", () => {
  it("succeeds when fingerprint changes after scroll", async () => {
    let callCount = 0;
    const rm = createRecoveryManager({
      adb: {
        swipe: () => {},
        isUiAutomatorDegraded: () => false,
        dumpXml: () => '<hierarchy><node text="new" /></hierarchy>',
      },
      fingerprint: {
        compute: () => {
          callCount++;
          return `fp_scroll_${callCount}`;
        },
      },
    });
    const result = await rm._deepScroll("fp_original");
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reason, "new_content_after_scroll");
  });

  it("fails when fingerprint stays the same", async () => {
    const rm = createRecoveryManager({
      adb: {
        swipe: () => {},
        isUiAutomatorDegraded: () => false,
        dumpXml: () => '<hierarchy><node text="same" /></hierarchy>',
      },
      fingerprint: { compute: () => "fp_same" },
    });
    const result = await rm._deepScroll("fp_same");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "no_new_content_after_scroll");
  });

  it("uses screenshot hashes when UIAutomator is degraded", async () => {
    const originalComputeHash = screenshotFp.computeHash;
    const originalHammingDistance = screenshotFp.hammingDistance;

    let hashCall = 0;
    screenshotFp.computeHash = () => {
      hashCall++;
      return hashCall <= 1 ? "hash_pre" : "hash_post_different";
    };
    screenshotFp.hammingDistance = () => 20; // > 8 threshold

    const rm = createRecoveryManager({
      adb: {
        swipe: () => {},
        isUiAutomatorDegraded: () => true,
        screencap: () => {},
      },
    });
    const result = await rm._deepScroll("fp_current");
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reason, "new_content_after_scroll_vision");

    screenshotFp.computeHash = originalComputeHash;
    screenshotFp.hammingDistance = originalHammingDistance;
  });
});

describe("RecoveryManager — _navigateTarget", () => {
  it("returns no_unexplored_targets when graph has no targets", async () => {
    const rm = createRecoveryManager({
      stateGraph: { getUnexploredTargets: () => [] },
    });
    const result = await rm._navigateTarget("fp_current");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "no_unexplored_targets");
  });

  it("relaunches and tries path replay", async () => {
    const rm = createRecoveryManager({
      stateGraph: {
        getUnexploredTargets: () => [
          {
            fp: "fp_target_abc",
            path: [
              { fp: "fp_home", actionKey: null },
              { fp: "fp_target_abc", actionKey: "tap:btn:200,400" },
            ],
          },
        ],
      },
      readiness: {
        waitForScreenReady: async () => ({
          xml: '<hierarchy><node package="com.test.app" /></hierarchy>',
        }),
        waitForAppForeground: async () => ({ success: true }),
      },
    });
    const result = await rm._navigateTarget("fp_current");
    // Should attempt path replay — success depends on fingerprint matching
    assert.ok(result);
    assert.ok(typeof result.success === "boolean");
  });
});

describe("RecoveryManager — circuit breaker (H4)", () => {
  it("triggers after MAX_GLOBAL_RECOVERIES attempts", async () => {
    const rm = createRecoveryManager();
    const ctx = makeCtx({ globalRecoveryAttempts: 15 }); // already at limit
    const result = await rm.recover("stuck_same_screen", "fp_test", ctx);
    assert.strictEqual(result.strategy, "circuit_breaker");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "global_recovery_limit_exceeded");
  });

  it("does not trigger below threshold", async () => {
    const rm = createRecoveryManager();
    const ctx = makeCtx({ globalRecoveryAttempts: 5 });
    const result = await rm.recover("stuck_same_screen", "fp_test", ctx);
    assert.notStrictEqual(result.strategy, "circuit_breaker");
  });

  it("increments globalRecoveryAttempts on each call", async () => {
    const rm = createRecoveryManager();
    const ctx = makeCtx({ globalRecoveryAttempts: 0 });
    await rm.recover("dead_end", "fp_test", ctx);
    assert.strictEqual(ctx.globalRecoveryAttempts, 1);
    await rm.recover("dead_end", "fp_test", ctx);
    assert.strictEqual(ctx.globalRecoveryAttempts, 2);
  });
});

describe("RecoveryManager — minimal mode (H4)", () => {
  it("filters to only soft_back and relaunch_branch after 10 attempts", async () => {
    const strategies_tried = [];
    const rm = createRecoveryManager();

    // Monkey-patch to track which strategies are tried
    const origSoftBack = rm._softBack.bind(rm);
    const origRelaunch = rm._relaunchBranch.bind(rm);
    const origDeepScroll = rm._deepScroll.bind(rm);
    const origVisionTap = rm._visionRandomTap.bind(rm);

    rm._softBack = async (fp) => {
      strategies_tried.push("soft_back");
      return { success: false, newFp: null, reason: "no_change" };
    };
    rm._relaunchBranch = async () => {
      strategies_tried.push("relaunch_branch");
      return { success: false, newFp: null, reason: "failed" };
    };
    rm._deepScroll = async (fp) => {
      strategies_tried.push("deep_scroll");
      return { success: false, newFp: null, reason: "no_change" };
    };
    rm._visionRandomTap = async (fp) => {
      strategies_tried.push("vision_random_tap");
      return { success: false, newFp: null, reason: "no_change" };
    };

    // globalRecoveryAttempts=10 → minimal mode (will be incremented to 11 inside recover)
    const ctx = makeCtx({ globalRecoveryAttempts: 10 });

    // STUCK_SAME_SCREEN normally has: soft_back, deep_scroll, relaunch_branch, vision_random_tap
    // In minimal mode should only try: soft_back, relaunch_branch
    await rm.recover("stuck_same_screen", "fp_test", ctx);

    assert.ok(strategies_tried.includes("soft_back"), "Should try soft_back");
    assert.ok(strategies_tried.includes("relaunch_branch"), "Should try relaunch_branch");
    assert.ok(!strategies_tried.includes("deep_scroll"), "Should NOT try deep_scroll in minimal mode");
    assert.ok(!strategies_tried.includes("vision_random_tap"), "Should NOT try vision_random_tap in minimal mode");
  });
});

describe("RecoveryManager — recover() orchestration", () => {
  it("returns first successful strategy", async () => {
    const rm = createRecoveryManager();
    rm._softBack = async () => ({
      success: true,
      newFp: "fp_recovered",
      reason: "screen_changed",
    });
    const ctx = makeCtx();
    const result = await rm.recover("stuck_same_screen", "fp_current", ctx);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.strategy, "soft_back");
    assert.strictEqual(result.attempts, 1);
  });

  it("tries next strategy when first fails", async () => {
    const rm = createRecoveryManager();
    rm._softBack = async () => ({
      success: false,
      newFp: null,
      reason: "no_change",
    });
    rm._deepScroll = async () => ({
      success: true,
      newFp: "fp_scrolled",
      reason: "new_content",
    });
    const ctx = makeCtx();
    const result = await rm.recover("stuck_same_screen", "fp_current", ctx);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.strategy, "deep_scroll");
    assert.strictEqual(result.attempts, 2);
  });

  it("returns exhausted when all strategies fail", async () => {
    const rm = createRecoveryManager();
    rm._softBack = async () => ({ success: false, newFp: null, reason: "fail" });
    rm._deepScroll = async () => ({ success: false, newFp: null, reason: "fail" });
    rm._relaunchBranch = async () => ({ success: false, newFp: null, reason: "fail" });
    rm._visionRandomTap = async () => ({ success: false, newFp: null, reason: "fail" });
    const ctx = makeCtx();
    const result = await rm.recover("stuck_same_screen", "fp_current", ctx);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.strategy, "exhausted");
    assert.strictEqual(result.reason, "all_strategies_failed");
  });

  it("handles unknown situation gracefully (falls back to relaunch)", async () => {
    const rm = createRecoveryManager();
    rm._relaunchBranch = async () => ({
      success: true,
      newFp: "fp_relaunched",
      reason: "relaunched",
    });
    const ctx = makeCtx();
    const result = await rm.recover("totally_unknown_situation", "fp_current", ctx);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.strategy, "relaunch_branch");
  });

  it("catches strategy exceptions and continues to next", async () => {
    const rm = createRecoveryManager();
    rm._softBack = async () => {
      throw new Error("ADB connection lost");
    };
    rm._deepScroll = async () => ({
      success: true,
      newFp: "fp_scrolled",
      reason: "new_content",
    });
    const ctx = makeCtx();
    const result = await rm.recover("stuck_same_screen", "fp_current", ctx);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.strategy, "deep_scroll");
  });

  it("works without ctx (no circuit breaker)", async () => {
    const rm = createRecoveryManager();
    rm._softBack = async () => ({
      success: true,
      newFp: "fp_ok",
      reason: "screen_changed",
    });
    // No ctx passed — should not crash
    const result = await rm.recover("dead_end", "fp_current");
    assert.strictEqual(result.success, true);
  });
});

describe("RecoveryManager — stats tracking", () => {
  it("records strategy attempts and successes", async () => {
    const rm = createRecoveryManager();
    rm._softBack = async () => ({
      success: true,
      newFp: "fp_ok",
      reason: "screen_changed",
    });
    const ctx = makeCtx();
    await rm.recover("stuck_same_screen", "fp_current", ctx);

    const stats = rm.getStats();
    assert.ok(stats.soft_back);
    assert.strictEqual(stats.soft_back.attempts, 1);
    assert.strictEqual(stats.soft_back.successes, 1);
  });

  it("tracks failures correctly", async () => {
    const rm = createRecoveryManager();
    rm._softBack = async () => ({ success: false, newFp: null, reason: "fail" });
    rm._relaunchBranch = async () => ({ success: false, newFp: null, reason: "fail" });
    const ctx = makeCtx();
    await rm.recover("dead_end", "fp_current", ctx);

    const stats = rm.getStats();
    assert.strictEqual(stats.soft_back.attempts, 1);
    assert.strictEqual(stats.soft_back.successes, 0);
    assert.strictEqual(stats.relaunch_branch.attempts, 1);
    assert.strictEqual(stats.relaunch_branch.successes, 0);
  });

  it("getStats returns empty object when no recoveries attempted", () => {
    const rm = createRecoveryManager();
    const stats = rm.getStats();
    assert.deepStrictEqual(stats, {});
  });
});

describe("RecoveryManager — _getPrimaryPackage", () => {
  it("extracts most common package from XML", () => {
    const rm = createRecoveryManager();
    const xml = '<hierarchy><node package="com.test.app" /><node package="com.test.app" /><node package="android" /></hierarchy>';
    assert.strictEqual(rm._getPrimaryPackage(xml), "com.test.app");
  });

  it("returns empty string for empty XML", () => {
    const rm = createRecoveryManager();
    assert.strictEqual(rm._getPrimaryPackage(""), "");
  });

  it("returns empty string for null", () => {
    const rm = createRecoveryManager();
    assert.strictEqual(rm._getPrimaryPackage(null), "");
  });

  it("returns empty string for XML with no package attributes", () => {
    const rm = createRecoveryManager();
    assert.strictEqual(rm._getPrimaryPackage("<hierarchy></hierarchy>"), "");
  });
});
