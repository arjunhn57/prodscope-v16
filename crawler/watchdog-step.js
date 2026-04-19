"use strict";

/**
 * watchdog-step.js — Per-step emulator health check.
 *
 * Runs every N steps to catch emulator freezes, ADB disconnects, and ANR before
 * they cascade into capture failures.
 */

const { logger } = require("../lib/logger");
const log = logger.child({ component: "watchdog-step" });

/**
 * Run the watchdog health check and attempt recovery if unhealthy.
 *
 * @param {object} ctx - CrawlContext (needs ctx.watchdog)
 * @returns {Promise<{ shouldContinue: boolean, shouldBreak: boolean }>}
 */
async function runWatchdogCheck(ctx) {
  if (!ctx.watchdog) return { shouldContinue: false, shouldBreak: false };

  const health = ctx.watchdog.checkHealth();
  if (health.healthy) return { shouldContinue: false, shouldBreak: false };

  log.warn({ action: health.action, detail: health.detail }, "Unhealthy");
  const recovered = await ctx.watchdog.recover(health.action);

  if (!recovered) {
    return { shouldContinue: false, shouldBreak: true };
  }

  if (ctx.watchdog.reportProgress) ctx.watchdog.reportProgress();
  return { shouldContinue: true, shouldBreak: false };
}

module.exports = { runWatchdogCheck };
