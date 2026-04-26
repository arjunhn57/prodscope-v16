"use strict";

/**
 * brain/report-prompt-v2.js — V2 report synthesis prompt builder.
 *
 * Lives next to context-builder.js (the V1 prompt) so we can run V1 and
 * V2 side-by-side under feature flag during validation. The V1
 * `buildReportPrompt` stays untouched.
 *
 * Audit defects this prompt fixes:
 *   #1 — has an iron-clad citation rule baked in
 *   #5 — explicitly demands founder questions on each flag
 *   #7 — bans implementation/method names from the model's output
 *   #8 — passes findings as STRUCTURED JSON (not a prose blob),
 *        with each finding tagged by screen ID
 *
 * Returns the prompt as a single string. Caller passes it as the user
 * message; the tool schema (output/report-tool-v2.js) constrains output.
 */

/**
 * @typedef {Object} ScreenStub
 * @property {string} id          Stable id like "screen_14" — used in evidence_screen_ids
 * @property {number} step        Original step index from the trace
 * @property {string} screenType  Classifier output (auth, feed, profile, ...)
 * @property {string} [activity]  Android activity name
 * @property {string} [feature]   Feature/section bucket from triage
 *
 * @typedef {Object} Stage2FindingsByScreen
 * @property {string} screenId
 * @property {Array<{kind: "bug"|"ux"|"a11y"|"suggestion", severity?: string, title?: string, evidence?: string, confidence?: number}>} findings
 */

/**
 * Build the V2 report synthesis prompt.
 *
 * @param {Object} params
 * @param {string} params.packageName
 * @param {Object} params.crawlStats        { totalSteps, uniqueStates, stopReason }
 * @param {ScreenStub[]} params.screens     Provided to the model so it can cite by id.
 * @param {Stage2FindingsByScreen[]} params.stage2FindingsByScreen
 * @param {Array<{type: string, severity: string, detail: string, step?: number, element?: string}>} params.deterministicFindings
 * @param {Object<string, {uniqueScreens: number, status: string}>} params.coverageSummary
 * @param {Array<{feature: string, subType?: string, outcome: string, steps: any[]}>} params.flows
 * @param {{painPoints?: string, goals?: string}} [params.opts]
 * @returns {string}
 */
