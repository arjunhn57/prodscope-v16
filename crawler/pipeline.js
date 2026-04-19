"use strict";

/**
 * pipeline.js — E3: Pre-fetch buffer for step N+1 capture.
 *
 * While the crawler processes step N (classification, vision, priorities),
 * this module kicks off an async capture for step N+1 in the background.
 * The next iteration checks the buffer first, saving 2-4s of ADB I/O.
 *
 * Safety: if the pre-fetched capture's screenshot hash doesn't match
 * the post-action state, it's discarded and a fresh capture is taken.
 */

const screen = require("./screen");
const screenshotFp = require("./screenshot-fp");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "pipeline" });

let prefetchPromise = null;
let prefetchResult = null;
let prefetchScreenshotHash = null;
let prefetchStep = -1;

/**
 * Start pre-fetching the next capture in the background.
 * Call this after action execution, while readiness/outcome processing runs.
 *
 * @param {string} screenshotDir
 * @param {number} nextStep - The step index this capture is for
 */
function startPrefetch(screenshotDir, nextStep) {
  prefetchResult = null;
  prefetchScreenshotHash = null;
  prefetchStep = nextStep;

  prefetchPromise = screen.captureAsync(screenshotDir, nextStep)
    .then((snapshot) => {
      prefetchResult = snapshot;
      // Compute hash for validation
      if (snapshot && snapshot.screenshotPath && !snapshot.error) {
        try {
          prefetchScreenshotHash = screenshotFp.computeHash(snapshot.screenshotPath);
        } catch (_) {
          prefetchScreenshotHash = null;
        }
      }
      return snapshot;
    })
    .catch((err) => {
      log.warn({ err }, "Pre-fetch failed");
      prefetchResult = null;
      prefetchScreenshotHash = null;
    });
}

/**
 * Consume the pre-fetched capture if available and valid.
 * Returns the snapshot if it matches the expected step, null otherwise.
 *
 * @param {number} expectedStep - The step we're looking for
 * @returns {Promise<object|null>}
 */
async function consumePrefetch(expectedStep) {
  if (prefetchStep !== expectedStep || !prefetchPromise) {
    clear();
    return null;
  }

  // Wait for pre-fetch to complete if still running
  await prefetchPromise;

  const result = prefetchResult;
  const hash = prefetchScreenshotHash;

  // Clear buffer regardless
  clear();

  if (!result || result.error) {
    return null;
  }

  return { snapshot: result, screenshotHash: hash };
}

/**
 * Clear the pre-fetch buffer.
 */
function clear() {
  prefetchPromise = null;
  prefetchResult = null;
  prefetchScreenshotHash = null;
  prefetchStep = -1;
}

/**
 * Check if a pre-fetch is pending for the given step.
 */
function hasPrefetch(step) {
  return prefetchStep === step && prefetchPromise !== null;
}

module.exports = { startPrefetch, consumePrefetch, clear, hasPrefetch };
