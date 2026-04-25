"use strict";

/**
 * Tests for lib/apk-fetcher.
 *
 * Covers the synchronous URL-parsing and cache-lookup surface. The HTTP
 * adapters (apkpure.js) are deliberately NOT tested with live requests
 * here — those need integration testing against a known-good test app
 * and run separately. Unit tests stay generic + offline.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  isValidPlayStoreUrl,
  extractPackageName,
  checkCache,
  CACHE_TTL_MS,
} = require("../apk-fetcher");

// ── isValidPlayStoreUrl ────────────────────────────────────────────────

test("isValidPlayStoreUrl: accepts canonical Play Store URLs", () => {
  assert.equal(
    isValidPlayStoreUrl("https://play.google.com/store/apps/details?id=com.example.app"),
    true,
  );
  assert.equal(
    isValidPlayStoreUrl("http://play.google.com/store/apps/details?id=org.example.app"),
    true,
  );
  assert.equal(
    isValidPlayStoreUrl("https://www.play.google.com/store/apps/details?id=com.example.app"),
    true,
  );
});

test("isValidPlayStoreUrl: accepts URLs with extra query params", () => {
  assert.equal(
    isValidPlayStoreUrl(
      "https://play.google.com/store/apps/details?hl=en&id=com.example.app&gl=US",
    ),
    true,
  );
});

test("isValidPlayStoreUrl: rejects non-Play-Store URLs", () => {
  assert.equal(isValidPlayStoreUrl("https://apkpure.com/x/com.example.app"), false);
  assert.equal(isValidPlayStoreUrl("https://example.com"), false);
  assert.equal(isValidPlayStoreUrl(""), false);
  assert.equal(isValidPlayStoreUrl(null), false);
  assert.equal(isValidPlayStoreUrl(undefined), false);
  assert.equal(isValidPlayStoreUrl(42), false);
});

test("isValidPlayStoreUrl: rejects malformed package names", () => {
  // No dots in id (single-segment package isn't valid Android)
  assert.equal(
    isValidPlayStoreUrl("https://play.google.com/store/apps/details?id=singleword"),
    false,
  );
  // Starts with digit
  assert.equal(
    isValidPlayStoreUrl("https://play.google.com/store/apps/details?id=1com.example.app"),
    false,
  );
});

// ── extractPackageName ─────────────────────────────────────────────────

test("extractPackageName: extracts canonical package name", () => {
  assert.equal(
    extractPackageName("https://play.google.com/store/apps/details?id=com.example.app"),
    "com.example.app",
  );
});

test("extractPackageName: handles multi-segment packages", () => {
  assert.equal(
    extractPackageName("https://play.google.com/store/apps/details?id=org.example.app.deep"),
    "org.example.app.deep",
  );
});

test("extractPackageName: extracts even when id is not first param", () => {
  assert.equal(
    extractPackageName(
      "https://play.google.com/store/apps/details?hl=en&gl=US&id=com.example.app",
    ),
    "com.example.app",
  );
});

test("extractPackageName: returns null on invalid URL", () => {
  assert.equal(extractPackageName("not a url"), null);
  assert.equal(extractPackageName("https://example.com"), null);
  assert.equal(extractPackageName(""), null);
});

// ── checkCache ─────────────────────────────────────────────────────────

test("checkCache: returns null when no cached APK exists", () => {
  // Use a deliberately-impossible package name so we don't collide with
  // anything else.
  const fakePkg = `__test_no_cache_${Date.now()}.example.app`;
  assert.equal(checkCache(fakePkg), null);
});

test("checkCache: returns path when fresh cached APK exists, null when stale", () => {
  const { CACHE_DIR } = require("../apk-fetcher");
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  // Fresh: 5 KB file with current mtime → cache hit.
  const freshPkg = `__test_fresh_${Date.now()}.example.app`;
  const freshPath = path.join(CACHE_DIR, `${freshPkg}.apk`);
  fs.writeFileSync(freshPath, Buffer.alloc(5000));
  try {
    assert.equal(checkCache(freshPkg), freshPath);
  } finally {
    fs.unlinkSync(freshPath);
  }

  // Stale: file with mtime older than TTL → cache miss.
  const stalePkg = `__test_stale_${Date.now()}.example.app`;
  const stalePath = path.join(CACHE_DIR, `${stalePkg}.apk`);
  fs.writeFileSync(stalePath, Buffer.alloc(5000));
  const oldMtime = (Date.now() - CACHE_TTL_MS - 60_000) / 1000;
  fs.utimesSync(stalePath, oldMtime, oldMtime);
  try {
    assert.equal(checkCache(stalePkg), null);
  } finally {
    fs.unlinkSync(stalePath);
  }

  // Tiny file (< 1 KB sanity guard): cache miss even if fresh.
  const tinyPkg = `__test_tiny_${Date.now()}.example.app`;
  const tinyPath = path.join(CACHE_DIR, `${tinyPkg}.apk`);
  fs.writeFileSync(tinyPath, Buffer.alloc(100));
  try {
    assert.equal(checkCache(tinyPkg), null);
  } finally {
    fs.unlinkSync(tinyPath);
  }
});
