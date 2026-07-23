#!/usr/bin/env bash
set -euo pipefail

archive="${1:?usage: deploy-theme.sh THEME_ZIP [INSTALL_DIR]}"
install_dir="${2:-/home/ubuntu/ghost-blog}"
themes_dir="$install_dir/content/themes"
active="$themes_dir/somnus-yohaku"
previous="$themes_dir/.somnus-yohaku.previous"

test -f "$archive"
mkdir -p "$themes_dir"
staging="$(mktemp -d "$themes_dir/.somnus-yohaku.XXXXXX")"

cleanup() {
  if [[ -n "${staging:-}" && -d "$staging" ]]; then
    rm -rf "$staging"
  fi
}
trap cleanup EXIT

wait_for_ghost() {
  local attempts="${1:-30}"
  local status=""
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' somnus-ghost 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if [[ "$status" == "missing" ]] && docker exec somnus-ghost node -e \
      "require('http').get('http://127.0.0.1:2368/', (response) => process.exit(response.statusCode < 500 ? 0 : 1)).on('error', () => process.exit(1))" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "somnus-ghost did not become healthy (last status: ${status:-unknown})" >&2
  docker logs --tail 80 somnus-ghost >&2 || true
  return 1
}

rollback_theme() {
  rm -rf "$active"
  if [[ ! -d "$previous" ]]; then
    echo "theme deployment failed and no previous theme is available" >&2
    return 1
  fi
  mv "$previous" "$active"
  docker restart somnus-ghost >/dev/null
  wait_for_ghost
}

unzip -q "$archive" -d "$staging"
test -f "$staging/package.json"
test -f "$staging/assets/css/screen.css"
test -f "$staging/assets/fonts/lxgw-wenkai-v2/font.css"
test -f "$staging/assets/fonts/lxgw-wenkai-v2/manifest.json"
test -f "$staging/assets/fonts/lxgw-wenkai-v2/LXGWWenKai-Core-v2.woff2"
test -f "$staging/assets/images/site-cover-v1.png"

rm -rf "$previous"
if [[ -d "$active" ]]; then
  mv "$active" "$previous"
fi
mv "$staging" "$active"
staging=""

if ! docker restart somnus-ghost >/dev/null || ! wait_for_ghost; then
  if rollback_theme; then
    echo "theme deployment failed its health check and was rolled back" >&2
  else
    echo "theme deployment and rollback both failed; inspect somnus-ghost immediately" >&2
  fi
  exit 1
fi

rm -rf "$previous"
rm -f "$archive"
echo "deployed somnus-yohaku; somnus-ghost is healthy"
