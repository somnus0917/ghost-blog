#!/bin/sh
set -eu

PROJECT_DIR=${1:-/home/ubuntu/ghost-blog}
ENV_FILE="$PROJECT_DIR/.env"
PRIVATE_ENV="$PROJECT_DIR/.private/tinybird-production.env"
BACKUP_FILE="$PROJECT_DIR/.env.pre-tinybird-20260722"
TEMP_FILE=$(mktemp "$PROJECT_DIR/.env.tinybird.XXXXXX")

cleanup() {
    rm -f "$TEMP_FILE"
}
trap cleanup EXIT INT TERM

test -f "$ENV_FILE"
test -f "$PRIVATE_ENV"

if [ ! -f "$BACKUP_FILE" ]; then
    cp -p "$ENV_FILE" "$BACKUP_FILE"
fi

awk '!/^TINYBIRD_[A-Z0-9_]*=/ && !/^COMPOSE_PROFILES=/' "$ENV_FILE" > "$TEMP_FILE"
printf '\nCOMPOSE_PROFILES=analytics\n' >> "$TEMP_FILE"
while IFS= read -r line; do
    case "$line" in
        TINYBIRD_*=*) printf '%s\n' "$line" >> "$TEMP_FILE" ;;
    esac
done < "$PRIVATE_ENV"

chmod 600 "$TEMP_FILE"
mv "$TEMP_FILE" "$ENV_FILE"
trap - EXIT INT TERM

configured=$(awk -F= '/^TINYBIRD_[A-Z0-9_]*=/{print $1}' "$ENV_FILE" | sort | tr '\n' ' ')
printf 'Tinybird production environment configured: %s\n' "$configured"
