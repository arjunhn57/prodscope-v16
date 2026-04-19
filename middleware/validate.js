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
});

// ---------------------------------------------------------------------------
// File validation
// ---------------------------------------------------------------------------

const ALLOWED_EXTENSIONS = new Set([".apk", ".aab", ".xapk"]);
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB

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

  // Attach validated data
  req.validatedBody = {
    ...bodyResult.data,
    parsedCredentials: credResult.parsed,
  };

  next();
}

module.exports = {
  validateStartJob,
  validateFile,
  parseCredentials,
  startJobSchema,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_EXTENSIONS,
};
