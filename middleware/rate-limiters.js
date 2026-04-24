"use strict";

/**
 * rate-limiters.js — shared express-rate-limit instances.
 *
 * Extracted from server.js so individual routers (Phase 4.1) can import
 * the exact limiter they need without duplicating the config. Each
 * limiter uses default IP-based key generation (req.ip via trust proxy);
 * keyGeneratorIpFallback suppressed because we sit behind nginx and
 * IPv6 bypass isn't a concern.
 */

const rateLimit = require("express-rate-limit");

const jobLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many job requests. Limit: 10 per minute." },
  validate: { xForwardedForHeader: false },
});

const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many status requests. Limit: 120 per minute." },
  validate: { xForwardedForHeader: false },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
  validate: { xForwardedForHeader: false },
});

const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many applications. Try again in an hour." },
  validate: { xForwardedForHeader: false },
});

module.exports = { jobLimiter, statusLimiter, loginLimiter, applyLimiter };
