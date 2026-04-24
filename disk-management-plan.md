# VM Disk Management Plan

**VM:** `prodscope-vm` (us-central1-a) — the crawler backend.
**Root volume:** 49 GB (`/dev/root`). Once it crosses ~85 % used, QEMU dies
mid-kernel-boot with `QEMU main loop exits abnormally with code 1` and the
golden suite reports every app as `emulator unreachable`. Keeping the disk
below 70 % is the cheapest reliability fix we have.

## What has historically filled the disk

Measured on 2026-04-23 when `/` hit 91 %:

| Offender | Size | What writes to it |
|---|---|---|
| `/tmp/uploads/` | **16 GB** | Backend Express upload-handler scratch. Largest single consumer. |
| `/tmp/screenshots-*/` (x10+) | ~680 MB | Per-run crawler screenshot dirs keyed by UUID; never garbage-collected by the runner. |
| `~/.android/avd/prodscope-test.avd/snapshots/` | 1.1 GB | Emulator snapshots. Ignored when the emulator runs with `-no-snapshot-load` (which we always pass). |
| `/tmp/v17-golden-*/` | ~140 MB | Per-run golden-suite screenshots. |
| `/tmp/v17-e2e-*/` | ~66 MB | Per-run v17 e2e scratch. |
| `/tmp/crawl_ss8/` | ~67 MB | Legacy crawler scratch. |
| `/tmp/wiki-fresh.apk`, other APKs in `/tmp/` | ~80 MB each | Installer cache. |
| `/tmp/emu*.log`, `/tmp/emulator.log` | KB range | Emulator boot logs. Trivial but clutter. |
| `/home/arjunhn/*.tgz` backup archives | ~200 KB total | Old prodscope-backend-live snapshots. Trivial. |
| `/home/arjunhn/prodscope-backups/` | ~1 MB | Old backup folder. Trivial. |

**The 16 GB `/tmp/uploads` is the single item that matters.** Everything else
combined is under 2 GB. Prune that one directory and the disk breathes.

## Safe-to-prune (can run unattended)

These are all scratch / re-creatable:

| Path pattern | Retention | Reasoning |
|---|---|---|
| `/tmp/uploads/*` | delete files older than 24 h | Upload handler uses new UUID per request; nothing persistent. |
| `/tmp/screenshots-*` | delete dirs older than 24 h | Per-run crawler screenshots; reports are written elsewhere. |
| `/tmp/v17-golden-*` | delete dirs older than 24 h | Per-run golden-suite screenshots. |
| `/tmp/v17-e2e-*` | delete dirs older than 24 h | Per-run v17 e2e scratch. |
| `/tmp/crawl_ss*` | delete dirs older than 24 h | Legacy crawler scratch. |
| `/tmp/*.apk` | delete files older than 7 days | APK installer cache; easy to re-upload. |
| `/tmp/emu*.log`, `/tmp/emulator.log` | delete older than 7 days | Only useful for immediate-after debug. |
| `~/.android/avd/*/snapshots/` | delete if emulator is stopped AND unused for 7 days | We always boot with `-no-snapshot-load`, so snapshots do nothing for us. |
| `/home/arjunhn/*.tgz`, `*.tar.gz` backups older than 30 days | delete | Small, but adds up; keep the latest 2. |

## Never-prune (preserve)

- `/home/arjunhn/prodscope-backend-live/` — the live backend repo. Contains
  crawler code, config, `.env`. Only `git` touches this.
- `/home/arjunhn/prodscope-backend-live/uploads/` — inside the repo, holds
  canonical test APKs (`wikipedia-fresh.apk`, `Biztoso0603_jetpack.apk`).
  Different from `/tmp/uploads` — do **not** confuse them.
- `/home/arjunhn/prodscope-backend-live/logs/` — run logs referenced by the
  frontend and debug tooling. If this grows, rotate with `logrotate`, don't
  rm.
- `/home/arjunhn/prodscope-backend-live/test-artifacts/` — reference data
  committed alongside tests.
