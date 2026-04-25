#!/usr/bin/env node
"use strict";

/**
 * scripts/demo-report-v2.js — Run V2 synthesis against a stored trace.
 *
 * Usage:
 *   node scripts/demo-report-v2.js <jobId>
 *   node scripts/demo-report-v2.js --fixture       # use a built-in offline fixture (no API call)
 *   node scripts/demo-report-v2.js --jobs-list     # show recently-completed jobs to pick from
 *
 * Prints the validated V2 report JSON to stdout, plus a human-readable
 * summary to stderr (so you can pipe stdout to a file).
 *
 * Why a script: lets us preview the V2 pipeline output on real traces
 * without modifying the production /start-job route. The user can run
 * this against any prior job, eyeball the output, and decide whether
 * to flip a feature flag in report-builder.js.
 */

const path = require("path");
const fs = require("fs");
const store = require("../jobs/store");
const { synthesizeReportV2 } = require("../output/report-synthesis-v2");

function fail(msg) {
  console.error(`\n[demo-report-v2] ERROR: ${msg}\n`);
  process.exit(1);
}

function printUsage() {
  console.error([
    "",
    "Usage:",
    "  node scripts/demo-report-v2.js <jobId>      Run V2 synthesis on a stored job",
    "  node scripts/demo-report-v2.js --fixture    Use offline fixture (no API call)",
    "  node scripts/demo-report-v2.js --jobs-list  List recent completed jobs",
    "",
  ].join("\n"));
}

async function listJobs() {
  const result = store.listJobs ? store.listJobs({ limit: 30 }) : { items: [] };
  const items = (result && result.items) || result || [];
  const recent = items
    .filter((j) => j && (j.status === "complete" || j.status === "degraded"))
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
    .slice(0, 15);
  if (recent.length === 0) {
    console.error("No completed jobs found in the local store.");
    return;
  }
  console.error("Recent completed jobs (newest first):");
  for (const j of recent) {
    console.error(`  ${j.id}   status=${j.status}  package=${j.packageName || "?"}  screens=${(j.screens || []).length}`);
  }
}

function fixtureInputs() {
  return {
    packageName: "com.example.demoapp",
    crawlStats: { totalSteps: 60, uniqueScreens: 38, stopReason: "max_steps_reached" },
    screens: [
      { step: 1, screenType: "auth", activity: ".LoginActivity", feature: "auth" },
      { step: 4, screenType: "auth", activity: ".LoginActivity", feature: "auth" },
      { step: 9, screenType: "feed", activity: ".HomeActivity", feature: "home" },
      { step: 14, screenType: "settings", activity: ".SettingsActivity", feature: "settings" },
      { step: 22, screenType: "profile", activity: ".ProfileActivity", feature: "profile" },
      { step: 31, screenType: "form", activity: ".EditProfileActivity", feature: "profile" },
    ],
    stage2Analyses: [
      {
        step: 4,
        critical_bugs: [],
        ux_issues: [
          {
            title: "OTP input rejects paste",
            evidence: "Long-press did not surface a paste affordance on the 6-digit OTP field",
            severity: "medium",
            confidence: 0.88,
          },
        ],
        accessibility: [
          {
            title: "OTP field has no label",
            evidence: "OTP input has no contentDescription and no associated label",
            severity: "medium",
            confidence: 0.92,
          },
        ],
      },
      {
        step: 31,
        ux_issues: [
          {
            title: "Save mutates user account on a profile-edit screen",
            evidence: "Form Save button is reachable without explicit user intent",
            severity: "high",
            confidence: 0.85,
          },
        ],
      },
    ],
    deterministicFindings: [
      { type: "small_tap_target", severity: "medium", detail: "Login submit button bounds 32dp x 32dp", step: 4, element: "btn_submit" },
    ],
    coverageSummary: {
      auth: { uniqueScreens: 4, status: "covered" },
      home: { uniqueScreens: 8, status: "covered" },
      settings: { uniqueScreens: 6, status: "partial" },
      profile: { uniqueScreens: 12, status: "covered" },
    },
    flows: [
      { feature: "auth", subType: "email_login", outcome: "completed", steps: [{}, {}, {}, {}, {}] },
    ],
    opts: {},
  };
}

