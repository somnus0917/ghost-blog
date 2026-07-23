#!/usr/bin/env bash
set -euo pipefail

site_url="${1:-https://blog.somnus.wiki}"
expected_api_version="${EXPECTED_ENGAGEMENT_API_VERSION:-3}"
temporary_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup EXIT

curl_args=(
  --fail
  --silent
  --show-error
  --retry 5
  --retry-all-errors
)

homepage="$temporary_dir/homepage.html"
homepage_headers="$temporary_dir/homepage.headers"
curl "${curl_args[@]}" --dump-header "$homepage_headers" "$site_url/" --output "$homepage"

for header in strict-transport-security x-content-type-options referrer-policy permissions-policy; do
  if ! grep -Eqi "^${header}:" "$homepage_headers"; then
    echo "production smoke test failed: missing ${header}" >&2
    exit 1
  fi
done
if grep -Eqi '^x-powered-by:' "$homepage_headers"; then
  echo "production smoke test failed: X-Powered-By is still exposed" >&2
  exit 1
fi

health_headers="$temporary_dir/health.headers"
health_body="$temporary_dir/health.json"
curl "${curl_args[@]}" \
  --dump-header "$health_headers" \
  "$site_url/api/engagement/health" \
  --output "$health_body"
if ! grep -Fq "\"apiVersion\":\"${expected_api_version}\"" "$health_body"; then
  echo "production smoke test failed: unexpected engagement API version" >&2
  cat "$health_body" >&2
  exit 1
fi
if ! grep -Eqi "^x-somnus-worker-version:[[:space:]]*${expected_api_version}" "$health_headers"; then
  echo "production smoke test failed: missing Worker version header" >&2
  exit 1
fi

post_path="$(
  sed -nE 's/.*<a href="([^"]+)" class="post-row-link".*/\1/p' "$homepage" \
    | head -n 1
)"
if [[ -z "$post_path" ]]; then
  echo "production smoke test failed: homepage contains no article link" >&2
  exit 1
fi
if [[ "$post_path" = http://* || "$post_path" = https://* ]]; then
  post_url="$post_path"
else
  post_url="${site_url%/}/${post_path#/}"
fi

article="$temporary_dir/article.html"
curl "${curl_args[@]}" "$post_url" --output "$article"
post_uuid="$(
  sed -nE 's/.*data-post-uuid="([0-9a-fA-F-]+)".*/\1/p' "$article" \
    | head -n 1
)"
if [[ ! "$post_uuid" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "production smoke test failed: article has no valid post UUID" >&2
  exit 1
fi

cookie_jar="$temporary_dir/cookies.txt"
engagement_headers="$temporary_dir/engagement.headers"
curl "${curl_args[@]}" \
  --cookie-jar "$cookie_jar" \
  --dump-header "$engagement_headers" \
  "$site_url/api/engagement/$post_uuid" \
  --output "$temporary_dir/engagement.json"
if ! grep -Eqi '^set-cookie: __Host-somnus_visitor=' "$engagement_headers"; then
  echo "production smoke test failed: engagement API did not issue its signed cookie" >&2
  exit 1
fi

curl "${curl_args[@]}" \
  --cookie "$cookie_jar" \
  --header "Origin: $site_url" \
  --header "Content-Type: application/json" \
  --request POST \
  --data '{"position":0}' \
  "$site_url/api/engagement/$post_uuid/presence" \
  --output "$temporary_dir/presence.json"
if ! grep -Eq '"online":[[:space:]]*[0-9]+' "$temporary_dir/presence.json"; then
  echo "production smoke test failed: presence response is invalid" >&2
  cat "$temporary_dir/presence.json" >&2
  exit 1
fi

echo "production smoke test passed: security headers, Worker v${expected_api_version}, cookie, and presence"
