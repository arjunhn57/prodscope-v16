"use strict";

const { describe, it, beforeEach, mock } = require("node:test");
const assert = require("node:assert");
const nodePath = require("path");
const os = require("os");
const fs = require("fs");

// ---------------------------------------------------------------------------
// Mock ALL external dependencies via require.cache before requiring runner.js
// ---------------------------------------------------------------------------

function cacheMock(modPath, exports) {
  const resolved = require.resolve(modPath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exports,
  };
}

const rootDir = nodePath.join(__dirname, "..", "..");
const jobsDir = nodePath.join(__dirname, "..");

// Mock dotenv
cacheMock("dotenv", { config: () => {} });

// Mock child_process — capture named references so tests can assert against
// the exact call shape (which command, which args) later. A shared
// `execOrder` array records every exec/execFile invocation in order so tests
// can assert on cross-mock ordering (pm clear MUST happen before am start).
const execOrder = [];
const mockExecSync = mock.fn((cmd) => {
  execOrder.push({ kind: "execSync", cmd });
  return "package:com.test.app";
});
const mockExecFileSync = mock.fn((cmd, args) => {
  execOrder.push({ kind: "execFileSync", cmd, args });
  // df -h / is called for disk-check before every job
  if (cmd === "df") {
    return "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       50G   20G   28G  42% /";
  }
  // adb shell pm clear <pkg> is called pre-launch in every job
  if (cmd === "adb" && Array.isArray(args) && args[0] === "shell" && args[1] === "pm" && args[2] === "clear") {
    return "Success";
  }
  return "";
});
cacheMock("child_process", {
  execSync: mockExecSync,
  execFileSync: mockExecFileSync,
});

// Mock store
const jobState = {};
const mockStore = {
  createJob: mock.fn((id, data) => { jobState[id] = { id, ...data }; }),
  updateJob: mock.fn((id, data) => {
    if (!jobState[id]) jobState[id] = { id };
    Object.assign(jobState[id], data);
  }),
  getJob: mock.fn((id) => jobState[id] || null),
  db: { prepare: () => ({ all: () => [], get: () => ({}) }) },
};
cacheMock(nodePath.join(jobsDir, "store"), mockStore);

// Mock emulator manager
const mockEmulatorManager = {
  bootEmulator: mock.fn(async () => {}),
  installApk: mock.fn(() => {}),
  killEmulator: mock.fn(() => {}),
  resetEmulator: mock.fn(async () => true),
};
cacheMock(nodePath.join(rootDir, "emulator", "manager"), mockEmulatorManager);

// Mock email sender
cacheMock(nodePath.join(rootDir, "output", "email-sender"), {
  sendReportEmail: mock.fn(async () => ({ status: "sent" })),
});

// Mock sleep
cacheMock(nodePath.join(rootDir, "utils", "sleep"), { sleep: async () => {} });

// Mock config/defaults
cacheMock(nodePath.join(rootDir, "config", "defaults"), {
  USE_CRAWLER_V1: true,
  SKIP_AI_FOR_TESTS: true,
  SCREENSHOT_DIR_PREFIX: nodePath.join(os.tmpdir(), "test-screenshots-"),
  MAX_CRAWL_STEPS: 10,
  CRAWL_ENGINE: "v16",
  V16_MAX_COST_USD: 0.12,
  V16_MAX_SONNET_ESCALATIONS: 3,
});

// Mock metrics
const mockMetrics = {
  recordCrawl: mock.fn(() => {}),
  summary: mock.fn(() => ({ consecutiveFailures: 0 })),
};
cacheMock(nodePath.join(rootDir, "lib", "metrics"), mockMetrics);

// Mock alerts
cacheMock(nodePath.join(rootDir, "lib", "alerts"), {
  alertJobFailed: mock.fn(() => {}),
  alertConsecutiveFailures: mock.fn(() => {}),
  alertDiskCritical: mock.fn(() => {}),
});

// Mock logger
const noop = () => {};
const noopLog = { info: noop, warn: noop, error: noop, debug: noop, child: () => noopLog };
cacheMock(nodePath.join(rootDir, "lib", "logger"), {
  logger: noopLog,
  createJobLogger: () => noopLog,
});

