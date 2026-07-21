#!/usr/bin/env bash
set -euo pipefail

install_dir="${1:-/home/ubuntu/ghost-blog}"

mkdir -p "$install_dir/content" "$install_dir/mysql" "$install_dir/backups"
chmod 750 "$install_dir"

font_source="$install_dir/shared/fonts/LXGWWenKai-Regular.woff2"
font_target_dir="$install_dir/content/images/fonts"
if [[ -f "$font_source" ]]; then
  mkdir -p "$font_target_dir"
  install -m 0644 "$font_source" "$font_target_dir/LXGWWenKai-Regular.woff2"
fi

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
docker compose --project-directory "$install_dir" pull
docker compose --project-directory "$install_dir" up -d
