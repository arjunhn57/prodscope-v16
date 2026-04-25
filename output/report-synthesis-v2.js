"use strict";

/**
 * output/report-synthesis-v2.js — V2 report synthesizer.
 *
 * One Anthropic call (Sonnet) with the V2 tool schema. Returns a
 * Zod-validated, screen-id-cross-checked report object. On any
 * validation failure the synthesizer returns a structured failure
 * envelope; the caller decides whether to retry once with a tightened
 * prompt or fall back to the V1 deterministic renderer.
 *
 * No prose synthesis path. No "summary" field. No fabricated overall
 * score. Every claim has a screen citation enforced at three levels:
 *   1. Anthropic tool input_schema (refuses tool calls without
 *      evidence_screen_ids, minItems: 1)
 *   2. Zod re-validation (catches structural drift)
 *   3. Screen-id cross-check against the input set (catches
 *      hallucinated IDs that pass the JSON-schema layer)
 */

const Anthropic = require("@anthropic-ai/sdk");
const { logger } = require("../lib/logger");
const { REPORT_TOOL_V2 } = require("./report-tool-v2");
const { validateReportV2 } = require("./report-schemas");
const { buildReportPromptV2 } = require("../brain/report-prompt-v2");
const { ANALYSIS_MODEL, REPORT_MODEL } = require("../config/defaults");

const log = logger.child({ component: "report-synthesis-v2" });

const defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_MAX_TOKENS = 2400;
const DEFAULT_TEMPERATURE = 0.2; // Low temperature — we want forensic, not creative.

/**
 * Build the screen ID set the synthesizer can cite. Each screen gets a
 * stable id "screen_<step>"; the set is what the validator checks
 * evidence_screen_ids against.
 *
 * @param {Array<{step: number}>} screens
 * @returns {{ ids: string[], set: Set<string>, byId: Record<string, object> }}
 */
function buildScreenIdIndex(screens) {
  const ids = [];
  const byId = {};
  for (const s of screens || []) {
    if (typeof s.step !== "number") continue;
    const id = `screen_${s.step}`;
    ids.push(id);
    byId[id] = s;
  }
  return { ids, set: new Set(ids), byId };
}

/**
 * Tag screens with stable ids and pass through. The synthesizer uses
 * these as both the cite-able id list AND the lookup table for the
 * frontend to render screenshots.
 *
 * @param {Array<{step: number, screenType?: string, activity?: string, feature?: string}>} screens
 * @returns {Array<{id: string, step: number, screenType: string, activity?: string, feature?: string}>}
 */
function tagScreensWithIds(screens) {
  return (screens || [])
    .filter((s) => typeof s.step === "number")
    .map((s) => ({
      id: `screen_${s.step}`,
      step: s.step,
      screenType: s.screenType || "unknown",
      activity: s.activity,
      feature: s.feature,
    }));
}

/**
 * Reshape Stage 2 per-screen findings into the {screenId, findings[]}
 * structure the V2 prompt expects. Screen identity flows through
 * cleanly (Defect #3 fix — stop dropping evidence in aggregation).
 *
 * @param {Array<{step?: number, critical_bugs?: any[], bugs?: any[], ux_issues?: any[], suggestions?: any[], accessibility?: any[]}>} stage2Analyses
 * @returns {Array<{screenId: string, findings: Array<{kind:string, severity?:string, title?:string, evidence?:string, confidence?:number}>}>}
 */
function reshapeStage2(stage2Analyses) {
  const out = [];
  for (const a of stage2Analyses || []) {
    if (typeof a.step !== "number") continue;
    const screenId = `screen_${a.step}`;
    const findings = [];
    for (const b of a.critical_bugs || []) {
      findings.push({ kind: "bug", severity: b.severity, title: b.title, evidence: b.evidence, confidence: b.confidence });
    }
    for (const b of a.bugs || []) {
      findings.push({ kind: "bug", severity: b.severity, title: b.title || b.desc, evidence: b.evidence || b.desc, confidence: b.confidence });
    }
    for (const u of a.ux_issues || []) {
      findings.push({ kind: "ux", severity: u.severity, title: u.title || u.desc, evidence: u.evidence || u.desc, confidence: u.confidence });
    }
    for (const x of a.accessibility || []) {
      findings.push({ kind: "a11y", severity: x.severity, title: x.title || x.desc, evidence: x.evidence || x.desc, confidence: x.confidence });
    }
    for (const s of a.suggestions || []) {
      findings.push({ kind: "suggestion", severity: s.effort, title: s.title || s.desc, evidence: s.evidence || s.desc, confidence: s.confidence });
    }
    if (findings.length > 0) {
      out.push({ screenId, findings });
    }
  }
  return out;
}

