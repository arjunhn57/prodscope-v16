"use strict";

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const multer = require("multer");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const os = require("os");

const store = require("./jobs/store");
const queue = require("./jobs/queue");
const { EmulatorPool } = require("./emulator/pool");
const {
  PORT,
  UPLOAD_DEST,
  USE_CRAWLER_V1,
  SKIP_AI_FOR_TESTS,
  SCREENSHOT_DIR_PREFIX,
} = require("./config/defaults");
const { createAuthMiddleware, generateToken } = require("./middleware/auth");
const { validateStartJob, MAX_FILE_SIZE_BYTES } = require("./middleware/validate");
const { wrapSuccess, wrapError, errorHandler } = require("./middleware/error-handler");
const { logger, requestLogger } = require("./lib/logger");
const metrics = require("./lib/metrics");
const magicLink = require("./lib/magic-link");
const { renderReportEmail } = require("./output/email-renderer");
const { sendApplicationNotification } = require("./output/application-email");
const { z: zod } = require("zod");

// ─── Environment validation ──────────────────────────────────────────────────
const REQUIRED_ENV_VARS = ["ANTHROPIC_API_KEY"];
const OPTIONAL_ENV_VARS = [
  "JWT_SECRET",
  "PRODSCOPE_API_KEY",
  "CORS_ALLOWED_ORIGINS",
  "GOOGLE_CLIENT_ID",
  "ADMIN_EMAILS",
  "MAGIC_LINK_SECRET",
  "PUBLIC_APP_URL",
  "RESEND_API_KEY",
];

function validateEnvironment() {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    logger.error({ missing }, "FATAL: Missing required environment variables");
    logger.error("See .env.example for the full list of required variables.");
    process.exit(1);
  }

  // Warn about missing optional security vars
  const missingOptional = OPTIONAL_ENV_VARS.filter((v) => !process.env[v]);
  if (missingOptional.length > 0) {
    logger.warn({ missingOptional }, "Missing optional env vars");
    if (!process.env.JWT_SECRET && !process.env.PRODSCOPE_API_KEY) {
      if (process.env.NODE_ENV === "production") {
        logger.error("FATAL: No JWT_SECRET or PRODSCOPE_API_KEY set in production mode.");
        process.exit(1);
      }
      logger.warn("No JWT_SECRET or PRODSCOPE_API_KEY — auth disabled (dev mode)");
    }
  }
}

validateEnvironment();

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();

// Trust proxy (for rate limiting behind nginx)
app.set("trust proxy", 1);

// A5: Security headers
app.use(helmet());

// ─── CORS (restricted in production) ─────────────────────────────────────────

const corsOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : [];

app.use(
  cors({
    origin: corsOrigins.length > 0
      ? corsOrigins
      : (process.env.NODE_ENV === "development" ? true : false),
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    maxAge: 86400,
  })
);

app.use(express.json({ limit: "1mb" }));

// D1: Structured request logging
app.use(requestLogger());

// ─── Authentication ──────────────────────────────────────────────────────────

const authMiddleware = createAuthMiddleware({
  jwtSecret: process.env.JWT_SECRET || "",
  apiKey: process.env.PRODSCOPE_API_KEY || "",
});

app.use(authMiddleware);

// ─── Rate limiting ───────────────────────────────────────────────────────────

// Rate limiters use default IP-based key generator (req.ip via trust proxy).
// keyGeneratorIpFallback suppressed: behind nginx, IPv6 bypass is not a concern.
const jobLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many job requests. Limit: 10 per minute." },
  validate: { xForwardedForHeader: false },
});

const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many status requests. Limit: 120 per minute." },
  validate: { xForwardedForHeader: false },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
  validate: { xForwardedForHeader: false },
});

const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many applications. Try again in an hour." },
  validate: { xForwardedForHeader: false },
});

// ─── Multer with file size limit ─────────────────────────────────────────────

