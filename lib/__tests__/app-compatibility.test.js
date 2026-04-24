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

// ─── Phase 3.4: anti-emulator (DRM / Play Integrity) detection ────────────

const {
  detectAntiEmulator,
  detectWebViewOnly,
  matchesAntiEmulatorPattern,
} = require("../app-compatibility");

test("detectAntiEmulator: null on a non-matching package with no integrity signal", () => {
  assert.equal(
    detectAntiEmulator({ packageName: "com.example.plainapp" }),
    null,
  );
});

test("detectAntiEmulator: flags known streaming apps by package prefix", () => {
  const r = detectAntiEmulator({ packageName: "com.netflix.mediaclient" });
  assert.ok(r);
  assert.match(r.reason, /DRM|attestation|streaming/i);
});

test("detectAntiEmulator: flags banking apps by package prefix", () => {
  const r1 = detectAntiEmulator({ packageName: "com.chase" });
  const r2 = detectAntiEmulator({ packageName: "in.hdfcbank.myapps" });
  assert.ok(r1);
  assert.ok(r2);
});

test("detectAntiEmulator: explicit usesPlayIntegrity flag overrides heuristics", () => {
  const r = detectAntiEmulator({
    packageName: "com.example.generic",
    usesPlayIntegrity: true,
  });
  assert.ok(r);
  assert.equal(r.confidence, "strong");
  assert.match(r.reason, /integrity|attestation/i);
});

test("detectAntiEmulator: BIND_DEVICE_ADMIN permission is a soft signal", () => {
  const r = detectAntiEmulator({
    packageName: "com.example.unknown",
    permissions: ["android.permission.BIND_DEVICE_ADMIN"],
  });
  assert.ok(r);
  assert.equal(r.confidence, "soft");
});

test("matchesAntiEmulatorPattern: unrelated packages do not match", () => {
  assert.equal(matchesAntiEmulatorPattern("org.wikipedia"), false);
  assert.equal(matchesAntiEmulatorPattern("com.app.biztosojetpackcompose"), false);
});

// ─── Phase 3.4: WebView-only detection ────────────────────────────────────

test("detectWebViewOnly: all activities are WebView wrappers → strong", () => {
  const r = detectWebViewOnly({
    packageName: "com.example.wrapper",
    launcherActivity: "com.example.wrapper.WebViewActivity",
    activities: [
      "com.example.wrapper.WebViewActivity",
      "com.example.wrapper.SecondaryWebViewActivity",
    ],
  });
  assert.ok(r);
  assert.equal(r.confidence, "strong");
  assert.match(r.reason, /WebView/i);
});

test("detectWebViewOnly: launcher contains WebView + few activities → soft", () => {
  const r = detectWebViewOnly({
    packageName: "com.example.mixed",
    launcherActivity: "com.example.mixed.MyWebViewActivity",
    activities: [
      "com.example.mixed.MyWebViewActivity",
      "com.example.mixed.SettingsActivity",
    ],
  });
  assert.ok(r);
  assert.equal(r.confidence, "soft");
});

test("detectWebViewOnly: native-Android app is NOT flagged", () => {
  const r = detectWebViewOnly({
    packageName: "com.example.native",
    launcherActivity: "com.example.native.MainActivity",
    activities: [
      "com.example.native.MainActivity",
      "com.example.native.SettingsActivity",
      "com.example.native.ProfileActivity",
    ],
  });
  assert.equal(r, null);
});

test("detectWebViewOnly: empty activities list returns null (nothing to conclude)", () => {
  assert.equal(detectWebViewOnly({ packageName: "x", activities: [] }), null);
});

// ─── assessCompatibility integration ──────────────────────────────────────

test("assessCompatibility: Netflix → uncrawlable with DRM/Integrity reason", () => {
  const r = assessCompatibility({
    packageName: "com.netflix.mediaclient",
    launcherActivity: "com.netflix.mediaclient.ui.launch.UIWebViewActivity",
    features: [],
    activities: ["com.netflix.mediaclient.ui.launch.UIWebViewActivity"],
  });
  assert.equal(r.crawlable, false);
  assert.match(r.reason, /attestation|Integrity|DRM/i);
  assert.match(r.recommendation, /physical device|real device|Play Integrity|attestation/i);
});

test("assessCompatibility: WebView-only app → crawlable but degraded", () => {
  const r = assessCompatibility({
    packageName: "com.example.thinwrapper",
    launcherActivity: "com.example.thinwrapper.WebViewActivity",
    features: [],
    activities: ["com.example.thinwrapper.WebViewActivity"],
  });
  assert.equal(r.crawlable, true);
  assert.equal(r.quality, "degraded");
  assert.match(r.reason, /WebView/i);
  assert.match(r.recommendation, /web|content|limited/i);
});

test("assessCompatibility: hardware still wins over anti-emulator", () => {
  // Netflix + AR (hypothetical) — hardware takes precedence for the reason
  const r = assessCompatibility({
    packageName: "com.netflix.mediaclient",
    launcherActivity: "com.example.WebViewActivity",
    features: ["android.hardware.camera.ar"],
    activities: [],
  });
  assert.equal(r.crawlable, false);
  assert.match(r.reason, /hardware|camera\.ar/i);
});

test("assessCompatibility: game detection still wins over anti-emulator", () => {
  // Hypothetical: a game package ALSO matching streaming pattern
  const r = assessCompatibility({
    packageName: "com.king.candycrushsaga",
    launcherActivity: "com.king.candycrushsaga.MainActivity",
    features: [],
    activities: [],
  });
  assert.equal(r.crawlable, false);
  // Game reason still wins even if anti-emulator heuristic would also match
  assert.match(r.reason, /game/i);
});
