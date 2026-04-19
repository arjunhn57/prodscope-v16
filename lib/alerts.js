"use strict";

/**
 * alerts.js — Webhook-based alerting.
 *
 * Sends alerts via webhook (Slack/Discord/custom) on critical events.
 * Deduplicates: max 1 alert per error type per 15 minutes.
 *
 * Events:
 *   - job_failed: Crawl job failed
 *   - disk_critical: Disk usage >90%
 *   - consecutive_failures: 3+ jobs failed in a row
 *   - vision_budget_exhausted: Vision calls hit budget limit
 */

const https = require("https");
const http = require("http");
const { logger } = require("./logger");
const log = logger.child({ component: "alerts" });

// ── Deduplication ───────────────────────────────────────────────────────────

const DEDUP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const lastAlertTimes = new Map();

function shouldSend(alertType) {
  const lastSent = lastAlertTimes.get(alertType) || 0;
  if (Date.now() - lastSent < DEDUP_WINDOW_MS) return false;
  lastAlertTimes.set(alertType, Date.now());
  return true;
}

// ── Webhook sender ──────────────────────────────────────────────────────────

/**
 * Send a webhook POST with JSON body.
 * Works with Slack, Discord, and generic webhook endpoints.
 *
 * @param {string} url - Webhook URL
 * @param {object} payload - JSON payload
 * @returns {Promise<boolean>} true if sent successfully
 */
function sendWebhook(url, payload) {
  return new Promise((resolve) => {
    if (!url) { resolve(false); return; }

    try {
      const parsed = new URL(url);
      const body = JSON.stringify(payload);
      const transport = parsed.protocol === "https:" ? https : http;

      const req = transport.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 10000,
        },
        (res) => {
          resolve(res.statusCode >= 200 && res.statusCode < 300);
          res.resume(); // drain response
        }
      );

      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.write(body);
      req.end();
    } catch (e) {
      resolve(false);
    }
  });
}

// ── Alert functions ─────────────────────────────────────────────────────────

function getWebhookUrl() {
  return process.env.ALERT_WEBHOOK_URL || "";
}

/**
 * Format payload for Slack/Discord compatibility.
 */
function formatPayload(title, details, severity) {
  const emoji = severity === "critical" ? "!!!" : severity === "warning" ? "!" : "i";
  return {
    // Slack format
    text: `[${emoji}] ProdScope: ${title}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*[${severity.toUpperCase()}] ${title}*\n${details}`,
        },
      },
    ],
    // Discord format (uses content field)
    content: `**[${severity.toUpperCase()}] ProdScope:** ${title}\n${details}`,
  };
}

async function alertJobFailed(jobId, stopReason, error) {
  if (!shouldSend("job_failed")) return;
  const url = getWebhookUrl();
  if (!url) return;

  const details = `Job \`${jobId}\` failed\nStop reason: ${stopReason}\nError: ${error || "none"}`;
  await sendWebhook(url, formatPayload("Job Failed", details, "warning"));
  log.info({ jobId }, "Sent job_failed alert");
}

async function alertConsecutiveFailures(count) {
  if (!shouldSend("consecutive_failures")) return;
  const url = getWebhookUrl();
  if (!url) return;

  const details = `${count} consecutive crawl failures detected. System may need attention.`;
  await sendWebhook(url, formatPayload("Consecutive Failures", details, "critical"));
  log.info({ count }, "Sent consecutive_failures alert");
}

async function alertDiskCritical(usagePercent) {
  if (!shouldSend("disk_critical")) return;
  const url = getWebhookUrl();
  if (!url) return;

  const details = `Disk usage at ${usagePercent}%. Auto-cleanup may not be sufficient.`;
  await sendWebhook(url, formatPayload("Disk Critical", details, "critical"));
  log.info({ usagePercent }, "Sent disk_critical alert");
}

async function alertVisionBudgetExhausted(jobId, callsUsed, budget) {
  if (!shouldSend("vision_budget_exhausted")) return;
  const url = getWebhookUrl();
  if (!url) return;

  const details = `Job \`${jobId}\`: Vision budget exhausted (${callsUsed}/${budget} calls used)`;
  await sendWebhook(url, formatPayload("Vision Budget Exhausted", details, "warning"));
  log.info({ jobId, callsUsed, budget }, "Sent vision_budget_exhausted alert");
}

module.exports = {
  alertJobFailed,
  alertConsecutiveFailures,
  alertDiskCritical,
  alertVisionBudgetExhausted,
};