const upload = multer({
  dest: UPLOAD_DEST,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

// ─── Auth endpoints ──────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/login — Exchange API key for a JWT token (CLI/programmatic).
 * Not used by the web UI in Phase 7+ — see /auth/google for the user flow.
 */
app.post("/api/v1/auth/login", loginLimiter, express.json(), (req, res) => {
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

  const token = generateToken({ type: "api_client", iat: Math.floor(Date.now() / 1000) }, jwtSecret, "24h");
  res.json(wrapSuccess({ token, expiresIn: "24h" }));
});

/**
 * POST /api/v1/auth/google — Verify a Google Identity Services ID token,
 * upsert the user into SQLite, and return our own signed JWT.
 *
 * Client flow:
 *   1. Frontend uses @react-oauth/google to get a `credential` (ID token JWT)
 *      signed by Google.
 *   2. POST { credential } to this endpoint.
 *   3. Server verifies the signature, audience, and email_verified claim via
 *      google-auth-library.
 *   4. On success, user row is upserted and a server JWT is returned that
 *      authenticates all subsequent API calls.
 */
const { OAuth2Client } = require("google-auth-library");

app.post("/api/v1/auth/google", loginLimiter, express.json(), async (req, res) => {
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
      "24h"
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
      })
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), component: "auth-google" },
      "Google ID token verification failed"
    );
    return res.status(401).json(wrapError("Invalid Google credential"));
  }
});

// ─── Design partner applications (Phase 7, Day 3) ───────────────────────────

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

/**
 * POST /api/v1/apply — Public design-partner application form.
 * Persists to design_partner_applications and emails ADMIN_EMAILS.
 * Rate-limited to 5/hour/IP. Includes a honeypot field for basic bot filtering.
 */
app.post("/api/v1/apply", applyLimiter, express.json(), async (req, res) => {
  const parsed = applicationSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "field"}: ${i.message}`
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
      { applicationId: record.id, notificationStatus: notification.status, error: notification.error },
      "Design partner application saved but notification email failed"
    );
  } else {
    logger.info(
      { applicationId: record.id, adminCount: adminEmails.length },
      "Design partner application received"
    );
  }

  res.json(
    wrapSuccess({
      id: record.id,
      notification: notification.status,
    })
  );
});

/**
 * GET /api/v1/auth/me — Return the authenticated user from the JWT.
 * Useful for the frontend to check token validity on page load.
 */
app.get("/api/v1/auth/me", (req, res) => {
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
    })
  );
});

// ─── Admin dashboard (Phase 7, Day 4) ───────────────────────────────────────
//
// All /admin routes require an authenticated user session (req.user.type === "user")
// whose DB record has role === "admin". The ADMIN_EMAILS env var controls which
// emails get promoted to admin at first login (see store.upsertUserFromGoogle).

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

app.get("/api/v1/admin/summary", requireAdmin, (req, res) => {
  try {
    res.json(wrapSuccess(store.adminSummary()));
  } catch (err) {
    logger.error({ err: err.message }, "adminSummary failed");
    res.status(500).json(wrapError("Could not load admin summary"));
  }
});

app.get("/api/v1/admin/applications", requireAdmin, (req, res) => {
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
    status: zod
      .enum(["new", "contacted", "onboarded", "declined"])
      .optional(),
    loiStatus: zod
      .enum(["not_asked", "asked", "signed", "declined"])
      .optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.loiStatus !== undefined,
    { message: "Provide at least one of: status, loiStatus" }
  );

app.patch("/api/v1/admin/applications/:id", requireAdmin, (req, res) => {
  const existing = store.getApplicationById(req.params.id);
  if (!existing) {
    return res.status(404).json(wrapError("Application not found"));
  }

  const parsed = applicationPatchSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "field"}: ${i.message}`
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
    })
  );
});

app.get("/api/v1/admin/users", requireAdmin, (req, res) => {
  const limit = Number(req.query.limit) || 200;
  try {
    const items = store.listUsersWithUsage({ limit });
    res.json(wrapSuccess({ items }));
  } catch (err) {
    logger.error({ err: err.message }, "listUsersWithUsage failed");
    res.status(500).json(wrapError("Could not load users"));
  }
});

