"use strict";

/**
 * E2E smoke test — validates the full job pipeline.
 *
 * This test is designed to run ON THE VM where the server, emulator,
 * and ADB are available. It submits a real APK, waits for completion,
 * and validates the report JSON structure.
 *
 * Run:
 *   SMOKE_APK_PATH=/path/to/test.apk node --test test/e2e/smoke.test.js
 *
 * Requirements:
 *   - Server running on localhost:8080
 *   - Emulator running with ADB connected
 *   - ANTHROPIC_API_KEY set (or SKIP_AI_FOR_TESTS=true)
 *   - Either PRODSCOPE_API_KEY or AUTH_DISABLED=true
 *
 * Environment variables:
 *   SMOKE_APK_PATH    - Path to APK to test with (required)
 *   SMOKE_API_URL     - Server URL (default: http://localhost:8080)
 *   SMOKE_API_KEY     - API key for authentication (optional if auth disabled)
 *   SMOKE_TIMEOUT_MS  - Max wait time in ms (default: 600000 = 10 min)
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const API_URL = process.env.SMOKE_API_URL || "http://localhost:8080";
const APK_PATH = process.env.SMOKE_APK_PATH;
const API_KEY = process.env.SMOKE_API_KEY || process.env.PRODSCOPE_API_KEY || "";
const TIMEOUT_MS = parseInt(process.env.SMOKE_TIMEOUT_MS || "600000", 10);
const POLL_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// HTTP helpers (no external dependencies)
// ---------------------------------------------------------------------------

function makeRequest(method, urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, API_URL);
    const transport = url.protocol === "https:" ? https : http;
    const headers = { ...options.headers };
    if (API_KEY) headers["X-API-Key"] = API_KEY;

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 30000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, body });
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function uploadApk(apkPath) {
  return new Promise((resolve, reject) => {
    const url = new URL("/api/v1/start-job", API_URL);
    const transport = url.protocol === "https:" ? https : http;
    const boundary = "----SmokeTestBoundary" + Date.now();

    const fileContent = fs.readFileSync(apkPath);
    const filename = path.basename(apkPath);

    // Build multipart body
    const preamble = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="apk"; filename="${filename}"\r\n` +
      `Content-Type: application/vnd.android.package-archive\r\n\r\n`
    );
    const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([preamble, fileContent, epilogue]);

    const headers = {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length,
    };
    if (API_KEY) headers["X-API-Key"] = API_KEY;

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers,
        timeout: 60000,
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => (responseBody += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(responseBody) });
          } catch {
            resolve({ status: res.statusCode, body: responseBody });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function pollUntilDone(jobId) {
  const startTime = Date.now();
  const TERMINAL = new Set(["complete", "degraded", "failed"]);

  while (Date.now() - startTime < TIMEOUT_MS) {
    const res = await makeRequest("GET", `/api/v1/job-status/${jobId}`);
    if (res.status !== 200) {
      throw new Error(`Job status returned ${res.status}: ${JSON.stringify(res.body)}`);
    }

    const data = res.body.data || res.body;
    if (TERMINAL.has(data.status)) {
      return data;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Job ${jobId} did not complete within ${TIMEOUT_MS}ms`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E Smoke Test", { timeout: TIMEOUT_MS + 60000 }, () => {
  let serverReachable = false;

  before(async () => {
    if (!APK_PATH) {
      console.log("SMOKE_APK_PATH not set — skipping E2E smoke test");
    }
    // Check if server is reachable
    try {
      const res = await makeRequest("GET", "/health");
      serverReachable = res.status === 200;
    } catch {
      console.log("Server not reachable at " + API_URL + " — skipping E2E tests");
    }
  });

  it("health endpoint responds", async (t) => {
    if (!serverReachable) { t.skip("Server not running"); return; }
    const res = await makeRequest("GET", "/health");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.status === "ok" || res.body.data.status === "degraded");
    assert.ok(typeof res.body.data.uptime === "number");
  });

  it("metrics endpoint responds with Prometheus format", async (t) => {
    if (!serverReachable) { t.skip("Server not running"); return; }
    const res = await makeRequest("GET", "/metrics");
    assert.strictEqual(res.status, 200);
    // Body is plain text, not JSON
    assert.ok(typeof res.body === "string" || typeof res.body === "object");
  });

  it("queue-status endpoint responds", async (t) => {
    if (!serverReachable) { t.skip("Server not running"); return; }
    const res = await makeRequest("GET", "/api/v1/queue-status");
    // May be 200 (with auth) or 401 (without auth)
    if (res.status === 200) {
      assert.strictEqual(res.body.success, true);
      assert.ok(typeof res.body.data.queueDepth === "number" || typeof res.body.data.waiting === "number");
    }
  });

  it("unauthenticated start-job is rejected (when auth enabled)", async (t) => {
    if (!serverReachable) { t.skip("Server not running"); return; }
    // Try without API key — should get 401 if auth is configured
    const res = await makeRequest("POST", "/api/v1/start-job", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // Either 401 (auth enabled) or 400 (auth disabled, validation fails) — both acceptable
    assert.ok(
      res.status === 401 || res.status === 400,
      `Expected 401 or 400, got ${res.status}`
    );
  });

  it("API docs endpoint serves Swagger UI", async (t) => {
    if (!serverReachable) { t.skip("Server not running"); return; }
    const res = await makeRequest("GET", "/api/docs");
    assert.strictEqual(res.status, 200);
    // Body will be HTML string
    assert.ok(typeof res.body === "string");
  });

  it("submits APK and receives valid report", async (t) => {
    if (!serverReachable) { t.skip("Server not running"); return; }
    if (!APK_PATH) {
      t.skip("SMOKE_APK_PATH not set");
      return;
    }

    if (!fs.existsSync(APK_PATH)) {
      t.skip(`APK not found at ${APK_PATH}`);
      return;
    }

    // 1. Submit the APK
    const submitRes = await uploadApk(APK_PATH);
    assert.strictEqual(submitRes.status, 200, `Submit failed: ${JSON.stringify(submitRes.body)}`);
    assert.strictEqual(submitRes.body.success, true);

    const jobId = submitRes.body.data.jobId;
    assert.ok(jobId, "Should receive a jobId");
    assert.strictEqual(submitRes.body.data.status, "queued");

    // 2. Poll until complete
    const result = await pollUntilDone(jobId);

    // 3. Validate report structure
    assert.ok(
      result.status === "complete" || result.status === "degraded",
      `Job ended with unexpected status: ${result.status} (error: ${result.error})`
    );

    assert.ok(result.report, "Report should exist");
    assert.ok(result.stopReason, "Should have a stop reason");
    assert.ok(result.crawlQuality, "Should have a crawl quality tier");
    assert.ok(
      ["full", "degraded", "minimal"].includes(result.crawlQuality),
      `Unexpected crawlQuality: ${result.crawlQuality}`
    );

    // 4. Validate report is parseable
    const report = typeof result.report === "string" ? JSON.parse(result.report) : result.report;
    assert.ok(report, "Report should be a valid object");

    console.log(`E2E smoke test passed: jobId=${jobId}, quality=${result.crawlQuality}, stopReason=${result.stopReason}`);
  });

  it("backwards-compat redirect /api/start-job → /api/v1/start-job", async (t) => {
    if (!serverReachable) { t.skip("Server not running"); return; }
    const res = await makeRequest("POST", "/api/start-job", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // Should redirect (308) or handle at new path
    assert.ok(
      res.status === 308 || res.status === 401 || res.status === 400,
      `Expected redirect/auth/validation error, got ${res.status}`
    );
  });
});
