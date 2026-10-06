#!/usr/bin/env bash
# EMBR3-WQMS — server-side deploy step, run by the CI/CD pipeline over SSH.
#
#   remote-deploy.sh <release-tarball>
#
# The tarball (built in CI) contains:
#   web/          built front-end (dist)
#   server/       API source, without node_modules / .env
#   docs/         WQM source workbooks (front-end/docs) used by the year import
#   REVISION      git commit being deployed
#
# Safety:
#   * Pre-flight checks abort BEFORE anything changes if the target layout,
#     server/.env, Node version or PM2 process are not what this script expects.
#   * The current server code and web root are backed up first (last 5 kept).
#   * The new API must pass a health check before the new front-end goes live;
#     if it fails, the previous server code is restored and restarted.
#   * server/.env, node_modules handling and the MongoDB data are never touched.
set -Eeuo pipefail

TARBALL="${1:?usage: remote-deploy.sh <release-tarball>}"
APP_DIR="${APP_DIR:-/opt/embr3/water-quality-monitoring/app}"
WEB_ROOT="${WEB_ROOT:-/var/www/embr3/water-quality-monitoring}"
PM2_NAME="${PM2_NAME:-embr3-wqms-api}"
BACKUP_DIR="${BACKUP_DIR:-/opt/embr3/water-quality-monitoring/deploy-backups}"
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"
MIN_NODE_MAJOR=20

log() { printf '\n\033[1;36m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[deploy] ABORT:\033[0m %s\n' "$*" >&2; exit 1; }

# ── Pre-flight (no changes yet) ──────────────────────────────────────────────
log "Pre-flight checks"
[[ -f "$TARBALL" ]] || fail "release tarball not found: $TARBALL"
[[ -d "$APP_DIR/server" ]] || fail "APP_DIR/server not found ($APP_DIR/server). Set the APP_DIR variable."
[[ -f "$APP_DIR/server/.env" ]] || fail "$APP_DIR/server/.env is missing — refusing to deploy without the production environment."
[[ -d "$WEB_ROOT" ]] || fail "WEB_ROOT not found ($WEB_ROOT). Set the WEB_ROOT variable."
command -v node >/dev/null || fail "node is not installed"
command -v npm >/dev/null || fail "npm is not installed"
command -v pm2 >/dev/null || fail "pm2 is not installed"
command -v rsync >/dev/null || fail "rsync is not installed (apt install rsync)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= MIN_NODE_MAJOR )) || fail "Node $(node -v) is too old; the API needs Node >= ${MIN_NODE_MAJOR}"
pm2 describe "$PM2_NAME" >/dev/null 2>&1 || fail "PM2 process '$PM2_NAME' not found. Set the PM2_NAME variable."

PORT="$(grep -E '^PORT=' "$APP_DIR/server/.env" | tail -1 | cut -d= -f2 | tr -d '"'"'"' \r')"
PORT="${PORT:-5000}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

STAGE="$(mktemp -d /tmp/wqms-release.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT
tar -xzf "$TARBALL" -C "$STAGE"
[[ -f "$STAGE/web/index.html" && -f "$STAGE/server/server.js" && -f "$STAGE/server/package-lock.json" ]] \
  || fail "release tarball is incomplete"
REVISION="$(cat "$STAGE/REVISION" 2>/dev/null || echo unknown)"
log "Deploying revision $REVISION (API port $PORT, PM2 '$PM2_NAME')"

# ── Backup current release ──────────────────────────────────────────────────
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$BACKUP_DIR/$STAMP"
log "Backing up current release to $BACKUP"
mkdir -p "$BACKUP"
tar --exclude='./node_modules' --exclude='./backups' -czf "$BACKUP/server.tgz" -C "$APP_DIR/server" .
tar -czf "$BACKUP/web.tgz" -C "$WEB_ROOT" .
[[ -d "$APP_DIR/front-end/docs" ]] && tar -czf "$BACKUP/docs.tgz" -C "$APP_DIR/front-end/docs" .
ls -1dt "$BACKUP_DIR"/*/ 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -rf

wait_healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS -m 3 "$HEALTH_URL" | grep -q '"db":"connected"'; then return 0; fi
    sleep 2
  done
  return 1
}

rollback() {
  log "Rolling back server code to $BACKUP"
  rsync -a --delete --exclude='.env' --exclude='node_modules' --exclude='backups' \
    "$BACKUP/server-restore/" "$APP_DIR/server/" 2>/dev/null || true
  (cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund) || true
  pm2 reload "$PM2_NAME" --update-env || pm2 restart "$PM2_NAME" || true
  if wait_healthy; then log "Rollback healthy — previous version is serving."; else log "Rollback did not pass the health check — check: pm2 logs $PM2_NAME"; fi
}

mkdir -p "$BACKUP/server-restore"
tar -xzf "$BACKUP/server.tgz" -C "$BACKUP/server-restore"

# ── Server ───────────────────────────────────────────────────────────────────
log "Updating API code"
rsync -a --delete --exclude='.env' --exclude='node_modules' --exclude='backups' \
  "$STAGE/server/" "$APP_DIR/server/"
mkdir -p "$APP_DIR/front-end/docs"
rsync -a "$STAGE/docs/" "$APP_DIR/front-end/docs/"

log "Installing production dependencies"
# One retry: a cold npm cache / registry blip failed the first install in the
# deploy rehearsal, and that alone should not abort a release.
install_deps() { (cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund); }
if ! install_deps && ! { log "npm ci failed — retrying once"; sleep 5; install_deps; }; then
  rollback; fail "npm ci failed — rolled back"
fi

log "Reloading PM2 process $PM2_NAME"
pm2 reload "$PM2_NAME" --update-env || pm2 restart "$PM2_NAME" --update-env

log "Health check $HEALTH_URL"
if ! wait_healthy; then
  pm2 logs "$PM2_NAME" --lines 40 --nostream || true
  rollback
  fail "new API failed its health check — rolled back to the previous version"
fi

# ── Front-end (only after the API is healthy) ───────────────────────────────
log "Publishing front-end to $WEB_ROOT"
rsync -a --delete "$STAGE/web/" "$WEB_ROOT/"
echo "$REVISION" > "$APP_DIR/DEPLOYED_REVISION"
pm2 save >/dev/null 2>&1 || true

rm -rf "$BACKUP/server-restore"
log "Deployed $REVISION successfully. Backup kept at $BACKUP"