async function runFromStore(jobId) {
  const job = store.getJob ? store.getJob(jobId) : null;
  if (!job) fail(`Job ${jobId} not found in local store.`);

  // Fast path: if a V2 run already happened on this job (REPORT_V2_ENABLED
  // was true at the time), just return the persisted output. No new API call.
  if (job.v2Report) {
    console.error(`[demo-report-v2] using persisted V2 output from job ${jobId}`);
    return {
      ok: true,
      report: job.v2Report,
      tokenUsage: job.v2TokenUsage || { input_tokens: 0, output_tokens: 0 },
      screenIdIndex: { ids: [], byId: {} },
    };
  }
  if (job.v2Errors) {
    console.error(`[demo-report-v2] job ${jobId} has persisted V2 errors:`);
    return { ok: false, errors: job.v2Errors, tokenUsage: { input_tokens: 0, output_tokens: 0 } };
  }

  // Slow path: re-synthesize from stored screens + Stage 2 analyses.
  // The job store may not surface aiAnalyses (older runs predating
  // REPORT_V2_ENABLED won't have it persisted) so this path is best-effort.
  if (!Array.isArray(job.screens) || job.screens.length === 0) {
    fail(`Job ${jobId} has no screens array — can't synthesize. (Older runs predating REPORT_V2_ENABLED don't persist a screens field; trigger a fresh run.)`);
  }

  // Pull the same inputs the production report-builder would.
  // Defensive: fields may be undefined in older job records.
  const inputs = {
    packageName: job.packageName || "unknown",
    crawlStats: job.stats || {
      totalSteps: (job.actionsTaken || []).length,
      uniqueScreens: (job.screens || []).length,
      stopReason: job.stopReason || "unknown",
    },
    screens: job.screens.map((s) => ({
      step: s.step,
      screenType: s.screenType,
      activity: s.activity,
      feature: s.feature,
    })),
    stage2Analyses: job.aiAnalyses || job.oracleAnalyses || [],
    deterministicFindings: job.oracleFindings || job.deterministicFindings || [],
    coverageSummary: job.coverage || {},
    flows: job.flows || [],
    opts: { painPoints: job.painPoints, goals: job.goals },
  };

  console.error(`[demo-report-v2] running synthesis on job ${jobId} (${inputs.packageName})...`);
  console.error(`[demo-report-v2] screens=${inputs.screens.length}, stage2=${inputs.stage2Analyses.length}`);

  return synthesizeReportV2(inputs);
}

async function runFixture() {
  // For the fixture path we don't make a real API call — return a
  // hand-written valid V2 report so the user can see the SHAPE of the
  // output, matching exactly what a real synthesis would emit.
  console.error("[demo-report-v2] using offline fixture — no API call made");
  const inputs = fixtureInputs();
  const report = {
    verdict: {
      claims: [
        {
          claim: "First-time users hit a sign-in wall on screen_4 before any feed content loads.",
          confidence: "observed",
          evidence_screen_ids: ["screen_4"],
        },
        {
          claim: "Profile-edit form on screen_31 exposes a Save button reachable without explicit user intent.",
          confidence: "observed",
          evidence_screen_ids: ["screen_31"],
        },
        {
          claim: "Settings (screen_14) surfaces 6 toggles but no in-app account-deletion path was reached.",
          confidence: "observed",
          evidence_screen_ids: ["screen_14"],
        },
      ],
    },
    diligence_flags: [
      {
        severity: "concern",
        claim: "Auth gates basic browsing on screens 1 and 4 — historically suppresses unauthenticated activation.",
        confidence: "inferred",
        evidence_screen_ids: ["screen_1", "screen_4"],
        severity_rationale: "Pre-account-creation gating typically reduces D1 retention by 30-50% versus open browsing.",
        founder_question: "What is your D1/D7 retention split between authenticated and unauthenticated cohorts, and have you measured the auth-wall opt-in rate?",
      },
      {
        severity: "concern",
        claim: "Profile-edit Save button is reachable without explicit save intent on screen_31.",
        confidence: "observed",
        evidence_screen_ids: ["screen_31"],
        severity_rationale: "Accidental account mutation is a trust risk — particularly at scale.",
        founder_question: "Why is Save accessible without confirmation on screen_31? Has this triggered support tickets for unintended profile changes?",
      },
      {
        severity: "watch_item",
        claim: "OTP input on screen_4 does not accept clipboard paste, friction for users on the same device.",
        confidence: "observed",
        evidence_screen_ids: ["screen_4"],
        founder_question: "Why disable paste on the OTP field — anti-fraud, or oversight? What is your OTP input completion rate?",
      },
      {
        severity: "watch_item",
        claim: "OTP field on screen_4 has no associated label or contentDescription.",
        confidence: "observed",
        evidence_screen_ids: ["screen_4"],
        founder_question: "What is your roadmap for accessibility compliance? Many regions are tightening regulatory requirements.",
      },
      {
        severity: "strength",
        claim: "Settings (screen_14) surfaces a notifications toggle directly without nesting.",
        confidence: "observed",
        evidence_screen_ids: ["screen_14"],
        founder_question: "What does your notifications opt-out rate look like — given how directly accessible the toggle is?",
      },
    ],
    critical_bugs: [],
    ux_issues: [
      {
        title: "OTP field rejects clipboard paste",
        claim: "Long-press on the 6-digit OTP input on screen_4 does not surface a paste affordance.",
        severity: "medium",
        confidence: "observed",
        evidence_screen_ids: ["screen_4"],
      },
      {
        title: "Login submit button below 48dp",
        claim: "Submit button on screen_4 is 32dp x 32dp, below the 48dp Material guideline.",
        severity: "medium",
        confidence: "observed",
        evidence_screen_ids: ["screen_4"],
      },
    ],
    coverage_summary: {
      screens_reached: 38,
      screens_attempted_blocked: [
        { area: "post-auth feed", reason: "test credentials rejected at screen_4" },
        { area: "in-app payments", reason: "paywall not reached in this session" },
      ],
      areas_not_attempted: ["in-app messaging", "video calling", "premium tier features"],
    },
  };
  return { ok: true, report, tokenUsage: { input_tokens: 0, output_tokens: 0 }, screenIdIndex: { ids: ["screen_1", "screen_4", "screen_9", "screen_14", "screen_22", "screen_31"], byId: {} } };
}

