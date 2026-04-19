# ProdScope Crawler Roadmap V2: Vision-First Universal Crawling

## Overview

ProdScope's current architecture is XML-first with vision as a fallback. This inverts the reliability pyramid: modern apps (Compose, Flutter, RN) degrade XML quality, leaving the crawler blind on the majority of Play Store apps. This plan redesigns the intelligence layer to be vision-primary, with XML as an accelerator when available. It introduces an auth state machine to escape auth traps generically, upgrades fingerprinting to work without XML, and gives the LLM a planning role instead of just action selection.

## Success Criteria

- [ ] Reddit auth resolves (to success or guest mode) within 8 steps, not 25+
- [ ] Reddit discovers 12+ unique screens (up from 10-11)
- [ ] Biztoso maintains 17+ unique screens (no regression)
- [ ] Auth state machine has unit test coverage for all state transitions
- [ ] Vision perception module produces valid JSON on 95%+ of calls
- [ ] Crawler completes 80 steps without error on a Compose-only app in screenshot-only mode
- [ ] No increase in per-crawl vision API cost (still <= 60 calls)

---

## Phase 1: Auth State Machine (highest impact, do first)

**Problem**: Reddit wastes 25+ steps in auth loops because 6 scattered booleans (`authFlowActive`, `authFlowStepsRemaining`, `authFillCount`, `hasValidCredentials`, `lastAuthSubmitKey`, `consecutiveSameAuthSubmit`) interact badly. Each auth screen resets the countdown.

**Solution**: New `crawler/auth-state-machine.js` — a finite state machine with explicit states and a hard global step budget that never resets.

### States

```
IDLE -> CHOOSING_METHOD -> FILLING_FORM -> SUBMITTING -> WAITING_REDIRECT -> SUCCEEDED
                |              |               |               |
                v              v               v               v
            FAILED_GUEST   FAILED_GUEST    FAILED_GUEST    ABANDONED
```

- `IDLE`: No auth activity detected yet
- `CHOOSING_METHOD`: Auth choice screen (email, Google, phone, etc.)
- `FILLING_FORM`: Credential input form detected
- `SUBMITTING`: Form submitted, waiting for result
- `WAITING_REDIRECT`: Post-submit redirect (OAuth, WebView, etc.)
- `SUCCEEDED`: Auth completed successfully (non-auth screen after form submit)
- `FAILED_GUEST`: Auth abandoned, app entered guest mode
- `ABANDONED`: Hard budget exceeded, all auth actions suppressed

### Budget

- Per-state budgets: CHOOSING_METHOD: 3, FILLING_FORM: 4, SUBMITTING: 2, WAITING_REDIRECT: 3
- **Global auth budget: 12 steps (hard cap, never resets)**
- Once `FAILED_GUEST` or `ABANDONED`: permanently suppress auth actions

### Implementation Steps

| Step | File | Change |
|------|------|--------|
| 1.1 | `crawler/auth-state-machine.js` | NEW: FSM class with global step budget, guest detection |
| 1.2 | `crawl-context.js` | Replace 6 auth booleans with `ctx.authMachine` |
| 1.3 | `auth-choice.js` | Rewire to state machine transitions |
| 1.4 | `auth-form.js` | Gate filling on `authMachine.shouldAttemptAuth()` |
| 1.5 | `run.js` | Remove auth tick/expire block (lines 235-249), replace with `authMachine.tick()` |
| 1.6 | `priority-adjustments.js` | Simplify auth priority passes |

### Files Modified

- `crawler/auth-state-machine.js` (NEW)
- `crawler/crawl-context.js` — replace auth booleans with state machine
- `crawler/auth-choice.js` — rewire to state machine
- `crawler/auth-form.js` — gate on state machine
- `crawler/run.js` — remove auth tick/expire, replace with single call
- `crawler/priority-adjustments.js` — simplify auth passes

---

## Phase 2: Vision-First Screen Understanding — ✅ IMPLEMENTED (pending deploy + test)

**Problem**: No XML -> no classification -> 13 of 16 analysis steps skipped. The `if (classify) { ... }` block in `screen-intelligence.js` gates everything.

**Solution**: Unified vision perception module that returns classification + actions + nav in one call.

### Combined Vision Response Format

```json
{
  "screenType": "feed|settings|detail|login|search|dialog|form|nav_hub|error|loading|other",
  "screenDescription": "Reddit home feed showing popular posts",
  "navBar": { "hasNav": true, "tabs": [{"label": "Home", "x": 135, "y": 2300}] },
  "mainActions": [{"description": "tap post", "x": 540, "y": 960, "priority": "high"}],
  "isAuthScreen": false,
  "isLoading": false,
  "contentDensity": "high|medium|low|empty"
}
```

