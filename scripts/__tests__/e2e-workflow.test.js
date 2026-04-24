"use strict";

/**
 * e2e-workflow.test.js — structural guard over the E2E GitHub Actions
 * workflow. Not a full YAML parser; just pins the critical strings so
 * someone editing the workflow can't silently drop the emulator action,
 * kill the artifact upload, or break the trigger paths.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const WORKFLOW_PATH = path.resolve(__dirname, "..", "..", ".github", "workflows", "e2e.yml");
const SMOKE_PATH = path.resolve(__dirname, "..", "e2e-smoke.js");

test(".github/workflows/e2e.yml exists", () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH), "workflow file must exist at .github/workflows/e2e.yml");
});

test("e2e.yml uses reactivecircus/android-emulator-runner@v2", () => {
  const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(
    content,
    /reactivecircus\/android-emulator-runner@v2/,
    "workflow must use reactivecircus/android-emulator-runner@v2 (the free emulator action)",
  );
});

test("e2e.yml uploads artifacts via actions/upload-artifact@v4", () => {
  const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(
    content,
    /actions\/upload-artifact@v4/,
    "workflow must upload smoke artifacts on every run",
  );
});

test("e2e.yml triggers on pull_request and workflow_dispatch", () => {
  const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(content, /pull_request:/);
  assert.match(content, /workflow_dispatch:/);
});

test("e2e.yml runs scripts/e2e-smoke.js", () => {
  const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(
    content,
    /node scripts\/e2e-smoke\.js/,
    "workflow must invoke the pinned smoke script",
  );
});

test("e2e.yml passes ANTHROPIC_API_KEY from secrets", () => {
  const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(
    content,
    /ANTHROPIC_API_KEY:\s*\$\{\{\s*secrets\.ANTHROPIC_API_KEY\s*\}\}/,
    "workflow must thread ANTHROPIC_API_KEY as a secret, never inline",
  );
});

test("scripts/e2e-smoke.js exists, is parseable Node, and has a shebang", () => {
  assert.ok(fs.existsSync(SMOKE_PATH), "smoke script must exist");
  const content = fs.readFileSync(SMOKE_PATH, "utf8");
  assert.ok(content.startsWith("#!/usr/bin/env node"), "smoke script must start with a Node shebang");
  // Parseability check: require() without executing main() thanks to the
  // require.main === module guard at the bottom of the script.
  assert.doesNotThrow(() => {
    // Defensive: isolate the require in case it has side effects on first load.
    delete require.cache[require.resolve("../e2e-smoke")];
    require("../e2e-smoke");
  });
});

test("e2e.yml timeout is bounded — no runaway jobs", () => {
  const content = fs.readFileSync(WORKFLOW_PATH, "utf8");
  assert.match(
    content,
    /timeout-minutes:\s*\d+/,
    "workflow jobs must have an explicit timeout",
  );
});
