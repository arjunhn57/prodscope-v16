"use strict";

/**
 * v17/drivers/canvas-driver.js
 *
 * Deterministic driver for "empty tree" screens — the accessibility XML
 * parses to zero clickable nodes. This happens on:
 *   - Game-engine splashes (Unity, Unreal) rendering into a single canvas
 *   - SurfaceView video players before the first frame
 *   - Jetpack Compose roots that haven't composed yet
 *   - Cold-start launches before the UI inflates
 *
 * Golden-suite evidence (2026-04-22, Spotify): an empty-tree splash burned 4
 * LLMFallback calls in a row because no driver could claim it. That is the
 * class of regression this driver fixes — the cheap response to an empty tree
 * is a short wait, not a Sonnet reasoning pass.
 *
 * Behaviour:
 *   - First time a given empty-tree fingerprint is seen → emit a 1500ms wait.
 *     The settle should reveal clickables on the next observation.
 *   - Second time the SAME fingerprint reappears → return null and yield to
 *     LLMFallback (the app genuinely uses a canvas renderer, or the UI is
 *     stuck and press_back is warranted).
 *
 * Priority 2 (between Permission and Dismiss): permissions pre-empt canvas
 * because a permission dialog produces a non-empty tree anyway — but Dismiss
 * and downstream drivers must never fire on a truly empty screen.
 */

const { parseClickableGraph } = require("./clickable-graph");
const { computeStructuralFingerprint } = require("../node-classifier");
const { logger } = require("../../../lib/logger");

const log = logger.child({ component: "v17-canvas-driver" });

/** Executor caps waits at 3000ms; one wait of 1500ms stays well under that. */
const CANVAS_WAIT_MS = 1500;

/**
 * @typedef {Object} CanvasMemory
 * @property {Set<string>} waited  - empty-tree fingerprints we already waited on
 *
 * @typedef {Object} CanvasState
 * @property {CanvasMemory} [canvasMemory]
 */

/**
 * @param {CanvasState} state
 * @returns {CanvasMemory|null}
 */
function initMemory(state) {
  if (!state || typeof state !== "object") return null;
  if (!state.canvasMemory) {
    state.canvasMemory = { waited: new Set() };
  }
  return state.canvasMemory;
}

/**
 * True when the XML is a non-empty string AND parses to zero clickables. A
 * missing/empty xml indicates a capture failure, which is a different failure
 * mode the agent-loop already handles — don't claim it.
 *
 * @param {{xml?:string|null}} observation
 * @returns {boolean}
 */
function claim(observation) {
  if (!observation || typeof observation !== "object") return false;
  const xml = typeof observation.xml === "string" ? observation.xml : "";
  if (!xml) return false;
  const graph = parseClickableGraph(xml);
  return graph.clickables.length === 0;
}

/**
 * First time on a fingerprint → wait 1500ms; second time → null so LLMFallback
 * handles the case (likely a canvas-native app or a genuinely stuck screen).
 *
 * @param {any} observation
 * @param {CanvasState} state
 * @returns {{type:'wait', ms:number}|null}
 */
function decide(observation, state) {
  if (!observation || typeof observation !== "object") return null;
  const memory = initMemory(state);
  if (!memory) return null;

  const graph = parseClickableGraph(observation.xml);
  const fp = computeStructuralFingerprint(
    graph,
    observation.packageName,
    observation.activity,
  );

  if (memory.waited.has(fp)) {
    log.info(
      { fingerprint: fp, pkg: observation.packageName || "" },
      "CanvasDriver: already waited on this fingerprint; yielding to LLMFallback",
    );
    return null;
  }

  memory.waited.add(fp);
  log.info(
    {
      fingerprint: fp,
      pkg: observation.packageName || "",
      activity: observation.activity || "",
      ms: CANVAS_WAIT_MS,
    },
    "CanvasDriver: empty tree observed; waiting for UI to settle",
  );
  return { type: "wait", ms: CANVAS_WAIT_MS };
}

module.exports = {
  name: "CanvasDriver",
  claim,
  decide,
  // exported for direct testing
  initMemory,
  CANVAS_WAIT_MS,
};
