"use strict";

const { execSync, execFileSync, exec } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
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

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Extract the package name of the install-blocking app from an adb error.
 *
 * Anchored on canonical install-error phrasings adb emits — NOT a generic
 * "any dotted identifier" sweep. The earlier broad regex would happily match
 * the .apk filename embedded in the error path (e.g. "f4d5549510b6.apk")
 * before reaching the real package name ("org.wikipedia"), causing the
 * retry to uninstall a bogus package and the install to fail again.
 *
 * Falls through to `aapt2 dump badging` on the supplied APK as the
 * authoritative manifest lookup — whatever package the APK we're trying to
 * install declares is, by definition, the package blocking the install.
 *
 * @param {Error} err     the rejection from `adb install` / `install-multiple`
 * @param {string} apkPath path to a .apk file we can read the manifest from
 *                          (for bundles, pass the base.apk)
 * @returns {string|null}
 */
function extractBlockingPackageFromError(err, apkPath) {
  const errStr = (err && err.message) || "";
  const PKG_TOKEN = "([a-z][a-z0-9_]+(?:\\.[a-z0-9_]+)+)";
  const PHRASE_REGEXES = [
    new RegExp(`Existing package ${PKG_TOKEN} signatures`, "i"),
    new RegExp(`Package ${PKG_TOKEN} is already installed`, "i"),
    new RegExp(`Package ${PKG_TOKEN} signatures do not match`, "i"),
  ];
  const BUNDLE_EXTS = new Set([".apk", ".aab", ".xapk", ".apks", ".apkm"]);
  for (const re of PHRASE_REGEXES) {
    const m = errStr.match(re);
    if (!m || !m[1]) continue;
    let isFilename = false;
    for (const ext of BUNDLE_EXTS) {
      if (m[1].toLowerCase().endsWith(ext)) { isFilename = true; break; }
    }
    if (!isFilename) return m[1];
  }
  // Manifest fallback — authoritative.
  if (apkPath) {
    try {
      const badging = execFileSync("aapt2", ["dump", "badging", apkPath], {
        timeout: 15000, encoding: "utf-8",
      });
      const m = badging.match(/package:\s+name='([^']+)'/);
      if (m) return m[1];
    } catch (_) { /* aapt2 may not be on PATH on every box — swallow */ }
  }
  return null;
}

/**
 * Install a single APK onto the running emulator.
 *
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
function installSingleApk(apkPath) {
  log.info({ apkPath }, "Installing APK (this may take up to 2 minutes for large apps)...");
  const args = ["install", "-r", "-d", "-t", apkPath];
  try {
    execFileSync("adb", args, { timeout: 120000 });
  } catch (err) {
    log.warn({ errCode: err.code, errMsg: err.message }, "First install attempt failed — retrying after adb reconnect");
    try { execFileSync("adb", ["wait-for-device"], { timeout: 15000 }); } catch (_) {}
    const blockingPkg = extractBlockingPackageFromError(err, apkPath);
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
 * Foreign architectures we never want to ship to our x86_64 emulator.
 * Keeping arm splits inflates `/data` with native libs the device can't load
 * and on some apps trips INSTALL_FAILED_NO_MATCHING_ABIS at install time.
 */
const FOREIGN_ARCH_SPLITS = new Set(["arm64_v8a", "armeabi_v7a", "armeabi", "mips", "mips64"]);

/**
 * Pick the right files out of an already-extracted bundle directory.
 *
 * Pulled out as a separate function so unit tests can exercise the picker
 * against a fixture directory without shelling out to `unzip`.
 *
 * @param {string} extractedDir   path to an unzipped bundle
 * @param {{ arch?: string, manifestApks?: string[]|null, manifestPackage?: string|null }} [opts]
 * @returns {{ apkFiles: string[], obbFiles: Array<{src:string,dest:string}>, packageName: string|null }}
 */
function _pickSplitsFromTempDir(extractedDir, opts = {}) {
  const arch = opts.arch || "x86_64";
  let packageName = opts.manifestPackage || null;
  let apkRelPaths = Array.isArray(opts.manifestApks) ? opts.manifestApks.slice() : null;

  // Fallback: walk extractedDir for any *.apk files
  if (!apkRelPaths || apkRelPaths.length === 0) {
    apkRelPaths = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".apk")) apkRelPaths.push(full);
      }
    };
    walk(extractedDir);
  }

  // Filter splits — drop foreign arch, keep base + matching arch + lang/dpi splits.
  const matchingArchSplit = `split_config.${arch}.apk`;
  const apkFiles = apkRelPaths
    .map((rel) => (path.isAbsolute(rel) ? rel : path.join(extractedDir, rel)))
    .filter((abs) => {
      const name = path.basename(abs).toLowerCase();
      if (name === "base.apk") return true;
      if (name === matchingArchSplit) return true;
      const m = name.match(/^split_config\.([a-z0-9_]+)\.apk$/);
      if (m && FOREIGN_ARCH_SPLITS.has(m[1])) return false;
      return true;
    });

  // Collect OBB pushes if Android/obb/<pkg>/ exists
  const obbFiles = [];
  const obbRoot = path.join(extractedDir, "Android", "obb");
  if (fs.existsSync(obbRoot)) {
    for (const pkg of fs.readdirSync(obbRoot)) {
      const pkgDir = path.join(obbRoot, pkg);
      if (!fs.statSync(pkgDir).isDirectory()) continue;
      for (const f of fs.readdirSync(pkgDir)) {
        if (f.toLowerCase().endsWith(".obb")) {
          obbFiles.push({
            src: path.join(pkgDir, f),
            dest: `/sdcard/Android/obb/${pkg}/${f}`,
          });
        }
      }
    }
  }

  return { apkFiles, obbFiles, packageName };
}

