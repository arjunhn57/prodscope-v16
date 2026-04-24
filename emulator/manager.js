"use strict";

const { execSync, execFileSync, exec } = require("child_process");
const { sleep } = require("../utils/sleep");
const {
  EMULATOR_AVD,
  SNAPSHOT_NAME,
  SNAPSHOT_BOOT_TIMEOUT,
  COLD_BOOT_TIMEOUT,
} = require("../config/defaults");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "emulator-manager" });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isEmulatorOnline() {
  try {
    const devices = execSync("adb devices", { timeout: 5000 }).toString();
    return devices.includes("emulator-") && !devices.includes("offline");
  } catch (e) {
    return false;
  }
}

function isBootCompleted() {
  try {
    return (
      execSync("adb shell getprop sys.boot_completed", { timeout: 5000 })
        .toString()
        .trim() === "1"
    );
  } catch (e) {
    return false;
  }
}

async function waitForBoot(timeoutSeconds) {
  const polls = timeoutSeconds; // 1 poll per second
  for (let i = 0; i < polls; i++) {
    if (isEmulatorOnline() && isBootCompleted()) return true;
    await sleep(1000);
  }
  return false;
}

function snapshotExists() {
  try {
    const list = execSync(
      `${process.env.ANDROID_SDK_ROOT || process.env.HOME + '/android-sdk'}/emulator/emulator -avd ${EMULATOR_AVD} -snapshot-list -no-window 2>&1`,
      { timeout: 10000 }
    ).toString();
    return list.includes(SNAPSHOT_NAME);
  } catch (e) {
    return false;
  }
}

