"use strict";

/**
 * queue.js — BullMQ-backed job queue with Redis persistence.
 *
 * Replaces the in-memory pending[] array. Jobs survive server restarts.
 * When multi-emulator support is added, increase worker concurrency.
 *
 * Fallback: If Redis is unavailable, falls back to in-memory mode
 * so the server can still run in development without Redis.
 */

const { Queue, Worker } = require("bullmq");
const store = require("./store");
const { processJob } = require("./runner");
const { logger } = require("../lib/logger");
const { encrypt, decrypt } = require("../lib/crypto");
const { apiError } = require("../lib/api-errors");

const log = logger.child({ component: "queue" });

// ── Redis connection ────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function parseRedisUrl(url) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || "localhost",
      port: parseInt(parsed.port, 10) || 6379,
      password: parsed.password || undefined,
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

const connection = parseRedisUrl(REDIS_URL);

// ── BullMQ Queue + Worker ───────────────────────────────────────────────────

let jobQueue;
let worker;
let currentJobId = null;
let fallbackMode = false;
let emulatorPool = null; // Set via setPool()
let _currentSerial = null; // Track acquired emulator for crash protection

// Worker concurrency derived from EMULATOR_SERIALS (defaults to 1)
const _poolConcurrency = process.env.EMULATOR_SERIALS
  ? process.env.EMULATOR_SERIALS.split(",").map((s) => s.trim()).filter(Boolean).length || 1
  : 1;

// In-memory fallback (if Redis unavailable)
const fallbackPending = [];
let fallbackProcessing = false;

/**
 * Initialize the BullMQ queue. Call once at server startup.
 */
