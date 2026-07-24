#!/usr/bin/env bash
set -euo pipefail

config_file="${1:-/home/ubuntu/caddy/Caddyfile}"
snippet_file="${2:-/home/ubuntu/ghost-blog/Caddyfile.snippet}"
container="${3:-edge-caddy}"

test -f "$config_file"
test -f "$snippet_file"
docker inspect "$container" >/dev/null

container_environment="$(
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container"
)"
read_container_secret() {
  local name="$1"
  printf '%s\n' "$container_environment" \
    | awk -v prefix="$name=" '
        index($0, prefix) == 1 {
          print substr($0, length(prefix) + 1)
          exit
        }
      '
}

worker_proxy_secret="$(read_container_secret WORKER_PROXY_SECRET)"
members_proxy_secret="$(read_container_secret MEMBERS_PROXY_SECRET)"
if (( ${#worker_proxy_secret} < 32 )); then
  echo "refusing to install the blog proxy without WORKER_PROXY_SECRET in $container" >&2
  exit 1
fi
if (( ${#members_proxy_secret} < 32 )); then
  echo "refusing to install the blog proxy without MEMBERS_PROXY_SECRET in $container" >&2
  exit 1
fi
if [[ "$worker_proxy_secret" == "$members_proxy_secret" ]]; then
  echo "WORKER_PROXY_SECRET and MEMBERS_PROXY_SECRET must use different values" >&2
  exit 1
fi
unset container_environment worker_proxy_secret members_proxy_secret

candidate="$(mktemp "${config_file}.candidate.XXXXXX")"
backup="${config_file}.backup-$(date -u +%Y%m%dT%H%M%SZ)"
container_candidate="/tmp/somnus-blog-Caddyfile"

cleanup() {
  rm -f "$candidate"
  docker exec "$container" rm -f "$container_candidate" >/dev/null 2>&1 || true
}
trap cleanup EXIT

awk '
  function brace_delta(line, opened, closed) {
    opened = gsub(/\{/, "{", line)
    closed = gsub(/\}/, "}", line)
    return opened - closed
  }
  NR == FNR {
    snippet[++snippet_lines] = $0
    next
  }
  !replacing && $0 ~ /^[[:space:]]*blog\.somnus\.wiki[[:space:]]*\{/ {
    for (line = 1; line <= snippet_lines; line += 1) print snippet[line]
    replacing = 1
    found = 1
    depth = brace_delta($0)
    next
  }
  replacing {
    depth += brace_delta($0)
    if (depth <= 0) replacing = 0
    next
  }
  { print }
  END {
    if (!found || replacing) exit 42
  }
' "$snippet_file" "$config_file" > "$candidate"

chmod --reference="$config_file" "$candidate"
docker cp "$candidate" "$container:$container_candidate"
docker exec "$container" caddy validate --adapter caddyfile --config "$container_candidate"

cp -p "$config_file" "$backup"
# Preserve the bind-mounted file inode so the running container sees the update.
cp -p "$candidate" "$config_file"

if ! docker exec "$container" caddy reload --adapter caddyfile --config /etc/caddy/Caddyfile; then
  cp -p "$backup" "$config_file"
  docker exec "$container" caddy reload --adapter caddyfile --config /etc/caddy/Caddyfile
  echo "Caddy reload failed; restored $backup" >&2
  exit 1
fi

curl --fail --silent --show-error --retry 5 --retry-all-errors \
  --head https://blog.somnus.wiki/ >/dev/null
echo "installed blog.somnus.wiki config; backup: $backup"
