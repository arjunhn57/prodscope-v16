// @ts-check
"use strict";

/**
 * outcome-tracker.js — Post-action outcome analysis.
 *
 * After each action, captures the post-action screen, classifies the transition
 * (new_screen, same_screen, left_app, back_to_known), records outcomes in the
 * state graph, tracks ineffective taps, and updates the exploration journal.
 *
 * @typedef {import('./types/crawl-context').CrawlContext} Ctx
 */

const fingerprint = require("./fingerprint");
const screenshotFp = require("./screenshot-fp");
const actions = require("./actions");
const adb = require("./adb");
const { SITUATION } = require("./recovery");
const {
  MAX_DEVICE_FAILS, MAX_CAPTURE_FAILS,
  MAX_CAPTURE_RECOVERIES, JOURNAL_MAX,
} = require("./crawl-context");

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Process the outcome of an executed action.
 *
 * @param {Ctx} ctx - CrawlContext
 * @param {{
 *   fp: string,
 *   actionKey: string,
 *   decision: any,
 *   classification: any,
 *   postSnapshot: any,
 *   step: number,
 *   readyResult: any,
 *   preActionTimestamp: number,
 *   getPrimaryPackage: Function,
 *   isAllowedNonTargetPackage: Function,
 *   isTransientEmptyXml: Function,
 *   stateGraph: any,
 *   metrics: any,
 * }} params
 * @returns {Promise<{ shouldContinue: boolean, shouldBreak: boolean, breakReason?: string }>}
 */
