"use strict";

/**
 * validate.js — Zod-based request validation middleware.
 *
 * Validates the start-job request body and multer file upload.
 * Rejects with 400 + structured error on invalid input.
 */

const { z } = require("zod");

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const credentialsSchema = z
  .object({
    username: z.string().max(256).optional(),
    password: z.string().max(256).optional(),
    email: z.string().email().max(256).optional(),
  })
  .passthrough()
  .optional()
  .default({});

const startJobSchema = z.object({
  email: z.string().email("Invalid email address").max(320).optional(),
  credentials: z.string().max(2048).optional().default("{}"),
  goldenPath: z.string().max(5000).optional().default(""),
  painPoints: z.string().max(5000).optional().default(""),
  goals: z.string().max(5000).optional().default(""),
  // V16.1: optional known-input values ({ otp, email_code, "2fa", captcha })
  // sent as a JSON string so it fits the multipart form contract. Parsed by
  // parseStaticInputs; validated shape is enforced by staticInputsSchema.
  staticInputs: z.string().max(2048).optional().default("{}"),
});

const STATIC_INPUT_KEYS = ["otp", "email_code", "2fa", "captcha"];
const staticInputsSchema = z
  .object({
    otp: z.string().max(256).optional(),
    email_code: z.string().max(256).optional(),
    "2fa": z.string().max(256).optional(),
    captcha: z.string().max(256).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// File validation
// ---------------------------------------------------------------------------

const ALLOWED_EXTENSIONS = new Set([".apk", ".aab", ".xapk"]);
// 50 MB — Vercel proxy caps at ~4.5 MB, the production deployment
// uses direct-to-backend upload which is fine up to 50 MB. Larger APKs
// should be compressed (strip debug symbols, split ABIs) before upload.
// Task 3.5 — matched to the FILE_TOO_LARGE error code's documented limit.
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Validate the uploaded file.
 * @param {object} file - multer file object
 * @returns {{ valid: boolean, error?: string }}
 */
function validateFile(file) {
  if (!file) {
    return { valid: false, error: "APK file is required" };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File too large: ${(file.size / (1024 * 1024)).toFixed(1)}MB exceeds 200MB limit`,
    };
  }

  // Check extension
  const ext = (file.originalname || "").toLowerCase().split(".").pop();
  const dotExt = ext ? `.${ext}` : "";
  if (!ALLOWED_EXTENSIONS.has(dotExt)) {
    return {
      valid: false,
      error: `Invalid file type: ${dotExt || "unknown"}. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
    };
  }

  return { valid: true };
}

/**
 * Parse and validate the staticInputs JSON string from the upload form.
 * Returns a sparse object — blank values are stripped so the agent-loop's
 * "have I used a static for this field yet" check is simple.
 * @param {string} raw
 * @returns {{ valid: boolean, parsed?: Record<string, string>, error?: string }}
 */
function parseStaticInputs(raw) {
  if (!raw || raw === "{}") return { valid: true, parsed: {} };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { valid: false, error: "Invalid staticInputs JSON: " + e.message };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { valid: false, error: "staticInputs must be a JSON object" };
  }

  const result = staticInputsSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return { valid: false, error: "Invalid staticInputs: " + issues.join("; ") };
  }

  // Strip empty strings — we treat "" as "field not supplied".
  const cleaned = {};
  for (const key of STATIC_INPUT_KEYS) {
    const v = result.data[key];
    if (typeof v === "string" && v.length > 0) cleaned[key] = v;
  }
  return { valid: true, parsed: cleaned };
}

/**
 * Parse and validate the credentials JSON string.
 * @param {string} credStr
 * @returns {{ valid: boolean, parsed?: object, error?: string }}
 */
function parseCredentials(credStr) {
  if (!credStr || credStr === "{}") return { valid: true, parsed: {} };

  let parsed;
  try {
    parsed = JSON.parse(credStr);
  } catch (e) {
    return { valid: false, error: "Invalid credentials JSON: " + e.message };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { valid: false, error: "Credentials must be a JSON object" };
  }

  const result = credentialsSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return { valid: false, error: "Invalid credentials: " + issues.join("; ") };
  }

  return { valid: true, parsed: result.data };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware to validate start-job requests.
 */
function validateStartJob(req, res, next) {
  // Validate body fields
  const bodyResult = startJobSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const issues = bodyResult.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`
    );
    return res.status(400).json({
      error: "Validation failed",
      details: issues,
    });
  }

  // Validate file
  const fileResult = validateFile(req.file);
  if (!fileResult.valid) {
    return res.status(400).json({
      error: "File validation failed",
      details: [fileResult.error],
    });
  }

  // Validate and parse credentials
  const credResult = parseCredentials(bodyResult.data.credentials);
  if (!credResult.valid) {
    return res.status(400).json({
      error: "Credentials validation failed",
      details: [credResult.error],
    });
  }

  // Validate and parse staticInputs (V16.1)
  const staticResult = parseStaticInputs(bodyResult.data.staticInputs);
  if (!staticResult.valid) {
    return res.status(400).json({
      error: "staticInputs validation failed",
      details: [staticResult.error],
    });
  }

  // Attach validated data
  req.validatedBody = {
    ...bodyResult.data,
    parsedCredentials: credResult.parsed,
    parsedStaticInputs: staticResult.parsed,
  };

  next();
}

module.exports = {
  validateStartJob,
  validateFile,
  parseCredentials,
  parseStaticInputs,
  startJobSchema,
  staticInputsSchema,
  STATIC_INPUT_KEYS,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_EXTENSIONS,
};
