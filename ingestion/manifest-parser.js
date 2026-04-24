"use strict";

/**
 * manifest-parser.js — Parse APK manifest to extract package info.
 *
 * Uses aapt2 to dump APK metadata: package name, launcher activity,
 * permissions, and activity list.
 */

const { execFileSync } = require("child_process");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "manifest-parser" });

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
  try {
    const output = execFileSync("aapt2", ["dump", "badging", apkPath], {
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
    const fallbackPkg = apkPath.match(/([a-z][a-z0-9_.]+)\.(apk|xapk)$/i);
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
}

module.exports = { parseApk };
