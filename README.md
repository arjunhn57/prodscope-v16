# prodscope-backend

Backend for ProdScope — an Android app analysis service. Upload an APK,
the system launches it in a remote emulator, autonomously crawls the UI,
and returns a report.

## What it does, in one loop

```
upload APK  →  BullMQ queue  →  runner (install + pm clear + launch)  →
  v17 agent loop  →  dispatcher selects driver  →  driver emits action  →
  adb executes  →  observation captured  →  repeat until budget /
  stopReason / max_steps_reached  →  oracle triages screens  →
  JSON report stored + emailed
```

## Repo layout

| Directory | What lives here |
|---|---|
| `server.js` | Express API + auth + rate limits + multer upload |
| `jobs/` | BullMQ queue, runner (install + launch + crawl orchestration), job store |
| `crawler/v17/` | **Current engine.** Dispatcher + drivers + agent loop |
| `crawler/v17/drivers/` | PermissionDriver, CanvasDriver, DismissDriver, AuthDriver, ExplorationDriver, LLMFallback |
| `crawler/v16/` | Legacy LLM-per-step engine, kept as `CRAWL_ENGINE=v16` fallback |
| `crawler/` | Shared primitives used by both engines (adb wrapper, readiness, observation, screenshot-fp) |
| `oracle/` | AI-based report triage — scores screens, flags critical bugs |
| `lib/` | Logger, metrics, alerts, crypto, app-compatibility gate |
| `middleware/` | Auth (JWT + API key), request validation |
| `config/defaults.js` | All environment-variable defaults |
| `ingestion/manifest-parser.js` | Extracts packageName, activities, features, permissions from APK manifest |
| `frontend/` | Vite + React SPA for the upload UI (deployed separately on Vercel) |
| `scripts/` | Golden suite runners, V16-vs-V17 regression harnesses, deploy.sh |

## Quick start — local

```bash
cp .env.example .env
# fill ANTHROPIC_API_KEY, PRODSCOPE_API_KEY or JWT_SECRET, REDIS_URL
npm install
npm run dev
```

The backend expects an adb-reachable Android device or emulator. For
full-fidelity local runs, start the `prodscope-test` AVD:

```bash
$ANDROID_HOME/emulator/emulator -avd prodscope-test -no-window -no-audio \
  -no-snapshot-load -gpu swiftshader_indirect -no-boot-anim
```

## Tests

```bash
npm test              # 600+ unit + integration tests
npm run test:coverage # same, with c8 line coverage
npm run test:ci       # same, with 60% lines / 55% functions gate
```

V17 driver tests are under `crawler/v17/**/__tests__/`; dispatcher and
classifier tests are under `crawler/v17/__tests__/`. Regression harnesses
live in `scripts/`:

```bash
node scripts/golden-suite-run.js --config=scripts/golden-suite-2app.json
node scripts/v16-vs-v17-wikipedia.js
```

## Deployment

Production runs on a single GCE VM (`prodscope-vm`, us-central1-a) behind
pm2. Deploys via GitHub Actions on merge to `main`:

```yaml
.github/workflows/deploy.yml
  → SSH to VM → git pull → scripts/deploy.sh → pm2 restart backend --update-env
```

pm2 config is `ecosystem.config.js`. Logs land under
`/home/arjunhn/.pm2/logs/backend-out.log` and are structured JSON (pino).

The frontend is a separate Vercel deployment (`prodscope-v16.vercel.app`)
whose `vercel.json` rewrites `/api/:path*` to the VM backend.

## Key docs

- `NEXT_SPRINT_PLAN.md` — current sprint phases and acceptance criteria
- `V17_LAUNCH_CHECKLIST.md` — merge / deploy / monitor / retire sequence
- `disk-management-plan.md` — VM disk hygiene runbook
- `CLAUDE.md` — context for Claude Code sessions working in this repo

## Engine selection

One env var:

```
CRAWL_ENGINE=v17   # default, validated in production
CRAWL_ENGINE=v16   # legacy fallback, planned for retirement
```

`CRAWL_ENGINE` is resolved in `jobs/runner.js` per-job, so a running
backend can be steered via `.env` + pm2 reload without a redeploy. The
selected engine is logged on every job start
(`"msg":"crawl: selected agent loop engine"`).

## App compatibility

Not every APK is crawlable. The pre-crawl gate in `lib/app-compatibility.js`
rejects:

- Games (category, package-name heuristics, game-engine features)
- Apps requiring hardware the emulator cannot simulate (AR, NFC, BLE,
  fingerprint, IR, USB-host)

Apps that use simulated-but-imperfect features (camera, GPS, sensors)
are flagged as `degraded` quality but still crawled.
