"use strict";

/**
 * v18/agent-loop.js — thin wrapper over v17's runAgentLoop that injects the
 * V18 dispatcher, trajectory memory, and Sonnet-escalation budget.
 *
 * Architecture:
 *   - v17/agent-loop.js now accepts `deps.dispatch` as an optional injection
 *     point (2-line refactor, no-op for existing v17 runs).
 *   - V18's dispatcher wraps the classifier + intent filter + escalation
 *     layer on top of the same driver list (Permission / Canvas / Dismiss /
 *     Auth specialists unchanged; Exploration replaced with the v18
 *     intent-filtering variant).
 *   - This file creates the V18-specific state (trajectory memory,
 *     escalation budget) once per run and threads it into the dispatcher
 *     via `extraDispatchDeps`.
 *
 * Feature-flagged in jobs/runner.js via `USE_V18_ENGINE` env var.
 */

const { runAgentLoop: v17RunAgentLoop } = require("../v17/agent-loop");
const v18Dispatcher = require("./dispatcher");
const {
  createMemory: createTrajectoryMemory,
  uniqueLogicalScreensCount,
  uniqueActivitiesCount,
} = require("./trajectory-memory");
const { createBudget: createEscalationBudget } = require("./sonnet-escalation");
const { logger } = require("../../lib/logger");

const log = logger.child({ component: "v18-loop" });

/**
 * Run a crawl with the V18 engine.
 *
 * Takes the same options object as v17's runAgentLoop (see
 * crawler/v17/agent-loop.js:RunOptions). The V18 runtime state
 * (trajectory memory, escalation budget) is allocated internally and
 * attached to the dispatch deps so it's shared across every step.
 *
 * @param {object} opts
 * @returns {Promise<object>}
 */
async function runAgentLoop(opts) {
  // Allocate V18-specific per-run state. These live in a closure for the
  // full crawl; references are shared into the dispatcher via
  // extraDispatchDeps on each step.
  const trajectory = createTrajectoryMemory();
  const escalationBudget = createEscalationBudget();

  log.info(
    {
      jobId: opts && opts.jobId,
      targetPackage: opts && opts.targetPackage,
      escalationBudgetMax: escalationBudget.max,
    },
    "V18 engine starting",
  );

  const existingDeps = (opts && opts.deps) || {};
  const mergedDeps = Object.assign({}, existingDeps, {
    dispatch: v18Dispatcher.dispatch,
    extraDispatchDeps: {
      trajectory,
      escalationBudget,
      // Phase 2: Haiku needs the target package to decide engine_action=relaunch
      // when the current observation is on the wrong app (launcher, browser, ...).
      targetPackage: opts && opts.targetPackage,
    },
  });
  const mergedOpts = Object.assign({}, opts, { deps: mergedDeps });

  const result = await v17RunAgentLoop(mergedOpts);

  // Phase 4: replace the user-facing uniqueScreens metric with the
  // logical-fp count (position/content-insensitive). The structural-fp
  // count inflates by ~2× on scroll-heavy apps. User saw 63 "unique"
  // screens on run 6aa971ab; logical count was ~30-35.
  const logicalUnique = uniqueLogicalScreensCount(trajectory);
  const enriched = Object.assign({}, result, {
    engine: "v18",
    v18: {
      escalationsUsed: escalationBudget.used,
      escalationsMax: escalationBudget.max,
      trajectory: {
        seenTypeCounts: Object.assign({}, trajectory.seenTypeCounts),
        hubsRemaining: Array.from(trajectory.hubsRemaining),
        fingerprintsSeen: trajectory.fingerprintsSeen.size,
        logicalFingerprintsSeen: logicalUnique,
        // 2026-04-25 v6: distinct Android activities visited. Honest
        // "feature areas explored" signal — admin telemetry uses this to
        // distinguish a 60-step crawl that touched 6 activities from one
        // that bounced 60 times in a single hub.
        uniqueActivities: uniqueActivitiesCount(trajectory),
        activitiesSeen: Array.from(trajectory.activitiesSeen || []),
      },
    },
  });
  // Override the v17-derived uniqueScreens with the honest logical count
  // ONLY when we actually saw screens through the v18 classifier. Some
  // early steps (pre-classifier) are tracked via structural fp only.
  if (logicalUnique > 0) {
    enriched.uniqueScreens = logicalUnique;
  }
  return enriched;
}

module.exports = { runAgentLoop };
