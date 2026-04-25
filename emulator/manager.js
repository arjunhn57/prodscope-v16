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
    // Extraction is anchored on the canonical install-error phrasings adb
    // emits — NOT a generic "any dotted identifier" sweep. The earlier
    // broad regex would happily match the .apk filename embedded in the
    // error path (e.g. "f4d5549510b6.apk") before reaching the real
    // package name ("org.wikipedia"), causing the retry to uninstall a
    // bogus package and the install to fail again. Specific phrases:
    //   - "Existing package <pkg> signatures do not match"
    //   - "Package <pkg> is already installed"
    //   - "INSTALL_FAILED_*: <pkg>"
    // 2026-04-25: also fall through to the APK-manifest aapt2 lookup as
    // an authoritative fallback (always safe — the package name we're
    // about to install must be the package blocking the install).
    const errStr = (err && err.message) || "";
    let blockingPkg = null;
    const PKG_TOKEN = "([a-z][a-z0-9_]+(?:\\.[a-z0-9_]+)+)";
    const PHRASE_REGEXES = [
      new RegExp(`Existing package ${PKG_TOKEN} signatures`, "i"),
      new RegExp(`Package ${PKG_TOKEN} is already installed`, "i"),
      new RegExp(`Package ${PKG_TOKEN} signatures do not match`, "i"),
    ];
    for (const re of PHRASE_REGEXES) {
      const m = errStr.match(re);
      if (m && m[1] && !m[1].endsWith(".apk") && !m[1].endsWith(".aab") && !m[1].endsWith(".xapk")) {
        blockingPkg = m[1];
        break;
      }
    }
    // Manifest fallback — authoritative. Whatever package the APK we're
    // installing declares is, by definition, the package blocking us.
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
 * Launch (or re-launch) a target app on the running emulator. Tries the
 * explicit activity first, falls back to `monkey -p <pkg> -c LAUNCHER`.
 *
 * Used both by the initial crawl start (jobs/runner.js) and by the V17
 * agent-loop's package-drift recovery path: if mid-crawl an intent
 * handoff takes us out of the target package (e.g. biztoso → Dialer),
 * relaunchApp gets us back to the target's launcher activity.
 *
 * @param {string} packageName
 * @param {string|null} [launcherActivity]
 * @returns {boolean} true if the adb call didn't throw; false on failure
 */
function relaunchApp(packageName, launcherActivity) {
  if (!packageName) {
    log.warn("relaunchApp called without packageName");
    return false;
  }
  try {
    if (launcherActivity) {
      execFileSync(
        "adb",
        ["shell", "am", "start", "-n", `${packageName}/${launcherActivity}`],
        { timeout: 15000, stdio: "pipe" },
      );
    } else {
      execFileSync(
        "adb",
        ["shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"],
        { timeout: 15000, stdio: "pipe" },
      );
    }
    log.info({ package: packageName, activity: launcherActivity || "(monkey fallback)" }, "relaunchApp: am start issued");
    return true;
  } catch (e) {
    log.warn({ err: e.message, package: packageName }, "relaunchApp failed");
    return false;
  }
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

module.exports = { bootEmulator, saveSnapshot, installApk, relaunchApp, killEmulator, resetEmulator };
