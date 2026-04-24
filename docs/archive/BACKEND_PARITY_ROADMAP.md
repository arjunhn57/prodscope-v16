# ProdScope — Backend Parity Roadmap

**Status:** Frontend is 100/100 and shipped. Backend needs to catch up before this stops being a demo and starts being a product.

**Audience:** Next coding session — start here, work top-down.

---

## 1. What's actually wired to real APIs today

These surfaces round-trip to `server.js` and reflect real crawler state. Do not touch without coordinating with the crawler team (me).

| Frontend surface | Hook / file | Backend endpoint | Notes |
|---|---|---|---|
| Dashboard — recent analyses list | `useRecentJobs` → `src/api/hooks.ts:91` | `GET /api/v1/jobs` | Paginated. Returns `{ jobs: RecentJob[], pagination }`. |
| Dashboard — queue widget | `useQueueStatus` → `src/api/hooks.ts:136` | `GET /api/v1/queue-status` | 5s refetch. |
| Dashboard — health ping | `useHealth` → `src/api/hooks.ts:157` | `GET /health` | Drives the "System Online" dot (should be bound, see P1.5 below). |
| Upload — start job | `useStartJob` → `src/api/hooks.ts:55` | `POST /api/v1/start-job` (multipart) | Takes APK + metadata. Returns `{ jobId }`. |
| LiveCrawl — SSE reasoning | `subscribeToJobSSE` → `src/api/sse.ts` | `GET /api/v1/job-sse/:jobId` | Exponential backoff reconnect, closes on `event: done`. |
| LiveCrawl — live phone frames | `<img src={liveStreamUrl}>` → `LiveCrawlPage.tsx` | `GET /api/v1/job-live-stream/:jobId` | Multipart MJPEG stream from emulator. |
| Report — underlying job data | `useJobStatus` → `src/api/hooks.ts:108` | `GET /api/v1/job-status/:jobId` | Polls every 3s until terminal. |
| Report — screenshots | `<img src={screenshotUrl}>` | `GET /api/v1/job-screenshot/:jobId/:filename` | Static file serve from job output dir. |
| Auth — shared-key exchange | `useLogin` → `src/api/hooks.ts:31` | `POST /api/v1/auth/login` | Swaps `PRODSCOPE_API_KEY` for JWT. Not per-user. |

---

## 2. What's explicitly frontend-faked (theatre)

These look like a product but are 100% client-side. Cannot be trusted, cannot be enforced, cannot survive a determined user with devtools open.

### 2.1 Auth & user identity — **fully faked**

- **File:** `src/stores/auth.ts` — Zustand `persist` middleware with store name `"prodscope-auth"`.
- **Reality:** Every `tier`, `usage`, `trialEndsAt` value lives in `localStorage`. The "user" is a single shared API key; there are no accounts, no passwords, no per-user JWT claims.
- **Backend gap:** No `/api/v1/me` endpoint exists in `server.js`. The login response returns only `{ token, tier, usage, trialEndsAt }` but those fields are hardcoded / derived from the `PRODSCOPE_API_KEY` env var, not a user row.
- **Bypass cost:** `localStorage.setItem("prodscope-auth", JSON.stringify({ state: { tier: "enterprise", usage: { crawlsThisMonth: 0, crawlLimit: Infinity } } }))` — one line, full enterprise access.

### 2.2 Pricing & billing — **fully faked**

- **File:** `src/features/pricing/tiers.ts` — static data. `src/features/marketing/components/Pricing.tsx` — CTA buttons call `useAuthStore.upgrade()` which just mutates localStorage.
- **Reality:** No Stripe integration. No `/billing/*` endpoints. No webhook handler. The "Go unlimited" button is pure client-side state change.
- **`ExpiryCountdown` component:** reads `trialEndsAt` from localStorage, which is set to `now + 14 days` on first login. Refreshing auth state resets it.

### 2.3 Login page — **shared-secret posing as per-user auth**

- **File:** `src/features/auth/LoginPage.tsx`
- **Reality:** The email field is decorative — the backend only checks the password against `PRODSCOPE_API_KEY`. There is no user table, no password hashing, no signup flow. "Forgot password" and "Terms" are `href="#"` stubs (deferred, documented).

