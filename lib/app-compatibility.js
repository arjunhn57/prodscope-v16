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

// Phase 3.4: packages whose publishers are known to aggressively use Play
// Integrity / device attestation. These apps detect emulators and typically
// hard-refuse to load meaningful content — automated crawling produces
// either a splash with an error toast, or an infinite loading loop. Better
// to reject at ingest with a specific reason than burn credits on a run
// that can't succeed.
//
// NOTE: false-positive cost is a user confusion incident ("why won't my
// app crawl?") with a clear explanation. False-negative cost is the
// user's credits spent on a useless crawl. We prefer the former.
const ANTI_EMULATOR_PACKAGE_PATTERNS = [
  // Streaming with Widevine / Play Integrity:
  /^com\.netflix\./i,
  /^com\.disney\./i,
  /^com\.hulu\./i,
  /^com\.hbo(go|now|max)?$/i,
  /^com\.amazon\.avod$/i,         // Prime Video
  /^com\.google\.android\.apps\.subscriptions\./i, // YT Premium / Music
  /^com\.spotify\.music$/i,       // Premium-gated content + attestation

  // Major banking / finance (US):
  /^com\.chase(\.|$)/i,
  /^com\.capitalone(\.|$)/i,
  /^com\.bankofamerica(\.|$)/i,
  /^com\.wellsfargo(\.|$)/i,
  /^com\.paypal(\.|$)/i,
  /^com\.robinhood(\.|$)/i,
  /^com\.coinbase(\.|$)/i,

  // Major banking / finance (UK / EU):
  /^com\.revolut\./i,
  /^com\.monzo\./i,
  /^com\.starlingbank\./i,
  /^com\.barclays\./i,

  // Major banking / finance (India):
  /^in\.hdfcbank\./i,
  /^in\.amazon\.mShop\.android$/i,
  /^com\.sbi\./i,
  /^com\.icicibank\./i,
  /^com\.axis\./i,
  /^com\.phonepe\./i,
  /^net\.one97\.paytmapp$/i,

  // Generic banking suffix heuristic — catches most regional banks that
  // follow the `com.<provider>.banking` convention.
  /\.bank(ing)?(\.|$)/i,
];

// Permissions that are strong signals of device-admin / attestation-heavy
// code paths. Not conclusive by themselves but cross-reference well with
// package heuristics.
const ANTI_EMULATOR_PERMISSIONS = new Set([
  "android.permission.BIND_DEVICE_ADMIN",
  "android.permission.MANAGE_EXTERNAL_STORAGE",
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

function matchesAntiEmulatorPattern(packageName) {
  if (!packageName) return false;
  return ANTI_EMULATOR_PACKAGE_PATTERNS.some((re) => re.test(packageName));
}

/**
 * Decide if the app likely uses Play Integrity / device attestation and
 * therefore won't run meaningfully on an emulator.
 *
 * @param {import("../ingestion/manifest-parser").AppProfile & {usesPlayIntegrity?: boolean}} appProfile
 * @returns {{ reason: string, confidence: "strong"|"soft" }|null}
 */
function detectAntiEmulator(appProfile) {
  const packageName = (appProfile && appProfile.packageName) || "";
  const permissions = (appProfile && appProfile.permissions) || [];

  // Explicit Play Integrity dependency in the manifest (when the parser
  // can detect it). Highest-confidence signal we have without runtime data.
  if (appProfile && appProfile.usesPlayIntegrity === true) {
    return {
      reason:
        "App declares Play Integrity API dependency — device attestation will fail on the emulator",
      confidence: "strong",
    };
  }

  // Known streaming / banking publisher by package prefix.
  if (matchesAntiEmulatorPattern(packageName)) {
    return {
      reason:
        `Package "${packageName}" matches a known DRM / attestation-heavy publisher ` +
        `(streaming service, bank, or finance app). These apps typically refuse to ` +
        `load meaningful content on an emulator.`,
      confidence: "strong",
    };
  }

  // Cross-signal: app declares device-admin-style permissions. Alone this
  // is weak (admin permissions are used for legitimate enterprise apps
  // that do work on emulators), so we only flag as "soft".
  const hasAdminPerm = permissions.some((p) => ANTI_EMULATOR_PERMISSIONS.has(p));
  if (hasAdminPerm) {
    return {
      reason:
        "App declares device-admin / storage-elevation permissions — runtime anti-emulator checks are possible",
      confidence: "soft",
    };
  }

  return null;
}

/**
 * Decide if the app is a WebView-only wrapper around web content. These
 * are crawlable but the "app" surface is really just a browser — the
 * user's screenshot-based bug finding applies to the web content, not
 * the native shell.
 *
 * @param {import("../ingestion/manifest-parser").AppProfile} appProfile
 * @returns {{ reason: string, confidence: "strong"|"soft" }|null}
 */
function detectWebViewOnly(appProfile) {
  const activities = (appProfile && appProfile.activities) || [];
  const launcher = (appProfile && appProfile.launcherActivity) || "";

  if (activities.length === 0) return null;

  const isWebViewActivity = (name) =>
    /WebView|WebActivity|BrowserActivity|ChromeActivity/i.test(name || "");

  // Every declared activity is a WebView — definitive wrapper.
  if (activities.every(isWebViewActivity)) {
    return {
      reason: `All ${activities.length} declared activities are WebView wrappers — the "app" is a browser`,
      confidence: "strong",
    };
  }

  // Launcher is a WebView AND the app has at most 2 activities — likely
  // a thin wrapper with a single settings/about screen alongside the web.
  if (isWebViewActivity(launcher) && activities.length <= 2) {
    return {
      reason: `Launcher activity "${launcher}" is a WebView with only ${activities.length} total activities — likely a thin web wrapper`,
      confidence: "soft",
    };
  }

  return null;
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

  // Anti-emulator (DRM / Play Integrity / banking) — reject strong signals;
  // downgrade soft signals to a warning so the user can try at their own cost.
  const antiEmuSignal = detectAntiEmulator(appProfile);
  if (antiEmuSignal && antiEmuSignal.confidence === "strong") {
    return {
      crawlable: false,
      quality: "uncrawlable",
      reason: `Anti-emulator / attestation-heavy app — ${antiEmuSignal.reason}`,
      recommendation:
        "This app uses Google Play Integrity (or equivalent device attestation) to " +
        "detect and reject emulated Android devices. Crawling would hit the attestation " +
        "failure and produce no useful signal. Test on a real physical device instead.",
    };
  }

  // WebView-only apps — crawlable but degraded; the user should know their
  // "app" findings will really be web-content findings.
  const webViewSignal = detectWebViewOnly(appProfile);
  if (webViewSignal) {
    return {
      crawlable: true,
      quality: "degraded",
      reason: `WebView-only wrapper — ${webViewSignal.reason}`,
      recommendation:
        "This app is a thin wrapper around web content. ProdScope will crawl the " +
        "rendered web surface but cannot exercise native Android features (push " +
        "notifications, intents, native share sheets). Coverage reflects the " +
        "underlying website, not a native app experience.",
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
  detectAntiEmulator,
  detectWebViewOnly,
  matchesGamePackagePattern,
  matchesAntiEmulatorPattern,
  UNCRAWLABLE_FEATURES,
  DEGRADED_FEATURES,
  GAME_APP_CATEGORIES,
  GAME_DOMINANT_FEATURES,
  GAME_PACKAGE_PATTERNS,
  ANTI_EMULATOR_PACKAGE_PATTERNS,
  ANTI_EMULATOR_PERMISSIONS,
};
