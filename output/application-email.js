"use strict";

const { Resend } = require("resend");

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderApplicationEmail(application) {
  const {
    id,
    name,
    email,
    appName,
    playStoreUrl,
    whyNow,
    ip,
    userAgent,
  } = application;

  const playStoreRow = playStoreUrl
    ? `<tr><td style="padding:6px 0;color:#6b7280;width:140px;">Play Store</td><td style="padding:6px 0;"><a href="${escapeHtml(playStoreUrl)}" style="color:#6C47FF;">${escapeHtml(playStoreUrl)}</a></td></tr>`
    : "";
  const whyNowRow = whyNow
    ? `<tr><td style="padding:6px 0;color:#6b7280;vertical-align:top;">Why now</td><td style="padding:6px 0;">${escapeHtml(whyNow)}</td></tr>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#6b7280;font-weight:600;">ProdScope · Design partner</div>
    <h1 style="margin:8px 0 16px;font-size:20px;color:#111;">New application from ${escapeHtml(name)}</h1>
    <table style="width:100%;font-size:14px;color:#111;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#6b7280;width:140px;">Name</td><td style="padding:6px 0;">${escapeHtml(name)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;"><a href="mailto:${escapeHtml(email)}" style="color:#6C47FF;">${escapeHtml(email)}</a></td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">App name</td><td style="padding:6px 0;">${escapeHtml(appName)}</td></tr>
      ${playStoreRow}
      ${whyNowRow}
      <tr><td style="padding:6px 0;color:#6b7280;">Application ID</td><td style="padding:6px 0;font-family:monospace;font-size:12px;">${escapeHtml(id)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">IP</td><td style="padding:6px 0;font-family:monospace;font-size:12px;">${escapeHtml(ip || "—")}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top;">User agent</td><td style="padding:6px 0;font-family:monospace;font-size:11px;word-break:break-all;">${escapeHtml(userAgent || "—")}</td></tr>
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Stored in the <code>design_partner_applications</code> table. Review at /admin/partners.</p>
  </div>
</body></html>`;
}

/**
 * Send an admin notification for a new design-partner application.
 * Never throws — returns { status, error? } so the route handler can
 * continue responding success even if notification fails.
 *
 * @param {Array<string>} adminEmails
 * @param {object} application
 * @returns {Promise<{status: 'sent'|'failed'|'not_configured'|'skipped', error?: string, response?: any}>}
 */
async function sendApplicationNotification(adminEmails, application) {
  if (!resend) {
    return {
      status: "not_configured",
      error: "RESEND_API_KEY is missing or Resend is not initialized",
    };
  }
  if (!Array.isArray(adminEmails) || adminEmails.length === 0) {
    return { status: "skipped", error: "No admin emails configured" };
  }

  try {
    const result = await resend.emails.send({
      from: "ProdScope <onboarding@resend.dev>",
      to: adminEmails,
      subject: `[ProdScope] Design partner application — ${application.name}`,
      html: renderApplicationEmail(application),
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

module.exports = { sendApplicationNotification, renderApplicationEmail };