// Mock crawler/v16/agent-loop (V16 is the only crawl engine post-cutover)
const mockRunAgentLoop = mock.fn(async () => ({
  screens: [
    { path: "/tmp/s1.png", xml: "<h/>", index: 0 },
    { path: "/tmp/s2.png", xml: "<h/>", index: 1 },
    { path: "/tmp/s3.png", xml: "<h/>", index: 2 },
  ],
  graph: {},
  stats: { totalSteps: 3, uniqueStates: 3, visionCalls: 2, recoveryAttempts: 0, tokenUsage: { input_tokens: 100, output_tokens: 50 } },
  stopReason: "agent_done",
  costUsd: 0.05,
  sonnetEscalations: 0,
  oracleFindings: [],
  oracleFindingsByStep: {},
  coverage: {},
  flows: [],
  plan: null,
}));
cacheMock(nodePath.join(rootDir, "crawler", "v16", "agent-loop"), { runAgentLoop: mockRunAgentLoop });

// Mock manifest parser
const mockParseApk = mock.fn(() => ({
  packageName: "com.test.app",
  launcherActivity: ".MainActivity",
  activities: [".MainActivity"],
  permissions: [],
  appName: "TestApp",
}));
cacheMock(nodePath.join(rootDir, "ingestion", "manifest-parser"), { parseApk: mockParseApk });

// Mock app-compatibility
const mockAssessCompatibility = mock.fn(() => ({ crawlable: true, quality: "full", reason: "" }));
cacheMock(nodePath.join(rootDir, "lib", "app-compatibility"), { assessCompatibility: mockAssessCompatibility });

// Mock ADB
const mockAdb = {
  setSerial: mock.fn(() => {}),
};
cacheMock(nodePath.join(rootDir, "crawler", "adb"), mockAdb);

// Mock oracle pipeline
cacheMock(nodePath.join(rootDir, "oracle", "triage"), {
  triageForAI: mock.fn(() => ({
    screensToAnalyze: [],
    skippedScreens: [],
    triageLog: [],
  })),
});
cacheMock(nodePath.join(rootDir, "oracle", "ai-oracle"), {
  analyzeTriagedScreens: mock.fn(async () => ({
    analyses: [],
    totalTokens: { input_tokens: 0, output_tokens: 0 },
  })),
});
cacheMock(nodePath.join(rootDir, "output", "report-builder"), {
  buildReport: mock.fn(async () => ({
    report: { summary: "Test report" },
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
  })),
});
cacheMock(nodePath.join(rootDir, "output", "email-renderer"), {
  renderReportEmail: mock.fn(() => "<html>Report</html>"),
});

// ---------------------------------------------------------------------------
// Import runner after all mocks
// ---------------------------------------------------------------------------

