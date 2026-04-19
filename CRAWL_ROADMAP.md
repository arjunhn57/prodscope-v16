# ProdScope Crawler Roadmap

## VM Info
- IP: 34.10.240.173, user: arjunhn, SSH key: ~/.ssh/google_compute_engine
- Backend path: ~/prodscope-backend-live
- PM2 command: `npx pm2 restart backend` / `npx pm2 logs backend`

## Phase 1: Vision-Primary Mode — COMPLETE

### Phase 1a: Vision Budget ✅ DONE
- `config/defaults.js:41` — MAX_VISION_CALLS_PER_CRAWL: 60 (was 15)
- `crawler/run.js` — Confidence gate at < 0.5 (tried 0.8, reverted — wasteful)
- Result: Compose screens can now use full vision navigation

### Phase 1b: Screenshot Perceptual Hashing ✅ DONE
- NEW: `crawler/screenshot-fp.js` — Perceptual hashing for screenshot-based fingerprinting
- NEW: `crawler/xml-quality.js` — XML quality scoring to detect when XML is unreliable
- Result: 19 fuzzy cache hits per crawl, vision calls dropped from 11 → 4

### Phase 1c: Capture Resilience ✅ DONE
- `crawler/run.js` — captureStableScreen() returns partial snapshot (xmlFailed=true) when XML fails but screenshot works
- Vision-only step handler: uses screenshot + vision when XML is unavailable
- Result: Crawler never dies from UIAutomator crashes

### Phase 1d: UIAutomator Resilience for Compose Apps ✅ DONE
- `crawler/adb.js` — UIAutomator health tracking (consecutiveXmlFailures, degraded flag, restartUiAutomator())
- `crawler/screen.js` — Partial snapshot on FLAG_SECURE (XML without screenshot)
- `crawler/capture-step.js` — Screenshot-only capture mode, UIAutomator restart in captureStableScreen
- `crawler/readiness.js` — Degraded UIAutomator guard, screenshot-based readiness polling
- `crawler/recovery.js` — RESTART_UIAUTOMATOR strategy, screenshot-aware softBack/relaunchBranch
- `crawler/run.js` — Screenshot-only fingerprinting (ss_ prefix), vision-only action selection
- `crawler/outcome-tracker.js` — Screenshot-based outcome tracking
- `crawler/loading-detector.js` — Degraded UIAutomator guard
- `crawler/crawl-context.js` — screenshotOnlyMode, uiAutomatorRestartAttempts
- Result: Reddit (Compose + FLAG_SECURE) goes from 6 steps/2 screens → 80 steps/10 screens
- Verified: Biztoso still 80 steps/17 screens (no regression)

### Phase 1e: Vision-Assisted Navigation Detection ✅ DONE
- `crawler/screen-intelligence.js` — detectNav() rewritten: removed step-5 limit, allows retry (max 3 attempts), skips during auth, accepts "other"/"unknown"/"loading" on home screen, works in screenshot-only mode (no classification), passes fp for home detection
- `crawler/screen-intelligence.js` — handleSurveyMode() null-safe for classification, screenshot-only survey with postXml guard
- `crawler/screen-intelligence.js` — Section 14a: vision-only nav detection + survey for screenshot-only mode (outside classify block)
- `crawler/vision.js` — detectNavTabs() guards blank screenshots (FLAG_SECURE), improved prompt mentions Compose/Flutter/RN
- `crawler/navigator.js` — _findBottomRow() infers screen height from XML bounds (no hardcoded 1920 threshold), added _inferScreenHeight()
- Verified: Biztoso 78 steps/21 screens (baseline 17-19, no regression), Reddit 79 steps/11 screens (baseline 10)
- Note: Reddit nav detection triggers on home but vision finds no tabs at loading stage; auth_choice loop prevents retry after feed loads. Full benefit requires auth loop fix (separate task).

## Phase 2: run.js Refactor — ✅ COMPLETE
Split the ~1,888-line god function into pipeline modules.

### Phase 2.0: CrawlContext ✅ DONE
- NEW: `crawler/crawl-context.js` — State container replacing 40+ mutable variables
- All state references renamed to `ctx.*` throughout run.js
- Verified: 79 steps, 20 unique screens, 0 errors (job 311b4d48)

### Phase 2.1: Extract Leaf Functions ✅ DONE
- NEW: `crawler/oracle-checks.js` — Crash/ANR/accessibility/slow transition detection
- NEW: `crawler/stuck-detector.js` — Cycling loop, no-new-state, discovery exhaustion
- NEW: `crawler/system-handler-step.js` — System dialogs + auth-screen bypass
- NEW: `crawler/watchdog-step.js` — Per-step emulator health check
- NEW: `crawler/outcome-tracker.js` — Post-action outcome analysis + ineffective tap tracking
- run.js: 1,888 → 1,650 lines (238 lines extracted)
- Verified: 80 steps, 19 unique screens, 0 errors (job a7f87db4)

