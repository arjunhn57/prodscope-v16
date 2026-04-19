"use strict";

/**
 * error-handler.js — Consistent API response envelope.
 *
 * All JSON API responses use:
 *   Success: { success: true, data: any }
 *   Error:   { success: false, error: string, code?: string, details?: any }
 */

const { logger } = require("../lib/logger");
const log = logger.child({ component: "error-handler" });

function wrapSuccess(data) {
  return { success: true, data };
}

function wrapError(message, code, details) {
  const envelope = { success: false, error: message };
  if (code) envelope.code = code;
  if (details) envelope.details = details;
  return envelope;
}

/**
 * Express error-handling middleware (must be registered last).
 * Catches thrown errors and unhandled rejections in route handlers.
 */
function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = status === 500 ? "Internal server error" : err.message;

  // Log full error for 500s
  if (status === 500) {
    log.error({ err, method: req.method, path: req.path }, "Unhandled server error");
  }

  res.status(status).json(wrapError(message, err.code));
}

module.exports = { wrapSuccess, wrapError, errorHandler };