app.get("/api/v1/admin/users/:id/jobs", requireAdmin, (req, res) => {
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

app.patch("/api/v1/admin/users/:id/role", requireAdmin, (req, res) => {
  const user = store.getUserById(req.params.id);
  if (!user) return res.status(404).json(wrapError("User not found"));

  const parsed = rolePatchSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json(wrapError("Validation failed"));
  }

  // Guard: admins can't demote themselves — they'd lose access immediately.
  if (user.id === req.adminUser.id && parsed.data.role !== "admin") {
    return res
      .status(400)
      .json(wrapError("You cannot remove your own admin role"));
  }

  try {
    const updated = store.setUserRole(req.params.id, parsed.data.role);
    logger.info(
      { adminEmail: req.adminUser.email, targetUserId: req.params.id, newRole: parsed.data.role },
      "Admin changed user role"
    );
    res.json(
      wrapSuccess({
        id: updated.id,
        email: updated.email,
        role: updated.role,
      })
    );
  } catch (err) {
    res.status(400).json(wrapError(err.message));
  }
});

// ─── API Documentation ──────────────────────────────────────────────────────

// C3: Serve OpenAPI spec and Swagger UI (CDN-based, no extra dependency)
app.get("/api/docs/openapi.yaml", (req, res) => {
  res.type("text/yaml").sendFile(path.join(__dirname, "docs", "openapi.yaml"));
});

app.get("/api/docs", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html><head><title>ProdScope API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head><body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: "/api/docs/openapi.yaml", dom_id: "#swagger-ui" });</script>
</body></html>`);
});

// ─── Routes ──────────────────────────────────────────────────────────────────

// D3: Enhanced health check
app.get("/health", async (req, res) => {
  const queueState = await queue.status();
  const health = {
    status: "ok",
    uptime: Math.floor(process.uptime()),
    queue: {
      processing: queueState.processing,
      depth: queueState.queueDepth,
      currentJobId: queueState.currentJobId,
    },
    metrics: metrics.summary(),
    memory: {
      rss: Math.floor(process.memoryUsage().rss / (1024 * 1024)),
      heap: Math.floor(process.memoryUsage().heapUsed / (1024 * 1024)),
    },
  };

  // Check DB connectivity
  try {
    store.db.prepare("SELECT 1").get();
    health.db = "ok";
  } catch (e) {
    health.db = "error";
    health.status = "degraded";
  }

  // Emulator pool status
  const pool = req.app.locals.emulatorPool;
  if (pool) {
    const ps = pool.status();
    health.emulators = {
      total: ps.total,
      idle: ps.idle,
      busy: ps.busy,
      unhealthy: ps.unhealthy,
    };
    if (ps.unhealthy > 0 && ps.idle === 0) {
      health.status = "degraded";
    }
  }

  res.json(wrapSuccess(health));
});

// D2: Prometheus metrics endpoint
app.get("/metrics", (req, res) => {
  res.set("Content-Type", "text/plain; charset=utf-8");
  res.send(metrics.toPrometheus());
});

/**
 * POST /api/start-job — Upload APK and enqueue a test job.
 * Returns immediately with jobId. Job runs in background via queue.
 */
app.post(
  "/api/v1/start-job",
  jobLimiter,
  upload.single("apk"),
  validateStartJob,
  async (req, res) => {
    const jobId = uuidv4();
    const validated = req.validatedBody;

    // Capture the owning user for usage rollups. API-key callers (type !== "user")
    // don't have a sub — leave it null so admin reports count them separately.
    const ownerUserId =
      req.user && req.user.type === "user" ? req.user.sub : null;

    // Non-PII trace: which staticInputs keys arrived (values omitted).
    // Helps diagnose "config: null" in DB when frontend/backend disagree.
    const staticKeys = validated.parsedStaticInputs
      ? Object.keys(validated.parsedStaticInputs)
      : [];
    logger.info(
      { jobId, traceId: req.traceId, staticInputKeys: staticKeys },
      "start-job: staticInputs ingested"
    );

    store.createJob(jobId, {
      status: "queued",
      step: 0,
      userId: ownerUserId,
      steps: [
        "Uploading",
        "Installing",
        "Crawling",
        "Analyzing",
        "Generating Report",
        "Sending Email",
      ],
      screenshots: [],
      report: null,
    });

    const originalName = req.file.originalname || "upload.apk";
    const ext = path.extname(originalName).toLowerCase() || ".apk";
    const apkPath = path.join(os.tmpdir(), jobId + ext);
    fs.copyFileSync(req.file.path, apkPath);

    // Clean up multer temp file
    try { fs.unlinkSync(req.file.path); } catch (_) {}

    // Enqueue — does NOT block the HTTP response
    await queue.enqueue(jobId, apkPath, {
      email: validated.email,
      credentials: validated.parsedCredentials,
      goldenPath: validated.goldenPath,
      painPoints: validated.painPoints,
      goals: validated.goals,
      staticInputs: validated.parsedStaticInputs || null,
      traceId: req.traceId,
    });

    const queueInfo = await queue.status();
    res.json(wrapSuccess({
      jobId,
      status: "queued",
      queuePosition: queueInfo.queueDepth,
    }));
  }
);

/**
 * GET /api/job-status/:jobId — Poll job progress.
 */
app.get("/api/v1/job-status/:jobId", statusLimiter, async (req, res) => {
  const job = store.getJob(req.params.jobId);
  if (!job) return res.status(404).json(wrapError("Job not found"));

  const pos = await queue.position(req.params.jobId);

  // Return only frontend-relevant fields — the full blob (crawlGraph,
  // triageLog, etc.) can exceed NGINX proxy buffers causing 502.
  // `live` mirrors the SSE shape so the UI can fall back to REST when the
  // SSE cache is empty (slow first tick, EventSource reconnect, stale bundle).
  res.json(wrapSuccess({
    status: job.status,
    step: job.step,
    steps: job.steps,
    screenshots: job.screenshots,
    report: job.report,
    stopReason: job.stopReason,
    crawlQuality: job.crawlQuality,
    error: job.error,
    emailStatus: job.emailStatus,
    queuePosition: pos,
    live: buildLivePayload(job),
  }));
});

// ─── Shareable report (magic-link) endpoints ────────────────────────────────

function resolveShareBaseUrl(req) {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL;
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return host ? `${proto}://${host}` : null;
}

