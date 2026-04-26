"use strict";

/**
 * output/executive-summary.js — analyst-voice executive summary synthesizer.
 *
 * One Haiku call per report. Takes V2's structured findings and produces a
 * 5-part summary in senior-analyst voice: a lead-sentence verdict + 3
 * bullets (top concern / top strength / coverage limitation) + closing take.
 *
 * Why a separate call rather than folding into V2 synthesis: V2's job is
 * evidence-grounded structured findings. This call's job is *narrative
 * voice* — picking which findings to feature in 60 seconds and rewriting
 * them in editorial tone. Keeping them separate lets V2 stay strict /
 * citation-heavy and lets this stay loose / scannable.
 *
 * Cost: ~$0.005 per report (3K input + 300 output @ Haiku rates). Bills
 * into the same Anthropic dashboard line as the rest of the run.
 *
 * Failure modes:
 *   - Haiku returns malformed → fall back to deterministic builder
 *     (frontend already has one for legacy / V1-only reports).
 *   - Network / timeout → same fallback.
 *   - Caller MUST treat absence of executive_summary as "use the
 *     deterministic builder" — never as "report is broken."
 */

const Anthropic = require("@anthropic-ai/sdk");
const { z } = require("zod");
const { logger } = require("../lib/logger");
const { ANALYSIS_MODEL } = require("../config/defaults");

const log = logger.child({ component: "executive-summary" });

const TIMEOUT_MS = 30000;
const MAX_TOKENS = 600;

const EXECUTIVE_SUMMARY_TOOL = {
  name: "emit_executive_summary",
  description:
    "Emit a 5-part editorial executive summary for a VC / PM diligence reader. Each part is one sentence written in senior-analyst voice — specific to THIS app, anchored in the cited V2 findings, never generic.",
  input_schema: {
    type: "object",
    properties: {
      lead_sentence: {
        type: "string",
        minLength: 60,
        maxLength: 240,
        description:
          "One-sentence framing of the build for a reader scanning the report in 60 seconds. Names the app's most striking strength AND its most material concern in the same sentence (e.g., 'Biztoso ships a polished feed surface but the first-session loading flow drops users into a blank screen for 4+ seconds.'). Avoid vague intros like 'This analysis covers...'.",
      },
      top_concern: {
        type: "string",
        minLength: 40,
        maxLength: 220,
        description:
          "One sentence on the single most material concern. Anchor in a specific finding — name the screen / flow / user impact. Avoid generic UX platitudes ('the loading experience is poor'); name what fails ('the home feed renders nothing for 4 seconds, indistinguishable from a crash to a first-time user').",
      },
      top_strength: {
        type: "string",
        minLength: 40,
        maxLength: 220,
        description:
          "One sentence on the most citeable craft / strength. Same specificity bar as top_concern. If no strengths emerged, name the most resilient thing the run observed (e.g., 'No crashes triggered across 60 steps' is acceptable when the V2 report has no strength flags).",
      },
      coverage_note: {
        type: "string",
        minLength: 40,
        maxLength: 220,
        description:
          "One sentence on what the analysis could NOT reach and why it matters for the reader. (e.g., 'Auth-walled paid features were not exercised — the team should request a test account before this report can speak to monetization quality.')",
      },
      closing_take: {
        type: "string",
        minLength: 40,
        maxLength: 220,
        description:
          "One sentence verdict for the reader's next action — what to do with this report. (e.g., 'Ship-block the next release until the auth-screen loading state is fixed; the rest of the build is in good shape.')",
      },
    },
    required: [
      "lead_sentence",
      "top_concern",
      "top_strength",
      "coverage_note",
      "closing_take",
    ],
  },
};

const ExecutiveSummarySchema = z.object({
  lead_sentence: z.string().min(60).max(240),
  top_concern: z.string().min(40).max(220),
  top_strength: z.string().min(40).max(220),
  coverage_note: z.string().min(40).max(220),
  closing_take: z.string().min(40).max(220),
});

/**
 * @typedef {Object} ExecutiveSummaryInput
 * @property {string} appName
 * @property {string} packageName
 * @property {object} v2Report  V2 report with verdict, diligence_flags, critical_bugs, ux_issues, coverage_summary
 * @property {object} [coverage]  Optional V1 coverage map for fallback context
 */

/**
 * Format the V2 report as a compact prompt input — claim-only, no
 * evidence_screen_ids (the model is writing voice, not citing). Cap at
 * 5 of each list to keep the prompt under 3K tokens.
 *
 * @param {object} v2
 * @returns {string}
 */
