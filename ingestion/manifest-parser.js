"use strict";

/**
 * manifest-parser.js — Parse APK manifest to extract package info.
 *
 * Uses aapt2 to dump APK metadata: package name, launcher activity,
 * permissions, and activity list.
 *
 * For .xapk / .apks / .apkm bundles, aapt2 cannot read the zip directly
 * ("could not identify format of APK"). Detect the extension up front,
 * extract just `base.apk` from inside the bundle, run aapt2 against that,
 * clean up. base.apk holds the manifest for the whole logical app.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "manifest-parser" });

const BUNDLE_EXTENSIONS = new Set([".xapk", ".apks", ".apkm"]);

/**
 * Extract just the base.apk entry from a bundle to a temp dir.
 * Caller owns cleanup of `tempDir`.
 *
 * @param {string} bundlePath
 * @returns {{ baseApk: string, tempDir: string }}
 */
function extractBaseApkFromBundle(bundlePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prodscope-base-apk-"));
  try {
    execFileSync("unzip", ["-q", "-j", "-o", bundlePath, "base.apk", "-d", tempDir], {
      timeout: 60000,
    });
    const baseApk = path.join(tempDir, "base.apk");
    if (!fs.existsSync(baseApk)) {
      throw new Error(`base.apk not found inside ${path.basename(bundlePath)}`);
    }
    return { baseApk, tempDir };
  } catch (err) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    throw err;
  }
}

/**
 * @typedef {Object} AppProfile
 * @property {string} packageName
 * @property {string|null} launcherActivity
 * @property {string[]} activities
 * @property {string[]} permissions
 * @property {string[]} features          Required + optional uses-feature names.
 * @property {number|null} glEsVersion     OpenGL ES version as float (e.g. 3.0, 3.1).
 * @property {string|null} appCategory     android:appCategory value (e.g. "game", "social").
 * @property {boolean} isGame              Legacy android:isGame attribute.
 * @property {string} appName
 */

/**
 * Parse an APK file and extract manifest metadata.
 * @param {string} apkPath
 * @returns {AppProfile}
 */
function parseApk(apkPath) {
  const ext = path.extname(apkPath).toLowerCase();
  const isBundle = BUNDLE_EXTENSIONS.has(ext);
  let bundleTempDir = null;
  let aaptTarget = apkPath;
  if (isBundle) {
    try {
      const extracted = extractBaseApkFromBundle(apkPath);
      bundleTempDir = extracted.tempDir;
      aaptTarget = extracted.baseApk;
    } catch (err) {
      log.error({ err: err.message, apkPath }, "Failed to extract base.apk from bundle");
      return parseApkFallback(apkPath);
    }
  }
  try {
    const output = execFileSync("aapt2", ["dump", "badging", aaptTarget], {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const packageMatch = output.match(/package: name='([^']+)'/);
    const packageName = packageMatch ? packageMatch[1] : "";

    const launcherMatch = output.match(/launchable-activity: name='([^']+)'/);
    const launcherActivity = launcherMatch ? launcherMatch[1] : null;

    const appNameMatch = output.match(/application-label:'([^']+)'/);
    const appName = appNameMatch ? appNameMatch[1] : packageName;

    const activities = [];
    const activityRegex = /activity.*?name='([^']+)'/g;
    let m;
    while ((m = activityRegex.exec(output)) !== null) {
      activities.push(m[1]);
    }

    const permissions = [];
    const permRegex = /uses-permission: name='([^']+)'/g;
    while ((m = permRegex.exec(output)) !== null) {
      permissions.push(m[1]);
    }

    // Features — include both required and optional; game detection uses both.
    // aapt2 emits `uses-feature: name='X'` or `uses-feature-not-required: name='X'`.
    const features = [];
    const featureRegex = /uses-feature(?:-not-required)?:\s*name='([^']+)'/g;
    while ((m = featureRegex.exec(output)) !== null) {
      features.push(m[1]);
    }

    // OpenGL ES — `uses-gl-es: '0xNNNNN'` with major/minor packed into 32 bits.
    // 0x00030000 = 3.0, 0x00030001 = 3.1, 0x00020000 = 2.0.
    let glEsVersion = null;
    const glMatch = output.match(/uses-gl-es:\s*'0x([0-9a-fA-F]+)'/);
    if (glMatch) {
      const hex = parseInt(glMatch[1], 16);
      const major = (hex >> 16) & 0xffff;
      const minor = hex & 0xffff;
      glEsVersion = Number(`${major}.${minor}`);
    }

    // android:appCategory — required by Play Console for games; reliable when present.
    const categoryMatch = output.match(/appCategory='([^']+)'/);
    const appCategory = categoryMatch ? categoryMatch[1].toLowerCase() : null;

    // Legacy android:isGame attribute.
    const isGame = /application:[^\n]*isGame='true'/.test(output);

    log.info(
      { packageName, launcherActivity, activities: activities.length, features: features.length, glEsVersion, appCategory, isGame },
      "APK parsed",
    );

    return {
      packageName,
      launcherActivity,
      activities,
      permissions,
      features,
      glEsVersion,
      appCategory,
      isGame,
      appName,
    };
  } catch (err) {
    log.error({ err: err.message, apkPath }, "Failed to parse APK");
    return parseApkFallback(apkPath);
  } finally {
    if (bundleTempDir) {
      try { fs.rmSync(bundleTempDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

function parseApkFallback(apkPath) {
  const fallbackPkg = apkPath.match(/([a-z][a-z0-9_.]+)\.(apk|xapk|apks|apkm)$/i);
  return {
    packageName: fallbackPkg ? fallbackPkg[1] : "unknown",
    launcherActivity: null,
    activities: [],
    permissions: [],
    features: [],
    glEsVersion: null,
    appCategory: null,
    isGame: false,
    appName: "Unknown App",
  };
}

module.exports = { parseApk };
