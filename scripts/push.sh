#!/usr/bin/env bash
# Push code from local machine to production VM, then run VM-side deploy.
#
# Usage (from repo root):
#   bash scripts/push.sh              # Full push + deploy
#   bash scripts/push.sh --dry-run    # Show what rsync would transfer

set -euo pipefail

VM_USER="arjunhn"
VM_HOST="34.10.240.173"
VM_DIR="prodscope-backend-live"
SSH_KEY="$HOME/.ssh/google_compute_engine"
SSH="ssh -o StrictHostKeyChecking=no -i $SSH_KEY ${VM_USER}@${VM_HOST}"

RSYNC_EXCLUDES=(
  --exclude node_modules
  --exclude data
  --exclude .env
  --exclude .git
  --exclude "*.pdf"
  --exclude screenshots
  --exclude uploads
)

DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo "=== DRY RUN ==="
fi

log() { echo "[push] $(date '+%H:%M:%S') $*"; }

# 1. Run tests locally (npm test uses explicit globs — skips _v15-archive/)
log "Running tests..."
TEST_OUTPUT="$(npm test 2>&1 || true)"
if ! echo "$TEST_OUTPUT" | grep -qE "^# fail 0$"; then
  echo "ABORT: Tests are failing. Fix them before pushing."
  echo "$TEST_OUTPUT" | tail -20
  exit 1
fi
log "Tests passed."

# 2. Rsync to VM
log "Syncing to ${VM_HOST}..."
rsync -avz $DRY_RUN \
  -e "ssh -o StrictHostKeyChecking=no -i $SSH_KEY" \
  "${RSYNC_EXCLUDES[@]}" \
  ./ "${VM_USER}@${VM_HOST}:~/${VM_DIR}/"

if [[ -n "$DRY_RUN" ]]; then
  echo "=== Dry run complete ==="
  exit 0
fi

# 3. Run VM-side deploy (npm install + PM2 restart + health check)
log "Running VM-side deploy..."
$SSH "cd ~/${VM_DIR} && bash scripts/deploy.sh"

log "Push complete."
