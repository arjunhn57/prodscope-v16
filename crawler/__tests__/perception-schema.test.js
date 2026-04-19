"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  parsePerceptionJson,
  normalizePerception,
  perceptionResponseSchema,
} = require("../schemas/perception");

const SCREEN = { w: 1080, h: 2400 };
const MARGIN = 10;

/* ── parsePerceptionJson ─────────────────────────────────────────────────── */

describe("parsePerceptionJson", () => {
  it("parses a well-formed response", () => {
    const raw = JSON.stringify({
      screenType: "feed",
      screenDescription: "Home feed",
      navBar: { hasNav: true, tabs: [{ label: "Home", x: 100, y: 2300 }] },
      mainActions: [{ description: "Tap item", x: 540, y: 1200, priority: "high" }],
      isAuthScreen: false,
      isLoading: false,
      contentDensity: "high",
    });
    const out = parsePerceptionJson(raw);
    assert.strictEqual(out.screenType, "feed");
    assert.strictEqual(out.contentDensity, "high");
    assert.strictEqual(out.mainActions.length, 1);
  });

  it("strips markdown fences", () => {
    const raw = '```json\n{"screenType":"settings","contentDensity":"low"}\n```';
    const out = parsePerceptionJson(raw);
    assert.strictEqual(out.screenType, "settings");
    assert.strictEqual(out.contentDensity, "low");
  });

  it("returns null on unparseable JSON", () => {
    assert.strictEqual(parsePerceptionJson("not json at all {"), null);
    assert.strictEqual(parsePerceptionJson(""), null);
    assert.strictEqual(parsePerceptionJson(null), null);
  });

  it("defaults unknown screenType to 'other'", () => {
    const raw = JSON.stringify({ screenType: "exotic_unknown" });
    const out = parsePerceptionJson(raw);
    assert.strictEqual(out.screenType, "other");
  });

  it("defaults unknown contentDensity to 'medium'", () => {
    const raw = JSON.stringify({ screenType: "feed", contentDensity: "gigantic" });
    const out = parsePerceptionJson(raw);
    assert.strictEqual(out.contentDensity, "medium");
  });

  it("defaults missing fields safely", () => {
    const out = parsePerceptionJson("{}");
    assert.strictEqual(out.screenType, "other");
    assert.strictEqual(out.screenDescription, "");
    assert.deepStrictEqual(out.navBar, { hasNav: false, tabs: [] });
    assert.deepStrictEqual(out.mainActions, []);
    assert.strictEqual(out.isAuthScreen, false);
    assert.strictEqual(out.isLoading, false);
    assert.strictEqual(out.contentDensity, "medium");
  });

  it("coerces string booleans to real booleans", () => {
    const raw = JSON.stringify({ screenType: "login", isAuthScreen: "true", isLoading: "" });
    const out = parsePerceptionJson(raw);
    assert.strictEqual(out.isAuthScreen, true);
    assert.strictEqual(out.isLoading, false);
  });

  it("defaults invalid action priority to 'medium'", () => {
    const raw = JSON.stringify({
      screenType: "feed",
      mainActions: [{ description: "x", x: 100, y: 200, priority: "ultra" }],
    });
    const out = parsePerceptionJson(raw);
    assert.strictEqual(out.mainActions[0].priority, "medium");
  });
});

/* ── normalizePerception ─────────────────────────────────────────────────── */

