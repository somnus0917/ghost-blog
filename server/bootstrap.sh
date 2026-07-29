#!/usr/bin/env bash
set -euo pipefail

install_dir="${1:-/home/ubuntu/ghost-blog}"

if [[ ! -f "$install_dir/.env" ]]; then
  mysql_password="$(openssl rand -hex 32)"
  mysql_root_password="$(openssl rand -hex 32)"
  umask 077
  printf '%s\n' \
    'GHOST_URL=http://localhost:2368' \
    'GHOST_CONTENT_DIR=/home/ubuntu/ghost-data/content' \
    'MYSQL_DATA_DIR=/home/ubuntu/ghost-data/mysql' \
    'BACKUP_DIR=/home/ubuntu/ghost-data/backups' \
    'MYSQL_DATABASE=ghost' \
    'MYSQL_USER=ghost' \
    "MYSQL_PASSWORD=$mysql_password" \
    "MYSQL_ROOT_PASSWORD=$mysql_root_password" \
    > "$install_dir/.env"
fi

chmod 600 "$install_dir/.env"
set -a
source "$install_dir/.env"
set +a

# Existing installations stored mutable data in the checkout. Move to durable,
# Git-independent paths on the first Git-based deployment. Copying is deliberate:
# the old directories remain as a rollback safety net and are no longer mounted.
data_root="/home/ubuntu/ghost-data"
content_dir="${GHOST_CONTENT_DIR:-$data_root/content}"
mysql_dir="${MYSQL_DATA_DIR:-$data_root/mysql}"
backup_dir="${BACKUP_DIR:-$data_root/backups}"

legacy_content="$install_dir/content"
legacy_mysql="$install_dir/mysql"
directory_is_empty() {
  [[ -d "$1" ]] && [[ -z "$(find "$1" -mindepth 1 -print -quit)" ]]
}

if [[ "$content_dir" != "$legacy_content" || "$mysql_dir" != "$legacy_mysql" ]]; then
  if [[ "$(docker inspect --format '{{.State.Running}}' somnus-ghost 2>/dev/null || true)" == "true" ]]; then
    "$install_dir/server/backup.sh" "$install_dir"
    docker compose --project-directory "$install_dir" down
  fi
  if [[ -d "$legacy_content" ]] && { [[ ! -e "$content_dir" ]] || directory_is_empty "$content_dir"; }; then
    mkdir -p "$content_dir"
    cp -a "$legacy_content/." "$content_dir/"
  fi
  if [[ -d "$legacy_mysql" ]] && { [[ ! -e "$mysql_dir" ]] || directory_is_empty "$mysql_dir"; }; then
    mkdir -p "$mysql_dir"
    cp -a "$legacy_mysql/." "$mysql_dir/"
  fi
fi

# Persist the new paths only after a legacy installation has been backed up.
# Otherwise backup.sh would resolve an empty destination instead of the old
# checkout-relative content directory during the migration.
for setting in GHOST_CONTENT_DIR MYSQL_DATA_DIR BACKUP_DIR; do
  if ! grep -q "^${setting}=" "$install_dir/.env"; then
    case "$setting" in
      GHOST_CONTENT_DIR) value="$content_dir" ;;
      MYSQL_DATA_DIR) value="$mysql_dir" ;;
      BACKUP_DIR) value="$backup_dir" ;;
    esac
    printf '%s=%s\n' "$setting" "$value" >> "$install_dir/.env"
  fi
done

mkdir -p "$content_dir" "$mysql_dir" "$backup_dir"
# MySQL owns its data directory after initialization; do not change that
# directory's mode as the deployment user.
chmod 750 "$install_dir" "$content_dir" "$backup_dir"

if [[ ! -f "$install_dir/shared/fonts/lxgw-wenkai-v2/manifest.json" ]]; then
  bash "$install_dir/server/install-font-artifact.sh" \
    "$install_dir" \
    /tmp/ghost-blog-fonts.tar.gz
fi
"$install_dir/server/sync-fonts.sh" "$install_dir"

if [[ "$(docker inspect --format '{{.State.Running}}' somnus-ghost 2>/dev/null || true)" == "true" ]]; then
  if [[ ! -x "$install_dir/server/backup.sh" ]]; then
    echo "refusing to upgrade a running installation without server/backup.sh" >&2
    exit 1
  fi
  "$install_dir/server/backup.sh" "$install_dir"
fi

docker compose --project-directory "$install_dir" pull
docker compose --project-directory "$install_dir" up -d mysql
# Tinybird's interactive deployment job is optional infrastructure. When the
# analytics profile is enabled it can remain running, so do not let it block
# the blog container from starting.
docker compose --project-directory "$install_dir" up -d --no-deps ghost
if [[ ",${COMPOSE_PROFILES:-}," == *,analytics,* ]]; then
  docker compose --project-directory "$install_dir" up -d traffic-analytics
fi

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