/**
 * GET /api/v1/report-share-link/:jobId — Authenticated. Returns a token and
 * full shareable URL the caller can forward. No-op if the job doesn't exist
 * or magic-link secret is unset.
 */
app.get("/api/v1/report-share-link/:jobId", statusLimiter, (req, res) => {
  const { jobId } = req.params;
  const job = store.getJob(jobId);
  if (!job) return res.status(404).json(wrapError("Job not found"));

  if (!magicLink.isConfigured()) {
    return res.status(501).json(
      wrapError("Shareable links not configured (set MAGIC_LINK_SECRET)")
    );
  }

  const token = magicLink.signJobToken(jobId);
  const base = resolveShareBaseUrl(req);
  const shareUrl = base
    ? `${base.replace(/\/+$/, "")}/r/${encodeURIComponent(jobId)}?token=${token}`
    : null;

  res.json(
    wrapSuccess({
      jobId,
      token,
      shareUrl,
      downloadUrl: `/api/v1/report-html/${encodeURIComponent(jobId)}?token=${token}`,
    })
  );
});

/**
 * GET /api/v1/public-report/:jobId?token=xxx — Public (token-gated). Returns
 * the report JSON without an auth header, so a forwarded link works for any
 * recipient. Validates the HMAC token against MAGIC_LINK_SECRET.
 */
app.get("/api/v1/public-report/:jobId", statusLimiter, (req, res) => {
  const { jobId } = req.params;
  const token = typeof req.query.token === "string" ? req.query.token : "";

  if (!magicLink.isConfigured()) {
    return res.status(501).json(wrapError("Shareable links not configured"));
  }
  if (!magicLink.verifyJobToken(jobId, token)) {
    return res.status(403).json(wrapError("Invalid or missing share token"));
  }

  const job = store.getJob(jobId);
  if (!job) return res.status(404).json(wrapError("Report not found"));

  // Return only what's safe for a public viewer — no user/email/credentials.
  res.json(
    wrapSuccess({
      status: job.status,
      report: job.report,
      stopReason: job.stopReason,
      crawlQuality: job.crawlQuality,
      error: job.error,
      screenshots: job.screenshots,
    })
  );
});

/**
 * GET /api/v1/report-html/:jobId[?token=xxx] — Serves a standalone HTML
 * version of the report for "Download HTML" / print-to-PDF. Accepts either
 * a valid magic-link token OR an authenticated bearer token (via the normal
 * auth middleware).
 *
 * Note: this route lives under a PUBLIC_PREFIXES entry so the middleware
 * lets it through; auth is enforced here per-request.
 */
