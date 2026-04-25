"use strict";

/**
 * output/annotator/pipeline.js — orchestrates per-screen annotation.
 *
 * Given a finished V2 report + the captured screen trace, runs the
 * Sonnet annotation pass on every CITED screen (i.e. screens referenced
 * by verdict claims, diligence flags, critical bugs, or ux issues).
 * Persists annotations.json + a baked PNG per screen so the frontend
 * can either render an SVG overlay (preferred) or fall back to the
 * static PNG (for PDF export, email previews).
 *
 * Cost discipline: only cited screens. Typical V2 report cites 5-10
 * screens; full report ≤ 30 screens. Skips uncited screens entirely.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../lib/logger");
const { extractClickableLabels } = require("../../crawler/v16/auth-escape");
const { synthesizeAnnotations } = require("./synthesize");
const { renderAnnotated } = require("./render");

const log = logger.child({ component: "annotator-pipeline" });

const PNG_HEAD = 8;

/**
 * Pull every screen_<step> id cited by a V2 report. Iterates every
 * finding category that carries evidence_screen_ids. Returns a Set so
 * duplicates collapse — one annotation pass per unique screen.
 *
 * @param {object} report  V2 report (validated)
 * @returns {Set<string>}  e.g. { "screen_4", "screen_9" }
 */
function citedScreenIdsFromReport(report) {
  const out = new Set();
  if (!report) return out;

  const collect = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (item && Array.isArray(item.evidence_screen_ids)) {
        for (const id of item.evidence_screen_ids) {
          if (typeof id === "string" && /^screen_\d+$/.test(id)) {
            out.add(id);
          }
        }
      }
    }
  };

  if (report.verdict) collect(report.verdict.claims);
  collect(report.diligence_flags);
  collect(report.critical_bugs);
  collect(report.ux_issues);
  return out;
}

/**
 * Read a screen's pixel dimensions from the screenshot header without
 * loading the whole file into memory. PNG IHDR layout:
 *   bytes 0-7: PNG signature
 *   bytes 8-15: IHDR length + "IHDR"
 *   bytes 16-19: width (big-endian uint32)
 *   bytes 20-23: height (big-endian uint32)
 *
 * @param {string} pngPath
 * @returns {{ width: number, height: number } | null}
 */
function readPngDimensions(pngPath) {
  try {
    const fd = fs.openSync(pngPath, "r");
    try {
      const buf = Buffer.alloc(24);
      fs.readSync(fd, buf, 0, 24, 0);
      // Validate PNG signature.
      if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
        return null;
      }
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return null;
  }
}

/**
 * Convert the v16 auth-escape clickable shape to the annotator schema's
 * `[{bounds: [x1,y1,x2,y2], label?}]` shape. Drops zero-area or
 * negative-area entries that would crash the renderer.
 *
 * @param {Array<{bounds:{x1:number,y1:number,x2:number,y2:number},label:string}>} raw
 * @returns {Array<{bounds:[number,number,number,number], label?:string}>}
 */
function elementsFromClickables(raw) {
  const out = [];
  for (const c of raw || []) {
    if (!c || !c.bounds) continue;
    const { x1, y1, x2, y2 } = c.bounds;
    if (
      !Number.isFinite(x1) ||
      !Number.isFinite(y1) ||
      !Number.isFinite(x2) ||
      !Number.isFinite(y2) ||
      x2 <= x1 ||
      y2 <= y1
    ) {
      continue;
    }
    const entry = { bounds: [Math.max(0, Math.floor(x1)), Math.max(0, Math.floor(y1)), Math.ceil(x2), Math.ceil(y2)] };
    if (c.label) entry.label = c.label.slice(0, 80);
    out.push(entry);
  }
  return out;
}

/**
 * Aggregate findings from Stage 2 + V2 report that belong to a specific
 * screen. The model treats them as the things to annotate.
 *
 * @param {string} screenId   e.g. "screen_4"
 * @param {Array<{step?:number, critical_bugs?:any[], bugs?:any[], ux_issues?:any[], accessibility?:any[]}>} stage2Analyses
 * @param {object} report     V2 report
 * @returns {Array<{kind:string, severity?:string, title?:string, evidence?:string, claim?:string, confidence?:any}>}
 */
function findingsForScreen(screenId, stage2Analyses, report) {
  const out = [];

  const stepMatch = screenId.match(/^screen_(\d+)$/);
  if (!stepMatch) return out;
  const step = Number(stepMatch[1]);

  // Stage 2 — directly per-step.
  for (const a of stage2Analyses || []) {
    if (a.step !== step) continue;
    for (const b of a.critical_bugs || []) {
      out.push({ kind: "bug", severity: b.severity, title: b.title, evidence: b.evidence, confidence: b.confidence });
    }
    for (const u of a.ux_issues || []) {
      out.push({ kind: "ux", severity: u.severity, title: u.title || u.desc, evidence: u.evidence || u.desc, confidence: u.confidence });
    }
    for (const x of a.accessibility || []) {
      out.push({ kind: "a11y", severity: x.severity, title: x.title || x.desc, evidence: x.evidence || x.desc, confidence: x.confidence });
    }
  }

  // V2 — entries that cite this screen. Convert to the same flat shape.
  if (report) {
    const pull = (arr, kind) => {
      for (const item of arr || []) {
        if (Array.isArray(item.evidence_screen_ids) && item.evidence_screen_ids.includes(screenId)) {
          out.push({
            kind,
            severity: item.severity || "watch_item",
            title: item.title || item.claim,
            evidence: item.claim || item.evidence,
            confidence: item.confidence,
          });
        }
      }
    };
    pull(report.critical_bugs, "bug");
    pull(report.ux_issues, "ux");
    pull(report.diligence_flags, "diligence");
  }

  // Cap at 8 — schema limit, also prevents one busy screen from
  // dominating the cost budget.
  return out.slice(0, 8);
}

