"use strict";

/**
 * api-errors.js — structured error envelope for upload + job failure paths.
 *
 * Before this module, upload and queue failures surfaced as Express
 * default error pages or ad-hoc JSON shapes that the frontend couldn't
 * programmatically dispatch on. Consumers had to regex-match `error.message`
 * strings that drifted as copy changed.
 *
 * Contract: every structured error body is exactly
 *   { error: true, code: string, message: string, retryable: boolean, details?: any }
 *
 * - `code` is a stable string (ERROR_CODES) — what the UI branches on.
 * - `message` is human-readable — what the UI shows.
 * - `retryable` tells the UI whether a retry button makes sense.
 * - `details` is free-form structured context (file size numbers, etc.).
 *
 * Catalog entries ALSO carry `http` status (kept off the body — it's set
 * via `res.status()` in sendApiError). Never leak the internal shape.
 */

// Enum of canonical error codes. Frontends dispatch on these.
const ERROR_CODES = Object.freeze({
  UPLOAD_DEST_MISSING: "UPLOAD_DEST_MISSING",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  INVALID_APK: "INVALID_APK",
  MISSING_API_KEY: "MISSING_API_KEY",
  INVALID_API_KEY: "INVALID_API_KEY",
  EMULATOR_UNAVAILABLE: "EMULATOR_UNAVAILABLE",
  JOB_TIMEOUT: "JOB_TIMEOUT",
});

const ERROR_CATALOG = Object.freeze({
  UPLOAD_DEST_MISSING: {
    http: 503,
    message:
      "Upload storage is temporarily unavailable. This is usually a transient disk / permissions issue on our side — please retry in a moment.",
    retryable: true,
  },
  FILE_TOO_LARGE: {
    http: 413,
    message:
      "APK exceeds the 50 MB upload limit. Compress the APK (strip debug symbols, split ABIs) or contact support for a larger quota.",
    retryable: false,
  },
  INVALID_APK: {
    http: 400,
    message:
      "The uploaded file is not a valid Android APK. aapt2 could not read its manifest. Make sure the file is a signed APK (not an AAB, IPA, or bare ZIP).",
    retryable: false,
  },
  MISSING_API_KEY: {
    http: 401,
    message:
      "Missing credentials. Include X-API-Key: <key> in the request header (or Authorization: Bearer <jwt> if using a user session).",
    retryable: false,
  },
  INVALID_API_KEY: {
    http: 401,
    message:
      "The provided API key / JWT is not valid. Verify the key matches PRODSCOPE_API_KEY, or re-issue the JWT via /api/v1/auth/login.",
    retryable: false,
  },
  EMULATOR_UNAVAILABLE: {
    http: 503,
    message:
      "No Android emulator is currently available to run this crawl. Your job will be retried automatically once an emulator is free.",
    retryable: true,
  },
  JOB_TIMEOUT: {
    http: 408,
    message:
      "The crawl exceeded its 30-minute wall-clock limit and was aborted. This usually means the app got stuck on a modal, login screen, or never booted — re-run with a higher step budget or staticInputs for any blocking prompts.",
    retryable: true,
  },
});

/**
 * Build the canonical error body. Does NOT send — just returns the shape.
 *
 * @param {keyof typeof ERROR_CATALOG} code
 * @param {{ message?: string, retryable?: boolean, details?: any }} [overrides]
 * @returns {{ error: true, code: string, message: string, retryable: boolean, details?: any }}
 */
function apiError(code, overrides = {}) {
  const entry = ERROR_CATALOG[code];
  if (!entry) {
    throw new Error(`Unknown error code: ${code}`);
  }
  const body = {
    error: true,
    code,
    message: typeof overrides.message === "string" ? overrides.message : entry.message,
    retryable:
      typeof overrides.retryable === "boolean" ? overrides.retryable : entry.retryable,
  };
  if (overrides.details !== undefined) {
    body.details = overrides.details;
  }
  return body;
}

/**
 * Send a structured error on an Express response, using the catalog's
 * http status. Returns the response for chaining.
 *
 * @param {import("express").Response} res
 * @param {keyof typeof ERROR_CATALOG} code
 * @param {{ message?: string, retryable?: boolean, details?: any }} [overrides]
 */
function sendApiError(res, code, overrides = {}) {
  const entry = ERROR_CATALOG[code];
  if (!entry) {
    throw new Error(`Unknown error code: ${code}`);
  }
  return res.status(entry.http).json(apiError(code, overrides));
}

module.exports = {
  ERROR_CODES,
  ERROR_CATALOG,
  apiError,
  sendApiError,
};
