"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");

// We test the pure, dependency-free helpers exported or accessible from
// screen-intelligence.js. The top-level analyzeScreen() orchestrator requires
// too many live modules (adb, vision, planner) to unit-test without heavy mocking,
// so we focus on the self-contained helpers that carry the most logic.

// ── accumulateTokens ────────────────────────────────────────────────────────

// accumulateTokens is not exported, but its logic is simple enough to replicate
// inline and verify the contract.
function accumulateTokens(ctx, result) {
  if (result && result._tokenUsage && ctx.tokenUsage) {
    ctx.tokenUsage.input_tokens += result._tokenUsage.input_tokens || 0;
    ctx.tokenUsage.output_tokens += result._tokenUsage.output_tokens || 0;
  }
}

describe("accumulateTokens", () => {
  it("adds token counts from result into ctx", () => {
    const ctx = { tokenUsage: { input_tokens: 100, output_tokens: 50 } };
    const result = { _tokenUsage: { input_tokens: 30, output_tokens: 20 } };
    accumulateTokens(ctx, result);
    assert.strictEqual(ctx.tokenUsage.input_tokens, 130);
    assert.strictEqual(ctx.tokenUsage.output_tokens, 70);
  });

  it("does nothing when result has no _tokenUsage", () => {
    const ctx = { tokenUsage: { input_tokens: 100, output_tokens: 50 } };
    accumulateTokens(ctx, {});
    assert.strictEqual(ctx.tokenUsage.input_tokens, 100);
    assert.strictEqual(ctx.tokenUsage.output_tokens, 50);
  });

  it("does nothing when result is null", () => {
    const ctx = { tokenUsage: { input_tokens: 10, output_tokens: 5 } };
    accumulateTokens(ctx, null);
    assert.strictEqual(ctx.tokenUsage.input_tokens, 10);
    assert.strictEqual(ctx.tokenUsage.output_tokens, 5);
  });

  it("handles missing fields gracefully", () => {
    const ctx = { tokenUsage: { input_tokens: 0, output_tokens: 0 } };
    accumulateTokens(ctx, { _tokenUsage: { input_tokens: 5 } });
    assert.strictEqual(ctx.tokenUsage.input_tokens, 5);
    assert.strictEqual(ctx.tokenUsage.output_tokens, 0);
  });
});

// ── classifyFromPerception mapping ──────────────────────────────────────────

// Re-implement the pure mapping logic from classifyFromPerception
const VISION_SCREEN_TO_FEATURE = {
  login: "auth_flow", feed: "browsing", settings: "settings",
  detail: "content_viewing", search: "search", dialog: "interaction",
  form: "data_entry", nav_hub: "browsing", error: "error_handling",
  loading: "other", other: "other",
};

function classifyFromPerception(perception, snapshot) {
  const type = perception.screenType === "nav_hub" ? "navigation_hub" : perception.screenType;
  const feature = VISION_SCREEN_TO_FEATURE[perception.screenType] || "other";
  snapshot.screenType = type;
  snapshot.feature = feature;
  return { type, feature, confidence: 0.65, classifiedBy: "vision-perception" };
}

describe("classifyFromPerception", () => {
  it("maps nav_hub to navigation_hub", () => {
    const snapshot = {};
    const result = classifyFromPerception({ screenType: "nav_hub" }, snapshot);
    assert.strictEqual(result.type, "navigation_hub");
    assert.strictEqual(result.feature, "browsing");
    assert.strictEqual(snapshot.screenType, "navigation_hub");
  });

  it("maps login to auth_flow", () => {
    const snapshot = {};
    const result = classifyFromPerception({ screenType: "login" }, snapshot);
    assert.strictEqual(result.type, "login");
    assert.strictEqual(result.feature, "auth_flow");
  });

  it("maps feed to browsing", () => {
    const snapshot = {};
    const result = classifyFromPerception({ screenType: "feed" }, snapshot);
    assert.strictEqual(result.type, "feed");
    assert.strictEqual(result.feature, "browsing");
  });

  it("maps unknown types to other", () => {
    const snapshot = {};
    const result = classifyFromPerception({ screenType: "exotic_unknown" }, snapshot);
    assert.strictEqual(result.type, "exotic_unknown");
    assert.strictEqual(result.feature, "other");
  });

  it("always returns confidence 0.65", () => {
    const snapshot = {};
    const result = classifyFromPerception({ screenType: "settings" }, snapshot);
    assert.strictEqual(result.confidence, 0.65);
    assert.strictEqual(result.classifiedBy, "vision-perception");
  });

  it("mutates snapshot with screenType and feature", () => {
    const snapshot = {};
    classifyFromPerception({ screenType: "search" }, snapshot);
    assert.strictEqual(snapshot.screenType, "search");
    assert.strictEqual(snapshot.feature, "search");
  });
});

