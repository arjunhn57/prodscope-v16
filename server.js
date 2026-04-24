"use strict";

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const multer = require("multer");
const cors = require("cors");
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
const { createAuthMiddleware } = require("./middleware/auth");
const { validateStartJob, MAX_FILE_SIZE_BYTES } = require("./middleware/validate");
const { wrapSuccess, wrapError, errorHandler } = require("./middleware/error-handler");
const { multerErrorHandler } = require("./middleware/multer-error-handler");
const { sendApiError } = require("./lib/api-errors");
const { logger, requestLogger } = require("./lib/logger");
const metrics = require("./lib/metrics");
const magicLink = require("./lib/magic-link");
const { renderReportEmail } = require("./output/email-renderer");

// ─── Environment validation ──────────────────────────────────────────────────
// Extracted into config/env-validator.js so it's unit-testable. The validator
// is a pure function; this file is responsible for acting on the result —
// logging warnings and exiting on fatal misconfigurations.
const { validateEnvironment } = require("./config/env-validator");

const envResult = validateEnvironment(process.env);
for (const warning of envResult.warnings) {
  logger.warn(warning);
}
if (!envResult.ok) {
  for (const error of envResult.fatal) {
    logger.error(error);
  }
  logger.error("See .env.example for the full list of required variables.");
  process.exit(1);
}

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
// Limiter instances moved into middleware/rate-limiters.js (sprint-4.1).
// Routers import only the limiter they need.
const {
  jobLimiter,
  statusLimiter,
} = require("./middleware/rate-limiters");

// ─── Multer with file size limit ─────────────────────────────────────────────
// Ensure the upload scratch directory exists at startup. Without this a VM
// disk-cleanup (or a fresh box) that removes /tmp/uploads leaves multer in a
// state where every POST /api/v1/start-job 500s with ENOENT. The recursive
// flag is safe on existing dirs and creates parents if needed.

try {
  fs.mkdirSync(UPLOAD_DEST, { recursive: true });
} catch (err) {
  // eslint-disable-next-line no-console -- logger not ready this early
  console.error(`[startup] failed to ensure UPLOAD_DEST ${UPLOAD_DEST}:`, err.message);
  process.exit(1);
}

const upload = multer({
  dest: UPLOAD_DEST,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

// ─── Mounted routers (sprint-4.1 split) ─────────────────────────────────────
// Each router imports its own auth middleware / rate limiters / store so
// this file stays a wiring layer. Jobs + reports are next in a follow-up.
app.use("/api/v1", require("./routes/auth"));        // /auth/*, /apply
app.use("/api/v1/admin", require("./routes/admin")); // /admin/*

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
// Route-scoped middleware — multer errors (file too large, ENOENT on /tmp/uploads)
// must be translated into the structured api-errors shape BEFORE the route
// handler runs, otherwise Express's default handler swallows them as HTML.
function uploadApkMiddleware(req, res, next) {
  upload.single("apk")(req, res, (err) => {
    if (err) return multerErrorHandler(err, req, res, next);
    next();
  });
}

// APK sanity check — at minimum, the file must have the PK zip magic.
// aapt2 would fail later with an inscrutable error; better to fail fast
// with the INVALID_APK code so the UI can tell the user exactly what's wrong.
function validateApkMagicBytes(req, res, next) {
  if (!req.file || !req.file.path) return next();
  try {
    const fd = fs.openSync(req.file.path, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    // APK/AAB/XAPK are ZIPs — must start with "PK\x03\x04" or "PK\x05\x06" (empty zip).
    const isZip =
      buf[0] === 0x50 && buf[1] === 0x4b &&
      ((buf[2] === 0x03 && buf[3] === 0x04) || (buf[2] === 0x05 && buf[3] === 0x06));
    if (!isZip) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return sendApiError(res, "INVALID_APK", {
        details: {
          reason: "file does not start with PK zip magic bytes",
          firstBytes: [...buf].map((b) => b.toString(16).padStart(2, "0")).join(" "),
        },
      });
    }
  } catch (e) {
    return sendApiError(res, "INVALID_APK", {
      message: `Could not read uploaded file: ${e.message}`,
    });
  }
  next();
}

app.post(
  "/api/v1/start-job",
  jobLimiter,
  uploadApkMiddleware,
  validateApkMagicBytes,
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
    // Non-PII trace: which credential fields arrived (values omitted). Answers
    // "the user said they gave creds — did we actually receive them?" from logs.
    const credFields = validated.parsedCredentials
      ? Object.keys(validated.parsedCredentials).filter(
          (k) =>
            typeof validated.parsedCredentials[k] === "string" &&
            validated.parsedCredentials[k].length > 0,
        )
      : [];
    logger.info(
      {
        jobId,
        traceId: req.traceId,
        staticInputKeys: staticKeys,
        credentialsPresent: credFields.length > 0,
        credentialFields: credFields,
      },
      "start-job: inputs ingested"
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
