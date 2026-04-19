/**
 * Tests for oracle/ux-heuristics.js — deterministic UX checks
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  checkAccessibility,
  checkEmptyScreen,
  checkSlowResponse,
  parseBounds,
} = require("../ux-heuristics");

// -------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------

const SCREEN_WITH_MISSING_CONTENT_DESC = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,1920]" clickable="false" scrollable="false">
    <node index="0" text="" resource-id="com.example:id/avatar" class="android.widget.ImageView" package="com.example" content-desc="" bounds="[100,200][300,400]" clickable="true" scrollable="false" focusable="false" />
    <node index="1" text="" resource-id="com.example:id/icon" class="android.widget.ImageButton" package="com.example" content-desc="" bounds="[400,200][500,300]" clickable="true" scrollable="false" focusable="false" />
  </node>
</hierarchy>`;

const SCREEN_WITH_SMALL_TAP_TARGETS = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,1920]" clickable="false" scrollable="false">
    <node index="0" text="X" resource-id="com.example:id/close" class="android.widget.TextView" package="com.example" bounds="[1000,50][1030,80]" clickable="true" scrollable="false" focusable="false" />
  </node>
</hierarchy>`;

const EMPTY_SCREEN = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,1920]" clickable="false" scrollable="false">
    <node index="0" text="Loading..." resource-id="" class="android.widget.TextView" package="com.example" bounds="[400,900][680,950]" clickable="false" scrollable="false" />
  </node>
</hierarchy>`;

const NORMAL_SCREEN = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" bounds="[0,0][1080,1920]" clickable="false" scrollable="false">
    <node index="0" text="Click me" resource-id="com.example:id/btn" class="android.widget.Button" package="com.example" content-desc="Action button" bounds="[100,400][980,600]" clickable="true" scrollable="false" />
    <node index="1" text="" resource-id="com.example:id/input" class="android.widget.EditText" package="com.example" bounds="[100,700][980,800]" clickable="true" scrollable="false" />
  </node>
</hierarchy>`;

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe("parseBounds", () => {
  it("should parse valid bounds", () => {
    const b = parseBounds("[100,200][300,400]");
    assert.deepStrictEqual(b, { x1: 100, y1: 200, x2: 300, y2: 400 });
  });

  it("should return null for invalid bounds", () => {
    assert.strictEqual(parseBounds("invalid"), null);
    assert.strictEqual(parseBounds(""), null);
    assert.strictEqual(parseBounds(null), null);
  });
});

describe("checkAccessibility", () => {
  it("should detect missing contentDescription on ImageView", () => {
    const findings = checkAccessibility(SCREEN_WITH_MISSING_CONTENT_DESC);
    const missingDesc = findings.filter(
      (f) => f.type === "missing_content_description"
    );
    assert.ok(
      missingDesc.length >= 1,
      `Should find missing contentDescription, got ${missingDesc.length}`
    );
  });

  it("should detect small tap targets", () => {
    const findings = checkAccessibility(SCREEN_WITH_SMALL_TAP_TARGETS);
    const smallTargets = findings.filter((f) => f.type === "small_tap_target");
    assert.ok(
      smallTargets.length >= 1,
      `Should find small tap target, got ${smallTargets.length}`
    );
  });

  it("should return empty for well-formed screen", () => {
    const findings = checkAccessibility(NORMAL_SCREEN);
    // Normal screen has a button with contentDesc and reasonable size
    const missingDesc = findings.filter(
      (f) => f.type === "missing_content_description"
    );
    assert.strictEqual(missingDesc.length, 0, "Should have no missing contentDescription issues");
  });

  it("should return empty for null XML", () => {
    assert.deepStrictEqual(checkAccessibility(null), []);
    assert.deepStrictEqual(checkAccessibility(""), []);
  });
});

describe("checkEmptyScreen", () => {
  it("should detect screen with no interactable elements", () => {
    const result = checkEmptyScreen(EMPTY_SCREEN);
    assert.strictEqual(result.isEmpty, true);
  });

  it("should not flag screen with clickable elements", () => {
    const result = checkEmptyScreen(NORMAL_SCREEN);
    assert.strictEqual(result.isEmpty, false);
  });

  it("should flag null XML as empty", () => {
    const result = checkEmptyScreen(null);
    assert.strictEqual(result.isEmpty, true);
  });
});

describe("checkSlowResponse", () => {
  it("should detect slow transitions (>12s)", () => {
    const pre = Date.now() - 15000; // 15 seconds ago
    const result = checkSlowResponse(pre);
    assert.strictEqual(result.slow, true);
    assert.ok(result.durationMs >= 14500, "Duration should be ~15000ms");
  });

  it("should not flag fast transitions", () => {
    const pre = Date.now() - 500; // 0.5 seconds ago
    const result = checkSlowResponse(pre);
    assert.strictEqual(result.slow, false);
  });

  it("should accept explicit post timestamp", () => {
    const pre = 1000;
    const post = 14000;
    const result = checkSlowResponse(pre, post);
    assert.strictEqual(result.slow, true);
    assert.strictEqual(result.durationMs, 13000);
  });
});
