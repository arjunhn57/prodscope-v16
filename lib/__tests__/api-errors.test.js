"use strict";

/**
 * api-errors.test.js — pins the shape of the structured error envelope
 * used across upload + job failure paths.
 *
 * Contract: every structured error is
 *   { error: true, code: string, message: string, retryable: boolean }
 *
 * The http status is a separate field on the catalog entry (used by
 * sendApiError to set the response status), never leaked into the body.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  apiError,
  sendApiError,
  ERROR_CODES,
  ERROR_CATALOG,
} = require("../api-errors");

// ── apiError(code) → body shape ────────────────────────────────────────────

test("apiError: returns the canonical envelope", () => {
  const body = apiError("FILE_TOO_LARGE");
  assert.equal(body.error, true);
  assert.equal(body.code, "FILE_TOO_LARGE");
  assert.equal(typeof body.message, "string");
  assert.ok(body.message.length > 0);
  assert.equal(typeof body.retryable, "boolean");
});

test("apiError: throws on unknown code (no silent typos)", () => {
  assert.throws(() => apiError("NONEXISTENT_CODE"), /Unknown/);
});

test("apiError: accepts a message override", () => {
  const body = apiError("INVALID_APK", { message: "apk is too shrimpy" });
  assert.equal(body.message, "apk is too shrimpy");
  assert.equal(body.code, "INVALID_APK");
});

test("apiError: accepts a retryable override", () => {
  // Normally FILE_TOO_LARGE is not retryable
  assert.equal(apiError("FILE_TOO_LARGE").retryable, false);
  // But caller can force it if the context allows
  assert.equal(apiError("FILE_TOO_LARGE", { retryable: true }).retryable, true);
});

test("apiError: carries extras in a details field when provided", () => {
  const body = apiError("FILE_TOO_LARGE", {
    details: { sizeMb: 95.3, limitMb: 50 },
  });
  assert.deepEqual(body.details, { sizeMb: 95.3, limitMb: 50 });
});

// ── ERROR_CODES enum ───────────────────────────────────────────────────────

test("ERROR_CODES: exposes every required code from task 3.5", () => {
  // Every code the task spec calls out must be a first-class entry.
  const required = [
    "UPLOAD_DEST_MISSING",
    "FILE_TOO_LARGE",
    "INVALID_APK",
    "MISSING_API_KEY",
    "INVALID_API_KEY",
    "EMULATOR_UNAVAILABLE",
    "JOB_TIMEOUT",
  ];
  for (const code of required) {
    assert.ok(ERROR_CODES[code], `ERROR_CODES.${code} must exist`);
    assert.ok(ERROR_CATALOG[code], `ERROR_CATALOG entry for ${code} must exist`);
  }
});

test("ERROR_CATALOG: every entry has http, message, retryable", () => {
  for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
    assert.ok(typeof entry.http === "number", `${code}.http must be number`);
    assert.ok(
      entry.http >= 400 && entry.http < 600,
      `${code}.http must be 4xx/5xx, got ${entry.http}`,
    );
    assert.ok(typeof entry.message === "string" && entry.message.length > 0, `${code}.message missing`);
    assert.equal(typeof entry.retryable, "boolean", `${code}.retryable must be boolean`);
  }
});

test("ERROR_CATALOG: retryable flag is sensible per code", () => {
  // Transient problems should be retryable; user errors should not.
  assert.equal(ERROR_CATALOG.UPLOAD_DEST_MISSING.retryable, true);
  assert.equal(ERROR_CATALOG.EMULATOR_UNAVAILABLE.retryable, true);
  assert.equal(ERROR_CATALOG.JOB_TIMEOUT.retryable, true);
  assert.equal(ERROR_CATALOG.FILE_TOO_LARGE.retryable, false);
  assert.equal(ERROR_CATALOG.INVALID_APK.retryable, false);
  assert.equal(ERROR_CATALOG.MISSING_API_KEY.retryable, false);
  assert.equal(ERROR_CATALOG.INVALID_API_KEY.retryable, false);
});

// ── sendApiError(res, code) — express integration ─────────────────────────

function mockRes() {
  const state = {};
  return {
    state,
    status(s) { state.status = s; return this; },
    json(body) { state.body = body; return this; },
  };
}

test("sendApiError: sets status from catalog and body from apiError", () => {
  const res = mockRes();
  sendApiError(res, "FILE_TOO_LARGE");
  assert.equal(res.state.status, 413);
  assert.equal(res.state.body.code, "FILE_TOO_LARGE");
  assert.equal(res.state.body.error, true);
});

test("sendApiError: accepts overrides", () => {
  const res = mockRes();
  sendApiError(res, "INVALID_APK", { message: "custom" });
  assert.equal(res.state.status, 400);
  assert.equal(res.state.body.message, "custom");
});

test("sendApiError: unknown code throws", () => {
  const res = mockRes();
  assert.throws(() => sendApiError(res, "NOPE"), /Unknown/);
});

// ── shape invariants ──────────────────────────────────────────────────────

test("apiError: body NEVER contains http status or internal fields", () => {
  const body = apiError("EMULATOR_UNAVAILABLE");
  assert.equal(body.http, undefined, "http must not leak into body");
  assert.equal(body.stack, undefined);
  assert.equal(body.internalError, undefined);
});
