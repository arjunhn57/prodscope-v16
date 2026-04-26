"use strict";

/**
 * auth.js — JWT + API key authentication middleware.
 *
 * Routes are protected unless explicitly exempted.
 * Supports two auth methods:
 *   1. Bearer JWT token (Authorization: Bearer <token>)
 *   2. API key (X-API-Key: <key> or ?api_key=<key>)
 *
 * Unprotected routes: /health, /api/auth/*
 */

const crypto = require("crypto");
const { apiError } = require("../lib/api-errors");

// Lazy-require jsonwebtoken so the module loads even if jwt isn't installed yet
let jwt;
function getJwt() {
  if (!jwt) jwt = require("jsonwebtoken");
  return jwt;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Routes that skip authentication entirely.
 * Note: /auth/me is intentionally NOT public — it reads the caller's JWT.
 */
const PUBLIC_ROUTES = new Set([
  "/health",
  "/metrics",
  "/api/auth/login",
  "/api/v1/auth/login",
  "/api/auth/google",
  "/api/v1/auth/google",
  "/api/apply",
  "/api/v1/apply",
]);

/**
 * Route prefixes that skip middleware auth because they use a different
 * per-resource auth scheme (HMAC magic-link token on the query string).
 * The route handlers themselves MUST verify the token — the middleware
 * only gets out of the way here.
 */
const PUBLIC_PREFIXES = [
  "/api/v1/public-report/",
  "/api/v1/report-html/",
  "/r/",
];

/**
 * Routes that accept API key via query parameter (for EventSource/img tags
 * which cannot set custom headers).
 */
const QUERY_AUTH_PREFIXES = [
  "/api/v1/job-sse/",
  "/api/v1/job-screenshot/",
  "/api/v1/job-live-stream/",
];

function isPublicRoute(path) {
  if (PUBLIC_ROUTES.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Validate a JWT token.
 * @param {string} token
 * @param {string} secret
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
function validateJwt(token, secret) {
  try {
    const payload = getJwt().verify(token, secret, {
      algorithms: ["HS256"],
      maxAge: "24h",
    });
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Validate an API key against the configured key.
 * @param {string} providedKey
 * @param {string} configuredKey
 * @returns {boolean}
 */
function validateApiKey(providedKey, configuredKey) {
  if (!providedKey || !configuredKey) return false;
  return safeCompare(providedKey, configuredKey);
}

/**
 * Express middleware factory.
 * @param {{ jwtSecret: string, apiKey: string }} config
 * @returns {Function} Express middleware
 */
function createAuthMiddleware(config) {
  const { jwtSecret, apiKey } = config;

  // If neither JWT nor API key is configured, auth is disabled (dev mode)
  const authEnabled = !!(jwtSecret || apiKey);

  // Safety: reject AUTH_DISABLED in production — prevents accidental no-auth deploy
  if (!authEnabled && process.env.NODE_ENV === "production" && process.env.AUTH_DISABLED !== "true") {
    throw new Error("Production requires JWT_SECRET or PRODSCOPE_API_KEY. Set one or the other.");
  }
  if (process.env.AUTH_DISABLED === "true" && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_DISABLED=true is not allowed in production.");
  }

  // ── Guest mode (temporary, env-gated) ────────────────────────────────
  // When GUEST_MODE_ENABLED=true, requests without a Bearer or X-API-Key
  // are treated as a synthetic admin user. Used for friction-free smoke
  // tests when the team doesn't want to sign in every session. Off by
  // default; flip the env var to enable; logs a warning at startup so
  // it's hard to leave on by accident.
  const guestModeEnabled = process.env.GUEST_MODE_ENABLED === "true";
  if (guestModeEnabled) {
    // eslint-disable-next-line no-console
    console.warn("[auth] GUEST_MODE_ENABLED=true — unauthenticated requests are admitted as guest admin");
  }
  const GUEST_USER = {
    type: "guest",
    sub: "u_guest_test",
    userId: "u_guest_test",
    email: "guest@prodscope.local",
    role: "admin",
  };

  return function authMiddleware(req, res, next) {
    // Skip public routes
    if (isPublicRoute(req.path)) return next();

    // If auth is not configured, reject in production, allow in dev
    if (!authEnabled) {
      if (process.env.NODE_ENV === "development" || process.env.AUTH_DISABLED === "true") {
        res.set("X-Auth-Warning", "authentication-not-configured");
        return next();
      }
      return res.status(503).json({
        success: false,
        error: "Authentication not configured",
        hint: "Set JWT_SECRET or PRODSCOPE_API_KEY environment variable. For dev mode, set NODE_ENV=development or AUTH_DISABLED=true.",
      });
    }

    // Track whether the caller *presented* any credential at all. If not,
    // they get MISSING_API_KEY; if they did and it was wrong, INVALID_API_KEY.
    // This distinction lets the UI prompt the user to supply a key vs.
    // telling them the one they supplied is bad.
    let credentialPresented = false;

    // Try Bearer JWT first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      credentialPresented = true;
      const token = authHeader.slice(7);
      if (jwtSecret) {
        const result = validateJwt(token, jwtSecret);
        if (result.valid) {
          req.user = result.payload;
          return next();
        }
      }
    }

    // Try API key (header)
    const providedKey = req.headers["x-api-key"];
    if (providedKey) {
      credentialPresented = true;
      if (apiKey && validateApiKey(providedKey, apiKey)) {
        req.user = { type: "api_key" };
        return next();
      }
    }

    // Try JWT or API key via query param for SSE/screenshot/live-stream routes only
    // (EventSource and <img> tags cannot set custom headers)
    const queryKey = req.query?.api_key;
    if (queryKey && QUERY_AUTH_PREFIXES.some((p) => req.path.startsWith(p))) {
      credentialPresented = true;
      if (jwtSecret) {
        const result = validateJwt(queryKey, jwtSecret);
        if (result.valid) {
          req.user = result.payload;
          return next();
        }
      }
      if (apiKey && validateApiKey(queryKey, apiKey)) {
        req.user = { type: "api_key_query" };
        return next();
      }
    }

    // If guest mode is on AND the caller presented no credential, fall
    // through as the guest admin. If they presented an INVALID credential
    // we still reject — guest mode is a missing-creds bypass, not a
    // wrong-creds bypass.
    if (guestModeEnabled && !credentialPresented) {
      req.user = GUEST_USER;
      return next();
    }

    const code = credentialPresented ? "INVALID_API_KEY" : "MISSING_API_KEY";
    return res.status(401).json(apiError(code));
  };
}

/**
 * Generate a JWT token (used by /api/auth/login).
 * @param {object} payload
 * @param {string} secret
 * @param {string} [expiresIn="24h"]
 * @returns {string}
 */
function generateToken(payload, secret, expiresIn = "24h") {
  return getJwt().sign(payload, secret, {
    algorithm: "HS256",
    expiresIn,
  });
}

module.exports = {
  createAuthMiddleware,
  generateToken,
  validateJwt,
  validateApiKey,
  isPublicRoute,
};
