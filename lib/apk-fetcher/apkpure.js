"use strict";

/**
 * lib/apk-fetcher/apkpure — APKPure adapter.
 *
 * APKPure is a public mirror of free Android apps. We do best-effort
 * scraping with a real browser user-agent. On any failure (Cloudflare
 * challenge, rate limit, missing app, parse failure) we throw with a
 * structured code so the orchestrator can fall through to the next
 * adapter.
 *
 * V1 quality: a regex-based parser that targets APKPure's stable
 * "Download APK" link shape. V1.5 plan: switch to a maintained mirror
 * API or integrate with a paid CDN to reduce fragility.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../logger");

const log = logger.child({ component: "apk-fetcher-apkpure" });

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PAGE_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000; // Large APKs take a while

/**
 * Fetch the APK for a Play Store package name via APKPure.
 *
 * @param {string} packageName       e.g. "com.biztoso.app"
 * @param {string} cacheDir          dir to write the downloaded APK into
 * @returns {Promise<{apkPath: string, packageName: string, source: "apkpure"}>}
 */
async function fetchFromApkPure(packageName, cacheDir) {
  if (!packageName) {
    const err = new Error("apkpure: missing packageName");
    err.code = "invalid_arg";
    throw err;
  }
  const pageUrl = `https://apkpure.com/x/${encodeURIComponent(packageName)}`;
  log.info({ packageName, pageUrl }, "apkpure: fetching app page");

  const pageRes = await fetchWithTimeout(pageUrl, PAGE_TIMEOUT_MS);
  if (!pageRes.ok) {
    const err = new Error(`apkpure page returned HTTP ${pageRes.status}`);
    err.code = "page_status";
    err.status = pageRes.status;
    throw err;
  }
  const pageHtml = await pageRes.text();

  // Common Cloudflare challenge marker — bail early so we don't try to
  // parse a challenge page as the app page.
  if (/cf-browser-verification|just a moment\.\.\.|attention required/i.test(pageHtml)) {
    const err = new Error("apkpure: Cloudflare challenge");
    err.code = "cloudflare_challenge";
    throw err;
  }

  // The actual download link lives behind a redirect URL on the page.
  // APKPure's download buttons currently have href patterns like:
  //   /{slug}/{package}/download/{versionCode}
  // and direct links such as:
  //   /APK/{slug}-... .apk
  const candidates = [];
  for (const m of pageHtml.matchAll(/href="([^"]*\/APK\/[^"]+\.apk[^"]*)"/gi)) {
    candidates.push(m[1]);
  }
  const downloadButtonRegex = new RegExp(
    `href="([^"]*/${escapeForRegex(packageName)}/download[^"]*)"`,
    "gi",
  );
  for (const m of pageHtml.matchAll(downloadButtonRegex)) {
    candidates.push(m[1]);
  }

  if (candidates.length === 0) {
    const err = new Error("apkpure: no download link found on app page");
    err.code = "no_download_link";
    throw err;
  }

  const downloadPageUrl = absolutize(candidates[0], pageUrl);
  log.info({ packageName, downloadPageUrl }, "apkpure: requesting download page");

  // The download page issues a redirect to the actual binary. Many APK
  // mirrors set an HTML meta-refresh or a JS redirect to a CDN URL with
  // an expiring token. Follow redirects via fetch's default redirect
  // mode ("follow") and accept the final binary stream.
  const dlRes = await fetchWithTimeout(downloadPageUrl, DOWNLOAD_TIMEOUT_MS, {
    accept: "application/vnd.android.package-archive,*/*",
  });
  if (!dlRes.ok) {
    const err = new Error(`apkpure download page returned HTTP ${dlRes.status}`);
    err.code = "download_status";
    err.status = dlRes.status;
    throw err;
  }
  const ctype = (dlRes.headers.get("content-type") || "").toLowerCase();
  if (
    !ctype.includes("vnd.android.package-archive") &&
    !ctype.includes("application/octet-stream") &&
    !ctype.includes("application/zip")
  ) {
    // The download page returned HTML instead of the APK — the
    // meta-refresh / JS redirect path didn't auto-follow. We could parse
    // the HTML for the real binary URL but that's adapter-version churn
    // risk; bail and let the orchestrator pick another adapter.
    const err = new Error(`apkpure download page returned non-APK content-type: ${ctype}`);
    err.code = "non_apk_response";
    throw err;
  }

  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  const apkPath = path.join(cacheDir, `${packageName}.apk`);
  const arrayBuf = await dlRes.arrayBuffer();
  fs.writeFileSync(apkPath, Buffer.from(arrayBuf));
  const sizeMB = (Buffer.from(arrayBuf).length / 1024 / 1024).toFixed(2);
  log.info({ packageName, apkPath, sizeMB }, "apkpure: APK saved");

  return { apkPath, packageName, source: "apkpure" };
}

// ── helpers ────────────────────────────────────────────────────────────

function escapeForRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function absolutize(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch (_) {
    return href;
  }
}

async function fetchWithTimeout(url, timeoutMs, extraHeaders) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: Object.assign(
        {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
        },
        extraHeaders || {},
      ),
      redirect: "follow",
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  fetchFromApkPure,
};