/**
 * Extract a .xapk / .apks / .apkm bundle to a temp dir and return the
 * install plan (filtered split list + OBB pushes + manifest package name).
 *
 * Caller owns the returned `tempDir` — must `fs.rmSync(tempDir, recursive)`
 * after install completes (or fails). Bundles can be 200+ MB extracted.
 *
 * @param {string} archivePath
 * @param {{ arch?: string }} [opts]
 * @returns {{ apkFiles: string[], obbFiles: Array<{src:string,dest:string}>, packageName: string|null, tempDir: string }}
 */
function extractBundleSplits(archivePath, opts = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prodscope-bundle-"));
  try {
    execFileSync("unzip", ["-q", "-o", archivePath, "-d", tempDir], { timeout: 60000 });
  } catch (err) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    throw new Error(`Failed to extract bundle ${archivePath}: ${err.message}`);
  }

  // APKMirror's xapk format includes a manifest.json describing the bundle.
  // Use it as the authoritative install list when present.
  let manifestApks = null;
  let manifestPackage = null;
  const manifestPath = path.join(tempDir, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifestPackage = m.package_name || m.packageName || null;
      const splits = Array.isArray(m.split_apks) ? m.split_apks : [];
      manifestApks = splits.map((s) => (s && typeof s === "object" ? s.file : s)).filter(Boolean);
    } catch (_) { /* malformed manifest — fall through to fs walk */ }
  }

  const picked = _pickSplitsFromTempDir(tempDir, {
    arch: opts.arch,
    manifestApks,
    manifestPackage,
  });
  return { ...picked, tempDir };
}

/**
 * Install an APK or APK bundle onto the running emulator.
 *
 * Dispatches by file extension:
 *   - .apk         → adb install (single)
 *   - .xapk/.apks/.apkm → adb install-multiple after extraction + split filtering
 *
 * The bundle path additionally pushes any embedded OBB files to
 * /sdcard/Android/obb/<pkg>/ since some apps refuse to launch without them.
 *
 * @param {string} apkPath
 */
function installApk(apkPath) {
  const ext = path.extname(apkPath).toLowerCase();
  if (ext === ".xapk" || ext === ".apks" || ext === ".apkm") {
    return installAppBundle(apkPath);
  }
  return installSingleApk(apkPath);
}

/**
 * Install an .xapk / .apks / .apkm bundle onto the running emulator.
 *
 * Unzips, picks splits matching x86_64, runs `adb install-multiple`, pushes
 * OBB. Same retry shape as installSingleApk: on first failure, force-uninstall
 * the blocking package (manifest is authoritative) and retry once.
 */
function installAppBundle(apkPath) {
  log.info({ apkPath }, "Installing app bundle (this may take up to 4 minutes)...");
  const { apkFiles, obbFiles, packageName, tempDir } = extractBundleSplits(apkPath);
  if (apkFiles.length === 0) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    throw new Error(`Bundle ${apkPath} contained no installable .apk files`);
  }
  log.info({ count: apkFiles.length, package: packageName, hasObb: obbFiles.length > 0 },
    "Bundle splits selected");

  // Find the base.apk (or first .apk) — used as the manifest source for the
  // blocking-package fallback if adb's error output isn't enough.
  const baseApk = apkFiles.find((f) => path.basename(f).toLowerCase() === "base.apk") || apkFiles[0];
  const args = ["install-multiple", "-r", "-d", "-t", ...apkFiles];

  try {
    try {
      execFileSync("adb", args, { timeout: 240000 });
    } catch (err) {
      log.warn({ errMsg: err.message }, "Bundle install failed — retrying after force-uninstall");
      try { execFileSync("adb", ["wait-for-device"], { timeout: 15000 }); } catch (_) {}
      const blockingPkg = packageName || extractBlockingPackageFromError(err, baseApk);
      if (blockingPkg) {
        try {
          execFileSync("adb", ["uninstall", blockingPkg], { timeout: 15000, stdio: "ignore" });
          log.info({ package: blockingPkg }, "Force-uninstalled blocking package");
        } catch (_) {}
      }
      execFileSync("adb", args, { timeout: 240000 });
    }
    for (const { src, dest } of obbFiles) {
      try {
        execFileSync("adb", ["shell", "mkdir", "-p", path.posix.dirname(dest)],
          { timeout: 10000, stdio: "ignore" });
        execFileSync("adb", ["push", src, dest], { timeout: 120000 });
        log.info({ obb: path.basename(src) }, "OBB pushed");
      } catch (e) {
        log.warn({ err: e.message, obb: path.basename(src) }, "OBB push failed — continuing");
      }
    }
    log.info("Bundle installed successfully");
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
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

module.exports = {
  bootEmulator,
  saveSnapshot,
  installApk,
  installSingleApk,
  installAppBundle,
  extractBundleSplits,
  _pickSplitsFromTempDir,
  extractBlockingPackageFromError,
  relaunchApp,
  killEmulator,
  resetEmulator,
};