function buildReportPromptV2(params) {
  const {
    packageName,
    crawlStats,
    screens,
    stage2FindingsByScreen,
    deterministicFindings,
    coverageSummary,
    flows,
    opts,
  } = params;

  const screenList = (screens || [])
    .map((s) => {
      const bits = [`step=${s.step}`, `type=${s.screenType || "unknown"}`];
      if (s.feature) bits.push(`feature=${s.feature}`);
      if (s.activity) bits.push(`activity=${s.activity}`);
      return `  - ${s.id}: ${bits.join(", ")}`;
    })
    .join("\n");

  const stage2Block = (stage2FindingsByScreen || [])
    .map((entry) => {
      const lines = (entry.findings || []).map((f) => {
        const sev = f.severity ? `severity=${f.severity}` : "";
        const conf = typeof f.confidence === "number" ? `conf=${f.confidence.toFixed(2)}` : "";
        const ev = f.evidence ? `evidence="${f.evidence.slice(0, 160)}"` : "";
        const meta = [sev, conf, ev].filter(Boolean).join(", ");
        const title = f.title ? `"${f.title}"` : "(no title)";
        return `      [${f.kind}] ${title}${meta ? "  " + meta : ""}`;
      });
      if (lines.length === 0) return null;
      return `    ${entry.screenId}:\n${lines.join("\n")}`;
    })
    .filter(Boolean)
    .join("\n");

  const detBlock = (deterministicFindings || [])
    .slice(0, 30)
    .map((f) => {
      const screenRef = typeof f.step === "number" ? `screen_${f.step}` : "unknown_screen";
      const elem = f.element ? ` element="${f.element}"` : "";
      return `  - ${screenRef}: [${f.severity}] ${f.type}: ${(f.detail || "").slice(0, 160)}${elem}`;
    })
    .join("\n");

  const coverageLines = Object.entries(coverageSummary || {})
    .map(([k, v]) => `  ${k}: ${v.uniqueScreens} screens, ${v.status}`)
    .join("\n");

  const flowLines = (flows || [])
    .slice(0, 12)
    .map((f) => `  ${f.feature}/${f.subType || "main"}: ${f.outcome} (${(f.steps || []).length} steps)`)
    .join("\n");

  const userContext = [];
  if (opts && opts.painPoints) userContext.push(`User pain points: ${opts.painPoints}`);
  if (opts && opts.goals) userContext.push(`User goals: ${opts.goals}`);

  return [
    `You are writing a forensic technical-diligence report for a venture-capital analyst.`,
    `The reader has 20 minutes to form a defensible point of view about this app and will`,
    `walk into a call with the founder afterward. Their value to you is that you give them`,
    `THREE specific questions to ask that they could not have asked without this report.`,
    ``,
    `═══ CITATION RULE — IRON-CLAD ═══`,
    ``,
    `Every claim you emit MUST cite at least one screen id from the SCREENS list below.`,
    `You may NOT make a claim about app behavior or content you cannot tie to a specific`,
    `screen id. If you cannot find evidence for something in the inputs, you must NOT`,
    `mention it — instead, surface the gap as a "screens_attempted_blocked" entry in`,
    `coverage_summary, or as an absence in coverage_summary.areas_not_attempted.`,
    ``,
    `Inventing a screen id (one not in the list below) is a TOOL CALL FAILURE.`,
    `Making a claim with an empty evidence_screen_ids array is a TOOL CALL FAILURE.`,
    ``,
    `═══ FORBIDDEN PHRASES ═══`,
    ``,
    `These are banned in every text field:`,
    `  - "It appears that...", "seems to...", "looks like..."  (use confidence: "inferred")`,
    `  - "Modern apps tend to...", "Best practice is..."        (out of scope)`,
    `  - "Well-designed", "intuitive", "user-friendly", "polished" (use measurable observation)`,
    `  - Method/model names: "crawler", "Haiku", "Sonnet", "Claude", "AI analyzed"`,
    `  - "ProdScope analyzed your app" preambles                 (start with the verdict)`,
    ``,
    `═══ CONFIDENCE LADDER ═══`,
    ``,
    `For every claim, choose exactly one:`,
    `  - "observed":   directly visible in the cited screens`,
    `  - "inferred":   logical conclusion from observed evidence`,
    `  - "hypothesis": speculative based on partial signals — use sparingly and clearly`,
    ``,
    `═══ INPUTS ═══`,
    ``,
    `App: ${packageName || "unknown"}`,
    `Crawl: ${crawlStats?.totalSteps ?? 0} steps, ${crawlStats?.uniqueStates ?? 0} unique screens, stop_reason: ${crawlStats?.stopReason ?? "unknown"}`,
    ``,
    userContext.length > 0 ? userContext.join("\n") : "",
    userContext.length > 0 ? "" : null,
    `SCREENS (cite by id from this list — IDs not in this list are forbidden):`,
    screenList || "  (no screens)",
    ``,
    `STAGE 2 FINDINGS BY SCREEN (your primary evidence base):`,
    stage2Block || "    (no Stage 2 findings)",
    ``,
    `DETERMINISTIC FINDINGS (UX heuristics — also evidence):`,
    detBlock || "  (no deterministic findings)",
    ``,
    `COVERAGE BY FEATURE:`,
    coverageLines || "  (no coverage breakdown)",
    ``,
    `OBSERVED FLOWS:`,
    flowLines || "  (no flows recorded)",
    ``,
    `═══ BALANCE RULE — REPORTS MUST CITE BOTH CONCERNS AND STRENGTHS ═══`,
    ``,
    `A diligence read that only surfaces concerns is one-sided and less useful`,
    `than a balanced one. Reports MUST include at least one diligence_flag with`,
    `severity: "strength" — an area where the app demonstrates competence,`,
    `craftsmanship, intentional product choices, or signal of team quality.`,
    ``,
    `Strengths are subject to the SAME evidence rule as concerns:`,
    `  - Cite specific screens (evidence_screen_ids)`,
    `  - Use the confidence ladder (observed / inferred / hypothesis)`,
    `  - Include a founder_question — typically asking HOW or WHY they made the`,
    `    choice (e.g. "How did you decide to require server selection before`,
    `    showing the feed? Did you A/B test against a default?")`,
    ``,
    `What counts as a strength: clean visual hierarchy backed by accessibility`,
    `cues, intentional onboarding pacing, considered empty-state design,`,
    `progressive disclosure that prevents overload, performance feel, error`,
    `recovery affordances, regulatory copy clarity, locale completeness,`,
    `consistent component design across screens, etc. Praise that's not`,
    `evidence-anchored ("looks polished") is forbidden — strengths must point at`,
    `something the reader can see in the cited screens.`,
    ``,
    `If you genuinely cannot find a single citeable strength after reading the`,
    `inputs, that itself becomes a flag with severity: "concern" — call it out`,
    `as "no clear product strengths surfaced in the explored surface" with the`,
    `coverage_summary as evidence.`,
    ``,
    `═══ OUTPUT — call the emit_report_v2 tool exactly once ═══`,
    ``,
    `1. verdict.claims (exactly 3): What a diligence reader should walk away knowing in 60 seconds.`,
    `2. diligence_flags (2-5): Each gets a severity (concern/watch_item/strength), evidence, and a`,
    `   founder_question. **At least one flag MUST be a strength** unless the trace genuinely lacks`,
    `   any citeable positive signal. The question must be SPECIFIC TO THIS APP and ANSWERABLE`,
    `   ONLY because the reader saw this evidence. No generic mobile-UX questions.`,
    `3. critical_bugs: ONLY include if Stage 2 findings explicitly mark them. Never invent.`,
    `4. ux_issues: Only with cited evidence. Skip if findings are thin.`,
    `5. coverage_summary: structured numbers + explicit "what we couldn't reach" list.`,
    ``,
    `Cite by screen id (e.g. "screen_14"), not by step number in prose.`,
    `If a section has no evidence, return an empty array — do NOT pad with weak claims.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

module.exports = {
  buildReportPromptV2,
};