function cleanupProcesses() {
  try { execSync("adb kill-server", { stdio: "ignore" }); } catch (e) {}
  try { execSync("pkill -f emulator", { stdio: "ignore" }); } catch (e) {}
  try { execSync("pkill -f qemu-system-x86_64", { stdio: "ignore" }); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Boot the emulator. Tries snapshot restore first (<15s), falls back to cold
 * boot (~2-4 min) if no snapshot is available.
 */
async function bootEmulator() {
  // Note: /dev/kvm permissions should be set at system startup (e.g. udev rule
  // or cloud-init). This is a safety fallback that warns if it's needed.
  try {
    execSync("test -w /dev/kvm", { stdio: "ignore" });
  } catch (e) {
    log.warn("/dev/kvm not writable. Run: sudo chmod 666 /dev/kvm");
  }
  cleanupProcesses();
  await sleep(2000);

  const hasSnapshot = snapshotExists();
  const mode = hasSnapshot ? "snapshot" : "cold";
  log.info({ mode, avd: EMULATOR_AVD }, "Emulator boot starting");

  if (hasSnapshot) {
    // Snapshot restore — fast path
    exec(
      `nohup ${process.env.ANDROID_SDK_ROOT || process.env.HOME + '/android-sdk'}/emulator/emulator -avd ${EMULATOR_AVD} -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -memory 4096 -cores 4 -snapshot ${SNAPSHOT_NAME} > /tmp/prodscope-emulator.log 2>&1 &`,
    );

    await sleep(3000);
    try { execSync("adb start-server", { stdio: "ignore" }); } catch (e) {}

    const booted = await waitForBoot(SNAPSHOT_BOOT_TIMEOUT);
    if (booted) {
      log.info({ timeoutSec: SNAPSHOT_BOOT_TIMEOUT }, "Emulator restored from snapshot");
      return;
    }

    // Snapshot restore failed — kill and fall through to cold boot
    log.warn("Snapshot restore failed, falling back to cold boot");
    cleanupProcesses();
    await sleep(2000);
  }

  // Cold boot — original path
  exec(
    `nohup ${process.env.ANDROID_SDK_ROOT || process.env.HOME + '/android-sdk'}/emulator/emulator -avd ${EMULATOR_AVD} -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -memory 4096 -cores 4 -no-snapshot > /tmp/prodscope-emulator.log 2>&1 &`,
  );

  await sleep(8000);
  try { execSync("adb start-server", { stdio: "ignore" }); } catch (e) {}

  const booted = await waitForBoot(COLD_BOOT_TIMEOUT);
  if (!booted) {
    let emuLog = "";
    try {
      emuLog = execSync("tail -n 80 /tmp/prodscope-emulator.log").toString();
    } catch (e) {}
    throw new Error("Emulator failed to boot. " + emuLog);
  }

  await sleep(2000);
  log.info("Emulator cold-booted successfully");
}

/**
 * Save a snapshot of the current emulator state.
 * Run this once manually after the emulator is booted and idle:
 *   node -e "require('./emulator/manager').saveSnapshot()"
 */
async function saveSnapshot() {
  log.info({ snapshot: SNAPSHOT_NAME }, "Saving snapshot...");
  execSync(`adb emu avd snapshot save ${SNAPSHOT_NAME}`, { timeout: 30000 });
  log.info("Snapshot saved.");
}

/**
 * Install an APK onto the running emulator.
 * Large APKs (80MB+) can take 60-90s on emulator — allow up to 120s with one retry.
 *
 * Flags used:
 *   -r  replace existing install
 *   -d  allow version-code downgrade — fixes INSTALL_FAILED_VERSION_DOWNGRADE
 *       when a newer build of the same package is already on the emulator
 *       from a prior test. Data loss is expected and intentional; we pm-clear
 *       immediately after install anyway.
 *   -t  allow test-only APKs (some debug builds set android:testOnly="true")
 *
 * Also uses execFileSync with an args array instead of shell-concatenated
 * strings — eliminates a latent shell-injection surface on apkPath.
 */
function installApk(apkPath) {
  log.info({ apkPath }, "Installing APK (this may take up to 2 minutes for large apps)...");
  const args = ["install", "-r", "-d", "-t", apkPath];
  try {
    execFileSync("adb", args, { timeout: 120000 });
  } catch (err) {
    log.warn({ errCode: err.code, errMsg: err.message }, "First install attempt failed — retrying after adb reconnect");
    try {
      execFileSync("adb", ["wait-for-device"], { timeout: 15000 });
    } catch (_) {}
    // Second attempt: if it's still failing, try an explicit uninstall of
    // the target package first to defeat stubborn signature / test-only /
    // profile-owner collisions that -r -d alone can't resolve.
    //
    // Extraction: adb writes messages like `Existing package org.wikipedia
    // signatures do not match` or `Package com.foo.bar is already installed`.
    // Require a java-style DOTTED identifier so we can't mis-extract ordinary
    // English words ("ignoring", "signatures", etc.). Falls back to parsing
    // the APK manifest if no dotted package name is found in the error.
    const dottedPkgRe = /\b([a-z][a-z0-9_]+(?:\.[a-z0-9_]+)+)\b/i;
    let blockingPkg = null;
    const errStr = (err && err.message) || "";
    const pkgFromErr = errStr.match(dottedPkgRe);
    if (pkgFromErr) blockingPkg = pkgFromErr[1];
    // Manifest fallback — if the error didn't name a package, parse the APK
    // we're about to install. Cheap aapt2 call, authoritative answer.
    if (!blockingPkg) {
      try {
        const badging = execFileSync("aapt2", ["dump", "badging", apkPath], {
          timeout: 15000, encoding: "utf-8",
        });
        const m = badging.match(/package:\s+name='([^']+)'/);
        if (m) blockingPkg = m[1];
      } catch (_) { /* aapt2 may not be on PATH on every box — swallow */ }
    }
    if (blockingPkg) {
      try {
        execFileSync("adb", ["uninstall", blockingPkg], { timeout: 15000, stdio: "ignore" });
        log.info({ package: blockingPkg }, "Force-uninstalled blocking package before retry");
      } catch (_) {}
    }
    execFileSync("adb", args, { timeout: 120000 });
  }
  log.info("APK installed successfully");
}

/**
 * Kill the running emulator. Swallows errors (best-effort cleanup).
 */
function killEmulator() {
  try {
    execSync("adb emu kill", { stdio: "ignore" });
  } catch (e) {}
}

/**
 * E6: Reset the emulator without killing it — uninstall previous APK,
 * clear data, go home. Takes ~5s vs 15-240s for a full reboot.
 *
 * @param {string} [previousPackage] - Package name to uninstall from previous job
 * @returns {Promise<boolean>} true if reset succeeded
 */
async function resetEmulator(previousPackage) {
  log.info("Warm reset (no reboot)...");

  try {
    // Uninstall previous app (uses execFileSync for safety — previousPackage is a parameter)
    if (previousPackage) {
      try {
        execFileSync("adb", ["uninstall", previousPackage], { timeout: 15000, stdio: "ignore" });
        log.info({ package: previousPackage }, "Uninstalled previous package");
      } catch (_) {
        // App may already be uninstalled — that's fine
      }
    }

    // Go home
    execFileSync("adb", ["shell", "input", "keyevent", "KEYCODE_HOME"], { timeout: 5000, stdio: "ignore" });
    await sleep(1000);

    // Kill background apps
    execFileSync("adb", ["shell", "am", "kill-all"], { timeout: 5000, stdio: "ignore" });

    // Verify emulator is still alive and responsive
    if (!isEmulatorOnline() || !isBootCompleted()) {
      log.warn("Warm reset failed — emulator unresponsive");
      return false;
    }

    log.info("Warm reset complete (~5s)");
    return true;
  } catch (e) {
    log.warn({ err: e }, "Warm reset error");
    return false;
  }
}

module.exports = { bootEmulator, saveSnapshot, installApk, killEmulator, resetEmulator };
