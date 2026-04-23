"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assessCompatibility,
  detectGame,
  matchesGamePackagePattern,
} = require("../app-compatibility");

// ── detectGame ────────────────────────────────────────────────────────────

test("detectGame: appCategory=game is hard rejection", () => {
  const r = detectGame({ packageName: "com.example.app", appCategory: "game" });
  assert.ok(r);
  assert.equal(r.confidence, "hard");
  assert.match(r.reason, /appCategory="game"/);
});

test("detectGame: legacy isGame=true is hard rejection", () => {
  const r = detectGame({ packageName: "com.example.app", isGame: true });
  assert.ok(r);
  assert.equal(r.confidence, "hard");
  assert.match(r.reason, /isGame="true"/);
});

test("detectGame: Vulkan feature triggers hard rejection", () => {
  const r = detectGame({
    packageName: "com.some.app",
    features: ["android.hardware.vulkan.level"],
  });
  assert.ok(r);
  assert.equal(r.confidence, "hard");
  assert.match(r.reason, /vulkan/);
});

test("detectGame: OpenGL AEP feature triggers hard rejection", () => {
  const r = detectGame({
    packageName: "com.some.app",
    features: ["android.hardware.opengles.aep"],
  });
  assert.ok(r);
  assert.equal(r.confidence, "hard");
});

test("detectGame: known publisher + GL ES 3.0 is strong rejection", () => {
  const r = detectGame({
    packageName: "com.supercell.clashroyale",
    glEsVersion: 3.0,
    features: [],
  });
  assert.ok(r);
  assert.equal(r.confidence, "strong");
});

test("detectGame: known publisher alone is soft rejection", () => {
  const r = detectGame({
    packageName: "com.king.candycrushsaga",
    features: [],
  });
  assert.ok(r);
  assert.equal(r.confidence, "soft");
});

test("detectGame: non-game standard app passes", () => {
  const r = detectGame({
    packageName: "org.wikipedia",
    features: ["android.hardware.location.gps"],
    glEsVersion: 2.0,
    appCategory: null,
    isGame: false,
  });
  assert.equal(r, null);
});

test("detectGame: biztoso (social app) passes", () => {
  const r = detectGame({
    packageName: "com.biztoso.app",
    features: [],
    appCategory: "social",
  });
  assert.equal(r, null);
});

test("detectGame: Unity wrapper package rejects", () => {
  const r = detectGame({ packageName: "com.unity3d.player", features: [] });
  assert.ok(r);
});

test("detectGame: Epic Games package rejects", () => {
  const r = detectGame({ packageName: "com.epicgames.fortnite", features: [] });
  assert.ok(r);
});

test("detectGame: generic .games. path segment rejects", () => {
  const r = detectGame({ packageName: "com.publisher.games.title", features: [] });
  assert.ok(r);
});

test("detectGame: com.ea.mail (Electronic Arts edge case) does NOT reject", () => {
  // com.ea.mail is a mail client name collision with EA's prefix.
  // The regex explicitly excludes it.
  const r = detectGame({ packageName: "com.ea.mail", features: [] });
  assert.equal(r, null);
});

test("detectGame: null appProfile does not throw", () => {
  assert.equal(detectGame(null), null);
  assert.equal(detectGame(undefined), null);
  assert.equal(detectGame({}), null);
});

// ── matchesGamePackagePattern ─────────────────────────────────────────────

test("matchesGamePackagePattern: empty / null returns false", () => {
  assert.equal(matchesGamePackagePattern(""), false);
  assert.equal(matchesGamePackagePattern(null), false);
  assert.equal(matchesGamePackagePattern(undefined), false);
});

test("matchesGamePackagePattern: standard apps return false", () => {
  assert.equal(matchesGamePackagePattern("com.spotify.music"), false);
  assert.equal(matchesGamePackagePattern("org.wikipedia"), false);
  assert.equal(matchesGamePackagePattern("com.google.android.gm"), false);
  assert.equal(matchesGamePackagePattern("com.linkedin.android"), false);
});

// ── assessCompatibility ───────────────────────────────────────────────────

test("assessCompatibility: wikipedia-like app → crawlable, full", () => {
  const r = assessCompatibility({
    packageName: "org.wikipedia",
    launcherActivity: "org.wikipedia.main.MainActivity",
    features: [],
    activities: ["org.wikipedia.main.MainActivity"],
  });
  assert.equal(r.crawlable, true);
  assert.equal(r.quality, "full");
});

test("assessCompatibility: biztoso-like with GPS → crawlable, degraded", () => {
  const r = assessCompatibility({
    packageName: "com.biztoso.app",
    launcherActivity: "com.app.biztosojetpackcompose.MainActivity",
    features: ["android.hardware.location.gps"],
    activities: ["com.app.biztosojetpackcompose.MainActivity"],
  });
  assert.equal(r.crawlable, true);
  assert.equal(r.quality, "degraded");
  assert.match(r.reason, /location\.gps/);
});

test("assessCompatibility: AR app → uncrawlable", () => {
  const r = assessCompatibility({
    packageName: "com.example.ar",
    launcherActivity: "com.example.ar.MainActivity",
    features: ["android.hardware.camera.ar"],
  });
  assert.equal(r.crawlable, false);
  assert.equal(r.quality, "uncrawlable");
  assert.match(r.reason, /camera\.ar/);
});

test("assessCompatibility: declared game → uncrawlable with clear reason", () => {
  const r = assessCompatibility({
    packageName: "com.example.puzzle",
    launcherActivity: "com.example.puzzle.MainActivity",
    features: [],
    appCategory: "game",
  });
  assert.equal(r.crawlable, false);
  assert.equal(r.quality, "uncrawlable");
  assert.match(r.reason, /game/i);
  assert.match(r.recommendation, /custom graphics/);
});

test("assessCompatibility: Vulkan-using game is rejected even without category", () => {
  const r = assessCompatibility({
    packageName: "com.vendor.opaque",
    launcherActivity: "com.vendor.opaque.MainActivity",
    features: ["android.hardware.vulkan.level"],
  });
  assert.equal(r.crawlable, false);
  assert.equal(r.quality, "uncrawlable");
  assert.match(r.reason, /game/i);
});

test("assessCompatibility: known game publisher is rejected", () => {
  const r = assessCompatibility({
    packageName: "com.king.candycrushsaga",
    launcherActivity: "com.king.candycrushsaga.MainActivity",
    features: [],
  });
  assert.equal(r.crawlable, false);
  assert.equal(r.quality, "uncrawlable");
});

test("assessCompatibility: no launcher → degraded, still crawlable", () => {
  const r = assessCompatibility({
    packageName: "com.example.app",
    launcherActivity: null,
    features: [],
  });
  assert.equal(r.crawlable, true);
  assert.equal(r.quality, "degraded");
  assert.match(r.reason, /launchable-activity/);
});

test("assessCompatibility: hardware check takes precedence over game check", () => {
  // Both signals: AR hardware AND game category. Hardware should be reported.
  const r = assessCompatibility({
    packageName: "com.vendor.game",
    launcherActivity: "com.vendor.game.MainActivity",
    features: ["android.hardware.nfc"],
    appCategory: "game",
  });
  assert.equal(r.crawlable, false);
  assert.match(r.reason, /hardware|nfc/i);
});
