/**
 * Tests for oracle/triage.js — screen triage for AI analysis
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { triageForAI } = require("../triage");

function makeScreen(step, screenType, feature, fuzzyFp) {
  return {
    step,
    index: step,
    path: `/tmp/screenshots-test/step_${step}.png`,
    screenType: screenType || "unknown",
    feature: feature || "other",
    fuzzyFp: fuzzyFp || `fp_${step}`,
    xml: "<hierarchy></hierarchy>",
    activity: "com.example/.MainActivity",
  };
}

describe("triageForAI", () => {
  it("should select max 8 screens", () => {
    const screens = Array.from({ length: 20 }, (_, i) =>
      makeScreen(i, "feed", "browsing", `fp_${i}`)
    );
    const result = triageForAI(screens, {}, {});
    assert.ok(
      result.screensToAnalyze.length <= 8,
      `Should select max 8, got ${result.screensToAnalyze.length}`
    );
  });

  it("should skip system dialogs", () => {
    const screens = [
      makeScreen(0, "dialog", "interaction", "fp_dialog"),
      makeScreen(1, "system_dialog", "interaction", "fp_sys"),
      makeScreen(2, "feed", "browsing", "fp_feed"),
    ];
    const result = triageForAI(screens, {}, {});

    const selected = result.screensToAnalyze.map((s) => s.screenType);
    assert.ok(!selected.includes("dialog"), "Should skip dialogs");
    assert.ok(!selected.includes("system_dialog"), "Should skip system dialogs");
    assert.ok(selected.includes("feed"), "Should include feed");
  });

  it("should skip duplicate fuzzy fingerprints", () => {
    const screens = [
      makeScreen(0, "feed", "browsing", "same_fp"),
      makeScreen(1, "feed", "browsing", "same_fp"),
      makeScreen(2, "settings", "settings", "other_fp"),
    ];
    const result = triageForAI(screens, {}, {});

    // Only 2 should be considered (first same_fp + other_fp)
    assert.ok(
      result.screensToAnalyze.length <= 2,
      `Should deduplicate, got ${result.screensToAnalyze.length}`
    );
  });

  it("should prioritize screens with crash findings", () => {
    const screens = [
      makeScreen(0, "feed", "browsing", "fp_0"),
      makeScreen(1, "settings", "settings", "fp_1"),
      makeScreen(2, "error", "error_handling", "fp_2"),
    ];
    const findings = {
      2: [{ type: "crash", severity: "critical", detail: "App crashed" }],
    };
    const result = triageForAI(screens, findings, {});

    // Screen with crash should be first
    assert.strictEqual(
      result.screensToAnalyze[0].step,
      2,
      "Crashed screen should be prioritized"
    );
  });

  it("should return empty for no screens", () => {
    const result = triageForAI([], {}, {});
    assert.strictEqual(result.screensToAnalyze.length, 0);
    assert.strictEqual(result.skippedScreens.length, 0);
  });

  it("should include triage log entries", () => {
    const screens = [makeScreen(0, "feed", "browsing", "fp_0")];
    const result = triageForAI(screens, {}, {});
    assert.ok(result.triageLog.length > 0, "Should have triage log entries");
    assert.ok(
      result.triageLog[0].action === "analyze" || result.triageLog[0].action === "skip",
      "Log entries should have action"
    );
  });
});
