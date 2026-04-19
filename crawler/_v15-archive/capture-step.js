// @ts-check
"use strict";

/**
 * capture-step.js — Screen capture with failure handling and vision-only fallback.
 *
 * @typedef {import('./types/crawl-context').CrawlContext} Ctx
 */

const fs = require("fs");
const path = require("path");
const screen = require("./screen");
const adb = require("./adb");
const vision = require("./vision");
const agent = require("./agent");
const screenshotFp = require("./screenshot-fp");
const { waitForContentLoad } = require("./loading-detector");
const { SITUATION } = require("./recovery");
const { MAX_DEVICE_FAILS, MAX_CAPTURE_FAILS, MAX_CAPTURE_RECOVERIES } = require("./crawl-context");

const log = require("../lib/logger").logger.child({ component: "capture-step" });

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {string | null | undefined} xml */
function isTransientEmptyXml(xml) {
  if (!xml) return true;
  const trimmed = String(xml).trim();
  if (!trimmed) return true;
  if (/null root node returned by UiTestAutomationBridge/i.test(trimmed)) return true;
  if (/^ERROR:/i.test(trimmed)) return true;
  return false;
}

/**
 * Capture a screen snapshot with retries for transient XML failures.
 * E1: Uses async parallel capture (screenshot + XML + activity concurrent).
 *
 * @param {string} screenshotDir
 * @param {number|string} index
 * @param {number} [maxRetries]
 * @param {number} [retryDelayMs]
 * @returns {Promise<any>}
 */
async function captureStableScreen(screenshotDir, index, maxRetries = 3, retryDelayMs = 1000) {
  /** @type {any} */
  let snapshot = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    snapshot = await screen.captureAsync(screenshotDir, index);

    if (!snapshot || snapshot.error === "capture_failed" || snapshot.error === "device_offline") {
      return snapshot;
    }

    if (!isTransientEmptyXml(snapshot.xml)) {
      if (!snapshot.screenshotPath) {
        const retryPath = path.join(screenshotDir, `screen_${index}.png`);
        log.info({ retryPath }, "[capture] screenshotPath null but XML valid — retrying sync screencap");
        let ok = adb.screencap(retryPath);
        if (!ok) {
          log.warn("[capture] sync screencap retry failed — trying file-based fallback");
          ok = adb.screencapFileBased(retryPath);
          if (ok) {
            log.info("[capture] file-based screencap fallback succeeded");
          } else {
            log.warn("[capture] file-based screencap fallback also failed — snapshot has no image");
          }
        } else {
          log.info("[capture] sync screencap retry succeeded");
        }
        if (ok) {
          snapshot.screenshotPath = retryPath;
          snapshot.screenshotFailed = false;
        }
      }
      return snapshot;
    }

    log.info({ captureIndex: index, attempt: attempt + 1, maxAttempts: maxRetries + 1 }, "Transient empty/null XML on capture");
    if (attempt < maxRetries) {
      if (attempt === 1) adb.dismissAnrIfPresent();
      await sleep(retryDelayMs);
    }
  }

  // All XML retries exhausted — try restarting UIAutomator before giving up
  if (snapshot && isTransientEmptyXml(snapshot.xml)) {
    log.info("All XML retries failed — attempting UIAutomator restart");
    const restarted = adb.restartUiAutomator();
    if (restarted) {
      /** @type {any} */
      const retrySnapshot = await screen.captureAsync(screenshotDir, index);
      if (retrySnapshot && !isTransientEmptyXml(retrySnapshot.xml)) {
        log.info("UIAutomator restart recovered XML successfully");
        return retrySnapshot;
      }
    }

    if (snapshot.screenshotPath) {
      snapshot.xmlFailed = true;
      log.info("XML dump failed but screenshot available — proceeding vision-only");
    }
  }

  return snapshot;
}

/**
 * Full capture pipeline: device check, capture with retries, failure recovery,
 * vision-only fallback, loading detection.
 *
 * @returns {Promise<{ snapshot: any, directive: 'proceed'|'continue'|'break', breakReason?: string }>}
 */
/**
 * Screenshot-only capture — used when UIAutomator is unrecoverable.
 * Takes a screenshot, computes perceptual hash, returns a minimal snapshot.
 *
 * @param {Ctx} ctx
 * @param {number} step
 * @param {Function} formatJournal
 * @returns {Promise<{ snapshot: any, directive: 'proceed'|'continue'|'break', breakReason?: string }>}
 */
