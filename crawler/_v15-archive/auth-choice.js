// @ts-check
"use strict";

/**
 * auth-choice.js — Handles auth choice screens (pick email/phone/social login)
 * and WebView-based auth navigation.
 *
 * @typedef {import('./types/crawl-context').CrawlContext} Ctx
 */

const fs = require("fs");
const path = require("path");
const adb = require("./adb");
const vision = require("./vision");
const systemHandlers = require("./system-handlers");
const { findAuthEscapeButton, findDismissButtonByPosition } = systemHandlers;
const { AUTH_FLOW_MAX_STEPS, MAX_AUTH_FILLS } = require("./crawl-context");
const { AUTH_ESCAPE_LABELS } = require("./auth-state-machine");
const { parseBounds } = require("./actions");
const { navigateAuth, findNearestClickable: findNearestClickableNav } = require("./auth-navigator");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "auth-choice" });

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Find the nearest clickable XML element to a target point.
 * Used to snap vision's approximate coordinates to pixel-perfect XML bounds.
 * Vision tells us WHAT to tap; XML tells us exactly WHERE.
 *
 * @param {string} xml - UIAutomator XML dump
 * @param {number} targetX - Vision-estimated X pixel
 * @param {number} targetY - Vision-estimated Y pixel
 * @param {number} [maxDist=400] - Maximum snap distance in pixels
 * @returns {{ bounds: any, dist: number, label: string }|null}
 */
function findNearestClickable(xml, targetX, targetY, maxDist = 400) {
  if (!xml) return null;
  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  let m;
  /** @type {{ bounds: any, dist: number, label: string }|null} */
  let nearest = null;
  let minDist = Infinity;

  while ((m = nodeRegex.exec(xml)) !== null) {
    const attrs = m[1];
    /** @param {string} name */
    const get = (name) => {
      const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
      return match ? match[1] : "";
    };

    if (get("clickable") !== "true") continue;
    if (get("enabled") === "false") continue;

    const bounds = parseBounds(get("bounds"));
    if (!bounds) continue;

    const w = bounds.x2 - bounds.x1;
    const h = bounds.y2 - bounds.y1;
    // Skip tiny elements (icons, dividers)
    if (w < 40 || h < 30) continue;
    // Skip full-screen containers
    if (w > 900 && h > 500) continue;

    const dist = Math.sqrt((bounds.cx - targetX) ** 2 + (bounds.cy - targetY) ** 2);
    if (dist < minDist && dist <= maxDist) {
      minDist = dist;
      const label = get("text") || get("content-desc") || "";
      nearest = { bounds, dist: Math.round(dist), label };
    }
  }

  return nearest;
}

/**
 * Vision-only WebView auth navigator.
 * Delegates to auth-navigator.js perceive→decide→act loop.
 *
 * CRITICAL: Never calls adb.dumpXml() — UIAutomator dump on WebViews
 * crashes the UIAutomator service and corrupts the ADB connection.
 *
 * @param {string} screenshotDir
 * @param {number} stepBase
 * @param {any} credentials
 * @param {string} preferredMethod
 * @param {string} packageName
 * @param {any} credentialState
 */
async function navigateWebViewAuth(screenshotDir, stepBase, credentials, preferredMethod, packageName, credentialState) {
  log.info("[webview-auth] Delegating to perception-driven auth navigator");
  return navigateAuth({
    screenshotDir,
    stepBase,
    credentials,
    preferredMethod,
    packageName,
    credentialState: credentialState || undefined,
  });
}

/**
 * Handle an auth_choice screen — find the preferred login method and tap it,
 * then navigate WebView auth if needed.
 *
 * @param {Ctx} ctx
 * @param {any} snapshot
 * @param {any} screenIntent
 * @param {string} fp
 * @param {number} step
 * @param {any[]} actionsTaken
 * @param {Function} formatJournal
 * @returns {Promise<{ handled: boolean, shouldContinue: boolean }>}
 */
