#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh into a named Docker Compose project.
#
#   scripts/restore.sh <backup directory> [--project <target project>] [--env-file <file>] [--force]
#
# Defaults: project "realtimedocs", env file ".env".
# The target's database and asset volume are REPLACED. A target that already
# contains accounts is refused unless --force is given. Restoring into a new
# project name (with its own env file and ports) is the way to rehearse a
# restore without touching the running deployment.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="realtimedocs"
env_file="$root/.env"
force="no"
source_dir=""

while [ $# -gt 0 ]; do
  case "$1" in
    --project|-p) project="$2"; shift 2 ;;
    --env-file) env_file="$2"; shift 2 ;;
    --force) force="yes"; shift ;;
    --help|-h) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 64 ;;
    *) [ -z "$source_dir" ] || { echo "Only one backup directory can be given." >&2; exit 64; }
       source_dir="$1"; shift ;;
  esac
done

[ -n "$source_dir" ] || { echo "Usage: scripts/restore.sh <backup directory> [--project <name>] [--env-file <file>] [--force]" >&2; exit 64; }
[ -d "$source_dir" ] || { echo "Backup directory not found: $source_dir" >&2; exit 1; }
source_dir="$(cd "$source_dir" && pwd)"
for file in database.dump assets.tar.gz SHA256SUMS; do
  [ -f "$source_dir/$file" ] || { echo "Not a RealtimeDocs backup (missing $file): $source_dir" >&2; exit 1; }
done
[ -f "$env_file" ] || { echo "Env file not found: $env_file" >&2; exit 1; }
env_file="$(cd "$(dirname "$env_file")" && pwd)/$(basename "$env_file")"
export RD_COMPOSE_ENV_FILE="$env_file"
compose() { docker compose --project-name "$project" --env-file "$env_file" -f "$root/docker-compose.yml" "$@"; }
# Runs one SQL statement in the project's database and prints the bare result.
db_value() {
  compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -c "$1"' sh "$1" | tr -d '\r'
}
# sha256sum on Linux, shasum on macOS.
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

echo "Verifying checksums of $source_dir"
(cd "$source_dir" && sha256 --check --quiet SHA256SUMS)

echo "Preparing project \"$project\""
compose up -d --wait db

# Refuse before anything of the target is touched (a running server keeps running).
# (Two statements: a fresh database has no "users" table to count.)
if [ "$(db_value "SELECT to_regclass('public.users') IS NOT NULL")" = "t" ]; then
  existing="$(db_value "SELECT count(*) FROM users")"
else
  existing="0"
fi
case "$existing" in
  ''|*[!0-9]*) echo "Could not inspect the database of project \"$project\"." >&2; exit 1 ;;
esac
if [ "$existing" != "0" ] && [ "$force" != "yes" ]; then
  echo "Project \"$project\" already contains $existing account(s). Nothing was changed. Re-run with --force to replace its data." >&2
  exit 1
fi

# Creates the server container and the asset volume if they do not exist yet,
# and makes sure the server is stopped while its data is replaced.
compose up --no-start server
compose stop server

volume="$(docker volume ls -q \
  --filter "label=com.docker.compose.project=$project" \
  --filter "label=com.docker.compose.volume=rd_assets")"
[ -n "$volume" ] || { echo "Asset volume of project \"$project\" not found." >&2; exit 1; }
db_image="$(docker inspect --format '{{.Config.Image}}' "$(compose ps -q db)")"

echo "Restoring the database"
compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error' \
  < "$source_dir/database.dump"

echo "Restoring the asset volume"
# uid/gid 1000 is the unprivileged user the server container runs as.
docker run --rm -i --network none --volume "$volume:/data" --entrypoint sh "$db_image" -c '
  set -e
  find /data -mindepth 1 -delete
  tar -xzf - -C /data
  chown -R 1000:1000 /data
' < "$source_dir/assets.tar.gz"

echo "Starting the server"
compose up -d --wait server

restored_assets="$(db_value "SELECT count(*) FROM assets WHERE status = 'ready'")"
restored_documents="$(db_value "SELECT count(*) FROM documents")"
echo "Restored $restored_documents document(s) and $restored_assets asset(s) into project \"$project\"."
