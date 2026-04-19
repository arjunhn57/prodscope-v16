// @ts-check
"use strict";

/**
 * out-of-app.js — Out-of-app detection and recovery.
 *
 * Also exports shared XML utilities: getPrimaryPackage, isAllowedNonTargetPackage.
 *
 * @typedef {import('./types/crawl-context').CrawlContext} Ctx
 */

const adb = require("./adb");
const { SITUATION } = require("./recovery");
const { MAX_OUT_OF_APP_RECOVERIES } = require("./crawl-context");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "out-of-app" });

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {string | null | undefined} xml */
function getPrimaryPackage(xml) {
  if (!xml) return "";
  const matches = [...xml.matchAll(/package="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
  if (!matches.length) return "";
  /** @type {Record<string, number>} */
  const counts = {};
  for (const pkg of matches) counts[pkg] = (counts[pkg] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** @param {string | null | undefined} pkg */
function isAllowedNonTargetPackage(pkg) {
  if (!pkg) return true;
  if (pkg === "android") return true;
  if (pkg === "com.android.permissioncontroller") return true;
  if (pkg === "com.google.android.gms") return true;
  return false;
}

// ── C1: Classify external app for targeted recovery ──

const OAUTH_PACKAGES = new Set([
  "com.android.chrome", "com.chrome.beta", "com.chrome.dev",
  "com.google.android.gms", "org.chromium.webview_shell",
  "com.android.browser", "com.sec.android.app.sbrowser",
]);

const PLAY_STORE_PACKAGES = new Set([
  "com.android.vending",
]);

const SETTINGS_PACKAGES = new Set([
  "com.android.settings", "com.android.permissioncontroller",
  "com.google.android.permissioncontroller",
]);

/**
 * Classify the external package to determine recovery strategy.
 * @param {string} pkg
 * @returns {"oauth"|"play_store"|"settings"|"unknown"}
 */
function classifyExternalApp(pkg) {
  if (!pkg) return "unknown";
  if (OAUTH_PACKAGES.has(pkg)) return "oauth";
  if (PLAY_STORE_PACKAGES.has(pkg)) return "play_store";
  if (SETTINGS_PACKAGES.has(pkg)) return "settings";
  // WebView packages often have the target app's package — detect via activity
  if (pkg.includes("webview") || pkg.includes("chrome")) return "oauth";
  return "unknown";
}

/**
 * Detect out-of-app screens and recover back to target app.
 *
 * @param {Ctx} ctx
 * @param {string} primaryPackage - Package detected in current XML
 * @param {number} step - Current step
 * @returns {Promise<{ directive: 'proceed'|'continue'|'break', breakReason?: string }>}
 */
async function handleOutOfApp(ctx, primaryPackage, step) {
  const { packageName, launcherActivity, stateGraph, actionsTaken } = ctx;

  if (!primaryPackage || primaryPackage === packageName || isAllowedNonTargetPackage(primaryPackage)) {
    return { directive: "proceed" };
  }

  ctx.outOfAppRecoveries++;
  const externalType = classifyExternalApp(primaryPackage);
  ctx.log.info({ detected: primaryPackage, target: packageName, externalType }, "Out-of-app screen detected");

  // Record out_of_app outcome for the action that caused this
  if (ctx.lastActionKey && ctx.lastActionFromFp) {
    stateGraph.recordOutcome(ctx.lastActionFromFp, ctx.lastActionKey, "out_of_app");
    ctx.log.info({ actionKey: ctx.lastActionKey, fp: ctx.lastActionFromFp.slice(0, 8) }, "Action marked as out_of_app");
    ctx.lastActionKey = null;
    ctx.lastActionFromFp = null;
  }

  if (ctx.outOfAppRecoveries > MAX_OUT_OF_APP_RECOVERIES) {
    return { directive: "break", breakReason: "left_target_app" };
  }

  // ── C1: Classified recovery — targeted strategy per external app type ──
  let recovered = false;

  if (externalType === "oauth") {
    // OAuth/Chrome: press back 2x to return from browser auth
    ctx.log.info("OAuth flow detected - pressing back 2x");
    adb.pressBack();
    await sleep(800);
    adb.pressBack();
    await sleep(1500);
    const postPkg = adb.getCurrentPackage();
    recovered = (postPkg === packageName);
    if (recovered) ctx.log.info("OAuth back-nav succeeded");
  } else if (externalType === "play_store") {
    // Play Store: press back 1x
    ctx.log.info("Play Store detected - pressing back 1x");
    adb.pressBack();
    await sleep(1500);
    const postPkg = adb.getCurrentPackage();
    recovered = (postPkg === packageName);
    if (recovered) ctx.log.info("Play Store back-nav succeeded");
  } else if (externalType === "settings") {
    // Settings/permissions: tap allow if visible, then back
    ctx.log.info("Settings/permission detected - attempting grant + back");
    const xml = adb.dumpXml();
    if (xml) {
      const { check } = require("./system-handlers");
      const sysResult = check(xml);
      if (sysResult.handled) {
        ctx.log.info({ action: sysResult.action }, "System handler resolved");
      }
    }
    await sleep(800);
    adb.pressBack();
    await sleep(1000);
    const postPkg = adb.getCurrentPackage();
    recovered = (postPkg === packageName);
    if (recovered) ctx.log.info("Settings back-nav succeeded");
  }

  // If classified recovery didn't work, fall through to standard recovery
  if (!recovered) {
    const oaResult = await ctx.recoveryManager.recover(SITUATION.OUT_OF_APP, "out_of_app", ctx);
    if (!oaResult.success) {
      ctx.log.warn("Standard recovery failed - attempting manual relaunch");
      let manualRecovered = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          adb.run(`adb shell am force-stop ${primaryPackage}`, { ignoreError: true });
          await sleep(1500);
          adb.run(`adb shell am force-stop ${packageName}`, { ignoreError: true });
          await sleep(500);
          if (launcherActivity) {
            adb.run(`adb shell am start -W -n ${packageName}/${launcherActivity}`, { ignoreError: true });
          }
          adb.run(`adb shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, { ignoreError: true });
          await sleep(3000 + attempt * 1000);

          const pidCheck = adb.run(`adb shell pidof ${packageName}`, { ignoreError: true });
          const hasPid = pidCheck && pidCheck.trim().length > 0;
          const currentPkg = adb.getCurrentPackage();
          const isTarget = currentPkg === packageName;
          let xmlPkg = null;
          if (!isTarget) {
            const xml = adb.dumpXml();
            if (xml) xmlPkg = getPrimaryPackage(xml);
          }

          if (isTarget || xmlPkg === packageName || hasPid) {
            ctx.log.info({ attempt }, "Manual relaunch succeeded");
            manualRecovered = true;
            break;
          }
          ctx.log.info({ attempt, maxAttempts: 3 }, "Manual relaunch attempt");
        } catch (/** @type {any} */ e) {
          ctx.log.warn({ attempt, maxAttempts: 3, err: e && e.message }, "Manual relaunch attempt failed");
        }
      }
      if (!manualRecovered) {
        return { directive: "break", breakReason: "left_target_app" };
      }
    }
  }

  // Suppress saturation-back for 5 steps after recovery (increased from 3)
  ctx.saturationCooldown = 5;
  return { directive: "continue" };
}

module.exports = { handleOutOfApp, getPrimaryPackage, isAllowedNonTargetPackage };
