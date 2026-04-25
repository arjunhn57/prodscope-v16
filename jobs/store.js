"use strict";

const { EventEmitter } = require("events");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const { DB_PATH } = require("../config/defaults");

const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(20);

/**
 * Per-job human-input waiters. V16.1 request_human_input flow:
 * agent-loop.js calls awaitJobInput(jobId) when static credentials are missing
 * or exhausted; the POST /jobs/:id/human-input HTTP handler calls
 * resolveJobInput(jobId, value) to unblock the crawl. Single-slot per jobId —
 * a second awaitJobInput call on the same jobId rejects the prior waiter with
 * a "SUPERSEDED" error so we never hold orphaned promises.
 *
 * Waiters live in-memory only; a process restart drops them. Acceptable: the
 * agent loop would have died too, so there is no-one to resume.
 *
 * @type {Map<string, { resolve: (value: string) => void, reject: (reason: Error) => void, timeoutId: NodeJS.Timeout }>}
 */
const inputWaiters = new Map();

/**
 * Block until the HTTP layer posts a human-input value for this job or the
 * timeout fires. Resolves to the submitted string; rejects with INPUT_TIMEOUT
 * on timeout, INPUT_CANCELLED if the caller explicitly cancelled, or
 * INPUT_SUPERSEDED if another awaitJobInput replaced the waiter.
 *
 * @param {string} jobId
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<string>}
 */
function awaitJobInput(jobId, options) {
  const timeoutMs = (options && options.timeoutMs) || 5 * 60 * 1000;
  return new Promise((resolve, reject) => {
    const prev = inputWaiters.get(jobId);
    if (prev) {
      clearTimeout(prev.timeoutId);
      inputWaiters.delete(jobId);
      prev.reject(new Error("INPUT_SUPERSEDED"));
    }
    const timeoutId = setTimeout(() => {
      inputWaiters.delete(jobId);
      reject(new Error("INPUT_TIMEOUT"));
    }, timeoutMs);
    inputWaiters.set(jobId, { resolve, reject, timeoutId });
  });
}

/**
 * Resolve the pending waiter for a job. Returns true if a waiter existed.
 *
 * @param {string} jobId
 * @param {string} value
 * @returns {boolean}
 */
function resolveJobInput(jobId, value) {
  const entry = inputWaiters.get(jobId);
  if (!entry) return false;
  clearTimeout(entry.timeoutId);
  inputWaiters.delete(jobId);
  entry.resolve(value);
  return true;
}

/**
 * Reject the pending waiter for a job (used for explicit user cancel).
 * Returns true if a waiter existed.
 *
 * @param {string} jobId
 * @param {string} [reason="INPUT_CANCELLED"]
 * @returns {boolean}
 */
function rejectJobInput(jobId, reason) {
  const entry = inputWaiters.get(jobId);
  if (!entry) return false;
  clearTimeout(entry.timeoutId);
  inputWaiters.delete(jobId);
  entry.reject(new Error(reason || "INPUT_CANCELLED"));
  return true;
}