### 2.4 Feature gating — **client-side only, trivially bypassable**

- **File:** `src/stores/auth.ts:127` — `canAccessFeature(tier, feature)` function.
- **Reality:** This runs entirely in the browser. A user can unlock Enterprise features by editing the Zustand store at runtime. The server does not check tier on any endpoint.

### 2.5 Report fixtures — **demo routes short-circuit real API**

- **File:** `src/features/report/useReportData.ts` — `matchFixture()` at the top.
- **Reality:** Job IDs matching `demo-complete-*`, `demo-degraded-*`, `demo-failed-*` bypass `useJobStatus` entirely and load bundled JSON fixtures. This is intentional (for the marketing demo loop and E2E tests) but means the Report page you see via the landing page → "See sample report" button is not touching the backend at all.
- **Legitimate use:** Keep these for marketing demos. Do NOT remove until real jobs can produce the same rich shape (see §3.2).

### 2.6 Quota enforcement — **client-side only**

- **File:** `src/stores/auth.ts` — `FREE_USAGE = { crawlsThisMonth: 0, crawlLimit: 3 }`.
- **Reality:** `crawlsThisMonth` increments client-side after a successful `useStartJob`. The server accepts unlimited jobs from any caller holding the shared API key.

---

## 3. Backend punchlist — what to build next

Ordered by blast radius. P0 items are required before accepting a single real paying user. P1 unblocks multi-tenant. P2 is polish.

### P0 — Crawler JSON stream parity (UI is starving) — **SSE portion shipped 2026-04-19**

The frontend's `SSEPayload.live` interface at `frontend/src/api/hooks.ts` declares five fields the UI renders but the backend never sends. They currently show as empty states in production traffic; only the fixtures look "full."

> **Status (2026-04-19):** All 5 fields now emitted by `buildSSEPayload` (`server.js:514-518`). Source of truth traced and verified — `crawler/run.js:192-196` attaches them to `job.live` via `sendLiveProgress → onProgress → store.updateJob({ live })` in `jobs/runner.js:251`. Browser verification on a real job still pending (needs pm2 restart on the VM + E2E run).
>
> **Still open in this P0 bucket:** (a) decide whether `/api/v1/job-status/:jobId` also needs these fields — it currently strips `job.live` entirely at `server.js:301-312`. Likely redundant for the Report page (which reads from the terminal `job.report` blob, not live per-step data), but confirm before closing this P0 outright. (b) add per-step `reasoning` / `expectedOutcome` to the structured report emitter when §3.2 lands so the post-crawl Decision Timeline can replay them.

**Fields missing from `buildSSEPayload` (`server.js:494-521`):**

| Field | Frontend consumer | Crawler source |
|---|---|---|
| `reasoning` | `ReasoningFeed.tsx` — the "why did it tap here" narrative | `crawler/run.js` — policy step decisions already produce reasoning strings; not threaded to job.live |
| `expectedOutcome` | `ReasoningFeed.tsx` — predicted next-screen hint | `crawler/policy-step.js` — action decisions include this, not propagated |
| `perceptionBoxes` | `LiveCrawlPage.tsx` — overlay rectangles on the phone stream | `crawler/vision-perception.js` — emits bounding boxes per frame, not forwarded |
| `tapTarget` | `LiveCrawlPage.tsx` — pulsing dot showing next tap coordinates | `crawler/policy-step.js` — resolves to {x, y}, not forwarded |
| `navTabs` | `LiveCrawlPage.tsx` — crumb trail of discovered bottom-nav tabs | `crawler/screen-classify.js` — tab detection exists, not forwarded |

**Action:**
1. In `crawler/run.js`, when each step fires, update `job.live` with all five fields from the step outcome (not just `activity` + `latestAction`).
2. Mirror the new fields in `buildSSEPayload()` at `server.js:494-521` so the SSE frame includes them.
3. Add the same fields to `GET /api/v1/job-status/:jobId` response (currently stripped).
4. **Test:** start a real job, watch `curl -N /api/v1/job-sse/:jobId` — every `data:` frame should have all five fields.

**Estimated effort:** 3–4 hours. Most of the data already exists in the crawler; this is plumbing.

### P0 — Report shape parity (Report page is running on fumes)

