"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { multerErrorHandler } = require("../multer-error-handler");

function mockRes() {
  const state = {};
  return {
    state,
    status(s) { state.status = s; return this; },
    json(body) { state.body = body; return this; },
  };
}

// ── MulterError mapping ───────────────────────────────────────────────────

test("multerErrorHandler: LIMIT_FILE_SIZE → FILE_TOO_LARGE (413)", () => {
  const err = Object.assign(new Error("File too large"), {
    name: "MulterError",
    code: "LIMIT_FILE_SIZE",
    limit: 50 * 1024 * 1024,
    field: "apk",
  });
  const res = mockRes();
  multerErrorHandler(err, {}, res, () => assert.fail("next should not be called"));
  assert.equal(res.state.status, 413);
  assert.equal(res.state.body.code, "FILE_TOO_LARGE");
  assert.equal(res.state.body.retryable, false);
  assert.deepEqual(res.state.body.details, {
    limitBytes: 50 * 1024 * 1024,
    field: "apk",
  });
});

test("multerErrorHandler: unexpected MulterError code maps to INVALID_APK", () => {
  const err = Object.assign(new Error("Too many files"), {
    name: "MulterError",
    code: "LIMIT_UNEXPECTED_FILE",
  });
  const res = mockRes();
  multerErrorHandler(err, {}, res, () => assert.fail("next should not be called"));
  assert.equal(res.state.status, 400);
  assert.equal(res.state.body.code, "INVALID_APK");
  assert.match(res.state.body.message, /LIMIT_UNEXPECTED_FILE/);
});

// ── ENOENT handling ───────────────────────────────────────────────────────

test("multerErrorHandler: ENOENT on error object → UPLOAD_DEST_MISSING", () => {
  const err = Object.assign(new Error("ENOENT: /tmp/uploads"), { code: "ENOENT" });
  const res = mockRes();
  multerErrorHandler(err, {}, res, () => assert.fail("next should not be called"));
  assert.equal(res.state.status, 503);
  assert.equal(res.state.body.code, "UPLOAD_DEST_MISSING");
  assert.equal(res.state.body.retryable, true);
});

test("multerErrorHandler: nested storageErrors[].code=ENOENT → UPLOAD_DEST_MISSING", () => {
  const err = Object.assign(new Error("storage failure"), {
    storageErrors: [{ code: "ENOENT", message: "upload dir missing" }],
  });
  const res = mockRes();
  multerErrorHandler(err, {}, res, () => assert.fail("next should not be called"));
  assert.equal(res.state.status, 503);
  assert.equal(res.state.body.code, "UPLOAD_DEST_MISSING");
});

// ── passthrough ───────────────────────────────────────────────────────────

test("multerErrorHandler: unknown error is forwarded via next()", () => {
  const err = new Error("some other failure");
  const res = mockRes();
  let forwarded = null;
  multerErrorHandler(err, {}, res, (e) => { forwarded = e; });
  assert.equal(forwarded, err);
  assert.equal(res.state.status, undefined, "must not send a response when forwarding");
});

test("multerErrorHandler: null err passes through to next()", () => {
  const res = mockRes();
  let called = false;
  multerErrorHandler(null, {}, res, () => { called = true; });
  assert.equal(called, true);
});