app.get("/api/v1/report-html/:jobId", statusLimiter, (req, res) => {
  const { jobId } = req.params;
  const token = typeof req.query.token === "string" ? req.query.token : "";

  let authorized = false;

  // Path A: magic-link token
  if (token && magicLink.isConfigured() && magicLink.verifyJobToken(jobId, token)) {
    authorized = true;
  }

  // Path B: Bearer JWT (we have to re-verify here because the middleware
  // skipped this path). Reuse the auth module's validator.
  if (!authorized) {
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ") && process.env.JWT_SECRET) {
      const jwt = authHeader.slice(7);
      const { validateJwt } = require("./middleware/auth");
      const result = validateJwt(jwt, process.env.JWT_SECRET);
      if (result.valid) authorized = true;
    }
  }

  if (!authorized) {
    return res.status(401).type("text/plain").send("Authentication required");
  }

  const job = store.getJob(jobId);
  if (!job) return res.status(404).type("text/plain").send("Report not found");
  if (!job.report) {
    return res.status(404).type("text/plain").send("Report not generated yet");
  }

  const reportText = typeof job.report === "string" ? job.report : JSON.stringify(job.report);
  const analysesCount =
    (job.report && job.report.crawl_health && job.report.crawl_health.aiScreensAnalyzed) || 0;
  const inner = renderReportEmail(reportText, analysesCount);

  const wantDownload = req.query.download === "1";
  res.set({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (wantDownload) {
    res.set(
      "Content-Disposition",
      `attachment; filename="prodscope-report-${jobId}.html"`
    );
  }

  res.send(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>ProdScope Report</title></head>` +
      `<body style="margin:0;background:#f9fafb;">${inner}</body></html>`
  );
});

/**
 * GET /api/job-live-stream/:jobId — Live MJPEG-style multipart stream of emulator screen.
 * Reads the crawler's own screenshots from disk (no extra ADB spawns).
 * ?single=1 returns the latest screenshot as a plain PNG (polling fallback).
 */
app.get("/api/v1/job-live-stream/:jobId", (req, res) => {
  const jobId = req.params.jobId;
  const job = store.getJob(jobId);
  if (!job) return res.status(404).send("Job not found");

  // Backward compat: single-frame mode for polling fallback
  if (req.query.single === "1") {
    if (job.live && job.live.path && fs.existsSync(job.live.path)) {
      return res.sendFile(job.live.path);
    }
    return res.status(404).send("No live screenshot yet");
  }

  const TERMINAL = new Set(["complete", "degraded", "failed"]);

  // Terminal job — nothing to stream
  if (TERMINAL.has(job.status)) {
    return res.status(204).send();
  }

  // Not started yet
  if (!job.live && job.status === "queued") {
    res.set("Retry-After", "5");
    return res.status(503).send("Job not started yet");
  }

  // Begin multipart stream
  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=frame",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });

  let stopped = false;
  let lastSentPath = null;
  const FRAME_DELAY_MS = 500;

  function sendFrame() {
    if (stopped) return;

    // Re-read job state for fresh metadata
    const currentJob = store.getJob(jobId);
    if (!currentJob) { stopped = true; try { res.end(); } catch (_) {} return; }

    const live = currentJob.live || {};
    const phase = live.phase || currentJob.status || "unknown";

    // Check for terminal state
    if (TERMINAL.has(currentJob.status) || TERMINAL.has(phase)) {
      stopped = true;
      try { res.end(); } catch (_) {}
      return;
    }

    // Read the latest screenshot the crawler saved to disk
    const screenshotPath = live.path;
    if (!screenshotPath || !fs.existsSync(screenshotPath) || screenshotPath === lastSentPath) {
      // No new frame — poll again shortly
      setTimeout(sendFrame, FRAME_DELAY_MS);
      return;
    }

    let pngBuf;
    try {
      pngBuf = fs.readFileSync(screenshotPath);
    } catch (_) {
      setTimeout(sendFrame, FRAME_DELAY_MS);
      return;
    }

    if (pngBuf.length === 0) {
      setTimeout(sendFrame, FRAME_DELAY_MS);
      return;
    }

    lastSentPath = screenshotPath;

    // Format action header
    let actionStr = "";
    if (live.latestAction && typeof live.latestAction === "object") {
      actionStr = [live.latestAction.type, live.latestAction.description]
        .filter(Boolean)
        .join(": ");
    } else if (live.latestAction) {
      actionStr = String(live.latestAction);
    }

    // Write multipart frame
    const header =
      "--frame\r\n" +
      "Content-Type: image/png\r\n" +
      "Content-Length: " + pngBuf.length + "\r\n" +
      "X-Phase: " + (phase || "running") + "\r\n" +
      "X-Step: " + (live.rawStep != null ? live.rawStep : "") + "\r\n" +
      "X-Total: " + (live.maxRawSteps != null ? live.maxRawSteps : "") + "\r\n" +
      "X-Unique: " + (live.countedUniqueScreens != null ? live.countedUniqueScreens : "") + "\r\n" +
      "X-Activity: " + (live.activity || "") + "\r\n" +
      "X-Intent: " + (live.intentType || "") + "\r\n" +
      "X-Action: " + actionStr + "\r\n" +
      "X-Message: " + (live.message || "") + "\r\n" +
      "\r\n";

    try {
      res.write(header);
      res.write(pngBuf);
      res.write("\r\n");
    } catch (_) {
      stopped = true;
      return;
    }

    setTimeout(sendFrame, FRAME_DELAY_MS);
  }

  // Start frame loop
  sendFrame();

  // Cleanup on client disconnect
  req.on("close", () => { stopped = true; });
  res.on("error", () => { stopped = true; });
});

/**
 * GET /api/job-sse/:jobId — Real-time Server-Sent Events stream of job progress.
 * Replaces polling for live crawl updates.
 */
app.get("/api/v1/job-sse/:jobId", (req, res) => {
  const jobId = req.params.jobId;
  const job = store.getJob(jobId);
  if (!job) return res.status(404).json(wrapError("Job not found"));

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send current state immediately
  const initial = buildSSEPayload(job);
  res.write("data: " + JSON.stringify(initial) + "\n\n");

  const TERMINAL = new Set(["complete", "degraded", "failed"]);

  const onUpdate = (updatedId) => {
    if (updatedId !== jobId) return;
    const current = store.getJob(jobId);
    if (!current) return;

    const payload = buildSSEPayload(current);
    try {
      res.write("data: " + JSON.stringify(payload) + "\n\n");
    } catch (_) {
      cleanup();
      return;
    }

    if (TERMINAL.has(current.status)) {
      try {
        res.write("event: done\ndata: {}\n\n");
        res.end();
      } catch (_) {}
      cleanup();
    }
  };

  function cleanup() {
    store.jobEvents.removeListener("job:updated", onUpdate);
  }

  store.jobEvents.on("job:updated", onUpdate);
  req.on("close", cleanup);
});

// Shared by /job-status poll and /job-sse stream — same `live` shape either way
// so the frontend can transparently fall back when the SSE cache is empty.
function buildLivePayload(job) {
  const live = job.live || {};
  return {
    phase: live.phase || job.status,
    rawStep: live.rawStep,
    maxRawSteps: live.maxRawSteps,
    countedUniqueScreens: live.countedUniqueScreens,
    targetUniqueScreens: live.targetUniqueScreens,
    activity: live.activity,
    packageName: live.packageName,
    intentType: live.intentType,
    latestAction: live.latestAction,
    captureMode: live.captureMode,
    screenshotUnavailable: live.screenshotUnavailable,
    screenshotPath: live.path,
    message: live.message,
    reasoning: live.reasoning ?? null,
    expectedOutcome: live.expectedOutcome ?? null,
    perceptionBoxes: Array.isArray(live.perceptionBoxes) ? live.perceptionBoxes : [],
    tapTarget: live.tapTarget ?? null,
    navTabs: Array.isArray(live.navTabs) ? live.navTabs : [],
    awaitingHumanInput: live.awaitingHumanInput || null,
  };
}

function buildSSEPayload(job) {
  return {
    status: job.status,
    step: job.step,
    steps: job.steps,
    live: buildLivePayload(job),
    stopReason: job.stopReason,
    crawlQuality: job.crawlQuality,
    error: job.error,
    emailStatus: job.emailStatus,
    report: job.report,
  };
}

// ─── V16.1 Human-in-the-loop input ──────────────────────────────────────────
//
// When the agent encounters an OTP / verification-code / CAPTCHA field it
// cannot fill from context, it emits `request_human_input`. agent-loop.js
// calls `store.awaitJobInput(jobId)` which blocks until either:
//   (a) the frontend POSTs a value to /human-input here,
//   (b) the frontend POSTs a cancel to /human-input/cancel,
//   (c) the 5-minute timeout fires inside the store.
//
// Rate limiting is per-jobId (not per-IP) because a single job with runaway
// agent could spam inputs; cap at MAX_HUMAN_INPUT_PER_JOB to prevent abuse.

const humanInputCounters = new Map();
const MAX_HUMAN_INPUT_PER_JOB = 10;
const MAX_HUMAN_INPUT_VALUE_LEN = 256;

app.post(
  "/api/v1/jobs/:jobId/human-input",
  statusLimiter,
  express.json(),
  (req, res) => {
    const { jobId } = req.params;
    const job = store.getJob(jobId);
    if (!job) return res.status(404).json(wrapError("Job not found"));

    const value = req.body && req.body.value;
    if (typeof value !== "string" || value.length === 0) {
      return res.status(400).json(wrapError("`value` must be a non-empty string"));
    }
    if (value.length > MAX_HUMAN_INPUT_VALUE_LEN) {
      return res.status(400).json(wrapError(
        `\`value\` too long (max ${MAX_HUMAN_INPUT_VALUE_LEN} chars)`
      ));
    }

    const count = humanInputCounters.get(jobId) || 0;
    if (count >= MAX_HUMAN_INPUT_PER_JOB) {
      return res.status(429).json(wrapError(
        `Too many human-input submissions for this job (max ${MAX_HUMAN_INPUT_PER_JOB})`
      ));
    }
    humanInputCounters.set(jobId, count + 1);

    const ok = store.resolveJobInput(jobId, value);
    if (!ok) {
      return res.status(404).json(wrapError("No pending human-input request for this job"));
    }

    logger.info(
      { jobId, valueLength: value.length, field: req.body.field || null, component: "human-input" },
      "Human input submitted"
    );
    res.json(wrapSuccess({ submitted: true }));
  }
);

