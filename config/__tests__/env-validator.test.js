"use strict";

/**
 * env-validator.test.js — unit tests for config/env-validator.js
 *
 * The server failing to start on a misconfigured deploy is much better than
 * the server silently accepting broken config and then 500ing requests
 * hours later. These tests pin the exact failure modes.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateEnvironment } = require("../env-validator");

// ── helpers ────────────────────────────────────────────────────────────────

function env(overrides = {}) {
  return {
    ANTHROPIC_API_KEY: "sk-ant-api03-abcdef1234567890",
    NODE_ENV: "production",
    PRODSCOPE_API_KEY: "prod-scope-test-key-123456",
    JWT_SECRET: "jwt-secret-that-is-long-enough-to-be-safe-012345",
    PORT: "8080",
    ...overrides,
  };
}

// ── required vars ──────────────────────────────────────────────────────────

test("validateEnvironment — fatal when ANTHROPIC_API_KEY missing", () => {
  const result = validateEnvironment(env({ ANTHROPIC_API_KEY: undefined }));
  assert.equal(result.ok, false);
  assert.ok(
    result.fatal.some((m) => m.includes("ANTHROPIC_API_KEY")),
    "expected a fatal error mentioning ANTHROPIC_API_KEY",
  );
});

test("validateEnvironment — fatal when ANTHROPIC_API_KEY empty string", () => {
  const result = validateEnvironment(env({ ANTHROPIC_API_KEY: "" }));
  assert.equal(result.ok, false);
  assert.ok(result.fatal.some((m) => m.includes("ANTHROPIC_API_KEY")));
});

test("validateEnvironment — fatal when ANTHROPIC_API_KEY has wrong prefix", () => {
  const result = validateEnvironment(env({ ANTHROPIC_API_KEY: "sk-proj-openai-key" }));
  assert.equal(result.ok, false);
  assert.ok(
    result.fatal.some((m) => m.includes("ANTHROPIC_API_KEY") && m.toLowerCase().includes("prefix")),
    "expected a fatal error about the key prefix",
  );
});

test("validateEnvironment — accepts ANTHROPIC_API_KEY with sk-ant- prefix", () => {
  const result = validateEnvironment(env());
  assert.equal(result.ok, true);
  assert.deepEqual(result.fatal, []);
});

// ── PORT validation ────────────────────────────────────────────────────────

test("validateEnvironment — PORT defaults accepted when unset", () => {
  const result = validateEnvironment(env({ PORT: undefined }));
  assert.equal(result.ok, true);
});

test("validateEnvironment — fatal when PORT is non-numeric", () => {
  const result = validateEnvironment(env({ PORT: "not-a-number" }));
  assert.equal(result.ok, false);
  assert.ok(result.fatal.some((m) => m.includes("PORT")));
});

test("validateEnvironment — fatal when PORT is out of range", () => {
  const result = validateEnvironment(env({ PORT: "99999" }));
  assert.equal(result.ok, false);
  assert.ok(result.fatal.some((m) => m.includes("PORT")));
});

test("validateEnvironment — fatal when PORT is zero", () => {
  const result = validateEnvironment(env({ PORT: "0" }));
  assert.equal(result.ok, false);
  assert.ok(result.fatal.some((m) => m.includes("PORT")));
});

// ── auth (production-only enforcement) ────────────────────────────────────

test("validateEnvironment — fatal in production when no auth configured", () => {
  const result = validateEnvironment(
    env({ JWT_SECRET: undefined, PRODSCOPE_API_KEY: undefined }),
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.fatal.some(
      (m) => m.includes("JWT_SECRET") || m.includes("PRODSCOPE_API_KEY"),
    ),
  );
});

test("validateEnvironment — dev with no auth is a warning, not fatal", () => {
  const result = validateEnvironment(
    env({
      NODE_ENV: "development",
      JWT_SECRET: undefined,
      PRODSCOPE_API_KEY: undefined,
    }),
  );
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((m) => /auth/i.test(m)));
});

test("validateEnvironment — fatal when PRODSCOPE_API_KEY is too short", () => {
  const result = validateEnvironment(
    env({ PRODSCOPE_API_KEY: "short", JWT_SECRET: undefined }),
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.fatal.some((m) => m.includes("PRODSCOPE_API_KEY") && /length|short|chars/i.test(m)),
  );
});

// ── EMULATOR_SERIALS ───────────────────────────────────────────────────────

test("validateEnvironment — EMULATOR_SERIALS unset is OK", () => {
  const result = validateEnvironment(env({ EMULATOR_SERIALS: undefined }));
  assert.equal(result.ok, true);
});

test("validateEnvironment — accepts valid EMULATOR_SERIALS", () => {
  const result = validateEnvironment(env({ EMULATOR_SERIALS: "emulator-5554,emulator-5556" }));
  assert.equal(result.ok, true);
});

test("validateEnvironment — fatal on malformed EMULATOR_SERIALS", () => {
  const result = validateEnvironment(env({ EMULATOR_SERIALS: "emulator 5554; rm -rf" }));
  assert.equal(result.ok, false);
  assert.ok(result.fatal.some((m) => m.includes("EMULATOR_SERIALS")));
});

// ── magic-link consistency ────────────────────────────────────────────────

test("validateEnvironment — warns when magic-link partially configured", () => {
  const result = validateEnvironment(
    env({
      MAGIC_LINK_SECRET: "some-long-enough-secret-abcdef012345",
      RESEND_API_KEY: undefined,
      PUBLIC_APP_URL: undefined,
    }),
  );
  assert.equal(result.ok, true);
  assert.ok(
    result.warnings.some((m) => /magic.?link/i.test(m)),
    "expected warning about partial magic-link config",
  );
});

test("validateEnvironment — no warning when magic-link fully configured", () => {
  const result = validateEnvironment(
    env({
      MAGIC_LINK_SECRET: "some-long-enough-secret-abcdef012345",
      RESEND_API_KEY: "re_key_test_12345",
      PUBLIC_APP_URL: "https://prodscope.ai",
    }),
  );
  assert.equal(result.ok, true);
  assert.ok(!result.warnings.some((m) => /magic.?link/i.test(m)));
});

test("validateEnvironment — no warning when magic-link fully absent", () => {
  const result = validateEnvironment(
    env({
      MAGIC_LINK_SECRET: undefined,
      RESEND_API_KEY: undefined,
      PUBLIC_APP_URL: undefined,
    }),
  );
  assert.equal(result.ok, true);
  assert.ok(!result.warnings.some((m) => /magic.?link/i.test(m)));
});

// ── result shape ──────────────────────────────────────────────────────────

test("validateEnvironment — always returns { ok, fatal, warnings }", () => {
  const result = validateEnvironment(env());
  assert.equal(typeof result.ok, "boolean");
  assert.ok(Array.isArray(result.fatal));
  assert.ok(Array.isArray(result.warnings));
});

test("validateEnvironment — collects ALL fatals, not just the first", () => {
  const result = validateEnvironment(
    env({ ANTHROPIC_API_KEY: undefined, PORT: "99999" }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.fatal.length >= 2, "expected both ANTHROPIC_API_KEY and PORT failures");
});