function formatV2ForPrompt(v2) {
  const verdictClaims = (v2.verdict?.claims || [])
    .map((c, i) => `  ${i + 1}. ${c.claim}`)
    .join("\n");

  const concernFlags = (v2.diligence_flags || [])
    .filter((f) => f.severity === "concern" || f.severity === "watch_item")
    .slice(0, 5)
    .map((f) => `  - [${f.severity}] ${f.claim}`)
    .join("\n");

  const strengthFlags = (v2.diligence_flags || [])
    .filter((f) => f.severity === "strength")
    .slice(0, 5)
    .map((f) => `  - ${f.claim}`)
    .join("\n");

  const criticalBugs = (v2.critical_bugs || [])
    .slice(0, 5)
    .map((b) => `  - ${b.title}: ${b.claim}`)
    .join("\n");

  const uxIssues = (v2.ux_issues || [])
    .slice(0, 5)
    .map((u) => `  - ${u.title}: ${u.claim}`)
    .join("\n");

  const coverage = v2.coverage_summary || {};
  const blocked = (coverage.screens_attempted_blocked || [])
    .map((b) => `  - ${b.area}: ${b.reason}`)
    .join("\n");
  const notAttempted = (coverage.areas_not_attempted || [])
    .map((a) => `  - ${a}`)
    .join("\n");

  return [
    `VERDICT CLAIMS (3):`,
    verdictClaims || "  (none)",
    ``,
    `CONCERN / WATCH ITEM FLAGS:`,
    concernFlags || "  (none)",
    ``,
    `STRENGTH FLAGS:`,
    strengthFlags || "  (none — the report has no citeable strengths)",
    ``,
    `CRITICAL BUGS:`,
    criticalBugs || "  (none)",
    ``,
    `UX ISSUES:`,
    uxIssues || "  (none)",
    ``,
    `COVERAGE — screens reached: ${coverage.screens_reached ?? "?"}`,
    blocked ? `Blocked areas:\n${blocked}` : `Blocked areas: (none)`,
    notAttempted ? `Areas not attempted:\n${notAttempted}` : `Areas not attempted: (none)`,
  ].join("\n");
}

/**
 * Synthesize an editorial executive summary.
 *
 * @param {ExecutiveSummaryInput} input
 * @param {object} [deps]
 * @param {object} [deps.client]  Anthropic client (test injection)
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<{ok:true, summary:object, tokenUsage:object} | {ok:false, errors:string[], tokenUsage?:object}>}
 */
async function synthesizeExecutiveSummary(input, deps = {}) {
  const { appName, packageName, v2Report } = input;
  if (!v2Report) {
    return {
      ok: false,
      errors: ["v2Report missing — caller should fall back to deterministic builder"],
    };
  }

  const client = deps.client || new Anthropic();
  const timeoutMs = deps.timeoutMs || TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const v2Block = formatV2ForPrompt(v2Report);
  const systemPrompt = [
    `You are a senior product analyst writing the executive summary of a mobile-app diligence report.`,
    ``,
    `Your audience: a venture-capital partner or a senior PM scanning the report in 60 seconds. They will read the lead sentence, glance at the three bullets, and move on. Make every word count.`,
    ``,
    `Voice: confident, specific, evidence-anchored. Senior analyst, not consultant fluff. No "the experience could be improved" platitudes — name the screen, the user impact, the consequence.`,
    ``,
    `Citation rule: every claim must be grounded in the V2 findings below. You are summarizing, not inventing. If a category has no input (e.g., no strength flags), name what the trace observed instead of fabricating.`,
  ].join("\n");

  const userPrompt = [
    `App name: ${appName || "(unknown)"} (${packageName || "?"})`,
    ``,
    `Below are the V2 structured findings for this build. Read them, then call emit_executive_summary with five sentences that capture the most material narrative for a 60-second reader.`,
    ``,
    v2Block,
    ``,
    `Now call emit_executive_summary. Each sentence must be specific to THIS app and anchored in the findings above.`,
  ].join("\n");

  let response;
  try {
    response = await client.messages.create(
      {
        model: ANALYSIS_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0.3,
        system: systemPrompt,
        tools: [EXECUTIVE_SUMMARY_TOOL],
        tool_choice: { type: "tool", name: EXECUTIVE_SUMMARY_TOOL.name },
        messages: [{ role: "user", content: userPrompt }],
      },
      { signal: controller.signal }
    );
  } catch (err) {
    clearTimeout(timer);
    log.warn(
      { err: err.message },
      "executive-summary: API call failed — caller falls back to deterministic builder",
    );
    return { ok: false, errors: [`api_error: ${err.message || String(err)}`] };
  }
  clearTimeout(timer);

  const tokenUsage = {
    input_tokens: response.usage?.input_tokens || 0,
    output_tokens: response.usage?.output_tokens || 0,
  };

  const toolUse = (response.content || []).find(
    (b) => b && b.type === "tool_use" && b.name === EXECUTIVE_SUMMARY_TOOL.name
  );
  if (!toolUse || !toolUse.input) {
    return { ok: false, errors: ["no tool_use block in response"], tokenUsage };
  }

  const parsed = ExecutiveSummarySchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
      tokenUsage,
    };
  }

  log.info(
    {
      leadLen: parsed.data.lead_sentence.length,
      inputTokens: tokenUsage.input_tokens,
      outputTokens: tokenUsage.output_tokens,
    },
    "executive-summary: synthesis OK",
  );

  return { ok: true, summary: parsed.data, tokenUsage };
}

module.exports = {
  synthesizeExecutiveSummary,
  EXECUTIVE_SUMMARY_TOOL,
  ExecutiveSummarySchema,
};
