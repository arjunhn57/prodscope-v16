"use strict";

/**
 * pool.js — Multi-emulator pool manager.
 *
 * Manages a set of emulator instances identified by ADB serial (e.g., emulator-5554).
 * Each emulator can be acquired by a job and released when done.
 *
 * For single-emulator setups, initialize with one serial.
 * For multi-emulator, pass all available serials.
 *
 * Usage:
 *   const pool = new EmulatorPool(["emulator-5554", "emulator-5556"]);
 *   const serial = pool.acquire(jobId);
 *   // ... run crawl with serial ...
 *   pool.release(serial);
 */

const { logger } = require("../lib/logger");

const log = logger.child({ component: "emulator-pool" });

class EmulatorPool {
  /**
   * @param {string[]} serials - ADB serial numbers of available emulators
   */
  constructor(serials) {
    this.emulators = serials.map((serial) => ({
      serial,
      status: "idle",        // idle | busy | unhealthy
      currentJobId: null,
      lastUsed: null,
      totalJobs: 0,
    }));
    log.info({ count: serials.length, serials }, "Emulator pool initialized");
  }

  /**
   * Acquire an idle emulator for a job.
   * @param {string} jobId
   * @returns {string|null} serial or null if none available
   */
  acquire(jobId) {
    const idle = this.emulators.find((e) => e.status === "idle");
    if (!idle) {
      log.warn({ jobId }, "No idle emulators available");
      return null;
    }
    idle.status = "busy";
    idle.currentJobId = jobId;
    idle.lastUsed = Date.now();
    idle.totalJobs++;
    log.info({ jobId, serial: idle.serial }, "Emulator acquired");
    return idle.serial;
  }

  /**
   * Release an emulator back to the pool.
   * @param {string} serial
   */
  release(serial) {
    const emu = this.emulators.find((e) => e.serial === serial);
    if (emu) {
      log.info({ serial, jobId: emu.currentJobId }, "Emulator released");
      emu.status = "idle";
      emu.currentJobId = null;
    }
  }

  /**
   * Mark an emulator as unhealthy (device offline, crash, etc).
   * @param {string} serial
   * @param {string} reason
   */
  markUnhealthy(serial, reason) {
    const emu = this.emulators.find((e) => e.serial === serial);
    if (emu) {
      log.error({ serial, reason }, "Emulator marked unhealthy");
      emu.status = "unhealthy";
      emu.currentJobId = null;
    }
  }

  /**
   * Recover an unhealthy emulator (after restart/reconnect).
   * @param {string} serial
   */
  recover(serial) {
    const emu = this.emulators.find((e) => e.serial === serial);
    if (emu && emu.status === "unhealthy") {
      emu.status = "idle";
      log.info({ serial }, "Emulator recovered");
    }
  }

  /**
   * Get pool status for monitoring.
   */
  status() {
    return {
      total: this.emulators.length,
      idle: this.emulators.filter((e) => e.status === "idle").length,
      busy: this.emulators.filter((e) => e.status === "busy").length,
      unhealthy: this.emulators.filter((e) => e.status === "unhealthy").length,
      emulators: this.emulators.map((e) => ({
        serial: e.serial,
        status: e.status,
        currentJobId: e.currentJobId,
        totalJobs: e.totalJobs,
      })),
    };
  }

  /**
   * Get the number of idle emulators (for queue concurrency).
   */
  idleCount() {
    return this.emulators.filter((e) => e.status === "idle").length;
  }

  /**
   * Start periodic health check for unhealthy emulators.
   * Attempts to recover emulators that have come back online.
   * @param {object} adbModule - module with run() method for ADB commands
   * @param {number} [intervalMs=60000] - check interval
   */
  startHealthCheck(adbModule, intervalMs = 60000) {
    this._healthInterval = setInterval(() => {
      for (const emu of this.emulators) {
        if (emu.status === "unhealthy") {
          try {
            const state = adbModule.run(`adb -s ${emu.serial} get-state`, { ignoreError: true, timeout: 5000 });
            if (state && state.trim() === "device") {
              this.recover(emu.serial);
            }
          } catch (_) {
            // Still unhealthy — will retry next interval
          }
        }
      }
    }, intervalMs);
  }

  /**
   * Stop the periodic health check.
   */
  stopHealthCheck() {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
  }
}

module.exports = { EmulatorPool };