app.post(
  "/api/v1/jobs/:jobId/human-input/cancel",
  statusLimiter,
  express.json(),
  (req, res) => {
    const { jobId } = req.params;
    const job = store.getJob(jobId);
    if (!job) return res.status(404).json(wrapError("Job not found"));

    const ok = store.rejectJobInput(jobId, "INPUT_CANCELLED");
    if (!ok) {
      return res.status(404).json(wrapError("No pending human-input request for this job"));
    }

    logger.info(
      { jobId, component: "human-input" },
      "Human input cancelled by user"
    );
    res.json(wrapSuccess({ cancelled: true }));
  }
);

/**
 * GET /api/job-screenshot/:jobId/:filename — Serve a crawl screenshot by filename.
 */
app.get("/api/v1/job-screenshot/:jobId/:filename", (req, res) => {
  const { jobId, filename } = req.params;
  // Sanitize filename to prevent directory traversal
  const safe = path.basename(filename);
  const screenshotDir = SCREENSHOT_DIR_PREFIX + jobId;
  const filePath = path.join(screenshotDir, safe);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Screenshot not found");
  }
  res.type("image/png").sendFile(filePath);
});

/**
 * GET /api/jobs — List recent jobs for the Dashboard feed.
 * Cursor-paginated by created_at (ISO). Newest first.
 * Defaults to limit=10, clamped to [1, 100].
 */
