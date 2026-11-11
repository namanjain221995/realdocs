#!/usr/bin/env bash
# Backup → restore rehearsal in two isolated Docker Compose projects.
#
#   apps/server/test/backup-restore/run.sh [--keep]
#
#  1. starts a fresh deployment from the real image (project rd-srv-bk-src,
#     127.0.0.1:4413, database on 127.0.0.1:54413),
#  2. creates the administrator and the sample document with the operator
#     commands and fills the deployment through the public API and the
#     collaboration endpoint,
#  3. runs scripts/backup.sh,
#  4. destroys the source deployment including its volumes,
#  5. runs scripts/restore.sh into a second project with different secrets
#     (rd-srv-bk-dst, 127.0.0.1:4414, database on 127.0.0.1:54414),
#  6. compares the restored deployment with what step 2 recorded,
#  7. checks that a second restore is refused without --force (and leaves the
#     running server alone) and replaces the data with --force, then runs the
#     retention job on the restored deployment and compares again; a backup
#     with a wrong checksum must be rejected.
#
# Everything it created is removed at the end (containers, volumes, env files,
# the backup) unless --keep is given. Needs Docker and the pinned toolchain.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
server_dir="$(cd "$here/../.." && pwd)"
root="$(cd "$server_dir/../.." && pwd)"
stage="$server_dir/.stage/bk"
keep="no"
[ "${1:-}" = "--keep" ] && keep="yes"

src_project="rd-srv-bk-src"
dst_project="rd-srv-bk-dst"
src_port=4413
src_db_port=54413
dst_port=4414
dst_db_port=54414
src_env="$stage/src.env"
dst_env="$stage/dst.env"
summary="$stage/summary.json"

# The image is built once (by the first `up --build`) and reused by restore.sh.
export RD_IMAGE="${RD_IMAGE:-rd-srv-image:full}"
export RD_BUILD_TARGET="runtime"

compose_for() {
  local project="$1" env_file="$2"
  shift 2
  RD_COMPOSE_ENV_FILE="$env_file" docker compose --project-name "$project" --env-file "$env_file" \
    -f "$root/docker-compose.yml" "$@"
}

# Removes everything that carries the Compose project label of one of the two
# rehearsal projects, and nothing else. Works without the env files.
purge_project() {
  local project="$1" kind ids
  for kind in container volume network; do
    case "$kind" in
      container) ids="$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ;;
      volume) ids="$(docker volume ls -q --filter "label=com.docker.compose.project=$project")" ;;
      network) ids="$(docker network ls -q --filter "label=com.docker.compose.project=$project")" ;;
    esac
    [ -z "$ids" ] && continue
    # shellcheck disable=SC2086 # a list of ids, split on purpose
    case "$kind" in
      container) docker rm --force --volumes $ids >/dev/null ;;
      volume) docker volume rm $ids >/dev/null ;;
      network) docker network rm $ids >/dev/null ;;
    esac
  done
}

cleanup() {
  local status=$?
  if [ "$keep" = "yes" ]; then
    echo "Keeping projects $src_project / $dst_project and $stage (--keep)."
  else
    purge_project "$src_project" || true
    purge_project "$dst_project" || true
    rm -rf "$stage"
  fi
  exit "$status"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
started=$SECONDS

step "Preparing isolated env files"
# Leftovers of an earlier run (for example one started with --keep).
purge_project "$src_project"
purge_project "$dst_project"
rm -rf "$stage"
mkdir -p "$stage"
node "$root/scripts/init-env.mjs" --file "$src_env" --port "$src_port" --db-port "$src_db_port" >/dev/null
node "$root/scripts/init-env.mjs" --file "$dst_env" --port "$dst_port" --db-port "$dst_db_port" >/dev/null
if cmp -s "$src_env" "$dst_env"; then
  echo "The two env files are identical; they must carry different secrets." >&2
  exit 1
fi
admin_password="Rehearsal-$(node -e "process.stdout.write(require('node:crypto').randomBytes(12).toString('hex'))")"
member_password="Rehearsal-$(node -e "process.stdout.write(require('node:crypto').randomBytes(12).toString('hex'))")"
(
  umask 077
  ADMIN_PASSWORD="$admin_password" MEMBER_PASSWORD="$member_password" node -e '
    process.stdout.write(JSON.stringify({
      adminEmail: "admin@example.test",
      adminPassword: process.env.ADMIN_PASSWORD,
      memberEmail: "morgan.member@example.test",
      memberPassword: process.env.MEMBER_PASSWORD,
    }));' > "$summary"
)

step "1. Fresh deployment: docker compose up -d --build --wait ($src_project)"
compose_for "$src_project" "$src_env" up -d --build --wait
curl --silent --show-error --fail "http://127.0.0.1:$src_port/api/ready"
echo
# The image serves the web app with a Content-Security-Policy and runs unprivileged.
curl --silent --show-error --fail --output "$stage/index.html" --dump-header "$stage/index.headers" \
  "http://127.0.0.1:$src_port/"
grep -i '^content-type: text/html' "$stage/index.headers"
grep -qi '^content-security-policy: ' "$stage/index.headers" || { echo "No CSP header on /." >&2; exit 1; }
grep -qi '<!doctype html>' "$stage/index.html" || { echo "/ is not the web app." >&2; exit 1; }
uid="$(compose_for "$src_project" "$src_env" exec -T server id -u | tr -d '\r')"
[ "$uid" = "1000" ] || { echo "The server runs as uid $uid, expected 1000." >&2; exit 1; }
echo "web app served, CSP present, server runs as uid $uid"

step "2. Administrator (operator command) and data (public API + collaboration)"
printf '%s' "$admin_password" | compose_for "$src_project" "$src_env" exec -T server \
  realtimedocs bootstrap-admin --email admin@example.test --name "Ada Admin" --password-stdin
# The sample document with the image that is bundled in the server image.
compose_for "$src_project" "$src_env" exec -T server realtimedocs seed-sample
(cd "$server_dir" && pnpm exec tsx test/backup-restore/verify.ts populate "http://127.0.0.1:$src_port" "$summary")

# Nothing secret may reach the server log: passwords, share secret, session secret, database password.
compose_for "$src_project" "$src_env" logs --no-color --no-log-prefix server > "$stage/server.log" 2>&1
[ -s "$stage/server.log" ] || { echo "The server wrote no log." >&2; exit 1; }
share_secret="$(node -e "process.stdout.write(JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).share.secret)" "$summary")"
session_secret="$(sed -n 's/^SESSION_SECRET=//p' "$src_env")"
postgres_password="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$src_env")"
for secret in "$admin_password" "$member_password" "$share_secret" "$session_secret" "$postgres_password"; do
  [ "${#secret}" -ge 16 ] || { echo "A secret needed for the log check is missing." >&2; exit 1; }
  if grep -qF -- "$secret" "$stage/server.log"; then
    echo "A secret appears in the server log." >&2
    exit 1
  fi
