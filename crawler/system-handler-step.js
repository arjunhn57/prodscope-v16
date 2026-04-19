"use strict";

/**
 * system-handler-step.js — System dialog handling and auth-screen bypass.
 *
 * Handles system dialogs (permissions, crash dialogs, etc.) and skips
 * auth screens when no credentials are available.
 */

const systemHandlers = require("./system-handlers");
const { SITUATION } = require("./recovery");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "system-handler-step" });

/**
 * Check for auth screens when no credentials and skip them.
 *
 * @param {boolean} hasValidCredentials
 * @param {object} screenIntent
 * @returns {{ skip: boolean }}
 */
function checkNoCredentialAuthSkip(hasValidCredentials, screenIntent) {
  const AUTH_INTENT_TYPES = new Set([
    "email_login", "email_signup", "email_entry",
    "phone_entry", "otp_verification", "auth_choice",
  ]);

  if (!hasValidCredentials && AUTH_INTENT_TYPES.has(screenIntent.type)) {
    log.info({ intentType: screenIntent.type }, "Auth screen detected but no credentials provided — pressing back to skip");
    return { skip: true };
  }

  return { skip: false };
}

/**
 * Check if this is an auth screen that should bypass system handlers.
 *
 * @param {boolean} hasValidCredentials
 * @param {object} screenIntent
 * @returns {boolean}
 */
function isAuthScreenForBypass(hasValidCredentials, screenIntent) {
  const AUTH_INTENT_TYPES = new Set([
    "email_login", "email_signup", "email_entry",
    "phone_entry", "otp_verification", "auth_choice",
  ]);
  return hasValidCredentials && AUTH_INTENT_TYPES.has(screenIntent.type);
}

/**
 * Handle system dialogs (permissions, crash dialogs, overlays).
 *
 * @param {object} ctx - CrawlContext
 * @param {object} snapshot - Screen snapshot
 * @param {object} screenIntent - Screen intent classification
 * @param {number} step - Current step number
 * @param {Array} actionsTaken - Actions array to append to
 * @returns {Promise<{ handled: boolean, shouldContinue: boolean }>}
 */
async function handleSystemDialogs(ctx, snapshot, screenIntent, step, actionsTaken) {
  const isAuthScreen = isAuthScreenForBypass(ctx.hasValidCredentials, screenIntent);

  if (isAuthScreen) {
    log.info({ intentType: screenIntent.type }, "Auth screen — bypassing system handler");
    return { handled: false, shouldContinue: false };
  }

  const sysResult = systemHandlers.check(snapshot.xml);
  if (!sysResult.handled) {
    ctx.consecutiveSysHandlerSteps = 0;
    return { handled: false, shouldContinue: false };
  }

  ctx.consecutiveSysHandlerSteps++;
  if (ctx.consecutiveSysHandlerSteps >= 5) {
    log.warn({ consecutiveSteps: ctx.consecutiveSysHandlerSteps }, "5+ consecutive system handler steps — force recovery");
    ctx.consecutiveSysHandlerSteps = 0;
    await ctx.recoveryManager.recover(SITUATION.STUCK_SAME_SCREEN, "sys_handler_stuck", ctx);
    return { handled: true, shouldContinue: true };
  }

  actionsTaken.push({
    step,
    type: "system_handler",
    handler: sysResult.handler,
    description: sysResult.action,
  });

  ctx.lastActionKey = null;
  ctx.lastActionFromFp = null;
  return { handled: true, shouldContinue: true };
}

module.exports = { checkNoCredentialAuthSkip, isAuthScreenForBypass, handleSystemDialogs };
