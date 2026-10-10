#!/usr/bin/env bash
# Nightly backup: n8n volume (SQLite database, settings) + .env (encryption key).
# n8n is stopped for a few seconds so the SQLite file is consistent; the Gmail
# trigger polls and Telegram retries webhooks, so nothing is lost.
#
# Cron (root), 03:00 Prague time:
#   0 3 * * * /opt/n8n-assistant/backup.sh >> /var/log/n8n-backup.log 2>&1
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/n8n-assistant}
cd "$APP_DIR"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

STAMP=$(date +%Y-%m-%d_%H%M)
ARCHIVE="backups/n8n-${STAMP}.tar.gz"
VOLUME="n8n-assistant_n8n_data"

restart() { docker compose start n8n >/dev/null; }
trap restart EXIT

docker compose stop n8n >/dev/null
docker run --rm \
  -v "${VOLUME}:/data:ro" \
  -v "${APP_DIR}:/app:ro" \
  -v "${APP_DIR}/backups:/backup" \
  alpine:3 sh -c "tar czf /backup/$(basename "$ARCHIVE") -C / data -C /app .env"
restart
trap - EXIT

# Integrity: the archive lists and contains the database.
tar tzf "$ARCHIVE" | grep -q 'data/database.sqlite' || { echo "backup: database missing from $ARCHIVE" >&2; exit 1; }

if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  rclone copy "$ARCHIVE" "$RCLONE_REMOTE"
  rclone delete --min-age "${BACKUP_KEEP_REMOTE_DAYS:-30}d" "$RCLONE_REMOTE"
fi
find backups -name 'n8n-*.tar.gz' -mtime +"${BACKUP_KEEP_LOCAL_DAYS:-7}" -delete

echo "backup: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1)) at $(date -Is)"
