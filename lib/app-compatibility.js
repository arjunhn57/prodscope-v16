"use strict";

/**
 * app-compatibility.js — Pre-crawl app compatibility assessment.
 *
 * Checks APK manifest features to determine if the app can be
 * meaningfully crawled. Apps requiring specific hardware (AR, NFC),
 * games with custom rendering, or deep-link-only apps are flagged.
 */

// Hardware features that make an app uncrawlable on an emulator
const UNCRAWLABLE_FEATURES = new Set([
  "android.hardware.camera.ar",
  "android.hardware.nfc",
  "android.hardware.bluetooth.le",
  "android.hardware.fingerprint",
  "android.hardware.biometrics",
  "android.hardware.ir",
  "android.hardware.usb.host",
]);

// Features that degrade crawl quality but don't prevent it
const DEGRADED_FEATURES = new Set([
  "android.hardware.camera",
  "android.hardware.camera.autofocus",
  "android.hardware.location.gps",
  "android.hardware.sensor.accelerometer",
  "android.hardware.sensor.gyroscope",
]);

// Play Store categories that indicate games (custom rendering, no standard UI)
const GAME_CATEGORIES = new Set([
  "GAME_ACTION", "GAME_ADVENTURE", "GAME_ARCADE", "GAME_BOARD",
  "GAME_CARD", "GAME_CASINO", "GAME_CASUAL", "GAME_EDUCATIONAL",
  "GAME_MUSIC", "GAME_PUZZLE", "GAME_RACING", "GAME_ROLE_PLAYING",
  "GAME_SIMULATION", "GAME_SPORTS", "GAME_STRATEGY", "GAME_TRIVIA",
  "GAME_WORD",
]);

/**
 * Assess whether an app can be meaningfully crawled.
 *
 * @param {object} appProfile - Parsed APK manifest
 * @param {string[]} [appProfile.permissions] - Required permissions
 * @param {string[]} [appProfile.features] - Required hardware features
 * @param {string} [appProfile.category] - Play Store category
 * @param {string} [appProfile.launcherActivity] - Launcher activity
 * @returns {{ crawlable: boolean, quality: "full"|"degraded"|"uncrawlable", reason: string|null, recommendation: string|null }}
 */
function assessCompatibility(appProfile) {
  const features = appProfile.features || [];
  const category = (appProfile.category || "").toUpperCase();
  const hasLauncher = !!appProfile.launcherActivity;

  // Check for uncrawlable hardware requirements
  for (const feature of features) {
    if (UNCRAWLABLE_FEATURES.has(feature)) {
      return {
        crawlable: false,
        quality: "uncrawlable",
        reason: `Requires hardware: ${feature}`,
        recommendation: `This app requires ${feature} which is not available on an emulator. Manual testing is recommended.`,
      };
    }
  }

  // Check for game category
  if (GAME_CATEGORIES.has(category)) {
    return {
      crawlable: false,
      quality: "uncrawlable",
      reason: `Game app (category: ${category})`,
      recommendation: "Game apps use custom rendering engines and don't expose standard Android UI elements. Automated UI crawling cannot interact with game content.",
    };
  }

  // Check for launcher activity — many apps (Compose, RN) don't expose
  // launchable-activity via aapt but launch fine with monkey/am start.
  // Downgrade to degraded instead of blocking entirely.
  if (!hasLauncher) {
    return {
      crawlable: true,
      quality: "degraded",
      reason: "No launcher activity found in manifest",
      recommendation: "Launcher activity not declared in manifest. The crawler will attempt to launch via monkey command.",
    };
  }

  // Check for degraded features
  const degradedHits = features.filter((f) => DEGRADED_FEATURES.has(f));
  if (degradedHits.length > 0) {
    return {
      crawlable: true,
      quality: "degraded",
      reason: `Uses hardware features: ${degradedHits.join(", ")}`,
      recommendation: "Some features (camera, GPS, sensors) are simulated on the emulator. Screens requiring these may not render correctly.",
    };
  }

  return {
    crawlable: true,
    quality: "full",
    reason: null,
    recommendation: null,
  };
}

module.exports = { assessCompatibility, UNCRAWLABLE_FEATURES, GAME_CATEGORIES };
