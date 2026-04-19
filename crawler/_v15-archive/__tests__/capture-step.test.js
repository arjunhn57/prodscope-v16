"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { isTransientEmptyXml } = require("../capture-step");

// ── isTransientEmptyXml ─────────────────────────────────────────────────────

describe("isTransientEmptyXml", () => {
  it("returns true for null", () => {
    assert.strictEqual(isTransientEmptyXml(null), true);
  });

  it("returns true for undefined", () => {
    assert.strictEqual(isTransientEmptyXml(undefined), true);
  });

  it("returns true for empty string", () => {
    assert.strictEqual(isTransientEmptyXml(""), true);
  });

  it("returns true for whitespace-only string", () => {
    assert.strictEqual(isTransientEmptyXml("   \n  "), true);
  });

  it("returns true for null root node error", () => {
    assert.strictEqual(
      isTransientEmptyXml("null root node returned by UiTestAutomationBridge"),
      true
    );
  });

  it("returns true for case-insensitive null root node", () => {
    assert.strictEqual(
      isTransientEmptyXml("NULL ROOT NODE returned by UiTestAutomationBridge"),
      true
    );
  });

  it("returns true for ERROR: prefix", () => {
    assert.strictEqual(isTransientEmptyXml("ERROR: dumping UI hierarchy"), true);
  });

  it("returns true for lowercase error prefix", () => {
    assert.strictEqual(isTransientEmptyXml("Error: connection refused"), true);
  });

  it("returns false for valid XML hierarchy", () => {
    const validXml = `<?xml version="1.0" encoding="UTF-8"?>
      <hierarchy rotation="0">
        <node text="Hello" clickable="true" bounds="[0,0][100,100]" />
      </hierarchy>`;
    assert.strictEqual(isTransientEmptyXml(validXml), false);
  });

  it("returns false for minimal valid XML", () => {
    assert.strictEqual(isTransientEmptyXml("<hierarchy><node/></hierarchy>"), false);
  });

  it("returns false for XML with package info", () => {
    assert.strictEqual(
      isTransientEmptyXml('<node package="com.test.app" clickable="true" />'),
      false
    );
  });
});

// ── captureStableScreen contract ────────────────────────────────────────────

describe("captureStableScreen contract", () => {
  it("captureStableScreen is exported", () => {
    const { captureStableScreen } = require("../capture-step");
    assert.strictEqual(typeof captureStableScreen, "function");
  });
});

// ── captureScreen contract ──────────────────────────────────────────────────

describe("captureScreen contract", () => {
  it("captureScreen is exported", () => {
    const { captureScreen } = require("../capture-step");
    assert.strictEqual(typeof captureScreen, "function");
  });
});
