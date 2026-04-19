"use strict";

const { Resend } = require("resend");
const { renderReportEmail } = require("./email-renderer");

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Send the report email via Resend.
 * Returns { status, error, response } — never throws.
 *
 * @param {string} toEmail
 * @param {string|object} reportText — report JSON or stringified JSON
 * @param {number} analysesCount
 * @param {{ shareUrl?: string|null }} [options]
 */
async function sendReportEmail(toEmail, reportText, analysesCount, options = {}) {
  if (!resend) {
    return {
      status: "not_configured",
      error: "RESEND_API_KEY is missing or Resend is not initialized",
    };
  }

  const reportString =
    typeof reportText === "string" ? reportText : JSON.stringify(reportText || {});
  const shareUrl = options.shareUrl || null;

  try {
    const result = await resend.emails.send({
      from: "ProdScope <onboarding@resend.dev>",
      to: toEmail,
      subject: "Your ProdScope Analysis Report is Ready",
      html: renderReportEmail(reportString, analysesCount, { shareUrl }),
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

module.exports = { sendReportEmail };
