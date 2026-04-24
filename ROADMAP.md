# ProdScope Roadmap

Single source of truth. Replaces the prior four-roadmap tangle
(`CRAWL_ROADMAP.md`, `CRAWL_ROADMAP_V2.md`, `BACKEND_PARITY_ROADMAP.md`,
`BACKEND_V1_1_ROADMAP.md`) which have been moved to `docs/archive/` for
historical reference.

For the architecture behind the milestones below, see
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Where we are — 2026-04-24

- **V17 driver-first crawler shipped and validated** on the real API
  path. Biztoso job `23e93fbc` crossed login via AuthDriver (6 hits),
  captured 16 unique screens at $0.0199. Wikipedia baseline ≥ 20
  screens. Full test suite 750+ green.
- **Oracle 3-stage Haiku pipeline** (Phase 3.1) — Stage 1 ranks every
  screen cheaply, Stage 2 deep-analyzes the top K with tool_use,
  Stage 3 conditionally skips Sonnet when signals are high-confidence.
  Saves ~$0.046 per skip, kills the silent "AI analysis failed" leak.
- **Quality gates on reports** (Phase 3.2) — `critical_bugs` only
  surface when the crawl reached ≥ 10 unique screens AND crossed the
  first decision boundary. Thin-coverage runs get an honest
  coverage-only report.
- **Compatibility gate** (Phases 3.3 / 3.4) — games, DRM / Play
  Integrity apps, and WebView-only wrappers get rejected at ingest
  with a specific reason. RN + Flutter driver tests pinned.
- **Structured api-errors envelope** (Phase 3.5) — upload + job
  failures emit `{error, code, message, retryable}` so the UI can
  dispatch programmatically.
- **CI emulator smoke** (Phase 2.1) — every PR that touches the
  crawler boots an emulator via `reactivecircus/android-emulator-runner`
  and runs a 10-step Wikipedia crawl.

---

## Now — active work

Sprint plan: [`NEXT_SPRINT_PLAN.md`](./NEXT_SPRINT_PLAN.md).

Phase 4 (debt reduction): server.js split into routers, doc
consolidation (this file), architecture doc, deploy script rollback.
Phase 5 (V17 launch execution): follows [`V17_LAUNCH_CHECKLIST.md`](./V17_LAUNCH_CHECKLIST.md).

---

## Next — post-sprint

These are committed for the release after the current sprint lands.

1. **Frontend error copy rewrite.** Backend emits structured
   api-errors; the Vercel frontend still shows generic
   "upload failed" copy. Wire FE dispatch on `error.code` (task 3.5
   complement).
2. **Baseline comparison in CI.** `scripts/golden-suite-baselines.json`
   is in place. Wire `--baselines=...` into the nightly CI job so a
   bad merge fails fast instead of waiting for manual inspection.
3. **Disk hygiene cron on VM.** Install the cron from
   [`disk-management-plan.md`](./disk-management-plan.md) so the
   /tmp/screenshots-* buildup can't cause the 500-on-upload incident
   again (happened 2026-04-23, fixed manually).

---

## Later — parking lot

Ideas with real merit but not yet scheduled. Promote to "Next" when
evidence accumulates that the status quo is costing us.

1. **Haiku self-consistency on disputed findings.** For Stage 2
   `critical_bugs` with confidence < 0.8, re-ask Haiku twice with
   small prompt variations; publish only if 2-of-3 agree. Targeted
   cost: ~$0.01/run. Kills "Haiku confidently wrong" failure mode.
   Gate on post-ship telemetry showing that failure mode is common.
2. **Vision-primary fallback for unparseable screens.** When the
   accessibility tree is degenerate (Flutter canvas, WebView-heavy,
   single-view games), CanvasDriver yields to LLMFallback today.
   Direct vision-on-screenshot would give deeper coverage on the
   long tail of apps whose XML is useless.
3. **Multi-emulator pool.** `EMULATOR_SERIALS` env var already maps to
   BullMQ concurrency. Provisioning + autoscaling the pool is a
   separate DevOps track.
4. **Batch uploads.** The request shape already supports one APK /
   one job. Users with 10+ apps to test would benefit from a
   "submit a zip, receive per-app reports" flow.
5. **Public changelog.** The score-tracking / sprint-plan docs are
   internal. A user-facing changelog keyed to the features this
   roadmap ships would help with product-market-fit signals.

---

## Archived

- [`docs/archive/CRAWL_ROADMAP.md`](./docs/archive/CRAWL_ROADMAP.md)
  — original phase-1 vision-budget plan. Everything in it shipped
  or was superseded by V17.
- [`docs/archive/CRAWL_ROADMAP_V2.md`](./docs/archive/CRAWL_ROADMAP_V2.md)
  — vision-first universal crawling plan. The universality goal was
  delivered differently (V17 driver-first + CanvasDriver fallback).
- [`docs/archive/BACKEND_PARITY_ROADMAP.md`](./docs/archive/BACKEND_PARITY_ROADMAP.md)
  — "backend needs to catch up to the frontend" plan. Largely shipped;
  remaining items rolled into NEXT_SPRINT_PLAN.md.
- [`docs/archive/BACKEND_V1_1_ROADMAP.md`](./docs/archive/BACKEND_V1_1_ROADMAP.md)
  — the 2026-04-13 external-review response. Scored 53/100 at the
  time; the sprint plans have moved the needle on most categories.
