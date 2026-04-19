"use strict";

/**
 * context-builder.js — Build compressed LLM prompts
 *
 * Keeps prompts minimal (~350 tokens for decisions, ~800 for analysis,
 * ~3000 for report synthesis) to reduce token waste.
 */

// -------------------------------------------------------------------------
// Screen analysis prompt (used by ai-oracle.js)
// -------------------------------------------------------------------------

/**
 * Build a compressed prompt for screen-level AI analysis.
 * Target: ~800 tokens input.
 *
 * @param {Object} screen - Screen with screenType, activity, xml
 * @param {Object} context - { coverage, pathToScreen, appCategory }
 * @returns {string}
 */
function buildScreenAnalysisPrompt(screen, context) {
  const screenType = screen.screenType || "unknown";
  const activity = screen.activity || "unknown";
  const appCategory = context.appCategory || "unknown";

  // Extract key labels from XML (max 10)
  const labels = extractKeyLabels(screen.xml, 10);

  const pathDesc = context.pathToScreen
    ? `Reached by: ${context.pathToScreen}`
    : "";

  return (
    `Analyze this Android app screen for QA issues. App category: ${appCategory}.\n` +
    `Screen type: ${screenType}\n` +
    `Activity: ${activity}\n` +
    (pathDesc ? `${pathDesc}\n` : "") +
    `Key elements: ${labels.join(", ")}\n\n` +
    `Return JSON only: {"bugs":[{"desc":"...","severity":"critical|high|medium|low","confidence":0.0-1.0}],"ux_issues":[{"desc":"...","severity":"..."}],"suggestions":[{"desc":"...","effort":"low|medium|high"}],"accessibility":[{"desc":"..."}]}`
  );
}

// -------------------------------------------------------------------------
// Report synthesis prompt (used by report-builder.js)
// -------------------------------------------------------------------------

/**
 * Build a compressed prompt for final report synthesis.
 * Target: ~3000 tokens input.
 *
 * @param {Object} params
 * @param {string} params.packageName
 * @param {Object} params.coverageSummary
 * @param {Array}  params.deterministic - Deterministic oracle findings
 * @param {Array}  params.aiFindings - AI analysis results
 * @param {Array}  params.flows
 * @param {Object} params.crawlStats
 * @param {Object} params.opts - User goals, pain points
 * @returns {string}
 */
function buildReportPrompt(params) {
  const {
    packageName,
    coverageSummary,
    deterministic,
    aiFindings,
    flows,
    crawlStats,
    opts,
  } = params;

  // Compress coverage into one-liner per feature
  const coverageLines = Object.entries(coverageSummary || {})
    .map(([k, v]) => `${k}: ${v.uniqueScreens} screens, ${v.status}`)
    .join("; ");

  // Compress deterministic findings
  const detFindings = (deterministic || [])
    .slice(0, 20)
    .map((f) => `[${f.severity}] ${f.type}: ${f.detail.substring(0, 100)}`)
    .join("\n");

  // Compress AI findings — include all categories for richer Sonnet synthesis
  const aiLines = (aiFindings || [])
    .map((a) => {
      const bugs = (a.bugs || []).map((b) => `[BUG:${b.severity}] ${b.desc}`).join("; ");
      const ux = (a.ux_issues || []).map((u) => `[UX:${u.severity || "medium"}] ${u.desc}`).join("; ");
      const access = (a.accessibility || []).map((ac) => `[A11Y] ${ac.desc}`).join("; ");
      const suggest = (a.suggestions || []).map((s) => `[SUGGEST:${s.effort || "medium"}] ${s.desc}`).join("; ");
      const all = [bugs, ux, access, suggest].filter(Boolean).join("; ");
      return `Step ${a.step} (${a.screenType}, feature=${a.feature || "unknown"}): ${all || "no issues"}`;
    })
    .join("\n");

  // Compress flows
  const flowLines = (flows || [])
    .slice(0, 10)
    .map((f) => `${f.feature}/${f.subType || "main"}: ${f.outcome} (${f.steps.length} steps)`)
    .join("; ");

  return (
    `You are a senior QA engineer writing a test report.\n\n` +
    `App: ${packageName}\n` +
    `Crawl: ${crawlStats.totalSteps} steps, ${crawlStats.uniqueStates} unique screens, stopped: ${crawlStats.stopReason}\n\n` +
    `Coverage: ${coverageLines}\n\n` +
    `User pain points: ${opts.painPoints || "None specified"}\n` +
    `User goals: ${opts.goals || "General review"}\n\n` +
    `Deterministic findings:\n${detFindings || "None"}\n\n` +
    `AI analysis findings:\n${aiLines || "None"}\n\n` +
    `Completed flows: ${flowLines || "None"}\n\n` +
    `Generate JSON: {"overall_score":0-100,"summary":"...","critical_bugs":[],"ux_issues":[],"suggestions":[],"quick_wins":[],"recommended_next_steps":[],"coverage_assessment":"..."}`
  );
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * Extract visible text labels from XML (for compressed context).
 * @param {string} xml
 * @param {number} max
 * @returns {string[]}
 */
function extractKeyLabels(xml, max) {
  if (!xml) return [];
  const labels = [];
  const regex = /text="([^"]+)"/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const text = m[1].trim();
    if (text && text.length > 1 && text.length < 50) {
      labels.push(text);
    }
    if (labels.length >= max) break;
  }
  return labels;
}

module.exports = {
  buildScreenAnalysisPrompt,
  buildReportPrompt,
  extractKeyLabels,
};
