#!/usr/bin/env bash
set -euo pipefail

source_routes="${1:?usage: deploy-routes.sh ROUTES_YAML [INSTALL_DIR]}"
install_dir="${2:-/home/ubuntu/ghost-blog}"
settings_dir="$install_dir/content/settings"
active_routes="$settings_dir/routes.yaml"
previous_routes="$settings_dir/.routes.yaml.previous"

test -s "$source_routes"
for required_section in routes collections taxonomies; do
  if ! grep -Eq "^${required_section}:" "$source_routes"; then
    echo "routes file is missing the ${required_section} section" >&2
    exit 1
  fi
done

mkdir -p "$settings_dir"
if [[ -f "$active_routes" ]] && cmp --silent "$source_routes" "$active_routes"; then
  echo "Ghost routes are already current"
  exit 0
fi

candidate="$(mktemp "$settings_dir/.routes.yaml.XXXXXX")"
had_previous=false

cleanup() {
  rm -f "$candidate"
}
trap cleanup EXIT

cp -p "$source_routes" "$candidate"
chmod 644 "$candidate"
rm -f "$previous_routes"
if [[ -f "$active_routes" ]]; then
  cp -p "$active_routes" "$previous_routes"
  had_previous=true
fi
mv "$candidate" "$active_routes"
candidate=""

wait_for_ghost() {
  local status=""
  for _attempt in {1..60}; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' somnus-ghost 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    sleep 2
  done
  echo "Ghost did not become healthy after installing routes (last status: ${status:-unknown})" >&2
  return 1
}

rollback() {
  if [[ "$had_previous" == "true" ]]; then
    mv "$previous_routes" "$active_routes"
  else
    rm -f "$active_routes"
  fi
  docker restart somnus-ghost >/dev/null
  wait_for_ghost
}

if ! docker restart somnus-ghost >/dev/null || ! wait_for_ghost; then
  if rollback; then
    echo "routes deployment failed and the previous routes were restored" >&2
  else
    echo "routes deployment and rollback both failed; inspect somnus-ghost immediately" >&2
  fi
  exit 1
fi

set -a
source "$install_dir/.env"
set +a
site_url="${GHOST_URL%/}"
for route in posts notes essays diary; do
  if ! curl --fail --silent --show-error --retry 5 --retry-all-errors \
    --connect-timeout 10 --max-time 30 \
    "$site_url/$route/" >/dev/null; then
    if rollback; then
      echo "route /$route/ failed its smoke test; restored the previous routes" >&2
    fi
    exit 1
  fi
done

rm -f "$previous_routes"
echo "deployed Ghost routes; somnus-ghost is healthy"
