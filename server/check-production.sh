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
  --connect-timeout 15
  --retry-delay 5
  --max-time 30
  --ipv4
)

homepage="$temporary_dir/homepage.html"
homepage_headers="$temporary_dir/homepage.headers"
curl "${curl_args[@]}" \
  --dump-header "$homepage_headers" \
  "$site_url/" \
  --output "$homepage"

for header in strict-transport-security x-content-type-options referrer-policy permissions-policy; do
  if ! grep -Eqi "^${header}:" "$homepage_headers"; then
    echo "production check failed: missing ${header}" >&2
    exit 1
  fi
done
if grep -Eqi '^x-powered-by:' "$homepage_headers"; then
  echo "production check failed: X-Powered-By is exposed" >&2
  exit 1
fi
if ! grep -Fq '<html lang="zh-CN"' "$homepage"; then
  echo "production check failed: homepage does not contain the expected theme markup" >&2
  exit 1
fi

health_headers="$temporary_dir/health.headers"
health_body="$temporary_dir/health.json"
curl "${curl_args[@]}" \
  --dump-header "$health_headers" \
  "$site_url/api/engagement/health" \
  --output "$health_body"
if ! grep -Fq "\"apiVersion\":\"${expected_api_version}\"" "$health_body"; then
  echo "production check failed: unexpected engagement API version" >&2
  exit 1
fi
if ! grep -Eqi "^x-somnus-worker-version:[[:space:]]*${expected_api_version}" "$health_headers"; then
  echo "production check failed: missing Worker version header" >&2
  exit 1
fi

post_path="$(
  sed -nE 's/.*<a href="([^"]+)" class="post-row-link".*/\1/p' "$homepage" \
    | head -n 1
)"
if [[ -z "$post_path" ]]; then
  echo "production check failed: homepage contains no article link" >&2
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
  echo "production check failed: article has no valid post UUID" >&2
  exit 1
fi

engagement="$temporary_dir/engagement.json"
curl "${curl_args[@]}" \
  "$site_url/api/engagement/$post_uuid" \
  --output "$engagement"
for field in likes online liked; do
  if ! grep -Eq "\"${field}\":" "$engagement"; then
    echo "production check failed: engagement response is missing ${field}" >&2
    exit 1
  fi
done

echo "production check passed: homepage, headers, article, Worker v${expected_api_version}, and engagement reads"