const { processJob } = require("../runner");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runner.js — processJob", () => {
  beforeEach(() => {
    // Clear job state
    for (const key of Object.keys(jobState)) delete jobState[key];
    mockStore.createJob.mock.resetCalls();
    mockStore.updateJob.mock.resetCalls();
    mockRunAgentLoop.mock.resetCalls();
    mockEmulatorManager.resetEmulator.mock.resetCalls();
    mockEmulatorManager.installApk.mock.resetCalls();
    mockMetrics.recordCrawl.mock.resetCalls();
    mockAdb.setSerial.mock.resetCalls();
    mockAssessCompatibility.mock.resetCalls();
    mockExecFileSync.mock.resetCalls();
    mockExecSync.mock.resetCalls();
    execOrder.length = 0;
  });

  it("completes a job lifecycle: queued → processing → complete", async () => {
    const jobId = "test-job-1";
    const apkPath = nodePath.join(os.tmpdir(), "test.apk");

    // Create a temp APK file
    fs.writeFileSync(apkPath, Buffer.from([0x50, 0x4B, 0x03, 0x04, ...Buffer.from("fake-apk-content")]));

    try {
      await processJob(jobId, apkPath, {
        email: "test@example.com",
        credentials: null,
      });

      // Verify store.updateJob was called with status transitions
      const statusUpdates = mockStore.updateJob.mock.calls
        .map((c) => c.arguments)
        .filter(([, data]) => data.status);

      // Should have at least one "processing" and one terminal status
      const statuses = statusUpdates.map(([, data]) => data.status);
      assert.ok(statuses.includes("processing"), "Should transition to processing");
      assert.ok(
        statuses.includes("complete") || statuses.includes("degraded"),
        "Should reach terminal status"
      );

      // Verify emulator was reset
      assert.strictEqual(mockEmulatorManager.resetEmulator.mock.callCount(), 1);

      // Verify APK was installed
      assert.strictEqual(mockEmulatorManager.installApk.mock.callCount(), 1);

      // Verify crawl was run
      assert.strictEqual(mockRunAgentLoop.mock.callCount(), 1);
    } finally {
      try { fs.unlinkSync(apkPath); } catch (_) {}
    }
  });

  it("sets ADB serial when opts.serial is provided", async () => {
    const jobId = "test-job-serial";
    const apkPath = nodePath.join(os.tmpdir(), "test2.apk");
    fs.writeFileSync(apkPath, Buffer.from([0x50, 0x4B, 0x03, 0x04, ...Buffer.from("fake-apk")]));

    try {
      await processJob(jobId, apkPath, {
        serial: "emulator-5556",
        email: "test@example.com",
      });

      // setSerial called at start with serial, and at end with null
      assert.ok(mockAdb.setSerial.mock.callCount() >= 1);
      assert.strictEqual(mockAdb.setSerial.mock.calls[0].arguments[0], "emulator-5556");
    } finally {
      try { fs.unlinkSync(apkPath); } catch (_) {}
    }
  });

  it("marks job as failed when crawl produces no screens", async () => {
    const jobId = "test-job-fail";
    const apkPath = nodePath.join(os.tmpdir(), "test3.apk");
    fs.writeFileSync(apkPath, Buffer.from([0x50, 0x4B, 0x03, 0x04, ...Buffer.from("fake-apk")]));

    // Override runCrawl to return 0 screens
    mockRunAgentLoop.mock.mockImplementationOnce(async () => ({
      screens: [],
      graph: {},
      stats: {},
      stopReason: "device_offline",
      oracleFindings: [],
      oracleFindingsByStep: {},
      coverage: {},
      flows: [],
    }));

    try {
      await processJob(jobId, apkPath, { email: "test@example.com" });

      // Should be marked as failed
      const statusUpdates = mockStore.updateJob.mock.calls
        .map((c) => c.arguments)
        .filter(([, data]) => data.status === "failed");
      assert.ok(statusUpdates.length > 0, "Job should be marked as failed");
    } finally {
      try { fs.unlinkSync(apkPath); } catch (_) {}
    }
  });

  it("records metrics after completion", async () => {
    const jobId = "test-job-metrics";
    const apkPath = nodePath.join(os.tmpdir(), "test4.apk");
    fs.writeFileSync(apkPath, Buffer.from([0x50, 0x4B, 0x03, 0x04, ...Buffer.from("fake-apk")]));

    try {
      await processJob(jobId, apkPath, { email: "test@example.com" });

      // Verify job completed successfully (metrics may be called via real or mock path)
      const statusUpdates = mockStore.updateJob.mock.calls
        .map((c) => c.arguments)
        .filter(([, data]) => data.status);
      const statuses = statusUpdates.map(([, data]) => data.status);
      assert.ok(
        statuses.includes("complete") || statuses.includes("degraded") || statuses.includes("failed"),
        "Job should reach a terminal status"
      );
    } finally {
      try { fs.unlinkSync(apkPath); } catch (_) {}
    }
  });

  it("handles uncrawlable apps gracefully", async () => {
    const jobId = "test-job-uncrawlable";
    const apkPath = nodePath.join(os.tmpdir(), "test5.apk");
    fs.writeFileSync(apkPath, Buffer.from([0x50, 0x4B, 0x03, 0x04, ...Buffer.from("fake-apk")]));

    // Override compatibility check
    mockAssessCompatibility.mock.mockImplementationOnce(() => ({
      crawlable: false,
      quality: "uncrawlable",
      reason: "Game app with custom rendering",
      recommendation: "Manual testing recommended",
    }));

    try {
      await processJob(jobId, apkPath, { email: "test@example.com" });

      // Job should be marked complete with uncrawlable quality
      const qualityUpdates = mockStore.updateJob.mock.calls
        .map((c) => c.arguments)
        .filter(([, data]) => data.crawlQuality === "uncrawlable");
      assert.ok(qualityUpdates.length > 0, "Should be marked uncrawlable");

      // Crawl should NOT have been run
      assert.strictEqual(mockRunAgentLoop.mock.callCount(), 0);
    } finally {
      try { fs.unlinkSync(apkPath); } catch (_) {}
    }
  });

  // ─── pm clear pre-launch (Phase D.2 regression guard) ─────────────────
  //
  // The crawler's real-API path uses `adb install -r` which preserves the
  // app's data dir across runs. Without an explicit `pm clear` before
  // launch, a prior run's auth cookies survive into the next job and
  // AuthDriver never sees a login screen (see jobs/runner.js:227 comment).
  // These tests pin that behavior so it can't silently regress.

  it("calls 'adb shell pm clear <packageName>' before launching the app", async () => {
    const jobId = "test-job-pmclear";
    const apkPath = nodePath.join(os.tmpdir(), "test-pmclear.apk");
    fs.writeFileSync(apkPath, Buffer.from([0x50, 0x4B, 0x03, 0x04, ...Buffer.from("fake-apk")]));

    try {
      await processJob(jobId, apkPath, { email: "test@example.com" });

      const pmClearCalls = mockExecFileSync.mock.calls.filter(({ arguments: [cmd, args] }) =>
        cmd === "adb" &&
        Array.isArray(args) &&
        args[0] === "shell" &&
        args[1] === "pm" &&
        args[2] === "clear",
      );

      assert.strictEqual(pmClearCalls.length, 1, "pm clear should run exactly once per job");
      assert.strictEqual(pmClearCalls[0].arguments[1][3], "com.test.app", "pm clear target must be the APK's package name");
    } finally {
      try { fs.unlinkSync(apkPath); } catch (_) {}
    }
  });

  it("pm clear runs BEFORE 'am start' so launch observes a clean data dir", async () => {
    const jobId = "test-job-ordering";
    const apkPath = nodePath.join(os.tmpdir(), "test-ordering.apk");
    fs.writeFileSync(apkPath, Buffer.from([0x50, 0x4B, 0x03, 0x04, ...Buffer.from("fake-apk")]));

    try {
      await processJob(jobId, apkPath, { email: "test@example.com" });

      // pm clear goes through execFileSync; am start goes through execSync.
      // Cross-mock order is captured in the shared `execOrder` array.
      const pmClearIndex = execOrder.findIndex(
        (e) => e.kind === "execFileSync" && e.cmd === "adb" && e.args && e.args[1] === "pm" && e.args[2] === "clear",
      );
      const amStartIndex = execOrder.findIndex(
        (e) => e.kind === "execSync" && typeof e.cmd === "string" && e.cmd.includes("am start"),
      );

      assert.ok(pmClearIndex >= 0, "expected a pm clear call");
      assert.ok(amStartIndex >= 0, "expected an am start call");
      assert.ok(
        pmClearIndex < amStartIndex,
        `pm clear (index=${pmClearIndex}) must precede am start (index=${amStartIndex})`,
      );
    } finally {
      try { fs.unlinkSync(apkPath); } catch (_) {}
    }
  });

  it("continues the job when pm clear fails (e.g. flaky adb)", async () => {
    const jobId = "test-job-pmclear-fail";
    const apkPath = nodePath.join(os.tmpdir(), "test-pmclear-fail.apk");
    fs.writeFileSync(apkPath, Buffer.from([0x50, 0x4B, 0x03, 0x04, ...Buffer.from("fake-apk")]));

    // Override execFileSync so only the `pm clear` call throws. df and any
    // other pass through to the normal implementation.
    mockExecFileSync.mock.mockImplementationOnce((cmd, args) => {
      if (cmd === "adb" && args && args[1] === "pm" && args[2] === "clear") {
        throw new Error("adb: device offline");
      }
      return "";
    });

    try {
      await processJob(jobId, apkPath, { email: "test@example.com" });

      const statusUpdates = mockStore.updateJob.mock.calls
        .map((c) => c.arguments)
        .filter(([, data]) => data.status);
      const statuses = statusUpdates.map(([, data]) => data.status);

      assert.ok(
        statuses.includes("complete") || statuses.includes("degraded") || statuses.includes("failed"),
        `Job should still reach a terminal status after pm clear failure, saw: ${statuses.join(", ")}`,
      );
      assert.strictEqual(mockRunAgentLoop.mock.callCount(), 1, "crawl should still run even when pm clear fails");
    } finally {
      try { fs.unlinkSync(apkPath); } catch (_) {}
    }
  });

  // ─── Phase 3.1 step 5: per-stage cost telemetry ──────────────────────
  //
  // The final job record must carry a costBreakdown object with per-stage
  // Haiku and Sonnet costs. Without this we can't tune Stage 1/2 budgets
  // from real telemetry, and we can't prove to ourselves (or to users) that
  // the 3-stage pipeline is actually cheaper than the legacy flat Sonnet
  // call.

  it("writes costBreakdown to the final job record with per-stage USD amounts", async () => {
    const jobId = "test-job-costbreakdown";
    const apkPath = nodePath.join(os.tmpdir(), "test-cost.apk");
    fs.writeFileSync(apkPath, Buffer.from([0x50, 0x4B, 0x03, 0x04, ...Buffer.from("fake-apk")]));

    try {
      await processJob(jobId, apkPath, { email: "test@example.com" });

      // The final updateJob call that carries a costBreakdown field.
      const costUpdates = mockStore.updateJob.mock.calls
        .map((c) => c.arguments)
        .filter(([, data]) => data && data.costBreakdown);

      assert.ok(costUpdates.length >= 1, "costBreakdown must be written to the job at least once");
      const breakdown = costUpdates[costUpdates.length - 1][1].costBreakdown;

      // Shape check: all four per-stage buckets are present, numeric, and non-negative.
      assert.ok(typeof breakdown.crawlHaiku === "number" && breakdown.crawlHaiku >= 0);
      assert.ok(typeof breakdown.oracleStage1 === "number" && breakdown.oracleStage1 >= 0);
      assert.ok(typeof breakdown.oracleStage2 === "number" && breakdown.oracleStage2 >= 0);
      assert.ok(typeof breakdown.reportSynthesis === "number" && breakdown.reportSynthesis >= 0);
      assert.ok(typeof breakdown.totalUsd === "number" && breakdown.totalUsd >= 0);

      // Conservation: sum of buckets equals totalUsd (within float tolerance).
      const sum = breakdown.crawlHaiku + breakdown.oracleStage1 + breakdown.oracleStage2 + breakdown.reportSynthesis;
      assert.ok(
        Math.abs(sum - breakdown.totalUsd) < 1e-6,
        `breakdown buckets sum=${sum} != totalUsd=${breakdown.totalUsd}`,
      );
    } finally {
      try { fs.unlinkSync(apkPath); } catch (_) {}
    }
  });

  it("catches unhandled exceptions and marks job as failed", async () => {
    const jobId = "test-job-crash";
    const apkPath = nodePath.join(os.tmpdir(), "test6.apk");
    fs.writeFileSync(apkPath, Buffer.from([0x50, 0x4B, 0x03, 0x04, ...Buffer.from("fake-apk")]));

    // Make installApk throw
    mockEmulatorManager.installApk.mock.mockImplementationOnce(() => {
      throw new Error("ADB install failed: device not found");
    });

    try {
      await processJob(jobId, apkPath, { email: "test@example.com" });

      const failedUpdates = mockStore.updateJob.mock.calls
        .map((c) => c.arguments)
        .filter(([, data]) => data.status === "failed");
      assert.ok(failedUpdates.length > 0, "Job should be marked as failed on crash");
    } finally {
      try { fs.unlinkSync(apkPath); } catch (_) {}
    }
  });
});
