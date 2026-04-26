"use strict";

/**
 * Tests for emulator/manager.js install path:
 *   - _pickSplitsFromTempDir: filters by arch, keeps base + lang/dpi splits,
 *     collects OBB pushes
 *   - extractBlockingPackageFromError: anchors on canonical phrasings, never
 *     returns a filename, falls through to aapt2 manifest read
 *
 * Run with: node --test emulator/__tests__/manager-install.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  _pickSplitsFromTempDir,
  extractBlockingPackageFromError,
} = require("../manager");

// ── Test fixture helpers ──────────────────────────────────────────────────

function mkTempBundleDir(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prodscope-bundle-test-"));
  for (const [rel, content] of Object.entries(layout)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ── _pickSplitsFromTempDir ────────────────────────────────────────────────

test("_pickSplitsFromTempDir uses manifestApks when provided", () => {
  const dir = mkTempBundleDir({
    "base.apk": "x",
    "split_config.x86_64.apk": "x",
    "split_config.en.apk": "x",
    "ignored.apk": "x",  // present in dir but not in manifest
  });
  try {
    const { apkFiles } = _pickSplitsFromTempDir(dir, {
      arch: "x86_64",
      manifestApks: ["base.apk", "split_config.x86_64.apk", "split_config.en.apk"],
    });
    const names = apkFiles.map((f) => path.basename(f)).sort();
    assert.deepEqual(names, ["base.apk", "split_config.en.apk", "split_config.x86_64.apk"]);
  } finally { cleanup(dir); }
});

test("_pickSplitsFromTempDir walks dir when no manifestApks", () => {
  const dir = mkTempBundleDir({
    "base.apk": "x",
    "split_config.en.apk": "x",
    "nested/extra.apk": "x",
  });
  try {
    const { apkFiles } = _pickSplitsFromTempDir(dir, { arch: "x86_64" });
    const names = apkFiles.map((f) => path.basename(f)).sort();
    assert.deepEqual(names, ["base.apk", "extra.apk", "split_config.en.apk"]);
  } finally { cleanup(dir); }
});

test("_pickSplitsFromTempDir drops foreign-arch splits when arch=x86_64", () => {
  const dir = mkTempBundleDir({
    "base.apk": "x",
    "split_config.x86_64.apk": "x",
    "split_config.arm64_v8a.apk": "x",
    "split_config.armeabi_v7a.apk": "x",
    "split_config.armeabi.apk": "x",
  });
  try {
    const { apkFiles } = _pickSplitsFromTempDir(dir, { arch: "x86_64" });
    const names = apkFiles.map((f) => path.basename(f)).sort();
    assert.deepEqual(names, ["base.apk", "split_config.x86_64.apk"]);
  } finally { cleanup(dir); }
});

test("_pickSplitsFromTempDir keeps language and dpi splits regardless of arch", () => {
  const dir = mkTempBundleDir({
    "base.apk": "x",
    "split_config.en.apk": "x",
    "split_config.hi.apk": "x",
    "split_config.xxhdpi.apk": "x",
    "split_config.tvdpi.apk": "x",
    "split_config.arm64_v8a.apk": "x",  // should be dropped
  });
  try {
    const { apkFiles } = _pickSplitsFromTempDir(dir, { arch: "x86_64" });
    const names = apkFiles.map((f) => path.basename(f)).sort();
    assert.deepEqual(names, [
      "base.apk",
      "split_config.en.apk",
      "split_config.hi.apk",
      "split_config.tvdpi.apk",
      "split_config.xxhdpi.apk",
    ]);
  } finally { cleanup(dir); }
});

test("_pickSplitsFromTempDir collects OBB files from Android/obb/<pkg>/", () => {
  const dir = mkTempBundleDir({
    "base.apk": "x",
    "Android/obb/com.example.game/main.1.com.example.game.obb": "x",
    "Android/obb/com.example.game/patch.2.com.example.game.obb": "x",
  });
  try {
    const { obbFiles } = _pickSplitsFromTempDir(dir, { arch: "x86_64" });
    assert.equal(obbFiles.length, 2);
    const dests = obbFiles.map((o) => o.dest).sort();
    assert.deepEqual(dests, [
      "/sdcard/Android/obb/com.example.game/main.1.com.example.game.obb",
      "/sdcard/Android/obb/com.example.game/patch.2.com.example.game.obb",
    ]);
    for (const { src } of obbFiles) {
      assert.ok(fs.existsSync(src), `OBB src should exist: ${src}`);
    }
  } finally { cleanup(dir); }
});

test("_pickSplitsFromTempDir returns empty obbFiles when no Android/obb dir", () => {
  const dir = mkTempBundleDir({ "base.apk": "x" });
  try {
    const { obbFiles } = _pickSplitsFromTempDir(dir);
    assert.deepEqual(obbFiles, []);
  } finally { cleanup(dir); }
});

test("_pickSplitsFromTempDir threads packageName from manifestPackage", () => {
  const dir = mkTempBundleDir({ "base.apk": "x" });
  try {
    const { packageName } = _pickSplitsFromTempDir(dir, {
      manifestPackage: "com.example.app",
    });
    assert.equal(packageName, "com.example.app");
  } finally { cleanup(dir); }
});

// ── extractBlockingPackageFromError ───────────────────────────────────────

test("extractBlockingPackageFromError matches 'Existing package <pkg> signatures' phrasing", () => {
  const err = new Error(
    "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package org.wikipedia signatures do not match newer version; ignoring!]",
  );
  const pkg = extractBlockingPackageFromError(err, null);
  assert.equal(pkg, "org.wikipedia");
});

test("extractBlockingPackageFromError matches 'Package <pkg> is already installed' phrasing", () => {
  const err = new Error("Failure: Package com.biztoso.app is already installed");
  const pkg = extractBlockingPackageFromError(err, null);
  assert.equal(pkg, "com.biztoso.app");
});

test("extractBlockingPackageFromError never returns a filename token", () => {
  // Real-world adb error includes the .apk filename in the path. Earlier
  // broad regex matched 'f4d5549510b6.apk' before reaching 'org.wikipedia'.
  const err = new Error(
    "Performing Streamed Install\nadb: failed to install /tmp/uploads/f4d5549510b6.apk: " +
    "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package org.wikipedia signatures do not match]",
  );
  const pkg = extractBlockingPackageFromError(err, null);
  assert.equal(pkg, "org.wikipedia");
});

test("extractBlockingPackageFromError returns null when no phrase matches and no apkPath", () => {
  const err = new Error("Some unrelated adb error");
  const pkg = extractBlockingPackageFromError(err, null);
  assert.equal(pkg, null);
});