The frontend's `CrawlReport` interface (`frontend/src/features/report/types.ts`) expects a rich structured shape. The backend's `output/report-builder.js` emits an LLM-summarized shape. These barely overlap.

**Frontend expects:** `{ screens, actionsTaken, graph, stats, oracleFindings, oracleFindingsByStep, coverage, v2Coverage, flows, metrics, packageName, appName, completedAt, status, stopReason, crawlQuality, engineVersion, model }`

**Backend produces:** `{ overall_score, summary, critical_bugs, ux_issues, suggestions, quick_wins, recommended_next_steps, coverage_assessment, coverage, crawl_health, crawl_stats }`

`useReportData.ts::normalizeReport()` is defensively written with fallbacks for everything, so the page renders — but most of the rich visual surfaces (ScreenAtlas, JourneyMap, DecisionTimeline, V2Coverage tiles) are showing empty states or fixture-shape guesses on real jobs.

**Action:**
1. Create `crawler/output/crawl-artifacts.js` that emits a **structured** report alongside the existing LLM summary:
   - `screens[]` — from the dedup graph (each unique screen + metadata + screenshot path).
   - `actionsTaken[]` — flat timeline of every policy step.
   - `graph` — nodes/edges from `crawler/graph.js`.
   - `oracleFindings[]` — from `crawler/oracle/*` modules (currently logged, not persisted).
   - `v2Coverage` — `{ stepsUsed, uniqueScreens, costUSD, cacheHitRate, tokenUsage }` — all tracked in `crawler/crawl-context.js`, never written to the report.
   - `flows[]` — from `crawler/policy.js` target-flow tracking.
   - `metrics` — aggregate counters already in `crawler/outcome-tracker.js`.
2. Wire this into the job output JSON alongside `report.json`. Keep the LLM summary — it's still useful for the critical-findings section.
3. Update `buildJobStatusResponse()` to merge both shapes.
4. Populate `engineVersion` (git SHA of crawler) and `model` (vision model tag) fields.

**Estimated effort:** 1–2 days. Biggest item on this list. The data all exists in memory during a crawl; it's never persisted in the shape the UI wants.

### P1 — Per-user identity

Every multi-tenant feature (real pricing, real quota, job privacy) depends on this. Cannot skip.

**Action:**
1. Pick: Supabase (fastest, hosted) or add a `users` table to existing `jobs.db` SQLite + `bcrypt` password hashing.
2. Add `POST /api/v1/auth/signup` + refactor `POST /api/v1/auth/login` to verify per-user credentials.
3. JWT payload includes `user_id`; middleware injects `req.user` on every protected endpoint.
4. Add `GET /api/v1/me` — returns authoritative `{ id, email, tier, usage, trialEndsAt }`. Frontend's auth store must round-trip to this on mount instead of trusting localStorage.
5. Scope `GET /api/v1/jobs` by `user_id` — currently returns every job in the DB.
6. Add `user_id` foreign key to the `jobs` table (migration).

**Estimated effort:** 1 day with Supabase, 2–3 days rolling our own.

### P1 — Stripe billing

Depends on P1 user identity.

**Action:**
1. Stripe account + product catalog matching `tiers.ts` (Free / Pro / Enterprise).
2. `POST /api/v1/billing/checkout-session` — creates Stripe Checkout, returns URL.
3. `POST /api/v1/billing/webhook` — handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Updates `users.tier` + `users.trial_ends_at`.
4. `POST /api/v1/billing/portal` — Stripe Customer Portal session for self-service.
5. Frontend `upgrade()` in `auth.ts` opens the checkout URL instead of mutating localStorage.
6. `/me` returns the authoritative tier. Remove `trialEndsAt` + `tier` from the Zustand persist config — let them hydrate from `/me`.

**Estimated effort:** 1 day.

### P1 — Server-side quota enforcement

Depends on P1 user identity.

**Action:**
1. On `POST /api/v1/start-job`, look up `user.tier` + count of `jobs WHERE user_id = ? AND created_at > first_of_month`.
2. Reject with `429 { error: "quota_exceeded", limit, used }` if over.
3. Frontend `useStartJob` already has error-handling shape; just needs the 429 path.

**Estimated effort:** 2 hours (trivial once P1 identity is in).

### P1 — Autonomous batch runner — security + BullMQ integration

