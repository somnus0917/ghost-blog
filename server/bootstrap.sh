#!/usr/bin/env bash
set -euo pipefail

install_dir="${1:-/home/ubuntu/ghost-blog}"

mkdir -p "$install_dir/content" "$install_dir/mysql" "$install_dir/backups"
chmod 750 "$install_dir"

if [[ ! -f "$install_dir/.env" ]]; then
  mysql_password="$(openssl rand -hex 32)"
  mysql_root_password="$(openssl rand -hex 32)"
  umask 077
  printf '%s\n' \
    'GHOST_URL=http://localhost:2368' \
    'MYSQL_DATABASE=ghost' \
    'MYSQL_USER=ghost' \
    "MYSQL_PASSWORD=$mysql_password" \
    "MYSQL_ROOT_PASSWORD=$mysql_root_password" \
    > "$install_dir/.env"
fi

chmod 600 "$install_dir/.env"

"$install_dir/server/sync-fonts.sh" "$install_dir"

if [[ "$(docker inspect --format '{{.State.Running}}' somnus-ghost 2>/dev/null || true)" == "true" ]]; then
  if [[ ! -x "$install_dir/server/backup.sh" ]]; then
    echo "refusing to upgrade a running installation without server/backup.sh" >&2
    exit 1
  fi
  "$install_dir/server/backup.sh" "$install_dir"
fi

docker compose --project-directory "$install_dir" pull
docker compose --project-directory "$install_dir" up -d

for attempt in {1..30}; do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' somnus-ghost 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    echo "somnus-ghost is healthy"
    exit 0
  fi
  sleep 2
done

echo "somnus-ghost did not become healthy after bootstrap" >&2
docker compose --project-directory "$install_dir" logs --tail 80 ghost >&2 || true
exit 1
