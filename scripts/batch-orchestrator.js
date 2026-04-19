"use strict";

const fs = require('fs');
const path = require('path');
const https = require('https');
const { runCrawl } = require('../crawler/run.js');
const adb = require('../crawler/adb.js');
const { logger } = require("../lib/logger");
const log = logger.child({ component: "batch-orchestrator" });

// Download helper
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    if (url.startsWith('mock://')) {
      // Mock mode: just create a dummy file
      fs.writeFileSync(dest, "mock-apk-content");
      resolve();
      return;
    }
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

async function main() {
  const queuePath = process.argv[2];
  if (!queuePath) {
    console.error("Usage: node batch-orchestrator.js <queue.json>");
    process.exit(1);
  }

  const queueRaw = fs.readFileSync(path.resolve(queuePath), 'utf-8');
  const queue = JSON.parse(queueRaw); // Expected: [{ packageName: "com.example.app", apkUrl: "https://..." }]

  log.info(`Loaded batch queue with ${queue.length} targets`);

  const apkDir = path.join(__dirname, '../data/apks');
  if (!fs.existsSync(apkDir)) {
    fs.mkdirSync(apkDir, { recursive: true });
  }

  const results = [];

  for (let i = 0; i < queue.length; i++) {
    const target = queue[i];
    log.info({ target: target.packageName }, `Starting Processing (${i + 1}/${queue.length})`);
    
    const apkDest = path.join(apkDir, `${target.packageName}.apk`);
    
    try {
      // 1. Download
      if (!fs.existsSync(apkDest)) {
        log.info(`Downloading APK from ${target.apkUrl}...`);
        await downloadFile(target.apkUrl, apkDest);
      } else {
        log.info(`APK already present locally at ${apkDest}`);
      }

      // 2. Ensure Device Ready
      if (!adb.ensureDeviceReady()) {
        log.warn("Device is offline. Attempting reconnect...");
        const reconnected = adb.reconnectDevice();
        if (!reconnected) {
          throw new Error("Device offline and could not be recovered.");
        }
      }

      // 3. Clean environment (just in case) and Install
      adb.uninstallApp(target.packageName);
      adb.installApp(apkDest);

      // 4. Run Crawl
      const ts = Date.now();
      const screenshotDir = path.join(__dirname, `../output/batch-${target.packageName}-${ts}`);
      fs.mkdirSync(screenshotDir, { recursive: true });

      log.info(`Launching ProdScope Crawler for ${target.packageName}...`);
      const startedAt = Date.now();

      const result = await runCrawl({
        screenshotDir,
        packageName: target.packageName,
        maxSteps: target.maxSteps || 30, // lower max steps for batch mode
        appProfile: { packageName: target.packageName, activities: [], permissions: [], appName: target.packageName },
        credentials: {},
        goldenPath: "",
        goals: target.goals || "Autonomously explore main features to assess health",
        painPoints: "",
        onProgress: (s) => { 
           // Can pipe progress out, silence for batch logs
        },
      });

      const elapsedMs = Date.now() - startedAt;
      log.info(`Completed crawl in ${(elapsedMs/60000).toFixed(2)} mins`);

      results.push({
        status: "success",
        packageName: target.packageName,
        steps: result.stats?.totalSteps,
        uniqueStates: result.stats?.uniqueStates,
        elapsedSeconds: Math.floor(elapsedMs / 1000)
      });

    } catch (err) {
      log.error({ err }, `Failed processing target ${target.packageName}`);
      results.push({ status: "error", packageName: target.packageName, error: err.message });
    } finally {
      // 5. Cleanup Device State
      try {
        adb.clearAppData(target.packageName);
        adb.uninstallApp(target.packageName);
        if (fs.existsSync(apkDest)) fs.unlinkSync(apkDest); // Cleanup local storage
        log.info(`Cleanup finished for ${target.packageName}`);
      } catch (e) {
        log.warn({ err: e }, `Cleanup failed for ${target.packageName}`);
      }
    }
  }

  log.info({ finalResults: results }, "=== BATCH ORCHESTRATION COMPLETE ===");
}

main().catch(err => {
  log.error({ err }, "Fatal Batch Orchestrator Error");
  process.exit(1);
});