- `/home/arjunhn/prodscope-backend-live/data/` — application data (job
  store, coverage graphs, fingerprint indexes).
- `/home/arjunhn/android-sdk/` — emulator binaries and AVD definition.
- `/home/arjunhn/benchmark_apks/` — curated canonical test APKs.
- `/home/arjunhn/node_modules/` — dependencies.

## Proposed nightly cron (runs as `arjunhn`, 03:00 UTC)

```
# /etc/cron.d/prodscope-disk-cleanup
0 3 * * * arjunhn /home/arjunhn/bin/prune-scratch.sh >> /home/arjunhn/prune-scratch.log 2>&1
```

`~/bin/prune-scratch.sh`:

```bash
#!/usr/bin/env bash
# Nightly disk hygiene for prodscope-vm. Safe-by-default.
set -eu
# Each rule is independent; `|| true` so one stuck path cannot block others.

# 24h scratch
find /tmp/uploads       -mindepth 1 -mtime +1 -print -delete 2>/dev/null || true
find /tmp               -maxdepth 1 -type d -mtime +1 \( \
    -name 'screenshots-*'  -o \
    -name 'v17-golden-*'   -o \
    -name 'v17-e2e-*'      -o \
    -name 'crawl_ss*' \
  \) -print -exec rm -rf {} + 2>/dev/null || true

# 7d caches
find /tmp -maxdepth 1 -type f \( -name '*.apk' -o -name 'emu*.log' -o -name 'emulator.log' \) \
  -mtime +7 -print -delete 2>/dev/null || true

# 30d backups (keep last 2)
ls -1t /home/arjunhn/*.tgz /home/arjunhn/*.tar.gz 2>/dev/null | tail -n +3 | xargs -r rm -fv

# Report
df -h / | awk 'NR==2 {print "disk after prune: "$3" used, "$4" avail ("$5")"}'
```

Apply with:

```bash
sudo install -m 755 -o arjunhn -g arjunhn prune-scratch.sh /home/arjunhn/bin/prune-scratch.sh
sudo install -m 644 prodscope-disk-cleanup /etc/cron.d/prodscope-disk-cleanup
sudo systemctl reload cron
```

## On-demand check

When a run fails with `emulator unreachable` the first diagnostic should be:

```bash
gcloud compute ssh prodscope-vm --zone=us-central1-a --command='df -h /'
```

If the root disk is above 85 %, run the pruner early:

```bash
sudo -u arjunhn /home/arjunhn/bin/prune-scratch.sh
```

## Early-warning signal (before cron runs)

Add a preflight that aborts the run if the disk is already too full. Uses
`spawnSync` with array args (no shell) so there's no injection surface.

```js
// scripts/preflight-disk.js
const { spawnSync } = require('node:child_process');
function checkRootDiskUsage() {
  const r = spawnSync('df', ['-BG', '/'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const row = r.stdout.split('\n')[1] || '';
  const m = row.match(/(\d+)%/);
  return m ? Number(m[1]) : null;
}
const used = checkRootDiskUsage();
if (used != null && used >= 80) {
  console.warn(`[preflight] disk at ${used}% — consider pruning before next run`);
}
if (used != null && used >= 90) {
  throw new Error(`[preflight] disk at ${used}% — abort to avoid emulator crash`);
}
```

Call `checkRootDiskUsage()` at the top of `scripts/golden-suite-run.js` and
the backend's `server.js`. One extra `df` invocation is far cheaper than
losing a full suite run to a half-booted emulator.

## What I'd watch next

1. Bytes written per day to `/tmp/uploads`. If the backend is persisting
   uploads somewhere else already, make `/tmp/uploads` zero-retention
   (`find ... -mtime +0 -delete`) rather than 24 h.
2. Number of `/tmp/screenshots-*` dirs. Ideally the crawler deletes them
   on run completion — if they're surviving, that's an app bug to fix in
   `agent-loop.js` + `executor.js`, not a disk problem.
3. AVD snapshots. Since we always launch with `-no-snapshot-load`, we
   could run with `-no-snapshot` (save nothing) to eliminate the
   snapshots dir entirely.
