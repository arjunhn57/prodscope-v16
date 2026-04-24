"use strict";

/**
 * multer-error-handler.js — translate multer failures into the
 * structured api-errors shape (Task 3.5).
 *
 * Multer emits its own MulterError objects with `.code` values like
 * `LIMIT_FILE_SIZE`. Without this middleware, those bubble up through
 * Express's default handler as HTML responses, or through the generic
 * wrapError() as stringified error messages. Users saw "File too large"
 * with no code, no retryable hint, no machine-readable branch.
 *
 * This middleware sits AFTER `upload.single(...)` and BEFORE the route
 * handler. It intercepts MulterError + filesystem ENOENT (upload dir
 * missing between startup mkdir and the request) and translates both.
 *
 * Any other error passes through to Express's default handler.
 */

const { sendApiError } = require("../lib/api-errors");

/**
 * @param {Error & {code?: string, storageErrors?: Array<Error & {code?: string}>}} err
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function multerErrorHandler(err, req, res, next) {
  if (!err) return next();

  // Multer's own errors carry `.code` strings we can map directly.
  // See multer docs: https://github.com/expressjs/multer#error-handling
  if (err.name === "MulterError") {
    switch (err.code) {
      case "LIMIT_FILE_SIZE":
        return sendApiError(res, "FILE_TOO_LARGE", {
          details: {
            limitBytes: err.limit || null,
            field: err.field || "apk",
          },
        });
      default:
        // Any other MulterError (unexpected field, too many files, etc.)
        // is still a user-facing input problem — use INVALID_APK with the
        // original message so the user knows what to fix.
        return sendApiError(res, "INVALID_APK", {
          message: `Upload rejected by multer (${err.code}): ${err.message}`,
        });
    }
  }

  // Filesystem ENOENT usually means the upload destination vanished
  // (disk cleanup, volume unmount, etc.) between server startup and
  // this request. Treat as transient — the startup mkdir will re-run
  // on the next boot, so caller should retry.
  if (err.code === "ENOENT" || (err.storageErrors && err.storageErrors.some((e) => e.code === "ENOENT"))) {
    return sendApiError(res, "UPLOAD_DEST_MISSING", {
      details: { sysErrCode: err.code || "ENOENT" },
    });
  }

  // Not a multer / filesystem error we know about — let the default
  // error handler deal with it so we don't swallow unknown failures.
  return next(err);
}

module.exports = { multerErrorHandler };
