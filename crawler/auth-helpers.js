"use strict";

/**
 * auth-helpers.js — Shared auth scoring helpers used by auth-choice, auth-form,
 * and priority-adjustments modules.
 */

const actions = require("./actions");

/**
 * Score an action's likelihood of being the "submit" button on an auth screen.
 * Higher score = more likely submit.
 */
function authSubmitScore(action, screenIntentType = "unknown") {
  const haystack = `${action.text || ""} ${action.contentDesc || ""} ${action.resourceId || ""}`.toLowerCase();
  const cls = (action.className || "").toLowerCase();

  if (screenIntentType === "email_login") {
    if (/(sign in|signin|log in|login)/i.test(haystack)) return 200;
    if (/(continue|next|submit|done|finish|verify|confirm)/i.test(haystack)) return 120;
    if (/(sign up|signup|create account|register)/i.test(haystack)) return 10;
  }

  if (screenIntentType === "email_signup") {
    if (/(sign up|signup|create account|register)/i.test(haystack)) return 200;
    if (/(continue|next|submit|done|finish|verify|confirm)/i.test(haystack)) return 120;
    if (/(sign in|signin|log in|login)/i.test(haystack)) return 20;
  }

  if (screenIntentType === "phone_entry") {
    if (/\bnext\b|continue|submit|proceed/.test(haystack)) return 180;
    if (/(sign up|signup|create account|register|sign in|signin|log in|login)/i.test(haystack)) return 40;
  }

  if (/(sign in|signin|log in|login)/i.test(haystack)) return 130;
  if (/(continue|next|submit|done|finish|verify|confirm|get started|start)/i.test(haystack)) return 110;
  if (/(sign up|signup|create account|register)/i.test(haystack)) return 90;
  if (cls.includes("button") && haystack.trim()) return 80;
  if (action.type === actions.ACTION_TYPES.TAP && haystack.trim()) return 60;
  return 0;
}

/**
 * Find the best auth submit action from a list of candidates.
 */
function findBestAuthSubmitAction(candidates, screenIntentType = "unknown") {
  const submitCandidates = candidates.filter((a) => {
    if (a.type !== actions.ACTION_TYPES.TAP) return false;
    const haystack = `${a.text || ""} ${a.contentDesc || ""} ${a.resourceId || ""}`.toLowerCase();
    return /(sign up|signup|create account|register|sign in|signin|log in|login|continue|next|submit|done|finish|verify|confirm|get started|start)/i.test(haystack);
  });

  if (!submitCandidates.length) return null;
  submitCandidates.sort((a, b) => authSubmitScore(b, screenIntentType) - authSubmitScore(a, screenIntentType));
  return submitCandidates[0];
}

/**
 * Create a deduplication key for an auth submit action.
 */
function makeAuthSubmitKey(action) {
  return (action.text || action.resourceId || action.contentDesc || "auth_submit_unknown")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if XML contains validation error text (wrong password, etc.).
 */
function hasValidationErrorText(xml) {
  if (!xml) return false;
  return /(invalid|required|already exists|already registered|password must|enter a valid|try again|error|incorrect|failed|unable|not available)/i.test(xml);
}

module.exports = { authSubmitScore, findBestAuthSubmitAction, makeAuthSubmitKey, hasValidationErrorText };
