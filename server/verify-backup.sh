#!/usr/bin/env bash
set -euo pipefail
umask 077

install_dir="${1:-/home/ubuntu/ghost-blog}"
backup_dir="$install_dir/backups"
if [[ ! -d "$backup_dir" ]]; then
  echo "Ghost backup directory does not exist: $backup_dir" >&2
  exit 1
fi
database_backup="$(
  find "$backup_dir" -maxdepth 1 -type f -name 'ghost-db-*.sql.gz' -print \
    | sort \
    | tail -n 1
)"

if [[ -z "$database_backup" ]]; then
  echo "no Ghost database backup was found in $backup_dir" >&2
  exit 1
fi

timestamp="${database_backup##*/ghost-db-}"
timestamp="${timestamp%.sql.gz}"
content_backup="$backup_dir/ghost-content-$timestamp.tar.gz"
if [[ ! -f "$content_backup" ]]; then
  echo "matching content backup is missing: $content_backup" >&2
  exit 1
fi

gzip -t "$database_backup"
tar -tzf "$content_backup" >/dev/null

temporary_dir="$(mktemp -d)"
listing="$temporary_dir/content-files.txt"
restore_dir="$temporary_dir/restore"
container_name="somnus-backup-verify-$$"
volume_name="somnus-backup-verify-$$"
mysql_image="$(
  docker inspect --format '{{.Config.Image}}' somnus-ghost-mysql 2>/dev/null || true
)"

if [[ -z "$mysql_image" ]]; then
  echo "cannot determine the production MySQL image from somnus-ghost-mysql" >&2
  exit 1
fi

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  docker volume rm "$volume_name" >/dev/null 2>&1 || true
  rm -rf "$temporary_dir"
}
trap cleanup EXIT

tar -tzf "$content_backup" > "$listing"
while IFS= read -r entry; do
  case "$entry" in
    /*|..|../*|*/../*)
      echo "content backup contains an unsafe path: $entry" >&2
      exit 1
      ;;
  esac
done < "$listing"

mkdir -p "$restore_dir"
tar -xzf "$content_backup" -C "$restore_dir"
if [[ ! -d "$restore_dir/content" ]]; then
  echo "content backup did not restore a content directory" >&2
  exit 1
fi

root_password="$(openssl rand -hex 32)"
docker volume create "$volume_name" >/dev/null
docker run --detach \
  --name "$container_name" \
  --volume "$volume_name:/var/lib/mysql" \
  --env "MYSQL_ROOT_PASSWORD=$root_password" \
  "$mysql_image" \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_0900_ai_ci \
  >/dev/null

mysql_ready=false
for _attempt in {1..60}; do
  if docker exec \
    --env "MYSQL_PWD=$root_password" \
    "$container_name" \
    mysqladmin ping -h 127.0.0.1 -uroot --silent \
    >/dev/null 2>&1; then
    mysql_ready=true
    break
  fi
  sleep 2
done
if [[ "$mysql_ready" != "true" ]]; then
  echo "temporary MySQL did not become ready" >&2
  docker logs "$container_name" >&2 || true
  exit 1
fi

docker exec \
  --env "MYSQL_PWD=$root_password" \
  "$container_name" \
  mysql -uroot -e \
  "CREATE DATABASE ghost_verify CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
gzip -dc "$database_backup" \
  | docker exec \
      --interactive \
      --env "MYSQL_PWD=$root_password" \
      "$container_name" \
      mysql -uroot ghost_verify

for table in posts settings users; do
  present="$(
    docker exec \
      --env "MYSQL_PWD=$root_password" \
      "$container_name" \
      mysql -N -B -uroot -e \
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='ghost_verify' AND table_name='$table';"
  )"
  if [[ "$present" != "1" ]]; then
    echo "restored database is missing the $table table" >&2
    exit 1
  fi
done

post_count="$(
  docker exec \
    --env "MYSQL_PWD=$root_password" \
    "$container_name" \
    mysql -N -B -uroot ghost_verify -e "SELECT COUNT(*) FROM posts;"
)"
if [[ ! "$post_count" =~ ^[0-9]+$ ]]; then
  echo "restored posts table could not be queried" >&2
  exit 1
fi

echo "backup verification passed: $timestamp restored successfully with $post_count posts"
