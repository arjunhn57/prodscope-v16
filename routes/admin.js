"use strict";

/**
 * routes/admin.js — /api/v1/admin/* router (Phase 4.1 split from server.js).
 *
 * All routes here are gated by requireAdmin: the caller must be a user
 * session whose DB role === "admin". ADMIN_EMAILS env controls initial
 * promotion at first Google sign-in.
 */

const express = require("express");
const { z: zod } = require("zod");

const store = require("../jobs/store");
const { logger } = require("../lib/logger");
const { wrapSuccess, wrapError } = require("../middleware/error-handler");
const { requireAdmin } = require("../middleware/require-admin");

const router = express.Router();

router.get("/summary", requireAdmin, (req, res) => {
  try {
    res.json(wrapSuccess(store.adminSummary()));
  } catch (err) {
    logger.error({ err: err.message }, "adminSummary failed");
    res.status(500).json(wrapError("Could not load admin summary"));
  }
});

router.get("/applications", requireAdmin, (req, res) => {
  const limit = Number(req.query.limit) || 100;
  try {
    const items = store.listApplications({ limit });
    res.json(
      wrapSuccess({
        items: items.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          appName: row.app_name,
          playStoreUrl: row.play_store_url,
          whyNow: row.why_now,
          status: row.status,
          loiStatus: row.loi_status,
          notes: row.notes,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      })
    );
  } catch (err) {
    logger.error({ err: err.message }, "listApplications failed");
    res.status(500).json(wrapError("Could not load applications"));
  }
});

const applicationPatchSchema = zod
  .object({
    status: zod.enum(["new", "contacted", "onboarded", "declined"]).optional(),
    loiStatus: zod.enum(["not_asked", "asked", "signed", "declined"]).optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.loiStatus !== undefined,
    { message: "Provide at least one of: status, loiStatus" },
  );

router.patch("/applications/:id", requireAdmin, (req, res) => {
  const existing = store.getApplicationById(req.params.id);
  if (!existing) {
    return res.status(404).json(wrapError("Application not found"));
  }

  const parsed = applicationPatchSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "field"}: ${i.message}`,
    );
    return res.status(400).json(wrapError("Validation failed", { details }));
  }

  try {
    if (parsed.data.status) {
      store.setApplicationStatus(req.params.id, parsed.data.status);
    }
    if (parsed.data.loiStatus) {
      store.setApplicationLoiStatus(req.params.id, parsed.data.loiStatus);
    }
  } catch (err) {
    return res.status(400).json(wrapError(err.message));
  }

  const updated = store.getApplicationById(req.params.id);
  res.json(
    wrapSuccess({
      id: updated.id,
      status: updated.status,
      loiStatus: updated.loi_status,
    }),
  );
});

router.get("/users", requireAdmin, (req, res) => {
  const limit = Number(req.query.limit) || 200;
  try {
    const items = store.listUsersWithUsage({ limit });
    res.json(wrapSuccess({ items }));
  } catch (err) {
    logger.error({ err: err.message }, "listUsersWithUsage failed");
    res.status(500).json(wrapError("Could not load users"));
  }
});

router.get("/users/:id/jobs", requireAdmin, (req, res) => {
  const user = store.getUserById(req.params.id);
  if (!user) return res.status(404).json(wrapError("User not found"));
  const limit = Number(req.query.limit) || 50;
  try {
    const items = store.listJobsForUser(req.params.id, { limit });
    res.json(wrapSuccess({ items }));
  } catch (err) {
    logger.error({ err: err.message }, "listJobsForUser failed");
    res.status(500).json(wrapError("Could not load user jobs"));
  }
});

const rolePatchSchema = zod.object({
  role: zod.enum(["public", "design_partner", "admin"]),
});

router.patch("/users/:id/role", requireAdmin, (req, res) => {
  const user = store.getUserById(req.params.id);
  if (!user) return res.status(404).json(wrapError("User not found"));

  const parsed = rolePatchSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json(wrapError("Validation failed"));
  }

  // Admins can't demote themselves — they'd lose access on the next request.
  if (user.id === req.adminUser.id && parsed.data.role !== "admin") {
    return res
      .status(400)
      .json(wrapError("You cannot remove your own admin role"));
  }

  try {
    const updated = store.setUserRole(req.params.id, parsed.data.role);
    logger.info(
      {
        adminEmail: req.adminUser.email,
        targetUserId: req.params.id,
        newRole: parsed.data.role,
      },
      "Admin changed user role",
    );
    res.json(
      wrapSuccess({
        id: updated.id,
        email: updated.email,
        role: updated.role,
      }),
    );
  } catch (err) {
    res.status(400).json(wrapError(err.message));
  }
});

module.exports = router;