app.get("/api/v1/jobs", statusLimiter, (req, res) => {
  const limit = req.query.limit != null ? Number(req.query.limit) : 10;
  const cursor = typeof req.query.cursor === "string" && req.query.cursor.length > 0
    ? req.query.cursor
    : null;
  const page = store.listJobs({ limit, cursor });
  res.json(wrapSuccess(page));
});

/**
 * GET /api/queue-status — Get queue health info.
 */
app.get("/api/v1/queue-status", statusLimiter, async (req, res) => {
  const queueStatus = await queue.status();
  const pool = req.app.locals.emulatorPool;
  if (pool) {
    queueStatus.emulators = pool.status();
  }
  res.json(wrapSuccess(queueStatus));
});

// ─── Backwards compatibility: redirect /api/* to /api/v1/* ──────────────────

app.use("/api", (req, res, next) => {
  if (!req.path.startsWith("/v1/")) {
    return res.redirect(308, `/api/v1${req.path}`);
  }
  next();
});

// ─── Global error handler (must be last middleware) ─────────────────────────

app.use(errorHandler);

// ─── Process crash protection (B6) ──────────────────────────────────────────

/**
 * Save in-flight job state on crash/shutdown so it can be recovered.
 */
function saveInFlightJobs(reason) {
  try {
    const jobId = queue.getCurrentJobId();
    if (jobId) {
      store.updateJob(jobId, {
        status: "interrupted",
        error: `Server ${reason}`,
      });
      logger.error({ jobId, reason, component: "crash-protection" }, "Marked job as interrupted");
    }
  } catch (e) {
    logger.error({ err: e, component: "crash-protection" }, "Failed to save job state");
  }
}

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  saveInFlightJobs("uncaught_exception");
  // Exit with error code — PM2 will restart
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error({ reason }, "Unhandled rejection");
  // Release any busy emulators to prevent pool leaks
  const pool = app.locals.emulatorPool;
  if (pool) {
    const poolStatus = pool.status();
    for (const emu of poolStatus.emulators) {
      if (emu.status === "busy") {
        pool.release(emu.serial);
        logger.warn({ serial: emu.serial }, "Released emulator after unhandled rejection");
      }
    }
  }
  // Do NOT exit — unhandled rejections are often recoverable
});

