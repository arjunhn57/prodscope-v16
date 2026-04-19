"use strict";

/**
 * flow-tracker.js — Flow recording and fingerprinting
 *
 * A "flow" is an ordered sequence of (screen, action) steps accomplishing a
 * coherent task, e.g. home → compose → type → post → home.
 *
 * Flows are fingerprinted by their sequence of screenType:actionType:target
 * for deduplication.
 */

const crypto = require("crypto");

class FlowTracker {
  constructor() {
    this.completedFlows = [];
    this.currentFlow = null;
  }

  /**
   * Start a new flow from a navigation hub or entry point.
   */
  startFlow(screenType, feature) {
    if (this.currentFlow && this.currentFlow.steps.length > 0) {
      this._finalizeCurrentFlow("abandoned");
    }

    this.currentFlow = {
      feature,
      steps: [],
      startedAt: Date.now(),
    };
  }

  /**
   * Add a step to the current flow.
   * @param {string} screenType - Classified screen type
   * @param {string} actionType - Action type (tap, scroll, back, etc.)
   * @param {string} actionTarget - Action target label/id
   * @param {string} fingerprint - Exact screen fingerprint
   */
  addStep(screenType, actionType, actionTarget, fingerprint) {
    if (!this.currentFlow) {
      this.currentFlow = {
        feature: "unknown",
        steps: [],
        startedAt: Date.now(),
      };
    }

    this.currentFlow.steps.push({
      screenType,
      actionType,
      actionTarget: (actionTarget || "").toLowerCase().substring(0, 50),
      fingerprint,
    });
  }

  /**
   * Check if the current flow looks complete (returned to a hub, or saw a
   * success indicator).
   */
  checkFlowComplete(screenType, isNavigationHub) {
    if (!this.currentFlow || this.currentFlow.steps.length < 2) return false;

    // Flow is complete if we returned to a navigation hub
    if (isNavigationHub) {
      this._finalizeCurrentFlow("completed");
      return true;
    }

    return false;
  }

  /**
   * Force-finalize the current flow (e.g. on crawl end or back-out).
   */
  finalizeCurrentFlow(outcome) {
    if (this.currentFlow && this.currentFlow.steps.length > 0) {
      this._finalizeCurrentFlow(outcome || "abandoned");
    }
  }

  /**
   * Get all completed flows.
   */
  getFlows() {
    return this.completedFlows;
  }

  /**
   * Serialize for persistence.
   */
  serialize() {
    return {
      completedFlows: this.completedFlows,
      currentFlow: this.currentFlow,
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  _finalizeCurrentFlow(outcome) {
    const flow = this.currentFlow;
    if (!flow) return;

    flow.outcome = outcome;
    flow.fingerprint = this._computeFlowFingerprint(flow.steps);
    flow.endedAt = Date.now();

    this.completedFlows.push(flow);
    this.currentFlow = null;
  }

  _computeFlowFingerprint(steps) {
    const sequence = steps
      .map((s) => `${s.screenType}:${s.actionType}:${s.actionTarget}`)
      .join(" → ");

    return crypto.createHash("sha256").update(sequence).digest("hex").substring(0, 16);
  }
}

module.exports = { FlowTracker };
