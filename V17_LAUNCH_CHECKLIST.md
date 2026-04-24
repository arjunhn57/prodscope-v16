# V17 Launch Checklist

Branch: `feat/v17-driver-engine` — validated 2026-04-23.
Baselines captured below are from the 2-app V17-only golden suite
(biztoso + wikipedia, 30 steps each, clean emulator post `-wipe-data`).

## 0. Baselines (today's reference — used for regression alerts)

| Metric | biztoso | wikipedia |
|---|---:|---:|
| Unique screens | 28 | 23 |
| Steps used | 30 | 28 |
| Cost per run (USD) | $0.0368 | $0.0401 |
| LLMFallback rate | 23.3 % | 28.6 % |
| stopReason | `max_steps_reached` | `agent_done:press_back_blocked` |

Aggregate: mean cost $0.0384 / run, overall LLMFallback 25.9 %, both gates green.
Driver histogram (biztoso): `{PermissionDriver:1, CanvasDriver:1, DismissDriver:1, AuthDriver:7, ExplorationDriver:13, LLMFallback:7}`.

## 1. Merge `feat/v17-driver-engine` → `main`

- [ ] Open PR: `arjunhn57/prodscope-v16` → `main`.
- [ ] PR description includes: link to this checklist, the validation table
      above, the 3 D.2 commits (`88ae58d`, `c3a9b7c`, `0aaba62`), and a
      pointer to `disk-management-plan.md`.
- [ ] CI green (v17 unit suite must show `pass 78, fail 0`).
- [ ] Squash-merge or rebase, at Arjun's discretion. No force-push to `main`.

## 2. Deploy to VM with `CRAWL_ENGINE=v17` as default

- [ ] On `prodscope-vm`, in `/home/arjunhn/prodscope-backend-live/.env`,
      set `CRAWL_ENGINE=v17`. (If the key is absent, add it.)
- [ ] Confirm the backend loop loads V17. The engine-selection switch
      lives in `jobs/runner.js` (search for `CRAWL_ENGINE`, ~line 270),
      NOT in `crawler/run.js` (that path doesn't exist — it was removed
      in sprint-4.4). Additionally, `ecosystem.config.js` now pins
      `CRAWL_ENGINE: "v17"` in the pm2 env block, so even without a
      `.env` override the default deploy selects V17.
- [ ] Reload pm2: `npx pm2 restart backend --update-env`.
- [ ] Smoke: tail `npx pm2 logs backend` for 1 min and confirm
      `component: "v17-loop"` appears on the next run.

## 3. Keep V16 as fallback for 2 weeks

- [ ] Do not delete `crawler/v16/` files from `main`.
- [ ] `CRAWL_ENGINE=v16` must continue to route to V16 agent-loop (the
      conditional in `crawler/run.js` already supports this — verify once
      after merge by setting the env var and triggering one run).
- [ ] If any production run reports a regression > 20 % vs the baselines in
      §0, operator flips `.env` to `CRAWL_ENGINE=v16`, `pm2 restart backend
      --update-env`, and files an issue. Fallback window is 14 calendar
      days from deploy date.

## 4. Monitoring (runs on every production crawl)

Alert thresholds — any one trips → page:

- [ ] **Cost per run** > baseline × 1.20 sustained over 5 consecutive runs.
      biztoso: alert if > $0.0442. wikipedia: alert if > $0.0481.
- [ ] **Unique screens per run** < baseline × 0.80 sustained over 5
      consecutive runs. biztoso: alert if < 22. wikipedia: alert if < 18.
- [ ] **LLMFallback rate** > baseline × 1.20 sustained over 5 consecutive
      runs. biztoso: alert if > 28 %. wikipedia: alert if > 34 %.
- [ ] **Driver histogram drift** — alert if the mix shifts so that
      `LLMFallback` takes over any single role's slot (e.g. biztoso
      `AuthDriver` drops to 0 while `LLMFallback` rises). Concretely: alert
      if `LLMFallback / (sum of all drivers)` > 0.33 on any run.

Implementation: every run already emits `perApp.driverHits`,
`perApp.costUsd`, `perApp.uniqueScreens`, `perApp.llmFallbackRate` in the
`GOLDEN_SUITE_RESULT` JSON. Wire the existing run-summary pipeline to feed
those metrics into whatever alerting surface is in use; don't build a new
system.

## 5. Retire V16 — after 50 consecutive clean production runs

"Clean" = none of the §4 alert thresholds tripped.

- [ ] Confirm the last 50 runs logged via the alerting surface show zero
      regression.
- [ ] Remove `crawler/v16/` (except `auth-escape.js`, `observation.js`,
      `state.js`, `budget.js`, `executor.js`, `tap-target-resolver.js` —
      V17 imports these as shared primitives; verify with
      `grep -r "require.*v16" crawler/v17/` before removing).
- [ ] Remove `CRAWL_ENGINE` branch in `crawler/run.js`; v17 becomes the
      only path.
- [ ] Delete the V16 → V17 comparison harness
      (`scripts/v16-vs-v17-wikipedia.js`, `scripts/v16-vs-v17-biztoso.js`)
      — they compare against something that no longer exists.
- [ ] Keep `scripts/golden-suite-run.js` and the `2app.json` / `4app.json`
      configs. Those remain valid V17 regression tests.

## Rollback plan (if anything goes wrong during the 2-week window)

1. `sed -i 's/CRAWL_ENGINE=v17/CRAWL_ENGINE=v16/' /home/arjunhn/prodscope-backend-live/.env`
2. `npx pm2 restart backend --update-env`
3. Verify V16 is live: `npx pm2 logs backend | grep -i v16-loop`
4. File an issue with run id, stopReason, uniqueScreens, and the log snippet.

No emergency-only operations (force-push, release deletion) are in scope
for this checklist.
