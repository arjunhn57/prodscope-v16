/**
 * adb.js — Thin ADB command wrapper
 * Centralizes all adb shell interactions with error handling + timeouts.
 */

const { execSync, execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const { logger } = require("../lib/logger");
const log = logger.child({ component: "adb" });

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT = 15000;

// ── Device targeting (multi-emulator support) ──
let _serial = null;

/**
 * Set the target device serial for all subsequent ADB commands.
 * Pass null to reset to default (single device).
 * @param {string|null} serial - e.g., "emulator-5554"
 */
function setSerial(serial) {
  _serial = serial;
}

/** Get the current serial flag string for ADB commands. */
function serialFlag() {
  return _serial ? `-s ${_serial} ` : '';
}

// ── UIAutomator health tracking ──
let consecutiveXmlFailures = 0;
let uiAutomatorDegraded = false;
const XML_FAIL_THRESHOLD = 3;

function run(cmd, opts = {}) {
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  // Auto-inject serial flag for multi-emulator support
  const finalCmd = (_serial && cmd.startsWith('adb '))
    ? `adb ${serialFlag()}${cmd.slice(4)}`
    : cmd;
  try {
    return execSync(finalCmd, { timeout, encoding: 'utf-8', ...opts }).toString().trim();
  } catch (err) {
    if (opts.ignoreError) return '';
    throw new Error(`ADB command failed: ${finalCmd}\n${err.message}`);
  }
}

/** Capture a screenshot to outPath. Returns true on success. */
function screencap(outPath) {
  try {
    execSync(`adb ${serialFlag()}exec-out screencap -p > "${outPath}"`, { timeout: DEFAULT_TIMEOUT });
    return fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
  } catch (err) {
    return false;
  }
}

/** Dump the current UI hierarchy XML. Returns XML string or ''. */
function dumpXml() {
  // Short-circuit if UIAutomator is known to be dead
  if (uiAutomatorDegraded) return '';

  try {
    const raw = run('adb exec-out uiautomator dump /dev/tty 2>/dev/null || echo ""', { ignoreError: true });
    // uiautomator prefixes with "UI hierchary dumped to: /dev/tty" — strip it
    const xmlStart = raw.indexOf('<?xml');
    if (xmlStart >= 0) {
      consecutiveXmlFailures = 0;
      return raw.substring(xmlStart);
    }

    // Failed — null root node, empty, or error
    consecutiveXmlFailures++;
    if (consecutiveXmlFailures >= XML_FAIL_THRESHOLD) {
      uiAutomatorDegraded = true;
      log.warn({ consecutiveXmlFailures }, "UIAutomator degraded — short-circuiting future dumps");
    }
    return raw;
  } catch (e) {
    consecutiveXmlFailures++;
    if (consecutiveXmlFailures >= XML_FAIL_THRESHOLD) {
      uiAutomatorDegraded = true;
      log.warn({ consecutiveXmlFailures }, "UIAutomator degraded");
    }
    return '';
  }
}

/**
 * Attempt to restart the UIAutomator service.
 * Kills the process, waits briefly, then verifies with a test dump.
 * Returns true if UIAutomator is working again.
 */
function restartUiAutomator() {
  log.info("Attempting UIAutomator restart");
  run('adb shell pkill -f uiautomator', { ignoreError: true });
  run('adb shell am force-stop com.android.commands.uiautomator', { ignoreError: true });

  // Brief synchronous wait for process cleanup (use a short sleep via shell)
  run('adb shell sleep 1', { ignoreError: true, timeout: 5000 });

  // Verify with a test dump
  try {
    const testRaw = run('adb exec-out uiautomator dump /dev/tty 2>/dev/null || echo ""', { ignoreError: true });
    const ok = testRaw && testRaw.includes('<?xml');
    if (ok) {
      consecutiveXmlFailures = 0;
      uiAutomatorDegraded = false;
      log.info("UIAutomator restart succeeded");
    } else {
      log.warn("UIAutomator restart failed — staying in degraded mode");
    }
    return ok;
  } catch (e) {
    log.error({ err: e }, "UIAutomator restart verification failed");
    return false;
  }
}

/** Check if UIAutomator is currently in degraded mode. */
function isUiAutomatorDegraded() {
  return uiAutomatorDegraded;
}

/** Reset UIAutomator state (e.g. at crawl start). */
function resetUiAutomatorState() {
  consecutiveXmlFailures = 0;
  uiAutomatorDegraded = false;
}

// ── E1: Async ADB variants for parallel capture ──

/**
 * Async screenshot capture. Pipes adb exec-out to file without shell.
 * Returns true on success.
 */
function screencapAsync(outPath) {
  return new Promise((resolve) => {
    try {
      const ws = fs.createWriteStream(outPath);
      const args = _serial ? ['-s', _serial, 'exec-out', 'screencap', '-p'] : ['exec-out', 'screencap', '-p'];
      const child = require('child_process').spawn('adb', args, { timeout: DEFAULT_TIMEOUT });
      child.stdout.pipe(ws);
      child.on('close', (code) => {
        try {
          resolve(code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0);
        } catch (_) { resolve(false); }
      });
      child.on('error', () => resolve(false));
      // Kill if taking too long
      setTimeout(() => { try { child.kill(); } catch (_) {} }, DEFAULT_TIMEOUT);
    } catch (_) { resolve(false); }
  });
}

/**
 * Async XML dump. Returns XML string or ''.
 */
async function dumpXmlAsync() {
  if (uiAutomatorDegraded) return '';
  try {
    const dumpArgs = _serial
      ? ['-s', _serial, 'exec-out', 'uiautomator', 'dump', '/dev/tty']
      : ['exec-out', 'uiautomator', 'dump', '/dev/tty'];
    const { stdout } = await execFileAsync('adb', dumpArgs, { timeout: DEFAULT_TIMEOUT });
    const raw = (stdout || '').toString();
    const xmlStart = raw.indexOf('<?xml');
    if (xmlStart >= 0) {
      consecutiveXmlFailures = 0;
      return raw.substring(xmlStart);
    }
    consecutiveXmlFailures++;
    if (consecutiveXmlFailures >= XML_FAIL_THRESHOLD) {
      uiAutomatorDegraded = true;
      log.warn({ consecutiveXmlFailures }, "UIAutomator degraded — short-circuiting");
    }
    return raw;
  } catch (e) {
    consecutiveXmlFailures++;
    if (consecutiveXmlFailures >= XML_FAIL_THRESHOLD) {
      uiAutomatorDegraded = true;
    }
    return '';
  }
}

/**
 * Async get current foreground activity.
 */
async function getCurrentActivityAsync() {
  try {
    const actArgs = _serial
      ? ['-s', _serial, 'shell', 'dumpsys', 'activity', 'activities']
      : ['shell', 'dumpsys', 'activity', 'activities'];
    const { stdout } = await execFileAsync('adb', actArgs, { timeout: DEFAULT_TIMEOUT });
    const out = (stdout || '').toString();
    const line = out.split('\n').find(l => l.includes('mResumedActivity'));
    if (line) {
      const match = line.match(/u0\s+(\S+\/\S+)/);
      return match ? match[1] : 'unknown';
    }
    return 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

/** Tap at (x, y) coordinates. */
function tap(x, y) {
  run(`adb shell input tap ${x} ${y}`);
}

/** Swipe from (x1,y1) to (x2,y2) over durationMs. */
function swipe(x1, y1, x2, y2, durationMs = 300) {
  run(`adb shell input swipe ${x1} ${y1} ${x2} ${y2} ${durationMs}`);
}

/** Press the Back button. */
function pressBack() {
  run('adb shell input keyevent KEYCODE_BACK');
}

/** Press the Home button. */
function pressHome() {
  run('adb shell input keyevent KEYCODE_HOME');
}

/** Press Enter/Return. */
function pressEnter() {
  run('adb shell input keyevent KEYCODE_ENTER');
}

/**
 * Emit a raw Android key event. Use a KEYCODE_* name from
 * https://developer.android.com/reference/android/view/KeyEvent
 *
 * Examples:
 *   keyEvent('KEYCODE_MENU')
 *   keyEvent('KEYCODE_APP_SWITCH')
 *   keyEvent('KEYCODE_ESCAPE')
 *   keyEvent('KEYCODE_DEL')
 *
 * @param {string} code
 */
function keyEvent(code) {
  if (typeof code !== 'string' || code.length === 0) {
    throw new Error('keyEvent requires a KEYCODE_* string');
  }
  // Guard against shell injection — only allow uppercase letters, digits, underscores.
  if (!/^[A-Z0-9_]+$/.test(code)) {
    throw new Error(`keyEvent: suspicious code ${code}`);
  }
  run(`adb shell input keyevent ${code}`);
}

/** Type text into the currently focused field. */
function inputText(text) {
  // Replace spaces with %s (ADB input text syntax)
  const adbText = text.replace(/ /g, '%s');
  // Escape shell metacharacters for device shell
  const shellSafe = adbText.replace(/([\\$"`!;|&<>(){}#*?~'\n])/g, '\\$1');
  // Use execFileSync to bypass host shell entirely (prevents command injection)
  const args = _serial
    ? ['-s', _serial, 'shell', 'input', 'text', shellSafe]
    : ['shell', 'input', 'text', shellSafe];
  execFileSync('adb', args, { timeout: DEFAULT_TIMEOUT, encoding: 'utf-8' });
}

/** Get the current foreground activity. */
function getCurrentActivity() {
  const out = run('adb shell dumpsys activity activities | grep mResumedActivity', { ignoreError: true });
  const match = out.match(/u0\s+(\S+\/\S+)/);
  return match ? match[1] : 'unknown';
}

/** Get the current foreground package name. */
function getCurrentPackage() {
  const activity = getCurrentActivity();
  return activity.includes('/') ? activity.split('/')[0] : activity;
}

/** List third-party packages. */
function listThirdPartyPackages() {
  const out = run('adb shell pm list packages -3', { ignoreError: true });
  return out
    .split('\n')
    .map(line => line.replace('package:', '').trim())
    .filter(Boolean);
}

/** Launch an app by package name using monkey. */
function launchApp(packageName) {
  run(`adb shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, { ignoreError: true });
}

/** Install an APK from a local file path. */
function installApp(apkPath) {
  log.info({ apkPath }, "Installing APK");
  run(`adb install -g -r "${apkPath}"`, { timeout: 120000 }); // 2-min timeout for large APKs
}

/** Uninstall an app by package name. */
function uninstallApp(packageName) {
  log.info({ packageName }, "Uninstalling app");
  run(`adb shell pm uninstall ${packageName}`, { ignoreError: true });
}

/** Clear all data and cache for a package name. */
function clearAppData(packageName) {
  log.info({ packageName }, "Clearing app data");
  run(`adb shell pm clear ${packageName}`, { ignoreError: true });
}

/** Wait for device with timeout. */
function waitForDevice(timeoutMs = 10000) {
  run('adb wait-for-device', { timeout: timeoutMs });
}

/**
 * Check if an emulator/device is online and in 'device' state.
 * Returns false for offline, empty device list, or errors.
 */
function isDeviceOnline() {
  try {
    const out = run('adb devices', { ignoreError: true });
    const lines = out.split('\n').slice(1).map(s => s.trim()).filter(Boolean);
    return lines.some(line => line.startsWith('emulator-') && line.endsWith('\tdevice'));
  } catch (e) {
    return false;
  }
}

/**
 * Ensure the device is online AND fully booted.
 * Returns true only when boot prop sys.boot_completed is '1'.
 */
function ensureDeviceReady() {
  try {
    if (!isDeviceOnline()) return false;
    const boot = run('adb shell getprop sys.boot_completed', { ignoreError: true });
    return boot.trim() === '1';
  } catch (e) {
    return false;
  }
}

/**
 * Fast ANR check and dismissal using dumpsys window
 * Extracts top-most error window and aggressively clicks 'Close app'
 */
/**
 * C3: File-based screenshot fallback when exec-out streaming fails.
 * Takes screenshot on device, pulls via adb pull.
 */
function screencapFileBased(outPath) {
  const devicePath = "/sdcard/prodscope_capture.png";
  try {
    run(`adb shell screencap -p ${devicePath}`, { timeout: DEFAULT_TIMEOUT });
    run(`adb pull ${devicePath} "${outPath}"`, { timeout: DEFAULT_TIMEOUT });
    run(`adb shell rm ${devicePath}`, { ignoreError: true, timeout: 5000 });
    return fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
  } catch (err) {
    return false;
  }
}

/**
 * C4: Attempt to reconnect ADB when device goes offline.
 * Kills ADB server, restarts it, waits for device.
 * @returns {boolean} true if device is back online
 */
function reconnectDevice() {
  log.info("Attempting ADB reconnect");
  try {
    run("adb reconnect", { ignoreError: true, timeout: 10000 });
  } catch (_) {}

  // Wait briefly for reconnect
  try {
    run("adb wait-for-device", { timeout: 10000 });
  } catch (_) {}

  // Check if we're back
  if (isDeviceOnline()) {
    log.info("ADB reconnect succeeded");
    return true;
  }

  // Fallback: kill and restart ADB server
  log.warn("Reconnect failed — restarting ADB server");
  try {
    run("adb kill-server", { ignoreError: true, timeout: 5000 });
    run("adb start-server", { ignoreError: true, timeout: 10000 });
    run("adb wait-for-device", { timeout: 15000 });
  } catch (_) {}

  const online = isDeviceOnline();
  log.info({ online }, `ADB server restart ${online ? "succeeded" : "failed"}`);
  return online;
}

/**
 * C12: Dismiss the on-screen keyboard if it's visible.
 * @returns {boolean} true if keyboard was dismissed
 */
function dismissKeyboard() {
  try {
    const imeState = run("adb shell dumpsys input_method | grep mInputShown", { ignoreError: true });
    if (imeState && imeState.includes("mInputShown=true")) {
      run("adb shell input keyevent KEYCODE_ESCAPE", { ignoreError: true });
      // Verify
      const after = run("adb shell dumpsys input_method | grep mInputShown", { ignoreError: true });
      if (after && after.includes("mInputShown=false")) {
        log.info("Keyboard dismissed");
        return true;
      }
      // Fallback: press back
      run("adb shell input keyevent KEYCODE_BACK", { ignoreError: true });
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function dismissAnrIfPresent() {
  try {
    const out = run('adb shell dumpsys window windows | grep -i "Application Error:"', { ignoreError: true });
    if (out && out.trim() !== '') {
      log.warn("ANR dialog detected — force injecting KEYCODE_ENTER and KEYCODE_BACK");
      run('adb shell input keyevent KEYCODE_DPAD_RIGHT', { ignoreError: true });
      run('adb shell input keyevent KEYCODE_ENTER', { ignoreError: true });
      run('adb shell input keyevent KEYCODE_BACK', { ignoreError: true });
      return true;
    }
  } catch(e) {}
  return false;
}

/**
 * Get device screen resolution via `adb shell wm size`.
 * Returns { w, h } in pixels. Caches result for the session.
 */
let _cachedScreenSize = null;
function getScreenSize() {
  if (_cachedScreenSize) return _cachedScreenSize;
  try {
    const out = run("adb shell wm size", { ignoreError: true });
    const match = out.match(/(\d+)x(\d+)/);
    if (match) {
      _cachedScreenSize = { w: parseInt(match[1]), h: parseInt(match[2]) };
      log.info({ screenSize: _cachedScreenSize }, "Device screen size detected");
      return _cachedScreenSize;
    }
  } catch (_) {}
  _cachedScreenSize = { w: 1080, h: 2400 };
  log.warn({ screenSize: _cachedScreenSize }, "Could not detect screen size, using default");
  return _cachedScreenSize;
}

module.exports = {
  run,
  screencap,
  screencapAsync,
  screencapFileBased,
  dumpXml,
  dumpXmlAsync,
  tap,
  swipe,
  pressBack,
  pressHome,
  pressEnter,
  keyEvent,
  inputText,
  getCurrentActivity,
  getCurrentActivityAsync,
  getCurrentPackage,
  listThirdPartyPackages,
  launchApp,
  installApp,
  uninstallApp,
  clearAppData,
  waitForDevice,
  isDeviceOnline,
  ensureDeviceReady,
  reconnectDevice,
  dismissAnrIfPresent,
  dismissKeyboard,
  restartUiAutomator,
  isUiAutomatorDegraded,
  resetUiAutomatorState,
  setSerial,
  getScreenSize,
};
