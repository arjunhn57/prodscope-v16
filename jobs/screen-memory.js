"use strict";

/**
 * screen-memory.js — Cross-crawl memory backed by SQLite.
 *
 * Persists per-screen action outcomes so the crawler skips known dead ends
 * on subsequent runs of the same app. Data is keyed by (app_package, fingerprint).
 *
 * Schema lives alongside the existing jobs database (better-sqlite3 is sync,
 * so there is zero async overhead on the crawl hot path).
 */

const { db } = require("./store");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "screen-memory" });

// ── Schema (idempotent) ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS screen_memory (
    app_package TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    screen_type TEXT,
    feature TEXT,
    action_outcomes TEXT DEFAULT '{}',
    total_visits INTEGER DEFAULT 0,
    last_crawl_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (app_package, fingerprint)
  );
`);

// ── Prepared statements ────────────────────────────────────────────────────
const stmts = {
  loadAll: db.prepare(
    "SELECT fingerprint, screen_type, feature, action_outcomes, total_visits FROM screen_memory WHERE app_package = ?"
  ),
  upsert: db.prepare(`
    INSERT INTO screen_memory (app_package, fingerprint, screen_type, feature, action_outcomes, total_visits, last_crawl_at)
    VALUES (@pkg, @fp, @type, @feature, @outcomes, @visits, datetime('now'))
    ON CONFLICT(app_package, fingerprint) DO UPDATE SET
      screen_type  = COALESCE(excluded.screen_type, screen_memory.screen_type),
      feature      = COALESCE(excluded.feature, screen_memory.feature),
      action_outcomes = excluded.action_outcomes,
      total_visits    = screen_memory.total_visits + excluded.total_visits,
      last_crawl_at   = datetime('now')
  `),
  stats: db.prepare(
    "SELECT COUNT(*) as screens, COALESCE(SUM(total_visits), 0) as visits FROM screen_memory WHERE app_package = ?"
  ),
};

// Outcomes worth remembering across crawls (permanent failures).
const PERMANENT_BAD = new Set(["ineffective", "out_of_app", "crash", "dead_end"]);

/**
 * Normalize a raw action_outcomes entry into the rich shape.
 * Handles two legacy formats:
 *   - string: "ineffective" (v1, pre-learning-loop)
 *   - rich object: { ok, bad, newScreen, lastOutcome } (v2, current)
 */
function normalizeEntry(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    // v1 legacy: single outcome string. Treat as a single bad observation.
    return {
      ok: 0,
      bad: PERMANENT_BAD.has(raw) ? 1 : 0,
      newScreen: 0,
      lastOutcome: raw,
    };
  }
  if (typeof raw === "object") {
    return {
      ok: Number.isInteger(raw.ok) ? raw.ok : 0,
      bad: Number.isInteger(raw.bad) ? raw.bad : 0,
      newScreen: Number.isInteger(raw.newScreen) ? raw.newScreen : 0,
      lastOutcome: typeof raw.lastOutcome === "string" ? raw.lastOutcome : null,
    };
  }
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Load cross-crawl memory for a package.
 *
 * Returns a Map keyed by fingerprint. Each entry has an `actionOutcomes` object
 * whose values are normalized rich entries: { ok, bad, newScreen, lastOutcome }.
 * Legacy string entries from v1 are auto-upgraded on read.
 *
 * @param {string} packageName
 * @returns {Map<string, { screenType: string|null, feature: string|null, actionOutcomes: Object<string, {ok:number,bad:number,newScreen:number,lastOutcome:string|null}>, totalVisits: number }>}
 */
function loadMemory(packageName) {
  const rows = stmts.loadAll.all(packageName);
  const memory = new Map();
  for (const row of rows) {
    const rawOutcomes = JSON.parse(row.action_outcomes || "{}");
    const normalized = {};
    for (const [key, value] of Object.entries(rawOutcomes)) {
      const entry = normalizeEntry(value);
      if (entry) normalized[key] = entry;
    }
    memory.set(row.fingerprint, {
      screenType: row.screen_type,
      feature: row.feature,
      actionOutcomes: normalized,
      totalVisits: row.total_visits,
    });
  }
  return memory;
}

/**
 * Persist this crawl's discoveries into cross-crawl memory.
 *
 * Accumulates outcome counts across crawls:
 *   - ok:        incremented per action that succeeded this crawl
 *   - bad:       incremented per action that permanently failed this crawl
 *   - newScreen: incremented when an action first-discovered a new screen
 *                (derived from stateGraph.parentMap, which records the action
 *                that first reached each target fingerprint)
 *
 * App-change self-healing: if an action that was previously bad is now 'ok',
 * its historical `bad` count is reset to 0 so the crawler stops avoiding it.
 *
 * @param {string} packageName
 * @param {object} stateGraph  — StateGraph instance
 * @param {Map}    classificationsByFp — Map<fp, { type, feature }>
 */
function saveMemory(packageName, stateGraph, classificationsByFp) {
  const existing = loadMemory(packageName);

  // Build a (fromFp → Set<actionKey>) map of first-discovery actions.
  // parentMap is keyed by toFp: { fromFp, actionKey } → first action that reached toFp.
  const firstDiscoveryActions = new Map();
  for (const { fromFp, actionKey } of stateGraph.parentMap.values()) {
    if (!firstDiscoveryActions.has(fromFp)) {
      firstDiscoveryActions.set(fromFp, new Set());
    }
    firstDiscoveryActions.get(fromFp).add(actionKey);
  }

  const nodes = [];
  for (const [fp, data] of stateGraph.nodes) {
    // Skip ephemeral / screenshot-only fingerprints
    if (fp === "empty_screen" || fp.startsWith("ss_")) continue;

    // Start with existing rich entries (already normalized by loadMemory)
    const prev = existing.get(fp);
    const merged = {};
    if (prev) {
      for (const [k, v] of Object.entries(prev.actionOutcomes)) {
        merged[k] = { ok: v.ok, bad: v.bad, newScreen: v.newScreen, lastOutcome: v.lastOutcome };
      }
    }

    const newDiscoverySet = firstDiscoveryActions.get(fp) || new Set();

    // Layer in this crawl's outcomes
    for (const [key, outcome] of data.actionOutcomes) {
      const entry = merged[key] || { ok: 0, bad: 0, newScreen: 0, lastOutcome: null };

      if (outcome === "ok") {
        entry.ok += 1;
        // App-change self-healing: action works now, so clear historical bad count
        entry.bad = 0;
        entry.lastOutcome = "ok";
      } else if (PERMANENT_BAD.has(outcome)) {
        entry.bad += 1;
        entry.lastOutcome = outcome;
      } else {
        // Transient outcome (dead_end_1, etc.) — don't count, just record
        entry.lastOutcome = outcome;
      }

      if (newDiscoverySet.has(key)) {
        entry.newScreen += 1;
      }

      merged[key] = entry;
    }

    // Drop entries with zero evidence (shouldn't happen, defensive)
    for (const k of Object.keys(merged)) {
      const e = merged[k];
      if (e.ok === 0 && e.bad === 0 && e.newScreen === 0 && !e.lastOutcome) {
        delete merged[k];
      }
    }

    const cls = classificationsByFp.get(fp);
    nodes.push({
      pkg: packageName,
      fp,
      type: cls ? cls.type : (prev ? prev.screenType : null),
      feature: cls ? cls.feature : (prev ? prev.feature : null),
      outcomes: JSON.stringify(merged),
      visits: data.visitCount,
    });
  }

  if (nodes.length === 0) return;

  const saveAll = db.transaction((items) => {
    for (const item of items) {
      stmts.upsert.run(item);
    }
  });
  saveAll(nodes);

  let totalActions = 0;
  let badActions = 0;
  let newScreenActions = 0;
  for (const n of nodes) {
    const entries = JSON.parse(n.outcomes);
    for (const e of Object.values(entries)) {
      totalActions += 1;
      if (e.bad > 0 && e.ok === 0) badActions += 1;
      if (e.newScreen > 0) newScreenActions += 1;
    }
  }
  log.info(
    { screenCount: nodes.length, totalActions, badActions, newScreenActions, packageName },
    "Saved screen memory"
  );
}

/**
 * Summary stats for logging.
 */
function getMemoryStats(packageName) {
  return stmts.stats.get(packageName) || { screens: 0, visits: 0 };
}

module.exports = { loadMemory, saveMemory, getMemoryStats };
