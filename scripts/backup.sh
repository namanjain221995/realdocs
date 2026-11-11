#!/usr/bin/env bash
# Backs up a RealtimeDocs Docker Compose deployment: the PostgreSQL database
# and the private asset volume, into a new timestamped directory.
#
#   scripts/backup.sh [--project <compose project>] [--env-file <file>] [--out <directory>]
#
# Defaults: project "realtimedocs", env file ".env", output "backups/".
# The services may keep running. Consistency: the database dump is one
# transaction-consistent snapshot and is taken first; asset files are immutable
# once stored, so every asset the dump refers to is in the archive taken after it.
# (Do not run the retention job, `cleanup`, during a backup.)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="realtimedocs"
env_file="$root/.env"
out="$root/backups"

while [ $# -gt 0 ]; do
  case "$1" in
    --project|-p) project="$2"; shift 2 ;;
    --env-file) env_file="$2"; shift 2 ;;
    --out|-o) out="$2"; shift 2 ;;
    --help|-h) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 64 ;;
  esac
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

db_container="$(compose ps -q db)"
[ -n "$db_container" ] || { echo "The database of project \"$project\" is not running (docker compose up -d db)." >&2; exit 1; }
volume="$(docker volume ls -q \
  --filter "label=com.docker.compose.project=$project" \
  --filter "label=com.docker.compose.volume=rd_assets")"
[ -n "$volume" ] || { echo "Asset volume of project \"$project\" not found." >&2; exit 1; }
db_image="$(docker inspect --format '{{.Config.Image}}' "$db_container")"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$out"
dest="$(cd "$out" && pwd)/$project-$stamp"
mkdir "$dest"
# Dumps contain password hashes and document content: owner-only.
chmod 700 "$dest"
umask 077

echo "Backing up project \"$project\" to $dest"

# 1. Database (custom format: compressed, restorable with pg_restore).
compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  > "$dest/database.dump"
schema_version="$(db_value "SELECT COALESCE(max(version), 0) FROM schema_migrations")"
postgres_version="$(db_value "SHOW server_version")"
asset_rows="$(db_value "SELECT count(*) FROM assets WHERE status = 'ready'")"

# 2. Assets, read-only, through a throw-away container (works whether or not the server runs).
docker run --rm --network none --volume "$volume:/data:ro" --entrypoint tar "$db_image" \
  -czf - -C /data . > "$dest/assets.tar.gz"
asset_files="$(tar -tzf "$dest/assets.tar.gz" | grep -c '^\./objects/[0-9a-f][0-9a-f]/[0-9a-f][0-9a-f]/[0-9a-f]\{40\}$' || true)"

# 3. Manifest and checksums.
(cd "$dest" && sha256 database.dump assets.tar.gz > SHA256SUMS)
cat > "$dest/manifest.json" <<EOF
{
  "product": "RealtimeDocs",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "project": "$project",
  "schemaVersion": $schema_version,
  "postgresVersion": "$postgres_version",
  "assetRows": $asset_rows,
  "assetFiles": $asset_files,
  "files": ["database.dump", "assets.tar.gz", "SHA256SUMS"]
}
EOF

if [ "$asset_files" -lt "$asset_rows" ]; then
  echo "WARNING: the archive holds $asset_files asset files but the database lists $asset_rows." >&2
fi
echo "Done: database.dump ($(du -h "$dest/database.dump" | cut -f1)), assets.tar.gz ($(du -h "$dest/assets.tar.gz" | cut -f1)), $asset_files asset file(s)."
echo "$dest"
