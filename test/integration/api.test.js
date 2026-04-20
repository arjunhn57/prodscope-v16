"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// API middleware and validation tests
//
// Tests the auth, validation, and error-envelope modules that make up the
// API layer. These run without Redis, SQLite, or any external dependencies.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth middleware tests
// ---------------------------------------------------------------------------

const {
  createAuthMiddleware,
  generateToken,
  validateJwt,
  validateApiKey,
  isPublicRoute,
} = require("../../middleware/auth");

describe("Auth middleware", () => {
  describe("isPublicRoute()", () => {
    it("allows /health without auth", () => {
      assert.strictEqual(isPublicRoute("/health"), true);
    });

    it("allows /metrics without auth", () => {
      assert.strictEqual(isPublicRoute("/metrics"), true);
    });

    it("allows /api/auth/login without auth", () => {
      assert.strictEqual(isPublicRoute("/api/auth/login"), true);
    });

    it("allows /api/v1/auth/login without auth", () => {
      assert.strictEqual(isPublicRoute("/api/v1/auth/login"), true);
    });

    it("blocks /api/v1/start-job", () => {
      assert.strictEqual(isPublicRoute("/api/v1/start-job"), false);
    });

    it("blocks /api/v1/job-status/abc", () => {
      assert.strictEqual(isPublicRoute("/api/v1/job-status/abc"), false);
    });
  });

  describe("validateApiKey()", () => {
    it("returns true for matching keys", () => {
      assert.strictEqual(validateApiKey("secret123", "secret123"), true);
    });

    it("returns false for mismatched keys", () => {
      assert.strictEqual(validateApiKey("wrong", "secret123"), false);
    });

    it("returns false for empty provided key", () => {
      assert.strictEqual(validateApiKey("", "secret123"), false);
    });

    it("returns false for null inputs", () => {
      assert.strictEqual(validateApiKey(null, "secret123"), false);
      assert.strictEqual(validateApiKey("key", null), false);
    });
  });

  describe("generateToken() + validateJwt()", () => {
    const secret = "test-jwt-secret-for-unit-tests";

    it("generates a valid JWT that validates correctly", () => {
      const token = generateToken({ userId: "user1" }, secret, "1h");
      const result = validateJwt(token, secret);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.payload.userId, "user1");
    });

    it("rejects token with wrong secret", () => {
      const token = generateToken({ userId: "user1" }, secret, "1h");
      const result = validateJwt(token, "wrong-secret");

      assert.strictEqual(result.valid, false);
      assert.ok(result.error);
    });

    it("rejects malformed token", () => {
      const result = validateJwt("not-a-jwt", secret);

      assert.strictEqual(result.valid, false);
    });
  });

  describe("createAuthMiddleware()", () => {
    function mockReq(overrides = {}) {
      return {
        path: "/api/v1/start-job",
        headers: {},
        ...overrides,
      };
    }

    function mockRes() {
      const r = {
        statusCode: 200,
        body: null,
        headers: {},
        status(code) { r.statusCode = code; return r; },
        json(data) { r.body = data; return r; },
        set(key, val) { r.headers[key] = val; return r; },
      };
      return r;
    }

    it("allows public routes without auth", (t, done) => {
      const mw = createAuthMiddleware({ jwtSecret: "secret", apiKey: "key" });
      const req = mockReq({ path: "/health" });
      const res = mockRes();

      mw(req, res, () => {
        // next() was called — route allowed
        done();
      });
    });

    it("rejects unauthenticated requests with 401", () => {
      const mw = createAuthMiddleware({ jwtSecret: "secret", apiKey: "key" });
      const req = mockReq();
      const res = mockRes();
      let nextCalled = false;

      mw(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes("Authentication required"));
    });

    it("accepts valid API key via X-API-Key header", (t, done) => {
      const mw = createAuthMiddleware({ jwtSecret: "", apiKey: "my-api-key" });
      const req = mockReq({ headers: { "x-api-key": "my-api-key" } });
      const res = mockRes();

      mw(req, res, () => {
        assert.deepStrictEqual(req.user, { type: "api_key" });
        done();
      });
    });

    it("rejects wrong API key", () => {
      const mw = createAuthMiddleware({ jwtSecret: "", apiKey: "my-api-key" });
      const req = mockReq({ headers: { "x-api-key": "wrong-key" } });
      const res = mockRes();
      let nextCalled = false;

      mw(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 401);
    });

    it("accepts valid Bearer JWT token", (t, done) => {
      const secret = "jwt-test-secret";
      const token = generateToken({ userId: "u1" }, secret, "1h");
      const mw = createAuthMiddleware({ jwtSecret: secret, apiKey: "" });
      const req = mockReq({
        headers: { authorization: `Bearer ${token}` },
      });
      const res = mockRes();

      mw(req, res, () => {
        assert.ok(req.user);
        assert.strictEqual(req.user.userId, "u1");
        done();
      });
    });

    it("rejects expired/invalid JWT", () => {
      const mw = createAuthMiddleware({ jwtSecret: "secret", apiKey: "" });
      const req = mockReq({
        headers: { authorization: "Bearer invalid.token.here" },
      });
      const res = mockRes();
      let nextCalled = false;

      mw(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 401);
    });
  });
});

