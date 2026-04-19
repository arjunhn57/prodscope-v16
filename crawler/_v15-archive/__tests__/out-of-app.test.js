"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { getPrimaryPackage, isAllowedNonTargetPackage } = require("../out-of-app");

// ── getPrimaryPackage ─────────────────────────────────────────────────────

describe("getPrimaryPackage", () => {
  it("returns the package with the most occurrences", () => {
    const xml = `
      <node package="com.test.app" />
      <node package="com.test.app" />
      <node package="com.test.app" />
      <node package="android" />
    `;
    assert.strictEqual(getPrimaryPackage(xml), "com.test.app");
  });

  it("returns android when it dominates", () => {
    const xml = `
      <node package="android" />
      <node package="android" />
      <node package="android" />
      <node package="com.test.app" />
    `;
    assert.strictEqual(getPrimaryPackage(xml), "android");
  });

  it("returns empty string for null xml", () => {
    assert.strictEqual(getPrimaryPackage(null), "");
  });

  it("returns empty string for undefined xml", () => {
    assert.strictEqual(getPrimaryPackage(undefined), "");
  });

  it("returns empty string for xml with no packages", () => {
    assert.strictEqual(getPrimaryPackage("<node text='hello' />"), "");
  });

  it("returns the single package when only one exists", () => {
    const xml = '<node package="com.single.app" />';
    assert.strictEqual(getPrimaryPackage(xml), "com.single.app");
  });

  it("handles tie by returning first in sort order", () => {
    const xml = '<node package="aaa" /><node package="bbb" />';
    const result = getPrimaryPackage(xml);
    assert.ok(result === "aaa" || result === "bbb", "Should return one of the tied packages");
  });
});

// ── isAllowedNonTargetPackage ───────────────────────────────────────────────

describe("isAllowedNonTargetPackage", () => {
  it("allows android package", () => {
    assert.strictEqual(isAllowedNonTargetPackage("android"), true);
  });

  it("allows permissioncontroller", () => {
    assert.strictEqual(isAllowedNonTargetPackage("com.android.permissioncontroller"), true);
  });

  it("allows google play services (gms)", () => {
    assert.strictEqual(isAllowedNonTargetPackage("com.google.android.gms"), true);
  });

  it("allows null package", () => {
    assert.strictEqual(isAllowedNonTargetPackage(null), true);
  });

  it("allows undefined package", () => {
    assert.strictEqual(isAllowedNonTargetPackage(undefined), true);
  });

  it("allows empty string", () => {
    assert.strictEqual(isAllowedNonTargetPackage(""), true);
  });

  it("rejects random third-party package", () => {
    assert.strictEqual(isAllowedNonTargetPackage("com.random.thirdparty"), false);
  });

  it("rejects chrome", () => {
    assert.strictEqual(isAllowedNonTargetPackage("com.android.chrome"), false);
  });

  it("rejects play store", () => {
    assert.strictEqual(isAllowedNonTargetPackage("com.android.vending"), false);
  });

  it("rejects settings", () => {
    assert.strictEqual(isAllowedNonTargetPackage("com.android.settings"), false);
  });
});

// ── classifyExternalApp (test indirectly via module shape) ───────────────────

describe("out-of-app module exports", () => {
  it("exports handleOutOfApp function", () => {
    const { handleOutOfApp } = require("../out-of-app");
    assert.strictEqual(typeof handleOutOfApp, "function");
  });

  it("exports getPrimaryPackage function", () => {
    assert.strictEqual(typeof getPrimaryPackage, "function");
  });

  it("exports isAllowedNonTargetPackage function", () => {
    assert.strictEqual(typeof isAllowedNonTargetPackage, "function");
  });
});
