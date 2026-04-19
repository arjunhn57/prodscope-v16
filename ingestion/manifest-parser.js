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
 * Parse an APK file and extract manifest metadata.
 * @param {string} apkPath - Path to the APK file
 * @returns {{ packageName: string, launcherActivity: string|null, activities: string[], permissions: string[], appName: string }}
 */
function parseApk(apkPath) {
  try {
    const output = execFileSync("aapt2", ["dump", "badging", apkPath], {
      encoding: "utf-8",
      timeout: 30000,
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

    log.info({ packageName, launcherActivity, activities: activities.length }, "APK parsed");

    return { packageName, launcherActivity, activities, permissions, appName };
  } catch (err) {
    log.error({ err: err.message, apkPath }, "Failed to parse APK");
    // Fallback: try to extract package name from filename
    const fallbackPkg = apkPath.match(/([a-z][a-z0-9_.]+)\.(apk|xapk)$/i);
    return {
      packageName: fallbackPkg ? fallbackPkg[1] : "unknown",
      launcherActivity: null,
      activities: [],
      permissions: [],
      appName: "Unknown App",
    };
  }
}

module.exports = { parseApk };
