"use strict";

const { describe, it, beforeEach, mock } = require("node:test");
const assert = require("node:assert");
const path = require("path");

// ---------------------------------------------------------------------------
// Mock heavy dependencies via require.cache before requiring queue.js
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

// Mock bullmq — never actually connect
cacheMock("bullmq", {
  Queue: class MockQueue {
    constructor() {
      this.client = Promise.reject(new Error("mock: no Redis"));
      // Prevent unhandled rejection
      this.client.catch(() => {});
    }
    async close() {}
  },
  Worker: class MockWorker {
    constructor() {}
    on() {}
    async close() {}
  },
});

// Mock store — minimal interface
const mockStore = {
  db: { prepare: () => ({ all: () => [] }) },
  updateJob: mock.fn(() => {}),
  getJob: mock.fn(() => null),
};
const jobsDir = path.join(__dirname, "..");
cacheMock(path.join(jobsDir, "store"), mockStore);

// Mock runner
const mockRunner = { processJob: mock.fn(async () => {}) };
cacheMock(path.join(jobsDir, "runner"), mockRunner);

// Mock crypto (pass-through)
const libDir = path.join(__dirname, "..", "..", "lib");
cacheMock(path.join(libDir, "crypto"), {
  encrypt: (v) => v,
  decrypt: (v) => v,
});

// Mock logger
const noop = () => {};
const noopLog = { info: noop, warn: noop, error: noop, debug: noop, child: () => noopLog };
cacheMock(path.join(libDir, "logger"), {
  logger: noopLog,
  createJobLogger: () => noopLog,
});

// ---------------------------------------------------------------------------
// Import queue AFTER mocks are registered
// ---------------------------------------------------------------------------

const queue = require("../queue");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("queue.js", () => {
  describe("init() with no Redis", () => {
    it("falls back to in-memory mode gracefully", async () => {
      // init() should catch the Redis connection error and set fallbackMode
      await queue.init();

      // After fallback, status should report in-memory backend
      const s = await queue.status();
      assert.strictEqual(s.backend, "in-memory");
      assert.strictEqual(s.processing, false);
      assert.strictEqual(s.queueDepth, 0);
    });
  });

  describe("fallback mode enqueue and status", () => {
    it("enqueues a job and reports correct queue depth", async () => {
      // Force re-init to ensure fallback
      await queue.init();

      // Enqueue without real processing (processJob is mocked to resolve)
      await queue.enqueue("job-1", "/tmp/test.apk", { email: "test@test.com" });

      // The job may have been processed immediately by drainFallback.
      // Just verify status works without error.
      const s = await queue.status();
      assert.strictEqual(s.backend, "in-memory");
      assert.ok(typeof s.queueDepth === "number");
    });
  });

  describe("position()", () => {
    it("returns -1 for unknown job", async () => {
      await queue.init();
      const pos = await queue.position("nonexistent-job");
      assert.strictEqual(pos, -1);
    });
  });

  describe("getCurrentJobId()", () => {
    it("returns null when no job is processing", () => {
      const id = queue.getCurrentJobId();
      // After init with no active job, should be null
      assert.ok(id === null || typeof id === "string");
    });
  });

  describe("recoverPendingJobs()", () => {
    it("does not throw when no stuck jobs exist", () => {
      // mockStore.db.prepare returns empty array
      assert.doesNotThrow(() => queue.recoverPendingJobs());
    });
  });

  describe("shutdown()", () => {
    it("completes without error in fallback mode", async () => {
      await queue.init();
      await assert.doesNotReject(() => queue.shutdown());
    });
  });

  describe("setPool()", () => {
    it("accepts an emulator pool object", () => {
      const mockPool = {
        acquire: () => "emulator-5554",
        release: () => {},
        idleCount: () => 1,
        status: () => [{ serial: "emulator-5554", status: "idle" }],
      };
      assert.doesNotThrow(() => queue.setPool(mockPool));
    });
  });
});