### Phase 2.2: Extract Auth + Action Modules ✅ DONE
- NEW: `crawler/auth-helpers.js` — Shared auth scoring (authSubmitScore, findBestAuthSubmitAction, makeAuthSubmitKey, hasValidationErrorText)
- NEW: `crawler/auth-choice.js` — Auth choice screen + WebView auth navigation
- NEW: `crawler/auth-form.js` — Form detection + credential fill + submit
- NEW: `crawler/candidate-builder.js` — Action extraction from XML + vision action injection
- NEW: `crawler/action-executor.js` — Execute action switch (TAP, TYPE, SCROLL, BACK, etc.)
- NEW: `crawler/priority-adjustments.js` — 10 named priority passes composed in adjustPriorities()
- Removed dead imports: gestures, findScrollableElement, forms, MAX_AUTH_FILLS, MAX_SAME_AUTH_SUBMIT
- run.js: 1,650 → ~1,150 lines (~500 lines extracted)
- Verified: 80 steps, 20 unique screens, 0 errors (job be9df075)

### Phase 2.3: Extract Screen Intelligence ✅ DONE
- NEW: `crawler/screen-intelligence.js` — Classification, vision, coverage, survey, overlays, form-loop
  - Sub-functions: classifyScreen, computeEffectiveFp, resolveVision, handleSaturation, handlePlan, detectNav, handleSurveyMode
  - Brain module imports (classify, createInitialPlan, currentTarget, advanceTarget) moved here
- Removed dead imports from run.js: assessXmlQuality, navigator, scroll-explorer, MODE, VISION_*, 5 crawl-context constants
- run.js: ~1,150 → 718 lines (~430 lines extracted, 424-line module)
- Verified: 80 steps, 23 unique screens, 0 errors (job 9eaaf270)

### Phase 2.4: Extract Remaining + Final Pipeline ✅ DONE
- NEW: `crawler/capture-step.js` — Screen capture + failure handling + vision-only fallback
- NEW: `crawler/out-of-app.js` — Out-of-app detection + manual relaunch recovery
- NEW: `crawler/policy-step.js` — Policy selection + recovery intercept
- NEW: `crawler/report-assembler.js` — Final result assembly + artifact persistence
- run.js: 718 → 360 lines (thin pipeline orchestrator, 18 labeled stages)
- Removed dead imports: fs, screen, actions, policy, waitForContentLoad, systemHandlers, forms, gestures
- All `continue`/`break` semantics preserved via `{ directive }` return pattern
- Verified: 80 steps, 19 unique screens, 0 errors (job 681318a1)
- **Phase 2 COMPLETE** — run.js reduced from 1,888 → 360 lines (81% reduction)

## Phase 3: Cross-Crawl Memory ✅ DONE
- NEW: `jobs/screen-memory.js` — SQLite `screen_memory` table (app_package, fingerprint, screen_type, feature, action_outcomes, total_visits)
- NEW: `crawler/graph.js` — `mergeRememberedOutcomes()` imports permanent-bad outcomes into stateGraph nodes
- `crawler/run.js` — Loads memory at crawl start, merges on each addState, saves at crawl end
- `crawler/crawl-context.js` — Added `screenMemory` and `classificationsByFp` fields
- Save: persistent bad outcomes (ineffective, out_of_app, crash, dead_end) + screen type + feature classification
- Load: pre-populates stateGraph action outcomes so known dead-ends are automatically skipped by policy
- Smart merge: if an action was previously bad but now returns 'ok', the bad entry is cleared (handles app updates)
- Verified: Crawl 1 saved 22 screens (17 dead-end actions), Crawl 2 loaded all 22 and recalled 3 bad actions on home screen

## Phase 4: Async ADB ⬜ DEFERRED
- Only needed for multi-emulator parallelism
- Current single-emulator with capture resilience is adequate

## Other Completed Fixes (deployed)
- Auth flow: hasValidCredentials gate, auth_choice handler, WebView vision-only auth, credential-aware policy boost
- Out-of-app recovery: 3-attempt manual relaunch retry + SOFT_BACK strategy
- Saturation tuning: VISIT_THRESHOLD=8, STALE_WINDOW=5, MAX_NO_NEW_STATE=8
- Saturation-back resets consecutiveNoNewState to 0
- Early stop: exploration_exhausted when 0 new screens in 12 steps + all saturated
- SSE live preview: /api/job-sse/:jobId endpoint
- APK install timeout: 120s
- 502 fix: slimmed job-status response
- Email sending: disabled (if false && opts.email)

## Missing Priorities (found during analysis)
1. Screen resolution independence — hardcoded coordinates in recovery.js, navigator.js, vision.js
2. Vision prompt optimization — screen-type-specific prompts could cut output tokens 30%
3. Checkpoint resume — checkpoints table exists in SQLite but not wired up

## Latest Verified Results
### com.biztoso.app
- 80 steps, 17-22 unique screens, max_steps_reached
- Vision: 4/60 calls (19 fuzzy cache hits)
- Tokens: ~19k per crawl
- Cross-crawl memory: 22 screens saved, 17 dead-end actions remembered
- Crawl 2: loaded 22 remembered screens, recalled 3 known-bad actions on home screen
- UIAutomator degrades occasionally (Compose), recovers via restart
- Stable across multiple runs

### com.reddit.frontpage (Compose + FLAG_SECURE)
- Auth state machine: terminates auth in 6 steps (was 25+), then 16 steps total with auth_required_no_guest
- Auth bugs fixed: self-transition counter reset, form re-fill dedup (fieldTypeKey), auth exit loop detection
- Previously: 80 steps wasted in infinite auth loop
