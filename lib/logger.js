"use strict";

/**
 * logger.js — Structured logging with Pino.
 *
 * Provides JSON-formatted logs with correlation IDs per job.
 * In development (NODE_ENV !== 'production'), outputs human-readable format.
 *
 * Usage:
 *   const { logger, createJobLogger } = require('./lib/logger');
 *   logger.info('Server started');
 *   const log = createJobLogger(jobId);
 *   log.info({ step: 5 }, 'Captured screen');
 */

const pino = require("pino");
const crypto = require("crypto");

/**
 * Generate a short trace ID for request correlation.
 * Format: 16-char hex string (64 bits of entropy).
 * @returns {string}
 */
function genTraceId() {
  return crypto.randomBytes(8).toString("hex");
}

const isProduction = process.env.NODE_ENV === "production";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }),
});

/**
 * Create a child logger scoped to a specific job.
 * All log entries will include the jobId for correlation.
 *
 * @param {string} jobId
 * @returns {pino.Logger}
 */
function createJobLogger(jobId, traceId) {
  const bindings = { jobId };
  if (traceId) bindings.traceId = traceId;
  return logger.child(bindings);
}

/**
 * Express request logging middleware.
 * Logs method, url, status, and response time for each request.
 */
function requestLogger() {
  return function (req, res, next) {
    // C2: Attach trace ID for distributed correlation
    const traceId = req.headers["x-trace-id"] || genTraceId();
    req.traceId = traceId;
    res.set("X-Trace-Id", traceId);

    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 400 ? "warn" : "info";
      logger[level]({
        traceId,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        ms: duration,
      }, `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
  };
}

/**
 * Create a child logger scoped to a crawl session.
 * Includes jobId and component name for filtering.
 *
 * @param {string} jobId
 * @returns {pino.Logger}
 */
function createCrawlLogger(jobId, traceId) {
  const bindings = { jobId, component: "crawler" };
  if (traceId) bindings.traceId = traceId;
  return logger.child(bindings);
}

module.exports = { logger, createJobLogger, createCrawlLogger, requestLogger, genTraceId };
