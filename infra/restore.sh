#!/usr/bin/env bash
# Restore or verify a backup made by backup.sh.
#   ./restore.sh backups/n8n-2026-10-12_0300.tar.gz           verify only (default)
#   ./restore.sh backups/n8n-2026-10-12_0300.tar.gz --apply   replace live data
# --apply stops n8n, replaces the volume contents and starts n8n again. The
# .env from the archive is written next to the live one as .env.restored for
# manual comparison; the encryption key must match the restored database.
set -euo pipefail

ARCHIVE=${1:?usage: restore.sh <archive> [--apply]}
APPLY=${2:-}
APP_DIR=${APP_DIR:-/opt/n8n-assistant}
VOLUME="n8n-assistant_n8n_data"

SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
tar xzf "$ARCHIVE" -C "$SCRATCH"
test -s "$SCRATCH/data/database.sqlite" || { echo "restore: no database in archive" >&2; exit 1; }
test -s "$SCRATCH/.env" || { echo "restore: no .env in archive" >&2; exit 1; }
sqlite3 "$SCRATCH/data/database.sqlite" 'PRAGMA integrity_check;' | grep -qx ok || { echo "restore: database integrity check failed" >&2; exit 1; }
echo "restore: archive OK ($(sqlite3 "$SCRATCH/data/database.sqlite" 'SELECT count(*) FROM workflow_entity;') workflows)"

if [[ "$APPLY" != "--apply" ]]; then
  echo "restore: verify only; pass --apply to replace live data"
  exit 0
fi

cd "$APP_DIR"
cp "$SCRATCH/.env" .env.restored
docker compose stop n8n
docker run --rm -v "${VOLUME}:/data" -v "$SCRATCH/data:/restore:ro" alpine:3 \
  sh -c 'find /data -mindepth 1 -delete && cp -a /restore/. /data/ && chown -R 1000:1000 /data'
docker compose start n8n
echo "restore: applied. Compare .env with .env.restored (N8N_ENCRYPTION_KEY must match)."