function hasPendingInput(jobId) {
  return inputWaiters.has(jobId);
}

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------------
// Schema — jobs table used now, rest created for Week 2+ tasks
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'queued',
    step INTEGER DEFAULT 0,
    app_package TEXT,
    config JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    data JSON DEFAULT '{}',
    user_id TEXT,
    cost_usd REAL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    google_id TEXT UNIQUE,
    name TEXT,
    picture TEXT,
    role TEXT NOT NULL DEFAULT 'public',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME,
    credits_remaining INTEGER NOT NULL DEFAULT 1,
    email_verified INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

  CREATE TABLE IF NOT EXISTS design_partner_applications (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    app_name TEXT NOT NULL,
    play_store_url TEXT,
    why_now TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    loi_status TEXT NOT NULL DEFAULT 'not_asked',
    notes TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_dp_applications_email ON design_partner_applications(email);
  CREATE INDEX IF NOT EXISTS idx_dp_applications_status ON design_partner_applications(status);

  CREATE TABLE IF NOT EXISTS crawl_sessions (
    id TEXT PRIMARY KEY,
    job_id TEXT REFERENCES jobs(id),
    started_at DATETIME,
    ended_at DATETIME,
    stats JSON,
    stop_reason TEXT
  );

  CREATE TABLE IF NOT EXISTS screen_cache (
    fingerprint TEXT PRIMARY KEY,
    fuzzy_fingerprint TEXT,
    screen_type TEXT,
    element_count INTEGER,
    classified_by TEXT,
    app_package TEXT
  );

  CREATE TABLE IF NOT EXISTS coverage (
    session_id TEXT REFERENCES crawl_sessions(id),
    feature_category TEXT,
    screen_type TEXT,
    fingerprint TEXT,
    visit_count INTEGER DEFAULT 1,
    actions_available INTEGER,
    actions_tried INTEGER,
    status TEXT DEFAULT 'exploring'
  );

  CREATE TABLE IF NOT EXISTS flows (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES crawl_sessions(id),
    feature_type TEXT,
    sub_type TEXT,
    fingerprint TEXT,
    steps JSON,
    outcome TEXT,
    bug_found BOOLEAN DEFAULT FALSE
  );

  CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES crawl_sessions(id),
    type TEXT,
    severity TEXT,
    confidence REAL,
    title TEXT,
    description TEXT,
    screen_fingerprint TEXT,
    screenshot_path TEXT,
    detected_by TEXT,
    evidence JSON,
    reproduction_steps JSON
  );

  CREATE TABLE IF NOT EXISTS checkpoints (
    session_id TEXT,
    step INTEGER,
    data JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_screen_cache_pkg ON screen_cache(app_package);
  CREATE INDEX IF NOT EXISTS idx_coverage_session ON coverage(session_id);
  CREATE INDEX IF NOT EXISTS idx_flows_session ON flows(session_id);
  CREATE INDEX IF NOT EXISTS idx_findings_session ON findings(session_id);
`);

// Phase 7, Day 4 — additive migration for pre-existing jobs DBs. ADD COLUMN is
// not idempotent in SQLite, so we check PRAGMA first.
(function migrateJobsColumns() {
  const existing = db.prepare("PRAGMA table_info(jobs)").all();
  const names = new Set(existing.map((c) => c.name));
  if (!names.has("user_id")) {
    db.exec("ALTER TABLE jobs ADD COLUMN user_id TEXT");
  }
  if (!names.has("cost_usd")) {
    db.exec("ALTER TABLE jobs ADD COLUMN cost_usd REAL");
  }
})();

// Freemium credit accounting migration (2026-04-27). Pre-existing rows: design
// partners + admin (Arjun). They are exempt from credit gating in the billing
// layer (see lib/billing/index.js — chargeRun skips by role), so the default
// credits_remaining=1 here is harmless for them. New "public" signups get
// 1 free credit, then hit paywall.
(function migrateUsersColumns() {
  const existing = db.prepare("PRAGMA table_info(users)").all();
  const names = new Set(existing.map((c) => c.name));
  if (!names.has("credits_remaining")) {
    db.exec("ALTER TABLE users ADD COLUMN credits_remaining INTEGER NOT NULL DEFAULT 1");
  }
  if (!names.has("email_verified")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
  }
})();

db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id)");

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const stmts = {
  insert: db.prepare(
    "INSERT INTO jobs (id, status, step, config, data, user_id) VALUES (?, ?, ?, ?, ?, ?)"
  ),
  get: db.prepare("SELECT * FROM jobs WHERE id = ?"),
  update: db.prepare(
    "UPDATE jobs SET status = ?, step = ?, completed_at = ?, data = ?, cost_usd = COALESCE(?, cost_usd) WHERE id = ?"
  ),
  // Cursor = ISO created_at; pass null for first page. LEFT JOIN on crawl_sessions
  // because that table is populated opportunistically by the crawler.
  list: db.prepare(`
    SELECT j.id, j.status, j.step, j.app_package, j.created_at, j.completed_at, j.data,
           s.stats AS session_stats, s.stop_reason AS session_stop_reason
    FROM jobs j
    LEFT JOIN crawl_sessions s ON s.job_id = j.id
    WHERE (?1 IS NULL OR j.created_at < ?1)
    ORDER BY j.created_at DESC
    LIMIT ?2
  `),

  userInsert: db.prepare(`
    INSERT INTO users (id, email, google_id, name, picture, role, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `),
  userUpdateLogin: db.prepare(`
    UPDATE users SET google_id = ?, name = ?, picture = ?, last_login_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
  userGetById: db.prepare("SELECT * FROM users WHERE id = ?"),
  userGetByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  userGetByGoogleId: db.prepare("SELECT * FROM users WHERE google_id = ?"),
  userSetRole: db.prepare("UPDATE users SET role = ? WHERE id = ?"),

  // Freemium credit accounting (2026-04-27).
  // Decrement is conditional on credits_remaining > 0 so a concurrent caller
  // can't take credits below zero — the .changes return tells us whether the
  // user had a credit to spend.
  userGetCredits: db.prepare(
    "SELECT credits_remaining, email_verified, role FROM users WHERE id = ?"
  ),
  userDecrementCredits: db.prepare(
    "UPDATE users SET credits_remaining = credits_remaining - 1 WHERE id = ? AND credits_remaining > 0"
  ),
  userIncrementCredits: db.prepare(
    "UPDATE users SET credits_remaining = credits_remaining + 1 WHERE id = ?"
  ),
  userSetEmailVerified: db.prepare(
    "UPDATE users SET email_verified = ? WHERE id = ?"
  ),

  appInsert: db.prepare(`
    INSERT INTO design_partner_applications
      (id, name, email, app_name, play_store_url, why_now, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  appGetByEmail: db.prepare(
    "SELECT * FROM design_partner_applications WHERE email = ? ORDER BY created_at DESC"
  ),
  appList: db.prepare(`
    SELECT * FROM design_partner_applications
    ORDER BY created_at DESC
    LIMIT ?1
  `),
  appSetStatus: db.prepare(`
    UPDATE design_partner_applications
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
  appSetLoiStatus: db.prepare(`
    UPDATE design_partner_applications
    SET loi_status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
};

// ---------------------------------------------------------------------------
// Store API
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(["complete", "degraded", "failed"]);

function createJob(id, initialData) {
  const { status, step, userId, ...rest } = initialData;
  stmts.insert.run(
    id,
    status || "queued",
    step ?? 0,
    JSON.stringify(rest._config || null),
    JSON.stringify(rest),
    userId || null
  );
}

function getJob(id) {
  const row = stmts.get.get(id);
  if (!row) return null;
  const data = JSON.parse(row.data || "{}");
  return {
    ...data,
    status: row.status,
    step: row.step,
    created_at: row.created_at,
    completed_at: row.completed_at,
    userId: row.user_id || null,
    costUsd: typeof row.cost_usd === "number" ? row.cost_usd : null,
  };
}

function updateJob(id, fields) {
  const row = stmts.get.get(id);
  if (!row) return;

  // Defensive: warn if unencrypted credentials are being written directly
  if (fields.credentials && typeof fields.credentials === "object" && !fields.credentials._encrypted) {
    const { logger: storeLogger } = require("../lib/logger");
    storeLogger.warn({ jobId: id, component: "store" },
      "SECURITY: Unencrypted credentials passed to updateJob — credentials should flow through queue.js");
  }

  const existing = JSON.parse(row.data || "{}");
  const newStatus = fields.status ?? row.status;
  const newStep = fields.step ?? row.step;

  // Auto-set completed_at on terminal status
  const completedAt =
    TERMINAL_STATUSES.has(newStatus) && !row.completed_at
      ? new Date().toISOString()
      : row.completed_at;

  // Merge non-column fields into the JSON blob
  const { status: _s, step: _st, costUsd, ...rest } = fields;
  const newData = { ...existing, ...rest };

  // cost_usd is a dedicated column; null means "leave untouched" (see COALESCE)
  const costForColumn = typeof costUsd === "number" && Number.isFinite(costUsd)
    ? costUsd
    : null;

  stmts.update.run(
    newStatus,
    newStep,
    completedAt,
    JSON.stringify(newData),
    costForColumn,
    id
  );

  jobEvents.emit("job:updated", id, fields);
}

/**
 * List recent jobs, newest first. Cursor-paginated by created_at.
 *
 * @param {{ limit?: number, cursor?: string | null }} options
 * @returns {{
 *   items: Array<{
 *     jobId: string,
 *     status: string,
 *     appPackage: string | null,
 *     createdAt: string,
 *     completedAt: string | null,
 *     screensCaptured: number,
 *     stepsRun: number,
 *     costInr: number,
 *     stopReason: string | null,
 *     crawlQuality: string | null,
 *     error: string | null
 *   }>,
 *   nextCursor: string | null
 * }}
 */
function listJobs({ limit = 10, cursor = null } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 10)));
  const rows = stmts.list.all(cursor || null, safeLimit);

  const items = rows.map((row) => {
    const data = JSON.parse(row.data || "{}");
    const sessionStats = row.session_stats ? safeParse(row.session_stats) : null;

    // Fall back through: session_stats -> data blob -> zero
    const screenshots = Array.isArray(data.screenshots) ? data.screenshots : [];
    const screensCaptured =
      (sessionStats && sessionStats.totalScreensCaptured) ||
      (sessionStats && sessionStats.uniqueScreens) ||
      screenshots.length ||
      0;

    const stepsRun =
      (sessionStats && sessionStats.totalSteps) ||
      row.step ||
      (Array.isArray(data.steps) ? data.steps.length : 0) ||
      0;

    const costInr =
      (sessionStats && sessionStats.totalCostInr) || data.totalCostInr || 0;

    return {
      jobId: row.id,
      status: row.status,
      appPackage: row.app_package || data.appPackage || null,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      screensCaptured,
      stepsRun,
      costInr,
      stopReason: data.stopReason || row.session_stop_reason || null,
      crawlQuality: data.crawlQuality || null,
      error: data.error || null,
    };
  });

  const nextCursor =
    items.length === safeLimit ? items[items.length - 1].createdAt : null;

  return { items, nextCursor };
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

/**
 * Remove completed/failed jobs older than retentionDays.
 *
 * NOTE -- Ingestion strategy (2026-04-18): ProdScope treats every crawl as a
 * data-ingestion event for the future proprietary UI-navigation training
 * corpus. Default retention is therefore unbounded (Infinity) -- this function
 * becomes a no-op unless a finite retentionDays is passed explicitly (e.g.
 * for dev resets or manual DSR-style deletes). Do not re-enable scheduled
 * cleanup without coordinating with the retention/compliance plan.
 *
 * @param {number} retentionDays
 * @returns {{ deletedJobs: number }}
 */
function cleanupOldJobs(retentionDays = Infinity) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return { deletedJobs: 0 };
  }
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  const result = db.prepare(
    "DELETE FROM jobs WHERE created_at < ? AND status IN ('complete', 'failed', 'degraded')"
  ).run(cutoff);
  if (result.changes > 0) {
    // Cascade-clean orphaned session/finding records
    db.prepare("DELETE FROM crawl_sessions WHERE job_id NOT IN (SELECT id FROM jobs)").run();
    db.prepare("DELETE FROM coverage WHERE session_id NOT IN (SELECT id FROM crawl_sessions)").run();
    db.prepare("DELETE FROM flows WHERE session_id NOT IN (SELECT id FROM crawl_sessions)").run();
    db.prepare("DELETE FROM findings WHERE session_id NOT IN (SELECT id FROM crawl_sessions)").run();
    db.prepare("DELETE FROM checkpoints WHERE session_id NOT IN (SELECT id FROM crawl_sessions)").run();
    db.prepare("VACUUM").run();
  }
  return { deletedJobs: result.changes };
}

// ---------------------------------------------------------------------------
// Users API (Phase 7, Day 1) — real Google OAuth-backed users.
// ---------------------------------------------------------------------------

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "arjunhn57@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function roleForEmail(email) {
  if (ADMIN_EMAILS.has(String(email || "").toLowerCase())) return "admin";
  return "public";
}

/**
 * Upsert a user from a verified Google ID token payload. Called by the
 * POST /api/v1/auth/google endpoint after OAuth2Client.verifyIdToken succeeds.
 *
 * @param {{ googleId: string, email: string, name?: string, picture?: string }} input
 * @returns {{ id: string, email: string, google_id: string, name: string | null, picture: string | null, role: string, created_at: string, last_login_at: string | null }}
 */
function upsertUserFromGoogle({ googleId, email, name = "", picture = "" }) {
  const existing = stmts.userGetByEmail.get(email);
  if (existing) {
    stmts.userUpdateLogin.run(googleId, name, picture, existing.id);
    return stmts.userGetById.get(existing.id);
  }
  const crypto = require("crypto");
  const id = "u_" + crypto.randomBytes(12).toString("hex");
  const role = roleForEmail(email);
  stmts.userInsert.run(id, email, googleId, name, picture, role);
  return stmts.userGetById.get(id);
}

function getUserById(id) {
  return stmts.userGetById.get(id) || null;
}

function getUserByEmail(email) {
  return stmts.userGetByEmail.get(email) || null;
}

function setUserRole(id, role) {
  const allowed = new Set(["public", "design_partner", "admin"]);
  if (!allowed.has(role)) throw new Error(`Invalid role: ${role}`);
  stmts.userSetRole.run(role, id);
  return stmts.userGetById.get(id);
}

/**
 * Read credit/verification state for a user without returning the full user
 * row. Returns null if the user isn't in the table.
 *
 * @param {string} userId
 * @returns {{ credits_remaining: number, email_verified: number, role: string } | null}
 */
function getUserCredits(userId) {
  return stmts.userGetCredits.get(userId) || null;
}

/**
 * Atomically decrement a user's credit balance by 1. Returns the new balance
 * or null if the user had no credits left. Uses a transaction so a concurrent
 * decrement can't drive the balance below zero.
 *
 * @param {string} userId
 * @returns {{ ok: true, balanceAfter: number } | { ok: false, reason: "no_credits" | "user_not_found", balance: number | null }}
 */
const decrementUserCredits = db.transaction((userId) => {
  const row = stmts.userGetCredits.get(userId);
  if (!row) return { ok: false, reason: "user_not_found", balance: null };
  if (row.credits_remaining <= 0) {
    return { ok: false, reason: "no_credits", balance: 0 };
  }
  const result = stmts.userDecrementCredits.run(userId);
  if (result.changes !== 1) {
    return { ok: false, reason: "no_credits", balance: 0 };
  }
  return { ok: true, balanceAfter: row.credits_remaining - 1 };
});

/**
 * Increment a user's credit balance by 1 (refund path). Returns the new
 * balance, or null if the user wasn't found.
 *
 * @param {string} userId
 * @returns {{ ok: true, balanceAfter: number } | { ok: false, reason: "user_not_found" }}
 */
const incrementUserCredits = db.transaction((userId) => {
  const row = stmts.userGetCredits.get(userId);
  if (!row) return { ok: false, reason: "user_not_found" };
  stmts.userIncrementCredits.run(userId);
  return { ok: true, balanceAfter: row.credits_remaining + 1 };
});

/**
 * Set the email_verified flag on a user. Stored as 0/1 in SQLite — pass
 * boolean from JS, we coerce.
 *
 * @param {string} userId
 * @param {boolean} verified
 * @returns {void}
 */
function setUserEmailVerified(userId, verified) {
  stmts.userSetEmailVerified.run(verified ? 1 : 0, userId);
}

// ---------------------------------------------------------------------------
// Design partner applications (Phase 7, Day 3). Public submissions from /apply.
// ---------------------------------------------------------------------------

const APPLICATION_STATUSES = new Set([
  "new",
  "contacted",
  "onboarded",
  "declined",
]);
const LOI_STATUSES = new Set(["not_asked", "asked", "signed", "declined"]);

/**
 * Insert a new design partner application. Caller is expected to have
 * validated inputs — this function only trims and persists.
 *
 * @param {{
 *   name: string,
 *   email: string,
 *   appName: string,
 *   playStoreUrl?: string|null,
 *   whyNow?: string|null,
 *   ip?: string|null,
 *   userAgent?: string|null,
 * }} input
 * @returns {{ id: string, createdAt: string }}
 */
function createApplication(input) {
  const crypto = require("crypto");
  const id = "dpa_" + crypto.randomBytes(10).toString("hex");
  stmts.appInsert.run(
    id,
    String(input.name).trim(),
    String(input.email).trim().toLowerCase(),
    String(input.appName).trim(),
    input.playStoreUrl ? String(input.playStoreUrl).trim() : null,
    input.whyNow ? String(input.whyNow).trim() : null,
    input.ip || null,
    input.userAgent || null
  );
  return { id, createdAt: new Date().toISOString() };
}

function getApplicationsByEmail(email) {
  return stmts.appGetByEmail.all(String(email || "").toLowerCase());
}

function listApplications({ limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
  return stmts.appList.all(safeLimit);
}

function setApplicationStatus(id, status) {
  if (!APPLICATION_STATUSES.has(status)) {
    throw new Error(`Invalid application status: ${status}`);
  }
  stmts.appSetStatus.run(status, id);
}

function setApplicationLoiStatus(id, loiStatus) {
  if (!LOI_STATUSES.has(loiStatus)) {
    throw new Error(`Invalid LOI status: ${loiStatus}`);
  }
  stmts.appSetLoiStatus.run(loiStatus, id);
}

function getApplicationById(id) {
  return (
    db
      .prepare("SELECT * FROM design_partner_applications WHERE id = ?")
      .get(id) || null
  );
}

// ---------------------------------------------------------------------------
// Admin dashboard queries (Phase 7, Day 4).
// Expose per-user usage/cost rollups + aggregate spend. Read-only except for
// role/status mutations handled via setUserRole and setApplicationStatus.
// ---------------------------------------------------------------------------

/**
 * Usage + spend for a single user across all their jobs.
 * Joined at query time rather than denormalised — volume is low (hundreds of
 * crawls max across the pilot), and sum-over-jobs is <10ms even unindexed.
 */
function listUsersWithUsage({ limit = 200 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 200)));
  const rows = db
    .prepare(
      `
      SELECT
        u.id,
        u.email,
        u.name,
        u.picture,
        u.role,
        u.created_at,
        u.last_login_at,
        COALESCE(j.crawl_count, 0) AS crawl_count,
        COALESCE(j.total_cost_usd, 0) AS total_cost_usd,
        j.last_crawl_at,
        j.last_status,
        a.loi_status,
        a.status AS application_status,
        a.id AS application_id
      FROM users u
      LEFT JOIN (
        SELECT
          user_id,
          COUNT(*) AS crawl_count,
          SUM(COALESCE(cost_usd, 0)) AS total_cost_usd,
          MAX(created_at) AS last_crawl_at,
          (SELECT status FROM jobs WHERE user_id = jobs.user_id ORDER BY created_at DESC LIMIT 1) AS last_status
        FROM jobs
        WHERE user_id IS NOT NULL
        GROUP BY user_id
      ) j ON j.user_id = u.id
      LEFT JOIN (
        SELECT email, loi_status, status, id,
               ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at DESC) AS rn
        FROM design_partner_applications
      ) a ON a.email = u.email AND a.rn = 1
      ORDER BY total_cost_usd DESC, u.created_at DESC
      LIMIT ?
      `
    )
    .all(safeLimit);

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    picture: r.picture,
    role: r.role,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
    crawlCount: r.crawl_count || 0,
    totalCostUsd: Number(r.total_cost_usd || 0),
    lastCrawlAt: r.last_crawl_at || null,
    lastStatus: r.last_status || null,
    loiStatus: r.loi_status || null,
    applicationStatus: r.application_status || null,
    applicationId: r.application_id || null,
  }));
}

/**
 * Per-user breakdown of the last N jobs (used on admin detail views).
 */
function listJobsForUser(userId, { limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
  return db
    .prepare(
      `
      SELECT id, status, app_package, created_at, completed_at, cost_usd
      FROM jobs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
      `
    )
    .all(userId, safeLimit)
    .map((r) => ({
      jobId: r.id,
      status: r.status,
      appPackage: r.app_package,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      costUsd: Number(r.cost_usd || 0),
    }));
}

/**
 * Top-of-dashboard aggregate spend + application counts.
 * "Last 7 days" is a rolling window, not calendar-week, so the number a
 * partner reads today still reflects the last 168 hours.
 */
function adminSummary() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const spend = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN created_at >= ? THEN COALESCE(cost_usd, 0) ELSE 0 END), 0) AS last7d_usd,
        COALESCE(SUM(COALESCE(cost_usd, 0)), 0) AS lifetime_usd,
        COUNT(*) AS total_jobs,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last7d_jobs
      FROM jobs
      `
    )
    .get(sevenDaysAgo, sevenDaysAgo);

  const userCounts = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total_users,
        SUM(CASE WHEN role = 'design_partner' THEN 1 ELSE 0 END) AS design_partners,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins
      FROM users
      `
    )
    .get();

  const apps = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count,
        SUM(CASE WHEN loi_status = 'signed' THEN 1 ELSE 0 END) AS loi_signed
      FROM design_partner_applications
      `
    )
    .get();

  return {
    spend: {
      last7dUsd: Number(spend.last7d_usd || 0),
      lifetimeUsd: Number(spend.lifetime_usd || 0),
      last7dJobs: Number(spend.last7d_jobs || 0),
      totalJobs: Number(spend.total_jobs || 0),
    },
    users: {
      total: Number(userCounts.total_users || 0),
      designPartners: Number(userCounts.design_partners || 0),
      admins: Number(userCounts.admins || 0),
    },
    applications: {
      total: Number(apps.total || 0),
      new: Number(apps.new_count || 0),
      loiSigned: Number(apps.loi_signed || 0),
    },
  };
}

module.exports = {
  createJob, getJob, updateJob, listJobs, jobEvents, db, cleanupOldJobs,
  upsertUserFromGoogle, getUserById, getUserByEmail, setUserRole,
  getUserCredits, decrementUserCredits, incrementUserCredits, setUserEmailVerified,
  createApplication, getApplicationsByEmail, listApplications,
  setApplicationStatus, setApplicationLoiStatus, getApplicationById,
  listUsersWithUsage, listJobsForUser, adminSummary,
  awaitJobInput, resolveJobInput, rejectJobInput, hasPendingInput,
};
