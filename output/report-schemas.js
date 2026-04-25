"use strict";

/**
 * output/report-schemas.js — V2 report Zod schemas.
 *
 * Every claim-bearing object in the V2 report carries an evidence array
 * of screen IDs (length >= 1). The Anthropic tool_use schema enforces
 * shape; these Zod schemas re-validate after the tool call so we can
 * also enforce semantic constraints (claim length, severity enums,
 * unknown screen IDs) that JSON Schema can't easily express.
 *
 * Audit defects addressed:
 *   #1 — citation contract baked into every claim node
 *   #2 — report tool schema requires evidence on every leaf
 *   #3 — Stage 2 evidence carried end-to-end via evidence_screen_ids
 *   #6 — frontend type can mirror this schema; required fields are required
 *  #10 — coverage_summary has "what we didn't see" as a structured field
 */

const { z } = require("zod");

const ConfidenceEnum = z.enum(["observed", "inferred", "hypothesis"]);
const SeverityEnum = z.enum(["critical", "high", "medium", "low"]);
const FlagSeverityEnum = z.enum(["concern", "watch_item", "strength"]);

const ScreenIdsArray = z
  .array(z.string().min(1).max(120))
  .min(1, "Every claim must cite at least one screen id");

const EvidencedClaimSchema = z.object({
  claim: z
    .string()
    .min(20, "Claim must be substantive (>= 20 chars) — no one-word verdicts")
    .max(280, "Claim must fit on one line — break larger thoughts into multiple claims"),
  confidence: ConfidenceEnum,
  evidence_screen_ids: ScreenIdsArray,
});

const EvidencedFindingSchema = z.object({
  title: z.string().min(5).max(80),
  claim: z.string().min(20).max(280),
  severity: SeverityEnum,
  confidence: ConfidenceEnum,
  evidence_screen_ids: ScreenIdsArray,
});

const DiligenceFlagSchema = z.object({
  severity: FlagSeverityEnum,
  claim: z.string().min(20).max(280),
  confidence: ConfidenceEnum,
  evidence_screen_ids: ScreenIdsArray,
  severity_rationale: z.string().max(220).optional(),
  // The deliverable's killer feature: every flag ends with a specific
  // question to ask the founder. Generic UX-platitude questions are
  // worse than no question — minimum length forces specificity.
  founder_question: z
    .string()
    .min(15, "Founder question must be specific enough to actually ask")
    .max(220),
});

const VerdictSchema = z.object({
  // Three claims that summarize the app for a diligence reader. More
  // than three dilutes; fewer than three under-tells the story.
  claims: z.array(EvidencedClaimSchema).length(3, "Verdict must be exactly three claims"),
});

const BlockedAreaSchema = z.object({
  area: z.string().min(2).max(80),
  reason: z.string().min(5).max(200),
});

const CoverageSummarySchema = z.object({
  screens_reached: z.number().int().min(0),
  // What we tried to reach but couldn't — the diligence reader needs
  // to know the difference between "no problem found" and "we never
  // got there."
  screens_attempted_blocked: z.array(BlockedAreaSchema).default([]),
  // What we didn't even attempt — auth-only paid features, etc.
  areas_not_attempted: z.array(z.string().min(2).max(120)).default([]),
});

const ReportV2Schema = z.object({
  // Verdict page (section 1 of the plan)
  verdict: VerdictSchema,

  // Diligence flags (section 7 — the killer page)
  diligence_flags: z
    .array(DiligenceFlagSchema)
    .min(1, "At least one diligence flag required")
    .max(5, "More than 5 flags dilutes; merge similar ones"),

  // Critical bugs — only when Stage 2 actually found them. Synthesizer
  // is forbidden from inventing bugs absent from the input findings.
  critical_bugs: z.array(EvidencedFindingSchema).default([]),

  // UX issues — same evidence rule
  ux_issues: z.array(EvidencedFindingSchema).default([]),

  // Coverage section
  coverage_summary: CoverageSummarySchema,
});

/**
 * Validate a parsed tool_use input against the V2 schema AND against
 * the set of screen IDs the synthesizer was given. Catches hallucinated
 * screen IDs that the JSON-schema layer can't (since it accepts any
 * string for an id).
 *
 * @param {unknown} input  Raw tool_use input from Anthropic
 * @param {Set<string>} validScreenIds  IDs we provided to the model
 * @returns {{ok: true, report: import("zod").infer<typeof ReportV2Schema>}
 *         | {ok: false, errors: string[]}}
 */
function validateReportV2(input, validScreenIds) {
  const parsed = ReportV2Schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join(".") || "<root>"}: ${i.message}`,
      ),
    };
  }
  const report = parsed.data;
  const errors = [];

  // Cross-field validation: every cited screen id must be one we sent.
  // Hallucinated IDs become a hard validation failure, not a silent
  // dangling reference.
  const checkIds = (path, ids) => {
    for (const id of ids) {
      if (!validScreenIds.has(id)) {
        errors.push(`${path}: cited unknown screen id "${id}"`);
      }
    }
  };

  for (let i = 0; i < report.verdict.claims.length; i++) {
    checkIds(`verdict.claims[${i}].evidence_screen_ids`, report.verdict.claims[i].evidence_screen_ids);
  }
  for (let i = 0; i < report.diligence_flags.length; i++) {
    checkIds(`diligence_flags[${i}].evidence_screen_ids`, report.diligence_flags[i].evidence_screen_ids);
  }
  for (let i = 0; i < report.critical_bugs.length; i++) {
    checkIds(`critical_bugs[${i}].evidence_screen_ids`, report.critical_bugs[i].evidence_screen_ids);
  }
  for (let i = 0; i < report.ux_issues.length; i++) {
    checkIds(`ux_issues[${i}].evidence_screen_ids`, report.ux_issues[i].evidence_screen_ids);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, report };
}

module.exports = {
  ConfidenceEnum,
  SeverityEnum,
  FlagSeverityEnum,
  EvidencedClaimSchema,
  EvidencedFindingSchema,
  DiligenceFlagSchema,
  VerdictSchema,
  CoverageSummarySchema,
  ReportV2Schema,
  validateReportV2,
};
