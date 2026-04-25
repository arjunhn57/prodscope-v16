"use strict";

/**
 * lib/apk-fetcher — Server-side APK fetcher for the "Paste Play Store URL"
 * input mode. Given a Play Store URL, downloads the public APK from a
 * public mirror and returns the local file path. Adapter-pattern with
 * fallback chain.
 *
 * V1 chain: APKPure → (future) APKMirror → throw apk_unavailable.
 * Disk cache by package name + 24h TTL keeps repeated runs cheap.
 *
 * V1 quality is best-effort — public mirrors have anti-bot protections
 * that fail unpredictably. The frontend's UX message points users to
 * direct upload as a fallback, so a fetch failure isn't a dead end.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { logger } = require("../logger");
const { fetchFromApkPure } = require("./apkpure");

const log = logger.child({ component: "apk-fetcher" });

const CACHE_DIR = path.join(os.tmpdir(), "apk-cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Match canonical Play Store URLs and locale-prefixed variants. Returns
 * true if the string is structurally a Play Store app URL.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isValidPlayStoreUrl(url) {
  if (typeof url !== "string") return false;
  return /^https?:\/\/(www\.)?play\.google\.com\/store\/apps\/details\?(?:[^#]*&)?id=[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+/i.test(
    url.trim(),
  );
}

/**
 * Extract the Android package name (e.g. com.example.app) from a Play
 * Store URL's id= query parameter.
 *
 * @param {string} url
 * @returns {string|null}
 */
function extractPackageName(url) {
  if (!isValidPlayStoreUrl(url)) return null;
  const m = url.match(/[?&]id=([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)/i);
  return m ? m[1] : null;
}

/**
 * Cache hit if the cached APK is younger than CACHE_TTL_MS. Returns the
 * path to the cached APK on hit, null otherwise.
 *
 * @param {string} packageName
 * @returns {string|null}
 */
function checkCache(packageName) {
  const apkPath = path.join(CACHE_DIR, `${packageName}.apk`);
  if (!fs.existsSync(apkPath)) return null;
  try {
    const stat = fs.statSync(apkPath);
    const age = Date.now() - stat.mtimeMs;
    if (age > CACHE_TTL_MS) return null;
    if (stat.size < 1024) return null; // sanity: corrupt / empty
    return apkPath;
  } catch (_) {
    return null;
  }
}

/**
 * Fetch the APK for a Play Store URL via the public-mirror chain. Returns
 * a local filesystem path the caller can hand to the existing pipeline.
 *
 * @param {string} playStoreUrl
 * @returns {Promise<{apkPath: string, packageName: string, source: string}>}
 */
async function fetchApkFromUrl(playStoreUrl) {
  if (!isValidPlayStoreUrl(playStoreUrl)) {
    const err = new Error("Invalid Play Store URL");
    err.code = "invalid_url";
    throw err;
  }
  const packageName = extractPackageName(playStoreUrl);
  if (!packageName) {
    const err = new Error("Could not extract package name from Play Store URL");
    err.code = "invalid_url";
    throw err;
  }

  // Fast path: cache hit.
  const cached = checkCache(packageName);
  if (cached) {
    log.info({ packageName, apkPath: cached }, "apk-fetcher: cache hit");
    return { apkPath: cached, packageName, source: "cache" };
  }

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  const adapterErrors = [];

  // Adapter chain. Each adapter throws on failure; we try the next.
  for (const adapter of [{ name: "apkpure", fn: fetchFromApkPure }]) {
    try {
      const result = await adapter.fn(packageName, CACHE_DIR);
      log.info(
        { packageName, source: result.source, apkPath: result.apkPath },
        "apk-fetcher: success",
      );
      return result;
    } catch (err) {
      adapterErrors.push({
        adapter: adapter.name,
        code: err && err.code,
        message: err && err.message,
      });
      log.warn(
        { packageName, adapter: adapter.name, code: err && err.code, err: err && err.message },
        "apk-fetcher: adapter failed, trying next",
      );
    }
  }

  const finalErr = new Error(
    "We couldn't fetch this APK from any public mirror. Please upload the APK directly.",
  );
  finalErr.code = "apk_unavailable";
  finalErr.adapterErrors = adapterErrors;
  throw finalErr;
}

module.exports = {
  fetchApkFromUrl,
  isValidPlayStoreUrl,
  extractPackageName,
  checkCache,
  CACHE_DIR,
  CACHE_TTL_MS,
};