async function captureScreenshotOnly(ctx, step, formatJournal) {
  const { screenshotDir, maxSteps, screens, actionsTaken } = ctx;

  // Device online check
  if (!adb.isDeviceOnline()) {
    ctx.consecutiveDeviceFails++;
    ctx.log.info({ attempt: ctx.consecutiveDeviceFails, max: MAX_DEVICE_FAILS }, "Device offline");
    if (ctx.consecutiveDeviceFails >= MAX_DEVICE_FAILS) {
      return { snapshot: null, directive: "break", breakReason: "device_offline" };
    }
    await sleep(3000);
    return { snapshot: null, directive: "continue" };
  }
  ctx.consecutiveDeviceFails = 0;

  const ssPath = path.join(screenshotDir, `step_${step}.png`);
  let screenshotOk = false;
  try {
    screenshotOk = adb.screencap(ssPath) && fs.existsSync(ssPath) && fs.statSync(ssPath).size > 0;
  } catch (_) {}

  if (!screenshotOk) {
    ctx.consecutiveCaptureFails++;
    ctx.log.info({ fails: ctx.consecutiveCaptureFails, max: MAX_CAPTURE_FAILS }, "Screenshot-only capture failed");
    if (ctx.consecutiveCaptureFails >= MAX_CAPTURE_FAILS) {
      ctx.totalCaptureRecoveries++;
      if (ctx.totalCaptureRecoveries > MAX_CAPTURE_RECOVERIES) {
        return { snapshot: null, directive: "break", breakReason: "capture_failed" };
      }
      const recResult = await ctx.recoveryManager.recover(SITUATION.EMPTY_SCREEN, "capture_failed", ctx);
      if (recResult.success) {
        ctx.consecutiveCaptureFails = 0;
        return { snapshot: null, directive: "continue" };
      }
      return { snapshot: null, directive: "break", breakReason: "capture_failed" };
    }
    await sleep(2000);
    return { snapshot: null, directive: "continue" };
  }

  ctx.consecutiveCaptureFails = 0;
  ctx.consecutiveDeviceFails = 0;

  const ssHash = screenshotFp.computeHash(ssPath);
  let activity = "unknown";
  try { activity = adb.getCurrentActivity(); } catch (_) {}

  const snapshot = {
    screenshotPath: ssPath,
    screenshotHash: ssHash,
    xml: "",
    xmlFailed: true,
    activity,
    step,
  };

  screens.push(snapshot);
  ctx.log.info({ hash: ssHash.slice(0, 8), activity }, "Screenshot-only capture");
  return { snapshot, directive: "proceed" };
}

/**
 * @param {Ctx} ctx
 * @param {number} step
 * @param {Function} formatJournal
 * @returns {Promise<{ snapshot: any, directive: 'proceed'|'continue'|'break', breakReason?: string }>}
 */
