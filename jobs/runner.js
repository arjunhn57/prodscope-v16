"use strict";

require("dotenv").config();
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const store = require("./store");
const { bootEmulator, installApk, killEmulator, resetEmulator } = require("../emulator/manager");
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

const { runAgentLoop } = require("../crawler/v16/agent-loop");
const { parseApk } = require("../ingestion/manifest-parser");
const { assessCompatibility } = require("../lib/app-compatibility");
const adb = require("../crawler/adb");

// Oracle pipeline (Week 4)
const { triageForAI } = require("../oracle/triage");
const { analyzeTriagedScreens } = require("../oracle/ai-oracle");
const { buildReport } = require("../output/report-builder");
const { renderReportEmail } = require("../output/email-renderer");

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

      // Launch app using launcher activity from manifest, or monkey fallback
      try {
        if (appProfile.launcherActivity) {
          execSync(
            `adb shell am start -n ${packageName}/${appProfile.launcherActivity}`,
          );
        } else {
          execSync(
            "adb shell monkey -p " +
              packageName +
              " -c android.intent.category.LAUNCHER 1",
          );
        }
      } catch (e) {
        log.error({ err: e }, "Could not launch app");
      }

      await sleep(3000);

      if (CRAWL_ENGINE !== "v16") {
        throw new Error(
          `V15 engine has been archived. Set CRAWL_ENGINE=v16 (current: ${CRAWL_ENGINE}). ` +
            `V15 sources are preserved at crawler/_v15-archive/ for rollback.`,
        );
      }
      const crawlPromise = runAgentLoop({
        jobId,
        targetPackage: packageName,
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
      store.updateJob(jobId, {
        step: 6,
        emailStatus: "skipped_test_mode",
        status: updatedJob.crawlQuality === "degraded" ? "degraded" : "complete",
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
    let triageResult = { screensToAnalyze: [], skippedScreens: [], triageLog: [] };
    let analyses = [];
    let report = null;

    try {
      // 4a: Triage — select max 8 screens for AI analysis
      triageResult = triageForAI(
        crawlResult.screens || [],
        crawlResult.oracleFindingsByStep || {},
        crawlResult.coverage || {},
      );
      log.info({ selected: triageResult.screensToAnalyze.length, skipped: triageResult.skippedScreens.length }, "Triage complete");

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

      // Step 5: Structured report (1 Sonnet LLM call)
      store.updateJob(jobId, { step: 5 });

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

    // Add crawl-phase tokens (vision + planner = all Haiku) to Haiku accumulator
    const crawlPhaseTokens = (crawlResult.stats || {}).tokenUsage || { input_tokens: 0, output_tokens: 0 };
    haikuTokensAccum.input_tokens += crawlPhaseTokens.input_tokens;
    haikuTokensAccum.output_tokens += crawlPhaseTokens.output_tokens;

    const haikuCost = (haikuTokensAccum.input_tokens * 0.000001 + haikuTokensAccum.output_tokens * 0.000005);
    const sonnetCost = (sonnetTokensAccum.input_tokens * 0.000003 + sonnetTokensAccum.output_tokens * 0.000015);
    const costUsd = haikuCost + sonnetCost;
    const costInr = costUsd * USD_TO_INR;

    const finalJob = store.getJob(jobId);
    const finalStatus = finalJob.crawlQuality === "degraded" ? "degraded" : "complete";
    // D4 (Phase 7): persist cost_usd to the dedicated column so admin rollups
    // can sum across users without parsing the JSON blob.
    store.updateJob(jobId, { status: finalStatus, costUsd });

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
    store.updateJob(jobId, { status: "failed", error: err.message, costUsd: 0 });
    metrics.recordCrawl({
      stopReason: "uncaught_exception",
      durationMs: Date.now() - crawlStartTime,
      uniqueScreens: 0,
      visionCalls: 0,
      recoveryAttempts: 0,
      costInr: 0,
    });
    alertJobFailed(jobId, "uncaught_exception", err.message);
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
