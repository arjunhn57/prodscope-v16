// @ts-check
"use strict";

/**
 * recovery.js — Multi-strategy recovery manager
 *
 * When the crawler gets stuck, instead of always relaunching the app,
 * this module tries progressively more expensive strategies:
 *   1. soft_back       — press BACK 1-3 times
 *   2. navigate_target  — relaunch + replay parent-chain path to an unexplored node
 *   3. relaunch_branch  — relaunch app, land on home, pick a different direction
 *   4. deep_scroll      — scroll down to reveal new content on current screen
 *
 * Returns structured results for every recovery attempt.
 *
 * @typedef {import('./types/crawl-context').CrawlContext} Ctx
 */

const { logger } = require("../lib/logger");
const log = logger.child({ component: "recovery" });

/** @type {any} */
const defaults = require("../config/defaults");
const { MAX_GLOBAL_RECOVERIES } = require("./crawl-context");

const screenshotFp = require("./screenshot-fp");

const STRATEGY = {
  SOFT_BACK: "soft_back",
  NAVIGATE_TARGET: "navigate_target",
  RELAUNCH_BRANCH: "relaunch_branch",
  DEEP_SCROLL: "deep_scroll",
  RESTART_UIAUTOMATOR: "restart_uiautomator",
  VISION_RANDOM_TAP: "vision_random_tap",
};

const SITUATION = {
  STUCK_SAME_SCREEN: "stuck_same_screen",
  LOOP_DETECTED: "loop_detected",
  ALL_EXHAUSTED: "all_exhausted",
  DEAD_END: "dead_end",
  CREATE_FLOW_STUCK: "create_flow_stuck",
  OUT_OF_APP: "out_of_app",
  EMPTY_SCREEN: "empty_screen",
  NO_NEW_STATES: "no_new_states",
};

/**
 * Strategy escalation table: for each situation, try strategies in order.
 * First success wins. If all fail, return failure.
 */
const ESCALATION = {
  [SITUATION.STUCK_SAME_SCREEN]: [STRATEGY.SOFT_BACK, STRATEGY.DEEP_SCROLL, STRATEGY.RELAUNCH_BRANCH, STRATEGY.VISION_RANDOM_TAP],
  [SITUATION.LOOP_DETECTED]: [STRATEGY.SOFT_BACK, STRATEGY.NAVIGATE_TARGET, STRATEGY.RELAUNCH_BRANCH, STRATEGY.VISION_RANDOM_TAP],
  [SITUATION.ALL_EXHAUSTED]: [STRATEGY.NAVIGATE_TARGET, STRATEGY.RELAUNCH_BRANCH, STRATEGY.VISION_RANDOM_TAP],
  [SITUATION.DEAD_END]: [STRATEGY.SOFT_BACK, STRATEGY.RELAUNCH_BRANCH],
  [SITUATION.CREATE_FLOW_STUCK]: [STRATEGY.SOFT_BACK, STRATEGY.RELAUNCH_BRANCH],
  [SITUATION.OUT_OF_APP]: [STRATEGY.SOFT_BACK, STRATEGY.RELAUNCH_BRANCH],
  [SITUATION.EMPTY_SCREEN]: [STRATEGY.RESTART_UIAUTOMATOR, STRATEGY.RELAUNCH_BRANCH],
  [SITUATION.NO_NEW_STATES]: [STRATEGY.DEEP_SCROLL, STRATEGY.NAVIGATE_TARGET, STRATEGY.RELAUNCH_BRANCH],
};

class RecoveryManager {
  /**
   * @param {{
   *   packageName: string,
   *   launcherActivity?: string|null,
   *   stateGraph: any,
   *   adb: any,
   *   readiness: any,
   *   fingerprint: any,
   *   getHomeFingerprint: Function,
   *   sleep: Function,
   * }} deps — injected dependencies from run.js
   */
  constructor(deps) {
    this.packageName = deps.packageName;
    this.launcherActivity = deps.launcherActivity || null;
    this.graph = deps.stateGraph;
    this.adb = deps.adb;
    this.readiness = deps.readiness;
    this.fp = deps.fingerprint;
    this.getHomeFp = deps.getHomeFingerprint;
    this.sleep = deps.sleep;

    this.stats = new Map(); // strategy → { attempts, successes }
  }