process.on("SIGTERM", async () => {
  logger.info({ component: "shutdown" }, "SIGTERM received — graceful shutdown");
  const pool = app.locals.emulatorPool;
  if (pool) pool.stopHealthCheck();
  saveInFlightJobs("sigterm");
  await queue.shutdown().catch(() => {});
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info({ component: "shutdown" }, "SIGINT received — graceful shutdown");
  const pool = app.locals.emulatorPool;
  if (pool) pool.stopHealthCheck();
  saveInFlightJobs("sigint");
  await queue.shutdown().catch(() => {});
  process.exit(0);
});

// ─── Startup ─────────────────────────────────────────────────────────────────

async function startServer() {
  // Initialize emulator pool from env (default: single emulator)
  const emulatorSerials = process.env.EMULATOR_SERIALS
    ? process.env.EMULATOR_SERIALS.split(",").map((s) => s.trim()).filter(Boolean)
    : ["emulator-5554"];
  const pool = new EmulatorPool(emulatorSerials);
  app.locals.emulatorPool = pool;
  queue.setPool(pool);
  pool.startHealthCheck(require("./crawler/adb"));

  // Initialize BullMQ queue (connects to Redis)
  await queue.init();

  app.listen(PORT, "0.0.0.0", function () {
    const authStatus = (process.env.JWT_SECRET || process.env.PRODSCOPE_API_KEY)
      ? "ENABLED"
      : "DISABLED (no JWT_SECRET or PRODSCOPE_API_KEY)";

    logger.info({ port: PORT, auth: authStatus, crawlerV1: USE_CRAWLER_V1, skipAi: SKIP_AI_FOR_TESTS }, "ProdScope backend running");

    // Recover any jobs that were interrupted by a server restart
    queue.recoverPendingJobs();

    // Retention policy: unbounded by default (ingestion strategy, 2026-04-18).
    // Every crawl is a data-ingestion event for the future UI-navigation
    // training corpus -- we do not schedule automatic deletion. Manual calls
    // with a finite retentionDays are still available for dev resets / DSR.
    try {
      const { deletedJobs } = store.cleanupOldJobs();
      if (deletedJobs > 0) {
        logger.info({ deletedJobs, component: "retention" }, "Cleaned up old jobs");
      }
    } catch (e) {
      logger.warn({ err: e, component: "retention" }, "Job cleanup failed");
    }
  });
}

startServer().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
