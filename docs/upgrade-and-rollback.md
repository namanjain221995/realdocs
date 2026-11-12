# Upgrade and rollback guide

For the deployment on this server (`deploy/`, Compose project `realtimedocs`). The same steps apply to any
Compose deployment with its own env file. What was rehearsed, and on what, is at the end.

## What the enterprise upgrade changes in the database

Migrations `0002_service_api`, `0003_history` and `0004_releases`. They only add:

- new tables: `api_keys`, `interview_sessions`, `interview_participants`, `idempotency_keys`,
  `webhook_endpoints`, `webhook_deliveries`, `doc_history`, `release_download_counts`;
- a column `documents.history_seq` (constant default: no table rewrite) and a nullable column
  `share_grants.participant_id`;
- one wider `CHECK` constraint: `audit_events.actor_kind` also accepts `service`.

No existing row is changed and nothing is dropped. On a copy of the production database of 2026-11-12
(4 documents, 76 assets) the three migrations took 0.15 s.

## Before upgrading

1. **Rehearse on a copy.** Take a backup and run the rehearsal against it. It restores the backup into a
   throw-away PostgreSQL container, applies the migrations with the server's own runner and compares a
   hash of every existing table before and after. It does not contact the live deployment.

   ```sh
   scripts/backup.sh --env-file deploy/.env.production
   . scripts/dev-env.sh && pnpm --filter @realtimedocs/server run build
   scripts/rehearse-migration.sh backups/realtimedocs-<timestamp> --rollback-image realtimedocs-server:local
   ```

   With `--rollback-image` it also starts the **currently deployed** image against the migrated copy, as
   described under "Roll back" below. Expect `RESULT: existing data unchanged by the migrations.` and
   `RESULT: rollback and roll-forward rehearsed.`

2. **Keep the current image.** `deploy/up.sh` builds a new image under the same tag. Tag the running one
   first, so there is something to go back to:

   ```sh
   docker tag realtimedocs-server:local realtimedocs-server:previous
   ```

3. **Take the backup you will rely on**, immediately before the upgrade, and check it:

   ```sh
   scripts/backup.sh --env-file deploy/.env.production
   (cd backups/realtimedocs-<timestamp> && sha256sum -c SHA256SUMS)
   ```

   Copy it off this server.

4. Run the gates of [testing.md](testing.md) on the checkout you are about to deploy.

## Upgrade

```sh
deploy/up.sh
deploy/status.sh
```

The server applies the pending migrations when it starts (advisory lock, one transaction each). The
public address answers an error for about a second while the container is replaced. Open browser tabs
reconnect by themselves; work that was not yet acknowledged is sent again.

After the upgrade:

- `deploy/logs.sh server --since 5m` shows `Applied 3 migration(s)` once and no errors.
- Sign in, open an existing document, type, wait for "Saved", reload.
- Open "Version history" of that document: it starts with "History starts here" at the first change after
  the upgrade. Changes made before the upgrade were never recorded per person and cannot be shown.
- New settings are optional and off or defaulted: `REDIS_URL` (several instances), `METRICS_TOKEN`
  (metrics), `HISTORY_RETENTION_DAYS` (0 keeps everything). See [deployment.md](deployment.md).
- The desktop download section shows "no release published" until a release is published
  ([desktop-release.md](desktop-release.md)).

## Roll back

### The application only (the usual case)

A server refuses to start on a database that records a migration it does not know. The upgrade's
migrations only add things an older server ignores, so going back does **not** need a database restore:
the records of the newer migrations are moved aside ("parked") and the older server starts on the same
data. Nothing written since the upgrade is lost.

```sh
deploy/down.sh
deploy/exec.sh db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v keep=1' < deploy/rollback/park-schema.sql
docker tag realtimedocs-server:previous realtimedocs-server:local
# Start without building: the wrapper would rebuild the image from the checkout.
RD_COMPOSE_ENV_FILE=deploy/.env.production docker compose --env-file deploy/.env.production \
  -f docker-compose.yml -f deploy/docker-compose.tunnel.yml up -d --wait
deploy/status.sh
```

`deploy/down.sh` stops the server and the database; start the database first if `deploy/exec.sh db` needs
it (`… up -d --wait db`). `keep=1` is the schema version of the image you return to (the number of files
in its `migrations` directory).

While the older version runs:

- Interview sessions, API keys, webhooks and version history do not exist for it. Their tables keep
  their rows. Links created for interview participants are ordinary share links and keep working, but
  without the candidate restrictions, which the older version does not know. **Revoke the links of
  running interview sessions before rolling back** if those restrictions matter.
- Documents edited with page settings keep them (they are stored in the document); the older editor
  ignores them.
- Edits are saved as before, but are not recorded in the version history.

### Going forward again

```sh
deploy/exec.sh db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < deploy/rollback/unpark-schema.sql
deploy/up.sh
```

Run `unpark-schema.sql` **before** the newer server starts; otherwise it tries to apply the parked
migrations again and stops with "relation already exists" (nothing is damaged; unpark and start again).
When the newer server next opens a document that was edited in between, it sees that the history does
not reach the document's current state and records a new starting point, so later revisions are exact.

### The database (last resort)

Only when data itself is wrong. A restore replaces everything written since the backup. It needs the
owner's decision. Steps: [backup-and-restore.md](backup-and-restore.md).

## Several instances

See [scaling.md](scaling.md), section "Rolling deployment". One instance applies the migrations; the
others are replaced one at a time.

## Desktop app

The desktop app checks `/api/v1/desktop/update`. A release is rolled back by pointing the channel at the
previous version (`scripts/publish-release.mjs --rollback <version>`); files of earlier releases stay on
disk. See [desktop-release.md](desktop-release.md).

## What was rehearsed

On 2026-11-12, with `scripts/rehearse-migration.sh … --rollback-image realtimedocs-server:local` against
a backup of the live database taken the same day, in throw-away containers on this server:

- migrations 0002–0004 applied; all eleven existing tables unchanged (row counts and hashes);
- the deployed image (schema 1) became ready on the migrated database after parking; data unchanged;
- after unparking, the current version accepted the database with nothing left to apply;
- recovery of the version history after edits made without it: integration test
  `apps/server/test/integration/history.test.ts`, "commits made without history".

**The live upgrade was carried out on 2026-11-12 at 10:28 UTC with `deploy/up.sh`.** Before it, a backup
was taken (`backups/realtimedocs-20261112T102818Z`, checksums verified, the env files copied into its
`config/` folder); the migration and rollback rehearsal was repeated on a backup taken the same day with
`--rollback-image realtimedocs-server:previous` (existing data unchanged, rollback and roll-forward
rehearsed); the candidate image was run against a restored copy of the database and uploads (ready,
pages, login, documents load); and the previous image was kept as `realtimedocs-server:previous`
(image `725f0e9a5199`). The new image is `realtimedocs-server:local` (`f9616366ef8b`). The server log shows
migrations service_api (2), history (3) and releases (4) applied, and health and readiness answered 200
locally and through Cloudflare. The container replacement took about nine seconds end to end. A live
smoke test then passed 26/26 checks ([deployment.md](deployment.md)).

**Not done:** the rollback through the `deploy/` wrappers against the live project was not executed. The
rollback commands above were rehearsed only with a throw-away database and container on copies.