This consolidates 2 vision calls into 1, doubling the effective budget.

### Implementation Steps

| Step | File | Change | Status |
|------|------|--------|--------|
| 2.1 | `crawler/vision-perception.js` | NEW: unified perception with 2-tier screenshot cache (PerceptionCache class) | ✅ DONE |
| 2.2 | `crawler/screen-identity.js` | DEFERRED: existing XML + ss_ fingerprinting is sufficient | ⬜ DEFERRED |
| 2.3 | `crawler/screen-intent.js` | Added `detectScreenIntentFromPerception()` for vision-based intent | ✅ DONE |
| 2.4 | `crawler/screen-intelligence.js` | Two parallel paths (XML or vision), removed `if(classify)` gate | ✅ DONE |
| 2.5 | `crawler/candidate-builder.js` | Vision-primary mode: `buildVisionPrimaryCandidates()` | ✅ DONE |
| 2.6 | `crawler/crawl-context.js` | Added `perceptionCache` (PerceptionCache instance) | ✅ DONE |
| 2.7 | `crawler/vision.js` | Added `consumeBudget()` for shared budget tracking | ✅ DONE |
| 2.8 | `crawler/run.js` | STAGE 12 simplified (candidate-builder handles modes), STAGE 14 simplified, vision-enriched intent after STAGE 9 | ✅ DONE |

### Key Design: Two-Tier Cache

- Tier 1: Exact screenshot hash (hamming 0) -> skip vision call
- Tier 2: Fuzzy match (hamming <= 8) -> use cached but mark `fuzzy: true`
- Tier 2 results can be re-evaluated if downstream suggests mismatch

---

## Phase 3: Generic Auth Escape Patterns — ✅ IMPLEMENTED

**Problem**: Crawler doesn't detect "guest mode" transitions or "Skip"/"Not now" buttons. When auth fails, it presses BACK 3 times and declares `auth_required_no_guest` without ever looking for escape buttons.

**Solution**: 3-tier auth escape search (XML → vision cache → targeted vision call) before falling back to BACK press. Apps with skip buttons get escaped; apps truly requiring auth are correctly identified.

### Implementation Steps

| Step | File | Change | Status |
|------|------|--------|--------|
| 3.1 | `crawler/auth-state-machine.js` | `AUTH_ESCAPE_LABELS`, `AUTH_ESCAPE_REGEX` constants; `recordAuthEscapeTapped()`, `onAuthEscaped()` methods | ✅ DONE |
| 3.2 | `crawler/system-handlers.js` | `findAuthEscapeButton(xml, labels)` — XML button search against ordered escape labels | ✅ DONE |
| 3.3 | `crawler/run.js` | STAGE 5 rewritten: 3-tier escape (XML → vision cache → targeted vision) + post-escape verification | ✅ DONE |
| 3.4 | `crawler/auth-choice.js` | Try escape button before BACK when no login method found on auth_choice screen | ✅ DONE |
| 3.5 | `crawler/priority-adjustments.js` | Boost escape buttons (priority=200), suppress auth actions (priority=0) when auth terminal | ✅ DONE |

### 3-Tier Escape Logic (STAGE 5)

```
Tier 1: XML → findAuthEscapeButton(snapshot.xml, AUTH_ESCAPE_LABELS)
Tier 2: Vision cache → scan ctx.visionResult.mainActions for AUTH_ESCAPE_REGEX
Tier 3: Targeted vision call → ask Haiku for skip buttons (screenshot-only mode)
Fallback: recordAuthSkipBack() → 3x = auth_required_no_guest; else pressBack()
```

### Test Results

- **Biztoso** (has credentials): 80 steps, 23 screens, 0 auth-escape triggers — no regression
- **Reddit** (no guest mode): 17 steps, 6 screens, `auth_required_no_guest` — all 3 tiers searched, found no skip buttons, correctly stopped

---

## Phase 4: Robust Vision-Only Navigation — ✅ IMPLEMENTED

**Problem**: Survey mode, stuck detection, and recovery all degrade without XML. Infinite-scroll feeds produce unique `ss_{hash}` fingerprints (hamming 3-6) that look "new" to stuck detection, burning budget endlessly.

**Solution**: Soft-revisit heuristic for stuck detection, screenshot-aware DEEP_SCROLL recovery, VISION_RANDOM_TAP as last-resort recovery, and screenshot-based survey verification.

### Implementation Steps

