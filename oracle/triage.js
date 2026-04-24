"use strict";

/**
 * triage.js — Decide which screens warrant LLM vision analysis.
 *
 * Two entry points:
 *   - triageForAI (sync)         — legacy heuristic-only scoring. Still in
 *                                   use by callers that don't want an
 *                                   extra SDK call (tests, dry-runs).
 *   - triageWithRanker (async)   — Phase 3.1 Stage 1. One batched Haiku
 *                                   call that ranks ALL non-filtered
 *                                   screens semantically, merged with the
 *                                   heuristic score, then the top K go
 *                                   to Stage 2 deep analysis.
 *
 * The Stage 1 call is intentionally image-less: ~60 tokens input per
 * screen (screenType + visible labels + clickable count), one
 * round-trip, under $0.01 even for a 30-screen crawl.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "triage" });
const {
  MAX_AI_TRIAGE_SCREENS,
  MAX_DEEP_ANALYZE_SCREENS,
  ORACLE_STAGE1_ENABLED,
  ANALYSIS_MODEL,
} = require("../config/defaults");

const defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Stage 1 tool schema ────────────────────────────────────────────────────
// Single batched call; the input schema nails down the output shape so a
// malformed response can be detected and the caller can fall back to
// heuristic scoring.
const RANK_SCREENS_TOOL = {
  name: "rank_screens",
  description:
    "Rank each Android screen by bug-hotspot likelihood. " +
    "High score = likely to expose QA issues under automated exploration. " +
    "Consider: forms with error states, screens with many inputs, onboarding, " +
    "auth surfaces, payment/checkout. Low score = static content, simple lists.",
  input_schema: {
    type: "object",
    properties: {
      rankings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            step: { type: "number" },
            hotspot_score: { type: "number", minimum: 0, maximum: 10 },
            reason: { type: "string" },
          },
          required: ["step", "hotspot_score", "reason"],
        },
      },
    },
    required: ["rankings"],
  },
};

const RANKER_SYSTEM_PROMPT =
  "You are a QA triage ranker for an Android app exploration agent. " +
  "For each screen in the user's message, emit a hotspot_score 0-10 and a one-sentence reason. " +
  "Do not analyze deeply — you are just ordering. Higher-scored screens get deeper analysis next.";

// ── Heuristic scoring (unchanged from pre-3.1) ────────────────────────────

/**
 * Triage screens for AI analysis — synchronous heuristic path.
 *
 * @param {Array} screens - All captured screens from crawl
 * @param {Object} oracleFindings - Map of step → findings array
 * @param {Object} coverageSummary - Coverage tracker summary
 * @param {Object} [stateGraph] - Optional state graph for path info
 * @returns {{ screensToAnalyze: Array, skippedScreens: Array, triageLog: Array }}
 */
function triageForAI(screens, oracleFindings, coverageSummary, stateGraph) {
  const maxScreens = MAX_AI_TRIAGE_SCREENS;
  const triageLog = [];
  const scored = [];
  const seenTypes = new Set();
  const seenFuzzyFps = new Set();

  for (const screen of screens) {
    const screenType = screen.screenType || "unknown";
    const fuzzyFp = screen.fuzzyFp || "";
    const step = screen.step;
    const findings = (oracleFindings && oracleFindings[step]) || [];

    if (screenType === "dialog" || screenType === "system_dialog") {
      triageLog.push({ step, action: "skip", reason: "system_dialog" });
      continue;
    }
    if (fuzzyFp && seenFuzzyFps.has(fuzzyFp)) {
      triageLog.push({ step, action: "skip", reason: "duplicate_fuzzy_fp" });
      continue;
    }

    let score = 0;
    const hasCrash = findings.some((f) => f.type === "crash");
    const hasANR = findings.some((f) => f.type === "anr");
    const hasHighSev = findings.some((f) => f.severity === "high" || f.severity === "critical");
    const hasUxIssues = findings.some(
      (f) =>
        f.type === "missing_content_description" ||
        f.type === "small_tap_target" ||
        f.type === "empty_screen",
    );
    if (hasCrash) score += 100;
    if (hasANR) score += 80;
    if (hasHighSev) score += 60;
    if (hasUxIssues) score += 30;
    if (!seenTypes.has(screenType)) score += 40;
    if (screenType === "error") score += 50;

    const feature = screen.feature || "other";
    const featureCov = (coverageSummary && coverageSummary[feature]) || null;
    if (featureCov && featureCov.status === "exploring") score += 20;
    score += Math.max(0, 10 - step);

    scored.push({ screen, step, screenType, fuzzyFp, score, findings });
    seenTypes.add(screenType);
    if (fuzzyFp) seenFuzzyFps.add(fuzzyFp);
  }

  scored.sort((a, b) => b.score - a.score);

  const selected = [];
  const skipped = [];
  const typeCount = {};
  for (const s of scored) {
    const t = s.screenType || "unknown";
    typeCount[t] = (typeCount[t] || 0) + 1;
    if (selected.length < maxScreens && typeCount[t] <= 2) {
      selected.push(s);
    } else {
      skipped.push(s);
    }
  }

  for (const s of selected) {
    triageLog.push({
      step: s.step,
      action: "analyze",
      reason: `score=${s.score}, type=${s.screenType}`,
    });
  }
  for (const s of skipped) {
    triageLog.push({ step: s.step, action: "skip", reason: `below_cutoff (score=${s.score})` });
  }

  return {
    screensToAnalyze: selected.map((s) => s.screen),
    skippedScreens: skipped.map((s) => ({ step: s.step, reason: "below_cutoff" })),
    triageLog,
    // Internal: exposed so triageWithRanker can read the heuristic scores
    // without re-computing them.
    _scored: scored,
  };
}

