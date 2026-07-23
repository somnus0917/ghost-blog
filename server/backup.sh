#!/usr/bin/env bash
set -euo pipefail
umask 077

install_dir="${1:-/home/ubuntu/ghost-blog}"
backup_dir="$install_dir/backups"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
database_backup="$backup_dir/ghost-db-$timestamp.sql.gz"
content_backup="$backup_dir/ghost-content-$timestamp.tar.gz"
backup_complete=false

mkdir -p "$backup_dir"
cleanup() {
  if [[ "$backup_complete" != "true" ]]; then
    rm -f "$database_backup" "$content_backup"
  fi
}
trap cleanup EXIT

set -a
source "$install_dir/.env"
set +a

docker exec -e MYSQL_PWD="$MYSQL_PASSWORD" somnus-ghost-mysql mysqldump \
  -u "$MYSQL_USER" \
  --single-transaction \
  --quick \
  --no-tablespaces \
  "$MYSQL_DATABASE" \
  | gzip > "$database_backup"

tar -C "$install_dir" -czf "$content_backup" \
  --exclude="content/logs" \
  --exclude="content/images/fonts/lxgw-wenkai-v2" \
  --exclude="content/themes/.somnus-yohaku.previous" \
  content
gzip -t "$database_backup"
tar -tzf "$content_backup" >/dev/null
find "$backup_dir" -type f -mtime +14 -delete

if [[ -n "${RESTIC_REPOSITORY:-}" ]]; then
  command -v restic >/dev/null 2>&1 || {
    echo "RESTIC_REPOSITORY is configured but restic is not installed" >&2
    exit 1
  }
  if [[ -z "${RESTIC_PASSWORD_FILE:-}" ]]; then
    echo "RESTIC_PASSWORD_FILE is required for offsite backups" >&2
    exit 1
  fi
  if ! restic snapshots >/dev/null; then
    echo "restic repository is unavailable or uninitialized; run restic init once" >&2
    exit 1
  fi
  restic backup "$database_backup" "$content_backup" \
    --tag somnus-ghost \
    --host "$(hostname)"
  restic forget \
    --tag somnus-ghost \
    --keep-daily 14 \
    --keep-weekly 8 \
    --keep-monthly 12
  if [[ "$(date -u +%u)" == "${RESTIC_PRUNE_WEEKDAY:-7}" ]]; then
    restic prune
  fi
fi

backup_complete=true