/**
 * Run the annotation pass for one screen end-to-end:
 *   synthesize → validate → render → persist
 *
 * @param {Object} params
 * @param {string} params.screenId
 * @param {Object} params.screen           Trace entry { path, xml, index }
 * @param {Array<object>} params.findings  Findings to annotate.
 * @param {string} params.outDir           Where to write annotations.json + .png.
 * @param {string} [params.context]
 * @param {Object} [params.deps]           For tests — { client, fs }
 * @returns {Promise<{ok:true, annotations:object, files:{json:string,png:string}, tokenUsage:object} | {ok:false, errors:string[], tokenUsage?:object}>}
 */
async function annotateScreen({ screenId, screen, findings, outDir, context, deps }) {
  if (!screen || !screen.path) {
    return { ok: false, errors: [`screen ${screenId}: no screenshot path`] };
  }
  if (!fs.existsSync(screen.path)) {
    return { ok: false, errors: [`screen ${screenId}: screenshot not on disk: ${screen.path}`] };
  }

  const dims = readPngDimensions(screen.path);
  if (!dims) {
    return { ok: false, errors: [`screen ${screenId}: could not read PNG dimensions`] };
  }

  const elements = elementsFromClickables(extractClickableLabels(screen.xml || ""));

  const synth = await synthesizeAnnotations({
    screenId,
    width: dims.width,
    height: dims.height,
    elements,
    findings,
    image: screen.path,
    context,
    deps,
  });
  if (!synth.ok) {
    return { ok: false, errors: synth.errors, tokenUsage: synth.tokenUsage };
  }

  const render = await renderAnnotated({
    image: screen.path,
    annotations: synth.annotations,
  });
  if (!render.ok) {
    return { ok: false, errors: render.errors, tokenUsage: synth.tokenUsage };
  }

  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${screenId}.annotations.json`);
  const pngPath = path.join(outDir, `${screenId}.annotated.png`);
  fs.writeFileSync(jsonPath, JSON.stringify(synth.annotations, null, 2));
  fs.writeFileSync(pngPath, render.buffer);

  return {
    ok: true,
    annotations: synth.annotations,
    files: { json: jsonPath, png: pngPath },
    tokenUsage: synth.tokenUsage,
  };
}

/**
 * Run the full annotation pass over a V2 report's cited screens.
 *
 * @param {Object} params
 * @param {string} params.jobId
 * @param {object} params.report           V2 report (validated).
 * @param {Array<{path:string,xml:string,index:number}>} params.screens
 * @param {Array<object>} params.stage2Analyses
 * @param {string} params.outDir           Job-scoped output dir.
 * @param {Object} [params.deps]           For tests.
 * @returns {Promise<{ok:true, results:Array<{screenId:string,files?:object,errors?:string[]}>, tokenUsage:{input_tokens:number,output_tokens:number}, annotatedScreens:string[], failedScreens:string[]}>}
 */
async function annotateCitedScreens({ jobId, report, screens, stage2Analyses, outDir, deps }) {
  const cited = citedScreenIdsFromReport(report);
  const results = [];
  const totalUsage = { input_tokens: 0, output_tokens: 0 };
  const annotated = [];
  const failed = [];

  for (const screenId of cited) {
    const stepMatch = screenId.match(/^screen_(\d+)$/);
    if (!stepMatch) continue;
    const step = Number(stepMatch[1]);
    const screen = (screens || []).find((s) => s && s.index === step);
    if (!screen) {
      log.warn({ jobId, screenId }, "annotateCitedScreens: cited screen not in trace");
      results.push({ screenId, errors: [`screen ${screenId} not in trace`] });
      failed.push(screenId);
      continue;
    }

    const findings = findingsForScreen(screenId, stage2Analyses, report);
    if (findings.length === 0) {
      log.info(
        { jobId, screenId },
        "annotateCitedScreens: no findings for cited screen; skipping",
      );
      results.push({ screenId, errors: ["no findings to annotate"] });
      failed.push(screenId);
      continue;
    }

    const r = await annotateScreen({
      screenId,
      screen,
      findings,
      outDir,
      deps,
    });
    if (r.ok) {
      results.push({ screenId, files: r.files });
      annotated.push(screenId);
    } else {
      results.push({ screenId, errors: r.errors });
      failed.push(screenId);
    }
    if (r.tokenUsage) {
      totalUsage.input_tokens += r.tokenUsage.input_tokens || 0;
      totalUsage.output_tokens += r.tokenUsage.output_tokens || 0;
    }
  }

  return {
    ok: true,
    results,
    tokenUsage: totalUsage,
    annotatedScreens: annotated,
    failedScreens: failed,
  };
}

module.exports = {
  annotateCitedScreens,
  annotateScreen,
  citedScreenIdsFromReport,
  findingsForScreen,
  elementsFromClickables,
  readPngDimensions,
  PNG_HEAD,
};
