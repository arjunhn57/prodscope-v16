// @ts-check
/**
 * run.js - Main crawl loop orchestrator
 *
 * After Phase 2 refactor, this file is a thin pipeline of 18 stages:
 * capture → classify → decide → execute → learn
 *
 * All logic lives in extracted modules. This file only handles control flow.
 *
 * @typedef {import('./types/crawl-context').CrawlContext} Ctx
 * @typedef {import('./types/crawl-context').CrawlContextConfig} CrawlContextConfig
 */

const fingerprint = require('./fingerprint');
const graph = require('./graph');
const adb = require('./adb');
const readiness = require('./readiness');
const { waitForScreenReadyScreenshotOnly, waitForScreenReadyAdaptive } = readiness;
const screenshotFp = require('./screenshot-fp');
const { CrawlMetrics } = require('./metrics');
const { detectScreenIntent, detectScreenIntentFromPerception } = require('./screen-intent');

const { RecoveryManager, SITUATION } = require('./recovery');
const { ModeManager } = require('./modes');
const { AppState } = require('./app-state');
const vision = require('./vision');
const {
  CrawlContext,
  MAX_DEVICE_FAILS,
  SOFT_REVISIT_WINDOW,
  SOFT_REVISIT_THRESHOLD,
} = require('./crawl-context');

// Phase 2.1 extracted modules
const { runOracleChecks } = require('./oracle-checks');
const { checkCyclingLoop, checkNoNewState, checkDiscoveryRate, checkSoftRevisit } = require('./stuck-detector');
const { runWatchdogCheck } = require('./watchdog-step');
const { processOutcome } = require('./outcome-tracker');
const { checkNoCredentialAuthSkip, handleSystemDialogs } = require('./system-handler-step');
const { findAuthEscapeButton, findDismissButtonByPosition, handlePermissionBurst, handleOnboardingFlow } = require('./system-handlers');
const { AUTH_ESCAPE_LABELS, AUTH_ESCAPE_REGEX, isAuthIntent } = require('./auth-state-machine');

// Phase 2.2 extracted modules
const { handleAuthChoice } = require('./auth-choice');
const { handleAuthForm } = require('./auth-form');
const { buildCandidates } = require('./candidate-builder');
const { executeAction } = require('./action-executor');
const { adjustPriorities } = require('./priority-adjustments');
const { analyzeScreen } = require('./screen-intelligence');

// Phase 2.4 extracted modules
const { captureScreen, captureStableScreen, isTransientEmptyXml } = require('./capture-step');
const { handleOutOfApp, getPrimaryPackage, isAllowedNonTargetPackage } = require('./out-of-app');
const { selectAction, selectActionVisionFirst } = require('./policy-step');
const { assembleReport } = require('./report-assembler');

// Phase 3: Cross-crawl memory
const { loadMemory, saveMemory } = require('../jobs/screen-memory');

// H1: App-level cross-crawl knowledge
const { loadAppKnowledge, saveAppKnowledge } = require('../lib/app-knowledge');

// H2: Predictive failure detection
const { evaluateCrawlHealth } = require('../lib/early-warning');
const { logger } = require('../lib/logger');
const { MAX_CRAWL_DURATION_MS } = require('../config/defaults');

// E3: Pipeline pre-fetch
const pipeline = require('./pipeline');

// Track F: LLM decision prefetch (V2 vision-first)
const agentPrefetch = require('./agent-prefetch');

// Brain modules — coverage tracking, flow tracking, strategic planning
/** @type {any} */ let CoverageTracker;
/** @type {any} */ let planBoost;
/** @type {any} */ let FlowTracker;
/** @type {any} */ let FlowDeduplicator;
/** @type {any} */ let EmulatorWatchdog;
try {
  ({ CoverageTracker } = require('../brain/coverage-tracker'));
  ({ planBoost } = require('../brain/planner'));
  ({ FlowTracker } = require('../brain/flow-tracker'));
  ({ FlowDeduplicator } = require('../brain/dedup'));
  logger.info({ component: "crawler" }, "Brain modules loaded");
} catch (e) {
  logger.warn({ err: e, component: "crawler" }, "Brain modules not available, running without intelligence");
  CoverageTracker = null;
}

