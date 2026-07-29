#!/usr/bin/env bash
set -euo pipefail

install_dir="${1:-/home/ubuntu/ghost-blog}"
set -a
source "$install_dir/.env"
set +a
source_dir="$install_dir/shared/fonts/lxgw-wenkai-v2"
fonts_dir="${GHOST_CONTENT_DIR:-$install_dir/content}/images/fonts"
active="$fonts_dir/lxgw-wenkai-v2"
previous="$fonts_dir/.lxgw-wenkai-v2.previous"

test -f "$source_dir/manifest.json"
shopt -s nullglob
source_shards=("$source_dir"/LXGWWenKai-Fallback-v2-*.woff2)
if (( ${#source_shards[@]} < 100 )); then
  echo "persistent LXGW WenKai fallback shard set is incomplete" >&2
  exit 1
fi

mkdir -p "$fonts_dir"
staging="$(mktemp -d "$fonts_dir/.lxgw-wenkai-v2.XXXXXX")"
activated=false

cleanup() {
  if [[ -n "${staging:-}" && -d "$staging" ]]; then
    rm -rf "$staging"
  fi
  if [[ "$activated" != "true" && ! -d "$active" && -d "$previous" ]]; then
    mv "$previous" "$active"
  fi
}
trap cleanup EXIT

cp -p "$source_dir/manifest.json" "$staging/"
cp -p "${source_shards[@]}" "$staging/"
chmod 755 "$staging"
chmod 644 "$staging"/*

staged_shards=("$staging"/LXGWWenKai-Fallback-v2-*.woff2)
if (( ${#staged_shards[@]} != ${#source_shards[@]} )); then
  echo "persistent font staging copy is incomplete" >&2
  exit 1
fi

rm -rf "$previous"
if [[ -d "$active" ]]; then
  mv "$active" "$previous"
fi
mv "$staging" "$active"
staging=""
activated=true
rm -rf "$previous"

echo "synced ${#source_shards[@]} persistent LXGW WenKai fallback shards"
