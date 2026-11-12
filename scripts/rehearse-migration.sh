#!/usr/bin/env bash
# Rehearses the pending database migrations on a COPY of a backup.
#
#   scripts/rehearse-migration.sh <backup directory> [--keep | --rollback-image <image>]
#
# It restores the backup's database.dump into a throw-away PostgreSQL
# container (rd-rehearse-pg, 127.0.0.1:15460), applies the migrations of this
# checkout with the server's own migration runner, and compares a fingerprint
# of the existing data before and after: every document, state, update,
# snapshot, asset record, account, share link and audit event must be
# unchanged. Nothing outside that container is read or written; the live
# deployment is not contacted. `--keep` leaves the container for inspection.
#
# `--rollback-image <image>` also rehearses going back: it parks the new
# migration records (deploy/rollback/park-schema.sql), starts the given OLDER
# server image against the migrated copy (container rd-rehearse-old,
# 127.0.0.1:4462), checks that it becomes ready, stops it, unparks, and checks
# that the current version accepts the database again.
#
# Run `pnpm --filter @realtimedocs/server run build` first.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup="${1:-}"
keep="${2:-}"
old_image=""
if [ "$keep" = "--rollback-image" ]; then
  old_image="${3:-}"
  [ -n "$old_image" ] || { echo "--rollback-image needs an image name" >&2; exit 64; }
fi
[ -n "$backup" ] && [ -f "$backup/database.dump" ] || {
  echo "Usage: scripts/rehearse-migration.sh <backup directory> [--keep]" >&2
  exit 64
}
[ -f "$root/apps/server/dist/cli.js" ] || {
  echo "Build the server first: pnpm --filter @realtimedocs/server run build" >&2
  exit 1
}

name="rd-rehearse-pg"
port=15460
image="postgres:17.11-alpine"
password="rehearsal-only-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"