// ---------------------------------------------------------------------------
// Validation middleware tests
// ---------------------------------------------------------------------------

const {
  validateFile,
  parseCredentials,
  parseStaticInputs,
  startJobSchema,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
} = require("../../middleware/validate");

describe("Validation middleware", () => {
  describe("startJobSchema", () => {
    it("accepts valid input", () => {
      const result = startJobSchema.safeParse({
        email: "test@example.com",
        credentials: '{"username":"user"}',
        goals: "Test the checkout flow",
      });
      assert.strictEqual(result.success, true);
    });

    it("rejects invalid email", () => {
      const result = startJobSchema.safeParse({
        email: "not-an-email",
      });
      assert.strictEqual(result.success, false);
    });

    it("applies defaults for missing optional fields", () => {
      const result = startJobSchema.safeParse({});
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.credentials, "{}");
      assert.strictEqual(result.data.goldenPath, "");
    });

    it("rejects credentials longer than 2048 chars", () => {
      const result = startJobSchema.safeParse({
        credentials: "x".repeat(2049),
      });
      assert.strictEqual(result.success, false);
    });
  });

  describe("validateFile()", () => {
    it("rejects missing file", () => {
      const result = validateFile(null);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes("required"));
    });

    it("accepts valid .apk file", () => {
      const result = validateFile({
        originalname: "my-app.apk",
        size: 50 * 1024 * 1024,
      });
      assert.strictEqual(result.valid, true);
    });

    it("accepts valid .aab file", () => {
      const result = validateFile({
        originalname: "my-app.aab",
        size: 10 * 1024 * 1024,
      });
      assert.strictEqual(result.valid, true);
    });

    it("rejects .exe file", () => {
      const result = validateFile({
        originalname: "malware.exe",
        size: 1024,
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes("Invalid file type"));
    });

    it("rejects oversized file", () => {
      const result = validateFile({
        originalname: "huge.apk",
        size: 300 * 1024 * 1024, // 300 MB
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes("too large"));
    });
  });

  describe("parseCredentials()", () => {
    it("accepts valid JSON credentials", () => {
      const result = parseCredentials('{"username":"admin","password":"pass123"}');
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.parsed.username, "admin");
      assert.strictEqual(result.parsed.password, "pass123");
    });

    it("accepts empty string as no credentials", () => {
      const result = parseCredentials("");
      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.parsed, {});
    });

    it("accepts empty object string", () => {
      const result = parseCredentials("{}");
      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.parsed, {});
    });

    it("rejects invalid JSON", () => {
      const result = parseCredentials("{not valid json}");
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes("Invalid credentials JSON"));
    });

    it("rejects array instead of object", () => {
      const result = parseCredentials('["a","b"]');
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes("must be a JSON object"));
    });

    it("rejects null JSON", () => {
      const result = parseCredentials("null");
      assert.strictEqual(result.valid, false);
    });
  });

  describe("parseStaticInputs()", () => {
    it("accepts empty string and empty object as no inputs", () => {
      assert.deepStrictEqual(parseStaticInputs("").parsed, {});
      assert.deepStrictEqual(parseStaticInputs("{}").parsed, {});
    });

    it("accepts valid shape with otp/email_code/2fa/captcha", () => {
      const r = parseStaticInputs(
        JSON.stringify({ otp: "123456", email_code: "ABCD", "2fa": "9876", captcha: "blue" })
      );
      assert.strictEqual(r.valid, true);
      assert.deepStrictEqual(r.parsed, {
        otp: "123456",
        email_code: "ABCD",
        "2fa": "9876",
        captcha: "blue",
      });
    });

    it("strips empty-string fields (treats '' as not supplied)", () => {
      const r = parseStaticInputs(JSON.stringify({ otp: "123456", captcha: "" }));
      assert.strictEqual(r.valid, true);
      assert.deepStrictEqual(r.parsed, { otp: "123456" });
    });

    it("rejects unknown keys via .strict()", () => {
      const r = parseStaticInputs(JSON.stringify({ otp: "1", face_id: "x" }));
      assert.strictEqual(r.valid, false);
      assert.match(r.error, /Invalid staticInputs/);
    });

    it("rejects invalid JSON", () => {
      const r = parseStaticInputs("{not json");
      assert.strictEqual(r.valid, false);
    });

    it("rejects non-object JSON (array)", () => {
      const r = parseStaticInputs('["a","b"]');
      assert.strictEqual(r.valid, false);
      assert.match(r.error, /must be a JSON object/);
    });

    it("rejects values longer than 256 chars", () => {
      const r = parseStaticInputs(JSON.stringify({ otp: "x".repeat(257) }));
      assert.strictEqual(r.valid, false);
    });
  });
});