async function captureScreen(ctx, step, formatJournal) {
  const { screenshotDir, maxSteps, screens, actionsTaken } = ctx;

  // Screenshot-only mode: skip XML entirely
  if (ctx.screenshotOnlyMode) {
    return captureScreenshotOnly(ctx, step, formatJournal);
  }

  // C4: Device online check with ADB reconnect attempt
  if (!adb.isDeviceOnline()) {
    ctx.consecutiveDeviceFails++;
    ctx.log.info({ attempt: ctx.consecutiveDeviceFails, max: MAX_DEVICE_FAILS }, "Device offline");

    // Try ADB reconnect before giving up
    if (ctx.consecutiveDeviceFails <= MAX_DEVICE_FAILS) {
      ctx.log.info("Attempting ADB reconnect");
      const reconnected = adb.reconnectDevice();
      if (reconnected) {
        ctx.log.info("ADB reconnect succeeded — resuming");
        ctx.consecutiveDeviceFails = 0;
        await sleep(2000);
        return { snapshot: null, directive: "continue" };
      }
    }

    if (ctx.consecutiveDeviceFails >= MAX_DEVICE_FAILS) {
      return { snapshot: null, directive: "break", breakReason: "device_offline" };
    }
    await sleep(3000);
    return { snapshot: null, directive: "continue" };
  }
  ctx.consecutiveDeviceFails = 0;

  // C12: Dismiss keyboard before capture if visible
  try { adb.dismissKeyboard(); } catch (_) {}

  // Capture with retries
  const snapshot = await captureStableScreen(screenshotDir, step, 3, 2000);

  // Capture failed completely — try file-based fallback (C3)
  if (!snapshot || snapshot.error === "capture_failed") {
    ctx.consecutiveCaptureFails++;
    ctx.log.info({ fails: ctx.consecutiveCaptureFails, max: MAX_CAPTURE_FAILS }, "Screenshot capture failed");

    // C3: Try file-based capture as fallback before giving up
    if (ctx.consecutiveCaptureFails >= 2) {
      const fbPath = require("path").join(screenshotDir, `step_${step}_fb.png`);
      ctx.log.info("Trying file-based screencap fallback");
      const fbOk = adb.screencapFileBased(fbPath);
      if (fbOk) {
        ctx.log.info("File-based screencap succeeded — using fallback");
        ctx.consecutiveCaptureFails = 0;
        let xml = adb.dumpXml();
        if (!xml || isTransientEmptyXml(xml)) {
          ctx.log.info("[capture] xml empty on first try, retrying after 500ms");
          await sleep(500);
          xml = adb.dumpXml();
        }
        let activity = "unknown";
        try { activity = adb.getCurrentActivity(); } catch (_) {}
        const fbSnapshot = {
          screenshotPath: fbPath,
          xml: xml || "",
          xmlFailed: !xml || isTransientEmptyXml(xml),
          activity,
          step,
        };
        screens.push(fbSnapshot);
        return { snapshot: fbSnapshot, directive: "proceed" };
      }
    }

    if (ctx.consecutiveCaptureFails >= MAX_CAPTURE_FAILS) {
      ctx.totalCaptureRecoveries++;
      if (ctx.totalCaptureRecoveries > MAX_CAPTURE_RECOVERIES) {
        ctx.log.info({ totalRecoveries: ctx.totalCaptureRecoveries }, "Capture recovery failed — giving up");
        return { snapshot: null, directive: "break", breakReason: "capture_failed" };
      }
      ctx.log.info({ recoveryAttempt: ctx.totalCaptureRecoveries, max: MAX_CAPTURE_RECOVERIES }, "Max capture fails reached — attempting recovery");
      const recResult = await ctx.recoveryManager.recover(SITUATION.EMPTY_SCREEN, "capture_failed", ctx);
      if (recResult.success) {
        ctx.log.info("Recovery succeeded after capture failures — resuming crawl");
        ctx.consecutiveCaptureFails = 0;
        return { snapshot: null, directive: "continue" };
      }
      return { snapshot: null, directive: "break", breakReason: "capture_failed" };
    }
    await sleep(2000);
    return { snapshot: null, directive: "continue" };
  }

  // XML failed but screenshot available — vision-only fallback
  if (snapshot.xmlFailed) {
    ctx.consecutiveXmlFailedSteps++;
    ctx.log.info({ step, consecutiveXmlFails: ctx.consecutiveXmlFailedSteps }, "Vision-only step — XML unavailable");
    ctx.consecutiveCaptureFails = 0;

    // If XML has been failing persistently, try one UIAutomator restart
    if (ctx.consecutiveXmlFailedSteps >= 3 && ctx.uiAutomatorRestartAttempts < ctx.MAX_UIAUTOMATOR_RESTARTS) {
      ctx.uiAutomatorRestartAttempts++;
      ctx.log.info({ attempt: ctx.uiAutomatorRestartAttempts, max: ctx.MAX_UIAUTOMATOR_RESTARTS }, "Attempting UIAutomator restart");
      const restarted = adb.restartUiAutomator();
      if (restarted) {
        ctx.consecutiveXmlFailedSteps = 0;
        ctx.log.info("UIAutomator recovered — resuming normal capture");
        return { snapshot: null, directive: "continue" };
      }
    }

    // If we've exhausted restart attempts and XML keeps failing, switch to screenshot-only
    if (ctx.consecutiveXmlFailedSteps >= 3 && ctx.uiAutomatorRestartAttempts >= ctx.MAX_UIAUTOMATOR_RESTARTS && !ctx.screenshotOnlyMode) {
      ctx.screenshotOnlyMode = true;
      ctx.log.info("Switching to screenshot-only mode (UIAutomator unrecoverable)");
    }

    const visionOnlyFp = `vonly_step${step}`;

    // Agent path: when AGENT_LOOP=true, the LLM brain decides even when XML failed.
    // This keeps the agent in control end-to-end instead of bypassing it via vision.
    let coordDecision = null;
    if (process.env.AGENT_LOOP === "true") {
      try {
        const recentHistory = (ctx.explorationJournal || []).slice(-8).map((/** @type {any} */ j) => ({
          step: typeof j.step === "number" ? j.step : 0,
          action: typeof j.action === "string" ? j.action : "",
          outcome: typeof j.outcome === "string" ? j.outcome : "",
        }));
        const appMapSummary = ctx.appMap ? {
          totalScreens: ctx.appMap.screenNodes ? ctx.appMap.screenNodes.size : 0,
          navTabs: (ctx.appMap.navTabs || []).map((/** @type {any} */ t) => ({
            label: t.label,
            explored: !!t.explored,
            exhausted: !!t.exhausted,
          })),
        } : { totalScreens: 0, navTabs: [] };

        coordDecision = await agent.decideCoordinates({
          goal: ctx.goals || "Explore the app and discover its main features",
          credentials: ctx.credentials || null,
          packageName: ctx.packageName,
          stepNumber: step,
          maxSteps,
          visitedScreensCount: ctx.stateGraph && typeof ctx.stateGraph.uniqueStateCount === "function" ? ctx.stateGraph.uniqueStateCount() : 0,
          currentScreenType: "unknown",
          screenshotPath: snapshot.screenshotPath,
          recentHistory,
          appMapSummary,
        });
      } catch (e) {
        ctx.log.warn({ err: e && (/** @type {any} */ (e)).message }, "Agent coordinate decision failed, falling back to vision");
      }
    }

    // Legacy vision-only fallback when agent unavailable or failed
    let visionOnlyResult = null;
    if (!coordDecision && vision.budgetRemaining() > 0) {
      try {
        visionOnlyResult = await vision.getVisionGuidance(
          snapshot.screenshotPath, "",
          {
            classification: "unknown",
            triedCount: step,
            goal: ctx.plan ? ctx.plan.targets[0] : "explore the app",
            previousAction: /** @type {any} */ (ctx.lastActionOutcome),
            journal: formatJournal(),
          }
        );
      } catch (e) {
        ctx.log.warn({ err: e }, "Vision-only call failed");
      }
    }

    if (coordDecision && coordDecision.action === "tap") {
      ctx.log.info({ reasoning: coordDecision.reasoning, x: coordDecision.x, y: coordDecision.y }, "Agent vision-only tap");
      adb.tap(coordDecision.x, coordDecision.y);
      actionsTaken.push({
        step,
        type: "tap",
        description: `agent-vision: ${coordDecision.reasoning}`,
        actionKey: `tap:agent-vision:${coordDecision.x},${coordDecision.y}`,
        fromFingerprint: visionOnlyFp,
      });
      await sleep(1500);
    } else if (coordDecision && coordDecision.action === "back") {
      ctx.log.info({ reasoning: coordDecision.reasoning }, "Agent vision-only back");
      adb.pressBack();
      actionsTaken.push({
        step,
        type: "back",
        description: `agent-vision: ${coordDecision.reasoning}`,
        fromFingerprint: visionOnlyFp,
      });
      await sleep(1000);
    } else if (visionOnlyResult && visionOnlyResult.mainActions && visionOnlyResult.mainActions.length > 0) {
      const topAction = visionOnlyResult.mainActions[0];
      ctx.log.info({ description: topAction.description, x: topAction.x, y: topAction.y }, "Vision-only executing action");
      adb.tap(topAction.x, topAction.y);
      actionsTaken.push({
        step,
        type: "tap",
        description: `vision-only: ${topAction.description}`,
        actionKey: `tap:vision:${topAction.x},${topAction.y}`,
        fromFingerprint: visionOnlyFp,
      });
      await sleep(1500);
    } else {
      ctx.log.info("No vision guidance — pressing back");
      adb.pressBack();
      actionsTaken.push({ step, type: "back", description: "vision-only fallback back", fromFingerprint: visionOnlyFp });
      await sleep(1000);
    }

    if (typeof ctx.onProgress === "function") {
      ctx.onProgress({ step, totalSteps: maxSteps, action: "vision_only_step", screens: screens.length });
    }
    return { snapshot: null, directive: "continue" };
  }

  // Device went offline during capture
  if (snapshot.error === "device_offline") {
    ctx.consecutiveDeviceFails++;
    ctx.log.info({ attempt: ctx.consecutiveDeviceFails, max: MAX_DEVICE_FAILS }, "Device lost during capture");
    if (ctx.consecutiveDeviceFails >= MAX_DEVICE_FAILS) {
      return { snapshot: null, directive: "break", breakReason: "device_offline" };
    }
    await sleep(3000);
    return { snapshot: null, directive: "continue" };
  }

  ctx.consecutiveCaptureFails = 0;
  ctx.consecutiveDeviceFails = 0;
  ctx.consecutiveXmlFailedSteps = 0; // XML worked — reset

  // Loading detection — wait for content before acting
  const loadResult = await waitForContentLoad(snapshot.xml);
  if (loadResult.isLoading) {
    snapshot.xml = loadResult.xml;
  }

  snapshot.step = step;
  screens.push(snapshot);

  return { snapshot, directive: "proceed" };
}

module.exports = { captureScreen, captureStableScreen, isTransientEmptyXml };
