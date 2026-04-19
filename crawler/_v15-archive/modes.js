"use strict";

/**
 * modes.js — Crawl mode state machine.
 *
 * The crawler operates in modes: BOOT, AUTH, SURVEY, EXPLORE, ESCAPE, VERIFY.
 * Each mode has a strategy, budget allocation, and transition conditions.
 */

const {
  AUTH_BUDGET_PERCENT,
  SURVEY_BUDGET_PERCENT,
  EXPLORE_BUDGET_PERCENT,
  VERIFY_BUDGET_PERCENT,
  VERIFY_MODE_THRESHOLD,
} = require("../config/defaults");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "modes" });

const MODE = {
  BOOT: "BOOT",
  AUTH: "AUTH",
  SURVEY: "SURVEY",
  EXPLORE: "EXPLORE",
  ESCAPE: "ESCAPE",
  VERIFY: "VERIFY",
};

class ModeManager {
  /**
   * @param {number} maxSteps - Total step budget
   */
  constructor(maxSteps) {
    this.maxSteps = maxSteps;
    this.currentMode = MODE.BOOT;
    this.stepsUsed = 0;
    this.modeSteps = {};
    this.modeHistory = [{ mode: MODE.BOOT, step: 0 }];
    this._previousMode = null;

    // Budget allocation (steps)
    this.budgets = {
      [MODE.AUTH]: Math.floor(maxSteps * (AUTH_BUDGET_PERCENT || 0.15)),
      [MODE.SURVEY]: Math.floor(maxSteps * (SURVEY_BUDGET_PERCENT || 0.25)),
      [MODE.EXPLORE]: Math.floor(maxSteps * (EXPLORE_BUDGET_PERCENT || 0.45)),
      [MODE.VERIFY]: Math.floor(maxSteps * (VERIFY_BUDGET_PERCENT || 0.15)),
    };

    for (const mode of Object.values(MODE)) {
      this.modeSteps[mode] = 0;
    }
  }

  /**
   * Switch to a new mode.
   * @param {string} mode - One of MODE.*
   */
  enterMode(mode) {
    if (mode === this.currentMode) return;
    this._previousMode = this.currentMode;
    this.currentMode = mode;
    this.modeHistory.push({ mode, step: this.stepsUsed });
    log.info({ from: this._previousMode, to: mode, step: this.stepsUsed }, "Mode transition");
  }

  /**
   * Record that a step was used. Call once per loop iteration.
   */
  recordStep() {
    this.stepsUsed++;
    this.modeSteps[this.currentMode] = (this.modeSteps[this.currentMode] || 0) + 1;
  }

  /**
   * How much of the total budget has been used (0.0 to 1.0).
   * @returns {number}
   */
  budgetUsedPercent() {
    return this.stepsUsed / this.maxSteps;
  }

  /**
   * Check if the current mode has exceeded its allocated budget.
   * @returns {boolean}
   */
  isModeOverBudget() {
    const budget = this.budgets[this.currentMode];
    if (budget === undefined) return false;
    return this.modeSteps[this.currentMode] >= budget;
  }

  /**
   * Check if we should transition to VERIFY mode (overall budget threshold).
   * @returns {boolean}
   */
  shouldEnterVerify() {
    return (
      this.currentMode !== MODE.VERIFY &&
      this.budgetUsedPercent() >= (VERIFY_MODE_THRESHOLD || 0.85)
    );
  }

  /**
   * Get the mode to return to after ESCAPE.
   * @returns {string}
   */
  previousMode() {
    return this._previousMode || MODE.EXPLORE;
  }

  /**
   * Serialize for checkpoint.
   */
  serialize() {
    return {
      currentMode: this.currentMode,
      stepsUsed: this.stepsUsed,
      modeSteps: { ...this.modeSteps },
      modeHistory: [...this.modeHistory],
    };
  }
}

module.exports = { MODE, ModeManager };