function summarizeForHuman(result) {
  if (!result.ok) {
    console.error("\n=== SYNTHESIS FAILED ===\n");
    for (const e of result.errors || []) console.error("  - " + e);
    return;
  }
  const r = result.report;
  console.error("\n=== V2 REPORT (validated) ===\n");
  console.error("VERDICT (3 claims):");
  for (let i = 0; i < r.verdict.claims.length; i++) {
    const c = r.verdict.claims[i];
    console.error(`  ${i + 1}. [${c.confidence}] ${c.claim}`);
    console.error(`     ↳ evidence: ${c.evidence_screen_ids.join(", ")}`);
  }
  console.error(`\nDILIGENCE FLAGS (${r.diligence_flags.length}):`);
  for (let i = 0; i < r.diligence_flags.length; i++) {
    const f = r.diligence_flags[i];
    const icon = f.severity === "concern" ? "🔴" : f.severity === "watch_item" ? "🟡" : "🟢";
    console.error(`  ${icon} ${i + 1}. ${f.claim}`);
    console.error(`     ↳ evidence: ${f.evidence_screen_ids.join(", ")}`);
    console.error(`     ↳ ask founder: ${f.founder_question}`);
  }
  if (r.critical_bugs.length > 0) {
    console.error(`\nCRITICAL BUGS (${r.critical_bugs.length}):`);
    for (const b of r.critical_bugs) console.error(`  - [${b.severity}] ${b.title} → ${b.evidence_screen_ids.join(", ")}`);
  }
  if (r.ux_issues.length > 0) {
    console.error(`\nUX ISSUES (${r.ux_issues.length}):`);
    for (const u of r.ux_issues) console.error(`  - [${u.severity}] ${u.title} → ${u.evidence_screen_ids.join(", ")}`);
  }
  const cov = r.coverage_summary;
  console.error(`\nCOVERAGE: ${cov.screens_reached} screens reached`);
  if (cov.screens_attempted_blocked && cov.screens_attempted_blocked.length > 0) {
    console.error(`  Blocked: ${cov.screens_attempted_blocked.map((b) => `${b.area} (${b.reason})`).join("; ")}`);
  }
  if (cov.areas_not_attempted && cov.areas_not_attempted.length > 0) {
    console.error(`  Not attempted: ${cov.areas_not_attempted.join(", ")}`);
  }
  console.error(`\nTokens: in=${result.tokenUsage.input_tokens}, out=${result.tokenUsage.output_tokens}`);
  console.error("\n=== STDOUT — full JSON below ===\n");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printUsage();
    process.exit(0);
  }
  let result;
  if (argv[0] === "--fixture") {
    result = await runFixture();
  } else if (argv[0] === "--jobs-list") {
    await listJobs();
    return;
  } else {
    result = await runFromStore(argv[0]);
  }
  summarizeForHuman(result);
  // Always emit the full JSON to stdout so the user can pipe it.
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => fail(err.stack || err.message || String(err)));