describe("normalizePerception", () => {
  function freshPerception(overrides = {}) {
    return {
      screenType: "feed",
      screenDescription: "",
      navBar: { hasNav: false, tabs: [] },
      mainActions: [],
      isAuthScreen: false,
      isLoading: false,
      contentDensity: "medium",
      ...overrides,
    };
  }

  it("converts percentage coordinates (x<=100, y<=100) to pixels", () => {
    const p = freshPerception({
      mainActions: [{ description: "Tap center", x: 50, y: 50, priority: "high" }],
    });
    normalizePerception(p, SCREEN, MARGIN);
    assert.strictEqual(p.mainActions[0].x, 540);
    assert.strictEqual(p.mainActions[0].y, 1200);
  });

  it("leaves pixel coordinates above 100 unchanged", () => {
    const p = freshPerception({
      mainActions: [{ description: "Tap", x: 540, y: 1200, priority: "medium" }],
    });
    normalizePerception(p, SCREEN, MARGIN);
    assert.strictEqual(p.mainActions[0].x, 540);
    assert.strictEqual(p.mainActions[0].y, 1200);
  });

  it("clamps out-of-bounds coordinates to [margin, screen-margin]", () => {
    const p = freshPerception({
      mainActions: [
        { description: "Too high", x: 2000, y: 5000, priority: "low" },
        { description: "Too low", x: -50, y: -50, priority: "low" },
      ],
    });
    normalizePerception(p, SCREEN, MARGIN);
    assert.strictEqual(p.mainActions[0].x, SCREEN.w - MARGIN);
    assert.strictEqual(p.mainActions[0].y, SCREEN.h - MARGIN);
    assert.strictEqual(p.mainActions[1].x, MARGIN);
    assert.strictEqual(p.mainActions[1].y, MARGIN);
  });

  it("drops actions with non-finite coordinates", () => {
    const p = freshPerception({
      mainActions: [
        { description: "Bad", x: NaN, y: 100, priority: "high" },
        { description: "Good", x: 500, y: 1000, priority: "high" },
      ],
    });
    normalizePerception(p, SCREEN, MARGIN);
    assert.strictEqual(p.mainActions.length, 1);
    assert.strictEqual(p.mainActions[0].description, "Good");
  });

  it("caps mainActions at 5 entries", () => {
    const p = freshPerception({
      mainActions: Array.from({ length: 10 }, (_, i) => ({
        description: `a${i}`,
        x: 200 + i * 10,
        y: 200,
        priority: "medium",
      })),
    });
    normalizePerception(p, SCREEN, MARGIN);
    assert.strictEqual(p.mainActions.length, 5);
  });

  it("sets navBar.hasNav false when fewer than 2 valid tabs", () => {
    const p = freshPerception({
      navBar: {
        hasNav: true,
        tabs: [{ label: "Only", x: 100, y: 2300 }],
      },
    });
    normalizePerception(p, SCREEN, MARGIN);
    assert.strictEqual(p.navBar.hasNav, false);
    assert.deepStrictEqual(p.navBar.tabs, []);
  });

  it("sets navBar.hasNav true when 2+ tabs survive filtering", () => {
    const p = freshPerception({
      navBar: {
        hasNav: false,
        tabs: [
          { label: "Home", x: 100, y: 2300 },
          { label: "Search", x: 500, y: 2300 },
        ],
      },
    });
    normalizePerception(p, SCREEN, MARGIN);
    assert.strictEqual(p.navBar.hasNav, true);
    assert.strictEqual(p.navBar.tabs.length, 2);
  });

  it("drops tabs with empty labels", () => {
    const p = freshPerception({
      navBar: {
        hasNav: true,
        tabs: [
          { label: "", x: 100, y: 2300 },
          { label: "Search", x: 500, y: 2300 },
          { label: "Profile", x: 900, y: 2300 },
        ],
      },
    });
    normalizePerception(p, SCREEN, MARGIN);
    assert.strictEqual(p.navBar.tabs.length, 2);
    assert.strictEqual(p.navBar.tabs[0].label, "Search");
  });
});

/* ── End-to-end schema + normalize pipeline ──────────────────────────────── */

describe("perception schema pipeline", () => {
  it("handles a realistic LLM response with percentages and invalid fields", () => {
    const raw = JSON.stringify({
      screenType: "nav_hub",
      screenDescription: "Main nav hub",
      navBar: {
        hasNav: true,
        tabs: [
          { label: "Home", x: 12, y: 96 },
          { label: "Search", x: 50, y: 96 },
          { label: "Profile", x: 88, y: 96 },
        ],
      },
      mainActions: [
        { description: "Feed", x: 25, y: 50, priority: "high" },
        { description: "Bad coord", x: "nope", y: "nope", priority: "low" },
      ],
      isAuthScreen: false,
      isLoading: false,
      contentDensity: "medium",
    });
    const parsed = parsePerceptionJson(raw);
    assert.ok(parsed, "parse should succeed");
    normalizePerception(parsed, SCREEN, MARGIN);

    assert.strictEqual(parsed.screenType, "nav_hub");
    assert.strictEqual(parsed.navBar.hasNav, true);
    assert.strictEqual(parsed.navBar.tabs.length, 3);
    assert.strictEqual(parsed.navBar.tabs[0].x, Math.round(0.12 * SCREEN.w));
    assert.strictEqual(parsed.navBar.tabs[0].y, Math.round(0.96 * SCREEN.h));

    assert.strictEqual(parsed.mainActions.length, 1, "bad-coord action dropped");
    assert.strictEqual(parsed.mainActions[0].description, "Feed");
    assert.strictEqual(parsed.mainActions[0].x, Math.round(0.25 * SCREEN.w));
    assert.strictEqual(parsed.mainActions[0].y, Math.round(0.5 * SCREEN.h));
  });
});
