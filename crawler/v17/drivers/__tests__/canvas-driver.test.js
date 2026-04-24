"use strict";

/**
 * Tests for v17/drivers/canvas-driver.js.
 *
 * Cases:
 *   1. claim: true on empty-hierarchy XML.
 *   2. claim: true on XML with only non-clickable content.
 *   3. claim: false when XML contains a clickable node.
 *   4. claim: false when xml is missing / null / empty.
 *   5. decide: first call emits a wait action and records the fingerprint.
 *   6. decide: second call on the SAME fingerprint returns null (yields).
 *   7. decide: distinct fingerprint → wait again; memory holds both entries.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const canvasDriver = require("../canvas-driver");

// ── Fixtures ───────────────────────────────────────────────────────────

const emptyHierarchyXml = `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0"></hierarchy>`;

// Static content (TextView, ImageView) but nothing clickable — should count
// as a canvas for our purposes because the driver can't act on it.
const staticContentXml =
  `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n` +
  `<node class="android.widget.ImageView" package="com.game.engine" clickable="false" bounds="[0,0][1080,2400]" />\n` +
  `<node class="android.widget.TextView" package="com.game.engine" text="Loading..." clickable="false" bounds="[400,1100][680,1200]" />\n` +
  `</hierarchy>`;

const clickableContentXml =
  `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n` +
  `<node class="android.widget.Button" package="com.example" text="Continue" clickable="true" bounds="[100,2000][980,2200]" />\n` +
  `</hierarchy>`;

// ── Tests ──────────────────────────────────────────────────────────────

test("CanvasDriver.claim: true on empty <hierarchy/> XML", () => {
  assert.equal(canvasDriver.claim({ xml: emptyHierarchyXml }), true);
});

test("CanvasDriver.claim: true on XML with only non-clickable content", () => {
  assert.equal(canvasDriver.claim({ xml: staticContentXml }), true);
});

test("CanvasDriver.claim: false when XML has ≥1 clickable node", () => {
  assert.equal(canvasDriver.claim({ xml: clickableContentXml }), false);
});

test("CanvasDriver.claim: false when xml is missing / null / empty", () => {
  assert.equal(canvasDriver.claim({}), false);
  assert.equal(canvasDriver.claim({ xml: null }), false);
  assert.equal(canvasDriver.claim({ xml: "" }), false);
  assert.equal(canvasDriver.claim(null), false);
});

test("CanvasDriver.decide: first call emits wait(1500) and records fingerprint", () => {
  const state = {};
  const action = canvasDriver.decide(
    {
      xml: emptyHierarchyXml,
      packageName: "com.spotify.music",
      activity: "com.spotify.music.MainActivity",
    },
    state,
  );
  assert.ok(action);
  assert.equal(action.type, "wait");
  assert.equal(action.ms, canvasDriver.CANVAS_WAIT_MS);
  assert.ok(state.canvasMemory);
  assert.equal(state.canvasMemory.waited.size, 1);
});

test("CanvasDriver.decide: second call on same fingerprint → null (yields)", () => {
  const state = {};
  const obs = {
    xml: emptyHierarchyXml,
    packageName: "com.spotify.music",
    activity: "com.spotify.music.MainActivity",
  };
  const first = canvasDriver.decide(obs, state);
  const second = canvasDriver.decide(obs, state);
  assert.equal(first.type, "wait");
  assert.equal(second, null, "second call on same fp must yield to LLMFallback");
  assert.equal(state.canvasMemory.waited.size, 1);
});

test("CanvasDriver.decide: distinct fingerprint → wait again; memory holds both", () => {
  const state = {};
  const spotify = {
    xml: emptyHierarchyXml,
    packageName: "com.spotify.music",
    activity: "com.spotify.music.MainActivity",
  };
  const unity = {
    xml: emptyHierarchyXml,
    packageName: "com.unity.splash",
    activity: "com.unity.splash.BootActivity",
  };
  const a1 = canvasDriver.decide(spotify, state);
  const a2 = canvasDriver.decide(unity, state);
  assert.equal(a1.type, "wait");
  assert.equal(a2.type, "wait");
  assert.equal(state.canvasMemory.waited.size, 2);
});
