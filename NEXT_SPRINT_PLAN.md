# NEXT_SPRINT_PLAN.md

> Prioritized action plan to move prodscope-backend from
> CTO **46** / User **34** / QA **38** toward
> CTO **75** / User **68** / QA **78** over a **two-week sprint (~80h)**.
>
> Ordered by *impact × effort-to-ship*. Each phase is independently
> mergeable — ship as you finish, don't wait for the whole sprint.

---

## Sprint goal

One sentence: **make the V17 engine's production promise truthful** —
CI gates it, customers get honest reports, deploys roll back on failure,
the "any non-game app" claim holds up on the first 20 real-world APKs.

---

## Phase 1 — Stop the bleeding (P0) — 1 day (8h)

Small, cheap, immediate-impact fixes. Every item ships alone.

| # | Task | File(s) | Effort |
|---|---|---|---|
| 1.1 | Add V17 + V16 test globs to `npm test` | `package.json:8-11` | 0.5h |
| 1.2 | Multer init check: `fs.mkdirSync("/tmp/uploads",{recursive:true})` at server startup | `server.js` top | 0.5h |
| 1.3 | AI oracle suppression when coverage is thin — if `aiScreensAnalyzed / totalSteps < 0.4`, set `analysis_suppressed: true` and replace `critical_bugs` with a "insufficient coverage" explanation | `oracle/` (find report-builder) | 2h |
| 1.4 | Deploy-pipeline health gate: `scripts/deploy.sh` exits non-zero if `curl -fsS localhost:8080/health` fails within 30s post-restart | `scripts/deploy.sh` | 1h |
| 1.5 | Remove the dead `GAME_CATEGORIES` gate + replace with a package-name-prefix heuristic (`com.*games*`, `.game.`, known game-engine package prefixes) — OR document honestly that game detection is off | `lib/app-compatibility.js:30-45` | 1h |
| 1.6 | pm2 log rotation via `pm2-logrotate` module installed on VM | deploy-time action, `ecosystem.config.js` | 0.5h |
| 1.7 | Remove 60+ committed debug PNGs from repo root + add `*.png` at root to `.gitignore` (keep frontend/public PNGs) | `.gitignore`, repo root | 0.5h |
| 1.8 | Delete `crawler/_v15-archive/` — it's zombie code still appearing in test greps | `crawler/_v15-archive/` | 0.5h |
| 1.9 | Bump BullMQ `attempts: 1 → 2` for crawl jobs (one free retry on transient emulator / network failure) | `jobs/queue.js:71` | 0.5h |
| 1.10 | README.md at repo root — one page: what this is, how to run, where the docs live | `README.md` | 1h |

### Acceptance criteria (Phase 1)
- [ ] `npm test` output includes lines from `crawler/v17/drivers/__tests__/auth-driver.test.js` and similar; `pass` count >= 100 (78 v17 + 20-ish new-included v16 + existing 18).
- [ ] Fresh VM with `/tmp/uploads` removed can receive an upload without a 500 (new mkdir at startup recreates the dir).
- [ ] A 5-screen run against biztoso emits a report with `analysis_suppressed: true` and empty `critical_bugs`.
- [ ] A deploy that ships a syntax error rolls back automatically (health check 500 → exit 1 → no pm2 restart).
- [ ] `git status` on a fresh clone shows no PNGs in the root.
- [ ] `find . -path ./node_modules -prune -o -name _v15-archive -print` returns nothing.

### Expected score impact (Phase 1)
- CTO: **46 → 58** (CI actually runs the engine, deploy has a gate, repo stops looking like a debugging dumping ground)
- User: **34 → 48** (false-verdict reports suppressed; `/tmp/uploads` failure vector closed)
- QA: **38 → 55** (engine is now gated; log rotation makes debugging possible)

---

## Phase 2 — Regression safety net (P1) — 2 days (16h)

Prevents the entire class of bugs we hit in this session from
re-emerging silently.

| # | Task | File(s) | Effort |
|---|---|---|---|
| 2.1 | E2E smoke test in CI: spin up an x86 Android emulator in a GitHub Actions runner, upload `wikipedia-fresh.apk` and `biztoso.apk`, assert `uniqueScreens >= 15` (wikipedia), `AuthDriver >= 4` (biztoso), `stopReason` does not start with `blocked_by_auth:` for wikipedia | `.github/workflows/e2e.yml` + supporting shell | 8h |
| 2.2 | Baseline-comparison step inside `scripts/golden-suite-run.js`: read `scripts/golden-suite-baselines.json`, fail if `uniqueScreens < 0.8 × baseline` or `costUsd > 1.2 × baseline` per-app | `scripts/golden-suite-run.js`, new baseline json | 3h |
| 2.3 | Integration test for the runner's `pm clear` path (unit test with mocked `execFileSync` verifying it is called with the package name before launch) | `jobs/__tests__/runner.test.js` | 2h |
| 2.4 | pm2 restart-rate alert: if `restart_time` delta > 3 in 10 min, fire `consecutive_failures` webhook (existing event in `lib/alerts.js`) | `lib/alerts.js`, server startup hook | 2h |
| 2.5 | Startup env-var validation: at server boot, require `ANTHROPIC_API_KEY`, `JWT_SECRET` or `PRODSCOPE_API_KEY`, `REDIS_URL`; die loudly with actionable message if missing | `server.js` top, after dotenv | 1h |