done
echo "server log ($(wc -l < "$stage/server.log") lines) contains none of the 5 secrets"

step "3. scripts/backup.sh"
"$root/scripts/backup.sh" --project "$src_project" --env-file "$src_env" --out "$stage/backups" | tee "$stage/backup.log"
backup_dir="$(tail -n 1 "$stage/backup.log")"
[ -d "$backup_dir" ] || { echo "backup.sh did not print its destination directory." >&2; exit 1; }
cat "$backup_dir/manifest.json"

step "4. Destroying the source deployment (containers and volumes)"
compose_for "$src_project" "$src_env" down --volumes --remove-orphans
if docker volume ls -q --filter "label=com.docker.compose.project=$src_project" | grep -q .; then
  echo "Source volumes still exist." >&2
  exit 1
fi

step "5. scripts/restore.sh into $dst_project (different secrets, different ports)"
"$root/scripts/restore.sh" "$backup_dir" --project "$dst_project" --env-file "$dst_env"

step "6. Comparing the restored deployment with the recorded state"
(cd "$server_dir" && pnpm exec tsx test/backup-restore/verify.ts check "http://127.0.0.1:$dst_port" "$summary")

step "7a. A second restore without --force must be refused and must not stop the server"
if "$root/scripts/restore.sh" "$backup_dir" --project "$dst_project" --env-file "$dst_env" > "$stage/refused.log" 2>&1; then
  cat "$stage/refused.log"
  echo "restore.sh replaced a non-empty deployment without --force." >&2
  exit 1
fi
grep -F "already contains" "$stage/refused.log"
curl --silent --show-error --fail "http://127.0.0.1:$dst_port/api/ready"
echo

step "7b. Restore with --force replaces the data again"
"$root/scripts/restore.sh" "$backup_dir" --project "$dst_project" --env-file "$dst_env" --force
# The retention job must leave everything the restored documents refer to in place.
compose_for "$dst_project" "$dst_env" exec -T server realtimedocs cleanup
(cd "$server_dir" && pnpm exec tsx test/backup-restore/verify.ts check "http://127.0.0.1:$dst_port" "$summary")

step "7c. A damaged backup is rejected before anything is touched, even with --force"
cp -R "$backup_dir" "$stage/damaged"
printf 'x' >> "$stage/damaged/assets.tar.gz"
if "$root/scripts/restore.sh" "$stage/damaged" --project "$dst_project" --env-file "$dst_env" --force > "$stage/damaged.log" 2>&1; then
  cat "$stage/damaged.log"
  echo "restore.sh accepted a backup whose checksum does not match." >&2
  exit 1
fi
grep -F "assets.tar.gz" "$stage/damaged.log"
if grep -qF "Restoring the database" "$stage/damaged.log"; then
  echo "restore.sh started to restore a damaged backup." >&2
  exit 1
fi
curl --silent --show-error --fail "http://127.0.0.1:$dst_port/api/ready"
echo

step "BACKUP → RESTORE ROUND TRIP PASSED in $((SECONDS - started)) s"
