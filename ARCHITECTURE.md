# ProdScope Architecture

One-page tour of how an APK upload turns into a report. For the
living work plan see [`ROADMAP.md`](./ROADMAP.md); for deploy /
launch specifics see [`V17_LAUNCH_CHECKLIST.md`](./V17_LAUNCH_CHECKLIST.md).

---

## Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│  Client (Vercel FE or curl)                                         │
│      POST /api/v1/start-job   (multipart: apk + email + config)     │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
   ┌────────────────────────────────────┐
   │  server.js  — Express 5            │           middleware chain:
   │  :8080                             │    rate-limit → auth → CORS
   └───────┬────────────────────────────┘       ↘ structured errors
           │  uploadApkMiddleware (multer + magic-bytes)
           │  validateStartJob (zod schemas)
           ▼
   ┌────────────────────────────────────┐
   │  jobs/queue.js  — BullMQ + Redis   │    falls back to in-memory
   │  1 job ↔ 1 emulator                │    when Redis unavailable
   └───────┬────────────────────────────┘
           │  (async — response returns jobId immediately)
           ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  jobs/runner.js  — processJob(jobId, apkPath, opts)            │
   │                                                                │
   │   1. disk-check    lib/disk.js                                 │
   │   2. parseApk      ingestion/manifest-parser.js (aapt2)        │
   │   3. compat-gate   lib/app-compatibility.js                    │
   │                    games/DRM/WebView-only rejected here        │
   │   4. install APK   emulator/manager.js (pm install -r)         │
   │   5. pm clear      fresh session per job (sprint-1 fix)        │
   │   6. runAgentLoop  crawler/{v16,v17}/agent-loop.js             │
   │                    CRAWL_ENGINE env picks engine (default v17) │
   │   7. triage        oracle/triage.js  (Stage 1 Haiku ranker)    │
   │   8. deep analyze  oracle/ai-oracle.js  (Stage 2 tool_use)     │
   │   9. buildReport   output/report-builder.js                    │
   │                    Phase 1 suppression gate → 3.2 quality gate │
   │                    → Stage 3 router → Sonnet (conditional)     │
   │  10. sendEmail     output/email-sender.js (magic-link)         │
   └────────────────────────────────────────────────────────────────┘
```

## Crawl-engine internals (V17)

```
runAgentLoop(opts)
  │
  ▼
┌────────────────────────────────────────────────────────────────┐
│  observe → dispatch → act → repeat                             │
│                                                                │
│  observation:  crawler/v16/observation.js                      │
│                  screenshot + UIAutomator XML + fingerprint    │
│                                                                │
│  dispatcher:   crawler/v17/dispatcher.js                       │
│                  tries drivers in priority order:              │
│                    1. PermissionDriver                         │
│                    2. DismissDriver                            │
│                    3. AuthDriver        (credentials-gated)    │
│                    4. OnboardingDriver                         │
│                    5. ExplorationDriver                        │
│                    6. CanvasDriver      (yields for Flutter)   │
│                    7. LLMFallback       (catch-all Haiku call) │
│                                                                │
│  executor:     crawler/v16/executor.js  (adb shell input)      │
│                                                                │
│  budget:       crawler/v16/budget.js  — caps steps / USD       │
│                                                                │
│  state graph:  crawler/v16/state.js  — unique screens + edges  │
└────────────────────────────────────────────────────────────────┘
```

## Oracle pipeline (Phase 3.1 — 3-stage Haiku)

```
triageResult           ┌──────────────────────────┐
  │                    │  Stage 1 Haiku ranker    │  ~$0.005 / 30 screens
  ├───────────────────▶│  batched tool_use        │  no image sent
  │                    │  0-10 hotspot score      │  prompt-cached
  │                    └──────────────────────────┘
  ▼
heuristic + stage1                                      top K=10
score merged                                                │
                                                            ▼
┌────────────────────────────────────────────────────────────────┐
│  Stage 2 per-screen Haiku deep-check (oracle/ai-oracle.js)     │
│  tool_use: emit_screen_analysis with confidence field          │
│  ~$0.008 / screen  (image + XML summary)                       │
└───────────────────────┬────────────────────────────────────────┘
                        │ aiAnalyses[]
                        ▼
┌────────────────────────────────────────────────────────────────┐
│  output/report-builder.js  (Stage 3 routing)                   │
│                                                                │
│   gate 1: Phase 1 suppression                                  │
│     blocked_by_auth / budget_exhausted_early / thin_ai_coverage│
│     → analysis_suppressed: true, zero calls                    │
│                                                                │
│   gate 2: Phase 3.2 quality                                    │
│     uniqueStates < 10 OR crossedFirstDecisionBoundary=false    │
│     → critical_bugs_suppressed: true, UX findings kept         │
│                                                                │
│   gate 3: Stage 3 high-signal                                  │
│     ≥ 3 critical_bugs with confidence ≥ 0.8                    │
│     → deterministic template, Sonnet skipped                   │
│                                                                │
│   default: Sonnet synthesis                                    │
│     tool_use: emit_report  (~$0.046 / call)                    │
└────────────────────────────────────────────────────────────────┘
```

---

## Persistence

- **Jobs**: SQLite via `jobs/store.js` (`data/prodscope.db`). A single
  file, bind-mounted / backed up on the VM.
- **Screenshots**: `/tmp/screenshots-<jobId>/`. Cleaned on job
  completion; `disk-management-plan.md` covers the hygiene cron.
- **Queue state**: Redis when available (Docker `redis:7` on the VM),
  in-memory fallback otherwise.

## Observability

- **Logs**: pino JSON to stdout, captured by pm2 (`npx pm2 logs backend`).
- **Metrics**: `lib/metrics.js` in-process counter; per-stage cost
  breakdown emitted on every job's final `store.updateJob` call
  (sprint-3.1 step 5).
- **Errors**: structured via `lib/api-errors.js` — upload and job
  failures carry `{error, code, message, retryable}` plus an optional
  `details` object. The frontend dispatches on `code`.

## Auth

- `X-API-Key` header (`PRODSCOPE_API_KEY`) for programmatic / CLI.
- `Authorization: Bearer <jwt>` for user sessions; JWT issued by the
  Google OAuth flow at `/api/v1/auth/google`.
- Magic-link signed tokens for public report URLs
  (`/api/v1/public-report/:jwt`).

## Deploy

- pm2 ecosystem on a single GCE VM (`arjunhn@34.10.240.173`).
- `ecosystem.config.js` declares env; `.env` layers values on top via
  dotenv. `CRAWL_ENGINE` ships pinned to `v17` (sprint-1).
- `scripts/deploy.sh` handles git pull + pm2 restart (rollback on
  health-check failure: sprint-4.7).

## Environments

| Env | NODE_ENV | Notes |
|-----|----------|-------|
| dev (local) | `development` | no auth required, SQLite at `./data/`, Redis optional |
| staging (VM feat/* branches) | `production` | full auth, daily disk cleanup |
| production (VM main) | `production` | same as staging, just the shipped branch |

CI (`.github/workflows/e2e.yml`) uses a hosted Ubuntu runner with
`reactivecircus/android-emulator-runner@v2` for the Wikipedia smoke.
