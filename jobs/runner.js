"use strict";

require("dotenv").config();
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const store = require("./store");
const { bootEmulator, installApk, relaunchApp, killEmulator, resetEmulator } = require("../emulator/manager");
const { sendReportEmail } = require("../output/email-sender");
const magicLink = require("../lib/magic-link");
const { sleep } = require("../utils/sleep");
const {
  USE_CRAWLER_V1,
  SKIP_AI_FOR_TESTS,
  SCREENSHOT_DIR_PREFIX,
  MAX_CRAWL_STEPS,
  MAX_CRAWL_DURATION_MS,
  CRAWL_ENGINE,
  V16_MAX_COST_USD,
  V16_MAX_SONNET_ESCALATIONS,
} = require("../config/defaults");

const metrics = require("../lib/metrics");
const { alertJobFailed, alertConsecutiveFailures, alertDiskCritical } = require("../lib/alerts");
const { logger, createJobLogger } = require("../lib/logger");
const { synthesizeReportV2 } = require("../output/report-synthesis-v2");
const { annotateCitedScreens } = require("../output/annotator/pipeline");
const { synthesizeExecutiveSummary } = require("../output/executive-summary");
const billing = require("../lib/billing");

/**
 * Refund the credit charged on this job if the run terminated with a
 * code-side fault. Idempotent — `creditRefunded: true` flag on the job
 * blocks double-refunds. Skipped silently for jobs that were never
 * charged (admin/design_partner runs, jobs predating freemium).
 */
async function refundIfCodeSideFault(jobId, reason, log) {
  try {
    const job = store.getJob(jobId);
    if (!job) return;
    if (!job.userId) return;
    if (job.creditCharged === false) return;
    if (job.creditRefunded === true) return;
    const r = await billing.refundRun({ userId: job.userId, jobId, reason });
    if (r.ok && !r.skipped) {
      log.info(
        { jobId, reason, balanceAfter: r.balanceAfter },
        "billing: credit refunded on code-side fault",
      );
      store.updateJob(jobId, {
        creditRefunded: true,
        creditBalanceAfter: r.balanceAfter,
      });
    }
  } catch (e) {
    log.error({ err: e, jobId, reason }, "billing: refund failed");
  }
}

// V2 report synthesis runs alongside V1 when REPORT_V2_ENABLED=true.
// V1 path is unchanged — V2 is purely additive until validated.
const REPORT_V2_ENABLED =
  String(process.env.REPORT_V2_ENABLED || "").toLowerCase() === "true";

// Annotation pass — run only after V2 succeeds, only on cited screens.
// Independent flag so we can ship V2 reports without paying the
// per-screen vision call cost until the annotation grammar is shipped.
const ANNOTATIONS_ENABLED =
  String(process.env.ANNOTATIONS_ENABLED || "").toLowerCase() === "true";

// Engine selection happens at job runtime below — both v16 and v17 are loaded
// so a run can be steered via CRAWL_ENGINE env var without restarting.
const { runAgentLoop: runAgentLoopV16 } = require("../crawler/v16/agent-loop");
const { runAgentLoop: runAgentLoopV17 } = require("../crawler/v17/agent-loop");
const { runAgentLoop: runAgentLoopV18 } = require("../crawler/v18/agent-loop");
const { parseApk } = require("../ingestion/manifest-parser");
const { assessCompatibility } = require("../lib/app-compatibility");
const adb = require("../crawler/adb");

// Oracle pipeline (Week 4 + Phase 3.1)
const { triageForAI, triageWithRanker } = require("../oracle/triage");
const { analyzeTriagedScreens } = require("../oracle/ai-oracle");
const { buildReport } = require("../output/report-builder");
const { renderReportEmail } = require("../output/email-renderer");
const { ORACLE_STAGE1_ENABLED } = require("../config/defaults");
const {
  computeDriverHits,
  crossedFirstDecisionBoundary,
} = require("../lib/crawl-health");
const { apiError } = require("../lib/api-errors");

// ---------------------------------------------------------------------------
// C8: Pre-crawl disk check and auto-cleanup
// ---------------------------------------------------------------------------

const DISK_CLEANUP_THRESHOLD = 85;
const MAX_SCREENSHOT_DIRS = 20;

/**
 * Check disk usage and clean old screenshot dirs if above threshold.
 * Uses only hardcoded shell commands (no user input — safe from injection).
 */
function preCrawlDiskCheck() {
  try {
    // Safe: hardcoded command, no user input
    const dfOutput = require("child_process").execFileSync(
      "df", ["-h", "/"], { encoding: "utf-8", timeout: 5000 }
    );
    const lines = dfOutput.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    const match = lastLine.match(/(\d+)%/);
    if (!match) return;

    const usagePercent = parseInt(match[1], 10);
    logger.info({ usagePercent, component: "disk" }, `Disk usage: ${usagePercent}%`);

    if (usagePercent >= 90) {
      alertDiskCritical(usagePercent);
    }
    if (usagePercent >= DISK_CLEANUP_THRESHOLD) {
      logger.info({ threshold: DISK_CLEANUP_THRESHOLD, component: "disk" }, "Above threshold — cleaning old screenshot dirs");
      cleanOldScreenshotDirs();
    }
  } catch (e) {
    logger.warn({ err: e, component: "disk" }, `Disk check failed: ${e.message}`);
  }
}