  /**
   * Main entry point. Try escalating strategies for the given situation.
   *
   * @param {string} situation — one of SITUATION.*
   * @param {string} currentFp — current screen fingerprint
   * @param {Ctx} [ctx]
   * @returns {Promise<{ strategy: string, success: boolean, newFp: string|null, attempts: number, reason: string }>}
   */
  async recover(situation, currentFp, ctx) {
    // H4: Global recovery circuit breaker
    if (ctx && ctx.globalRecoveryAttempts !== undefined) {
      ctx.globalRecoveryAttempts++;
      if (ctx.globalRecoveryAttempts > MAX_GLOBAL_RECOVERIES) {
        log.info({ globalRecoveryAttempts: ctx.globalRecoveryAttempts }, "Global circuit breaker — stopping exploration");
        return {
          strategy: "circuit_breaker",
          success: false,
          newFp: null,
          attempts: 0,
          reason: "global_recovery_limit_exceeded",
        };
      }
    }

    let strategies = ESCALATION[situation] || [STRATEGY.RELAUNCH_BRANCH];

    // H4: Minimal mode after 10 total recovery attempts
    if (ctx && ctx.globalRecoveryAttempts >= 10) {
      strategies = strategies.filter((s) => s === STRATEGY.SOFT_BACK || s === STRATEGY.RELAUNCH_BRANCH);
      if (strategies.length === 0) strategies = [STRATEGY.RELAUNCH_BRANCH];
    }

    // E5: Adaptive ordering — sort by success rate after enough data
    const totalAttempts = Array.from(this.stats.values()).reduce((sum, s) => sum + s.attempts, 0);
    if (totalAttempts >= 5) {
      strategies = [...strategies].sort((a, b) => {
        const sa = this.stats.get(a);
        const sb = this.stats.get(b);
        const rateA = sa && sa.attempts > 0 ? sa.successes / sa.attempts : 0.5;
        const rateB = sb && sb.attempts > 0 ? sb.successes / sb.attempts : 0.5;
        return rateB - rateA; // higher success rate first
      });
      log.info({ situation, order: strategies, totalAttempts }, "Adaptive recovery order");
    }

    let attempts = 0;

    for (const strategy of strategies) {
      attempts++;
      log.info({ strategy, situation, attempt: attempts, totalStrategies: strategies.length }, "Trying recovery strategy");

      let result;
      try {
        switch (strategy) {
          case STRATEGY.SOFT_BACK:
            result = await this._softBack(currentFp);
            break;
          case STRATEGY.NAVIGATE_TARGET:
            result = await this._navigateTarget(currentFp);
            break;
          case STRATEGY.RELAUNCH_BRANCH:
            result = await this._relaunchBranch();
            break;
          case STRATEGY.DEEP_SCROLL:
            result = await this._deepScroll(currentFp);
            break;
          case STRATEGY.RESTART_UIAUTOMATOR:
            result = await this._restartUiAutomator(currentFp);
            break;
          case STRATEGY.VISION_RANDOM_TAP:
            result = await this._visionRandomTap(currentFp);
            break;
          default:
            result = { success: false, newFp: null, reason: "unknown_strategy" };
        }
      } catch (/** @type {any} */ e) {
        log.warn({ strategy, err: e && e.message }, "Recovery strategy threw");
        result = { success: false, newFp: null, reason: `error: ${e && e.message}` };
      }

      this._recordStat(strategy, result.success);

      if (result.success) {
        log.info({ strategy, newFp: (result.newFp || "unknown").slice(0, 8) }, "Recovery strategy succeeded");
        return {
          strategy,
          success: true,
          newFp: result.newFp,
          attempts,
          reason: result.reason,
        };
      }

      log.info({ strategy, reason: result.reason }, "Recovery strategy failed");
      // Update currentFp if the strategy moved us somewhere (even if "failed")
      if (result.newFp && result.newFp !== currentFp) {
        currentFp = result.newFp;
      }
    }

    return {
      strategy: "exhausted",
      success: false,
      newFp: null,
      attempts,
      reason: "all_strategies_failed",
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Strategy implementations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Try restarting the UIAutomator service.
   * Succeeds if XML dump works after restart.
   * @param {string} currentFp
   */
  async _restartUiAutomator(currentFp) {
    try {
      const ok = this.adb.restartUiAutomator();
      if (!ok) {
        return { success: false, newFp: null, reason: "uiautomator_restart_failed" };
      }
      await this.sleep(2000);
      const xml = this.adb.dumpXml();
      if (!xml) {
        return { success: false, newFp: null, reason: "still_no_xml_after_restart" };
      }
      const newFp = this.fp.compute(xml);
      return { success: true, newFp, reason: "uiautomator_restarted" };
    } catch (/** @type {any} */ e) {
      log.error({ err: e && e.message }, "_restartUiAutomator threw");
      return { success: false, newFp: null, reason: "uiautomator_restart_error" };
    }
  }

  /**
   * Press BACK 1-3 times. Succeeds if we land on a different screen
   * that's still in the target app.
   * @param {string} currentFp
   */
  async _softBack(currentFp) {
    const maxPresses = defaults.RECOVERY_SOFT_BACK_MAX || 3;
    const degraded = this.adb.isUiAutomatorDegraded();

    for (let i = 0; i < maxPresses; i++) {
      try {
        this.adb.pressBack();

        let newFp, pkg;
        if (degraded) {
          // Screenshot-based detection when UIAutomator is dead
          await this.sleep(1500);
          const ssPath = `/tmp/recovery_softback_${i}.png`;
          this.adb.screencap(ssPath);
          const ssHash = screenshotFp.computeHash(ssPath);
          newFp = `ss_${ssHash}`;
          try { pkg = this.adb.getCurrentPackage(); } catch (_) { pkg = ""; }
        } else {
          const ready = await this.readiness.waitForScreenReady({ timeoutMs: 3000 });
          const xml = ready.xml || this.adb.dumpXml();
          if (!xml) continue;
          newFp = this.fp.compute(xml);
          pkg = this._getPrimaryPackage(xml);
        }

        // Bail if we left the app
        if (pkg && pkg !== this.packageName && pkg !== "android") {
          return { success: false, newFp, reason: "left_app" };
        }

        // Bail if we're on the home fingerprint (don't want to back out further)
        const homeFp = this.getHomeFp();
        if (homeFp && newFp === homeFp) {
          return { success: true, newFp, reason: "reached_home" };
        }

        if (newFp !== currentFp) {
          return { success: true, newFp, reason: "screen_changed" };
        }
      } catch (/** @type {any} */ e) {
        log.error({ iteration: i, err: e && e.message }, "_softBack iteration threw");
        continue;
      }
    }

    return { success: false, newFp: null, reason: "no_change_after_backs" };
  }

  /**
   * Relaunch the app, then try to replay the parent-chain path
   * to an unexplored/underexplored target.
   * @param {string} currentFp
   */
  async _navigateTarget(currentFp) {
    const targets = this.graph.getUnexploredTargets(currentFp, 3);
    if (targets.length === 0) {
      return { success: false, newFp: null, reason: "no_unexplored_targets" };
    }

    // Relaunch first to get to a known state (home screen)
    await this._doRelaunch();

    // Try each target's path
    for (const target of targets) {
      const replayResult = await this._replayPath(target.path);
      if (replayResult.success) {
        return {
          success: true,
          newFp: replayResult.newFp,
          reason: `navigated_to_${target.fp.slice(0, 8)}`,
        };
      }
    }

    // We're at least on the home screen after relaunch
    const homeFp = this.getHomeFp();
    return {
      success: homeFp ? true : false,
      newFp: homeFp || null,
      reason: "path_replay_failed_at_home",
    };
  }

  /**
   * Hard relaunch: kill and restart the app via monkey.
   * Succeeds if we end up in the target app.
   */
  async _relaunchBranch() {
    try {
      await this._doRelaunch();

      const ready = await this.readiness.waitForScreenReady({ timeoutMs: 5000 });
      const xml = ready.xml || this.adb.dumpXml();

      if (!xml || xml.trim() === "") {
        // UIAutomator may be dead — check if app is at least in foreground via ADB
        try {
          const currentPkg = this.adb.getCurrentPackage();
          if (currentPkg === this.packageName) {
            log.info("No XML after relaunch but app is in foreground — treating as success");
            const ssPath = `/tmp/recovery_relaunch.png`;
            this.adb.screencap(ssPath);
            const ssHash = screenshotFp.computeHash(ssPath);
            return { success: true, newFp: `ss_${ssHash}`, reason: "relaunched_screenshot_only" };
          }
        } catch (_) {}
        return { success: false, newFp: null, reason: "no_xml_after_relaunch" };
      }

      const newFp = this.fp.compute(xml);
      const pkg = this._getPrimaryPackage(xml);

      if (pkg === this.packageName || pkg === "android") {
        return { success: true, newFp, reason: "relaunched" };
      }

      return { success: false, newFp, reason: "wrong_package_after_relaunch" };
    } catch (/** @type {any} */ e) {
      log.error({ err: e && e.message }, "_relaunchBranch threw");
      return { success: false, newFp: null, reason: "relaunch_error" };
    }
  }

  /**
   * Scroll down to reveal new content. Succeeds if the screen fingerprint
   * changes after scrolling (new content loaded).
   * Uses screenshot hash comparison when UIAutomator is degraded.
   * @param {string} currentFp
   */
  async _deepScroll(currentFp) {
    const maxScrolls = defaults.RECOVERY_DEEP_SCROLL_MAX || 3;
    const degraded = this.adb.isUiAutomatorDegraded();

    let prevSsHash = null;
    if (degraded) {
      const ssPath = `/tmp/recovery_ds_pre_${Date.now()}.png`;
      this.adb.screencap(ssPath);
      prevSsHash = screenshotFp.computeHash(ssPath);
    }

    for (let i = 0; i < maxScrolls; i++) {
      this.adb.swipe(540, 1600, 540, 800, 400);
      await this.sleep(1000);

      if (degraded) {
        const ssPath = `/tmp/recovery_ds_${Date.now()}_${i}.png`;
        this.adb.screencap(ssPath);
        const ssHash = screenshotFp.computeHash(ssPath);
        if (prevSsHash && screenshotFp.hammingDistance(ssHash, prevSsHash) > 8) {
          return { success: true, newFp: `ss_${ssHash}`, reason: "new_content_after_scroll_vision" };
        }
        prevSsHash = ssHash;
      } else {
        const xml = this.adb.dumpXml();
        if (!xml) continue;
        const newFp = this.fp.compute(xml);
        if (newFp !== currentFp) {
          return { success: true, newFp, reason: "new_content_after_scroll" };
        }
      }
    }

    return { success: false, newFp: null, reason: "no_new_content_after_scroll" };
  }

  /**
   * Last-resort recovery: try vision-guided taps, then blind random taps.
   * Only fires after all deterministic strategies have failed.
   * @param {string} currentFp
   */
  async _visionRandomTap(currentFp) {
    const vision = require("./vision");
    const maxBlindTaps = 3;
    const ts = Date.now();

    const preSSPath = `/tmp/recovery_rnd_pre_${ts}.png`;
    this.adb.screencap(preSSPath);
    const preSsHash = screenshotFp.computeHash(preSSPath);

    // Strategy A: Vision-guided tap (if recovery budget allows — H3)
    if (vision.recoveryBudgetRemaining() > 0) {
      try {
        const guidance = await vision.getVisionGuidance(preSSPath, "", {
          classification: "recovery_random_tap",
          triedCount: 0,
          goal: "Find any untapped interactive element on this screen — buttons, links, cards, icons. Suggest 2-3 tappable items.",
        });
        if (guidance && guidance.mainActions && guidance.mainActions.length > 0) {
          const idx = Math.floor(Math.random() * guidance.mainActions.length);
          const action = guidance.mainActions[idx];
          log.info({ description: action.description, x: action.x, y: action.y }, "Vision-guided tap");
          this.adb.tap(action.x, action.y);
          await this.sleep(1500);

          const postSSPath = `/tmp/recovery_rnd_post_v_${ts}.png`;
          this.adb.screencap(postSSPath);
          const postSsHash = screenshotFp.computeHash(postSSPath);
          if (screenshotFp.hammingDistance(preSsHash, postSsHash) > 10) {
            return { success: true, newFp: `ss_${postSsHash}`, reason: "vision_random_tap_changed" };
          }
        }
      } catch (/** @type {any} */ e) {
        log.warn({ err: e && e.message }, "Vision random tap failed");
      }
    }

    // Strategy B: Blind random taps in content area (avoid status bar & nav bar)
    for (let i = 0; i < maxBlindTaps; i++) {
      const x = 100 + Math.floor(Math.random() * 880);   // 100-980
      const y = 250 + Math.floor(Math.random() * 1700);   // 250-1950
      log.info({ tap: i + 1, totalTaps: maxBlindTaps, x, y }, "Blind random tap");
      this.adb.tap(x, y);
      await this.sleep(1500);

      const postSSPath = `/tmp/recovery_rnd_post_${ts}_${i}.png`;
      this.adb.screencap(postSSPath);
      const postSsHash = screenshotFp.computeHash(postSSPath);
      if (screenshotFp.hammingDistance(preSsHash, postSsHash) > 10) {
        return { success: true, newFp: `ss_${postSsHash}`, reason: "blind_random_tap_changed" };
      }
    }

    return { success: false, newFp: null, reason: "random_taps_no_change" };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Core relaunch logic — force-stop, then am start with launcher intent.
   * Falls back to monkey if am start fails. Retries once on failure.
   */
  async _doRelaunch() {
    // Press back to dismiss any overlays
    this.adb.pressBack();
    await this.sleep(300);

    // Force-stop the app to clear any stuck state
    this.adb.run(`adb shell am force-stop ${this.packageName}`, { ignoreError: true });
    await this.sleep(500);

    // Try am start with explicit component if we know the launcher activity
    let launched = false;
    if (this.launcherActivity) {
      const startResult = this.adb.run(
        `adb shell am start -n ${this.packageName}/${this.launcherActivity}`,
        { ignoreError: true }
      );
      const startOutput = String(startResult || '');
      launched = !startOutput.includes('Error') && !startOutput.includes('does not have');
      if (!launched) {
        log.info("am start -n failed, trying generic intent");
      }
    }

    if (!launched) {
      // Generic intent launch
      const startResult = this.adb.run(
        `adb shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${this.packageName}`,
        { ignoreError: true }
      );
      const startOutput = String(startResult || '');
      if (startOutput.includes('Error') || startOutput.includes('does not have')) {
        log.warn("am start failed, falling back to monkey");
        this.adb.run(
          `adb shell monkey -p ${this.packageName} -c android.intent.category.LAUNCHER 1`,
          { ignoreError: true }
        );
      }
    }

    // Wait for the app to reach foreground with a longer timeout
    const foreground = await this.readiness.waitForAppForeground(this.packageName, { timeoutMs: 8000 });

    // If still not in foreground, try once more with monkey
    if (!foreground || !foreground.success) {
      log.warn("First launch attempt failed, retrying with monkey");
      await this.sleep(500);
      this.adb.run(
        `adb shell monkey -p ${this.packageName} -c android.intent.category.LAUNCHER 1`,
        { ignoreError: true }
      );
      await this.readiness.waitForAppForeground(this.packageName, { timeoutMs: 8000 });
    }
  }

  /**
   * Replay a parent-chain path: execute each step's action,
   * verifying we're on the expected screen before each action.
   * Aborts on fingerprint mismatch (app state diverged).
   *
   * @param {Array<{ fp: string, actionKey: string|null }>} path
   * @returns {Promise<{ success: boolean, newFp: string|null, reason: string }>}
   */
  async _replayPath(path) {
    const maxSteps = defaults.RECOVERY_PATH_REPLAY_MAX_STEPS || 8;
    let lastFp = null;

    for (let i = 0; i < path.length && i < maxSteps; i++) {
      const step = path[i];
      if (!step.actionKey) {
        // Root node — just verify we're here
        const xml = this.adb.dumpXml();
        lastFp = xml ? this.fp.compute(xml) : null;
        continue;
      }

      // Parse actionKey to extract tap coordinates
      // Format: "tap:resourceId:cx,cy" or "tap::cx,cy"
      const tapMatch = step.actionKey.match(/^tap:.*?:(\d+),(\d+)$/);
      if (!tapMatch) {
        return { success: false, newFp: lastFp, reason: `unparseable_action: ${step.actionKey}` };
      }

      const cx = parseInt(tapMatch[1], 10);
      const cy = parseInt(tapMatch[2], 10);
      this.adb.tap(cx, cy);

      const ready = await this.readiness.waitForScreenReady({ timeoutMs: 3000 });
      const xml = ready.xml || this.adb.dumpXml();
      lastFp = xml ? this.fp.compute(xml) : null;

      // If we reached the target (last step), it's a success
      if (i === path.length - 1 && lastFp) {
        return { success: true, newFp: lastFp, reason: "path_complete" };
      }
    }

    return {
      success: lastFp !== null,
      newFp: lastFp,
      reason: lastFp ? "partial_path" : "path_failed",
    };
  }

  /**
   * Extract primary package from XML.
   * @param {string} xml
   */
  _getPrimaryPackage(xml) {
    if (!xml) return "";
    const matches = [...xml.matchAll(/package="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
    if (!matches.length) return "";
    /** @type {Record<string, number>} */
    const counts = {};
    for (const pkg of matches) counts[pkg] = (counts[pkg] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  /**
   * Track strategy success rates.
   * @param {string} strategy
   * @param {boolean} success
   */
  _recordStat(strategy, success) {
    if (!this.stats.has(strategy)) {
      this.stats.set(strategy, { attempts: 0, successes: 0 });
    }
    const s = this.stats.get(strategy);
    s.attempts++;
    if (success) s.successes++;
  }

  /** Get recovery statistics for crawl artifacts. */
  getStats() {
    /** @type {Record<string, any>} */
    const result = {};
    for (const [strategy, data] of this.stats) {
      result[strategy] = { ...data };
    }
    return result;
  }
}

module.exports = { RecoveryManager, STRATEGY, SITUATION, ESCALATION };
