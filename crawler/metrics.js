/**
 * metrics.js — Per-crawl metrics collector
 * Pure data accumulator — no ADB calls, no persistence.
 * Attach summary() output to the crawl result for reporting/dashboards.
 */

"use strict";

class CrawlMetrics {
  constructor() {
    this.launchTimeMs = 0;
    this.launchMethod = "";
    this.launchSuccess = false;

    this._crawlStartTime = Date.now();
    this._stepStarts = new Map();
    this.stepTimings = [];
    this.readinessWaits = [];

    this.actionOutcomes = {};
    this.transitionTypes = {};

    this._totalSteps = 0;
    this._uniqueStates = 0;

    this.recoveryEvents = [];
  }

  /**
   * Record app launch timing.
   * @param {number} elapsedMs
   * @param {string} method — 'am_start' | 'monkey' | 'monkey_retry'
   * @param {boolean} success
   */
  recordLaunch(elapsedMs, method, success) {
    this.launchTimeMs = elapsedMs;
    this.launchMethod = method;
    this.launchSuccess = success;
  }

  /**
   * Mark the start of a crawl step (for computing step duration).
   * @param {number} step
   */
  recordStepStart(step) {
    this._stepStarts.set(step, Date.now());
  }

  /**
   * Mark the end of a crawl step.
   * @param {number} step
   */
  recordStepEnd(step) {
    const start = this._stepStarts.get(step);
    if (start !== undefined) {
      this.stepTimings.push({
        step,
        durationMs: Date.now() - start,
      });
    }
  }

  /**
   * Record a readiness wait result.
   * @param {number} step
   * @param {string} type — 'screen_ready' | 'app_foreground' | 'interactive_ui'
   * @param {{ ready: boolean, elapsedMs: number, reason: string }} result
   */
  recordReadinessWait(step, type, result) {
    this.readinessWaits.push({
      step,
      type,
      elapsedMs: result.elapsedMs,
      ready: result.ready,
      reason: result.reason,
    });
  }

  /**
   * Record an action outcome with transition classification.
   * @param {number} step
   * @param {string} outcome — 'ok' | 'ineffective' | 'dead_end' | 'out_of_app' | etc.
   * @param {string} transitionType — 'same_screen' | 'new_screen' | 'back_to_known' | 'left_app'
   */
  recordActionOutcome(step, outcome, transitionType) {
    this.actionOutcomes[outcome] = (this.actionOutcomes[outcome] || 0) + 1;
    this.transitionTypes[transitionType] = (this.transitionTypes[transitionType] || 0) + 1;
  }

  /**
   * Record a recovery event (strategy attempted and outcome).
   * @param {number} step
   * @param {string} situation — e.g. 'stuck_same_screen', 'loop_detected'
   * @param {string} strategy — e.g. 'soft_back', 'navigate_target', 'relaunch_branch'
   * @param {boolean} success
   * @param {string} [reason] — optional detail
   */
  recordRecovery(step, situation, strategy, success, reason) {
    this.recoveryEvents.push({
      step,
      situation,
      strategy,
      success,
      reason: reason || "",
      timestamp: Date.now(),
    });
  }

  /**
   * Produce a JSON-safe snapshot of all raw metrics data.
   * Unlike summary(), this preserves all individual events for persistence.
   * @returns {object}
   */
  toJSON() {
    return {
      launchTimeMs: this.launchTimeMs,
      launchMethod: this.launchMethod,
      launchSuccess: this.launchSuccess,
      crawlStartTime: this._crawlStartTime,
      stepTimings: [...this.stepTimings],
      readinessWaits: [...this.readinessWaits],
      actionOutcomes: { ...this.actionOutcomes },
      transitionTypes: { ...this.transitionTypes },
      recoveryEvents: [...this.recoveryEvents],
    };
  }

  /**
   * Produce a frozen summary object for the crawl result.
   * @param {{ totalSteps?: number, uniqueStates?: number }} finalStats
   * @returns {object}
   */
  summary(finalStats = {}) {
    const totalSteps = finalStats.totalSteps || this.stepTimings.length || 1;
    const uniqueStates = finalStats.uniqueStates || 0;

    const totalActions = Object.values(this.actionOutcomes).reduce((a, b) => a + b, 0) || 1;
    const ineffective = this.actionOutcomes.ineffective || 0;

    const readinessMs = this.readinessWaits.map((w) => w.elapsedMs);
    const avgReadinessMs =
      readinessMs.length > 0
        ? Math.round(readinessMs.reduce((a, b) => a + b, 0) / readinessMs.length)
        : 0;

    return Object.freeze({
      launchTimeMs: this.launchTimeMs,
      launchMethod: this.launchMethod,
      launchSuccess: this.launchSuccess,
      totalCrawlTimeMs: Date.now() - this._crawlStartTime,
      stepTimings: this.stepTimings,
      readinessWaits: this.readinessWaits,
      avgReadinessMs,
      actionOutcomes: { ...this.actionOutcomes },
      transitionTypes: { ...this.transitionTypes },
      uniqueScreenRate: Math.round((uniqueStates / totalSteps) * 100) / 100,
      ineffectiveActionRate: Math.round((ineffective / totalActions) * 100) / 100,
    });
  }
}

module.exports = { CrawlMetrics };