function cleanOldScreenshotDirs() {
  try {
    const tmpDir = os.tmpdir();
    const dirs = fs.readdirSync(tmpDir)
      .filter((d) => d.startsWith("screenshots-"))
      .map((d) => {
        const fullPath = path.join(tmpDir, d);
        try {
          const stat = fs.statSync(fullPath);
          return { path: fullPath, mtime: stat.mtimeMs };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.mtime - b.mtime);

    const toDelete = dirs.slice(0, Math.max(0, dirs.length - MAX_SCREENSHOT_DIRS));
    for (const dir of toDelete) {
      try {
        fs.rmSync(dir.path, { recursive: true, force: true });
        logger.info({ path: dir.path, component: "disk" }, "Cleaned old screenshot dir");
      } catch (e) {
        logger.warn({ err: e, path: dir.path, component: "disk" }, `Failed to clean ${dir.path}`);
      }
    }

    if (toDelete.length > 0) {
      logger.info({ count: toDelete.length, component: "disk" }, `Cleaned ${toDelete.length} old screenshot dir(s)`);
    }
  } catch (e) {
    logger.warn({ err: e, component: "disk" }, `Cleanup failed: ${e.message}`);
  }
}

/**
 * Validate APK file before installation.
 * Checks: exists, non-zero, ZIP magic bytes (PK header).
 * @param {string} apkPath
 * @throws {Error} if validation fails
 */
function validateApk(apkPath) {
  if (!fs.existsSync(apkPath)) {
    throw new Error("APK file not found: " + apkPath);
  }
  const stat = fs.statSync(apkPath);
  if (stat.size === 0) {
    throw new Error("APK file is empty (0 bytes)");
  }
  // Check ZIP magic bytes (APK is a ZIP archive: PK\x03\x04)
  const fd = fs.openSync(apkPath, "r");
  const buf = Buffer.alloc(4);
  fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  if (buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    throw new Error("Invalid APK: file is not a valid ZIP/APK archive");
  }
}

// ---------------------------------------------------------------------------
// Job orchestrator
// ---------------------------------------------------------------------------

async function processJob(jobId, apkPath, opts) {
  const log = createJobLogger(jobId, opts.traceId);
  let crawlStartTime = Date.now();

  // Multi-emulator: set target device if serial provided
  if (opts.serial) {
    adb.setSerial(opts.serial);
    log.info({ serial: opts.serial }, "Targeting specific emulator");
  }

  try {
    store.updateJob(jobId, { status: "processing", step: 1 });

    // C8: Check disk before crawl
    preCrawlDiskCheck();

    // Step 1: Start emulator (E6: try warm reset first, cold boot as fallback)
    const warmResetOk = await resetEmulator(processJob._lastPackage || null);
    if (!warmResetOk) {
      await bootEmulator();
    }

    // Step 2: Validate and install APK
    store.updateJob(jobId, { step: 2 });
    validateApk(apkPath);
    installApk(apkPath);

    // Step 3: Crawl screens
    store.updateJob(jobId, { step: 3 });
    crawlStartTime = Date.now();
    log.info("Starting crawl");
    const screenshotDir = SCREENSHOT_DIR_PREFIX + jobId;
    fs.mkdirSync(screenshotDir, { recursive: true });

    let screenshots = [];
    let crawlResult = {};
    let appProfile = { packageName: "", activities: [], permissions: [], appName: "" };

    if (USE_CRAWLER_V1) {
      try {
        appProfile = parseApk(apkPath);
        log.info({ package: appProfile.packageName, launcher: appProfile.launcherActivity, activities: appProfile.activities.length }, "APK manifest parsed");
        // Persist app identity so the frontend can render the title from
        // it even when V1's deterministic report is suppressed (low-triage
        // runs). Previously appProfile lived only in this scope and the
        // report header rendered "Untitled build" for any suppressed run.
        store.updateJob(jobId, {
          appPackage: appProfile.packageName || null,
          appName: appProfile.appName || null,
          launcherActivity: appProfile.launcherActivity || null,
        });
      } catch (e) {
        log.warn({ err: e }, "Manifest parsing failed, falling back to pm list");
      }

      // H5: Pre-crawl compatibility check
      const compat = assessCompatibility(appProfile);
      if (!compat.crawlable) {
        log.info({ reason: compat.reason, quality: compat.quality }, "App is uncrawlable");
        store.updateJob(jobId, {
          status: "complete",
          crawlQuality: "uncrawlable",
          report: JSON.stringify({
            summary: `This app cannot be automatically crawled: ${compat.reason}`,
            recommendation: compat.recommendation,
            quality: compat.quality,
          }, null, 2),
        });
        // Code-side fault — the user uploaded a valid APK but our crawler
        // can't run it. Refund the credit so they can try a different app.
        await refundIfCodeSideFault(jobId, "uncrawlable:" + compat.reason, log);
        processJob._lastPackage = null;
        try { fs.unlinkSync(apkPath); } catch (_) {}
        return;
      }
      if (compat.quality === "degraded") {
        log.warn({ reason: compat.reason }, "App compatibility degraded");
      }

      let packageName = appProfile.packageName;

      // Fallback: use pm list packages if manifest parsing didn't get the package name
      if (!packageName) {
        try {
          const packages = execSync("adb shell pm list packages -3")
            .toString()
            .trim()
            .split("\n");
          packageName = packages[packages.length - 1]
            .replace("package:", "")
            .trim();
        } catch (e) {
          log.warn({ err: e }, "Could not detect package name");
        }
      }

      // Clear prior-run user data so every crawl sees a cold-start session.
      // pm install -r preserves the app's data dir, so a prior run's login
      // cookies / session tokens survive into the next run and AuthDriver never
      // sees an auth screen to claim. Mirrors scripts/golden-suite-run.js
      // resetForApp() — keeps the API path equivalent to the regression harness.
      if (packageName) {
        try {
          require("child_process").execFileSync(
            "adb",
            ["shell", "pm", "clear", packageName],
            { timeout: 30000, stdio: "pipe" },
          );
          log.info({ pkg: packageName }, "app data cleared pre-launch");
        } catch (e) {
          log.warn({ err: e, pkg: packageName }, "pm clear failed — continuing with stale data");
        }
      }

      // Launch app via shared helper (same code path agent-loop uses for
      // package-drift recovery, so launch + relaunch stay semantically
      // identical).
      if (!relaunchApp(packageName, appProfile.launcherActivity || null)) {
        log.error({ packageName }, "Could not launch app");
      }

      await sleep(3000);

      // Engine selection. V17 is the default (ecosystem.config.js pins it);
      // setting CRAWL_ENGINE=v16 in .env + `pm2 restart --update-env` is the
      // rollback path documented in V17_LAUNCH_CHECKLIST §3.
      //
      // V18 is the LLM-first engine (Phase 1: semantic classifier + intent
      // filter + Sonnet escalation). Opt-in via CRAWL_ENGINE=v18 until the
      // biztoso validation bar is met; then promote to default.
      if (!["v16", "v17", "v18"].includes(CRAWL_ENGINE)) {
        throw new Error(
          `Unknown CRAWL_ENGINE "${CRAWL_ENGINE}". Supported: "v16" (legacy), "v17" (driver-first, default), "v18" (LLM-first — opt-in).`,
        );
      }
      const runAgentLoop =
        CRAWL_ENGINE === "v18"
          ? runAgentLoopV18
          : CRAWL_ENGINE === "v17"
          ? runAgentLoopV17
          : runAgentLoopV16;
      log.info({ engine: CRAWL_ENGINE }, "crawl: selected agent loop engine");
      const crawlPromise = runAgentLoop({
        jobId,
        targetPackage: packageName,
        // Forwarded so V17's package-drift recovery can relaunch via the
        // same launcher activity that runner.js used for the initial start.
        launcherActivity: appProfile.launcherActivity || null,
        screenshotDir,
        credentials: opts.credentials,
        staticInputs: opts.staticInputs || null,
        appContext: {
          goals: opts.goals,
          painPoints: opts.painPoints,
          goldenPath: opts.goldenPath,
        },
        budgetConfig: {
          maxSteps: MAX_CRAWL_STEPS,
          maxCostUsd: V16_MAX_COST_USD,
          maxSonnetEscalations: V16_MAX_SONNET_ESCALATIONS,
        },
        onProgress: (live) => {
          // V16.1: human-input events are transient markers; merge with the
          // last full live payload so rawStep/unique-count/action don't blank
          // out while the modal is open. Normal progress payloads replace
          // `live` wholesale as before.
          if (live && live.type === "awaiting_human_input") {
            const current = store.getJob(jobId);
            const merged = {
              ...(current && current.live ? current.live : {}),
              awaitingHumanInput: {
                field: live.field,
                prompt: live.prompt,
                timeoutMs: live.timeoutMs,
              },
            };
            store.updateJob(jobId, { live: merged });
            return;
          }
          if (live && live.type === "human_input_received") {
            const current = store.getJob(jobId);
            const merged = {
              ...(current && current.live ? current.live : {}),
              awaitingHumanInput: null,
            };
            store.updateJob(jobId, { live: merged });
            return;
          }
          store.updateJob(jobId, { live });
        },
      });
      const timeoutPromise = new Promise((_, reject) => {
        const id = setTimeout(() => reject(new Error('Crawl timeout exceeded')), MAX_CRAWL_DURATION_MS);
        crawlPromise.then(() => clearTimeout(id), () => clearTimeout(id));
      });
      crawlResult = await Promise.race([crawlPromise, timeoutPromise]);

      log.info(
        {
          engine: CRAWL_ENGINE,
          stopReason: crawlResult.stopReason,
          uniqueScreens: (crawlResult.stats || {}).uniqueStates || (crawlResult.screens || []).length,
          costUsd: crawlResult.costUsd,
          sonnetEscalations: crawlResult.sonnetEscalations,
        },
        "Crawl finished",
      );

      screenshots = (crawlResult.screens || []).map((s) => ({
        path: s.path,
        xml: s.xml,
        index: s.index,
      }));

      store.updateJob(jobId, {
        screenshots: screenshots.map((s) => s.path),
        crawlGraph: crawlResult.graph,
        crawlStats: crawlResult.stats,
        stopReason: crawlResult.stopReason,
      });

      const crawlStopReason = crawlResult.stopReason;
      const isCrawlFailed =
        !screenshots ||
        screenshots.length === 0 ||
        crawlStopReason === "device_offline" ||
        crawlStopReason === "capture_failed";

      const isCrawlDegraded =
        !isCrawlFailed &&
        screenshots.length < 3;

      if (isCrawlFailed) {
        log.error({ stopReason: crawlStopReason, screens: screenshots ? screenshots.length : 0 }, "Crawl failed");
        store.updateJob(jobId, {
          status: "failed",
          error: "Crawl failed: " + (crawlStopReason || "no screens captured"),
        });
        metrics.recordCrawl({
          stopReason: crawlStopReason || "unknown",
          durationMs: Date.now() - crawlStartTime,
          uniqueScreens: screenshots ? screenshots.length : 0,
          visionCalls: (crawlResult.stats || {}).visionCalls || 0,
          recoveryAttempts: (crawlResult.stats || {}).recoveryAttempts || 0,
          costInr: 0,
        });
        alertJobFailed(jobId, crawlStopReason, "no screens captured");
        // Code-side fault — device went offline or capture failed. Refund.
        await refundIfCodeSideFault(jobId, "crawl_failed:" + (crawlStopReason || "no_screens"), log);
        return;
      }

      if (isCrawlDegraded) {
        store.updateJob(jobId, { crawlQuality: "degraded" });
        log.warn({ screens: screenshots.length }, "Crawl degraded — few screens captured");
      } else {
        store.updateJob(jobId, { crawlQuality: "good" });
      }
    } else {
      screenshots = await legacyCrawl(jobId, screenshotDir);
    }

    if (SKIP_AI_FOR_TESTS) {
      log.info("SKIP_AI_FOR_TESTS=true — skipping analysis, report, and email");

      const job = store.getJob(jobId);
      store.updateJob(jobId, {
        step: 4,
        analyses: [],
        report: JSON.stringify({
          test_mode: true,
          summary: "AI analysis skipped for test run",
          screens_captured: screenshots.length,
          crawl_quality: job.crawlQuality || "unknown",
          stop_reason: job.stopReason || "unknown",
          oracle_findings: crawlResult.oracleFindings || [],
        }, null, 2),
      });

      const updatedJob = store.getJob(jobId);
      // Test-mode runs skip the full oracle pipeline, but every job MUST
      // carry a costBreakdown so downstream telemetry / admin rollups have
      // a consistent shape to read. All per-stage buckets are zero here
      // since no paid calls happened in this branch.
      const zeroCostBreakdown = {
        crawlHaiku: 0,
        oracleStage1: 0,
        oracleStage2: 0,
        reportSynthesis: 0,
        totalUsd: 0,
      };
      store.updateJob(jobId, {
        step: 6,
        emailStatus: "skipped_test_mode",
        status: updatedJob.crawlQuality === "degraded" ? "degraded" : "complete",
        costUsd: 0,
        costBreakdown: zeroCostBreakdown,
      });

      // E6: Keep emulator alive for warm reset
      processJob._lastPackage = appProfile.packageName || null;
      try { fs.unlinkSync(apkPath); } catch (e) {}
      return;
    }

    // Step 4: Oracle pipeline — triage → gated AI → structured report
    store.updateJob(jobId, { step: 4 });
    const tokenUsage = { input_tokens: 0, output_tokens: 0 };
    const haikuTokensAccum = { input_tokens: 0, output_tokens: 0 };
    const sonnetTokensAccum = { input_tokens: 0, output_tokens: 0 };
    // Per-stage tokens for costBreakdown (Phase 3.1 step 5). Zero-initialized
    // here so the final metric is always present even if step 4 crashes.
    const stage1Tokens = { input_tokens: 0, output_tokens: 0 };
    const stage2Tokens = { input_tokens: 0, output_tokens: 0 };
    let triageResult = { screensToAnalyze: [], skippedScreens: [], triageLog: [] };
    let analyses = [];
    // Hoisted out of the REPORT_V2_ENABLED block so the post-pipeline
    // cost calc can read annotationsResult.tokenUsage. Phase E7.
    let annotationsResult = null;
    let report = null;

    try {
      // 4a: Triage — Stage 1 Haiku ranker + top-K selection.
      // Falls back to heuristic-only (triageForAI) if the flag is off OR if
      // the Stage 1 SDK call fails — zero regression vs pre-3.1 behavior.
      if (ORACLE_STAGE1_ENABLED) {
        triageResult = await triageWithRanker(
          crawlResult.screens || [],
          crawlResult.oracleFindingsByStep || {},
          crawlResult.coverage || {},
          null,
          {},
        );
        if (triageResult.rankerTokens) {
          stage1Tokens.input_tokens = triageResult.rankerTokens.input_tokens;
          stage1Tokens.output_tokens = triageResult.rankerTokens.output_tokens;
        }
      } else {
        triageResult = triageForAI(
          crawlResult.screens || [],
          crawlResult.oracleFindingsByStep || {},
          crawlResult.coverage || {},
        );
      }
      log.info({
        selected: triageResult.screensToAnalyze.length,
        skipped: triageResult.skippedScreens.length,
        rankerUsed: Boolean(triageResult.rankerUsed),
        stage1InputTokens: stage1Tokens.input_tokens,
      }, "Triage complete");

      // 4b: Gated AI analysis — only on triaged screens
      const { analyses: aiAnalyses, totalTokens: analysisTokens } = await analyzeTriagedScreens(
        triageResult.screensToAnalyze,
        {
          appCategory: crawlResult.plan?.appCategory || "unknown",
          coverage: crawlResult.coverage,
        }
      );
      analyses = aiAnalyses;
      tokenUsage.input_tokens += analysisTokens.input_tokens;
      tokenUsage.output_tokens += analysisTokens.output_tokens;
      // Oracle analysis uses Haiku
      haikuTokensAccum.input_tokens += analysisTokens.input_tokens;
      haikuTokensAccum.output_tokens += analysisTokens.output_tokens;
      // Stage 1 ranker also uses Haiku — account for it in the same bucket.
      haikuTokensAccum.input_tokens += stage1Tokens.input_tokens;
      haikuTokensAccum.output_tokens += stage1Tokens.output_tokens;
      tokenUsage.input_tokens += stage1Tokens.input_tokens;
      tokenUsage.output_tokens += stage1Tokens.output_tokens;
      // Per-stage Haiku breakdown — Stage 2 tokens == analysisTokens.
      stage2Tokens.input_tokens = analysisTokens.input_tokens;
      stage2Tokens.output_tokens = analysisTokens.output_tokens;

      // Step 5: Structured report (1 Sonnet LLM call)
      store.updateJob(jobId, { step: 5 });

      // Phase 3.2: crossedFirstDecisionBoundary gates critical_bugs in
      // report-builder. Compute from V17 actionsTaken via lib/crawl-health.js
      // (same heuristic as scripts/golden-suite-run.js so CI and runtime agree).
      const actionsTaken = crawlResult.actionsTaken || [];
      const driverHits = computeDriverHits(actionsTaken);
      const boundaryCrossed = crossedFirstDecisionBoundary(
        actionsTaken,
        (crawlResult.stats || {}).uniqueStates || 0,
      );

      const reportResult = await buildReport({
        packageName: appProfile.packageName || "",
        coverageSummary: crawlResult.coverage || {},
        deterministicFindings: crawlResult.oracleFindings || [],
        aiAnalyses: analyses,
        flows: crawlResult.flows || [],
        crawlStats: crawlResult.stats || {},
        opts,
        crawlHealth: {
          stopReason: crawlResult.stopReason,
          totalSteps: (crawlResult.stats || {}).totalSteps,
          uniqueStates: (crawlResult.stats || {}).uniqueStates,
          crossedFirstDecisionBoundary: boundaryCrossed,
          driverHits,
          oracleFindingsCount: (crawlResult.oracleFindings || []).length,
          aiScreensAnalyzed: triageResult.screensToAnalyze.length,
          aiScreensSkipped: triageResult.skippedScreens.length,
        },
      });
      report = reportResult.report;
      tokenUsage.input_tokens += reportResult.tokenUsage.input_tokens;
      tokenUsage.output_tokens += reportResult.tokenUsage.output_tokens;
      // Report generation uses Sonnet
      sonnetTokensAccum.input_tokens += reportResult.tokenUsage.input_tokens;
      sonnetTokensAccum.output_tokens += reportResult.tokenUsage.output_tokens;

      // V2 report synthesis — runs alongside V1 when REPORT_V2_ENABLED=true.
      // Failures here are isolated; V1 path is unaffected.
      if (REPORT_V2_ENABLED) {
        let v2Report = null;
        let v2TokenUsage = { input_tokens: 0, output_tokens: 0 };
        let v2Errors = null;
        try {
          const v2Result = await synthesizeReportV2({
            packageName: appProfile.packageName || "",
            crawlStats: crawlResult.stats || {},
            // Full screen list — synthesizer cites by id, but we pass
            // every screen so it can reference unanalyzed screens too
            // (e.g. "settings page reached at screen_14 but not deeply analyzed").
            screens: (crawlResult.screens || []).map((s) => ({
              step: s.step,
              screenType: s.screenType || "unknown",
              activity: s.activity,
              feature: s.feature,
            })),
            stage2Analyses: analyses || [],
            deterministicFindings: crawlResult.oracleFindings || [],
            coverageSummary: crawlResult.coverage || {},
            flows: crawlResult.flows || [],
            opts: { painPoints: opts.painPoints, goals: opts.goals },
          });
          if (v2Result.ok) {
            v2Report = v2Result.report;
            v2TokenUsage = v2Result.tokenUsage;
            // 2026-04-26 (Phase E8): the cost-breakdown calc derives V2
            // synthesis spend by subtracting annotation tokens from the
            // total Sonnet accumulator. That subtraction needs the V2
            // synth tokens to actually be IN the accumulator first —
            // previously they only lived in v2TokenUsage and the breakdown
            // showed reportSynthesis: $0 even on successful runs.
            sonnetTokensAccum.input_tokens += v2TokenUsage.input_tokens || 0;
            sonnetTokensAccum.output_tokens += v2TokenUsage.output_tokens || 0;
            // Persist V2 to disk for offline inspection — separate from
            // the SQLite blob so even large reports don't bloat the row.
            try {
              const reportsDir = `/tmp/reports/${jobId}`;
              fs.mkdirSync(reportsDir, { recursive: true });
              fs.writeFileSync(
                path.join(reportsDir, "v2-report.json"),
                JSON.stringify(v2Result.report, null, 2),
              );
            } catch (writeErr) {
              log.warn({ err: writeErr.message }, "V2: disk write failed (non-fatal)");
            }
            log.info(
              {
                jobId,
                v2Flags: v2Result.report.diligence_flags.length,
                v2Verdicts: v2Result.report.verdict.claims.length,
                v2UxIssues: v2Result.report.ux_issues.length,
                v2InputTokens: v2TokenUsage.input_tokens,
                v2OutputTokens: v2TokenUsage.output_tokens,
              },
              "V2 synthesis OK",
            );
          } else {
            v2Errors = v2Result.errors;
            v2TokenUsage = v2Result.tokenUsage || v2TokenUsage;
            // E8: even a validation-failure cost real Sonnet tokens.
            sonnetTokensAccum.input_tokens += v2TokenUsage.input_tokens || 0;
            sonnetTokensAccum.output_tokens += v2TokenUsage.output_tokens || 0;
            log.warn(
              { jobId, errors: v2Result.errors.slice(0, 5) },
              "V2 synthesis returned validation failure",
            );
          }
        } catch (v2Err) {
          v2Errors = [`v2_exception: ${v2Err.message || String(v2Err)}`];
          log.warn({ err: v2Err.message }, "V2 synthesis threw — V1 report unaffected");
        }
        // Annotation pass — run on cited screens only. Gated separately
        // so we can ship V2 reports today without paying for vision
        // calls per screen until the annotation UI is wired up.
        // annotationsResult declared in outer scope (cost-calc reads it).
        if (ANNOTATIONS_ENABLED && v2Report) {
          try {
            const outDir = `/tmp/reports/${jobId}/annotated`;
            const annotateOut = await annotateCitedScreens({
              jobId,
              report: v2Report,
              screens: crawlResult.screens || [],
              stage2Analyses: analyses || [],
              outDir,
            });
            annotationsResult = {
              annotatedScreens: annotateOut.annotatedScreens,
              failedScreens: annotateOut.failedScreens,
              tokenUsage: annotateOut.tokenUsage,
              dir: outDir,
              perScreen: annotateOut.results.map((r) => ({
                screenId: r.screenId,
                ok: !!r.files,
                files: r.files || null,
                errors: r.errors || null,
              })),
            };
            sonnetTokensAccum.input_tokens += annotateOut.tokenUsage.input_tokens || 0;
            sonnetTokensAccum.output_tokens += annotateOut.tokenUsage.output_tokens || 0;
            log.info(
              {
                jobId,
                annotatedCount: annotateOut.annotatedScreens.length,
                failedCount: annotateOut.failedScreens.length,
                annInputTokens: annotateOut.tokenUsage.input_tokens,
                annOutputTokens: annotateOut.tokenUsage.output_tokens,
              },
              "Annotation pass complete",
            );
          } catch (annErr) {
            log.warn(
              { err: annErr.message },
              "Annotation pass threw — V2 report unaffected",
            );
            annotationsResult = {
              annotatedScreens: [],
              failedScreens: [],
              tokenUsage: { input_tokens: 0, output_tokens: 0 },
              error: annErr.message,
            };
          }
        }

        // Phase B6 (2026-04-26): editorial executive summary. One Haiku
        // call that takes V2's structured findings and produces a
        // 5-sentence analyst-voice TL;DR for the report's executive-
        // summary section. Failures are non-fatal — the frontend already
        // has a deterministic fallback for legacy / V1-only reports.
        let executiveSummary = null;
        let executiveSummaryTokens = { input_tokens: 0, output_tokens: 0 };
        if (v2Report) {
          try {
            const execResult = await synthesizeExecutiveSummary({
              appName: appProfile.appName || "",
              packageName: appProfile.packageName || "",
              v2Report,
              coverage: crawlResult.coverage || {},
            });
            if (execResult.ok) {
              executiveSummary = execResult.summary;
              executiveSummaryTokens = execResult.tokenUsage || executiveSummaryTokens;
              haikuTokensAccum.input_tokens += executiveSummaryTokens.input_tokens || 0;
              haikuTokensAccum.output_tokens += executiveSummaryTokens.output_tokens || 0;
              log.info(
                { jobId, leadLen: execResult.summary.lead_sentence.length },
                "Executive summary OK",
              );
            } else {
              executiveSummaryTokens = execResult.tokenUsage || executiveSummaryTokens;
              if (executiveSummaryTokens.input_tokens > 0) {
                haikuTokensAccum.input_tokens += executiveSummaryTokens.input_tokens;
                haikuTokensAccum.output_tokens += executiveSummaryTokens.output_tokens || 0;
              }
              log.warn(
                { jobId, errors: execResult.errors?.slice(0, 3) },
                "Executive summary failed — frontend will use deterministic fallback",
              );
            }
          } catch (execErr) {
            log.warn(
              { err: execErr.message },
              "Executive summary threw — frontend will use deterministic fallback",
            );
          }
        }

        // Persist V2 fields alongside V1. They are read by the demo
        // script (and, eventually, the V2-aware frontend) — null when
        // the synthesizer didn't produce a valid report.
        store.updateJob(jobId, {
          v2Report,
          v2TokenUsage,
          v2Errors,
          annotations: annotationsResult,
          executiveSummary,
        });
      }
    } catch (oracleErr) {
      log.error({ err: oracleErr }, "Oracle/report pipeline failed");
      // C6: Guaranteed minimum output — generate report from what we have
      report = {
        summary: `Automated analysis could not complete: ${oracleErr.message}`,
        quality: "minimal",
        screens: screenshots.length,
        stopReason: crawlResult.stopReason,
        findings: crawlResult.oracleFindings || [],
        error: oracleErr.message,
      };
      store.updateJob(jobId, {
        status: "degraded",
        report,
        crawlQuality: "minimal",
        triageLog: triageResult.triageLog,
      });
      metrics.recordCrawl({
        stopReason: "oracle_failed_with_fallback",
        durationMs: Date.now() - crawlStartTime,
        uniqueScreens: screenshots.length,
        visionCalls: (crawlResult.stats || {}).visionCalls || 0,
        recoveryAttempts: (crawlResult.stats || {}).recoveryAttempts || 0,
        costInr: 0,
      });
      alertJobFailed(jobId, "oracle_failed", oracleErr.message);
      // Don't return — continue to metrics/cleanup below
    }

    store.updateJob(jobId, {
      report,
      tokenUsage,
      triageLog: triageResult.triageLog,
    });

    log.info({ inputTokens: tokenUsage.input_tokens, outputTokens: tokenUsage.output_tokens, totalTokens: tokenUsage.input_tokens + tokenUsage.output_tokens }, "Token usage");

    // Step 6: Send email with magic-link to the shareable report URL.
    store.updateJob(jobId, { step: 6 });

    if (opts.email) {
      try {
        store.updateJob(jobId, { emailStatus: "sending" });
        const shareUrl = magicLink.buildShareUrl(jobId);
        if (!shareUrl) {
          log.warn(
            "Magic-link share URL unavailable — email will be sent without a 'View online' CTA (set MAGIC_LINK_SECRET and PUBLIC_APP_URL)"
          );
        }
        const emailResult = await sendReportEmail(
          opts.email,
          report,
          triageResult.screensToAnalyze.length,
          { shareUrl }
        );
        store.updateJob(jobId, { emailStatus: emailResult.status });
        if (emailResult.error) {
          store.updateJob(jobId, { emailError: emailResult.error });
          log.error({ emailStatus: emailResult.status, emailError: emailResult.error }, "Email delivery issue");
        }
        if (emailResult.response) {
          store.updateJob(jobId, { emailResponse: emailResult.response });
          log.info({ response: emailResult.response }, "Email resend response");
        }
      } catch (emailErr) {
        log.error({ err: emailErr }, "Email send failed");
        store.updateJob(jobId, { emailStatus: "failed", emailError: emailErr.message });
      }
    } else {
      store.updateJob(jobId, { emailStatus: "skipped" });
      log.info("No recipient email provided — skipping send");
    }

    // D2: Record crawl metrics with per-model token breakdown
    // Haiku: $1/MTok in, $5/MTok out; Sonnet: $3/MTok in, $15/MTok out
    // 1 USD = 92.96 INR (RBI rate 2026-04-07)
    const USD_TO_INR = 92.96;

    // 2026-04-26 (Phase E7): the crawler's V18 agent-loop returns
    // `crawlResult.costUsd` from the budget tracker — that's the
    // authoritative classifier+escalation cost. Previously this code
    // tried to derive crawl-phase cost from `stats.tokenUsage` which is
    // hardcoded zero (per agent-loop comment "per-model breakdown lives
    // in budget"). Result: total job cost reported $0.10 when actual was
    // $0.97. Use crawlResult.costUsd directly + per-stage tokens for the
    // post-crawl phases.

    const crawlPhaseCost = Number(crawlResult.costUsd) || 0;
    const stage1CostUsd = stage1Tokens.input_tokens * 0.000001 + stage1Tokens.output_tokens * 0.000005;
    const stage2CostUsd = stage2Tokens.input_tokens * 0.000001 + stage2Tokens.output_tokens * 0.000005;

    // V2 synthesizer Sonnet tokens (separate from annotation tokens which
    // were just folded back into sonnetTokensAccum). We track V2 by
    // subtracting annotation tokens from the total accumulator.
    const annotationsTokens = annotationsResult?.tokenUsage || { input_tokens: 0, output_tokens: 0 };
    const v2SynthTokens = {
      input_tokens: Math.max(0, sonnetTokensAccum.input_tokens - (annotationsTokens.input_tokens || 0)),
      output_tokens: Math.max(0, sonnetTokensAccum.output_tokens - (annotationsTokens.output_tokens || 0)),
    };
    // After Phase E3 annotations run on Haiku — but the runner doesn't
    // know that here. Compute both rates and use whichever the model
    // declared. Default to Haiku rates since E3 + Sonnet rates as fallback.
    const annotationCostUsd = annotationsTokens.input_tokens
      ? annotationsTokens.input_tokens * 0.000001 + annotationsTokens.output_tokens * 0.000005
      : 0;
    const v2SynthCostUsd = v2SynthTokens.input_tokens * 0.000003 + v2SynthTokens.output_tokens * 0.000015;
    const sonnetCost = v2SynthCostUsd + annotationCostUsd;

    const costUsd = crawlPhaseCost + stage1CostUsd + stage2CostUsd + sonnetCost;
    const costInr = costUsd * USD_TO_INR;

    const costBreakdown = {
      crawlHaiku: Number(crawlPhaseCost.toFixed(6)),
      oracleStage1: Number(stage1CostUsd.toFixed(6)),
      oracleStage2: Number(stage2CostUsd.toFixed(6)),
      reportSynthesis: Number(v2SynthCostUsd.toFixed(6)),
      annotations: Number(annotationCostUsd.toFixed(6)),
      totalUsd: Number(costUsd.toFixed(6)),
      totalInr: Number(costInr.toFixed(2)),
    };

    const finalJob = store.getJob(jobId);
    const finalStatus = finalJob.crawlQuality === "degraded" ? "degraded" : "complete";
    // D4 (Phase 7): persist cost_usd to the dedicated column so admin rollups
    // can sum across users without parsing the JSON blob.
    store.updateJob(jobId, { status: finalStatus, costUsd, costBreakdown });

    metrics.recordCrawl({
      stopReason: crawlResult.stopReason || "complete",
      durationMs: Date.now() - crawlStartTime,
      uniqueScreens: screenshots.length,
      visionCalls: (crawlResult.stats || {}).visionCalls || 0,
      recoveryAttempts: (crawlResult.stats || {}).recoveryAttempts || 0,
      costInr,
      haikuTokens: haikuTokensAccum,
      sonnetTokens: sonnetTokensAccum,
    });

    // D4: Alert on consecutive failures
    const metricsSummary = metrics.summary();
    if (metricsSummary.consecutiveFailures >= 3) {
      alertConsecutiveFailures(metricsSummary.consecutiveFailures);
    }

    // E6: Don't kill emulator — warm reset at next job start saves 15-240s
    // Store package name for next job's cleanup
    processJob._lastPackage = appProfile.packageName || null;
    try { fs.unlinkSync(apkPath); } catch (e) {}
  } catch (err) {
    log.error({ err }, "Job failed with uncaught exception");
    // Classify known failure modes into the structured api-errors shape so
    // the frontend can show a sensible message + retry hint instead of a
    // raw stack trace. Unknown errors still write `error.message` for ops.
    const msg = String(err && err.message || "");
    let errorDetails = null;
    if (/crawl timeout exceeded|crawl exceeded.*limit|timeout/i.test(msg)) {
      errorDetails = apiError("JOB_TIMEOUT");
    } else if (/no idle emulators|emulator.*unavailable|emulator.*not.*found/i.test(msg)) {
      errorDetails = apiError("EMULATOR_UNAVAILABLE");
    }
    store.updateJob(jobId, {
      status: "failed",
      error: err.message,
      costUsd: 0,
      ...(errorDetails ? { errorDetails } : {}),
    });
    metrics.recordCrawl({
      stopReason: "uncaught_exception",
      durationMs: Date.now() - crawlStartTime,
      uniqueScreens: 0,
      visionCalls: 0,
      recoveryAttempts: 0,
      costInr: 0,
    });
    alertJobFailed(jobId, "uncaught_exception", err.message);
    // Code-side fault — uncaught exception. Refund.
    await refundIfCodeSideFault(jobId, "uncaught_exception:" + err.message, log);
    killEmulator();
  } finally {
    // Reset serial targeting after job completes
    if (opts.serial) {
      adb.setSerial(null);
    }
  }
}

// ---------------------------------------------------------------------------
// Legacy crawl (preserved behind USE_CRAWLER_V1=false flag)
// ---------------------------------------------------------------------------

async function legacyCrawl(jobId, screenshotDir) {
  throw new Error("Legacy crawl is disabled in this VM build. Use crawler v1.");
}

module.exports = { processJob };
