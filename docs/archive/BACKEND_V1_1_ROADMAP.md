# Backend v1.1 Roadmap

**Trigger:** The first paying customer demands a feature or hits a hard
wall this roadmap fixes. Not before.

**Current score:** 53/100 (external review, 2026-04-13). The system is
intelligent but prototype-grade in execution. Intelligence layer scored
72/100 — the thinking behind the crawler is strong; the infrastructure
around it is not.

**Do not work on this list until the trigger fires.** Every backend
improvement made with zero paying customers is pure cost with zero
revenue unlock. Landing page, sales, and first-customer onboarding are
higher leverage until then.

---

## The 5 items (ranked by ROI per day)

### 1. GCS for screenshots (~1 day)

Move screenshot storage from `/tmp/*` to a Google Cloud Storage bucket
with signed URLs. Screenshots are the product. `/tmp` is ephemeral and
loses data on container restart or disk cleanup.

Files to touch: `crawler/capture-step.js`, `crawler/run.js` (screenshot
write paths), `config/` for GCS credentials, `jobs/screen-memory.js`
(where the paths are persisted to SQLite).

Why highest ROI: one day of work eliminates a whole class of
"customer's report disappeared" tickets.

### 2. Crawl checkpointing every N steps (~2 days)

Snapshot the coverage graph + visited-screen state every 10 steps so a
mid-crawl failure can resume instead of restarting. A 10-15 minute
crawl that costs ~$0.30 in tokens is unacceptable to re-run on every
OOM / emulator crash / timeout.

Files to touch: `crawler/graph.js`, `crawler/run.js` (main loop
checkpoint hook), a new `crawler/checkpoint.js` module. Storage in
SQLite alongside the job row is fine for v1.1.

### 3. Wire EmulatorPool for real (~2 days)

The pool abstraction exists at `emulator/pool.js` but `runner.js` calls
`bootEmulator()` / `resetEmulator()` directly. Today, two concurrent
crawl jobs serialize through one emulator. The fix is wiring the pool
into the job dispatcher and teaching it to lease + return emulators.

Files to touch: `emulator/pool.js` (verify ready, add lease/return),
`jobs/` (job queue takes a pool handle), `crawler/run.js` (accepts an
emulator from the pool instead of booting its own).

Blocker for customer #5+: serial queue works for 1-4 customers with a
"your report will start in ~12 min" message. At 5+ simultaneous jobs
the queue latency gets ugly.

### 4. Kill V1 code paths (~1 day of careful deletes)

`USE_CRAWLER_V1` flag branches exist in `crawler/run.js`,
`crawler/policy-step.js`, and others. Two crawl engines in one
codebase is pure cognitive tax. Pick V2 (vision-first), delete V1 code
paths, delete the flag. Every module gets simpler.

Do this AFTER items 1-3 so you don't touch the critical path while
it's mid-hardening.

### 5. Integration test harness for the 18-stage loop (~1 week)

Unit tests on extracted modules are good. They don't catch the actual
bug surface, which is the pipeline running end-to-end against a real
emulator. Build a test harness that: boots an emulator, installs a
known test APK, runs the full crawl loop, asserts on the final
coverage graph and finding set.

This is the hardest item. Expect flakiness, expect CI timing issues.
Worth it because without this you can't refactor CrawlContext safely —
and CrawlContext is the real long-term scar.

---

## Explicitly NOT on this list

These came up in the review but are deferred further:

- **CrawlContext god-object refactor.** Real fix is each stage declares
  inputs + returns outputs, no `ctx.*` reads. That's a multi-week
  rewrite and blocks nothing revenue-side. Defer until integration
  tests (item 5) exist — you can't safely rewrite the plumbing without
  a test harness to catch regressions.
- **Hardcoded INR exchange rate** (`92.96` in `runner.js`). Nit. Fix
  when you add a billing dashboard.
- **Email step 6 gated behind `if (false && ...)`**. Cosmetic bug:
  frontend still shows "Sending Email" as a progress step. Delete the
  step from the UI in a frontend commit, don't touch the backend.
- **SSH patching workflow / `.before_*` backup files in repo.** Delete
  the backup files in a chore commit, commit directly instead of
  patching remotely, enforce via a pre-commit hook. ~1 hour, do it
  whenever.

---

## Time budget

~2 weeks of focused backend work when the trigger fires. Items 1-4 can
ship in a single 1-week sprint; item 5 is the slow one and is what
unlocks safe refactors beyond v1.1.

---

## Review source

Based on external review 2026-04-13 that rated the crawler 53/100 on
overall engineering execution:

| Dimension                                        | Score |
|--------------------------------------------------|-------|
| Intelligence layer (vision, auth FSM, oracle)    | 72    |
| Code structure & decomposition                   | 58    |
| Reliability & fault tolerance                    | 40    |
| Scalability                                      | 25    |
| Testing                                          | 38    |
| Production readiness (deploy, observe, operate)  | 48    |
| **Weighted overall**                             | **53**|

The thinking behind the crawler is 70+ material. The execution
infrastructure around it is still prototype-grade. The gap between 53
and 80 is not more features — it is the 5 items above.
