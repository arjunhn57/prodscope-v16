"use strict";

/**
 * output/report-tool-v2.js — V2 report tool definition for Anthropic.
 *
 * Differences from the V1 REPORT_TOOL in report-builder.js:
 *
 *   1. Every claim-bearing leaf carries `evidence_screen_ids` (array,
 *      minItems: 1). No claim without a screen citation.
 *   2. `verdict` replaces `summary` — three structured evidenced claims
 *      instead of free-form prose.
 *   3. `diligence_flags` is the load-bearing section. Each flag carries
 *      a `founder_question` field — the deliverable's killer feature.
 *   4. `coverage_summary` replaces the prose `coverage_assessment` —
 *      structured numbers + explicit "what we couldn't reach" list.
 *   5. `overall_score` is GONE. We do not synthesize a single number;
 *      the verdict + flags speak for themselves.
 *   6. `recommended_next_steps` is GONE — replaced by per-flag
 *      `founder_question` fields.
 *   7. `confidence` is now an enum {observed, inferred, hypothesis}
 *      instead of a 0-1 float — readers can act on labels, not numbers.
 *
 * Schema definitions are inlined (no $ref) for max compatibility with
 * Anthropic's JSON-schema validator.
 */

// Reusable building blocks (inlined into the tool input_schema below).
const EVIDENCED_CLAIM = {
  type: "object",
  properties: {
    claim: {
      type: "string",
      minLength: 20,
      maxLength: 280,
      description:
        "A specific, evidence-grounded statement. NOT prose. NOT adjectives. Must reference what is observable on the cited screens.",
    },
    confidence: {
      type: "string",
      enum: ["observed", "inferred", "hypothesis"],
      description:
        "observed = directly visible on cited screens. inferred = logical conclusion from observed evidence. hypothesis = speculative — use sparingly.",
    },
    evidence_screen_ids: {
      type: "array",
      minItems: 1,
      items: { type: "string" },
      description:
        "Screen IDs from the inputs that ground this claim. You may NOT invent screen IDs — only IDs from the provided list are valid.",
    },
  },
  required: ["claim", "confidence", "evidence_screen_ids"],
};

const EVIDENCED_FINDING = {
  type: "object",
  properties: {
    title: {
      type: "string",
      minLength: 5,
      maxLength: 80,
      description: "Concise headline for the finding.",
    },
    claim: {
      type: "string",
      minLength: 20,
      maxLength: 280,
      description: "Specific, evidence-grounded description.",
    },
    severity: {
      type: "string",
      enum: ["critical", "high", "medium", "low"],
    },
    confidence: {
      type: "string",
      enum: ["observed", "inferred", "hypothesis"],
    },
    evidence_screen_ids: {
      type: "array",
      minItems: 1,
      items: { type: "string" },
    },
    explanation_md: {
      type: "string",
      minLength: 60,
      maxLength: 600,
      description:
        "2-3 sentence markdown explaining WHY this finding matters: the friction or user impact, why a VC / PM diligence reader should care. Anchor in the cited evidence — describe what a real user would experience on these screens, not generic mobile-UX platitudes. Plain sentences, light markdown only (bold for emphasis). No headings, no bullet lists.",
    },
    recommendation_md: {
      type: "string",
      minLength: 30,
      maxLength: 280,
      description:
        "1-2 sentence concrete remediation. Specific enough to assign to an engineer (e.g., 'Replace the blank loading state on screen_4 with a skeleton placeholder using the existing card component') — not generic ('Improve loading UX'). Plain sentences, light markdown only.",
    },
  },
  required: [
    "title",
    "claim",
    "severity",
    "confidence",
    "evidence_screen_ids",
    "explanation_md",
    "recommendation_md",
  ],
};

const DILIGENCE_FLAG = {
  type: "object",
  properties: {
    severity: {
      type: "string",
      enum: ["concern", "watch_item", "strength"],
      description:
        "concern = red flag worth raising; watch_item = yellow, monitor; strength = green, signal of quality.",
    },
    claim: { type: "string", minLength: 20, maxLength: 280 },
    confidence: {
      type: "string",
      enum: ["observed", "inferred", "hypothesis"],
    },
    evidence_screen_ids: {
      type: "array",
      minItems: 1,
      items: { type: "string" },
    },
    severity_rationale: {
      type: "string",
      maxLength: 280,
      description:
        "Why this severity (concern/watch/strength) is justified — one sentence.",
    },
    founder_question: {
      type: "string",
      minLength: 15,
      maxLength: 350,
      description:
        "The specific question a diligence reader should ask the founder, anchored in this finding. Avoid generic mobile-UX questions; the question must be answerable only because the reader saw THIS evidence. Aim for one sentence — under 200 chars when possible; hard cap is 350.",
    },
  },
  required: [
    "severity",
    "claim",
    "confidence",
    "evidence_screen_ids",
    "founder_question",
  ],
};

const COVERAGE_SUMMARY = {
  type: "object",
  properties: {
    screens_reached: {
      type: "integer",
      minimum: 0,
      description: "Number of unique logical screens actually exercised in this run.",
    },
    screens_attempted_blocked: {
      type: "array",
      description:
        "Areas the crawler tried to reach but couldn't — auth wall, paywall, OTP wall, etc. Lets the reader distinguish 'no problem found' from 'we never got there.'",
      items: {
        type: "object",
        properties: {
          area: { type: "string", minLength: 2, maxLength: 80 },
          reason: { type: "string", minLength: 5, maxLength: 200 },
        },
        required: ["area", "reason"],
      },
    },
    areas_not_attempted: {
      type: "array",
      description: "App areas this run did not attempt at all (out of scope, blocked upstream).",
      items: { type: "string", minLength: 2, maxLength: 120 },
    },
  },
  required: ["screens_reached"],
};

const REPORT_TOOL_V2 = {
  name: "emit_report_v2",
  description:
    "Emit the diligence-grade analysis report. EVERY claim must cite at least one screen id from the inputs. Inventing a screen id, or making a claim without evidence, is a tool-call failure.",
  input_schema: {
    type: "object",
    properties: {
      verdict: {
        type: "object",
        description:
          "Three evidence-grounded claims that summarize the app for a venture-capital diligence reader scanning the report in 60 seconds.",
        properties: {
          claims: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: EVIDENCED_CLAIM,
          },
        },
        required: ["claims"],
      },
      diligence_flags: {
        type: "array",
        description:
          "1-5 ranked flags (severity + claim + evidence + founder_question). The killer section. Each flag's founder_question is a specific question the reader should ask the company, anchored in THIS evidence.",
        minItems: 1,
        maxItems: 5,
        items: DILIGENCE_FLAG,
      },
      critical_bugs: {
        type: "array",
        description:
          "Crashes, ANRs, blocking defects observed in the trace. ONLY include bugs supported by Stage 2 findings or deterministic findings — never invent.",
        items: EVIDENCED_FINDING,
      },
      ux_issues: {
        type: "array",
        description:
          "Lower-severity UX or accessibility findings. ONLY include findings backed by cited screen evidence.",
        items: EVIDENCED_FINDING,
      },
      coverage_summary: COVERAGE_SUMMARY,
    },
    required: ["verdict", "diligence_flags", "coverage_summary"],
  },
};

module.exports = {
  REPORT_TOOL_V2,
};
