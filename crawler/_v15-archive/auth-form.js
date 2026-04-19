// @ts-check
"use strict";

/**
 * auth-form.js — Detects login/signup forms, fills credentials, and submits.
 *
 * @typedef {import('./types/crawl-context').CrawlContext} Ctx
 */

const adb = require("./adb");
const actions = require("./actions");
const forms = require("./forms");
const readiness = require("./readiness");
const { findBestAuthSubmitAction, makeAuthSubmitKey, hasValidationErrorText } = require("./auth-helpers");
const { AUTH_FLOW_MAX_STEPS, MAX_AUTH_FILLS, MAX_DEVICE_FAILS, MAX_SAME_AUTH_SUBMIT } = require("./crawl-context");

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Execute an action (minimal version for submit button only).
 * Returns a description string.
 * @param {any} action
 */
function executeSubmitAction(action) {
  adb.tap(action.bounds.cx, action.bounds.cy);
  return `tap(${action.bounds.cx}, ${action.bounds.cy}) on "${action.text || action.resourceId || "element"}"`;
}

/**
 * Handle auth form detection, credential filling, and submit.
 *
 * @param {Ctx} ctx
 * @param {any} snapshot
 * @param {any} screenIntent
 * @param {string} fp
 * @param {number} step
 * @param {any[]} actionsTaken
 * @param {any} metrics
 * @returns {Promise<{ handled: boolean, shouldContinue: boolean, shouldBreak: boolean, breakReason?: string }>}
 */
async function handleAuthForm(ctx, snapshot, screenIntent, fp, step, actionsTaken, metrics) {
  const noResult = { handled: false, shouldContinue: false, shouldBreak: false };

  if (!ctx.authMachine.shouldAttemptAuth()) return noResult;

  const formIntentTypes = new Set(["email_login", "email_signup", "email_entry", "phone_entry", "otp_verification"]);

  // Also allow auth_choice screens that happen to have input fields (e.g. Reddit's
  // native Compose login shows provider buttons + email/password fields together)
  const isAuthChoiceWithInputs = screenIntent.type === "auth_choice" &&
    snapshot.xml && /class="[^"]*EditText|class="[^"]*TextInputEditText/i.test(snapshot.xml);

  if (!formIntentTypes.has(screenIntent.type) && !isAuthChoiceWithInputs) return noResult;

  const formResult = forms.detectForm(snapshot.xml);
  if (!formResult.isForm) return noResult;

  const formKey = `${fp}::${formResult.fields.map((/** @type {any} */ f) => f.type).sort().join("|")}`;
  // Compose/Flutter apps produce different fingerprints each render.
  // Use a field-type-only key as a secondary dedup to avoid re-filling.
  const fieldTypeKey = `fieldTypes::${formResult.fields.map((/** @type {any} */ f) => f.type).sort().join("|")}`;
  if (ctx.handledFormScreens.has(formKey) || ctx.handledFormScreens.has(fieldTypeKey)) return noResult;

  ctx.log.info({ fields: formResult.fields.length }, "Login/signup form detected");
  const fillActions = await forms.fillForm(formResult.fields, ctx.credentials || {}, sleep);

  if (fillActions.length === 0) return noResult;

  ctx.handledFormScreens.add(formKey);
  ctx.handledFormScreens.add(fieldTypeKey);
  ctx.filledFingerprints.add(fp);

  actionsTaken.push({ step, type: "form_fill", fields: fillActions, fromFingerprint: fp });

  await readiness.waitForScreenReady({ timeoutMs: 3000 });

  const submitXml = adb.dumpXml();
  const submitCandidates = actions.extract(submitXml);
  const submitBtn = findBestAuthSubmitAction(submitCandidates);

  if (submitBtn) {
    const submitKey = makeAuthSubmitKey(submitBtn);
    const submitDescription = executeSubmitAction(submitBtn);

    // Notify state machine of form fill + submit
    ctx.authMachine.onFormFilled(submitKey);
    ctx.authFillCount = ctx.authMachine.fillCount;  // sync legacy
    ctx.authFlowActive = ctx.authMachine.isActive;  // sync legacy

    actionsTaken.push({
      step, type: "form_submit",
      description: `Tapped submit: "${submitBtn.text || submitBtn.resourceId}"`,
      fromFingerprint: fp,
    });

    ctx.log.info({ submitDescription }, "Tapped submit button after form fill");

    if (ctx.authMachine.isSubmitLooping()) {
      const xmlNow = adb.dumpXml() || "";
      const reason = hasValidationErrorText(xmlNow)
        ? "validation error after repeated submit"
        : "submit loop detected";
      ctx.log.warn({ reason }, "Abandoning auth");
      ctx.authMachine.onAuthFailed(reason);
      ctx.authFlowActive = false;  // sync legacy
      adb.pressBack();
      return { handled: true, shouldContinue: true, shouldBreak: false };
    }
  } else {
    // No submit button, but form was filled — notify state machine
    ctx.authMachine.onFormFilled(null);
    ctx.authFillCount = ctx.authMachine.fillCount;
    ctx.authFlowActive = ctx.authMachine.isActive;
    ctx.log.info("No auth submit button found after form fill");
  }

  if (!adb.ensureDeviceReady()) {
    ctx.consecutiveDeviceFails++;
    ctx.log.warn({ consecutiveDeviceFails: ctx.consecutiveDeviceFails, max: MAX_DEVICE_FAILS }, "Device not ready after form submit");
    if (ctx.consecutiveDeviceFails >= MAX_DEVICE_FAILS) {
      return { handled: true, shouldContinue: false, shouldBreak: true, breakReason: "device_offline" };
    }
  }

  const postSubmitReady = await readiness.waitForScreenReady({ timeoutMs: 5000 });
  metrics.recordReadinessWait(step, "screen_ready", postSubmitReady);
  ctx.modeManager.recordStep();
  return { handled: true, shouldContinue: true, shouldBreak: false };
}

module.exports = { handleAuthForm };
