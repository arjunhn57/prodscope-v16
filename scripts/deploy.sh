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
log "ERROR: Health check failed after $MAX_HEALTH_RETRIES attempts!"
log "Rolling back to $BACKUP_NAME..."
cd "$HOME"
tar -xzf "$BACKUP_DIR/$BACKUP_NAME"
cd "$APP_DIR"
npm ci --omit=dev --ignore-scripts 2>&1 | tail -1
npx pm2 reload ecosystem.config.js || npx pm2 start ecosystem.config.js
log "Rolled back. Investigate logs: npx pm2 logs backend"
exit 1