// ---------------------------------------------------------------------------
// Error envelope tests
// ---------------------------------------------------------------------------

const { wrapSuccess, wrapError, errorHandler } = require("../../middleware/error-handler");

describe("Error envelope", () => {
  describe("wrapSuccess()", () => {
    it("wraps data in success envelope", () => {
      const result = wrapSuccess({ jobId: "abc" });
      assert.deepStrictEqual(result, {
        success: true,
        data: { jobId: "abc" },
      });
    });

    it("wraps null data", () => {
      const result = wrapSuccess(null);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data, null);
    });
  });

  describe("wrapError()", () => {
    it("wraps error message", () => {
      const result = wrapError("Something failed");
      assert.deepStrictEqual(result, {
        success: false,
        error: "Something failed",
      });
    });

    it("includes code and details when provided", () => {
      const result = wrapError("Validation failed", "VALIDATION_ERROR", ["field required"]);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.code, "VALIDATION_ERROR");
      assert.deepStrictEqual(result.details, ["field required"]);
    });
  });

  describe("errorHandler middleware", () => {
    function mockRes() {
      const r = {
        statusCode: 200,
        body: null,
        status(code) { r.statusCode = code; return r; },
        json(data) { r.body = data; return r; },
      };
      return r;
    }

    it("converts thrown error to error envelope", () => {
      const err = new Error("Something broke");
      err.status = 400;
      const res = mockRes();

      errorHandler(err, { method: "POST", path: "/api/test" }, res, () => {});

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error, "Something broke");
    });

    it("masks error message for 500s", () => {
      const err = new Error("DB connection lost: password=secret");
      const res = mockRes();

      errorHandler(err, { method: "GET", path: "/api/test" }, res, () => {});

      assert.strictEqual(res.statusCode, 500);
      assert.strictEqual(res.body.error, "Internal server error");
    });

    it("uses err.statusCode if err.status is not set", () => {
      const err = new Error("Not found");
      err.statusCode = 404;
      const res = mockRes();

      errorHandler(err, { method: "GET", path: "/test" }, res, () => {});

      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(res.body.error, "Not found");
    });
  });
});
