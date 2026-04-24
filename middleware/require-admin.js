"use strict";

/**
 * require-admin.js — Admin-only route guard.
 *
 * Runs AFTER the global auth middleware has populated req.user. Rejects
 * API-key callers (admin routes are user-session-only) and any user
 * whose DB role isn't "admin". The ADMIN_EMAILS env controls which
 * emails get the role at first Google sign-in via store.upsertUserFromGoogle.
 */

const store = require("../jobs/store");
const { wrapError } = require("./error-handler");

function requireAdmin(req, res, next) {
  if (!req.user || req.user.type !== "user") {
    return res.status(401).json(wrapError("Admin access requires a user session"));
  }
  const record = store.getUserById(req.user.sub);
  if (!record || record.role !== "admin") {
    return res.status(403).json(wrapError("Admin role required"));
  }
  req.adminUser = record;
  next();
}

module.exports = { requireAdmin };
