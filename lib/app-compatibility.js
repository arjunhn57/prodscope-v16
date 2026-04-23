"use strict";

/**
 * app-compatibility.js — Pre-crawl app compatibility assessment.
 *
 * Decides whether an APK can be meaningfully crawled BEFORE we spin up
 * the emulator + queue a job. Three classes of app get rejected up front:
 *   1) Hardware-bound apps the emulator cannot simulate.
 *   2) Games — custom rendering surfaces, no Android UI tree to traverse.
 *   3) Apps with no launcher activity (rare — downgraded, not rejected).
 *
 * Game detection is multi-signal because no single indicator is reliable:
 *   - android:appCategory == "game"  → hard signal (modern Play Console requires it)
 *   - android:isGame == "true"       → legacy but still authoritative
 *   - vulkan.level feature           → games are the main consumer of Vulkan on Android
 *   - OpenGL ES >= 3.0 AND package matches a known game-engine prefix → strong
 *   - package-name prefix alone (Unity, Epic, known publishers) → soft
 *
 * A single hard signal rejects. A soft signal alone rejects too (the
 * false-positive cost is low — unhappy user; the false-negative cost is
 * every user paying to crawl a game that produces nothing useful).
 */

// Hardware the emulator cannot simulate — crawling these would produce
// screens the user doesn't actually experience.
const UNCRAWLABLE_FEATURES = new Set([
  "android.hardware.camera.ar",
  "android.hardware.nfc",
  "android.hardware.bluetooth.le",
  "android.hardware.fingerprint",
  "android.hardware.biometrics",
  "android.hardware.ir",
  "android.hardware.usb.host",
]);

// Hardware that degrades crawl quality but doesn't block it.
const DEGRADED_FEATURES = new Set([
  "android.hardware.camera",
  "android.hardware.camera.autofocus",
  "android.hardware.location.gps",
  "android.hardware.sensor.accelerometer",
  "android.hardware.sensor.gyroscope",
]);

// android:appCategory values that match games. Lowercase per Android framework.
const GAME_APP_CATEGORIES = new Set([
  "game",
]);

// Manifest features that are game-dominant on Android. Vulkan in particular
// is almost exclusively used by game engines + ML workloads; non-game apps
// using Vulkan are rare enough that false-positive rejection is acceptable.
const GAME_DOMINANT_FEATURES = new Set([
  "android.software.vulkan.level",
  "android.hardware.vulkan.level",
  "android.hardware.vulkan.version",
  "android.hardware.vulkan.compute",
  "android.hardware.opengles.aep", // Android Extension Pack — game rendering
]);

// Package-name prefixes that indicate a game engine wrapper or known game
// publisher. A match alone rejects the app — the false-positive cost of
// blocking a non-game with one of these prefixes is low (rare).
const GAME_PACKAGE_PATTERNS = [
  /^com\.unity3d\./i,         // Unity default wrapper
  /^com\.Unity\./,            // Unity alt
  /^com\.epicgames\./i,       // Epic / Unreal
  /^com\.unrealengine\./i,
  /^com\.supercell\./i,       // Clash of Clans / Brawl Stars
  /^com\.king\./i,            // Candy Crush publisher
  /^com\.riotgames\./i,
  /^com\.mihoyo\./i,          // Genshin / Honkai
  /^com\.hoyoverse\./i,
  /^com\.activision\./i,
  /^com\.rockstargames\./i,
  /^com\.ea\.(?!mail)/i,      // Electronic Arts — exclude com.ea.mail edge case
  /^com\.gameloft\./i,
  /^com\.rovio\./i,
  /^com\.zynga\./i,
  /^com\.miniclip\./i,
  /^com\.tencent\.ig$/i,      // PUBG Mobile (international)
  /^com\.garena\./i,
  /^com\.nexon\./i,
  /^com\.netmarble\./i,
  /^com\.square_enix\./i,
  /^com\.bandainamcogames\./i,
  /\.games?\./i,              // generic `.game.` / `.games.` path segment
  /^com\..*\.game$/i,
  /^com\..*\.games$/i,
];

function matchesGamePackagePattern(packageName) {
  if (!packageName) return false;
  return GAME_PACKAGE_PATTERNS.some((re) => re.test(packageName));
}

/**
 * Decide if the app is a game using a multi-signal approach.
 *
 * @param {import("../ingestion/manifest-parser").AppProfile} appProfile
 * @returns {{ reason: string, confidence: "hard"|"strong"|"soft" }|null}
 */