async function processOutcome(ctx, params) {
  const {
    fp, actionKey, decision, classification,
    postSnapshot, step, readyResult, preActionTimestamp,
    getPrimaryPackage, isAllowedNonTargetPackage, isTransientEmptyXml,
    stateGraph, metrics,
  } = params;

  const packageName = ctx.packageName;
  const launcherActivity = ctx.launcherActivity;

  ctx.log.info({
    step,
    screenshotOnlyMode: !!ctx.screenshotOnlyMode,
    hasPostSnapshot: !!postSnapshot,
    postError: postSnapshot && postSnapshot.error,
    postHasXml: !!(postSnapshot && postSnapshot.xml),
    postXmlTransient: postSnapshot ? isTransientEmptyXml(postSnapshot.xml) : null,
  }, "processOutcome enter");

  // Screenshot-based outcome tracking
  // Both screenshotOnlyMode (XML dump permanently failed) and visionFirstMode
  // (V2 vision-first loop) need screenshot-hash state equivalence — XML
  // fingerprints collapse visually distinct Compose/RN screens into one state.
  if ((ctx.screenshotOnlyMode || ctx.visionFirstMode) && postSnapshot && postSnapshot.screenshotPath && !postSnapshot.error) {
    const postExact = screenshotFp.computeExactHash(postSnapshot.screenshotPath);
    const postFp = `ss_${postExact}`;
    stateGraph.addTransition(fp, actionKey, postFp);

    // ── AppMap: Register child screen on transition ──
    if (postFp !== fp) {
      ctx.appMap.registerScreen(postFp, 0, fp, actionKey);
      ctx.appMap.pushScreen(postFp);
    }

    const changed = postFp !== fp;
    const outcomeType = changed ? "screen_changed" : "no_change";

    ctx.lastActionOutcome = {
      action: { type: decision.action.type, target: decision.action.text || "" },
      outcome: { type: outcomeType, postActivity: postSnapshot.activity || null },
    };

    ctx.explorationJournal.push({
      step, screen: classification ? (classification.feature || classification.type || "unknown") : "unknown",
      action: decision.action.text || decision.action.type || "unknown",
      outcome: outcomeType, isNew: changed,
    });
    if (ctx.explorationJournal.length > JOURNAL_MAX) ctx.explorationJournal.shift();

    if (!changed) {
      stateGraph.recordOutcome(fp, actionKey, "ineffective", {});
      metrics.recordActionOutcome(step, "ineffective", "same_screen");
      ctx.consecutiveIneffectiveTaps++;
      if (ctx.consecutiveIneffectiveTaps >= 3) {
        ctx.log.info({ count: ctx.consecutiveIneffectiveTaps }, "Consecutive ineffective taps (screenshot-only) — pressing back");
        adb.pressBack();
        await sleep(1000);
        ctx.consecutiveIneffectiveTaps = 0;
        ctx.modeManager.recordStep();
        return { shouldContinue: true, shouldBreak: false };
      }
    } else {
      ctx.consecutiveIneffectiveTaps = 0;
      stateGraph.recordOutcome(fp, actionKey, "ok", {});
      metrics.recordActionOutcome(step, "ok", "screen_changed");
    }

    return { shouldContinue: false, shouldBreak: false };
  }

  if (postSnapshot && !postSnapshot.error && !isTransientEmptyXml(postSnapshot.xml)) {
    const postFp = fingerprint.compute(postSnapshot.xml);
    stateGraph.addTransition(fp, actionKey, postFp);

    // ── AppMap: Register child screen on transition ──
    if (postFp !== fp) {
      ctx.appMap.registerScreen(postFp, 0, fp, actionKey);
      ctx.appMap.pushScreen(postFp);
    }

    // Classify transition type
    let transitionType = "same_screen";
    const postPkg = getPrimaryPackage(postSnapshot.xml);
    if (postFp !== fp) {
      if (postPkg && postPkg !== packageName && !isAllowedNonTargetPackage(postPkg)) {
        transitionType = "left_app";
      } else {
        transitionType = stateGraph.isVisited(postFp) ? "back_to_known" : "new_screen";
      }
    }

    // Outcome feedback for the next vision call
    const outcomeType = postFp === fp ? "no_change"
      : transitionType === "left_app" ? "left_app"
        : transitionType === "new_screen" ? "new_screen"
          : "known_screen";

    ctx.lastActionOutcome = {
      action: {
        type: decision.action.type,
        target: decision.action.text || decision.action.resourceId || decision.action.contentDesc || "",
      },
      outcome: {
        type: outcomeType,
        postActivity: postSnapshot.activity || null,
      },
    };

    // Exploration journal
    ctx.explorationJournal.push({
      step,
      screen: classification ? (classification.feature || classification.type || "unknown") : "unknown",
      action: decision.action.text || decision.action.type || "unknown",
      outcome: outcomeType,
      isNew: transitionType === "new_screen",
    });
    if (ctx.explorationJournal.length > JOURNAL_MAX) ctx.explorationJournal.shift();

    const settleMeta = { settleTimeMs: readyResult.elapsedMs };

    // Ineffective tap tracking
    if (postFp === fp) {
      stateGraph.recordOutcome(fp, actionKey, "ineffective", settleMeta);
      metrics.recordActionOutcome(step, "ineffective", transitionType);
      ctx.consecutiveIneffectiveTaps++;

      if (ctx.consecutiveIneffectiveTaps >= 3) {
        ctx.log.info({ count: ctx.consecutiveIneffectiveTaps }, "Consecutive ineffective taps — forcing recovery");
        if (fp === ctx.homeFingerprint) {
          await ctx.recoveryManager.recover(SITUATION.DEAD_END, fp, ctx);
        } else {
          adb.pressBack();
          await sleep(1000);
          // Verify app is still in foreground after BACK
          const postBackXml = adb.dumpXml() || "";
          const postBackPkg = getPrimaryPackage(postBackXml);
          if (postBackPkg && postBackPkg !== packageName) {
            ctx.log.info({ postBackPkg, packageName }, "BACK dropped to other package — relaunching");
            if (launcherActivity) {
              adb.run(`adb shell am start -n ${packageName}/${launcherActivity}`, { ignoreError: true });
            } else {
              adb.run(`adb shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, { ignoreError: true });
            }
            await sleep(2000);
          }
        }
        ctx.consecutiveIneffectiveTaps = 0;
        ctx.modeManager.recordStep();
        return { shouldContinue: true, shouldBreak: false };
      }
    } else {
      ctx.consecutiveIneffectiveTaps = 0;
      // Check for dead-end: screen with no interactable elements
      const postActions = actions.extract(postSnapshot.xml, new Set());
      const hasUsefulActions = postActions.some((/** @type {any} */ a) => a.type !== "back");
      if (!hasUsefulActions) {
        const prevOutcome = stateGraph.getOutcome(fp, actionKey);
        if (prevOutcome === "dead_end_1") {
          stateGraph.recordOutcome(fp, actionKey, "dead_end", settleMeta);
          metrics.recordActionOutcome(step, "dead_end", transitionType);
          ctx.log.info({ actionKey }, "Action -> dead_end (permanent, 2nd time)");
        } else {
          stateGraph.recordOutcome(fp, actionKey, "dead_end_1", settleMeta);
          metrics.recordActionOutcome(step, "dead_end_1", transitionType);
          ctx.log.info({ actionKey }, "Action -> dead_end_1 (will retry once after recovery)");
          await ctx.recoveryManager.recover(SITUATION.DEAD_END, fp, ctx);
        }
      } else {
        stateGraph.recordOutcome(fp, actionKey, "ok", settleMeta);
        metrics.recordActionOutcome(step, "ok", transitionType);
      }
    }
  } else if (postSnapshot && postSnapshot.error === "device_offline") {
    ctx.consecutiveDeviceFails++;
    ctx.log.warn({ consecutiveDeviceFails: ctx.consecutiveDeviceFails, max: MAX_DEVICE_FAILS }, "Device lost during post-action capture");
    if (ctx.consecutiveDeviceFails >= MAX_DEVICE_FAILS) {
      return { shouldContinue: false, shouldBreak: true, breakReason: "device_offline" };
    }
  } else if (postSnapshot && postSnapshot.error === "capture_failed") {
    ctx.consecutiveCaptureFails++;
    ctx.log.warn({ consecutiveCaptureFails: ctx.consecutiveCaptureFails, max: MAX_CAPTURE_FAILS }, "Post-action capture failed");
    if (ctx.consecutiveCaptureFails >= MAX_CAPTURE_FAILS) {
      ctx.totalCaptureRecoveries++;
      if (ctx.totalCaptureRecoveries > MAX_CAPTURE_RECOVERIES) {
        ctx.log.error({ totalCaptureRecoveries: ctx.totalCaptureRecoveries }, "Post-action capture recovery exhausted — giving up");
        return { shouldContinue: false, shouldBreak: true, breakReason: "capture_failed" };
      }
      ctx.log.warn({ totalCaptureRecoveries: ctx.totalCaptureRecoveries, max: MAX_CAPTURE_RECOVERIES }, "Max post-action capture fails — attempting recovery");
      const recResult = await ctx.recoveryManager.recover(SITUATION.EMPTY_SCREEN, "capture_failed", ctx);
      if (recResult.success) {
        ctx.log.info("Recovery succeeded after post-action capture failures — resuming");
        ctx.consecutiveCaptureFails = 0;
        return { shouldContinue: true, shouldBreak: false };
      }
      return { shouldContinue: false, shouldBreak: true, breakReason: "capture_failed" };
    }
  }

  return { shouldContinue: false, shouldBreak: false };
}

module.exports = { processOutcome };