An experimental `scripts/batch-orchestrator.js` (untracked, ~4.5 KB) surfaced on 2026-04-19 with accompanying `crawler/adb.js` exports (`installApp`, `uninstallApp`, `clearAppData`). The adb wrappers are clean and worth keeping; the orchestrator script is **not safe to run** in its current form and is quarantined until the following are fixed:

1. **Input sanitization** — `target.packageName` is interpolated directly into `adb shell pm uninstall/clear` commands. Add a regex allowlist (`^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$`) and reject anything else. Any `outPath` derived from `packageName` needs the same gate.
2. **APK source validation** — no checksum, no signature check, no URL allowlist. Required: signed/HMAC'd queue input (reject unsigned manifest entries), SHA-256 pinning per entry, and either Play-Protect verification or at minimum `aapt dump badging` + `apksigner verify` before install.
3. **Queue source** — currently reads a local JSON from `process.argv[2]` (not the claimed "remote API"). If the goal is autonomous overnight runs, wire to a signed S3/GCS queue fetch (or equivalent) with short-lived credentials.
4. **BullMQ integration** — bypasses the existing job lifecycle entirely. Wrap each target as a BullMQ job so retries, DLQ, progress, and admin-UI visibility all work. No bespoke result-array-printed-at-exit pattern.
5. **Reliability** — add per-target `runCrawl()` timeout (suggest 10 min), SIGTERM/SIGINT graceful-shutdown with device-state cleanup, and `finally`-block guarantees that retry-with-backoff rather than swallowing via `ignoreError: true`.
6. **Persistence** — log results to the `jobs.db` SQLite (or the chosen Supabase schema from P1 identity) rather than stdout.

**Estimated effort:** 1 day for input sanitization + APK signature check + BullMQ wrapping. Add another 0.5 day for signed-queue fetching if we want real "remote" operation.

**Acceptance gate:** script must pass a red-team test where a malicious `packageName: "foo; am broadcast …"` entry is rejected pre-install, and an unsigned APK URL is rejected before the `adb install` call.

### P1.5 — Health binding (mentioned in P0 audit, deferred)

- **File:** `src/components/layout/Sidebar.tsx:84-86` — "System Online" dot is always green.
- **Fix:** Bind to `useHealth()` result. Red if `health.status !== "ok"`, yellow if `health.queue.depth > 50`.

**Estimated effort:** 15 minutes.

### P2 — Polish

1. **`engineVersion` + `model` in every job report.** Set at crawl start from `git rev-parse --short HEAD` and `process.env.VISION_MODEL`.
2. **Remove fixture short-circuit from production builds.** Gate `matchFixture()` behind `import.meta.env.DEV` — keep for local demos, strip from prod bundle.
3. **Rate limiting** (per-user, not per-IP) on `POST /api/v1/start-job` — prevents a single user from queueing 100 jobs.
4. **Email deliverability.** Current `emailStatus` field exists but the actual sender is a mock. Wire to Resend or SES.
5. **Job privacy.** `GET /api/v1/job-status/:jobId` currently returns any job to any authenticated caller. Scope by `user_id` (same migration as P1 identity).

---

## 4. Suggested sequencing

```
Week 1:
  Day 1: P0 — Crawler JSON stream parity (5 missing SSE fields)
  Day 2-3: P0 — Report shape parity (crawl-artifacts.js emitter)
  Day 4: P1 — User identity (Supabase route, likely)
  Day 5: P1 — Stripe billing + server-side quota

Week 2:
  Day 1: P1.5 + P2 polish items
  Day 2+: Real beta onboarding
```

**Minimum viable billable product:** Week 1 complete. Everything in Week 2 is gravy.

---

## 5. What NOT to do

- Don't refactor the crawler internals while threading the missing SSE fields — just add plumbing.
- Don't remove the demo fixture routes until the real report shape matches (both can coexist).
- Don't add a new framework (Prisma, tRPC, NestJS) — the current Express+SQLite+BullMQ stack works. Ship first, refactor later.
- Don't touch `crawler/run.js` orchestration logic while wiring report emitter — emit a new artifact file alongside, merge at `/job-status` read time.

---

**End of roadmap.** Open `server.js` and `crawler/run.js` side-by-side, start at P0.1, work the list.
