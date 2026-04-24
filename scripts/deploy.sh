#!/usr/bin/env bash
# ProdScope deploy script
# Backs up current, copies new code, restarts PM2, verifies health.
#
# Usage (run ON the VM):
#   bash scripts/deploy.sh
#
# Or from CI:
#   ssh user@host 'cd ~/prodscope-backend-live && bash scripts/deploy.sh'

set -euo pipefail

APP_DIR="$HOME/prodscope-backend-live"
BACKUP_DIR="$HOME/prodscope-backups"
HEALTH_URL="http://localhost:8080/health"
MAX_HEALTH_RETRIES=10
HEALTH_RETRY_DELAY=3

log() { echo "[deploy] $(date '+%H:%M:%S') $*"; }

# Log the incoming SHA so rollbacks have a paper trail.
DEPLOY_SHA="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
log "Deploying SHA=$DEPLOY_SHA"

# Capture the pre-pull SHA (ORIG_HEAD after a pull, or HEAD@{1} from reflog).
# The deploy flow is: `git pull && bash scripts/deploy.sh`, so by the time we
# run, HEAD@{1} in the reflog is the SHA we'd roll back TO. sprint-4.7.
ROLLBACK_SHA=""
if [ -d "$APP_DIR/.git" ]; then
  ROLLBACK_SHA="$(git -C "$APP_DIR" rev-parse --verify --short ORIG_HEAD 2>/dev/null || git -C "$APP_DIR" rev-parse --verify --short 'HEAD@{1}' 2>/dev/null || true)"
  if [ -n "$ROLLBACK_SHA" ] && [ "$ROLLBACK_SHA" != "$DEPLOY_SHA" ]; then
    log "Rollback target captured: SHA=$ROLLBACK_SHA"
    # Tag the rollback point so a human can find it later without walking the reflog.
    TAG_NAME="deploy-rollback-$(date '+%Y%m%d-%H%M%S')"
    git -C "$APP_DIR" tag -f "$TAG_NAME" "$ROLLBACK_SHA" >/dev/null 2>&1 || true
    log "Tagged rollback point as $TAG_NAME"
  else
    log "No distinct rollback SHA in reflog — first deploy or same-SHA re-run. Using tarball-only rollback."
    ROLLBACK_SHA=""
  fi
fi

# ── 1. Backup current ────────────────────────────────────────────────────────
log "Backing up current deployment..."
mkdir -p "$BACKUP_DIR"
BACKUP_NAME="backup-$(date '+%Y%m%d-%H%M%S').tar.gz"
tar -czf "$BACKUP_DIR/$BACKUP_NAME" \
  --exclude='node_modules' \
  --exclude='screenshots' \
  --exclude='uploads' \
  --exclude='data' \
  --exclude='.git' \
  -C "$HOME" prodscope-backend-live/
log "Backup saved: $BACKUP_DIR/$BACKUP_NAME"

# Keep only 5 most recent backups
ls -t "$BACKUP_DIR"/backup-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm --
log "Old backups cleaned."

# ── 2. Install dependencies ──────────────────────────────────────────────────
log "Installing dependencies..."
cd "$APP_DIR"
npm ci --omit=dev --ignore-scripts 2>&1 | tail -1

# ── 3. Restart PM2 ───────────────────────────────────────────────────────────
log "Restarting PM2..."
if npx pm2 describe backend > /dev/null 2>&1; then
  npx pm2 reload ecosystem.config.js
else
  npx pm2 start ecosystem.config.js
fi

# ── 4. Health check ──────────────────────────────────────────────────────────
log "Waiting for health check..."
for i in $(seq 1 $MAX_HEALTH_RETRIES); do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    log "Health check passed (attempt $i/$MAX_HEALTH_RETRIES)"
    npx pm2 save
    log "Deploy complete."
    exit 0
  fi
  log "Health check attempt $i/$MAX_HEALTH_RETRIES failed, retrying in ${HEALTH_RETRY_DELAY}s..."
  sleep "$HEALTH_RETRY_DELAY"
done

# ── 5. Rollback on failure ───────────────────────────────────────────────────
log "ERROR: Health check failed after $MAX_HEALTH_RETRIES attempts (SHA=$DEPLOY_SHA)"

if [ -n "$ROLLBACK_SHA" ]; then
  # Preferred path: git reset --hard to the pre-pull SHA. Fast, preserves the
  # .git history, and leaves no orphan files the way a tarball extract might.
  log "Rolling back via git reset --hard $ROLLBACK_SHA"
  cd "$APP_DIR"
  if ! git reset --hard "$ROLLBACK_SHA"; then
    log "git reset failed — falling back to tarball restore"
    cd "$HOME"
    tar -xzf "$BACKUP_DIR/$BACKUP_NAME"
  fi
else
  log "Rolling back via tarball $BACKUP_NAME (no git rollback SHA available)"
  cd "$HOME"
  tar -xzf "$BACKUP_DIR/$BACKUP_NAME"
fi
cd "$APP_DIR"
npm ci --omit=dev --ignore-scripts 2>&1 | tail -1
npx pm2 reload ecosystem.config.js || npx pm2 start ecosystem.config.js

# Verify the rollback itself is healthy. If THIS fails too, we're in an
# outage — log loudly and exit with a distinct code so alerting can tell
# "bad deploy, rolled back" from "total loss of service".
log "Verifying rollback health..."
for i in $(seq 1 $MAX_HEALTH_RETRIES); do
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    CURRENT_SHA="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
    log "Rollback healthy (attempt $i/$MAX_HEALTH_RETRIES). SHA=$DEPLOY_SHA was reverted to SHA=$CURRENT_SHA."
    exit 1
  fi
  log "Rollback health check $i/$MAX_HEALTH_RETRIES failed, retrying in ${HEALTH_RETRY_DELAY}s..."
  sleep "$HEALTH_RETRY_DELAY"
done

log "CRITICAL: Rollback itself is unhealthy. Production is down. Investigate immediately: npx pm2 logs backend"
exit 2
