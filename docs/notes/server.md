# Server notes (`apps/server`, exporters, Docker packaging)

State on 2026-11-11 (host local time). Everything reported here was run on the build host:
Ubuntu 24.04 aarch64, Node 24.22.2, pnpm 12.18.0, Docker 29.6.2, Docker Compose v5.2.0,
PostgreSQL 17.11 (`postgres:17.11-alpine`). Section 13 lists what was **not** run.

## 1. What exists

| Path                                                                       | Content                                                                                                                          |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/config.ts`                                                | zod-validated environment, fails fast, never prints secrets                                                                      |
| `apps/server/src/db/`                                                      | `pg` pool, plain SQL migrations with an advisory lock and checksums                                                              |
| `apps/server/migrations/0001_init.sql`                                     | the whole schema (one migration so far)                                                                                          |
| `apps/server/src/auth/`                                                    | Argon2id (`node:crypto`), hashed session tokens, session trees                                                                   |
| `apps/server/src/access/resolve.ts`                                        | the one `resolveAccess` used by every document route and by the collaboration endpoint                                           |
| `apps/server/src/http/`                                                    | Fastify app, origin/CSRF rules, rate limits, error mapping, all routes of `packages/contracts/src/api.ts`                        |
| `apps/server/src/collab/`                                                  | `/collab` endpoint (Hocuspocus on a `ws` server), durable log, acknowledgement protocol, presence rules, live access enforcement |
| `apps/server/src/assets/`                                                  | upload pipeline, type sniffing, strict SVG validation, private disk storage                                                      |
| `apps/server/src/cleanup.ts`                                               | retention job                                                                                                                    |
| `apps/server/src/cli.ts`                                                   | operator commands                                                                                                                |
| `packages/editor/src/export/`                                              | DOM-free `toPlainText`, `toMarkdown`, `collectAssetIds`                                                                          |
| `Dockerfile`, `docker-compose.yml`, `.env.example`, `scripts/init-env.mjs` | packaging and first-run configuration                                                                                            |
| `scripts/backup.sh`, `scripts/restore.sh`                                  | backup and restore of a Compose deployment                                                                                       |
| `apps/server/test/unit`, `test/integration`, `test/backup-restore`         | the three test layers described in section 10                                                                                    |

## 2. Commands (all of these exist and were run, unless section 13 says otherwise)

On this host every command needs the pinned toolchain first: `. scripts/dev-env.sh`.

### Running the server on the host

```sh
pnpm setup:env                 # writes .env with generated secrets, never overwrites
pnpm db:up                     # PostgreSQL container of docker-compose.yml on 127.0.0.1:54310
pnpm db:migrate                # optional: the server migrates at start-up (AUTO_MIGRATE=true)
pnpm bootstrap:admin --email you@example.com --name "Your Name" --generate
pnpm seed:sample               # optional sample document with its bundled image
pnpm dev                       # server (tsx watch) + web dev server
pnpm build && pnpm start       # production bundle: node --enable-source-maps apps/server/dist/main.js
```

The server and the CLI read `<repository>/.env` when it exists; real environment variables win.
`RD_ENV_FILE=<path>` selects another file.

### Operator commands

Host form: `pnpm --filter @realtimedocs/server run <script> [options]`.
Container form: `docker compose exec server realtimedocs <command> [options]`
(add `-T` when a password is piped in).

| Command (container form)                                                                                     | Package script                                   | What it does                                                                                                               |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `migrate`                                                                                                    | `migrate` (root: `pnpm db:migrate`)              | applies pending migrations                                                                                                 |
| `bootstrap-admin --email <address> --name <name> [--password-stdin \| --generate] [--workspace-name <name>]` | `bootstrap:admin` (root: `pnpm bootstrap:admin`) | creates the first administrator; refuses once any account exists                                                           |
| `reset-password --email <address> [--password-stdin \| --generate]`                                          | `reset:password`                                 | new Argon2id hash, ends every session of that account, audit event; refuses unknown and disabled accounts with exit code 1 |
| `seed-sample [--owner-email <address>] [--force]`                                                            | `seed:sample` (root: `pnpm seed:sample`)         | creates the sample document                                                                                                |
| `cleanup`                                                                                                    | `cleanup`                                        | runs the retention rules once and prints a JSON report                                                                     |

Password input: without an option the command asks on a terminal without echo; `--password-stdin`
reads one line from standard input; `--generate` creates a password and prints it exactly once.
A password is never printed otherwise and never logged. CLI logs go to standard error, results to
standard output. Usage errors exit with 64, refusals with 1.

`reset-password` runs in its own process: HTTP requests of the affected account fail at once,
open collaboration connections are closed by the server's periodic sweep (at most
`COLLAB_SWEEP_INTERVAL_SECONDS`, default 30 s, later).

### Docker Compose

```sh
pnpm setup:env
docker compose up -d --build --wait
docker compose exec server realtimedocs bootstrap-admin --email you@example.com --name "Your Name" --generate
```

`db` is published on `127.0.0.1:${RD_DB_PORT:-54310}`, `server` on `127.0.0.1:${RD_PORT:-4310}`.
Volumes: `rd_pgdata` (database), `rd_assets` (uploaded files). Three variables exist only for
isolated runs: `RD_COMPOSE_ENV_FILE` (env file handed to the server container, default `.env`),
`RD_IMAGE` (image name, default `realtimedocs-server:local`) and `RD_BUILD_TARGET`
(`runtime` = with the web app, `server-runtime` = API and collaboration only).

### Backup and restore

```sh
scripts/backup.sh  [--project <compose project>] [--env-file <file>] [--out <directory>]
scripts/restore.sh <backup directory> [--project <target project>] [--env-file <file>] [--force]
```

Defaults: project `realtimedocs`, env file `.env`, output `backups/`. See section 9.

### Tests and quality gates

```sh
pnpm exec vitest run --project server                         # unit tests
pnpm --filter @realtimedocs/server run test:integration       # real PostgreSQL + real server process
pnpm --filter @realtimedocs/server run test:backup-restore    # backup → restore rehearsal in containers
pnpm --filter @realtimedocs/server run typecheck
pnpm exec eslint apps/server packages/editor/src/export
pnpm exec prettier --check apps/server packages/editor/src/export docker-compose.yml
```

## 3. Environment variables

Required: `DATABASE_URL`, `SESSION_SECRET` (at least 32 characters, not repetitive). Compose
additionally needs `POSTGRES_PASSWORD`. A missing or invalid value stops the process at start-up
with a message that names the variable; secrets are never part of that message.

| Variable                                                                   | Default                      | Meaning                                                                                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                                                 | `development`                | `development`, `production` or `test`                                                                                                                        |
| `DATABASE_URL`                                                             | none (required)              | `postgres://user:password@host:port/database`                                                                                                                |
| `SESSION_SECRET`                                                           | none (required)              | key of the per-session CSRF token. Changing it signs nobody out; open tabs fetch a new token on reload                                                       |
| `RD_HOST` / `RD_PORT`                                                      | `127.0.0.1` / `4310`         | listen address (strict: the server exits when the port is taken)                                                                                             |
| `RD_DB_PORT`                                                               | `54310`                      | Compose only: host port of PostgreSQL                                                                                                                        |
| `PUBLIC_ORIGIN`                                                            | `http://127.0.0.1:<RD_PORT>` | origin people use; share, invitation and sample links, `Secure` cookies and HSTS follow from it                                                              |
| `ALLOWED_ORIGINS`                                                          | empty                        | further web origins that may use cookie sessions (comma separated). `.env.example` lists the Vite development origins; leave it empty in a shared deployment |
| `DESKTOP_ORIGINS`                                                          | `app://realtimedocs`         | origins of packaged desktop renderers: CORS and bearer tokens only, never cookies                                                                            |
| `COOKIE_SECURE`                                                            | `auto`                       | `auto` = `Secure` cookies when `PUBLIC_ORIGIN` is https                                                                                                      |
| `TRUST_PROXY`                                                              | `false`                      | `true`, `false` or the number of trusted proxy hops (client address for rate limits and logs)                                                                |
| `ASSET_DIR`                                                                | `data/assets`                | private directory for uploaded files (`/data/assets` in the image)                                                                                           |
| `WEB_DIST_DIR`                                                             | `apps/web/dist`              | built web app; served only when `index.html` exists there (`/app/web` in the image)                                                                          |
| `LOG_LEVEL`                                                                | `info`                       | pino level                                                                                                                                                   |
| `AUTO_MIGRATE`                                                             | `true`                       | apply pending migrations at start-up                                                                                                                         |
| `MIN_CLIENT_SCHEMA_VERSION`                                                | `1`                          | oldest document schema a client may speak                                                                                                                    |
| `RD_ENV_FILE`                                                              | `<repository>/.env`          | env file read by server and CLI                                                                                                                              |
| `SESSION_TTL_SECONDS` / `SESSION_IDLE_TTL_SECONDS`                         | 14 days / 3 days             | account sessions: absolute / idle lifetime                                                                                                                   |
| `SHARE_SESSION_TTL_SECONDS` / `SHARE_SESSION_IDLE_TTL_SECONDS`             | 7 days / 1 day               | share-link guest sessions (never beyond the link's own expiry)                                                                                               |
| `DESKTOP_SESSION_TTL_SECONDS` / `DESKTOP_SESSION_IDLE_TTL_SECONDS`         | 30 days / 14 days            | desktop sessions                                                                                                                                             |
| `LIMIT_MAX_IMAGE_BYTES`                                                    | 10 MiB                       | inline image                                                                                                                                                 |
| `LIMIT_MAX_ATTACHMENT_BYTES`                                               | 25 MiB                       | download-only attachment                                                                                                                                     |
| `LIMIT_MAX_SVG_BYTES`                                                      | 1 MiB                        | SVG images (parsed completely, hence the smaller budget)                                                                                                     |
| `LIMIT_MAX_IMAGE_PIXELS` / `LIMIT_MAX_IMAGE_DIMENSION`                     | 40,000,000 / 12,000          | read from the image header, nothing is decoded                                                                                                               |
| `LIMIT_DOCUMENT_ASSET_QUOTA_BYTES`                                         | 500 MiB                      | stored asset bytes per document                                                                                                                              |
| `LIMIT_MAX_DOCUMENT_STATE_BYTES`                                           | 8 MiB                        | soft limit: a warning is logged when a compacted state is larger                                                                                             |
| `LIMIT_MAX_COLLAB_MESSAGE_BYTES`                                           | 4 MiB                        | largest WebSocket frame on `/collab`                                                                                                                         |
| `LIMIT_MAX_JSON_BODY_BYTES`                                                | 256 KiB                      | largest JSON request body                                                                                                                                    |
| `TRASH_RETENTION_DAYS`                                                     | 30                           | trashed documents are purged after this time                                                                                                                 |
| `ASSET_GRACE_DAYS`                                                         | 30                           | an asset is deleted after being unreferenced this long                                                                                                       |
| `PENDING_UPLOAD_HOURS`                                                     | 24                           | unfinished uploads and stale staging files                                                                                                                   |
| `PRE_RESTORE_SNAPSHOT_RETENTION_DAYS`                                      | 90                           | automatic pre-restore snapshots (named snapshots are kept)                                                                                                   |
| `AUDIT_RETENTION_DAYS`                                                     | 365                          | audit events                                                                                                                                                 |
| `SESSION_RETENTION_DAYS`                                                   | 30                           | ended or expired session rows and used handoff codes                                                                                                         |
| `CLEANUP_INTERVAL_MINUTES`                                                 | 360                          | retention timer inside the server; `0` turns it off                                                                                                          |
| `COLLAB_MAX_CONNECTIONS`                                                   | 1000                         | open WebSockets per process                                                                                                                                  |
| `COLLAB_MAX_QUEUE_BYTES`                                                   | 16 MiB                       | uncommitted update bytes per document before it stops accepting edits                                                                                        |
| `COLLAB_FRAME_BURST` / `COLLAB_FRAMES_PER_SECOND`                          | 1500 / 300                   | inbound frame budget per socket                                                                                                                              |
| `COLLAB_TICKET_TTL_SECONDS`                                                | 60 (maximum 60)              | lifetime of a collaboration ticket                                                                                                                           |
| `COLLAB_PING_INTERVAL_SECONDS` / `COLLAB_IDLE_TIMEOUT_SECONDS`             | 15 / 45                      | application-level ping and idle cut-off                                                                                                                      |
| `COLLAB_SWEEP_INTERVAL_SECONDS`                                            | 30                           | periodic re-check of every live connection against the database                                                                                              |
| `COLLAB_COMPACT_AFTER_UPDATES`                                             | 200                          | committed log rows of an open document before the log is compacted                                                                                           |
| `DB_POOL_MAX`                                                              | 10                           | pool size                                                                                                                                                    |
| `DB_STATEMENT_TIMEOUT_MS` / `DB_LOCK_TIMEOUT_MS` / `DB_CONNECT_TIMEOUT_MS` | 15000 / 5000 / 5000          | database timeouts                                                                                                                                            |
| `RATE_*`                                                                   | see section 4                | rate limits                                                                                                                                                  |

`GET /api/meta` publishes the effective limits, versions and origins; clients read them from there.

## 4. Rate limits, lifetimes and fixed limits

Rate limits live in the memory of the server process (they reset on restart) and answer
`rate_limited` (429) with `Retry-After`.

| Variable                         | Default                        | Counted                                                        | Window |
| -------------------------------- | ------------------------------ | -------------------------------------------------------------- | ------ |
| `RATE_LOGIN_PER_IP`              | 20                             | failed sign-ins per client address                             | 5 min  |
| `RATE_LOGIN_PER_EMAIL`           | 8                              | failed sign-ins per email address                              | 15 min |
| `RATE_SHARE_EXCHANGE_PER_IP`     | 30                             | failed share exchanges per client address                      | 5 min  |
| `RATE_SHARE_EXCHANGE_PER_GRANT`  | 20                             | failed share exchanges per link                                | 5 min  |
| `RATE_INVITE_PER_IP`             | 20                             | failed invitation lookups and accepts per client address       | 10 min |
| `RATE_DESKTOP_REDEEM_PER_IP`     | 20                             | failed handoff redemptions per client address                  | 5 min  |
| `RATE_COLLAB_TICKET_PER_MINUTE`  | 120                            | collaboration tickets per principal                            | 1 min  |
| `RATE_UPLOAD_PER_MINUTE`         | 240                            | uploads per principal                                          | 1 min  |
| `RATE_WS_UPGRADE_PER_MINUTE`     | 120                            | WebSocket upgrades per client address                          | 1 min  |
| `RATE_API_PER_MINUTE`            | 1200                           | all API requests per client address                            | 1 min  |
| `RATE_API_KEY_PER_MINUTE`        | 600                            | requests per service API key (`/api/v1`)                       | 1 min  |
| `WEBHOOK_POLL_MS`                | 2000                           | delivery worker poll interval (0 disables the worker)          | —      |
| `WEBHOOK_TIMEOUT_MS`             | 10000                          | one delivery attempt                                           | —      |
| `WEBHOOK_RETRY_SCHEDULE_SECONDS` | `60,300,1800,7200,21600,86400` | wait after the 1st, 2nd, … failure; one more failure is `dead` | —      |

Fixed in code: Argon2id with 64 MiB memory, 3 passes, parallelism 1 (at most 4 hashes run at the
same time, 64 wait); password length 12 to 256; title 200, display name 80, snapshot name 120,
share label 80 characters; desktop handoff codes live 60 s; presence at most one frame per 60 ms
and 2048 bytes of state per connection; a socket may queue at most 32 MiB of outbound data; a
socket that does not authenticate within 15 s is closed; lists return at most 500 documents per
view (`recent`: 12) and at most 500 audit events.

## 5. HTTP API: behaviour that other agents rely on

- Every route of `packages/contracts/src/api.ts` / `client.ts` is implemented. Errors are always
  an `ApiErrorBody` with a server-made request id (a client-supplied id is not trusted).
- Session cookie `rd_session` (`HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` on https). Share
  sessions use `rd_share_<documentId>` with `Path=/api/documents/<documentId>`.
- Unsafe methods need an allow-listed `Origin` and `X-RD-CSRF`; for account sessions the header
  must equal the token from `GET /api/auth/session`. Cookies are ignored on cross-site requests
  and whenever a bearer token is sent. `POST /api/share/exchange` and `POST /api/desktop/redeem`
  also accept requests without `Origin` when they carry no cookie (desktop main process).
- Wrong password, unknown email and disabled account all answer `unauthenticated` with the same
  message and comparable timing.
- `POST /api/auth/password` with a wrong current password answers `validation_failed` with one
  issue whose path is `currentPassword`. Success ends every other session of the account.
- `POST /api/auth/sessions/revoke-others` answers `{ revoked: <count> }`. It keeps the calling
  session and the sessions derived from it (its desktop sessions) and ends every other session of
  the account, including desktop sessions derived from those; live connections of the ended
  sessions are closed at once; an audit event `auth.other_sessions_revoked` is written.
- A document the caller cannot reach and a document that does not exist give the same
  `not_found` answer. Without any session the answer is `unauthenticated`.
- `GET /api/documents`: `view=active` and `view=archived` are ordered by the last metadata change
  (`updatedAt`); `view=recent` returns **active documents only**, ordered by the newest change of
  content or metadata, at most 12; `view=trash` is an administrator view and answers an **empty
  list** to members (not the active view). `q` searches titles only (case-insensitive substring).
- Archived documents: everybody's role is capped at `viewer`; for administrators `access.via`
  stays `workspace_admin` and lifecycle routes keep working. Snapshot restore on an archived
  document answers `conflict`.
- Share links: view-only by default; the URL with the secret is returned only by create and
  rotate. Every exchange creates a new guest session. Rotation is possible only while the link is
  active (`conflict` otherwise); a revoked link cannot be changed (`conflict`); an expired link
  can still be edited, for example to extend it. Revocation, expiry, earlier expiry, downgrade
  and rotation are applied to open connections immediately.
- Desktop sessions are scoped to one document and never carry management rights (an
  administrator's desktop session acts as `editor`). They end with the browser session, share
  link or account they were derived from.
- Exports (`GET /api/documents/:id/export?format=txt|md|md-zip|json`) are all sent with
  `Content-Disposition: attachment`, **including JSON**. They show what collaborators see at
  that moment (the live document when it is loaded, otherwise the stored state). File names come
  from the sanitised title; asset file names in Markdown and in the zip are unique and assigned
  in document order.
- `GET /api/health` always answers 200 while the process runs; `GET /api/ready` answers 200 or
  503 with the same body shape, depending on the database.

### Static web app (when `WEB_DIST_DIR` holds a build)

- Files of the build are served as files: `/boot.js`, `/favicon.svg`, `/assets/*`.
- `/assets/*` is sent with `Cache-Control: public, max-age=31536000, immutable`; everything else
  from the build, including `index.html` and `boot.js`, with `Cache-Control: no-cache`.
- Every other `GET`/`HEAD` outside `/api`, `/collab` and `/assets/` answers `index.html`
  (client-side routes such as `/login`, `/d/<id>`, `/s/<id>`, `/invite/<id>`).
- An unknown `/api/...` path answers the JSON `not_found` error, never HTML. A missing file under
  `/assets/` answers 404 `not_found`, never `index.html`.
- Security headers on every response: Content-Security-Policy (`default-src 'self'`,
  `script-src 'self'`, no `unsafe-eval`, `connect-src 'self'` plus the WebSocket origin,
  `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`),
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  and HSTS only when `PUBLIC_ORIGIN` is https. CORS answers only for `DESKTOP_ORIGINS`, without
  credentials.

## 6. Collaboration endpoint (`/collab`)

- A `ws` server in `noServer` mode behind the HTTP server's `upgrade` event; Hocuspocus handles
  the protocol. Checks at upgrade time: `Origin` on the allow-list (close 4400 `bad_origin`),
  upgrade rate per address (4429), connection cap (1013 `server_busy`), frame size
  (`LIMIT_MAX_COLLAB_MESSAGE_BYTES`, close 1009), binary frames only.
- **Inbound frame budget per socket (lead review, item 1):** two configuration values,
  `COLLAB_FRAME_BURST` (default 1500) and `COLLAB_FRAMES_PER_SECOND` (default 300), in
  `config.collab.frameBurst` / `config.collab.framesPerSecond`. The byte budget is unchanged
  (burst 16 MiB or two maximum-size frames, 2 MiB/s sustained). A socket over budget is closed
  with 4429 `rate_limited`. Test: a client sending 150 small frames per second for 10 s stays
  connected and gets every marker answered, while a flood of 12,000 frames is disconnected and the
  honest client on the same document is not affected.
- Application-level ping: the server sends byte `9`; the provider's one-byte answer `10` is
  intercepted (never handed to Hocuspocus) and counts as activity.
- Authentication: the ticket is single-use and bound to principal, document, generation and Yjs
  client id; access is resolved again from the database when the ticket is used; the role is
  never taken from the client. View-only connections cannot change the document (Hocuspocus
  refuses their update frames, and the durable log refuses to persist an update whose origin is
  a read-only connection).
- **Durable log:** every Yjs update is queued synchronously in the `update` event and written by
  a single writer per document in one statement that locks the `documents` row, checks the
  generation and assigns `seq = head_seq + 1`. Failed commits are retried with capped
  exponential backoff (250 ms to 5 s) and jitter. `saved n` is sent only after the commit that
  covers marker `n`.
- **`hello` (lead review, item 2):** the containment check (state vector and delete set) runs at
  most once per 200 ms per connection. A `hello` that arrives earlier is no longer dropped: the
  latest one is kept (at most one per connection) and processed when the interval has elapsed,
  against the document and runtime state of that moment; it is skipped when the connection is
  closing or the runtime changed. Test: two `hello` messages 5 ms apart end in exactly one answer
  for the later `n`.
- Database outage: `save-error { code: 'storage_unavailable', retrying: true }`, never `saved`;
  when the uncommitted queue is full the document announces
  `persistence { state: 'degraded', acceptingEdits: false }`, refuses further updates
  (`save-error { code: 'server_busy', retrying: false }`) and resumes at half the limit.
- Presence: only the connection's own client id, identity replaced by the authenticated one,
  cursors removed for view-only connections, throttled per connection.
- Access changes close or downgrade open connections at once (registry by document, session and
  account), plus per-connection expiry timers and the periodic sweep.
- Snapshot restore starts generation + 1 from a fresh encoding of the snapshot, stores the
  abandoned state as a `pre_restore` snapshot, deletes the old generation's rows and closes the
  old room (`generation_changed`). Old tickets, room names and log writes are refused.
- Shutdown (SIGTERM/SIGINT): `shutdown` message, queues flushed for up to 5 s, sockets closed
  with 4503. Correctness does not depend on it.
- Close codes are the ones in `COLLAB_CLOSE`; additionally 1008 `authentication_failed`,
  1009 (frame too large), 1013 `server_busy`.

## 7. Assets

- Streaming multipart upload into a staging file with a hard size cut-off, type decided from the
  bytes (PNG, JPEG, GIF, WebP, SVG; attachments by extension allow-list plus content check),
  dimensions from the header (`image-size`), strict SVG allow-list validation (`saxes`), file
  name sanitising, per-document quota under an advisory lock, random storage keys, `fsync` and
  atomic rename before the row becomes `ready`.
- Download: authorized per request; images inline with the verified type, everything else as
  `application/octet-stream` attachment; `nosniff`, a sandboxing CSP, `Cache-Control: private,
no-cache` and ETag/304.
- Retention: the `cleanup` job marks assets that neither the live document nor any snapshot
  refers to, and deletes them after `ASSET_GRACE_DAYS`. File deletions go through the
  `asset_deletions` queue table so a crash between database commit and file removal leaves no
  orphan and no dangling row.

## 8. Docker packaging

- `Dockerfile`: multi-stage, base `node:24.22.2-trixie-slim` (the Node release of the pinned
  toolchain), pnpm from Corepack as pinned in `package.json`, `pnpm install --frozen-lockfile`
  filtered to server and web. Targets: `runtime` (default: API, collaboration, web app) and
  `server-runtime` (without the web app).
- The runtime image contains the esbuild bundle (`/app/server/dist`), `migrations`, the sample
  image and the built web app. It has no `node_modules` and no build tools, runs as user `node`
  (uid 1000), declares the volume `/data/assets`, has a health check on `/api/health` and the
  wrapper `/usr/local/bin/realtimedocs` for operator commands.
- Observed: image `linux/arm64`, 268 MB, `node --version` inside it prints `v24.22.2`.
- `docker-compose.yml`: `db` (`postgres:17.11-alpine`, volume `rd_pgdata`, health check) and
  `server` (volume `rd_assets`, waits for a healthy database); both published on 127.0.0.1 only.

## 9. Backup and restore

`scripts/backup.sh` writes a new directory `<out>/<project>-<UTC timestamp>/` (mode 700) with
`database.dump` (`pg_dump` custom format, taken first), `assets.tar.gz` (the asset volume, read
through a throw-away container without network), `SHA256SUMS` and `manifest.json`. The services
may keep running. The dump contains password hashes and document content: store it accordingly.

`scripts/restore.sh` verifies the checksums, starts the target's database, **refuses a target
that already contains accounts unless `--force` is given (and changes nothing in that case)**,
stops the server, recreates the database from the dump, replaces the content of the asset volume
and starts the server. The target may be a new project name with its own env file and ports,
which is the way to rehearse a restore beside a running deployment. `SESSION_SECRET` and
`POSTGRES_PASSWORD` of the target may differ from the source.

### Verification result (2026-11-11)

`pnpm --filter @realtimedocs/server run test:backup-restore` (`apps/server/test/backup-restore/`)
ran the whole round trip in two isolated Compose projects, `rd-srv-bk-src` (127.0.0.1:4413,
database 54413) and `rd-srv-bk-dst` (4414 / 54414), with different generated secrets:

1. `docker compose up -d --build --wait` from the real image; `/api/ready` 200; `/` is the web
   app with a CSP header; the server process runs as uid 1000.
2. Administrator through `realtimedocs bootstrap-admin --password-stdin`, sample document through
   `realtimedocs seed-sample`, then through the public API and the collaboration endpoint: an
   invited member account, a document with non-Latin text, a deletion-only change, an uploaded
   image and attachment, a named snapshot, a later edit, a share link and an archived document.
   The server log contained none of the five secrets involved (two passwords, share secret,
   session secret, database password).
3. `scripts/backup.sh`: 3 documents, 3 asset rows, 3 asset files, schema version 1.
4. The source project was destroyed including its volumes.
5. `scripts/restore.sh` into the second project.
6. 26 comparisons, all passed: both accounts sign in with their original passwords; same
   documents, titles and states; text and Markdown exports identical; asset files byte-identical
   (SHA-256); snapshots and memberships present; the member sees exactly its document; the share
   link still exchanges; the audit trail is present; the collaboration endpoint serves the
   restored content; a new edit is acknowledged (`saved`) and exported; restoring the snapshot
   taken before the backup brings back the earlier content.
7. A second restore without `--force` was refused ("already contains 2 account(s). Nothing was
   changed.") and the running server stayed up; with `--force` the data was replaced, the
   retention job (`realtimedocs cleanup`) removed nothing, and the same 26 comparisons passed
   again.
8. A copy of the backup with one byte appended to `assets.tar.gz` was rejected by the checksum
   step ("assets.tar.gz: FAILED"), even with `--force`, before anything of the target was
   touched; the server stayed up.

Result: **passed**, exit code 0, 36 s on the last run with a cached image (80 s on the run that
rebuilt the image from the new base image). The script removed both projects, their volumes, the
env files and the backup afterwards.

The rehearsal found and fixed two defects in `restore.sh` before this result: the "target not
empty" probe failed on a fresh database, and a refused restore used to stop the target's server.

## 10. Tests

### Unit: `pnpm exec vitest run --project server`

Last run (section 16): **195 passed, 0 failed, 11 files, 0.73 s**.

| File                  | Tests | Covers                                                                                                                                                                                                                                                                      |
| --------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svg.test.ts`         | 47    | strict SVG validation: scripts, event handlers, `foreignObject`, external references, entities, unknown elements, limits                                                                                                                                                    |
| `filename.test.ts`    | 25    | file-name sanitising, reserved names, `Content-Disposition`                                                                                                                                                                                                                 |
| `exporters.test.ts`   | 22    | `toPlainText`, `toMarkdown` (marks, lists, tables, code, links, assets), `collectAssetIds`                                                                                                                                                                                  |
| `misc.test.ts`        | 20    | log redaction, error mapping without leaking details, token bucket / window limiter / `TrailingThrottle` (deferred `hello`), client address behind trusted proxies, document state helpers (initial state, merge, fresh re-encoding), asset id rewriting, export file names |
| `auth.test.ts`        | 19    | Argon2id with the production parameters, hash format, rehash flag, hostile stored hashes; tokens and CSRF token; share, invitation and handoff link formats; `TicketStore`; session expiry rules; guest identities                                                          |
| `durable-log.test.ts` | 18    | apply order and gap-free sequence, group commit, deletion-only updates, failed commits (no acknowledgement, retry, capped backoff), bounded queue, compaction boundary, generation and sequence guards, flush                                                               |
| `presence.test.ts`    | 13    | presence sanitising and throttle                                                                                                                                                                                                                                            |
| `containment.test.ts` | 10    | state-vector and delete-set containment for the `hello` proof                                                                                                                                                                                                               |
| `config.test.ts`      | 9     | defaults, overrides, `Secure` cookies derived from the public origin, fail-fast messages that name the variable and contain no secrets, origin parsing                                                                                                                      |
| `sniff.test.ts`       | 7     | magic-byte detection                                                                                                                                                                                                                                                        |

### Integration: `pnpm --filter @realtimedocs/server run test:integration`

The harness starts `postgres:17.11-alpine` as container `rd-srv-pg-test` on 127.0.0.1:54410,
builds the server bundle and runs it as a child process on 127.0.0.1:4410 (further instances on
4411 and 4412), one database per test file. Clients are a cookie-jar HTTP client, the real
`@hocuspocus/provider` and a raw `ws` client that crafts frames. Nothing is mocked.

Last run (section 16): **149 passed, 0 failed, 15 files, in 121.4 s** (the table below lists the original ten files; `proxy`, `download`, `signup`, `long-session` and `downloads-api` are described in sections 15 and 16; `collab.test.ts` now has 20 tests).

| File                    | Tests | Time   | Covers                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fresh-setup.test.ts`   | 7     | 4.3 s  | acceptance 18 without Docker: empty database migrates, no default credentials, bootstrap rules, generated password shown once, first document edited and acknowledged, sample document, bad configuration fails fast                                                                                                                                   |
| `auth.test.ts`          | 25    | 9.8 s  | cookie attributes, hashed tokens, uniform sign-in failures and timing, rate limit, logout, absolute and idle expiry, password change, sign out everywhere else, `reset-password` command, origin and CSRF rules, structured errors, security headers, static web app rules, invitations, account administration, audit events and logs without secrets |
| `authorization.test.ts` | 12    | 1.0 s  | acceptance 8: one indistinguishable answer for foreign and unknown documents, cross-document ids, list visibility, role matrix for viewer / editor / administrator, immediate effect of membership changes, tickets                                                                                                                                    |
| `shares.test.ts`        | 13    | 7.7 s  | acceptance 9: default view-only, secret shown once, scoped guest session, guessing limits, live revocation, expiry, earlier expiry, rotation, downgrade and upgrade, independence from memberships, trashed documents, no secrets in audit and log                                                                                                     |
| `collab.test.ts`        | 19    | 23.4 s | convergence, live viewer, acceptance 7 (crafted viewer frames change neither memory nor database), presence spoofing and throttle, single-use and expired tickets, origin check, generation and version checks, frame budget, oversized and text frames, ping, `hello` proof including the deferred one, compaction on unload                          |
| `durability.test.ts`    | 7     | 14.8 s | acceptance 10 (acknowledged edits survive SIGKILL, including deletion-only edits), 12 (initial content exactly once), 6 server side (offline edits proven with `hello`; refused after access was removed), 11 (PostgreSQL stopped: no `saved`, `save-error`, recovery; bounded queue)                                                                  |
| `snapshots.test.ts`     | 5     | 1.2 s  | acceptance 13: restore starts a new generation and keeps stale offline edits out; refusals; `PgLogStore` against PostgreSQL (gap-free sequence, stale generation refused, one winner of two concurrent writers)                                                                                                                                        |
| `assets.test.ts`        | 11    | 2.2 s  | upload authorization, size cut-off, type from bytes, SVG validation, hostile file names, quota, malformed requests, all export formats, live versus stored export, duplicate with rewritten asset ids                                                                                                                                                  |
| `desktop.test.ts`       | 10    | 1.1 s  | handoff codes (single use, expiry, wrong document, foreign origin, lost access), scope of desktop sessions, CORS for the desktop origin only, logout, revocation with the parent session, account or link, no codes or tokens in logs and audit                                                                                                        |
| `documents.test.ts`     | 8     | 3.8 s  | create, rename, list views and search, archive (live read-only), trash, restore, permanent deletion with files, retention job                                                                                                                                                                                                                          |

The per-file times are test time as reported by Vitest's JSON reporter (they add up to less than
the total, which also contains starting the container, building the bundle and starting servers).

### Backup → restore rehearsal

See section 9: passed, 26 comparisons run twice.

### Quality gates (last run after the final code change)

`pnpm --filter @realtimedocs/server run typecheck`: no errors.
`pnpm exec eslint apps/server packages/editor/src/export`: no findings; the code contains no
`eslint-disable`, `@ts-ignore` or `@ts-expect-error`.
`pnpm exec prettier --check apps/server packages/editor/src/export docker-compose.yml`: clean.

## 11. Deviations from the architecture or the contracts, and local additions

1. **Extra table `asset_deletions`** (storage key, earliest deletion time): the queue that makes
   file deletion crash-safe. Not in the architecture's table list.
2. **`COLLAB_TICKET_TTL_SECONDS`** can shorten the ticket lifetime (never above the contract's
   60 s); used by the expiry test.
3. **Global API rate limit** per client address (`RATE_API_PER_MINUTE`, default 1200) in addition
   to the limits the architecture lists.
4. **Desktop sessions never carry management rights**: an administrator's desktop session acts
   as `editor`. The architecture says "document-scoped"; this is the stricter reading.
5. **Share exchange always creates a new session** (the share cookie is path-scoped and is not
   sent to `/api/share/exchange`, so there is nothing to reuse).
6. **Share link state rules**: rotate only while active; change refused for revoked links;
   expired links can be edited.
7. **`view=trash` for members is an empty list**; `docs/notes/web.md` assumed the active view.
   The web app does not offer the trash to members, so nothing breaks.
8. **`GET /api/ready`** answers 503 with a health body while the database is unreachable.
9. **`LIMIT_MAX_DOCUMENT_STATE_BYTES` is a soft limit** (warning in the log), as the contract's
   comment says; no edit is refused because of it.
10. **Old generation rows are deleted at snapshot restore**; the abandoned state lives on only in
    the automatic `pre_restore` snapshot.
11. **`apps/server/tsconfig.json` includes the DOM library** because the contracts client and the
    editor schema are consumed as source. No server code uses DOM APIs.
12. **Strict SVG validation rejects foreign-namespace metadata** (for example editor-specific
    elements written by drawing tools). Such files must be exported as plain SVG.

Nothing needs to be merged into `packages/contracts` beyond what the lead already merged.

## 12. Requests for the lead (files I do not own)

- Root `package.json`: add
  `"reset:password": "pnpm --filter @realtimedocs/server run reset:password"` and
  `"cleanup": "pnpm --filter @realtimedocs/server run cleanup"`. The existing root scripts
  `db:migrate`, `bootstrap:admin` and `seed:sample` were run with arguments and pass them on.
- `.dockerignore`: add `**/.stage` (test scratch directories; they hold generated env files
  while the rehearsal runs). The Dockerfile copies named paths only, so nothing from there can
  reach an image today.

## 13. Known gaps and what was not run

Not run:

- The Compose project with its default name and ports (`realtimedocs`, 4310 / 54310) and
  `pnpm setup:env` / `pnpm db:up` against the real root `.env`: not started, to stay inside the
  server agent's port range and not to create a root `.env` under other agents. The same
  `docker-compose.yml`, `Dockerfile` and `scripts/init-env.mjs` were run with other project
  names, ports and `--file`.
- A deployment behind a TLS reverse proxy (`TRUST_PROXY`, `Secure` cookies, HSTS, `wss`). The
  configuration logic is unit-tested; no proxy was put in front of the server.
- Browser tests of the web app against this server, and the desktop app: other agents' suites.
- Load or capacity measurements. `COLLAB_MAX_CONNECTIONS=1000` is a limit, not a measured
  capacity.
- An `amd64` image: the host builds and runs `linux/arm64` only.
- `scripts/backup.sh` and `scripts/restore.sh` on macOS or Windows. They are bash scripts and
  were run on Linux only (they fall back to `shasum` where `sha256sum` is missing; that path was
  not executed).

Known gaps:

- One server process only. Collaboration tickets, rate limits, the live-connection registry and
  the in-memory documents are per process (architecture section 10).
- No email: invitations are links an administrator hands over; a forgotten password is reset by
  the operator command.
- Search covers titles only. Lists are capped (500 documents per view, 500 audit events) and not
  paginated, as in the contract.
- A client that collected more than `LIMIT_MAX_COLLAB_MESSAGE_BYTES` (4 MiB) of offline changes
  cannot send them in one frame; the connection is closed with 1009 and the work stays in the
  client's recovery draft.
- `reset-password` and any other change made directly in the database reach open collaboration
  connections only with the next sweep (30 s by default).
- Backups are whole dumps: no scheduling, rotation, encryption or point-in-time recovery is
  provided. An asset that the retention job deletes between the dump and the archive of the same
  backup run is missing from that backup; such an asset had been unreferenced for the whole
  grace period.
- Attachments are stored and served as opaque downloads; they are not scanned for malware.
- The retention job reads every document state to collect asset references; its cost grows with
  the number and size of documents and was not measured.
- No metrics endpoint; observability is the structured log, `/api/health` and `/api/ready`.
- Argon2id parameters are fixed in code. A hash with other parameters is replaced at the next
  successful sign-in.
- `.env.example` lists the Vite development origins in `ALLOWED_ORIGINS` so that `pnpm dev`
  works; a shared deployment should empty that line.

## 14. Lead addendum (2026-11-11, after the agent's final report)

- **Defect found by the lead's re-run of the integration suite and fixed.** The run ended with
  116 passed / 1 failed: `assets.test.ts > uploading > decides the type from the bytes and rejects
mismatches` reported `dimensions_too_large` instead of `content_mismatch` for a PNG cut off after
  20 bytes. Cause: `image-size` 2.1.0 reads through `new DataView(input.buffer, input.byteOffset + offset)`
  without a length bound, and the upload head came from `Buffer.concat` (Node's shared Buffer
  pool). A truncated image was therefore measured from whatever lay behind it in the pool: the
  outcome depended on unrelated memory, and the width/height in the rejection message exposed up
  to 8 neighbouring bytes per request to an authenticated editor. Demonstrated in isolation:
  unguarded, a 20-byte header inside a larger buffer of `0xff` yields `height: 4294967295`.
- **Fix:** `apps/server/src/assets/dimensions.ts` (`measureImage`) probes a private, exactly sized
  copy, where reading past the end throws; `assets/service.ts` uses it for raster and SVG probes
  and no longer imports `image-size` directly. New unit tests in `test/unit/dimensions.test.ts`
  (5 tests, including the truncated header inside a larger buffer).
- **Results after the fix (observed by the lead):** unit `pnpm exec vitest run --project server`
  195 passed / 0 failed (11 files); `assets.test.ts` integration 11 passed / 0 failed; server
  typecheck, ESLint and Prettier clean. The full integration suite is re-run in the final
  verification pass (see `docs/testing.md`).
- Root scripts added by the lead: `pnpm reset:password`, `pnpm cleanup`, `pnpm test:backup-restore`.
  `.dockerignore` now excludes `**/.stage`.

## 15. Lead additions for the public deployment and the landing page (2026-11-11)

- **HTTPS redirect behind a trusting proxy.** When `PUBLIC_ORIGIN` is `https://` and `TRUST_PROXY`
  is set, a request whose `X-Forwarded-Proto` is `http` is redirected (308) to the HTTPS origin for
  pages and refused (403) for `/api`; requests without the header (the container health check, a
  direct loopback call) are untouched. `apps/server/src/http/app.ts`; `test/integration/proxy.test.ts`
  (6 tests). This fixes the Cloudflare "blank page over plain HTTP" symptom at the origin.
- **Desktop download endpoint.** `GET`/`HEAD /download/:file` serves only the fixed names
  `realtimedocs-{windows,macos}-{x64,arm64}.zip` from `DOWNLOAD_DIR`, as an attachment with its
  length; an unknown name or an unpublished build is a 404 (no traversal, no listing).
  `apps/server/src/http/routes/download.ts`; `test/integration/download.test.ts` (5 tests). The web
  landing page probes it with `HEAD` to show a size or a "not published yet" state.
  `DOWNLOAD_DIR` is unset by default (every download shows as unavailable); the Compose deployment
  sets it to `/data/downloads` on the new `rd_downloads` volume, which is empty until the packaged
  desktop zips are copied in.
- **Container log rotation.** `docker-compose.yml` now gives `db` and `server` a json-file driver
  capped at 10 MB × 5 files.

## 16. Optional sign-up, download metadata, ticket renewal (2026-11-11)

### Self-service sign-up (`ALLOW_SIGNUP`, default `false`)

- `GET /api/meta` publishes `signupEnabled`. `POST /api/auth/signup` (`SignupRequest` ->
  `SessionResponse`, 201) answers `forbidden` while disabled and creates nothing.
- Enabled: a workspace `member` (never `admin`; the first administrator stays CLI-only, extra body
  fields are ignored), Argon2id hash as in invitation accept (hashed before the insert, so an
  existing address costs the same time), session cookie and CSRF token exactly like
  `POST /api/invitations/accept`. The new account has no document membership: documents answer
  `not_found`. The address is lower-cased; a duplicate answers `conflict` with no other detail and
  does not touch the existing account. Audit event `auth.signup` (details: `role`).
- Origin and CSRF are the generic rules for unsafe requests, with no route exception: an
  allow-listed `Origin` is required (also when absent) and a non-empty `X-RD-CSRF` header (there is
  no session token to compare yet), as for invitation accept.
- Rate limits (every attempt counts, also duplicates): `RATE_SIGNUP_PER_IP` (default 10 per client
  address per 10 min) and `RATE_SIGNUP_PER_EMAIL` (default 3 per address per hour). `.env.example`
  documents `ALLOW_SIGNUP` and both variables (commented out). Trade-off: anyone who can reach the
  server can create an account; it gets no document access until an administrator adds it.
- Code: `config.ts`, `http/rate-limits.ts`, `http/routes/{auth,meta}.ts`.

### `GET /api/downloads`

- Public, `cache-control: no-store`. Lists the names of `DOWNLOADS` (exported from
  `http/routes/download.ts`, also the allow-list of `/download/:file`) that exist as regular files in
  `DOWNLOAD_DIR`: platform, arch, `bytes`, lower-case SHA-256, `modifiedAt`, `url` = `/download/<file>`.
  `DOWNLOAD_DIR` unset or empty: `{ release: null, artifacts: [] }`.
- SHA-256 is streamed and cached per path, size and mtime (one entry per path; concurrent requests
  share one pass).
- `release` is read from `release.json` (`{ version, notes, signed }`, zod, at most 64 KiB). Absent
  file: `null`. Invalid JSON or shape: `null` plus one log warning per state of the file. A field
  the operator omits is `null`; the server never sets `signed` itself.

### Ticket renewal and long sessions (acceptance test 16)

Existing behaviour was proven; the new `long-session.test.ts` runs a server with
`COLLAB_TICKET_TTL_SECONDS=1` and sessions longer than 2.5 s. Also, `DOCUMENT_SCHEMA_VERSION` is 2
now: tests use the constant, and `collab.test.ts` has a test that a v1 ticket works, a current
editor raises the document, and a v1 ticket then answers 426 `update_required`.

| Point of test 16                                                         | Test                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tickets are single use                                                   | `collab.test.ts` "accepts a ticket exactly once"                                                                                                                                          |
| tickets expire (1 s server)                                              | `collab.test.ts` "refuses an expired ticket"                                                                                                                                              |
| access re-resolved when the ticket is used                               | `collab.test.ts` "re-resolves access when the ticket is used"                                                                                                                             |
| session older than its ticket keeps receiving updates and gets `saved`   | `long-session.test.ts` "keeps receiving updates ..."                                                                                                                                      |
| after a drop: new ticket, reconnect, old ticket refused, edits saved     | same test                                                                                                                                                                                 |
| downgrade reaches the live connection, later updates refused, no commits | `long-session.test.ts` "applies a downgrade ..." (`doc_updates` count and content unchanged); also `shares.test.ts` "a downgrade from editor to viewer ..." (short session, plus upgrade) |
| revocation closes the connection                                         | `long-session.test.ts` "closes the connection when access is revoked ..." and "... removed member ..."; `shares.test.ts` "revocation disconnects an open viewer"                          |

### Tests added

`signup.test.ts` 9 (disabled/meta, member + session + audit, no document access, duplicate, origin
and CSRF, validation, never admin, rate limits), `downloads-api.test.ts` 7, `long-session.test.ts` 4,
`collab.test.ts` +1. `exporters.test.ts` follows the new callout plain-text format (`[Tip]` line).

### Results

Unit 195 passed / integration 149 passed (15 files) / typecheck, ESLint, Prettier clean.
`test:backup-restore` did not pass: the Docker image build fails in the web stage (see the report of
the verification: `apps/web/src/features/docs/documents.ts` imports `README.md` and `docs/*.md` with
`?raw`, but the Dockerfile copies only `apps/web` and `.dockerignore` excludes `docs` and
`README.md`). Outside `apps/server`.

## 17. Lead addendum: Docker build and the web docs reader (2026-11-11)

- The web app's in-app document reader imports `README.md`, `docs/windows-client.md`,
  `docs/macos-client.md` and `docs/security.md` at build time (`?raw`). The Dockerfile's `web-build`
  stage now copies exactly those files, and `.dockerignore` re-includes the three `docs/` pages (the rest
  of `docs/` stays out of the build context).
- After that fix the lead re-ran `pnpm --filter @realtimedocs/server run test:backup-restore`: passed in
  34 s (image build, backup, restore into a second project, every comparison identical, a damaged backup
  rejected before anything is touched).
- The server agent's run on the same tree: unit 195/195, integration 149/149 (15 files, 121 s).

## Desktop releases (phase 5)

- Code: `src/releases/{store,select,range,version,index}.ts`, routes `src/http/routes/releases.ts` (latest, list,
  one release, update, `GET|HEAD /download/releases/...`, `GET /api/admin/releases`) and the legacy
  `routes/download.ts`. Migration `0004_releases.sql` (`release_download_counts`). Config
  `RATE_DOWNLOAD_PER_IP`. `GET /api/meta` is now computed per request (stable release fields).
- Tests: `test/unit/releases.test.ts` (versions, ranges, selection, rollout, store validation and path
  safety), `test/unit/publish-release.test.ts` (script, including real filesystem runs),
  `test/integration/releases.test.ts` (12 tests: 404 state, per-platform latest, hash mismatch not offered,
  header fallback with `detected`, Range 200/206/416/HEAD, counters without personal data, traversal, rollout,
  required updates, rollback, legacy flat files). The integration file uses port 4413/4414 and takes 15 s
  because the server re-reads the directory every 2 s.
- Gaps: the snapshot is per process (several instances would each hash their own copy of the files on the
  shared volume); only one `Range` is honoured (several are answered with the whole file).
