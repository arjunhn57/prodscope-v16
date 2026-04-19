"use strict";

/**
 * magic-link.js — HMAC-based shareable link tokens for report URLs.
 *
 * Each crawl job has a random UUID. We sign `${jobId}.v1` with HMAC-SHA256
 * using MAGIC_LINK_SECRET and include the signature as a `token` query param.
 * Anyone with the link can view the report without logging in (read-only),
 * but forgery requires the server-side secret.
 *
 * For Phase 7 pilot: no expiry, no revocation — rotate MAGIC_LINK_SECRET to
 * invalidate all outstanding links at once. Day 4/later can add per-job
 * revocation via a DB flag if needed.
 */

const crypto = require("crypto");

const VERSION = "v1";

function getSecret() {
  const s = process.env.MAGIC_LINK_SECRET;
  if (!s || s.length < 32) return null;
  return s;
}

/**
 * Sign a jobId with the configured secret.
 * Returns hex string, or null if the secret is missing/too short.
 */
function signJobToken(jobId) {
  const secret = getSecret();
  if (!secret || !jobId) return null;
  const payload = `${jobId}.${VERSION}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Verify a token matches a jobId.
 * Uses constant-time comparison to prevent timing attacks.
 */
function verifyJobToken(jobId, token) {
  if (!jobId || !token) return false;
  const expected = signJobToken(jobId);
  if (!expected) return false;
  if (expected.length !== token.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch (_) {
    return false;
  }
}

/**
 * Build the full shareable URL for a job.
 * @param {string} jobId
 * @param {string} [baseUrl] — defaults to PUBLIC_APP_URL env var
 * @returns {string|null} — null if secret or base URL is missing
 */
function buildShareUrl(jobId, baseUrl) {
  const token = signJobToken(jobId);
  if (!token) return null;
  const base = baseUrl || process.env.PUBLIC_APP_URL || "";
  if (!base) return null;
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/r/${encodeURIComponent(jobId)}?token=${token}`;
}

/**
 * Whether magic links are configured on this server.
 */
function isConfigured() {
  return !!getSecret();
}

module.exports = {
  signJobToken,
  verifyJobToken,
  buildShareUrl,
  isConfigured,
};
