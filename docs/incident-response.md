# Incident response

Runbooks for the deployment in `deploy/` (Compose project `realtimedocs`, Cloudflare Tunnel, public address
`https://realdocs.techsarasolutions.com`). Commands use the wrappers in `deploy/` as described in
[deploy/README.md](../deploy/README.md). Run them from the repository root on the server that hosts the
deployment.

Status of this document: written from the code and the other guides in this repository. The runbooks were not
exercised as incidents. Where a step was run in a rehearsal, the text says so; every other step is marked as
not rehearsed.

**Rules that hold in every incident**

- Never run `docker compose down -v`, `docker volume rm` or `docker volume prune` on this project. They delete
  the database and the uploaded files. A guard container (`realtimedocs-volume-guard`) makes Docker refuse most
  of them; do not remove it ([deployment.md](deployment.md#the-volume-guard)).
- Never run `docker compose ...`, `pnpm db:up` or `pnpm db:down` from the repository root of this server. Use
  `deploy/*.sh`.
- Take a backup before anything that changes data (section "Data loss suspected").
- Put no password, token, share link, API key or webhook secret in a chat, ticket, log or this repository.
  Evidence files contain document metadata and names; store them like backups.

## Roles

One person can hold several roles. Write down who holds which one at the start.

| Role           | Does                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Incident lead  | Decides severity and next step, keeps the timeline, decides on anything irreversible (restore, credential rotation, public statement) |
| Operator       | Runs the commands on the server, reports exactly what each command printed                                                            |
| Communications | Tells users and the owner what is known, using the template below; does not guess causes                                              |
| Scribe         | Records times (UTC), commands run, and observations, as they happen                                                                   |

Contacts and an on-call rota are not recorded anywhere in this repository. Add them to your private runbook.

## Severity levels

These levels are a proposal; the project has no agreed service levels.

| Level | Meaning                                                                                           | Examples                                                                          | Aim                                        |
| ----- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------ |
| SEV1  | The product is down, data may be lost or exposed, or a credential is known to be in hostile hands | Site down, saves failing, leaked session secret, leaked database password         | Act at once; update users every 30 minutes |
| SEV2  | Part of the product is unusable or a credential may have leaked                                   | Redis down in multi-instance mode, webhook deliveries dead, one leaked share link | Act within the hour                        |
| SEV3  | Degraded but usable                                                                               | One instance not ready behind a balancer, slow commits                            | Same working day                           |
| SEV4  | Cosmetic or a question                                                                            | Wrong text, a single user cannot print                                            | Normal queue                               |

## First 15 minutes

1. **Write down the time (UTC) and who reported what.** Do not restart anything yet.
2. **Look.**

   ```sh
   deploy/status.sh
   deploy/logs.sh server --since 15m
   ```

   `deploy/status.sh` shows the containers and three checks (local health, local readiness, public health).
   Exit status 0 means all answered 200.

3. **Classify** with the table in "Site down" below, and set the severity.
4. **Stop making it worse.** If data loss or a leak is suspected, go to the matching section before restarting
   or restoring anything. A restart does not lose acknowledged edits, but a restore does lose everything written
   since the backup.
5. **Tell the owner** what is known and what is not (template at the end).
6. **Start the evidence list** (section "Evidence to collect") if the incident involves access or data.

## Runbooks

### Site down

| `deploy/status.sh` shows                                                     | Likely cause                                                                        | Action                                                                                                                                                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local checks fail                                                            | Server or database container down                                                   | `deploy/logs.sh server`, `deploy/logs.sh db`; then `deploy/up.sh` (replaces only containers that are missing or changed; volumes untouched)                                                     |
| Local checks pass, public answers 502                                        | Tunnel up, cannot reach the server. Seen for about a second during a server restart | If it lasts, `deploy/up.sh`                                                                                                                                                                     |
| Local checks pass, public shows a Cloudflare error (for example 1033) or 404 | Tunnel not connected, or the route for the hostname is missing in Cloudflare        | `deploy/logs.sh tunnel` (look for "Registered tunnel connection"); check the route in the Cloudflare dashboard (values in [deploy/README.md](../deploy/README.md)); replace the token if needed |
| `/api/ready` is 503, `/api/health` is 200                                    | Database not answering (or the instance is shutting down)                           | Section "Database down or disk full"                                                                                                                                                            |

Restarting only the server container (for example after a crash loop) is `docker restart realtimedocs-server-1`.
Connected editors reconnect by themselves and send again what was not acknowledged. A restart of the server
container was observed in the deployment check of 2026-11-11: the public address answered 502 for about a
second, then 200. Do not restart the
database container while the server is writing unless you have to; if you do, the server's pool reconnects.

If the server will not start, read the last log lines. The configuration check names the variable that is
wrong. A message "database is at schema version N ... newer than this server" or "relation already exists" is
the rollback case in [troubleshooting.md](troubleshooting.md).

### Database down or disk full

1. Check the container and its disk:

   ```sh
   deploy/status.sh
   deploy/logs.sh db --since 30m
   df -h /var/lib/docker
   deploy/exec.sh db df -h /var/lib/postgresql/data
   ```

2. Effect on users: edits are queued in the server up to `COLLAB_MAX_QUEUE_BYTES` (16 MiB per document by
   default), then that document stops accepting edits. The editor shows an error instead of "Saved" and keeps
   unsent work in the browser. Nothing is acknowledged that was not committed ([security.md](security.md)).
3. **Disk full.** Free space on the host without touching the data volumes: remove unused images or build
   cache you know are not needed, move old backups off the machine, truncate nothing inside the database
   directory. Do **not** run `docker volume prune` or `docker system prune --volumes`. The retention job
   (`deploy/exec.sh server realtimedocs cleanup`) removes expired data but cannot run while the database is
   unwritable. After space is available, PostgreSQL normally recovers by itself on restart; this was not
   rehearsed here.
4. **Database container crashed or corrupt.** Do not delete the volume. Read the log first. If recovery is not
   possible, restore the latest verified backup into a new project or host (section "Disaster recovery") and
   compare before switching over.
5. Afterwards: `deploy/status.sh`, open a document, type, wait for "Saved".

### Redis down (multi-instance mode only)

The live deployment does not run Redis. For a deployment started with `deploy/scale/docker-compose.scale.yml`:

- Behaviour ([scaling.md](scaling.md)): open documents keep working and saving; new collaboration connections
  cannot get a ticket and retry; `/api/ready` answers 503 on every instance (a balancer with health checks will
  stop sending traffic to all of them); rate limits let requests through; when Redis returns, leases are taken
  again.
- Check: `rd_redis_up` in `/metrics`, and the log line "redis connection error".
- Act: start Redis again with the same Compose project and files you started the deployment with, for example
  `docker compose -p <project> --env-file <env file> -f docker-compose.yml -f deploy/scale/docker-compose.scale.yml up -d redis`
  (use your own project name; never the name `realtimedocs` unless that is the project). Redis in that overlay
  has persistence turned off, so a restart loses leases and tickets, which are rebuilt.
- If the load balancer removed every instance because of the 503, consider pointing it at an instance directly
  until Redis is back. Not rehearsed.

### Saves failing (`rd_persist_failures_total` rising)

Meaning: the server could not write a batch of edits to PostgreSQL and is retrying. Users see an error state
instead of "Saved" ([observability.md](observability.md), alert "Saves failing").

1. `deploy/logs.sh server --since 15m` for the database error (connection refused, timeout, disk, permission).
2. `deploy/exec.sh db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` and the checks of "Database down
   or disk full".
3. With `METRICS_TOKEN` set, look at `rd_persist_queue_bytes` (growing means edits are accumulating),
   `rd_db_pool_waiting` (above 0 means pool saturation: raise `DB_POOL_MAX`) and `rd_persist_duration_seconds`.
4. A conflict message about sequence or generation in the log is a different problem: a second writer or a
   restore happened. In multi-instance mode the refused writer drops its copy and clients reconnect. Report it
   with the log lines.
5. Do not restart while the database is down: clients keep their unsent work either way, but a restart drops the
   in-memory queue of the server, which is the only other copy of those edits.

### A share link or interview link leaked

A link is a bearer capability. Revoking stops future access and disconnects open connections; it cannot take
back what was already seen.

- **Share link of a document.** In the document choose "Share", then "Revoke link" (or "Rotate link" to keep a
  working link for the same people). API: `POST /api/documents/<id>/shares/<shareId>/revoke` or `.../rotate`.
- **Interview session links.** `/admin/interview-sessions/<sessionId>`: "Rotate link" for one participant or
  "Rotate all links". API: `POST /api/v1/interview-sessions/<id>/rotate-links` with scope `sessions:update`
  (the old links stop, open connections are disconnected, new links are returned once). To end a session:
  `.../complete`, `.../cancel`, or `DELETE /api/v1/interview-sessions/<id>` (archive, revokes every link).
  Send the new links through the channel you trust, not the one that leaked.
- Check what the link was used for: audit events `share.exchanged`, `share.exchange_failed`,
  `interview_session.links_rotated`; the version history of the document shows who changed what
  ([version-history.md](version-history.md)).

### A service API key leaked

1. `/admin/api-keys`: **Revoke** (stops at once) or **Rotate** (revokes the old key at once, no overlap, and
   shows the new key once).
2. Review what the key could do: its scopes and CIDR allow-list on the same page. The audit log shows
   `api_key.auth_failed`, `api_key.created`, `api_key.rotated`, `api_key.revoked` and the `service` actor on
   changes it made.
3. If it had `sessions:create` or `sessions:update`, check for unexpected interview sessions and participants
   (`/admin/interview-sessions`) and rotate their links.
4. If it had `documents:read`, assume the content of interview documents it could name was read.
5. Give the integration the new key through your secret store.

### A webhook secret leaked

There is no "rotate secret" function. Create a new endpoint (`/admin/webhooks` or `POST /api/v1/webhooks`; the
new `whsec_` secret is shown once), give the secret to the receiver, then **delete** the old endpoint.
Until the old one is deleted, someone with the old secret can forge deliveries to your receiver; the receiver
should also check the event id and timestamp ([webhooks.md](webhooks.md)). Webhook bodies contain ids,
statuses and roles, never document text, links or e-mail addresses.

### `SESSION_SECRET` leaked

`SESSION_SECRET` is not the key of the session tokens (those are random and stored as hashes), so a leak does
not let anyone sign in. What the secret protects: the anti-forgery token, the encryption of webhook secrets and
of stored idempotent responses, and the authentication between instances. If it leaked together with database
access, an attacker can decrypt webhook secrets and idempotent responses. Rotation steps and the side effects
are in [deployment.md](deployment.md#rotating-session_secret):

1. Generate a new value: `openssl rand -hex 32`.
2. Edit `SESSION_SECRET=` in `deploy/.env.production` (mode 600).
3. `deploy/up.sh`.
4. Recreate every webhook endpoint and give each receiver its new secret. Tell users to reload open tabs.
5. In multi-instance mode, change all instances together.

Not rehearsed on the live deployment.

### Database password or tunnel token leaked

- **Tunnel token** (`deploy/.env.tunnel`): whoever has it can run a connector for the tunnel. Procedure,
  rehearsed only with a throw-away project: [deploy/README.md](../deploy/README.md), "Replace the tunnel token"
  (create a new token in the Cloudflare dashboard, replace the line in `deploy/.env.tunnel`, `deploy/up.sh`,
  `deploy/status.sh`, confirm four "Registered tunnel connection" lines in `deploy/logs.sh tunnel`).
- **Database password.** The database stored the password when it was created, so changing the file alone makes
  the server fail to connect. Not rehearsed: (1) change it inside the database with the interactive
  `\password realtimedocs` command so that it does not appear in a shell history:
  `deploy/exec.sh db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`; (2) set the new value in both
  `POSTGRES_PASSWORD=` and the password inside `DATABASE_URL=` of `deploy/.env.production` (letters and digits
  only); (3) `deploy/up.sh`. The database port is bound to `127.0.0.1`, so exposure also requires access to
  this host.
- **Redis password** (scale overlay): set a new `REDIS_PASSWORD` in the env file and restart Redis and every
  server together. Not rehearsed.
- **Metrics token:** replace `METRICS_TOKEN` in the env file, `deploy/up.sh`, update the scraper.

### Suspected account compromise

1. **Disable the account** at `/admin/users` (People). Disabling ends all its sessions and closes its open document
   connections (the periodic check every `COLLAB_SWEEP_INTERVAL_SECONDS`, 30 seconds, is the second line).
   API: `PATCH /api/users/<userId>` with `{"status":"disabled"}`. You cannot disable yourself, and the last
   active administrator cannot be disabled.
2. **Set a new password** for when the account is re-enabled:
   `deploy/exec.sh server realtimedocs reset-password --email <address> --generate`. This also ends every
   session of the account. The new password is printed once; give it over a channel you trust.
3. If the account is an administrator, assume it could read every document, create share links, API keys and
   webhooks: review `/admin/api-keys`, `/admin/webhooks`, the share links of sensitive documents, and the audit
   log for the period.
4. Evidence: audit events `auth.login`, `auth.login_failed`, `auth.password_changed`, `auth.password_reset`,
   `auth.other_sessions_revoked`, `share.created`, `api_key.created`, `member.removed`, `user.updated`.
5. There is no multi-factor authentication ([security-checklist.md](security-checklist.md)).

### Malicious upload

Uploads are checked by content (type from the bytes, size, image dimensions, strict SVG validation) and are
served as downloads with `nosniff` and a sandbox policy; there is **no malware scanning**. A file that passes
the checks can still be harmful to the person who opens it outside the product.

1. Stop further access: remove the editor's access (document members, share links, disable the account; see the
   sections above).
2. Remove the content: an editor deletes the file from the document body. The stored file itself is deleted by
   the retention job only after it has been unreferenced by the document, every snapshot and every retained
   history row for `ASSET_GRACE_DAYS` (30 by default). **There is no function to delete a single stored asset
   at once.** For immediate removal, move the document to the trash and delete it permanently from there
   (`DELETE /api/documents/<id>` is accepted only for a trashed document); this deletes its files. That also
   deletes the document, so take a backup or copy what you need first.
3. Evidence: the document's version history (who inserted the attachment, when, from which session), audit
   events `asset.rejected_active_content` for rejected uploads.
4. Tell the people who downloaded it, if known.

### A bad desktop release was published

1. Point the channel back: `node scripts/publish-release.mjs --rollback <good-version> --channel stable --target
<staging dir>`, then copy the channel pointer into the downloads volume as in
   [desktop-release.md](desktop-release.md) (`docker cp <staging dir>/channels/. realtimedocs-server-1:/data/downloads/channels/`).
   The download page, `latest` and `/api/meta` follow within seconds. Nothing is deleted.
2. Apps that already updated are not downgraded. The app never installs updates by itself, so an affected
   person has installed the file by hand; tell them which version to reinstall.
3. A file whose SHA-256 no longer matches the manifest is withdrawn automatically. To force old apps to update,
   publish a fixed version with a higher `minimumSupportedVersion`.
4. This has not been done against the live deployment: no release is published there.

### A bad deploy (new code misbehaves)

Follow [upgrade-and-rollback.md](upgrade-and-rollback.md), "Roll back / The application only". In short: park
the newer migration records, tag the previous image as `realtimedocs-server:local`, start without building.
Revoke the links of running interview sessions first if the candidate restrictions matter, because the older
version does not know them. When the fix is ready, unpark before starting the newer server.

### Data loss suspected

**Do not restore anything yet.** A restore replaces everything written since the backup, including the evidence.

1. **Back up the current state now**, whatever its condition:

   ```sh
   scripts/backup.sh --env-file deploy/.env.production
   (cd backups/realtimedocs-<timestamp> && sha256sum -c SHA256SUMS)
   ```

   Copy it off the server. Name it as evidence.

2. **Freeze deletion.** The retention job deletes expired data on a timer. To stop it while you investigate set
   `CLEANUP_INTERVAL_MINUTES=0` in `deploy/.env.production` and run `deploy/up.sh` (a few seconds of
   interruption). Do not run `realtimedocs cleanup` by hand.
3. **Look for the data in the product first.** Trashed documents are kept for `TRASH_RETENTION_DAYS` (30)
   and can be restored by an administrator. Snapshots (including automatic `pre_restore` ones, kept 90 days)
   and the version history can restore a single document without touching anything else: in
   `/d/<id>/history` use "Restore as a copy" to put an old revision into a new document. History exists
   only from the upgrade onwards.
4. **Collect evidence** (next section).
5. **Only then** decide whether to restore. A restore into a separate project beside the live one is the safe
   way to look at an old state ([backup-and-restore.md](backup-and-restore.md), "Rehearse a restore beside a
   live system"). A restore into the live project needs the owner's decision.

## Evidence to collect

| What                           | How                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server logs with request ids   | `deploy/logs.sh server --since 24h > incident-server.log`. Each request line has a request id; the same id is in the `x-request-id` header, in error messages shown to users, and in audit events |
| Tunnel and database logs       | `deploy/logs.sh tunnel --since 24h`, `deploy/logs.sh db --since 24h`                                                                                                                              |
| Administrative audit events    | In the web app, People then Audit log; or `GET /api/audit?limit=<n>` as an administrator                                                                                                          |
| History of one document        | `/d/<documentId>/history`, "Export audit trail" (CSV or JSON), or `GET /api/documents/<id>/history/export`. Reading a revision is itself audited (`history.viewed`, `history.revision_viewed`)    |
| Events of an interview session | `GET /api/v1/interview-sessions/<id>/audit` (scope `documents:history:read`), or the session page in `/admin/interview-sessions`                                                                  |
| Metrics around the time        | If `METRICS_TOKEN` is set and a scraper exists, the stored series. Nothing stores metrics by default                                                                                              |
| A copy of the data             | A backup taken as described above, with its `SHA256SUMS`                                                                                                                                          |

What the logs do not contain: request bodies, document text, passwords, secrets, cookies and tokens. Logs are
rotated by Docker (10 MB, 5 files per container for `db` and `server`), so on a busy day older lines may be
gone; collect early.

## Communication template

> **Subject:** RealtimeDocs incident, status update <n>, <UTC time>
>
> **What we know:** <one or two sentences, only facts>
> **Impact:** <who cannot do what; whether any data may have been lost or exposed: yes / no / not known yet>
> **What we are doing:** <the current step>
> **What you should do:** <for example reload the page; nothing; change your password>
> **Next update:** <time>
>
> Started at <UTC>. Reported by <name>. Incident lead: <name>.

Do not state a cause until it is confirmed. Say "not known yet" instead of guessing.

## After the incident

- [ ] Timeline written from the scribe's notes, in UTC, including detection time and time to each action.
- [ ] Root cause stated with the evidence that supports it, or "not determined" and why.
- [ ] Was any data lost or exposed? Which, how much, who was told, when.
- [ ] Credentials involved rotated, and the side effects dealt with ([security-checklist.md](security-checklist.md), rotation checklist).
- [ ] What detected it, and what should have detected it sooner: add or tune an alert ([observability.md](observability.md)).
- [ ] What made it worse or slower (missing command, unclear document): fix the document.
- [ ] Code or configuration changes needed, with owners and dates.
- [ ] Backup taken during the incident kept or deleted on purpose; evidence files stored securely.
- [ ] This document updated where a step was wrong or missing.

## Disaster recovery

### What is and is not protected

| Data                                                           | Protected by                                   | Notes                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Database (documents, accounts, history, audit, keys, webhooks) | `scripts/backup.sh` (`pg_dump`, custom format) | Complete dump per run. No point-in-time recovery                       |
| Uploaded files (`rd_assets`)                                   | `scripts/backup.sh` (`assets.tar.gz`)          | Taken after the dump; files never change once stored                   |
| Desktop releases (`rd_downloads`)                              | Not in a backup                                | Rebuild or republish them; keep the build outputs                      |
| `deploy/.env.production`, `deploy/.env.tunnel`                 | Not in a backup, on purpose                    | Keep a copy in a secret store. A restore does not need the old secrets |
| Cloudflare tunnel and route                                    | Cloudflare account                             | Values to recreate the route are in `deploy/README.md`                 |

### RPO and RTO

- **RPO (how much data can be lost):** depends on how often backups are taken. **Nothing runs backups
  automatically today.** If the last backup is a week old, up to a week of edits is lost on a restore. Check
  the `backups/` directory on the server for the dates of the backups that exist; this document does not
  know them.
- **RTO (how long recovery takes):** depends on the size of the data, the speed of the new host, and how fast
  the secrets and the tunnel can be provided. It was not measured. The whole automated backup and restore test
  (`test:backup-restore`, small data set, one machine) took 30 to 34 seconds in the recorded runs; that is not a
  prediction for production data.
- Recommendation: schedule `scripts/backup.sh --env-file deploy/.env.production` from cron at least daily, copy
  the result off the server and test a restore regularly. This is not configured.

### Restore on a new host from a backup

Steps follow [backup-and-restore.md](backup-and-restore.md). Not rehearsed as a whole on a second host; the
restore script itself was rehearsed by `test:backup-restore` and against a copy of the live backup by
`scripts/rehearse-migration.sh`.

1. Provision a host with Docker Engine and the Compose plugin, Node.js 24 for the helper script, and a checkout
   of this repository at the version you want (the restored schema must not be newer than the code; the server
   refuses a newer database).
2. Copy the backup directory to the host and verify it:
   `cd backups/<directory> && sha256sum --check SHA256SUMS` (both files must say `OK`).
3. Create an environment file with new secrets for the target:
   `node scripts/init-env.mjs --public-origin https://<address>` (writes `.env`; for the tunnel layout create
   `deploy/.env.production` and `deploy/.env.tunnel` as described in `deploy/README.md`).
4. Restore: `scripts/restore.sh backups/<directory>` (add `--project <name> --env-file <file>` for another
   project or env file). The script verifies the checksums, starts the database, refuses a target that already
   has accounts unless `--force`, loads the dump, unpacks the assets and starts the server.
5. Check: the restore script prints the number of documents and files; sign in with an existing account; open a
   document; type and wait for "Saved"; check `/api/ready`.
6. Point the address at the new host (Cloudflare route or reverse proxy). Links contain `PUBLIC_ORIGIN`; they
   work only if the new system answers at the same address.
7. Side effects of a restore: access is the state of the backup (a link revoked after it works again, a removed
   person has access again; review sharing). Webhook endpoints are restored but their secrets were encrypted with
   the old `SESSION_SECRET`; with a new one they fail until recreated ([deployment.md](deployment.md#rotating-session_secret)).
   Stored idempotent responses are not usable either. Sessions in the dump stay valid.
8. Republish desktop releases into the new `rd_downloads` volume.
9. Run a backup of the new system and schedule backups.

### Point-in-time recovery (guidance only, not configured)

**WAL archiving is not configured.** Today you can go back to the moment of a backup and no other moment.
What enabling it would take, as PostgreSQL guidance not tested in this project:

1. In the database container's configuration set `archive_mode = on` and an `archive_command` (or archive
   library) that copies each completed WAL segment to storage outside the host. `wal_level` must be `replica`
   or higher (the default for supported versions). This needs a restart of PostgreSQL and a change to the
   Compose definition of the `db` service.
2. Take a physical base backup (`pg_basebackup`) and keep it together with the archived segments that follow it.
   The `pg_dump` backups of `scripts/backup.sh` cannot be used as a base for WAL replay.
3. To recover to a time: restore the base backup into an empty data directory, set `restore_command` and
   `recovery_target_time`, create `recovery.signal`, start PostgreSQL, and promote when it reaches the target.
4. The uploaded files are not covered by WAL. Take `assets.tar.gz` at least as often as the base backups; a
   database recovered to a time may name files that were added later and are missing from an older archive.
5. Test the whole procedure before relying on it, and monitor the archive (a failing `archive_command` fills the
   disk with unarchived segments).

Until that is done, state the recovery point as "the last verified backup".
