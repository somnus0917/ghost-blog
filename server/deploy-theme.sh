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

unzip -q "$archive" -d "$staging"
test -f "$staging/package.json"
test -f "$staging/assets/css/screen.css"
test -f "$install_dir/content/images/fonts/LXGWWenKai-Regular.woff2"

rm -rf "$previous"
if [[ -d "$active" ]]; then
  mv "$active" "$previous"
fi
mv "$staging" "$active"
staging=""

if ! docker restart somnus-ghost >/dev/null; then
  rm -rf "$active"
  if [[ -d "$previous" ]]; then
    mv "$previous" "$active"
    docker restart somnus-ghost >/dev/null
  fi
  echo "theme deployment failed and was rolled back" >&2
  exit 1
fi

rm -rf "$previous"
rm -f "$archive"
echo "deployed somnus-yohaku and restarted somnus-ghost"
