"use strict";

/**
 * wireframe.js — Generate synthetic wireframe text from XML hierarchy.
 *
 * When adb screencap returns a blank/black image (FLAG_SECURE apps like
 * banking, auth screens), the vision module can't see anything useful.
 * This module detects blank screenshots and generates a text-based
 * wireframe description from the XML so the vision model still gets
 * useful spatial information.
 */

const fs = require("fs");

/**
 * Check if a screenshot is blank/black (FLAG_SECURE or capture failure).
 * Reads the raw PNG bytes and checks if the image data is mostly zeros.
 *
 * @param {string} screenshotPath
 * @returns {boolean}
 */
function isBlankScreenshot(screenshotPath) {
  if (!screenshotPath || !fs.existsSync(screenshotPath)) return true;

  let buf;
  try {
    buf = fs.readFileSync(screenshotPath);
  } catch (_) {
    return true;
  }

  // Too small to be a real screenshot (real Android screenshots are 50KB+)
  if (buf.length < 1000) return true;

  // Sample the IDAT chunk area — skip PNG header (~50 bytes).
  // If nearly all bytes are low-value, the image is black/blank.
  const sampleStart = Math.min(100, buf.length);
  const sampleEnd = Math.min(buf.length, 4000);
  const sample = buf.slice(sampleStart, sampleEnd);

  if (sample.length === 0) return true;

  let nonBlackBytes = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] > 15) nonBlackBytes++;
  }

  // PNG-compressed black images still have some non-zero bytes in headers/metadata,
  // but real screenshots have much higher entropy. Threshold: <8% non-black.
  return nonBlackBytes < sample.length * 0.08;
}

/**
 * Generate a text-based wireframe description from the XML hierarchy.
 * Lists each visible element with its type, label, and position.
 *
 * @param {string} xml - UI automator XML dump
 * @returns {string} Human-readable wireframe description
 */
function generateWireframeText(xml) {
  if (!xml) return "[No XML available]";

  const lines = [];
  // Match elements with bounds — extract class, text, resource-id, content-desc, bounds
  const elementRegex = /<node\s[^>]*?(?=\/>|>)/g;
  let match;

  while ((match = elementRegex.exec(xml)) !== null) {
    const node = match[0];

    // Extract attributes
    const boundsMatch = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!boundsMatch) continue;

    const x1 = parseInt(boundsMatch[1], 10);
    const y1 = parseInt(boundsMatch[2], 10);
    const x2 = parseInt(boundsMatch[3], 10);
    const y2 = parseInt(boundsMatch[4], 10);
    const w = x2 - x1;
    const h = y2 - y1;

    // Skip tiny or zero-size elements
    if (w < 10 || h < 10) continue;

    const textMatch = node.match(/text="([^"]*)"/);
    const resIdMatch = node.match(/resource-id="([^"]*)"/);
    const descMatch = node.match(/content-desc="([^"]*)"/);
    const classMatch = node.match(/class="([^"]*)"/);
    const clickableMatch = node.match(/clickable="(true|false)"/);

    const text = textMatch ? textMatch[1] : "";
    const resId = resIdMatch ? resIdMatch[1] : "";
    const desc = descMatch ? descMatch[1] : "";
    const className = classMatch ? classMatch[1] : "";
    const clickable = clickableMatch ? clickableMatch[1] === "true" : false;

    // Build a readable label — prefer text > content-desc > resource-id > class
    const shortClass = className.split(".").pop() || "";
    const label = text || desc || resId.split("/").pop() || shortClass;

    if (!label) continue;

    const clickTag = clickable ? " [CLICKABLE]" : "";
    lines.push(`  ${shortClass}: "${label}" at (${x1},${y1})-(${x2},${y2})${clickTag}`);
  }

  if (lines.length === 0) {
    return "[FLAG_SECURE: screenshot blocked, no parseable UI elements in XML]";
  }

  return (
    "WIREFRAME (screenshot blocked by FLAG_SECURE — generated from XML):\n" +
    lines.join("\n")
  );
}

module.exports = { isBlankScreenshot, generateWireframeText };