| Step | File | Change | Status |
|------|------|--------|--------|
| 4.1 | `crawler/stuck-detector.js` | `checkSoftRevisit()` — hamming distance check against recent screenshot window | ✅ DONE |
| 4.2 | `crawler/crawl-context.js` | `recentScreenshotHashes` window, `SOFT_REVISIT_WINDOW/THRESHOLD` constants | ✅ DONE |
| 4.3 | `crawler/run.js` | `effectiveIsNew` logic after STAGE 7, passed to STAGE 8 stuck checks | ✅ DONE |
| 4.4 | `crawler/recovery.js` | Screenshot-aware `_deepScroll()`, new `_visionRandomTap()` strategy | ✅ DONE |
| 4.5 | `crawler/screen-intelligence.js` | `_exploreScrollDepthScreenshotOnly()`, screenshot-based survey tab fingerprint | ✅ DONE |

### Soft-Revisit Heuristic

When a screen is "new" by fingerprint but hamming distance to a recent screenshot <= 6, treat as "soft revisit" — don't reset `consecutiveNoNewState`. Prevents infinite-scroll feeds from inflating discovery rate. Soft-revisits are still added to the state graph.

### Hamming Distance Thresholds

| Context | Threshold | Purpose |
|---------|-----------|---------|
| Soft-revisit | ≤ 6 | Catch infinite scroll positions (differ by 3-6) |
| Vision cache fuzzy | ≤ 8 | Cache tolerance for slight variations |
| Deep scroll change | > 8 | Require genuinely new content |
| Recovery change | > 10 | Strong evidence of real state change |

### Test Results

- **Biztoso**: 80 steps, 19 screens (UIAutomator degraded from step 50+ — lower count due to emulator instability, not code regression). Soft-revisit fired 2x (hamming=0, hamming=2) — correctly detected duplicates.
- **Reddit**: 17 steps, 6 screens, `auth_required_no_guest`. Soft-revisit fired 3x during auth loop. Auth escape tiers ran correctly (no skip buttons found).

---

## Phase 5: LLM as Strategic Planner — ✅ IMPLEMENTED

**Problem**: Plan is created once at crawl start and never updated.

**Solution**: Wire existing `replan()` (40% budget, nav hub only) and `replanMidCrawl()` (70% budget, unconditional) into `handlePlan()`. Add `buildExplorationMap()` for compact coverage context in replan prompts and vision journal.

### Implementation Steps

| Step | File | Change | Status |
|------|------|--------|--------|
| 5.1 | `crawler/crawl-context.js` | `_replanAt40Done`, `_replanAt70Done` tracking flags | ✅ DONE |
| 5.2 | `brain/planner.js` | `buildExplorationMap()`, `explorationMap` param on `replan`/`replanMidCrawl` | ✅ DONE |
| 5.3 | `crawler/screen-intelligence.js` | Import replan functions, wire into `handlePlan()` at 40%/70% budget | ✅ DONE |
| 5.4 | `crawler/run.js` | `formatJournal()` appends exploration map for vision context | ✅ DONE |

### Replan Triggers

- **40% budget**: Fires at navigation hub screens only. Uses `replan()` — re-prioritizes based on coverage gaps.
- **70% budget**: Fires unconditionally on any screen. Uses `replanMidCrawl()` — drops saturated targets, adds reachable uncovered features.
- **Cost**: 2 additional Haiku calls per crawl (< $0.01). Uses ANALYSIS_MODEL budget, not the 60-call vision budget.

---

## Regression Test Matrix

| App | Framework | Auth | Expected Screens | Auth Resolution |
|-----|-----------|------|-----------------|-----------------|
| Biztoso | Native Android | Email/password | >= 17 | Succeeds within 6 steps |
| Reddit | Compose | Email (fails) | >= 12 | Guest mode within 8 steps |
| Instagram | Mixed (RN + Native) | Email/password | >= 10 | Succeeds or guest within 10 steps |
| Calculator | Native, no auth | N/A | >= 5 | N/A |

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Haiku unreliable JSON for combined perception | Medium | Fallback to separate calls if parse fails |
| Auth state machine too aggressive | High | Configurable per-app budget (`config.authBudget`) |
| Vision fingerprinting inflates new-screen count | Medium | Soft-revisit heuristic with tunable hamming threshold |
| Phase 2.4 breaks XML-path coverage tracking | High | Two-path design; deploy behind feature flag |
| Mid-crawl replan produces unhelpful output | Low | Structured prompt constraining output format |

## Priority Order

1. **Phase 1** (1-2 days): Fixes Reddit and every auth-gated app immediately
2. **Phase 2** (3-5 days): Big architectural shift, unlocks everything else
3. **Phase 3** (1 day): Builds on Phase 1, adds guest mode intelligence
4. **Phase 4** (2 days): Makes vision-only mode robust end-to-end
5. **Phase 5** (1-2 days): Stretch goal, makes the crawler strategically smart
