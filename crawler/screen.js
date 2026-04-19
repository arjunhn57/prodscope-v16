/**
 * screen.js — Screen state capture
 * Captures a complete snapshot of the current device state:
 * screenshot PNG + UI XML + current activity.
 */

const path = require('path');
const adb = require('./adb');

/**
 * Capture the current screen state.
 * Returns:
 *   - snapshot object on success
 *   - { error: 'device_offline' } if device is not ready
 *   - { error: 'capture_failed' } if screenshot fails
 *
 * @param {string} screenshotDir - Directory to save screenshot PNGs
 * @param {number|string} index - Screen index for filename
 * @returns {{ screenshotPath: string, xml: string, activity: string, timestamp: number, index: number|string } | { error: string }}
 */
function capture(screenshotDir, index) {
  const screenshotPath = path.join(screenshotDir, `screen_${index}.png`);

  if (!adb.ensureDeviceReady()) {
    return { error: 'device_offline' };
  }

  const ok = adb.screencap(screenshotPath);

  if (!adb.ensureDeviceReady()) {
    return { error: 'device_offline' };
  }

  const xml = adb.dumpXml();
  const activity = adb.getCurrentActivity();

  // If screenshot failed (e.g. FLAG_SECURE) but XML is available, return partial snapshot
  if (!ok) {
    if (xml && xml.includes('<?xml')) {
      return {
        screenshotPath: null,
        screenshotFailed: true,
        xml,
        activity,
        timestamp: Date.now(),
        index,
      };
    }
    const fallbackOk = adb.screencapFileBased(screenshotPath);
    const fallbackXml = adb.dumpXml();
    if (fallbackOk && fallbackXml && fallbackXml.includes('<?xml')) {
      return {
        screenshotPath,
        xml: fallbackXml,
        activity,
        timestamp: Date.now(),
        index,
      };
    }
    if (fallbackOk) {
      return {
        screenshotPath,
        xml: '',
        activity,
        timestamp: Date.now(),
        index,
      };
    }
    return { error: 'capture_failed' };
  }

  return {
    screenshotPath,
    xml,
    activity,
    timestamp: Date.now(),
    index,
  };
}

/**
 * E1: Async parallel capture — screenshot, XML dump, and activity query run concurrently.
 * Saves ~1-2s per step by overlapping I/O.
 *
 * @param {string} screenshotDir
 * @param {number|string} index
 * @returns {Promise<object>} Same shape as sync capture()
 */
async function captureAsync(screenshotDir, index) {
  const screenshotPath = path.join(screenshotDir, `screen_${index}.png`);

  if (!adb.ensureDeviceReady()) {
    return { error: 'device_offline' };
  }

  // Run screenshot + XML + activity in parallel
  const [ok, xml, activity] = await Promise.all([
    adb.screencapAsync(screenshotPath),
    adb.dumpXmlAsync(),
    adb.getCurrentActivityAsync(),
  ]);

  if (!adb.ensureDeviceReady()) {
    return { error: 'device_offline' };
  }

  if (!ok) {
    if (xml && xml.includes('<?xml')) {
      return {
        screenshotPath: null,
        screenshotFailed: true,
        xml,
        activity,
        timestamp: Date.now(),
        index,
      };
    }
    const fallbackOk = adb.screencapFileBased(screenshotPath);
    const fallbackXml = adb.dumpXml();
    if (fallbackOk && fallbackXml && fallbackXml.includes('<?xml')) {
      return {
        screenshotPath,
        xml: fallbackXml,
        activity,
        timestamp: Date.now(),
        index,
      };
    }
    if (fallbackOk) {
      return {
        screenshotPath,
        xml: '',
        activity,
        timestamp: Date.now(),
        index,
      };
    }
    return { error: 'capture_failed' };
  }

  return {
    screenshotPath,
    xml,
    activity,
    timestamp: Date.now(),
    index,
  };
}

module.exports = { capture, captureAsync };
