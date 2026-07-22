#!/usr/bin/env bash
set -euo pipefail

USER_TOKEN=$(jq -r '.token' .tinyb)
HOST=$(jq -r '.host' .tinyb)
WORKSPACE_ID=$(jq -r '.id' .tinyb)

if [[ -z "$USER_TOKEN" || "$USER_TOKEN" == "null" || -z "$HOST" || "$HOST" == "null" ]]; then
    echo "Tinybird login data is incomplete" >&2
    exit 1
fi

RESPONSE=$(curl -fsS "$HOST/v0/tokens" -H "Authorization: Bearer $USER_TOKEN")
ADMIN_TOKEN=$(printf '%s' "$RESPONSE" | jq -r '.tokens[] | select(.name == "workspace admin token") | .token')
TRACKER_TOKEN=$(printf '%s' "$RESPONSE" | jq -r '.tokens[] | select(.name == "tracker") | .token')

echo "TINYBIRD_API_URL=$HOST"
echo "TINYBIRD_WORKSPACE_ID=$WORKSPACE_ID"
echo "TINYBIRD_ADMIN_TOKEN=$ADMIN_TOKEN"
echo "TINYBIRD_TRACKER_TOKEN=$TRACKER_TOKEN"