async function handleAuthChoice(ctx, snapshot, screenIntent, fp, step, actionsTaken, formatJournal) {
  if (screenIntent.type !== "auth_choice") {
    return { handled: false, shouldContinue: false };
  }

  // Gate on auth state machine
  if (!ctx.authMachine.shouldAttemptAuth()) {
    return { handled: false, shouldContinue: false };
  }

  if (!ctx.authMachine.canRetryChoice(fp)) {
    return { handled: false, shouldContinue: false };
  }

  const attemptNum = (ctx.authMachine.choiceRetries.get(`choice::${fp}`) || 0) + 1;
  ctx.log.info({ attemptNum, maxRetries: ctx.authMachine.maxChoiceRetries }, "Auth choice screen detected");

  const credentials = ctx.credentials || {};
  const hasEmail = credentials.email || credentials.username;
  const hasPhone = credentials.phone;
  let preferredMethod = hasEmail ? "email" : hasPhone ? "phone" : "email";

  const buttons = systemHandlers.extractButtons(snapshot.xml);
  const emailPatterns = ["email", "e-mail", "continue with email", "sign in with email", "log in with email", "use email", "email address", "username"];
  const phonePatterns = ["phone", "continue with phone", "sign in with phone", "use phone number"];
  const patterns = preferredMethod === "email" ? emailPatterns : phonePatterns;

  let matched = null;
  for (const pattern of patterns) {
    matched = buttons.find((b) => b.labelLower.includes(pattern));
    if (matched) break;
  }

  if (!matched && vision.budgetRemaining() > 0) {
    const guidance = await vision.getVisionGuidance(
      snapshot.screenshotPath, snapshot.xml,
      {
        classification: "auth_choice",
        triedCount: attemptNum,
        goal: `Find and tap the "${preferredMethod}" login option. We have ${preferredMethod} credentials to sign in.`,
        previousAction: /** @type {any} */ (ctx.lastActionOutcome),
        journal: formatJournal(),
      }
    );
    if (guidance && guidance.mainActions && guidance.mainActions.length > 0) {
      const bestAction = guidance.mainActions.find((a) => {
        const desc = (a.description || "").toLowerCase();
        return patterns.some((p) => desc.includes(p));
      }) || guidance.mainActions[0];

      // XML-snap: vision identifies WHAT to tap, XML provides pixel-perfect WHERE.
      // Snap vision's approximate coordinates to the nearest clickable XML element.
      const snapped = findNearestClickable(snapshot.xml, bestAction.x, bestAction.y);
      if (snapped) {
        ctx.log.info({
          visionX: bestAction.x, visionY: bestAction.y,
          snapX: snapped.bounds.cx, snapY: snapped.bounds.cy,
          snapDist: snapped.dist, snapLabel: snapped.label || "(no label)",
        }, "Snapped vision coords to XML element (pixel-perfect)");
        matched = { label: bestAction.description, bounds: snapped.bounds };
      } else {
        ctx.log.info({ x: bestAction.x, y: bestAction.y }, "No XML snap — using vision coords directly");
        matched = { label: bestAction.description, bounds: { cx: bestAction.x, cy: bestAction.y } };
      }
    }
  }

  if (!matched) {
    // Try escape button before pressing back
    const escapeBtn = findAuthEscapeButton(snapshot.xml, AUTH_ESCAPE_LABELS);
    if (escapeBtn) {
      ctx.log.info({ label: escapeBtn.label }, "No login method found, tapping auth escape button");
      adb.tap(escapeBtn.bounds.cx, escapeBtn.bounds.cy);
      ctx.authMachine.onAuthEscaped("escape button on auth choice");
      actionsTaken.push({ step, type: "auth_escape", description: `Tapped "${escapeBtn.label}"`, source: "xml", fromFingerprint: fp });
      await sleep(1500);
      return { handled: true, shouldContinue: true };
    }

    // H6: Structural positional detection for non-English apps
    const posBtn = findDismissButtonByPosition(snapshot.xml);
    if (posBtn) {
      ctx.log.info({ type: posBtn.type, cx: posBtn.cx, cy: posBtn.cy }, "Positional dismiss button found");
      adb.tap(posBtn.cx, posBtn.cy);
      ctx.authMachine.onAuthEscaped("positional button");
      actionsTaken.push({ step, type: "auth_escape", description: `Positional ${posBtn.type}`, source: "position", fromFingerprint: fp });
      await sleep(1500);
      return { handled: true, shouldContinue: true };
    }

    ctx.log.info("Could not find preferred login method or escape — pressing back");
    adb.pressBack();
    await sleep(800);
    return { handled: true, shouldContinue: true };
  }

  ctx.log.info({ label: matched.label, method: preferredMethod }, "Tapping auth choice button");
  adb.tap(matched.bounds.cx, matched.bounds.cy);
  ctx.authMachine.onChoiceTapped(fp, preferredMethod);
  ctx.authFlowActive = ctx.authMachine.isActive;  // sync legacy
  actionsTaken.push({ step, type: "auth_choice", method: preferredMethod, label: matched.label, fromFingerprint: fp });

  // ── Probe the post-tap screen to decide: native form vs WebView ──
  // IMPORTANT: Do NOT call dumpXml() here — Compose login forms crash UIAutomator.
  // Instead, use screencap as the signal: FLAG_SECURE (0 bytes) = native form.
  await sleep(3000);

  const probeScreenshotPath = path.join(ctx.screenshotDir, `auth_probe_${step}.png`);
  let screenshotWorks = false;
  try {
    screenshotWorks = adb.screencap(probeScreenshotPath) &&
      fs.existsSync(probeScreenshotPath) &&
      fs.statSync(probeScreenshotPath).size > 0;
  } catch (_) {}

  if (!screenshotWorks) {
    // FLAG_SECURE — native screen with blocked screenshots.
    // Defer to main loop: next iteration's captureStableScreen will get the XML,
    // and handleAuthForm (Stage 11) will fill credentials if input fields exist.
    ctx.log.info("Post-auth-choice: FLAG_SECURE (no screenshot) — deferring to main loop");
    await sleep(500);
    return { handled: true, shouldContinue: true };
  }

  // Screenshot works — likely a WebView or native non-FLAG_SECURE screen.
  ctx.log.info("Entering perception-driven WebView auth mode");
  const webviewResult = await navigateWebViewAuth(
    ctx.screenshotDir, step, credentials, preferredMethod,
    ctx.packageName, ctx.credentialState
  );
  ctx.log.info({ navigated: webviewResult.navigated, stepsUsed: webviewResult.stepsUsed }, "WebView auth completed");

  // Persist updated credential state back to context
  if (webviewResult.credentialState) {
    ctx.credentialState = /** @type {any} */ (webviewResult.credentialState);
  }

  if (webviewResult.navigated) {
    ctx.authMachine.onFormFilled(null);
    ctx.authFillCount = ctx.authMachine.fillCount;  // sync legacy
    ctx.consecutiveCaptureFails = 0;
    ctx.totalCaptureRecoveries = 0;
  }

  await sleep(2000);
  return { handled: true, shouldContinue: true };
}

module.exports = { handleAuthChoice, navigateWebViewAuth };
