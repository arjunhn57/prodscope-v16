# PR: V17 driver-first crawler + sprint 1-4 cleanup

Branch: `feat/v17-driver-engine` → `main`
Base SHA: first sprint commit `9e1574c` (Phase 1 — stop the bleeding)
Tip SHA: see `git log -1 feat/v17-driver-engine`

Paste the body below into the GitHub PR description. Strip this header.

---

## Summary

Ships V17 (driver-first Android crawler) as the default engine, plus four
sprints of sustaining work: regression safety net, product-quality gates,
debt reduction, and launch prep.

28 commits. 544/544 tests green. Tracks
[`V17_LAUNCH_CHECKLIST.md`](./V17_LAUNCH_CHECKLIST.md) for deploy steps
and [`ROADMAP.md`](./ROADMAP.md) for what's next.

## V17 validation (baselines for regression alerts)

| Metric | biztoso | wikipedia |
|---|---:|---:|
| Unique screens | 28 | 23 |
| Steps used | 30 | 28 |
| Cost per run (USD) | $0.0368 | $0.0401 |
| LLMFallback rate | 23.3% | 28.6% |
| stopReason | `max_steps_reached` | `agent_done:press_back_blocked` |

Aggregate: **mean cost $0.0384 / run**, overall LLMFallback 25.9%.
Driver histogram (biztoso): `{PermissionDriver:1, CanvasDriver:1,
DismissDriver:1, AuthDriver:7, ExplorationDriver:13, LLMFallback:7}`.

## What's in this PR

### Sprint 1 — Stop the bleeding
- `9e1574c` — phase 1 batch: env-validation pass at startup, thin-AI-coverage
  suppression in report-builder, multer /tmp/uploads safety, retry config on
  BullMQ, game-detection hardening.
- `037e61f` — `pm clear` before every app launch so AuthDriver sees a login
  screen instead of a stale session.
- `381bae6` — `ecosystem.config.js` CRAWL_ENGINE v16 → v17.

### Sprint 2 — Regression safety net (+43 tests)
- `c2e25de` — env-var startup validation extracted to a pure module.
- `1b58192` — pm-clear pre-launch contract pinned.
- `6ef16bf` — `scripts/golden-suite-baselines.json` + `compareToBaselines`
  with exit-code-2 on regression.
- `aa856f7` — GitHub Actions emulator-driven E2E smoke (`.github/workflows/e2e.yml`)
  using `reactivecircus/android-emulator-runner@v2`.

### Sprint 3 — Product quality (+84 tests)
- `0a84755` + 4 commits — **3-stage Haiku oracle** replacing the flat
  Sonnet-per-job synthesis. Stage 1 ranks every screen cheaply, Stage 2
  deep-analyzes the top K with `tool_choice: emit_screen_analysis`,
  Stage 3 skips Sonnet when Haiku's confidence is high. Kills the silent
  "AI analysis failed" leak; saves ~$0.046 on ~40% of runs.
- `f9d5263` — **report-quality gate**: `critical_bugs` only publish when
  `uniqueStates >= 10 AND crossedFirstDecisionBoundary`. Otherwise
  coverage-only report with retry guidance.
- `574e1f9` — RN (Discord) + Flutter (Google Pay) fixtures added to the
  driver test suite; golden suite gains two framework-coverage apps.
- `2ec6183` — **compat gate** detects anti-emulator / Play Integrity apps
  (streaming, banking) and WebView-only wrappers at ingest with specific
  user-facing messages.
- `6af9b89` — **structured api-errors envelope**:
  `{error, code, message, retryable}` for upload + job failures. 7 canonical
  codes (UPLOAD_DEST_MISSING, FILE_TOO_LARGE, INVALID_APK, MISSING_API_KEY,
  INVALID_API_KEY, EMULATOR_UNAVAILABLE, JOB_TIMEOUT).

### Sprint 4 — Debt reduction
- `bbb6423` — delete 7 dead v15 tests (-2722 lines).
- `a972829` — move `scripts/v16-vs-v17-*.js` to `scripts/regression/`.
- `bf7554d` — rotate golden-suite test creds out of source into env.
- `8745b6b` — consolidate 4 roadmap MDs into one
  [`ROADMAP.md`](./ROADMAP.md) + `docs/archive/`.
- `3674cec` — [`ARCHITECTURE.md`](./ARCHITECTURE.md) — one-page system tour.
- `9423df8` — `server.js` 1374 → 950 lines; auth + admin routes extracted
  to `routes/*.js` + shared `middleware/rate-limiters.js`.
- `533bc4a` — `scripts/deploy.sh` prefers `git reset --hard` rollback
  over tarball, tags the rollback point, distinct exit code on outage.

## Test plan

- [ ] CI: `npm test` — 544/544 green (same count pre/post refactor;
      v15 test drop compensated by v17 + oracle + guard additions).
- [ ] Unit suite exercise: `node --test crawler/v17/__tests__/*.test.js
      crawler/v17/drivers/__tests__/*.test.js` — V17 driver pins stay green.
- [ ] Manual: upload biztoso + wikipedia APKs on the VM post-deploy.
      Baselines in §0 of the launch checklist are the alert thresholds.
- [ ] Deploy: `bash scripts/deploy.sh` on the VM — new git-reset rollback
      path exercised if health-check fails. Exit 0 green, exit 1 rolled
      back cleanly, exit 2 total outage (alerting hook).
- [ ] V16 fallback sanity: set `.env:CRAWL_ENGINE=v16`, pm2 restart
      --update-env, trigger one job, verify `engine:"v16"` appears in
      pm2 logs. Flip back to v17. Keep the fallback available for 14
      days per [`V17_LAUNCH_CHECKLIST.md`](./V17_LAUNCH_CHECKLIST.md) §3.

## Follow-ups (not in this PR)

- **Server.js split part 2** — jobs/reports/meta routes still inline.
  Target: `server.js` < 300 lines (currently 950). Pattern is
  established in sprint-4.1; slots in cleanly.
- **Phase 3.5 frontend side** — structured error codes emitted by
  backend; frontend needs to dispatch on `error.code` instead of
  string-matching `error.message`. Tracked separately in the frontend
  repo.
- **Alerts surface** — thresholds documented in
  [`V17_LAUNCH_CHECKLIST.md`](./V17_LAUNCH_CHECKLIST.md) §4; picking
  Grafana / email / PagerDuty / etc. is a follow-up decision.
- **VM disk hygiene cron** — install from
  [`disk-management-plan.md`](./disk-management-plan.md). One-time SSH.
- **50-run retirement** — remove `crawler/v16/` (except the primitives
  V17 still imports) per [`V17_LAUNCH_CHECKLIST.md`](./V17_LAUNCH_CHECKLIST.md) §5.
  Not scheduled; deferred until the fallback window closes.

## Rollback plan

If any production run trips the §4 alert thresholds:

```bash
sed -i 's/CRAWL_ENGINE=v17/CRAWL_ENGINE=v16/' \
  /home/arjunhn/prodscope-backend-live/.env
npx pm2 restart backend --update-env
npx pm2 logs backend --lines 50 | grep -i 'engine:"v16"'
```

Full plan in [`V17_LAUNCH_CHECKLIST.md`](./V17_LAUNCH_CHECKLIST.md) §3 +
bottom.
