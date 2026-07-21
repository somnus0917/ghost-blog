#!/usr/bin/env bash
set -euo pipefail
umask 077

install_dir="${1:-/home/ubuntu/ghost-blog}"
backup_dir="$install_dir/backups"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$backup_dir"
set -a
source "$install_dir/.env"
set +a

docker exec somnus-ghost-mysql mysqldump \
  -u"$MYSQL_USER" \
  -p"$MYSQL_PASSWORD" \
  --single-transaction \
  --quick \
  --no-tablespaces \
  "$MYSQL_DATABASE" \
  | gzip > "$backup_dir/ghost-db-$timestamp.sql.gz"

tar -C "$install_dir" -czf "$backup_dir/ghost-content-$timestamp.tar.gz" content
find "$backup_dir" -type f -mtime +14 -delete
