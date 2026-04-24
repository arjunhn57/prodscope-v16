"use strict";

/**
 * routes/auth.js — /api/v1/auth/* + /api/v1/apply router (Phase 4.1).
 *
 * Split from server.js. Handles programmatic auth (API key → JWT), Google
 * sign-in (credential → JWT + user upsert), /auth/me, and the public
 * design-partner application form.
 */

const express = require("express");
const { z: zod } = require("zod");
const { OAuth2Client } = require("google-auth-library");

const store = require("../jobs/store");
const { logger } = require("../lib/logger");
const { generateToken } = require("../middleware/auth");
const { wrapSuccess, wrapError } = require("../middleware/error-handler");
const { loginLimiter, applyLimiter } = require("../middleware/rate-limiters");
const { sendApplicationNotification } = require("../output/application-email");

const router = express.Router();

// POST /api/v1/auth/login — Exchange API key for a JWT token.
router.post("/auth/login", loginLimiter, express.json(), (req, res) => {
  const { apiKey } = req.body || {};
  const configuredKey = process.env.PRODSCOPE_API_KEY;

  if (!configuredKey) {
    return res.status(501).json(wrapError("Authentication not configured on this server"));
  }
  if (!apiKey || apiKey !== configuredKey) {
    return res.status(401).json(wrapError("Invalid API key"));
  }
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(501).json(wrapError("JWT signing not configured"));
  }
  const token = generateToken(
    { type: "api_client", iat: Math.floor(Date.now() / 1000) },
    jwtSecret,
    "24h",
  );
  res.json(wrapSuccess({ token, expiresIn: "24h" }));
});

// POST /api/v1/auth/google — Verify a Google Identity Services ID token,
// upsert the user, return our signed JWT.
router.post("/auth/google", loginLimiter, express.json(), async (req, res) => {
  const { credential } = req.body || {};
  if (typeof credential !== "string" || credential.length === 0) {
    return res.status(400).json(wrapError("Missing Google credential"));
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(501).json(wrapError("Google auth not configured (set GOOGLE_CLIENT_ID)"));
  }
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(501).json(wrapError("JWT signing not configured (set JWT_SECRET)"));
  }

  try {
    const googleClient = new OAuth2Client(clientId);
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(401).json(wrapError("Google token missing email"));
    }
    if (!payload.email_verified) {
      return res.status(401).json(wrapError("Google email not verified"));
    }

    const user = store.upsertUserFromGoogle({
      googleId: payload.sub,
      email: payload.email,
      name: payload.name || "",
      picture: payload.picture || "",
    });

    const token = generateToken(
      {
        type: "user",
        sub: user.id,
        email: user.email,
        role: user.role,
        iat: Math.floor(Date.now() / 1000),
      },
      jwtSecret,
      "24h",
    );

    res.json(
      wrapSuccess({
        token,
        expiresIn: "24h",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture,
          role: user.role,
        },
      }),
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), component: "auth-google" },
      "Google ID token verification failed",
    );
    return res.status(401).json(wrapError("Invalid Google credential"));
  }
});

// GET /api/v1/auth/me — Return the authenticated user from the JWT.
router.get("/auth/me", (req, res) => {
  const user = req.user;
  if (!user || user.type !== "user") {
    return res.status(401).json(wrapError("Not a user session"));
  }
  const record = store.getUserById(user.sub);
  if (!record) {
    return res.status(404).json(wrapError("User not found"));
  }
  res.json(
    wrapSuccess({
      id: record.id,
      email: record.email,
      name: record.name,
      picture: record.picture,
      role: record.role,
    }),
  );
});

// ─── Design partner applications (public) ────────────────────────────────

const applicationSchema = zod.object({
  name: zod.string().trim().min(1, "Name is required").max(200),
  email: zod.string().trim().email("Enter a valid email").max(320),
  appName: zod.string().trim().min(1, "App name is required").max(200),
  playStoreUrl: zod
    .string()
    .trim()
    .max(500)
    .url("Enter a valid URL")
    .optional()
    .or(zod.literal("")),
  whyNow: zod.string().trim().max(500).optional().or(zod.literal("")),
  website: zod.string().optional(), // honeypot — must be empty
});

router.post("/apply", applyLimiter, express.json(), async (req, res) => {
  const parsed = applicationSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "field"}: ${i.message}`,
    );
    return res.status(400).json(wrapError("Validation failed", { details }));
  }

  // Honeypot: if `website` is filled, silently accept without storing.
  if (parsed.data.website && parsed.data.website.trim().length > 0) {
    return res.json(wrapSuccess({ id: "accepted" }));
  }

  const { name, email, appName, playStoreUrl, whyNow } = parsed.data;
  const ip = req.ip || req.headers["x-forwarded-for"] || null;
  const userAgent = req.headers["user-agent"] || null;

  let record;
  try {
    record = store.createApplication({
      name,
      email,
      appName,
      playStoreUrl: playStoreUrl || null,
      whyNow: whyNow || null,
      ip: typeof ip === "string" ? ip : null,
      userAgent: typeof userAgent === "string" ? userAgent : null,
    });
  } catch (err) {
    logger.error({ err: err.message }, "Failed to persist design partner application");
    return res.status(500).json(wrapError("Could not save application"));
  }

  // Notify admins — best-effort, don't fail the request if email is down.
  const adminEmails = (process.env.ADMIN_EMAILS || "arjunhn57@gmail.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const notification = await sendApplicationNotification(adminEmails, {
    id: record.id,
    name,
    email,
    appName,
    playStoreUrl: playStoreUrl || null,
    whyNow: whyNow || null,
    ip: typeof ip === "string" ? ip : null,
    userAgent: typeof userAgent === "string" ? userAgent : null,
  });

  if (notification.status !== "sent") {
    logger.warn(
      {
        applicationId: record.id,
        notificationStatus: notification.status,
        error: notification.error,
      },
      "Design partner application saved but notification email failed",
    );
  } else {
    logger.info(
      { applicationId: record.id, adminCount: adminEmails.length },
      "Design partner application received",
    );
  }

  res.json(
    wrapSuccess({
      id: record.id,
      notification: notification.status,
    }),
  );
});

module.exports = router;