async function init() {
  try {
    jobQueue = new Queue("crawl-jobs", {
      connection,
      defaultJobOptions: {
        // One free retry on transient emulator / adb / network failure. A
        // second failure is actually broken — don't keep retrying in a
        // loop and burn the user's credits.
        attempts: 2,
        backoff: { type: "fixed", delay: 10000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });

    // Test connection
    await jobQueue.client;

    worker = new Worker(
      "crawl-jobs",
      async (job) => {
        const { jobId, apkPath, opts } = job.data;
        currentJobId = jobId;
        log.info({ jobId, remaining: await jobQueue.getWaitingCount() }, "Processing job");

        // Decrypt credentials before processing
        const decryptedOpts = opts.credentials
          ? { ...opts, credentials: decryptCredentials(opts.credentials) }
          : opts;

        // Acquire emulator from pool (if available)
        let serial = null;
        if (emulatorPool) {
          serial = emulatorPool.acquire(jobId);
          if (!serial) {
            log.warn({ jobId }, "No idle emulators — job will wait for retry");
            throw new Error("No idle emulators available");
          }
          decryptedOpts.serial = serial;
          _currentSerial = serial;
        }

        try {
          await processJob(jobId, apkPath, decryptedOpts);
        } catch (err) {
          log.error({ jobId, err }, "Job threw unhandled error");
          try {
            // If the failure looks like an emulator / device problem, attach
            // the structured EMULATOR_UNAVAILABLE envelope so the UI can show
            // "retryable, wait for a free emulator" instead of a raw stack.
            const msg = String(err && err.message || "");
            const looksLikeEmulator = /no idle emulators|device.offline|emulator.fail|cannot connect|adb.*not found|device.*not found/i.test(msg);
            store.updateJob(jobId, {
              status: "failed",
              error: err.message,
              ...(looksLikeEmulator ? { errorDetails: apiError("EMULATOR_UNAVAILABLE") } : {}),
            });
          } catch (_) {}
          // Detect device errors and mark emulator unhealthy instead of releasing as idle
          const isDeviceError = /device.offline|emulator.fail|cannot connect|adb.*not found|device.*not found/i.test(err.message);
          if (isDeviceError && emulatorPool && serial) {
            emulatorPool.markUnhealthy(serial, err.message);
            serial = null; // Prevent release() in finally — already marked unhealthy
            _currentSerial = null;
          }
          throw err; // Let BullMQ record the failure
        } finally {
          if (emulatorPool && serial) emulatorPool.release(serial);
          _currentSerial = null;
          currentJobId = null;
        }
      },
      {
        connection,
        concurrency: _poolConcurrency,
        limiter: { max: _poolConcurrency, duration: 1000 },
      }
    );

    worker.on("failed", (job, err) => {
      log.error({ jobId: job?.data?.jobId, err }, "Job failed in worker");
    });

    worker.on("error", (err) => {
      log.error({ err }, "Worker error");
      if (_currentSerial && emulatorPool) {
        log.warn({ serial: _currentSerial }, "Releasing leaked emulator after worker error");
        emulatorPool.release(_currentSerial);
        _currentSerial = null;
      }
    });

    log.info({ redis: `${connection.host}:${connection.port}` }, "BullMQ queue initialized");
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      log.error({ err }, "Redis is required in production. Set REDIS_URL or start Redis.");
      throw new Error("Redis is required in production");
    }
    log.warn({ err }, "Redis unavailable — falling back to in-memory queue (dev only)");
    fallbackMode = true;
    jobQueue = null;
    worker = null;
  }
}

// ── Public API (same interface as before) ───────────────────────────────────

/**
 * Add a job to the queue.
 * @param {string} jobId
 * @param {string} apkPath
 * @param {object} opts
 */
async function enqueue(jobId, apkPath, opts) {
  // Encrypt credentials at rest (in Redis or in-memory)
  const safeOpts = opts.credentials
    ? { ...opts, credentials: encryptCredentials(opts.credentials) }
    : opts;

  if (fallbackMode) {
    fallbackPending.push({ jobId, apkPath, opts: safeOpts });
    log.info({ jobId, depth: fallbackPending.length }, "Enqueued job (in-memory fallback)");
    drainFallback();
    return;
  }

  await jobQueue.add("crawl", { jobId, apkPath, opts: safeOpts }, {
    jobId, // Use our jobId as BullMQ job ID for dedup
  });
  log.info({ jobId }, "Enqueued job");
}

/**
 * Get queue status.
 */
async function status() {
  if (fallbackMode) {
    return {
      processing: fallbackProcessing,
      currentJobId,
      queueDepth: fallbackPending.length,
      pendingJobIds: fallbackPending.map((j) => j.jobId),
      backend: "in-memory",
    };
  }

  const [waiting, active, completed, failed] = await Promise.all([
    jobQueue.getWaitingCount(),
    jobQueue.getActiveCount(),
    jobQueue.getCompletedCount(),
    jobQueue.getFailedCount(),
  ]);

  return {
    processing: active > 0,
    currentJobId,
    queueDepth: waiting,
    waiting,
    active,
    completed,
    failed,
    backend: "redis",
  };
}

/**
 * Get position of a job in the queue.
 */
async function position(jobId) {
  if (fallbackMode) {
    if (currentJobId === jobId) return 0;
    const idx = fallbackPending.findIndex((j) => j.jobId === jobId);
    return idx === -1 ? -1 : idx + 1;
  }

  if (currentJobId === jobId) return 0;

  // Check if job is waiting in the queue
  const waiting = await jobQueue.getWaiting();
  const idx = waiting.findIndex((j) => j.data.jobId === jobId);
  return idx === -1 ? -1 : idx + 1;
}

/**
 * Recover interrupted jobs from database on startup.
 */
function recoverPendingJobs() {
  try {
    const db = store.db;
    const stuck = db
      .prepare("SELECT id, data FROM jobs WHERE status = 'queued' OR status = 'processing' ORDER BY created_at ASC")
      .all();

    if (stuck.length === 0) return;

    log.info({ count: stuck.length }, "Recovering stuck jobs from database");

    for (const row of stuck) {
      // APK path is lost on restart — mark as failed
      log.info({ jobId: row.id }, "Job interrupted — marked as failed (APK lost on restart)");
      store.updateJob(row.id, {
        status: "failed",
        error: "Server restarted while job was in progress. APK file no longer available. Please resubmit.",
      });
    }
  } catch (e) {
    log.error({ err: e }, "Recovery scan failed");
  }
}

/**
 * Graceful shutdown — close worker and queue connections.
 */
async function shutdown() {
  if (worker) {
    await worker.close();
    log.info("Worker closed");
  }
  if (jobQueue) {
    await jobQueue.close();
    log.info("Queue closed");
  }
}

// ── Fallback drain loop (identical to old behavior) ─────────────────────────

async function drainFallback() {
  if (fallbackProcessing) return;
  if (fallbackPending.length === 0) return;

  // Mark processing in store BEFORE removing from queue — prevents job loss on crash
  const { jobId, apkPath, opts } = fallbackPending[0];
  store.updateJob(jobId, { status: "processing" });
  fallbackPending.shift();
  fallbackProcessing = true;
  currentJobId = jobId;

  // Decrypt credentials before processing
  const decryptedOpts = opts.credentials
    ? { ...opts, credentials: decryptCredentials(opts.credentials) }
    : opts;

  // Acquire emulator from pool (if available)
  let serial = null;
  if (emulatorPool) {
    serial = emulatorPool.acquire(jobId);
    if (!serial) {
      log.warn({ jobId }, "No idle emulators — re-queueing job");
      fallbackPending.unshift({ jobId, apkPath, opts });
      fallbackProcessing = false;
      currentJobId = null;
      return;
    }
    decryptedOpts.serial = serial;
  }

  try {
    await processJob(jobId, apkPath, decryptedOpts);
  } catch (err) {
    log.error({ jobId, err }, "Job threw unhandled error (fallback)");
    try {
      store.updateJob(jobId, { status: "failed", error: err.message });
    } catch (_) {}
    // Detect device errors and mark emulator unhealthy
    const isDeviceError = /device.offline|emulator.fail|cannot connect|adb.*not found|device.*not found/i.test(err.message);
    if (isDeviceError && emulatorPool && serial) {
      emulatorPool.markUnhealthy(serial, err.message);
      serial = null; // Prevent release() in finally
    }
  } finally {
    if (emulatorPool && serial) emulatorPool.release(serial);
    fallbackProcessing = false;
    currentJobId = null;
    drainFallback();
  }
}

/**
 * Sync accessor for crash protection — returns currentJobId without async.
 */
function getCurrentJobId() {
  return currentJobId;
}

// ── Credential encryption helpers ──────────────────────────────────────────

/**
 * Encrypt a credentials object for at-rest storage in Redis/memory.
 * Encrypts the JSON string of the credentials object.
 */
function encryptCredentials(creds) {
  if (!creds || typeof creds !== "object") return creds;
  try {
    const json = JSON.stringify(creds);
    const encrypted = encrypt(json);
    // If encryption is active, wrap so we know to decrypt later
    return encrypted !== json ? { _encrypted: encrypted } : creds;
  } catch (e) {
    log.warn({ err: e }, "Credential encryption failed — storing as-is");
    return creds;
  }
}

/**
 * Decrypt a credentials object from at-rest storage.
 */
function decryptCredentials(creds) {
  if (!creds || typeof creds !== "object") return creds;
  if (!creds._encrypted) return creds; // Not encrypted, pass through
  try {
    const json = decrypt(creds._encrypted);
    return JSON.parse(json);
  } catch (e) {
    log.warn({ err: e }, "Credential decryption failed — returning as-is");
    return creds;
  }
}

/**
 * Set the emulator pool instance for acquire/release per job.
 * @param {import('../emulator/pool').EmulatorPool} pool
 */
function setPool(pool) {
  emulatorPool = pool;
  log.info({ emulators: pool.idleCount() }, "Emulator pool attached to queue");
}

/**
 * Sync accessor for crash protection — returns the currently acquired emulator serial.
 */
function getCurrentSerial() {
  return _currentSerial;
}

module.exports = { init, enqueue, status, position, recoverPendingJobs, shutdown, getCurrentJobId, getCurrentSerial, setPool };
