"use strict";
/**
 * crawl-cli-v2.cjs — Direct-invoke CLI for V1/V2 comparison crawls.
 *
 * Usage:
 *   TEST_EMAIL=... TEST_PASSWORD=... \
 *   AGENT_LOOP=true AGENT_VISION_FIRST=true \
 *   node crawl-cli-v2.cjs <package.name> [maxSteps]
 *
 * Writes a labelled artifact dir under ./test-artifacts/ and prints a
 * machine-parseable summary line at the end (`=== CRAWL COMPLETE ===`).
 */

const path = require("path");
const fs = require("fs");
const { runCrawl } = require("./crawler/run.js");

async function main() {
  const packageName = process.argv[2];
  const maxSteps = parseInt(process.argv[3] || process.env.MAX_STEPS || "50", 10);

  if (!packageName) {
    console.error("Usage: node crawl-cli-v2.cjs <package.name> [maxSteps]");
    console.error("Env: TEST_EMAIL, TEST_PASSWORD, AGENT_LOOP, AGENT_VISION_FIRST");
    process.exit(1);
  }

  const label = process.env.AGENT_VISION_FIRST === "true" ? "v2" : "v1";
  const ts = Date.now();
  const screenshotDir = path.join(__dirname, "test-artifacts", packageName + "-" + label + "-" + ts);
  fs.mkdirSync(screenshotDir, { recursive: true });

  const credentials = {};
  if (process.env.TEST_EMAIL) credentials.email = process.env.TEST_EMAIL;
  if (process.env.TEST_PASSWORD) credentials.password = process.env.TEST_PASSWORD;

  console.log("[cli-v2] pkg=" + packageName + " mode=" + label + " maxSteps=" + maxSteps + " creds=" + (credentials.email ? "yes" : "no"));
  console.log("[cli-v2] artifactDir=" + screenshotDir);
  console.log("[cli-v2] env: AGENT_LOOP=" + (process.env.AGENT_LOOP || "") + " AGENT_VISION_FIRST=" + (process.env.AGENT_VISION_FIRST || ""));

  const startedAt = Date.now();
  try {
    const result = await runCrawl({
      screenshotDir,
      packageName,
      maxSteps,
      appProfile: { packageName, activities: [], permissions: [], appName: packageName },
      credentials,
      goldenPath: "",
      goals: "Explore the app and discover its main features",
      painPoints: "",
      onProgress: (s) => { if (s && s.message) console.log("[Stream] " + s.message); },
    });
    const elapsedMs = Date.now() - startedAt;

    console.log("\n=== CRAWL COMPLETE ===");
    console.log("wall_time_ms=" + elapsedMs);
    console.log("wall_time_min=" + (elapsedMs / 60000).toFixed(2));
    console.log("unique_states=" + (result && result.stats ? result.stats.uniqueStates : "?"));
    console.log("total_steps=" + (result && result.stats ? result.stats.totalSteps : "?"));
    console.log("stop_reason=" + (result && result.stopReason ? result.stopReason : "?"));
    console.log("result_keys=" + (result ? Object.keys(result).join(",") : "null"));
    if (result && result.v2Coverage) {
      console.log("v2_coverage=" + JSON.stringify(result.v2Coverage));
    }
    if (result && result.coverage) {
      console.log("coverage=" + JSON.stringify(result.coverage));
    }
    console.log("artifactDir=" + screenshotDir);
    process.exit(0);
  } catch (err) {
    console.error("\n=== CRAWL FAILED ===");
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

main();
