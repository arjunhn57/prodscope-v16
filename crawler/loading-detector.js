"use strict";

/**
 * loading-detector.js — Detect loading/spinner screens and wait for content.
 *
 * Prevents the crawler from interacting with screens that are still loading.
 * Returns structured results, never throws.
 */

const adb = require("./adb");
const { sleep } = require("../utils/sleep");
const {
  LOADING_WAIT_TIMEOUT_MS,
  LOADING_POLL_INTERVAL_MS,
} = require("../config/defaults");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "loading-detector" });

/**
 * Check if the given XML represents a loading screen.
 * @param {string} xml
 * @returns {boolean}
 */
function isLoadingScreen(xml) {
  if (!xml) return false;

  const hasSpinner =
    /class="android\.widget\.ProgressBar"/i.test(xml) ||
    /progress_bar|progressbar|loading_indicator|loading_spinner/i.test(xml);

  const hasLoadingText =
    /text="[^"]*loading[^"]*"|text="[^"]*please wait[^"]*"|text="[^"]*just a moment[^"]*"/i.test(xml);

  const hasShimmer = /shimmer|skeleton|placeholder/i.test(xml);

  // Count interactive elements — loading screens have very few
  const clickableCount = (xml.match(/clickable="true"/g) || []).length;

  return (hasSpinner || hasLoadingText || hasShimmer) && clickableCount < 5;
}

/**
 * If the screen is loading, wait for content to appear.
 * If the screen is not loading, returns immediately.
 *
 * @param {string} xml - Current screen XML
 * @param {{ timeoutMs?: number, pollIntervalMs?: number }} opts
 * @returns {Promise<{ isLoading: boolean, waitedMs: number, contentAppeared: boolean, xml: string }>}
 */
async function waitForContentLoad(xml, opts = {}) {
  // Don't poll dumpXml when UIAutomator is degraded
  if (adb.isUiAutomatorDegraded()) {
    return { isLoading: false, waitedMs: 0, contentAppeared: true, xml: xml || "" };
  }

  if (!isLoadingScreen(xml)) {
    return { isLoading: false, waitedMs: 0, contentAppeared: true, xml };
  }

  const timeout = opts.timeoutMs || LOADING_WAIT_TIMEOUT_MS || 8000;
  const pollInterval = opts.pollIntervalMs || LOADING_POLL_INTERVAL_MS || 500;
  const start = Date.now();

  log.info("Loading screen detected, waiting for content");

  while (Date.now() - start < timeout) {
    await sleep(pollInterval);
    const newXml = adb.dumpXml();

    if (!isLoadingScreen(newXml)) {
      const waitedMs = Date.now() - start;
      log.info({ waitedMs }, "Content appeared");
      return { isLoading: true, waitedMs, contentAppeared: true, xml: newXml };
    }
  }

  const finalXml = adb.dumpXml();
  log.warn({ timeoutMs: timeout }, "Timed out waiting for content, proceeding with current state");
  return { isLoading: true, waitedMs: timeout, contentAppeared: false, xml: finalXml };
}

/**
 * Visual loading detection via screenshot comparison.
 * Detects animation/transition by comparing two screenshots 500ms apart.
 * Useful for Compose/Flutter apps where XML has no ProgressBar class.
 *
 * @param {string} screenshotDir - Directory to store temporary screenshots
 * @param {number} clickableCount - Number of clickable elements in current XML
 * @returns {Promise<boolean>} True if the screen appears to be animating/loading
 */
async function isLoadingScreenVisual(screenshotDir, clickableCount) {
  if (clickableCount >= 5) return false;

  const path = require("path");
  const screenshotFp = require("./screenshot-fp");

  const ss1Path = path.join(screenshotDir, "_loading_check_1.png");
  const ss2Path = path.join(screenshotDir, "_loading_check_2.png");

  const ok1 = adb.screencap(ss1Path);
  if (!ok1) return false;

  await sleep(500);

  const ok2 = adb.screencap(ss2Path);
  if (!ok2) return false;

  const hash1 = screenshotFp.computeHash(ss1Path);
  const hash2 = screenshotFp.computeHash(ss2Path);

  if (hash1 === "no_screenshot" || hash2 === "no_screenshot") return false;

  const distance = screenshotFp.hammingDistance(hash1, hash2);
  const isAnimating = distance > 3 && distance < 20;

  if (isAnimating) {
    log.info({ hammingDistance: distance, clickableCount }, "Visual loading detected");
  }

  // Clean up temp files
  const fs = require("fs");
  try { fs.unlinkSync(ss1Path); } catch (_) {}
  try { fs.unlinkSync(ss2Path); } catch (_) {}

  return isAnimating;
}

module.exports = { isLoadingScreen, waitForContentLoad, isLoadingScreenVisual };