/**
 * Extract the tool_use block's `.input` for our V2 tool. Returns null if
 * the response didn't call our tool — caller handles as a synthesis
 * failure (same shape as the V1 oracle does for its per-screen tool).
 *
 * @param {object} response
 * @returns {object | null}
 */
function extractToolInput(response) {
  if (!response || !Array.isArray(response.content)) return null;
  for (const block of response.content) {
    if (block && block.type === "tool_use" && block.name === REPORT_TOOL_V2.name) {
      return block.input && typeof block.input === "object" ? block.input : null;
    }
  }
  return null;
}

/**
 * Run V2 synthesis. Returns either:
 *   { ok: true, report, tokenUsage, screenIdIndex }
 *   { ok: false, errors, tokenUsage, rawInput? }
 *
 * @param {Object} params
 * @param {string} params.packageName
 * @param {Object} params.crawlStats
 * @param {Array<{step: number, screenType?: string, activity?: string, feature?: string}>} params.screens
 * @param {Array<{step: number, critical_bugs?: any[], ...}>} params.stage2Analyses
 * @param {Array<{type:string, severity:string, detail:string, step?:number, element?:string}>} params.deterministicFindings
 * @param {Object<string, {uniqueScreens:number, status:string}>} params.coverageSummary
 * @param {Array<any>} params.flows
 * @param {{painPoints?:string, goals?:string}} [params.opts]
 * @param {Object} [params.deps]    Inject `client` for tests; otherwise uses default Anthropic SDK.
 * @returns {Promise<{ok:true, report:object, tokenUsage:object, screenIdIndex:object} | {ok:false, errors:string[], tokenUsage:object, rawInput?:object}>}
 */
async function synthesizeReportV2(params) {
  const {
    packageName,
    crawlStats,
    screens,
    stage2Analyses,
    deterministicFindings,
    coverageSummary,
    flows,
    opts,
    deps,
  } = params;

  const client = (deps && deps.client) || defaultClient;
  const taggedScreens = tagScreensWithIds(screens);
  const idIndex = buildScreenIdIndex(taggedScreens);

  if (idIndex.ids.length === 0) {
    log.warn({ packageName }, "synthesizeReportV2: no screens with step ids — refusing to synthesize");
    return {
      ok: false,
      errors: ["no_screens_to_cite: trace has no usable screens"],
      tokenUsage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const stage2Reshaped = reshapeStage2(stage2Analyses);

  const prompt = buildReportPromptV2({
    packageName,
    crawlStats,
    screens: taggedScreens,
    stage2FindingsByScreen: stage2Reshaped,
    deterministicFindings: deterministicFindings || [],
    coverageSummary: coverageSummary || {},
    flows: flows || [],
    opts: opts || {},
  });

  const model = REPORT_MODEL || ANALYSIS_MODEL;

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      temperature: DEFAULT_TEMPERATURE,
      tools: [REPORT_TOOL_V2],
      tool_choice: { type: "tool", name: REPORT_TOOL_V2.name },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    log.error(
      { err: err && err.message, packageName },
      "synthesizeReportV2: SDK call failed",
    );
    return {
      ok: false,
      errors: [`anthropic_sdk_failed: ${err && err.message ? err.message : "unknown"}`],
      tokenUsage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const tokenUsage = {
    input_tokens: (response.usage && response.usage.input_tokens) || 0,
    output_tokens: (response.usage && response.usage.output_tokens) || 0,
  };

  const rawInput = extractToolInput(response);
  if (!rawInput) {
    log.warn(
      { packageName, stop_reason: response.stop_reason },
      "synthesizeReportV2: model did not emit emit_report_v2 tool call",
    );
    return {
      ok: false,
      errors: ["model_did_not_call_tool"],
      tokenUsage,
    };
  }

  const validation = validateReportV2(rawInput, idIndex.set);
  if (!validation.ok) {
    log.warn(
      { packageName, errors: validation.errors.slice(0, 5) },
      "synthesizeReportV2: validation failed",
    );
    return {
      ok: false,
      errors: validation.errors,
      tokenUsage,
      rawInput,
    };
  }

  return {
    ok: true,
    report: validation.report,
    tokenUsage,
    screenIdIndex: idIndex,
  };
}

module.exports = {
  synthesizeReportV2,
  // exposed for tests
  tagScreensWithIds,
  buildScreenIdIndex,
  reshapeStage2,
  extractToolInput,
};
