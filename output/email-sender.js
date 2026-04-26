"use strict";

const { Resend } = require("resend");
const { renderReportEmail } = require("./email-renderer");

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Phase C2 (2026-04-26): from-name + from-email come from env so the
 * sender feels personal (a founder's name) rather than "noreply". Falls
 * back to the original ProdScope onboarding identity when env is absent.
 *
 * Set in production:
 *   PRODSCOPE_FROM_NAME="Arjun (ProdScope)"
 *   PRODSCOPE_FROM_EMAIL="arjun@prodscope.app"
 */
const FROM_NAME = process.env.PRODSCOPE_FROM_NAME || "ProdScope";
const FROM_EMAIL = process.env.PRODSCOPE_FROM_EMAIL || "onboarding@resend.dev";
const FROM_HEADER = `${FROM_NAME} <${FROM_EMAIL}>`;

/**
 * Build the subject line. Specific app + package gets the email past
 * "auto-deleted boilerplate" filter in the recipient's brain.
 *
 * @param {{appName?: string, packageName?: string}} payload
 */
function buildSubject({ appName, packageName }) {
  if (appName && packageName) {
    return `ProdScope diligence — ${appName} (${packageName})`;
  }
  if (appName) return `ProdScope diligence — ${appName}`;
  if (packageName) return `ProdScope diligence — ${packageName}`;
  return "Your ProdScope diligence report is ready";
}

/**
 * Send the report email via Resend. Two call signatures, kept compatible:
 *
 * Modern (preferred):
 *   sendReportEmail(toEmail, payload)
 *   payload: {
 *     report,                  // V1 report (string or object)
 *     v2Report,                // V2 report (object|null)
 *     executiveSummary,        // editorial summary (object|null)
 *     appName,
 *     packageName,
 *     jobId,
 *     shareUrl,
 *     analysesCount,           // legacy field, optional
 *   }
 *
 * Legacy (kept for callers that haven't migrated yet):
 *   sendReportEmail(toEmail, reportText, analysesCount, { shareUrl })
 *
 * Returns { status, error?, response? } — never throws.
 */
async function sendReportEmail(toEmail, arg2, arg3, arg4) {
  if (!resend) {
    return {
      status: "not_configured",
      error: "RESEND_API_KEY is missing or Resend is not initialized",
    };
  }

  // Distinguish modern (payload object with named fields) from legacy
  // (reportText string + analysesCount number).
  const isModern =
    arg2 &&
    typeof arg2 === "object" &&
    !Array.isArray(arg2) &&
    (arg2.v2Report !== undefined ||
      arg2.executiveSummary !== undefined ||
      arg2.appName !== undefined ||
      arg2.packageName !== undefined);

  let payload;
  let subject;
  if (isModern) {
    payload = arg2;
    subject = buildSubject({
      appName: payload.appName,
      packageName: payload.packageName,
    });
  } else {
    payload = {
      report: arg2,
      shareUrl: (arg4 && arg4.shareUrl) || null,
      analysesCount: arg3,
    };
    subject = "Your ProdScope Analysis Report is Ready";
  }

  try {
    const result = await resend.emails.send({
      from: FROM_HEADER,
      to: toEmail,
      subject,
      html: renderReportEmail(payload),
    });

    if (result && result.error) {
      return {
        status: "failed",
        error: result.error.message || JSON.stringify(result.error),
        response: result,
      };
    }

    return { status: "sent", response: result };
  } catch (err) {
    return { status: "failed", error: err.message };
  }
}

module.exports = { sendReportEmail, buildSubject };
