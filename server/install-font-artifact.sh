#!/usr/bin/env bash
set -euo pipefail

install_dir="${1:-/home/ubuntu/ghost-blog}"
fonts_bundle="${2:-/tmp/ghost-blog-fonts.tar.gz}"
target="$install_dir/shared/fonts/lxgw-wenkai-v2"

test -r "$fonts_bundle"
fonts_staging="$(mktemp -d /tmp/ghost-blog-fonts.XXXXXX)"
cleanup() {
  rm -rf "$fonts_staging"
}
trap cleanup EXIT

while IFS= read -r member; do
  case "$member" in
    /*|../*|*/../*)
      echo "font artifact contains an unsafe path: $member" >&2
      exit 1
      ;;
  esac
done < <(tar -tzf "$fonts_bundle")

tar -xzf "$fonts_bundle" -C "$fonts_staging"
test -f "$fonts_staging/manifest.json"
shopt -s nullglob
font_shards=("$fonts_staging"/LXGWWenKai-Fallback-v2-*.woff2)
if (( ${#font_shards[@]} < 100 )); then
  echo "font artifact contains an incomplete fallback shard set" >&2
  exit 1
fi

rm -rf "$target"
mkdir -p "$(dirname "$target")"
mv "$fonts_staging" "$target"
fonts_staging=""
trap - EXIT
echo "installed ${#font_shards[@]} generated font shards"