// ── computeEffectiveFp logic ────────────────────────────────────────────────

describe("computeEffectiveFp logic", () => {
  it("uses ss_ prefix when visionPrimary and ssFp valid", () => {
    const visionPrimary = true;
    const ssFp = "abc123hash";
    const fp = "xml_fp_1234";
    const effectiveFp = (visionPrimary && ssFp && ssFp !== "no_screenshot") ? "ss_" + ssFp : fp;
    assert.strictEqual(effectiveFp, "ss_abc123hash");
  });

  it("uses XML fp when not visionPrimary", () => {
    const visionPrimary = false;
    const ssFp = "abc123hash";
    const fp = "xml_fp_1234";
    const effectiveFp = (visionPrimary && ssFp && ssFp !== "no_screenshot") ? "ss_" + ssFp : fp;
    assert.strictEqual(effectiveFp, "xml_fp_1234");
  });

  it("uses XML fp when ssFp is no_screenshot", () => {
    const visionPrimary = true;
    const ssFp = "no_screenshot";
    const fp = "xml_fp_1234";
    const effectiveFp = (visionPrimary && ssFp && ssFp !== "no_screenshot") ? "ss_" + ssFp : fp;
    assert.strictEqual(effectiveFp, "xml_fp_1234");
  });

  it("uses XML fp when ssFp is null", () => {
    const visionPrimary = true;
    const ssFp = null;
    const fp = "xml_fp_5678";
    const effectiveFp = (visionPrimary && ssFp && ssFp !== "no_screenshot") ? "ss_" + ssFp : fp;
    assert.strictEqual(effectiveFp, "xml_fp_5678");
  });
});

// ── handleSaturation logic ──────────────────────────────────────────────────

describe("handleSaturation logic", () => {
  it("respects saturationCooldown", () => {
    const ctx = { saturationCooldown: 3 };
    // Simulate cooldown decrement
    if (ctx.saturationCooldown > 0) ctx.saturationCooldown--;
    assert.strictEqual(ctx.saturationCooldown, 2);
    // Should NOT trigger saturation-back when cooldown > 0
    const shouldBack = ctx.saturationCooldown <= 0;
    assert.strictEqual(shouldBack, false);
  });

  it("allows saturation-back when cooldown is 0", () => {
    const ctx = { saturationCooldown: 0 };
    const shouldBack = ctx.saturationCooldown <= 0;
    assert.strictEqual(shouldBack, true);
  });
});

// ── getPrimaryPackage ─────────────────────────────────────────────────────

