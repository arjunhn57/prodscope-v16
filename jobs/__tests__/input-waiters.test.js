"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs");

// Isolate the test DB so we don't touch real data. Must happen before loading
// store.js since DB_PATH is resolved at import time.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prodscope-input-waiters-"));
process.env.DB_PATH = path.join(tmpDir, "test.sqlite");

const {
  awaitJobInput,
  resolveJobInput,
  rejectJobInput,
  hasPendingInput,
} = require("../store");

test("resolveJobInput unblocks a pending waiter with the submitted value", async () => {
  const p = awaitJobInput("job-a", { timeoutMs: 1000 });
  assert.equal(hasPendingInput("job-a"), true);
  const ok = resolveJobInput("job-a", "123456");
  assert.equal(ok, true);
  const value = await p;
  assert.equal(value, "123456");
  assert.equal(hasPendingInput("job-a"), false);
});

test("resolveJobInput returns false when no waiter exists", () => {
  assert.equal(resolveJobInput("no-such-job", "x"), false);
});

test("rejectJobInput rejects waiter with custom reason", async () => {
  const p = awaitJobInput("job-b", { timeoutMs: 1000 });
  const ok = rejectJobInput("job-b", "INPUT_CANCELLED");
  assert.equal(ok, true);
  await assert.rejects(p, (err) => err.message === "INPUT_CANCELLED");
  assert.equal(hasPendingInput("job-b"), false);
});

test("awaitJobInput rejects with INPUT_TIMEOUT when no resolver arrives", async () => {
  const p = awaitJobInput("job-c", { timeoutMs: 30 });
  await assert.rejects(p, (err) => err.message === "INPUT_TIMEOUT");
  assert.equal(hasPendingInput("job-c"), false);
});

test("second awaitJobInput for same job supersedes the first waiter", async () => {
  const p1 = awaitJobInput("job-d", { timeoutMs: 1000 });
  const p2 = awaitJobInput("job-d", { timeoutMs: 1000 });
  await assert.rejects(p1, (err) => err.message === "INPUT_SUPERSEDED");
  resolveJobInput("job-d", "second-win");
  assert.equal(await p2, "second-win");
});

test("waiters for different jobs are isolated", async () => {
  const p1 = awaitJobInput("job-e1", { timeoutMs: 1000 });
  const p2 = awaitJobInput("job-e2", { timeoutMs: 1000 });
  assert.equal(resolveJobInput("job-e2", "value-2"), true);
  assert.equal(await p2, "value-2");
  assert.equal(hasPendingInput("job-e1"), true);
  resolveJobInput("job-e1", "value-1");
  assert.equal(await p1, "value-1");
});

test("resolveJobInput after timeout does not double-resolve", async () => {
  const p = awaitJobInput("job-f", { timeoutMs: 20 });
  await assert.rejects(p, (err) => err.message === "INPUT_TIMEOUT");
  assert.equal(resolveJobInput("job-f", "late"), false);
});