cleanup() {
  docker rm -f -v rd-rehearse-old >/dev/null 2>&1 || true
  if [ "$keep" != "--keep" ]; then docker rm -f -v "$name" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

(cd "$backup" && sha256sum -c SHA256SUMS >/dev/null) || {
  echo "The backup's checksums do not match; refusing to use it." >&2
  exit 1
}

docker rm -f -v "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" -p "127.0.0.1:$port:5432" \
  -e POSTGRES_USER=realtimedocs -e POSTGRES_DB=realtimedocs -e POSTGRES_PASSWORD="$password" \
  "$image" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$name" pg_isready -U realtimedocs -d realtimedocs >/dev/null 2>&1; then break; fi
  sleep 0.5
done
# The server image's init runs twice on first start; wait for the final one.
sleep 2
docker exec "$name" pg_isready -U realtimedocs -d realtimedocs >/dev/null

docker exec -i "$name" pg_restore -U realtimedocs -d realtimedocs --no-owner --no-privileges \
  --exit-on-error <"$backup/database.dump"

sql() { docker exec -i "$name" psql -U realtimedocs -d realtimedocs -At -v ON_ERROR_STOP=1 -c "$1"; }

# Row count and a hash over every row of each pre-existing table. Columns added
# by the migrations are left out by naming the original columns.
fingerprint() {
  sql "
    SELECT 'documents', count(*), md5(coalesce(string_agg(md5(row(id, workspace_id, title, status, generation, schema_version, head_seq, created_by, created_at, updated_at, content_updated_at, archived_at, trashed_at)::text), '' ORDER BY id), '')) FROM documents
    UNION ALL SELECT 'doc_states', count(*), md5(coalesce(string_agg(md5(row(document_id, generation, upto_seq, md5(state))::text), '' ORDER BY document_id, generation), '')) FROM doc_states
    UNION ALL SELECT 'doc_updates', count(*), md5(coalesce(string_agg(md5(row(document_id, generation, seq, md5(\"update\"))::text), '' ORDER BY document_id, generation, seq), '')) FROM doc_updates
    UNION ALL SELECT 'snapshots', count(*), md5(coalesce(string_agg(md5(row(id, document_id, name, kind, generation, md5(state), size_bytes, asset_ids, created_by, created_at)::text), '' ORDER BY id), '')) FROM snapshots
    UNION ALL SELECT 'assets', count(*), md5(coalesce(string_agg(md5(row(id, document_id, kind, storage_key, name, mime, size_bytes, sha256, status, created_at)::text), '' ORDER BY id), '')) FROM assets
    UNION ALL SELECT 'users', count(*), md5(coalesce(string_agg(md5(row(id, email, display_name, password_hash, role, status)::text), '' ORDER BY id), '')) FROM users
    UNION ALL SELECT 'document_members', count(*), md5(coalesce(string_agg(md5(row(document_id, user_id, role)::text), '' ORDER BY document_id, user_id), '')) FROM document_members
    UNION ALL SELECT 'share_grants', count(*), md5(coalesce(string_agg(md5(row(id, document_id, role, secret_hash, label, expires_at, revoked_at, rotated_from)::text), '' ORDER BY id), '')) FROM share_grants
    UNION ALL SELECT 'sessions', count(*), md5(coalesce(string_agg(md5(row(id, kind, token_hash, user_id, share_grant_id, document_id, expires_at, revoked_at)::text), '' ORDER BY id), '')) FROM sessions
    UNION ALL SELECT 'invitations', count(*), md5(coalesce(string_agg(md5(row(id, secret_hash, email, role, expires_at, accepted_at, revoked_at)::text), '' ORDER BY id), '')) FROM invitations
    UNION ALL SELECT 'audit_events', count(*), md5(coalesce(string_agg(md5(row(id, at, actor_kind, action, target_type, target_id)::text), '' ORDER BY id), '')) FROM audit_events
    ORDER BY 1"
}

echo "Schema version in the backup: $(sql 'SELECT max(version) FROM schema_migrations')"
before="$(fingerprint)"

started=$(date +%s.%N)
(
  cd "$root/apps/server"
  env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production RD_ENV_FILE= \
    DATABASE_URL="postgres://realtimedocs:$password@127.0.0.1:$port/realtimedocs" \
    SESSION_SECRET="rehearsal-only-secret-rehearsal-only-secret-0000" \
    PUBLIC_ORIGIN="http://127.0.0.1:4310" ASSET_DIR="$(mktemp -d)" LOG_LEVEL=warn \
    node dist/cli.js migrate
)
finished=$(date +%s.%N)

after="$(fingerprint)"
echo "Schema version after migrating: $(sql 'SELECT max(version) FROM schema_migrations')"
echo "Migrations applied in $(echo "$finished - $started" | bc) s"
echo
echo "table|rows|hash (before = after?)"
status=0
while IFS='|' read -r table rows hash; do
  match="$(echo "$after" | grep "^$table|" || true)"
  if [ "$match" = "$table|$rows|$hash" ]; then
    echo "$table|$rows|unchanged"
  else
    echo "$table|$rows|CHANGED"
    status=1
  fi
done <<<"$before"
echo
echo "New tables: $(sql "SELECT string_agg(tablename, ', ' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('doc_history','api_keys','interview_sessions','interview_participants','idempotency_keys','webhook_endpoints','webhook_deliveries','release_download_counts')")"
echo "Invalid constraints: $(sql "SELECT count(*) FROM pg_constraint WHERE NOT convalidated")"
[ $status -eq 0 ] && echo "RESULT: existing data unchanged by the migrations." || echo "RESULT: DIFFERENCES FOUND."

if [ -n "$old_image" ] && [ $status -eq 0 ]; then
  echo
  echo "Rollback rehearsal with image $old_image"
  keep_version="$(docker run --rm --entrypoint sh "$old_image" -c 'ls /app/server/migrations | wc -l' | tr -d ' \r')"
  echo "The older server knows $keep_version migration(s)."
  docker exec -i "$name" psql -U realtimedocs -d realtimedocs -q -v keep="$keep_version" \
    <"$root/deploy/rollback/park-schema.sql" >/dev/null
  docker run -d --name rd-rehearse-old --network host \
    -e NODE_ENV=production -e RD_HOST=127.0.0.1 -e RD_PORT=4462 \
    -e DATABASE_URL="postgres://realtimedocs:$password@127.0.0.1:$port/realtimedocs" \
    -e SESSION_SECRET="rehearsal-only-secret-rehearsal-only-secret-0000" \
    -e PUBLIC_ORIGIN="http://127.0.0.1:4462" -e ASSET_DIR=/tmp/assets -e LOG_LEVEL=warn \
    "$old_image" >/dev/null
  ready=""
  for _ in $(seq 1 60); do
    ready="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4462/api/ready || true)"
    [ "$ready" = "200" ] && break
    sleep 0.5
  done
  echo "Older server /api/ready: $ready"
  if [ "$ready" != "200" ]; then
    docker logs --tail 20 rd-rehearse-old 2>&1 | sed 's/^/  /'
    status=1
  fi
  docker rm -f -v rd-rehearse-old >/dev/null 2>&1 || true
  [ "$(fingerprint)" = "$after" ] && echo "Existing data after the older server ran: unchanged" || { echo "Existing data after the older server ran: CHANGED"; status=1; }
  docker exec -i "$name" psql -U realtimedocs -d realtimedocs -q <"$root/deploy/rollback/unpark-schema.sql" >/dev/null
  (
    cd "$root/apps/server"
    env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production RD_ENV_FILE= \
      DATABASE_URL="postgres://realtimedocs:$password@127.0.0.1:$port/realtimedocs" \
      SESSION_SECRET="rehearsal-only-secret-rehearsal-only-secret-0000" \
      PUBLIC_ORIGIN="http://127.0.0.1:4310" ASSET_DIR="$(mktemp -d)" LOG_LEVEL=warn \
      node dist/cli.js migrate
  ) && echo "Current version accepts the database again after unparking." || status=1
  [ $status -eq 0 ] && echo "RESULT: rollback and roll-forward rehearsed." || echo "RESULT: ROLLBACK REHEARSAL FAILED."
fi
exit $status