### Acceptance criteria (Phase 2)
- [ ] PR that breaks AuthDriver's claim logic fails CI on the e2e workflow within 10 min of push.
- [ ] PR that regresses wikipedia below 15 screens fails CI with a clear baseline-delta message.
- [ ] Boot-up without `ANTHROPIC_API_KEY` in env exits with a one-line error, not a 500 at first job.
- [ ] `jobs/__tests__/runner.test.js` has a test `runner calls pm clear before am start` that passes.

### Expected score impact (Phase 2)
- CTO: **58 → 66** (deploy confidence jumps; engine regression = red X in PR UI)
- User: **48 → 56** (uploads during a degraded-backend window don't bill customers for garbage)
- QA: **55 → 72** (this is QA's main lift — regression gate closes the loop)

---

## Phase 3 — Product quality foundations (P1) — 3 days (24h)

Addresses the "reports lie to customers" problem and the "any non-game
app" claim.

| # | Task | File(s) | Effort |
|---|---|---|---|
| 3.1 | Redesign the AI oracle triage to analyze up to 10 screens (not 2-of-30) with a token budget per job; if the budget can't cover enough diverse screens, keep `analysis_suppressed: true` from Phase 1 | `oracle/triage.js`, `config/defaults.js` | 6h |
| 3.2 | Report-quality gate: only publish `critical_bugs` if the crawl reached `>= 10 unique screens` AND `crossedFirstDecisionBoundary === true`. Otherwise the report becomes coverage-only + recommendations-to-retry | `oracle/` report-builder | 4h |
| 3.3 | Add RN + Flutter fixtures to the V17 driver test suite (one screen each) and a golden-suite app per framework (Discord/RN, Google Pay/Flutter) | `crawler/v17/__fixtures__/`, `scripts/golden-suite-run.js` | 6h |
| 3.4 | Extend `lib/app-compatibility.js` to detect: (a) games via package-name heuristic, (b) DRM/anti-emulator likely via `com.google.android.play.integrity` manifest permission, (c) WebView-only via absence of non-WebView activities — each with a user-facing message | `lib/app-compatibility.js`, tests | 4h |
| 3.5 | User-facing error messages for upload failures (Vercel 502, Multer ENOENT, API-key missing) — the frontend should show a human sentence, not a stack trace | `frontend/src/features/upload/`, backend 4xx/5xx handlers | 4h |

### Acceptance criteria (Phase 3)
- [ ] A working Biztoso crawl produces a report where the "critical bugs" either match reality OR the section is replaced with "coverage too thin to assess." No more "app stuck on loading screen" false positives on a 26-screen run.
- [ ] Upload a known-bad APK (Tinder, Uber Eats, or a DRM-heavy streaming app). System either crawls it OR rejects at the compat gate with a specific reason.
- [ ] An RN app (Discord) reaches `AuthDriver >= 3` OR the compat gate rejects with "React Native detected — limited driver coverage."
- [ ] Vercel 502 from a 40MB upload produces a Vercel-side UI message like "upload exceeds proxy limit — retry via direct URL or compress the APK."

### Expected score impact (Phase 3)
- CTO: **66 → 72** (the product story matches the engine's actual capability; investor demos stop landing on hallucinated bug reports)
- User: **56 → 68** (report accuracy jumps; compat gate handles the 40% failure cases honestly)
- QA: **72 → 75** (broader app-type fixture coverage)

---

## Phase 4 — Debt reduction (P2) — 2 days (16h)

Not glamorous, but stops the "what does this repo even do" first
impression.

| # | Task | File(s) | Effort |
|---|---|---|---|
| 4.1 | Split `server.js` (1337 lines) into `routes/auth.js`, `routes/jobs.js`, `routes/admin.js`, `routes/reports.js` via Express Routers. Keep `server.js` <= 300 lines of wiring | `server.js` → `routes/*.js` | 6h |
| 4.2 | Consolidate `CRAWL_ROADMAP.md`, `CRAWL_ROADMAP_V2.md`, `BACKEND_PARITY_ROADMAP.md`, `BACKEND_V1_1_ROADMAP.md` into one `ROADMAP.md` + archive the others to `docs/archive/` | repo root | 2h |
| 4.3 | `ARCHITECTURE.md` (referenced by `CLAUDE.md` but doesn't exist) — 1-page diagram of ingress → queue → runner → engine → oracle → report | `ARCHITECTURE.md` | 3h |
| 4.4 | Delete the old `crawler/__tests__/*` tests that cover `crawler/_v15-archive/` — they're running in CI but testing code that shouldn't exist | `crawler/__tests__/`, `package.json` | 1h |
| 4.5 | Move `scripts/v16-vs-v17-*.js` into `scripts/regression/` to signal they're dev tools, not CI | `scripts/` | 0.5h |
| 4.6 | Rotate the test credentials baked into `scripts/golden-suite-run.js` (email `aetdummyaccount@gmail.com` in plaintext) into env vars | `scripts/golden-suite-run.js` | 1h |
| 4.7 | Convert `scripts/deploy.sh` (git pull + pm2 restart) into something that actually supports rollback: tag the current SHA before pull, run `git reset --hard <tag>` on health-gate failure | `scripts/deploy.sh` | 2h |
| 4.8 | Disk hygiene cron from `disk-management-plan.md` — install as `/etc/cron.d/prodscope-disk-cleanup` on VM, not a follow-up | VM-side, doc in repo | 0.5h |

### Acceptance criteria (Phase 4)
- [ ] `wc -l server.js` < 300.
- [ ] `ls *.md | wc -l` at repo root ≤ 5 (README, ROADMAP, ARCHITECTURE, V17_LAUNCH_CHECKLIST, disk-management-plan).
- [ ] `ARCHITECTURE.md` exists and CLAUDE.md's reference to it resolves.
- [ ] Deploy of a SHA-intentionally-broken branch rolls back automatically; `git log -1` on VM shows the prior SHA.
- [ ] No hardcoded test email/password anywhere under `scripts/`.

### Expected score impact (Phase 4)
- CTO: **72 → 78** (investor demo: clean repo, one roadmap, architecture diagram, rollback works)
- User: **68** (no change)
- QA: **75 → 78** (CI no longer tests archived code; rollback reduces "a bad deploy stays live" window)

---

## Phase 5 — V17 launch execution (P2) — 1 day (8h)

Executes the steps already documented in `V17_LAUNCH_CHECKLIST.md`.

| # | Task | Effort |
|---|---|---|
| 5.1 | Merge `feat/v17-driver-engine` → `main` (after Phases 1-4 land) | 0.5h |
| 5.2 | Tag the merge commit `v17.0.0`, write release notes drawn from the commit trail | 1h |
| 5.3 | Wire the alert webhooks (Phase 1 events) to a real Slack channel | 1h |
| 5.4 | Run the 10-app golden suite on main-post-merge, commit the results JSON to `scripts/golden-suite-baselines.json` as the Day-0 baseline | 3h |
| 5.5 | Monitor first 50 production runs, confirm metrics within 20% of baseline per V17_LAUNCH_CHECKLIST | 2h (spread over a week — checklist item, not continuous work) |
| 5.6 | After the 14-day V16 fallback window closes with no regression, execute the V16-retirement tasks from `V17_LAUNCH_CHECKLIST.md §5` | half-day, deferred |

### Acceptance criteria (Phase 5)
- [ ] `main` has V17 as the default, V16 still functional via `CRAWL_ENGINE=v16`.
- [ ] `scripts/golden-suite-baselines.json` checked in; Phase 2's baseline-comparison step reads it.
- [ ] `#prodscope-alerts` (or equivalent) receives at least one test alert during the sprint.

### Expected score impact (Phase 5)
- CTO: **78 → 82** (release discipline: tag, notes, rollback plan, monitored cutover)
- User: **68 → 70** (alerts catch regressions before the 50th customer hits them)
- QA: **78 → 82** (baseline file turns "did this PR regress?" into a yes/no signal)

---

## Summary

| Phase | Effort | CTO | User | QA |
|---|---:|---:|---:|---:|
| Baseline (today) | — | 46 | 34 | 38 |
| After Phase 1 (1d) | 8h | 58 | 48 | 55 |
| After Phase 2 (2d) | 16h | 66 | 56 | 72 |
| After Phase 3 (3d) | 24h | 72 | 68 | 75 |
| After Phase 4 (2d) | 16h | 78 | 68 | 78 |
| After Phase 5 (1d + 1w monitor) | 8h | **82** | **70** | **82** |
| **Total sprint budget** | **72h** | | | |

Remaining ~8h of the 80h sprint is slack for the inevitable "something
blocked on infra" or "AI oracle rewrite took longer than 6h."

## What this plan deliberately does NOT do

- **No architectural rewrites.** Keep V17 engine intact; fix the wrappings.
- **No frontend redesign.** Upload UX is correct; only error-message
  surface changes.
- **No multi-emulator concurrency.** Capacity is a post-V17-retirement
  problem; ship correctness first.
- **No new driver.** Phase C is shipped. OnboardingDriver deferred until
  a real app needs it.
- **No V16 retirement in this sprint.** The 14-day V17-on-main window
  plus "50 clean runs" gate from `V17_LAUNCH_CHECKLIST.md` applies;
  retirement happens next sprint, not this one.

## Open decisions that need your call before Day 1

1. **Emulator in GitHub Actions** (Phase 2.1) — `reactivecircus/android-emulator-runner` action takes 5-8 min per job. Acceptable or self-host a runner?
2. **Game detection heuristic** (Phase 1.5) — kill the gate entirely vs. replace with the package-name heuristic? Killing is more honest but removes the early-reject.
3. **AI oracle triage redesign** (Phase 3.1) — stay with Haiku or escalate to Sonnet for deeper screens? Cost per run rises from ~$0.02 to ~$0.10.
4. **Alert webhook target** — Slack channel ID, or Discord, or custom?
