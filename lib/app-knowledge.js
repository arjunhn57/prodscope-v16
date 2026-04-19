"use strict";

/**
 * app-knowledge.js — Cross-crawl app-level knowledge store.
 *
 * Persists high-level facts about an app (auth method, guest mode,
 * framework type, FLAG_SECURE, etc.) so subsequent crawls can skip
 * known dead ends and allocate budgets more efficiently.
 *
 * Complementary to screen-memory.js (which stores per-screen action outcomes).
 * This stores app-wide intelligence.
 *
 * Schema lives alongside the existing jobs database (better-sqlite3, sync).
 */

const { db } = require("../jobs/store");

// ── Schema (idempotent) ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS app_knowledge (
    package_name TEXT PRIMARY KEY,
    auth_method TEXT,
    has_guest_mode INTEGER,
    escape_labels TEXT DEFAULT '[]',
    framework_type TEXT,
    avg_screen_count REAL,
    known_dialogs TEXT DEFAULT '[]',
    flag_secure INTEGER DEFAULT 0,
    crawl_count INTEGER DEFAULT 0,
    app_version TEXT,
    last_crawl_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Prepared statements ────────────────────────────────────────────────────
const stmts = {
  load: db.prepare(
    "SELECT * FROM app_knowledge WHERE package_name = ?"
  ),
  upsert: db.prepare(`
    INSERT INTO app_knowledge (
      package_name, auth_method, has_guest_mode, escape_labels,
      framework_type, avg_screen_count, known_dialogs, flag_secure,
      crawl_count, app_version, last_crawl_at
    ) VALUES (
      @packageName, @authMethod, @hasGuestMode, @escapeLabels,
      @frameworkType, @avgScreenCount, @knownDialogs, @flagSecure,
      1, @appVersion, datetime('now')
    )
    ON CONFLICT(package_name) DO UPDATE SET
      auth_method     = COALESCE(excluded.auth_method, app_knowledge.auth_method),
      has_guest_mode  = COALESCE(excluded.has_guest_mode, app_knowledge.has_guest_mode),
      escape_labels   = CASE
        WHEN excluded.escape_labels != '[]' THEN excluded.escape_labels
        ELSE app_knowledge.escape_labels
      END,
      framework_type  = COALESCE(excluded.framework_type, app_knowledge.framework_type),
      avg_screen_count = CASE
        WHEN app_knowledge.avg_screen_count IS NULL THEN excluded.avg_screen_count
        ELSE (app_knowledge.avg_screen_count + excluded.avg_screen_count) / 2.0
      END,
      known_dialogs   = CASE
        WHEN excluded.known_dialogs != '[]' THEN excluded.known_dialogs
        ELSE app_knowledge.known_dialogs
      END,
      flag_secure     = MAX(app_knowledge.flag_secure, excluded.flag_secure),
      crawl_count     = app_knowledge.crawl_count + 1,
      app_version     = COALESCE(excluded.app_version, app_knowledge.app_version),
      last_crawl_at   = datetime('now')
  `),
};

/**
 * Load prior knowledge about an app.
 * @param {string} packageName
 * @returns {{ authMethod: string|null, hasGuestMode: boolean|null, escapeLabels: string[], frameworkType: string|null, avgScreenCount: number|null, knownDialogs: string[], flagSecure: boolean, crawlCount: number, appVersion: string|null }|null}
 */
function loadAppKnowledge(packageName) {
  const row = stmts.load.get(packageName);
  if (!row) return null;

  return {
    authMethod: row.auth_method,
    hasGuestMode: row.has_guest_mode === 1 ? true : row.has_guest_mode === 0 ? false : null,
    escapeLabels: JSON.parse(row.escape_labels || "[]"),
    frameworkType: row.framework_type,
    avgScreenCount: row.avg_screen_count,
    knownDialogs: JSON.parse(row.known_dialogs || "[]"),
    flagSecure: !!row.flag_secure,
    crawlCount: row.crawl_count || 0,
    appVersion: row.app_version,
  };
}

/**
 * Save knowledge learned during a crawl.
 * Merges with existing data (upsert).
 *
 * @param {string} packageName
 * @param {object} knowledge
 * @param {string} [knowledge.authMethod] - "email"|"phone"|"google"|"none"|null
 * @param {boolean|null} [knowledge.hasGuestMode]
 * @param {string[]} [knowledge.escapeLabels] - labels that worked for auth escape
 * @param {string} [knowledge.frameworkType] - "native"|"compose"|"flutter"|"react_native"|null
 * @param {number} [knowledge.avgScreenCount] - unique screens discovered this crawl
 * @param {string[]} [knowledge.knownDialogs] - dialog types encountered
 * @param {boolean} [knowledge.flagSecure] - whether screenshots are blocked
 * @param {string} [knowledge.appVersion]
 */
function saveAppKnowledge(packageName, knowledge) {
  stmts.upsert.run({
    packageName,
    authMethod: knowledge.authMethod || null,
    hasGuestMode: knowledge.hasGuestMode === true ? 1 : knowledge.hasGuestMode === false ? 0 : null,
    escapeLabels: JSON.stringify(knowledge.escapeLabels || []),
    frameworkType: knowledge.frameworkType || null,
    avgScreenCount: knowledge.avgScreenCount || null,
    knownDialogs: JSON.stringify(knowledge.knownDialogs || []),
    flagSecure: knowledge.flagSecure ? 1 : 0,
    appVersion: knowledge.appVersion || null,
  });
}

module.exports = { loadAppKnowledge, saveAppKnowledge };
