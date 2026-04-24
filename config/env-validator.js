"use strict";

/**
 * env-validator.js — startup environment validation.
 *
 * Pure function: takes an env object (defaults to process.env), returns a
 * structured result. No side effects, no logging, no process.exit — the
 * caller decides what to do with the result.
 *
 * The goal is to catch misconfigurations at startup so the server never
 * boots into a state where every request 500s on a missing secret, or where
 * an obviously-wrong API key makes every Claude call fail hours later.
 */

const MIN_PRODSCOPE_API_KEY_LENGTH = 16;
// emulator-5554, cloud-12345678:5555 — alphanumeric, colon, underscore, hyphen.
const EMULATOR_SERIALS_PATTERN = /^[A-Za-z0-9:_-]+(,[A-Za-z0-9:_-]+)*$/;

/**
 * @param {Record<string, string | undefined>} [envSource] — defaults to process.env.
 * @returns {{ ok: boolean, fatal: string[], warnings: string[] }}
 */
function validateEnvironment(envSource) {
  const env = envSource || process.env;
  const fatal = [];
  const warnings = [];

  // ── ANTHROPIC_API_KEY: required, format-checked ────────────────────────
  const anthropicKey = env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    fatal.push("ANTHROPIC_API_KEY is required but missing");
  } else if (!anthropicKey.startsWith("sk-ant-")) {
    fatal.push(
      "ANTHROPIC_API_KEY has wrong prefix (expected 'sk-ant-'). Got an OpenAI or malformed key.",
    );
  }

  // ── PORT: if set, must be a valid TCP port ─────────────────────────────
  if (env.PORT !== undefined && env.PORT !== "") {
    const port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      fatal.push(`PORT=${env.PORT} is not a valid TCP port (1-65535)`);
    }
  }

  // ── auth: in production, require at least one auth mechanism ───────────
  const jwtSecret = env.JWT_SECRET;
  const apiKey = env.PRODSCOPE_API_KEY;
  const isProduction = env.NODE_ENV === "production";

  if (isProduction && !jwtSecret && !apiKey) {
    fatal.push(
      "Production requires JWT_SECRET or PRODSCOPE_API_KEY — refusing to boot with auth disabled",
    );
  } else if (!jwtSecret && !apiKey) {
    warnings.push("No JWT_SECRET or PRODSCOPE_API_KEY set — auth is disabled (dev mode)");
  }

  if (apiKey && apiKey.length < MIN_PRODSCOPE_API_KEY_LENGTH) {
    fatal.push(
      `PRODSCOPE_API_KEY is too short (length=${apiKey.length}, min=${MIN_PRODSCOPE_API_KEY_LENGTH} chars) — weak keys are trivially guessable`,
    );
  }

  // ── EMULATOR_SERIALS: if set, must be safely formatted ────────────────
  if (env.EMULATOR_SERIALS && !EMULATOR_SERIALS_PATTERN.test(env.EMULATOR_SERIALS)) {
    fatal.push(
      `EMULATOR_SERIALS='${env.EMULATOR_SERIALS}' contains invalid characters (allowed: alphanumeric, ':', '_', '-', ','). Refusing to pass untrusted input to adb.`,
    );
  }

  // ── magic-link feature: partial config is a warning ───────────────────
  // If the operator set *any* magic-link var, they probably meant to use
  // the feature — surface that the feature will be silently broken rather
  // than leave them guessing why magic links don't send.
  const magicLinkVars = ["MAGIC_LINK_SECRET", "RESEND_API_KEY", "PUBLIC_APP_URL"];
  const magicLinkSet = magicLinkVars.filter((v) => env[v]);
  if (magicLinkSet.length > 0 && magicLinkSet.length < magicLinkVars.length) {
    const missing = magicLinkVars.filter((v) => !env[v]);
    warnings.push(
      `Magic-link is partially configured — missing ${missing.join(", ")}. The feature will silently fail until all three are set.`,
    );
  }

  // ── CORS in production ────────────────────────────────────────────────
  if (isProduction && !env.CORS_ALLOWED_ORIGINS) {
    warnings.push(
      "CORS_ALLOWED_ORIGINS is not set in production — browser origins will be blocked by default",
    );
  }

  // ── Google OAuth consistency ──────────────────────────────────────────
  if (env.GOOGLE_CLIENT_ID && !env.ADMIN_EMAILS) {
    warnings.push(
      "GOOGLE_CLIENT_ID is set but ADMIN_EMAILS is not — admin routes will use the hardcoded default",
    );
  }

  return {
    ok: fatal.length === 0,
    fatal,
    warnings,
  };
}

module.exports = { validateEnvironment };