function detectGame(appProfile) {
  const {
    packageName = "",
    features = [],
    glEsVersion = null,
    appCategory = null,
    isGame = false,
  } = appProfile || {};

  // Hard signal 1 — explicit appCategory=game in the manifest.
  if (appCategory && GAME_APP_CATEGORIES.has(appCategory)) {
    return {
      reason: `android:appCategory="${appCategory}" declared in manifest`,
      confidence: "hard",
    };
  }

  // Hard signal 2 — legacy android:isGame attribute.
  if (isGame) {
    return {
      reason: 'android:isGame="true" declared in manifest',
      confidence: "hard",
    };
  }

  // Hard signal 3 — Vulkan / OpenGL AEP usage.
  const gameFeatures = features.filter((f) => GAME_DOMINANT_FEATURES.has(f));
  if (gameFeatures.length > 0) {
    return {
      reason: `Declares game-dominant features: ${gameFeatures.join(", ")}`,
      confidence: "hard",
    };
  }

  // Strong signal — OpenGL ES >= 3.0 AND a known game-engine / publisher prefix.
  const usesModernGl = glEsVersion !== null && glEsVersion >= 3.0;
  const matchesPkg = matchesGamePackagePattern(packageName);
  if (usesModernGl && matchesPkg) {
    return {
      reason: `Package "${packageName}" matches game publisher prefix AND requires OpenGL ES ${glEsVersion}+`,
      confidence: "strong",
    };
  }

  // Soft signal — package name alone. Still rejects because false-negative
  // (crawling a real game) costs credits for zero useful output.
  if (matchesPkg) {
    return {
      reason: `Package "${packageName}" matches a known game publisher / engine prefix`,
      confidence: "soft",
    };
  }

  return null;
}

/**
 * @typedef {Object} CompatResult
 * @property {boolean} crawlable
 * @property {"full"|"degraded"|"uncrawlable"} quality
 * @property {string|null} reason
 * @property {string|null} recommendation
 */

/**
 * Assess whether an app can be meaningfully crawled.
 *
 * @param {import("../ingestion/manifest-parser").AppProfile} appProfile
 * @returns {CompatResult}
 */
function assessCompatibility(appProfile) {
  const features = (appProfile && appProfile.features) || [];
  const hasLauncher = !!(appProfile && appProfile.launcherActivity);

  // Uncrawlable hardware — reject before anything else.
  for (const feature of features) {
    if (UNCRAWLABLE_FEATURES.has(feature)) {
      return {
        crawlable: false,
        quality: "uncrawlable",
        reason: `Requires hardware the emulator cannot simulate: ${feature}`,
        recommendation:
          `This app requires ${feature}, which is not available on an Android emulator. ` +
          `Manual testing on a physical device is recommended for this app.`,
      };
    }
  }

  // Games — reject with a specific reason so the user knows why.
  const gameSignal = detectGame(appProfile);
  if (gameSignal) {
    return {
      crawlable: false,
      quality: "uncrawlable",
      reason: `Detected as a game — ${gameSignal.reason}`,
      recommendation:
        "Games render custom graphics instead of standard Android UI elements, so " +
        "automated UI crawling cannot interact with their content. ProdScope " +
        "only supports apps with a standard Android view tree. Upload a non-game app.",
    };
  }

  // Missing launcher — soft problem; Compose / RN apps sometimes launch via
  // monkey + LAUNCHER intent even without an explicit declaration.
  if (!hasLauncher) {
    return {
      crawlable: true,
      quality: "degraded",
      reason: "No launchable-activity declared in manifest",
      recommendation:
        "The crawler will attempt to launch via monkey. If the app doesn't come " +
        "to the foreground within a few seconds, crawl coverage will be limited.",
    };
  }

  // Degraded hardware features — crawl but warn.
  const degradedHits = features.filter((f) => DEGRADED_FEATURES.has(f));
  if (degradedHits.length > 0) {
    return {
      crawlable: true,
      quality: "degraded",
      reason: `Uses emulator-simulated hardware: ${degradedHits.join(", ")}`,
      recommendation:
        "Camera, GPS, and sensor-dependent screens may not render correctly " +
        "on the emulator. Crawl coverage on those screens may be limited.",
    };
  }

  return {
    crawlable: true,
    quality: "full",
    reason: null,
    recommendation: null,
  };
}

module.exports = {
  assessCompatibility,
  detectGame,
  matchesGamePackagePattern,
  UNCRAWLABLE_FEATURES,
  DEGRADED_FEATURES,
  GAME_APP_CATEGORIES,
  GAME_DOMINANT_FEATURES,
  GAME_PACKAGE_PATTERNS,
};