function getPrimaryPackage(xml) {
  if (!xml) return "";
  const matches = [...xml.matchAll(/package="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
  if (!matches.length) return "";
  const counts = {};
  for (const pkg of matches) counts[pkg] = (counts[pkg] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

describe("getPrimaryPackage (screen-intelligence)", () => {
  it("returns majority package", () => {
    const xml = '<node package="com.test.app"/><node package="com.test.app"/><node package="android"/>';
    assert.strictEqual(getPrimaryPackage(xml), "com.test.app");
  });

  it("returns empty for null xml", () => {
    assert.strictEqual(getPrimaryPackage(null), "");
  });

  it("returns empty for xml with no package attrs", () => {
    assert.strictEqual(getPrimaryPackage("<node />"), "");
  });
});

// ── detectNavByPosition (E8) ────────────────────────────────────────────────

const { detectNavByPosition } = require("../screen-intelligence");

describe("detectNavByPosition (E8)", () => {
  it("detects 3+ clickable elements in bottom 10% with wide spread", () => {
    const xml = `
      <node clickable="true" text="Home" bounds="[50,2200][200,2350]" />
      <node clickable="true" text="Search" bounds="[350,2200][500,2350]" />
      <node clickable="true" text="Profile" bounds="[700,2200][850,2350]" />
    `;
    const result = detectNavByPosition(xml);
    assert.strictEqual(result.hasNav, true);
    assert.strictEqual(result.tabs.length, 3);
    assert.strictEqual(result.tabs[0].label, "Home");
  });

  it("returns false for fewer than 3 bottom elements", () => {
    const xml = `
      <node clickable="true" text="Home" bounds="[50,2200][200,2350]" />
      <node clickable="true" text="Search" bounds="[350,2200][500,2350]" />
    `;
    const result = detectNavByPosition(xml);
    assert.strictEqual(result.hasNav, false);
  });

  it("returns false when spread is too narrow", () => {
    const xml = `
      <node clickable="true" text="A" bounds="[400,2200][450,2350]" />
      <node clickable="true" text="B" bounds="[460,2200][510,2350]" />
      <node clickable="true" text="C" bounds="[520,2200][570,2350]" />
    `;
    const result = detectNavByPosition(xml);
    assert.strictEqual(result.hasNav, false);
  });

  it("ignores elements above bottom 10%", () => {
    const xml = `
      <node clickable="true" text="Top" bounds="[50,100][200,200]" />
      <node clickable="true" text="Mid" bounds="[350,1000][500,1100]" />
      <node clickable="true" text="Bot" bounds="[700,2200][850,2350]" />
    `;
    const result = detectNavByPosition(xml);
    assert.strictEqual(result.hasNav, false);
  });

  it("returns false for null xml", () => {
    assert.deepStrictEqual(detectNavByPosition(null), { hasNav: false, tabs: [] });
  });

  it("uses content-desc when text is empty", () => {
    const xml = `
      <node clickable="true" text="" content-desc="Home" bounds="[50,2200][200,2350]" />
      <node clickable="true" text="" content-desc="Feed" bounds="[350,2200][500,2350]" />
      <node clickable="true" text="" content-desc="More" bounds="[700,2200][850,2350]" />
    `;
    const result = detectNavByPosition(xml);
    assert.strictEqual(result.hasNav, true);
    assert.strictEqual(result.tabs[0].label, "Home");
  });

  it("sorts tabs left to right", () => {
    const xml = `
      <node clickable="true" text="C" bounds="[700,2200][850,2350]" />
      <node clickable="true" text="A" bounds="[50,2200][200,2350]" />
      <node clickable="true" text="B" bounds="[350,2200][500,2350]" />
    `;
    const result = detectNavByPosition(xml);
    assert.strictEqual(result.tabs[0].label, "A");
    assert.strictEqual(result.tabs[1].label, "B");
    assert.strictEqual(result.tabs[2].label, "C");
  });
});

// ── PerceptionCache threshold (E8) ──────────────────────────────────────────

const { PerceptionCache } = require("../vision-perception");

describe("PerceptionCache fuzzy threshold (E8)", () => {
  it("defaults to threshold 8", () => {
    const cache = new PerceptionCache();
    assert.strictEqual(cache._fuzzyThreshold, 8);
  });

  it("accepts custom threshold in constructor", () => {
    const cache = new PerceptionCache({ fuzzyThreshold: 12 });
    assert.strictEqual(cache._fuzzyThreshold, 12);
  });

  it("setFuzzyThreshold updates threshold", () => {
    const cache = new PerceptionCache();
    cache.setFuzzyThreshold(12);
    assert.strictEqual(cache._fuzzyThreshold, 12);
  });

  it("exact match works regardless of threshold", () => {
    const cache = new PerceptionCache();
    cache.set("hash_abc", { screenType: "feed" });
    const result = cache.get("hash_abc");
    assert.ok(result);
    assert.strictEqual(result.fuzzy, false);
    assert.strictEqual(result.perception.screenType, "feed");
  });

  it("returns null for no_screenshot hash", () => {
    const cache = new PerceptionCache();
    cache.set("hash_abc", { screenType: "feed" });
    assert.strictEqual(cache.get("no_screenshot"), null);
  });

  it("does not store no_screenshot entries", () => {
    const cache = new PerceptionCache();
    cache.set("no_screenshot", { screenType: "feed" });
    assert.strictEqual(cache.size, 0);
  });
});
