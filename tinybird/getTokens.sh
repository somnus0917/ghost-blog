#!/usr/bin/env bash
set -euo pipefail

USER_TOKEN=$(jq -r '.token' .tinyb)
HOST=$(jq -r '.host' .tinyb)
WORKSPACE_ID=$(jq -r '.id' .tinyb)

if [[
    -z "$USER_TOKEN" || "$USER_TOKEN" == "null"
    || -z "$HOST" || "$HOST" == "null"
    || -z "$WORKSPACE_ID" || "$WORKSPACE_ID" == "null"
]]; then
    echo "Tinybird login data is incomplete" >&2
    exit 1
fi

RESPONSE=$(curl -fsS "$HOST/v0/tokens" -H "Authorization: Bearer $USER_TOKEN")
token_by_name() {
    local name="$1"
    printf '%s' "$RESPONSE" \
        | jq -r --arg name "$name" \
            '[.tokens[]? | select(.name == $name) | .token][0] // empty'
}

ADMIN_TOKEN=$(token_by_name "workspace admin token")
TRACKER_TOKEN=$(token_by_name "tracker")
STATS_TOKEN=$(token_by_name "stats_page")

for required_token in ADMIN_TOKEN TRACKER_TOKEN STATS_TOKEN; do
    value="${!required_token}"
    if [[ -z "$value" || "$value" == "null" ]]; then
        echo "Tinybird token is missing: $required_token" >&2
        exit 1
    fi
done

echo "TINYBIRD_API_URL=$HOST"
echo "TINYBIRD_WORKSPACE_ID=$WORKSPACE_ID"
echo "TINYBIRD_ADMIN_TOKEN=$ADMIN_TOKEN"
echo "TINYBIRD_TRACKER_TOKEN=$TRACKER_TOKEN"
echo "TINYBIRD_STATS_TOKEN=$STATS_TOKEN"