// ── Stage 1 — Haiku ranker ─────────────────────────────────────────────────

/**
 * Extract a short visible-text summary from UIAutomator XML so the ranker
 * has something to reason about beyond a screenType label.
 */
function extractVisibleText(xml, max = 80) {
  if (!xml || typeof xml !== "string") return "";
  const texts = [];
  for (const m of xml.matchAll(/text="([^"]*)"/g)) {
    const t = (m[1] || "").trim();
    if (t) texts.push(t);
    if (texts.join(" ").length > max * 2) break;
  }
  return texts.join(" / ").slice(0, max);
}

function countClickables(xml) {
  if (!xml) return 0;
  return (xml.match(/clickable="true"/g) || []).length;
}

function countInputs(xml) {
  if (!xml) return 0;
  const edit = (xml.match(/android\.widget\.EditText/g) || []).length;
  const typed = (xml.match(/inputType="/g) || []).length;
  return edit + typed;
}

function clamp(n, lo, hi) {
  if (typeof n !== "number" || Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Rank screens semantically via a single batched Haiku call.
 *
 * @param {Array} candidates - Screens to rank (no images sent)
 * @param {{client?: object}} [opts]
 * @returns {Promise<Array<{step: number, hotspotScore: number, reason: string}> | null>}
 *          null on SDK error, malformed response, or missing tool_use —
 *          callers MUST treat null as "use heuristic scoring".
 */
async function rankScreens(candidates, opts = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const client = opts.client || defaultClient;

  const items = candidates.map((s, idx) => {
    const clickables = countClickables(s.xml);
    const inputs = countInputs(s.xml);
    const text = extractVisibleText(s.xml);
    return `[${idx}] step=${s.step} type=${s.screenType || "unknown"} clickables=${clickables} inputs=${inputs} text="${text}"`;
  });

  const userMessage =
    `Rank these ${items.length} screens by bug-hotspot likelihood. Return one ranking per screen.\n\n` +
    items.join("\n");

  let response;
  try {
    response = await client.messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 600,
      system: [
        {
          type: "text",
          text: RANKER_SYSTEM_PROMPT,
          // Cache the ranker system prompt — identical across every Stage 1
          // call for the run, so cache hits after the first screen.
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [RANK_SCREENS_TOOL],
      tool_choice: { type: "tool", name: RANK_SCREENS_TOOL.name },
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (e) {
    log.error({ err: e, candidates: candidates.length }, "Stage 1 ranker SDK call failed");
    return null;
  }

  let input = null;
  if (response && Array.isArray(response.content)) {
    for (const block of response.content) {
      if (block && block.type === "tool_use" && block.name === RANK_SCREENS_TOOL.name) {
        input = block.input;
        break;
      }
    }
  }
  if (!input || !Array.isArray(input.rankings)) {
    log.warn({ stop_reason: response && response.stop_reason }, "Stage 1 ranker returned no rankings array");
    return null;
  }

  // Normalize into a guaranteed-safe array. Extra entries from the model
  // are kept; missing entries mean that screen gets neutral score in
  // triageWithRanker below.
  return input.rankings.map((r) => ({
    step: typeof r.step === "number" ? r.step : -1,
    hotspotScore: clamp(r.hotspot_score, 0, 10),
    reason: typeof r.reason === "string" ? r.reason : "",
  }));
}

// ── Stage 1 + selection combined ───────────────────────────────────────────

/**
 * Phase 3.1 triage entry point: heuristic + Stage 1 ranker + top-K selection.
 *
 * On Stage 1 failure, falls back to heuristic scoring — zero regression
 * vs the legacy path.
 *
 * @param {Array} screens
 * @param {Object} oracleFindings
 * @param {Object} coverageSummary
 * @param {Object|null} stateGraph
 * @param {{client?: object, stage1Enabled?: boolean, maxDeepAnalyze?: number}} [opts]
 * @returns {Promise<{ screensToAnalyze: Array, skippedScreens: Array, triageLog: Array, rankerUsed: boolean }>}
 */
async function triageWithRanker(screens, oracleFindings, coverageSummary, stateGraph, opts = {}) {
  const stage1Enabled = opts.stage1Enabled !== undefined ? opts.stage1Enabled : ORACLE_STAGE1_ENABLED;
  const maxK = opts.maxDeepAnalyze || MAX_DEEP_ANALYZE_SCREENS;

  const baseline = triageForAI(screens, oracleFindings, coverageSummary, stateGraph);
  const allScored = baseline._scored || [];
  const skipEntries = baseline.triageLog.filter((e) => e.action === "skip");

  if (!stage1Enabled || allScored.length === 0) {
    return selectTopK(allScored, maxK, skipEntries, /* rankerUsed */ false);
  }

  const rankerScreens = allScored.map((s) => s.screen);
  const rankings = await rankScreens(rankerScreens, { client: opts.client });

  if (!rankings) {
    // Surface the fallback so the log reader can diagnose why Stage 2
    // didn't pick up the semantic boost.
    const fallbackLog = [
      ...skipEntries,
      {
        step: -1,
        action: "note",
        reason: "stage1 failed — heuristic fallback in effect",
      },
    ];
    return selectTopK(allScored, maxK, fallbackLog, /* rankerUsed */ false);
  }

  // Merge: rankerScore 0-10 maps to 0-150 score units, equal weight with
  // heuristic (which tops out around 200 on a crash screen).
  const rankByStep = new Map();
  for (const r of rankings) rankByStep.set(r.step, r);

  const merged = allScored.map((s) => {
    const r = rankByStep.get(s.step);
    const rankerContrib = r ? r.hotspotScore * 15 : 0;
    return {
      ...s,
      rankerScore: r ? r.hotspotScore : null,
      rankerReason: r ? r.reason : "",
      combinedScore: s.score + rankerContrib,
    };
  });

  return selectTopK(merged, maxK, skipEntries, /* rankerUsed */ true);
}

/**
 * Take the top K scored screens (by combinedScore if present, else score),
 * enforcing a per-screen-type diversity cap of 2. Carries through heuristic
 * skip entries from the dedup/dialog phase.
 */
function selectTopK(scored, k, priorLog, rankerUsed) {
  const ordered = [...scored].sort(
    (a, b) => (b.combinedScore ?? b.score) - (a.combinedScore ?? a.score),
  );

  const selected = [];
  const skipped = [];
  const typeCount = {};

  for (const s of ordered) {
    const t = s.screenType || "unknown";
    typeCount[t] = (typeCount[t] || 0) + 1;
    if (selected.length < k && typeCount[t] <= 2) {
      selected.push(s);
    } else {
      skipped.push(s);
    }
  }

  const triageLog = [...(priorLog || [])];
  for (const s of selected) {
    const rankerPart =
      s.rankerScore !== undefined && s.rankerScore !== null
        ? `, hotspot=${s.rankerScore} (${s.rankerReason || "-"})`
        : "";
    triageLog.push({
      step: s.step,
      action: "analyze",
      reason: `score=${s.score}${rankerPart}`,
    });
  }
  for (const s of skipped) {
    triageLog.push({
      step: s.step,
      action: "skip",
      reason: `below_cutoff (combined=${s.combinedScore ?? s.score})`,
    });
  }

  return {
    screensToAnalyze: selected.map((s) => s.screen),
    skippedScreens: skipped.map((s) => ({ step: s.step, reason: "below_cutoff" })),
    triageLog,
    rankerUsed: Boolean(rankerUsed),
  };
}

module.exports = {
  triageForAI,
  triageWithRanker,
  rankScreens,
  RANK_SCREENS_TOOL,
};