try {
  // @ts-ignore — optional module, may not exist in all environments
  ({ EmulatorWatchdog } = require('../emulator/watchdog'));
} catch (e) {
  logger.warn({ err: e, component: "crawler" }, "EmulatorWatchdog not available");
  EmulatorWatchdog = null;
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {CrawlContextConfig} config */
async function runCrawl(config) {
  const ctx = new CrawlContext(config);

  ctx.log.info({ package: ctx.packageName, maxSteps: ctx.maxSteps, hasCredentials: !!ctx.hasValidCredentials, hasGoldenPath: !!ctx.goldenPath }, "Starting crawl");

  // ── Initialize core state ──
  ctx.stateGraph = new graph.StateGraph();
  ctx.metrics = new CrawlMetrics();

  // ── Initialize module instances ──
  ctx.recoveryManager = new RecoveryManager(/** @type {any} */ ({
    packageName: ctx.packageName,
    launcherActivity: ctx.launcherActivity,
    stateGraph: ctx.stateGraph,
    adb,
    readiness,
    fingerprint,
    getHomeFingerprint: () => ctx.homeFingerprint,
    sleep,
  }));

  ctx.modeManager = new ModeManager(ctx.maxSteps);
  ctx.appState = new AppState();
  ctx.flowTracker = FlowTracker ? new FlowTracker() : null;
  ctx.dedup = FlowDeduplicator ? new FlowDeduplicator() : null;
  ctx.watchdog = EmulatorWatchdog ? new EmulatorWatchdog(ctx.packageName) : null;
  ctx.coverageTracker = CoverageTracker ? new CoverageTracker() : null;
  vision.resetBudget();
  adb.resetUiAutomatorState();

  // ── Load cross-crawl memory ──
  try {
    ctx.screenMemory = loadMemory(ctx.packageName);
    if (ctx.screenMemory.size > 0) {
      ctx.log.info({ count: ctx.screenMemory.size, package: ctx.packageName }, "Loaded cross-crawl memory");
    }
  } catch (e) {
    ctx.log.warn({ err: e }, "Failed to load cross-crawl memory");
  }

  // H1: Load app-level knowledge from prior crawls
  try {
    ctx.appKnowledge = loadAppKnowledge(ctx.packageName);
    if (ctx.appKnowledge) {
      ctx.log.info({ crawlNumber: ctx.appKnowledge.crawlCount + 1, framework: ctx.appKnowledge.frameworkType || 'unknown' }, "Loaded prior app knowledge");
      // Apply prior knowledge: set vision budget based on known framework
      if (ctx.appKnowledge.frameworkType === 'compose' || ctx.appKnowledge.frameworkType === 'flutter' || ctx.appKnowledge.frameworkType === 'react_native') {
        vision.setDynamicBudget(true);
      } else if (ctx.appKnowledge.frameworkType === 'native') {
        vision.setDynamicBudget(false);
      }
      // Skip auth if prior crawl confirmed no guest mode
      if (ctx.appKnowledge.hasGuestMode === false && !ctx.hasValidCredentials) {
        ctx.log.info("Prior crawl: no guest mode, no credentials — auth will be suppressed");
      }
      // Set FLAG_SECURE flag from prior knowledge
      if (ctx.appKnowledge.flagSecure) {
        ctx.log.info("Prior crawl: FLAG_SECURE detected — vision calls will be minimized");
      }
    }
  } catch (e) {
    ctx.log.warn({ err: e }, "Failed to load app knowledge");
  }

  // ── Convenience aliases (read-only shortcuts used throughout the loop) ──
  const { screenshotDir, packageName, maxSteps, hasValidCredentials,
    stateGraph, actionsTaken, metrics } = ctx;

  /**
   * @param {number} step
   * @param {any} [extra]
   */
  function sendLiveProgress(step, extra = {}) {
    if (!ctx.onProgress) return;
    ctx.onProgress({
      phase: 'running',
      rawStep: step,
      maxRawSteps: maxSteps,
      countedUniqueScreens: stateGraph.uniqueStateCount(),
      targetUniqueScreens: maxSteps,
      activity: extra.activity || '',
      intentType: extra.intentType || '',
      latestAction: ctx.lastLiveAction,
      message: extra.message || 'Step ' + (step + 1) + '/' + maxSteps,
      captureMode: 'screenshot',
      packageName,
      path: extra.path || '',
      reasoning: ctx.lastReasoning ?? null,
      expectedOutcome: ctx.lastExpectedOutcome ?? null,
      perceptionBoxes: Array.isArray(ctx.visionResult && ctx.visionResult.mainActions) ? ctx.visionResult.mainActions : [],
      tapTarget: ctx.lastTapTarget ?? null,
      navTabs: Array.isArray(ctx.appMap && ctx.appMap.navTabs) ? ctx.appMap.navTabs : [],
      heapMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    });
  }

  function formatJournal() {
    let result = "";
    if (ctx.explorationJournal.length > 0) {
      result = "EXPLORATION HISTORY (recent):\n" +
        ctx.explorationJournal.map((j) =>
          `  Step ${j.step}: ${j.screen} -> ${j.action} -> ${j.outcome}${j.isNew ? " [NEW]" : ""}`
        ).join("\n");
    }

    // Append exploration map for global spatial awareness
    if (ctx.coverageTracker && ctx.modeManager && ctx.stateGraph) {
      try {
        const { buildExplorationMap } = require("../brain/planner");
        if (buildExplorationMap) {
          const map = buildExplorationMap(ctx.coverageTracker, ctx.stateGraph, ctx.modeManager);
          result = result ? result + "\n\n" + map : map;
        }
      } catch (_) {}
    }

    return result;
  }

  const crawlStartTime = Date.now();
  // Track G: stamp ctx.startTime so buildV2Coverage() can compute
  // elapsedMs / uniquePerMinute. The local crawlStartTime variable
  // stays for the MAX_CRAWL_DURATION_MS hard-timeout check below.
  ctx.startTime = crawlStartTime;

  for (let step = 0; step < maxSteps; step++) {
    // Hard timeout — belt-and-suspenders with runner.js Promise.race
    if (Date.now() - crawlStartTime > MAX_CRAWL_DURATION_MS) {
      ctx.log.warn({ elapsedMs: Date.now() - crawlStartTime }, "Crawl duration exceeded MAX_CRAWL_DURATION_MS");
      ctx.stopReason = 'timeout';
      break;
    }

    metrics.recordStepStart(step);
    sendLiveProgress(step, { message: "Starting step " + (step + 1) + "/" + maxSteps });
    ctx.log.info({ step: step + 1, maxSteps }, `=== Step ${step + 1}/${maxSteps} ===`);

    // STAGE 1: Watchdog health check
    if (step > 0 && step % 5 === 0) {
      const wdResult = await runWatchdogCheck(ctx);
      if (wdResult.shouldBreak) { ctx.stopReason = 'emulator_failure'; break; }
      if (wdResult.shouldContinue) continue;
    }

    // H2: Predictive failure detection at step 10
    if (step === 10) {
      const crawlHealth = evaluateCrawlHealth(ctx, step);
      ctx.log.info({ health: crawlHealth.health, recommendation: crawlHealth.recommendation, reasons: crawlHealth.reasons }, "Early-warning health check");
      if (crawlHealth.recommendation === 'abort') {
        ctx.log.warn({ reasons: crawlHealth.reasons }, "Aborting crawl — no progress");
        ctx.stopReason = 'early_abort_no_progress';
        break;
      }
      if (crawlHealth.recommendation === 'aggressive') {
        ctx.log.info("Switching to aggressive mode");
        // Boost recovery budget, reduce remaining step count
        ctx.saturationCooldown = 0;
      }
    }

    // C10: Fast-path permission burst (before capture, no step cost)
    // E4: Skip after permission burst is done
    if (step < 5 && !ctx.permissionBurstDone) {
      try {
        const permResult = await handlePermissionBurst(8);
        if (permResult.handled > 0) {
          actionsTaken.push({ step, type: 'permission_burst', description: `Auto-granted ${permResult.handled} permissions` });
        }
        if (step >= 4 || permResult.handled === 0) {
          ctx.permissionBurstDone = true;
        }
      } catch (e) {
        ctx.log.warn({ err: e }, "Permission burst error");
        ctx.permissionBurstDone = true;
      }
    }

    // STAGE 2: Screen capture (+ failure recovery, vision-only fallback)
    // E3: Check pre-fetch buffer first
    /** @type {{ snapshot: any, directive: 'proceed'|'continue'|'break', breakReason?: string }} */
    let capResult;
    const prefetched = /** @type {any} */ (await pipeline.consumePrefetch(step));
    if (prefetched && prefetched.snapshot && !prefetched.snapshot.error) {
      // Use pre-fetched capture
      const pf = prefetched.snapshot;
      pf.step = step;
      ctx.screens.push(pf);
      capResult = { snapshot: pf, directive: 'proceed' };
      ctx.log.debug({ step }, "Used pre-fetched capture");
    } else {
      capResult = await captureScreen(ctx, step, formatJournal);
    }
    if (capResult.directive === 'break') { ctx.stopReason = capResult.breakReason || 'capture_failed'; break; }
    if (capResult.directive === 'continue') continue;
    const snapshot = capResult.snapshot;

    // STAGE 3: Context enrichment
    const primaryPackage = snapshot.xml ? getPrimaryPackage(snapshot.xml) : adb.getCurrentPackage();
    ctx.log.debug({ primaryPackage: primaryPackage || 'unknown' }, "Primary package");

    let screenIntent = snapshot.xml ? detectScreenIntent(snapshot.xml) : { type: "unknown", confidence: 0 };
    ctx.log.debug({ intentType: screenIntent.type, confidence: screenIntent.confidence }, "Screen intent");

    sendLiveProgress(step, {
      activity: snapshot.activity || '',
      intentType: screenIntent.type || '',
      message: `Captured screen ${step + 1} — ${snapshot.activity || 'unknown'}`,
      path: snapshot.screenshotPath || '',
    });

    // STAGE 4: Out-of-app recovery
    const oaResult = await handleOutOfApp(ctx, primaryPackage, step);
    if (oaResult.directive === 'break') {
      // C6: Don't stop before 10 steps unless device is offline
      if (step < 10 && oaResult.breakReason !== 'device_offline') {
        ctx.log.info({ reason: oaResult.breakReason, step }, "Suppressing early stop — minimum 10 steps");
      } else {
        ctx.stopReason = oaResult.breakReason || 'out_of_app'; break;
      }
    }
    if (oaResult.directive === 'continue') continue;

    // STAGE 5: Auth escape — try skip/escape buttons BEFORE pressing BACK
    // E4: Skip entirely if auth is already resolved
    // AGENT_LOOP: skip entirely so agent sees auth screens and decides itself
    if (process.env.AGENT_LOOP === "true") {
      // no-op — agent handles auth screens directly
    } else if (ctx.authResolved) {
      // no-op — skip auth escape logic
    } else if (!ctx.authMachine.shouldAttemptAuth() && ctx.authMachine.shouldSuppressAuth(screenIntent.type)) {
      let escaped = false;

      // Tier 1: Search XML for skip/escape buttons
      const xmlEscape = findAuthEscapeButton(snapshot.xml, AUTH_ESCAPE_LABELS);
      if (xmlEscape) {
        ctx.log.info({ label: xmlEscape.label, source: "xml" }, "Found auth escape button");
        adb.tap(xmlEscape.bounds.cx, xmlEscape.bounds.cy);
        ctx.authMachine.recordAuthEscapeTapped();
        actionsTaken.push({ step, type: 'auth_escape', description: `Tapped "${xmlEscape.label}"`, source: 'xml' });
        await sleep(1500);
        escaped = true;
      }

      // Tier 2: Search vision cache for escape actions (from previous step's perception)
      if (!escaped && ctx.visionResult && ctx.visionResult.mainActions) {
        const visionEscape = ctx.visionResult.mainActions.find(
          (a) => a.description && AUTH_ESCAPE_REGEX.test(a.description)
        );
        if (visionEscape) {
          ctx.log.info({ label: visionEscape.description, x: visionEscape.x, y: visionEscape.y, source: "vision" }, "Found auth escape button");
          adb.tap(visionEscape.x, visionEscape.y);
          ctx.authMachine.recordAuthEscapeTapped();
          actionsTaken.push({ step, type: 'auth_escape', description: `Tapped "${visionEscape.description}"`, source: 'vision' });
          await sleep(1500);
          escaped = true;
        }
      }

      // Tier 3: Targeted vision call for Compose/Flutter apps (screenshot-only, no XML escape found)
      if (!escaped && (ctx.screenshotOnlyMode || !snapshot.xml) && vision.budgetRemaining() > 0 && snapshot.screenshotPath) {
        try {
          const guidance = await vision.getVisionGuidance(
            snapshot.screenshotPath, snapshot.xml || '',
            {
              classification: 'auth_escape_scan',
              triedCount: 0,
              goal: 'This is an auth/login screen but we cannot sign in. Look for any "Skip", "Not now", "Maybe later", "Continue as guest", "Browse without login", or similar button that lets us bypass login. Return its coordinates. If no skip button exists, return empty mainActions.',
            }
          );
          if (guidance && guidance.mainActions) {
            const escapeAction = guidance.mainActions.find((a) => AUTH_ESCAPE_REGEX.test(a.description || ''));
            if (escapeAction) {
              ctx.log.info({ label: escapeAction.description, x: escapeAction.x, y: escapeAction.y, source: "vision_targeted" }, "Vision found auth escape");
              adb.tap(escapeAction.x, escapeAction.y);
              ctx.authMachine.recordAuthEscapeTapped();
              actionsTaken.push({ step, type: 'auth_escape', description: `Tapped "${escapeAction.description}"`, source: 'vision_targeted' });
              await sleep(1500);
              escaped = true;
            }
          }
        } catch (e) {
          ctx.log.warn({ err: e }, "Vision escape scan failed");
        }
      }

      // Verify escape worked: check if we landed on a non-auth screen
      if (escaped) {
        const postXml = adb.dumpXml();
        const postIntent = postXml ? detectScreenIntent(postXml) : { type: 'unknown', confidence: 0 };
        if (!isAuthIntent(postIntent.type)) {
          ctx.log.info({ landedOn: postIntent.type }, "Auth escape succeeded");
          ctx.authMachine.onAuthEscaped('escaped via skip button');
          ctx.authResolved = true; // E4: skip auth stages from now on
        } else {
          ctx.log.info({ landedOn: postIntent.type }, "Auth escape led to another auth screen — will retry");
        }
        continue;
      }

      // H6: Positional button detection for non-English apps
      if (!escaped && snapshot.xml) {
        const posBtn = findDismissButtonByPosition(snapshot.xml);
        if (posBtn) {
          ctx.log.info({ type: posBtn.type, cx: posBtn.cx, cy: posBtn.cy }, "Positional dismiss button found");
          adb.tap(posBtn.cx, posBtn.cy);
          ctx.authMachine.recordAuthEscapeTapped();
          actionsTaken.push({ step, type: 'auth_escape', description: `Positional ${posBtn.type}`, source: 'position' });
          await sleep(1500);
          escaped = true;
        }
      }

      if (escaped) {
        const postXml2 = adb.dumpXml();
        const postIntent2 = postXml2 ? detectScreenIntent(postXml2) : { type: 'unknown', confidence: 0 };
        if (!isAuthIntent(postIntent2.type)) {
          ctx.authMachine.onAuthEscaped('positional escape');
          ctx.authResolved = true;
        }
        continue;
      }

      // No escape button found — fall back to BACK press
      const exitLoop = ctx.authMachine.recordAuthSkipBack();
      if (exitLoop) {
        ctx.log.warn("Auth exit loop detected — no escape buttons, no guest mode");
        ctx.stopReason = 'auth_required_no_guest';
        break;
      }
      ctx.log.info({ backCount: ctx.authMachine.authSkipBackCount, maxBacks: ctx.authMachine.maxAuthSkipBacks }, "No escape buttons — pressing BACK");
      adb.pressBack();
      await sleep(800);
      continue;
    }

    // STAGE 6: System dialogs + overlays
    const sysResult = await handleSystemDialogs(ctx, snapshot, screenIntent, step, actionsTaken);
    if (sysResult.handled) {
      if (sysResult.shouldContinue) { await sleep(800); continue; }
    }

    ctx.outOfAppRecoveries = 0;

    // STAGE 7: Fingerprint computation
    // In vision-first mode the agent sees pixels, so state equivalence must
    // be computed from the screenshot. UIAutomator XML on Compose/RN/Flutter
    // apps collapses visually distinct screens into a single fingerprint,
    // which tanks the unique-screen coverage metric to ~1 for entire crawls.
    // We use a byte-exact PNG hash (not the coarse 64-bit aHash) because the
    // aHash also collapses distinct login/auth screens into one bucket in
    // practice. Soft-revisit below still uses the aHash to absorb minor
    // animation drift.
    let fp, fuzzyFp;
    if (ctx.visionFirstMode || ctx.screenshotOnlyMode || !snapshot.xml) {
      const exactHash = screenshotFp.computeExactHash(snapshot.screenshotPath);
      fp = `ss_${exactHash}`;
      fuzzyFp = fp;
    } else {
      fp = fingerprint.compute(snapshot.xml);
      fuzzyFp = fingerprint.computeFuzzy(snapshot.xml, snapshot.activity);
    }
    snapshot.fuzzyFp = fuzzyFp;

    const ssFp = snapshot.screenshotPath ? screenshotFp.computeHash(snapshot.screenshotPath) : '';
    snapshot.screenshotHash = ssFp;

    const isNew = !stateGraph.isVisited(fp);

    // Soft-revisit: screens "new" by FP but visually near-identical to recent screenshots
    let effectiveIsNew = isNew;
    if (isNew && ssFp && ssFp !== "no_screenshot") {
      const softResult = checkSoftRevisit(ssFp, ctx.recentScreenshotHashes, SOFT_REVISIT_THRESHOLD);
      if (softResult.isSoftRevisit) {
        effectiveIsNew = false;
        ctx.log.debug({ hamming: softResult.closestDistance }, "Soft-revisit — not counting as new discovery");
      }
    }

    // Maintain screenshot hash window
    if (ssFp && ssFp !== "no_screenshot") {
      ctx.recentScreenshotHashes.push(ssFp);
      if (ctx.recentScreenshotHashes.length > SOFT_REVISIT_WINDOW) {
        ctx.recentScreenshotHashes.shift();
      }
    }

    // Cycling-loop detection
    const cycleResult = checkCyclingLoop(ctx, fp);
    if (cycleResult.stuck) {
      adb.pressBack();
      actionsTaken.push({ step, type: 'back', description: 'press_back', reason: 'cycle_loop_escape', fromFingerprint: fp });
      await sleep(500);
      ctx.modeManager.recordStep();
      continue;
    }

    // Track home screen
    if (!ctx.homeFingerprint && fp !== 'empty_screen') ctx.homeFingerprint = fp;

    // Track new screen exploration
    if (isNew) {
      ctx.lastNewScreenFp = fp;
      ctx.actionsOnNewScreen = 0;
    }

    ctx.log.info({ fp: fp.slice(0, 12), isNew, visitCount: isNew ? 0 : stateGraph.visitCount(fp), activity: snapshot.activity }, "Fingerprint computed");

    if (fp === 'empty_screen') {
      ctx.log.warn("Empty screen detected — recovery");
      await ctx.recoveryManager.recover(SITUATION.EMPTY_SCREEN, fp, ctx);
      continue;
    }

    // Auth state machine tick — skip entirely in AGENT_LOOP mode so agent sees auth screens directly
    if (process.env.AGENT_LOOP !== "true") {
      const authTickResult = ctx.authMachine.tick(screenIntent.type, fp);
      // Sync legacy fields for modules not yet migrated
      ctx.authFlowActive = ctx.authMachine.isActive;
      ctx.authFillCount = ctx.authMachine.fillCount;
      if (authTickResult.action === 'back') {
        ctx.log.info({ reason: authTickResult.reason }, "Suppressing auth screen");
        adb.pressBack();
        await sleep(800);
        ctx.modeManager.recordStep();
        continue;
      }
    }

    // STAGE 8: Stuck detection (effectiveIsNew accounts for soft-revisits)
    // C6: Don't stop before 10 steps for stale/discovery reasons
    const staleResult = checkNoNewState(ctx, effectiveIsNew);
    if (staleResult.stalled && step >= 10) { ctx.stopReason = 'no_new_states'; stateGraph.addState(fp, snapshot); break; }

    const discoveryResult = checkDiscoveryRate(ctx, effectiveIsNew, step);
    if (discoveryResult.exhausted && step >= 10) { ctx.stopReason = 'exploration_exhausted'; stateGraph.addState(fp, snapshot); break; }

    stateGraph.addState(fp, snapshot);

    // ── AppMap: Register screen + track navigation path ──
    {
      const actions = require("./actions");
      const actionsTotal = snapshot.xml
        ? actions.extract(snapshot.xml, new Set()).length
        : (ctx.visionResult && ctx.visionResult.mainActions ? ctx.visionResult.mainActions.length : 0);
      ctx.appMap.registerScreen(fp, actionsTotal, ctx.lastActionFromFp, ctx.lastActionKey);
      if (isNew) {
        ctx.appMap.pushScreen(fp);
      } else if (ctx.appMap.isInCurrentPath(fp)) {
        ctx.appMap.popToScreen(fp);
      } else {
        ctx.appMap.pushScreen(fp);
      }
    }

    // Merge cross-crawl memory (known-bad outcomes from previous runs)
    if (ctx.screenMemory.has(fp)) {
      const mem = /** @type {any} */ (ctx.screenMemory.get(fp));
      const merged = stateGraph.mergeRememberedOutcomes(fp, mem.actionOutcomes);
      if (merged > 0) ctx.log.debug({ merged, fp: fp.slice(0, 8) }, "Recalled known-bad actions from memory");
    }

    // STAGE 9: Screen intelligence (classify, vision, coverage, nav, survey)
    const screenResult = /** @type {any} */ (await analyzeScreen(ctx, snapshot, fp, fuzzyFp, ssFp, isNew, step, formatJournal));
    const classification = screenResult.classification;
    if (screenResult.directive === 'continue') continue;

    // ── AppMap: Wire nav tabs from navigator detection ──
    const navStruct = /** @type {any} */ (ctx.navStructure);
    if (navStruct && navStruct.sections && navStruct.sections.length >= 2 && ctx.appMap.navTabs.length === 0) {
      ctx.appMap.setNavTabs(navStruct.sections.map(function(/** @type {any} */ s) {
        return { label: s.label, cx: s.bounds.cx, cy: s.bounds.cy };
      }));
    }

    // Track classification for cross-crawl memory persistence
    if (classification) {
      ctx.classificationsByFp.set(fp, { type: classification.type, feature: classification.feature });
    }

    // Enrich screen intent from vision classification when XML intent was unknown
    if (screenIntent.type === 'unknown' && classification && classification.classifiedBy === 'vision-perception') {
      screenIntent = detectScreenIntentFromPerception({
        screenType: classification.type,
        isAuthScreen: classification.type === 'login' || classification.feature === 'auth_flow',
        screenDescription: snapshot.screenType || '',
      });
      ctx.log.debug({ intentType: screenIntent.type, confidence: screenIntent.confidence }, "Vision-enriched screen intent");
    }

    // STAGE 10: Auth choice handling (E4: skip if auth resolved)
    // AGENT_LOOP=true: skip — LLM agent handles auth screens directly via the normal action loop.
    if (!ctx.authResolved && process.env.AGENT_LOOP !== "true") {
      const authChoiceResult = await handleAuthChoice(ctx, snapshot, screenIntent, fp, step, actionsTaken, formatJournal);
      if (authChoiceResult.shouldContinue) continue;
    }

    // STAGE 11: Auth form filling (E4: skip if auth resolved)
    // AGENT_LOOP=true: skip — LLM agent fills login fields by tapping inputs and typing values.
    if (!ctx.authResolved && process.env.AGENT_LOOP !== "true") {
      const authFormResult = await handleAuthForm(ctx, snapshot, screenIntent, fp, step, actionsTaken, metrics);
      if (authFormResult.shouldBreak) { ctx.stopReason = authFormResult.breakReason || 'auth_failed'; break; }
      if (authFormResult.shouldContinue) continue;
    }

    // STAGE 12-14: Candidate-based (V1) OR vision-first (V2) decision path
    /** @type {any[]} */
    let candidates;
    /** @type {Set<string>} */
    let tried;
    /** @type {any} */
    let decision;
    /** @type {boolean} */
    let v14Continue = false;
    /** @type {boolean} */
    let v14Break = false;
    /** @type {string | undefined} */
    let v14BreakReason;

    if (!ctx.visionFirstMode) {
      // ── V1 path: XML-based candidate extraction + priority scoring + policy/agent (index-based) ──

      // STAGE 12: Build action candidates
      // candidate-builder handles both XML-primary and vision-primary modes
      const buildResult = buildCandidates(ctx, snapshot, fp, stateGraph);
      candidates = buildResult.candidates;
      tried = buildResult.tried;

      // Update AppMap actionsTotal (critical for Compose apps where XML returns 0)
      if (candidates.length > 0) {
        ctx.appMap.updateActionsTotal(fp, candidates.length);
      }

      // STAGE 13: Adjust priorities
      const prioResult = await adjustPriorities(candidates, ctx, {
        fp, classification, screenIntent, step, maxSteps,
        primaryPackage, stateGraph, tried, snapshot, planBoost,
      });
      if (prioResult.shouldBreak) { ctx.stopReason = prioResult.breakReason || 'prio_break'; break; }
      if (prioResult.shouldContinue) continue;
      candidates = prioResult.candidates;

      ctx.log.info({ candidates: candidates.length, tried: tried.size }, "Action candidates ready");

      // ── AppMap: Proactive backtracking ──
      const appMapDirective = ctx.appMap.getExplorationDirective(fp, candidates);
      ctx.log.info({ directiveType: appMapDirective.type, reason: appMapDirective.reason, fp: fp.slice(0, 12) }, "[appMap] Exploration directive");

      if (appMapDirective.type === "backtrack") {
        ctx.log.info({ fp: fp.slice(0, 8), reason: appMapDirective.reason }, "[appMap] Proactive backtrack");
        adb.pressBack();
        actionsTaken.push({ step, type: "back", description: "press_back", reason: "appmap_exhausted", fromFingerprint: fp });
        await sleep(500);
        ctx.appMap.popScreen();
        ctx.modeManager.recordStep();
        continue;
      }

      if (appMapDirective.type === "switch_tab") {
        const nextTab = ctx.appMap.getNextTab();
        if (nextTab && nextTab.index !== ctx.appMap.currentNavTabIndex) {
          ctx.log.info({ tab: nextTab.label, index: nextTab.index }, "[appMap] Switching to next nav tab");
          if (ctx.appMap.currentPath.length > 1) {
            adb.pressBack(); await sleep(500);
            adb.pressBack(); await sleep(500);
          }
          adb.tap(nextTab.cx, nextTab.cy);
          await readiness.waitForScreenReady({ timeoutMs: 3000 });
          actionsTaken.push({ step, type: "tab_switch", description: "switch_tab: " + nextTab.label, reason: "appmap_tab_switch", fromFingerprint: fp });
          ctx.appMap.currentNavTabIndex = nextTab.index;
          ctx.appMap.tabSwitchCount++;
          ctx.appMap.currentPath = [];
          ctx.modeManager.recordStep();
          continue;
        }
      }

      // STAGE 14: Policy decision + recovery intercept
      if (candidates.length === 0 && (ctx.screenshotOnlyMode || !snapshot.xml)) {
        // Vision-primary with no untried candidates — press back
        decision = { action: { type: 'back', key: 'back' }, reason: 'vision_no_untried_actions' };
        ctx.log.info("Vision-primary: no untried actions — pressing back");
      } else {
        const policyResult = await selectAction(ctx, candidates, tried, fp, step, snapshot, classification);
        if (policyResult.directive === 'break') { v14Break = true; v14BreakReason = policyResult.breakReason || 'policy_break'; }
        else if (policyResult.directive === 'continue') { v14Continue = true; }
        else { decision = policyResult.decision; }
      }
    } else {
      // ── V2 vision-first path: skip candidates entirely, go straight snapshot → LLM coord decision ──
      candidates = [];
      tried = new Set();

      const vfResult = await selectActionVisionFirst(ctx, snapshot, step, classification);
      if (vfResult.directive === 'break') { v14Break = true; v14BreakReason = 'vision_first_break'; }
      else if (vfResult.directive === 'continue') { v14Continue = true; }
      else { decision = vfResult.decision; }
    }

    if (v14Break) { ctx.stopReason = v14BreakReason || 'policy_break'; break; }
    if (v14Continue) continue;

    // STAGE 15: Execute action (C7: wrapped in try-catch)
    adb.run('adb logcat -c', { ignoreError: true });
    const preActionTimestamp = Date.now();

    let description;
    try {
      description = executeAction(decision.action);
      ctx.consecutiveActionFails = 0;
      ctx.log.info({ action: description, reason: decision.reason }, "Action executed");
    } catch (execErr) {
      ctx.consecutiveActionFails++;
      ctx.log.error({ err: execErr, failCount: ctx.consecutiveActionFails }, "executeAction() threw");
      if (ctx.consecutiveActionFails >= 5) {
        ctx.stopReason = 'action_execution_failed';
        break;
      }
      if (ctx.consecutiveActionFails >= 3) {
        // Try ADB reconnect before continuing
        try { adb.reconnectDevice(); } catch (_) {}
      }
      await sleep(1000);
      ctx.modeManager.recordStep();
      continue;
    }

    ctx.lastLiveAction = {
      type: decision.action.type,
      description,
      decisionSource: decision.reason,
    };
    ctx.lastReasoning = decision.reason || null;
    {
      const _act = (decision && decision.action) || null;
      let _tx = null, _ty = null;
      if (_act) {
        if (typeof _act.x === 'number' && typeof _act.y === 'number') { _tx = _act.x; _ty = _act.y; }
        else if (_act.bounds && typeof _act.bounds.cx === 'number' && typeof _act.bounds.cy === 'number') { _tx = _act.bounds.cx; _ty = _act.bounds.cy; }
      }
      ctx.lastTapTarget = (_tx !== null && _ty !== null)
        ? { x: _tx, y: _ty, element: (_act && (_act.description || _act.text || _act.contentDesc || _act.resourceId || _act.key)) || null }
        : null;
    }
    ctx.lastExpectedOutcome = (decision && decision.action && typeof decision.action.expectedOutcome === 'string' && decision.action.expectedOutcome)
      || (decision && typeof decision.expectedOutcome === 'string' && decision.expectedOutcome)
      || null;
    sendLiveProgress(step, {
      activity: snapshot.activity || '',
      intentType: screenIntent.type || '',
      message: `Executed: ${description}`,
    });

    if (!adb.ensureDeviceReady()) {
      ctx.consecutiveDeviceFails++;
      ctx.log.warn({ failCount: ctx.consecutiveDeviceFails, maxFails: MAX_DEVICE_FAILS }, "Device not ready after action");
      // C4: Try ADB reconnect
      if (adb.reconnectDevice()) {
        ctx.consecutiveDeviceFails = 0;
        await sleep(2000);
        continue;
      }
      if (ctx.consecutiveDeviceFails >= MAX_DEVICE_FAILS) {
        ctx.stopReason = 'device_offline';
        break;
      }
      await sleep(3000);
      continue;
    }

    const actionKey = decision.action.key || description;
    ctx.lastActionKey = actionKey;
    ctx.lastActionFromFp = fp;
    actionsTaken.push({
      step,
      type: decision.action.type,
      description,
      reason: decision.reason,
      actionKey,
      fromFingerprint: fp,
    });

    // ── AppMap: Mark action as tried ──
    ctx.appMap.markActionTried(fp, actionKey);

    if (ctx.flowTracker) {
      const actionTarget = decision.action.text || decision.action.resourceId || '';
      ctx.flowTracker.addStep(classification ? classification.type : 'unknown', decision.action.type, actionTarget, fp);
    }

    // E3: Kick off pre-fetch for step N+1 while we do readiness + outcome
    if (step + 1 < maxSteps) {
      pipeline.startPrefetch(screenshotDir, step + 1);
    }

    // STAGE 16: Wait for readiness + outcome tracking (C7: wrapped, E2: adaptive)
    let readyResult, postSnapshot;
    try {
      if (ctx.screenshotOnlyMode) {
        readyResult = await waitForScreenReadyScreenshotOnly(screenshotDir, `${step}_ready`);
      } else {
        // E2: Use adaptive readiness — fast path for scrolls/revisits
        readyResult = await waitForScreenReadyAdaptive({
          timeoutMs: 5000,
          actionType: decision.action.type || 'tap',
          visitCount: stateGraph.visitCount(fp),
        });
      }
      metrics.recordReadinessWait(step, 'screen_ready', readyResult);
      postSnapshot = await captureStableScreen(screenshotDir, `${step}_post`, 2, 1500);

      // Track F: V2 vision-first — fire LLM decision prefetch for step N+1 in the background.
      // This overlaps the 3-6s LLM round-trip with subsequent outcome tracking + next-step capture.
      // On a prefetch hit (hash match), STAGE 14 of step N+1 consumes the result instead of
      // blocking on a fresh sync call. On miss, selectActionVisionFirst falls through to sync.
      if (ctx.visionFirstMode && step + 1 < maxSteps && postSnapshot && postSnapshot.screenshotPath) {
        try {
          agentPrefetch.startPrefetch(step + 1, postSnapshot, ctx);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.log.debug({ err: errMsg, step: step + 1 }, "[agent-prefetch] start failed — will sync next step");
        }
      }
    } catch (readyErr) {
      ctx.log.error({ err: readyErr }, "Readiness/post-capture threw");
      ctx.modeManager.recordStep();
      continue;
    }

    // C9: Crash recovery — relaunch app if it left foreground after action
    // Skip "unknown" — means UIAutomator is broken, not the app
    try {
      const postPkg = adb.getCurrentPackage();
      if (postPkg && postPkg !== 'unknown' && postPkg !== packageName && postPkg !== 'android' && !isAllowedNonTargetPackage(postPkg)) {
        ctx.appCrashTimestamps.push(Date.now());
        const cutoff = Date.now() - 60000;
        ctx.appCrashTimestamps = ctx.appCrashTimestamps.filter((t) => t > cutoff);
        ctx.log.warn({ postPkg, crashes: ctx.appCrashTimestamps.length, step }, "App left foreground — relaunching");

        if (ctx.appCrashTimestamps.length >= 8) {
          ctx.log.error({ crashes: ctx.appCrashTimestamps.length }, "App crash loop detected (8 in 60s)");
          ctx.stopReason = 'app_crash_loop';
          break;
        }

        // Relaunch and continue instead of breaking
        try {
          adb.run(`adb shell am force-stop ${packageName}`, { ignoreError: true });
          await sleep(1000);
          adb.run(`adb shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, { ignoreError: true });
          await sleep(3000);
          await readiness.waitForScreenReady({ timeoutMs: 5000 });
        } catch (relaunchErr) {
          ctx.log.error({ err: relaunchErr }, "Relaunch after crash failed");
        }
        ctx.modeManager.recordStep();
        continue;
      }
    } catch (_) {}

    // STAGE 17: Outcome tracking (C7: wrapped)
    try {
      const outcomeResult = await processOutcome(ctx, {
        fp, actionKey, decision, classification, postSnapshot,
        step, readyResult, preActionTimestamp,
        getPrimaryPackage, isAllowedNonTargetPackage, isTransientEmptyXml,
        stateGraph, metrics,
      });
      if (outcomeResult.shouldBreak) { ctx.stopReason = outcomeResult.breakReason || 'outcome_break'; break; }
      if (outcomeResult.shouldContinue) continue;
    } catch (outcomeErr) {
      ctx.log.error({ err: outcomeErr }, "processOutcome() threw");
    }

    ctx.modeManager.recordStep();
    metrics.recordStepEnd(step);

    // STAGE 18: Oracle checks
    try {
      const stepFindings = runOracleChecks(ctx, snapshot, step, preActionTimestamp);
      if (stepFindings.length > 0) {
        ctx.oracleFindingsByStep[step] = stepFindings;
        ctx.log.info({ count: stepFindings.length, types: stepFindings.map((/** @type {any} */ f) => f.type) }, "Oracle findings at step");
      }
    } catch (oracleErr) {
      ctx.log.error({ err: oracleErr }, "Oracle checks threw");
    }

    // Track G: per-step coverage emission — grows throughout crawl.
    // Lands only on successful step iterations (after all `continue`s),
    // so failed steps don't pollute pm2 logs with stale numbers.
    try {
      const uniqueAfter = ctx.stateGraph ? ctx.stateGraph.uniqueStateCount() : 0;
      const isNewScreen = uniqueAfter > (ctx._prevUniqueCount || 0);
      ctx.log.info({
        step,
        uniqueScreensAfterStep: uniqueAfter,
        isNewScreen,
        visionFirstMode: !!ctx.visionFirstMode,
      }, "[coverage] step");
      ctx._prevUniqueCount = uniqueAfter;
    } catch (covErr) {
      ctx.log.debug({ err: covErr && /** @type {any} */ (covErr).message }, "[coverage] step log failed");
    }
  }

  // ── Persist cross-crawl memory ──
  try {
    saveMemory(packageName, stateGraph, ctx.classificationsByFp);
  } catch (e) {
    ctx.log.warn({ err: e }, "Failed to save cross-crawl memory");
  }

  // H1: Persist app-level knowledge
  try {
    const authState = ctx.authMachine.state;
    const creds = ctx.credentials || {};
    const authMethod = ctx.authMachine.fillCount > 0
      ? (creds.email ? 'email' : creds.phone ? 'phone' : null)
      : null;
    const hasGuestMode = authState === 'FAILED_GUEST' ? true
      : (authState === 'SUCCEEDED' ? null : null);
    const frameworkType = ctx.screenshotOnlyMode ? 'compose'
      : (ctx.perceptionCache && ctx.perceptionCache.size > 5 ? 'compose' : 'native');

    saveAppKnowledge(packageName, /** @type {any} */ ({
      authMethod,
      hasGuestMode,
      frameworkType,
      avgScreenCount: stateGraph.uniqueStateCount(),
      flagSecure: ctx.screens.some((/** @type {any} */ s) => s.screenshotHash === 'no_screenshot'),
    }));
    ctx.log.info({ package: packageName }, "Saved app knowledge");
  } catch (e) {
    ctx.log.warn({ err: e }, "Failed to save app knowledge");
  }

  ctx.endTime = Date.now();

  // Track G: final crawl summary — #1 metric (unique screens) surfaces
  // here in pm2 logs alongside cost + cache hit rate. Pricing constants
  // mirror V2_PRICE_* in report-assembler.js (Sonnet per-million rates).
  try {
    const finalUnique = ctx.stateGraph ? ctx.stateGraph.uniqueStateCount() : 0;
    const tu = ctx.v2TokenUsage || {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };
    const costUSD =
      (tu.inputTokens * 3 +
        tu.outputTokens * 15 +
        tu.cacheCreationInputTokens * 3.75 +
        tu.cacheReadInputTokens * 0.30) /
      1_000_000;
    const cacheDenom = tu.cacheReadInputTokens + tu.cacheCreationInputTokens;
    const cacheHitRate = cacheDenom > 0 ? tu.cacheReadInputTokens / cacheDenom : 0;
    const elapsedMs = ctx.endTime - (ctx.startTime || ctx.endTime);
    const elapsedMin = elapsedMs / 60000;
    const stepsUsed = (ctx.actionsTaken || []).length;
    const uniquePerMinute = elapsedMin > 0 ? finalUnique / elapsedMin : 0;

    ctx.log.info({
      visionFirstMode: !!ctx.visionFirstMode,
      stepsUsed,
      uniqueScreens: finalUnique,
      uniquePerMinute: Number(uniquePerMinute.toFixed(2)),
      elapsedMs,
      tokenUsage: tu,
      costUSD: Number(costUSD.toFixed(4)),
      cacheHitRate: Number(cacheHitRate.toFixed(3)),
    }, "[coverage] crawl complete");
  } catch (covErr) {
    ctx.log.debug({ err: covErr && /** @type {any} */ (covErr).message }, "[coverage] crawl complete log failed");
  }

  return assembleReport(ctx);
}

module.exports = { runCrawl };
