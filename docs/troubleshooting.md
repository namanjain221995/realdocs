# Troubleshooting

Symptom, cause, fix. Part 1 is for people who use the product, part 2 for the operator. Causes were read from
the code; where one was not reproduced the text says so. For incidents (outage, leak, data loss) go to
[incident-response.md](incident-response.md).

Operator commands in part 2 use the wrappers of the live deployment (`deploy/*.sh`). For another deployment use
your own Compose command.

## Part 1. Using the product

### "This document uses content that this version of RealtimeDocs does not know"

|               |                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **You see**   | A notice at the top of the editor naming what was found (for example "2 blocks of a type this version does not know: callout"), "It is kept in the document and is not shown here. Editing is paused in this window so that nothing is lost."                                         |
| **Cause**     | The document contains a node, mark or attribute that this copy of the app does not know. The usual cause is a desktop app older than the web app (a document with callouts opened in a version that predates them)                                                                    |
| **Fix**       | In the browser, reload the page to get the current version. In the desktop app, open Settings, Updates, download the new version, verify and install it ("Update RealtimeDocs" button). Editing resumes by itself when the content is gone or the app is current. Nothing was removed |
| **Not a fix** | Do not paste the content elsewhere to "repair" it; the content is intact                                                                                                                                                                                                              |

If the notice says "Part of this document does not have the structure RealtimeDocs expects", no unknown type
was found, but the structure is not editable here. Nothing was removed; an administrator can restore an earlier
version from the version history.

### Uploads show "Waiting to retry"

|           |                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cause** | A transient failure (a rate limit, a network drop or a busy server). The file goes back into the queue and is retried automatically with a growing delay (1 second doubling to 60 seconds, 8 attempts). A rate-limit answer pauses the whole queue for the time the server names. Identical files are sent once                                                                                                                                     |
| **Fix**   | Wait. If every attempt fails the placeholder shows a failed state with a retry button; use it once the cause is gone. If the server limit is too low for your use, the operator raises `RATE_UPLOAD_PER_MINUTE` (default 240). Other reasons an upload is refused for good: type not allowed or not matching the content, file too large (10 MiB image, 1 MiB SVG, 25 MiB attachment), image too large in pixels, the per-document quota of 500 MiB |

### "Saved" does not appear

| Indicator                  | Meaning and fix                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Saving..."                | The server has not yet confirmed that the latest change is stored. Wait a few seconds                                                                                                                                                             |
| "Changes pending"          | The changes are only on this device (offline or reconnecting). They are sent when the server can accept them; keep the tab open                                                                                                                   |
| An error state             | The server could not store the changes (database problem) or the document stopped accepting edits because too much was unsaved. Your work stays in the browser. Tell the operator ([incident-response.md](incident-response.md), "Saves failing") |
| Nothing is typed in at all | You may be a viewer, the document may be archived (read-only for everyone), or editing may be paused by the unsupported-content notice above                                                                                                      |

"Saved" is shown only after the database has committed the change.

### Cannot connect to the document (connection state "Reconnecting", "Update required", "Access revoked")

| What you see / the answer                                   | Cause                                                                                                                                                                                                    | Fix                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| "Update required" (HTTP 426 `update_required`)              | The app's document format is older than the document's, or older than the server's minimum (`MIN_CLIENT_SCHEMA_VERSION`)                                                                                 | Reload (web) or update the desktop app                                                                       |
| Refused with code 4400 `bad_origin` / HTTP 403 `bad_origin` | The address in the browser is not one the server trusts. `http://localhost:4310` and `http://127.0.0.1:4310` are different origins                                                                       | Use exactly the address in `PUBLIC_ORIGIN`; the operator adds extra development origins to `ALLOWED_ORIGINS` |
| Ticket errors, "Reconnecting" for a while                   | A collaboration ticket is single use and valid 60 seconds; a stale tab or a proxy that keeps a connection open too long can fail. The client asks for a new one by itself                                | Reload the tab. If it persists, the proxy is not passing WebSocket upgrades for `/collab`                    |
| "Access revoked", "Link expired"                            | The share link was revoked, rotated or has expired; the account was disabled or removed from the document                                                                                                | Ask for a new link or access                                                                                 |
| Refused with `rate_limited` or capacity errors              | Too many tickets or WebSocket connections from one address (`RATE_COLLAB_TICKET_PER_MINUTE`, `RATE_WS_UPGRADE_PER_MINUTE`), or the server is at `COLLAB_MAX_CONNECTIONS` (close code 1013 `server_busy`) | Wait for `Retry-After`; the operator checks the limits and `rd_ws_connections_total{outcome}`                |
| "Document unavailable"                                      | The document was moved to the trash or deleted                                                                                                                                                           | An administrator can restore it from the trash within 30 days                                                |

### An interview link says the session is closed, ended or expired

| Message                                        | Cause                                                                                            | Fix                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "This interview has ended." (`session_closed`) | The session was completed, cancelled or archived. The candidate's link is revoked at that moment | A completed or cancelled session cannot be reopened (updates are accepted only while it is `scheduled` or `in_progress`). Create a new session through the API. Interviewers keep read-only access until their links expire                     |
| Link expired (410)                             | The session's `expiresAt` passed                                                                 | `PATCH /api/v1/interview-sessions/<id>` with a new `expiresAt` (in the future and not more than 90 days away). The update moves the expiry of every link that is not revoked, expired ones included. Works only while the session is not closed |
| Link no longer works after "rotate"            | Rotating revokes the old link and issues a new one that is returned once                         | Use the new link; rotate again if it was lost                                                                                                                                                                                                   |
| The participant was removed                    | `DELETE .../participants/<id>` revokes the link                                                  | Add the person again; they get a new link                                                                                                                                                                                                       |

### A candidate cannot export the document

The server answers 403 on export and on the desktop handoff for a candidate unless the session allows it:
`permissions.candidateCanExport` is `false` by default. The web app also hides the controls. To allow it,
`PATCH /api/v1/interview-sessions/<id>` with `{"permissions": {"candidateCanExport": true}}`; it is applied to open
connections. Interviewers can export. `candidateCanShare` has no effect ([known-limitations.md](known-limitations.md)).

### The download button says there is no release

"Release not published" or "No release published for <platform> yet" is the honest state: the operator has not
published a file for that platform, or the file failed verification (name, size or SHA-256 does not match the
manifest) and is not offered. Phones and tablets are told the app is not available for the device. An
administrator can see what the server found, with problems, at `/admin/releases`. Publishing steps:
[desktop-release.md](desktop-release.md).

### The desktop app says "Update required"

The app is older than the server's `minimumSupportedClientVersion`, or its document format or protocol is
incompatible. Open Settings, Updates; "Download update" saves the verified file to your Downloads folder
("Show in folder"). The app never installs updates by itself. Unsaved work stays on your computer. If no update
is offered, the operator has not published one ([desktop-release.md](desktop-release.md)).

### Print margins look different

The page setup now belongs to the document: the default is A4 with 25.4 mm (1 inch) margins on every side, and
the print view uses the document's own settings (paper size, orientation, margins). Change them with "Page
setup" or the ruler. A server that predates page settings sends none, and the print view falls back to the
defaults. Only A4 and Letter exist; the paper colour is not printed ([known-limitations.md](known-limitations.md)).

### The version history page is empty

| Cause                                                         | Fix                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| The document has not been edited since the upgrade            | History starts at the first change after the upgrade ("History starts here"). Earlier changes cannot be shown            |
| You are not allowed to see it (candidate, interviewer, guest) | Only people who manage the document (administrators) see it; the server refuses others                                   |
| `HISTORY_ENABLED=false`                                       | Nothing new is recorded. Turn it on; the next time the document is opened with history on, a new starting row is written |
| Edits were made while the server was rolled back              | Saved but not recorded; a new starting row appears when the newer server next opens the document                         |
| A filter hides everything                                     | Clear the editor, operation and date filters. Administrative events are hidden while an editor or operation filter is on |
| Old history was removed                                       | `HISTORY_RETENTION_DAYS` is above 0; the page says how many days are kept                                                |

## Part 2. Operating the server

### `/api/ready` answers 503

| Cause                                              | Check and fix                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL does not answer (2 second timeout)      | `deploy/logs.sh db`, `deploy/logs.sh server`, `deploy/status.sh`; see "Database down or disk full" in [incident-response.md](incident-response.md)      |
| Redis does not answer (only if `REDIS_URL` is set) | Check the Redis container and password. Open documents keep saving meanwhile ([scaling.md](scaling.md))                                                 |
| The instance is stopping                           | Normal during a stop or restart: readiness turns 503 first so a balancer stops sending new connections; `/api/health` stays 200 until the process exits |

`/api/health` is 200 while the process runs and checks nothing else.

### `/metrics` answers 404

`METRICS_TOKEN` is not set (the endpoint is off), or the `Authorization: Bearer <token>` header is missing or
wrong (the answer is the same 404 on purpose). Set a token of at least 24 characters, restart
(`deploy/up.sh`), and scrape every instance directly, not the balancer ([observability.md](observability.md)).
`/metrics` is not under `/api`; it needs no cookie.

### The server refuses to start: "The database is at schema version N, which is newer than this server (M). Upgrade the server."

The database has migration records the server's image does not contain, for example after you started an older
image on the migrated database. The migrations of the enterprise upgrade only add things, so the older server
can run once the records are parked. Follow "Roll back / The application only" in
[upgrade-and-rollback.md](upgrade-and-rollback.md): `deploy/rollback/park-schema.sql` with `keep=` the schema
version of the image you return to. Do not edit `schema_migrations` by hand otherwise, and do not restore a
backup unless data itself is wrong.

### The server refuses to start: `relation "..." already exists`

The newer server found its migration records missing (parked by `park-schema.sql`) and tried to apply the
migrations again over tables that exist. Nothing is damaged. Run `deploy/rollback/unpark-schema.sql` first, then
start the newer server:

```sh
deploy/exec.sh db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < deploy/rollback/unpark-schema.sql
deploy/up.sh
```

(The database container must be running; `deploy/exec.sh` cannot reach a stopped one.)

### "Migration ... was changed after it was applied"

An applied migration file differs from its recorded checksum. Restore the original file from the version that
applied it. Migration files are never edited after release.

### The second instance cannot forward sockets

Symptoms: clients that reach instance B for a document owned by A are closed (code 1013 `server_busy`), or
rejected (4400 `bad_origin`). Causes read from `src/collab/server.ts` and `src/cluster/cluster.ts`; not reproduced:

| Check                                                      | Why                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLUSTER_INTERNAL_URL` on every instance                   | It is the address **other instances** use to reach this one (for example `http://server2:4310`). The default is `http://<hostname>:<RD_PORT>`, which may not resolve from another container. Never a public address |
| `PUBLIC_ORIGIN` and `ALLOWED_ORIGINS` identical everywhere | The forwarded socket keeps the client's `Origin`; the owner checks it against its own list and closes with `bad_origin` if they differ                                                                              |
| `SESSION_SECRET` identical everywhere                      | The instances authenticate forwarded sockets with a key derived from it                                                                                                                                             |
| Clocks within 30 seconds                                   | The internal header carries a timestamp that is refused when it is too far from the owner's clock                                                                                                                   |
| Redis reachable by all and the same `REDIS_URL`            | Ownership leases and tickets live there; `rd_redis_up` in `/metrics`                                                                                                                                                |

A forwarding failure is logged at debug level ("forwarded collaboration socket failed"); set `LOG_LEVEL=debug`
temporarily to see it.

### All sockets land on one instance

With nginx as the balancer, worker processes counted connections separately until a `zone` line was added to
`deploy/scale/nginx.conf` (`zone realtimedocs 64k;`, found and fixed in the compose trial of 2026-11-12). Check
that the line is present in your copy. `rd_ws_connections` and `rd_ws_forwarded_connections` per instance show
the split. Sockets that land on a non-owner are forwarded to the owner by design, so "served by one" can also be
normal for a single busy document.

### "Rate limited" (HTTP 429)

The answer carries `Retry-After`. The limit depends on what was being done:

| What                           | Variable                                                                                        | Default and window                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Sign-in                        | `RATE_LOGIN_PER_IP`, `RATE_LOGIN_PER_EMAIL` (and 10x the latter per account from all addresses) | 20 per 5 min, 8 per 15 min, 80 per 15 min     |
| Share link                     | `RATE_SHARE_EXCHANGE_PER_IP`, `RATE_SHARE_EXCHANGE_PER_GRANT`                                   | 30, 20 per 5 min                              |
| Invitation                     | `RATE_INVITE_PER_IP`                                                                            | 20 per 10 min                                 |
| Sign-up                        | `RATE_SIGNUP_PER_IP`, `RATE_SIGNUP_PER_EMAIL`                                                   | 10 per 10 min, 3 per hour                     |
| "Open in Desktop" code         | `RATE_DESKTOP_REDEEM_PER_IP`                                                                    | 20 per 5 min                                  |
| Collaboration tickets          | `RATE_COLLAB_TICKET_PER_MINUTE`                                                                 | 120 per minute                                |
| Uploads                        | `RATE_UPLOAD_PER_MINUTE`                                                                        | 240 per minute (the editor waits and retries) |
| WebSocket connections          | `RATE_WS_UPGRADE_PER_MINUTE` (per instance)                                                     | 120 per minute                                |
| All API requests per address   | `RATE_API_PER_MINUTE`                                                                           | 1200 per minute                               |
| Service API key                | `RATE_API_KEY_PER_MINUTE`                                                                       | 600 per minute                                |
| Failed API key authentications | none (fixed)                                                                                    | 60 per 5 min per address                      |
| Release file downloads         | `RATE_DOWNLOAD_PER_IP`                                                                          | 60 per 10 min                                 |

If everyone is limited at once, the server probably sees one client address (the proxy's): set `TRUST_PROXY` to
the number of proxies in front of it. If Redis is configured but unreachable, limits stop applying instead of
blocking. The limit that blocks one person is raised only after you know it is not an attack.

### Webhook deliveries fail or are `dead`

Open `/admin/webhooks` and look at the deliveries of the endpoint, or `GET /api/v1/webhooks/<id>/deliveries`.
Each delivery shows `status` (`pending`, `failed`, `delivered`, `dead`), the last status code and the last error.

| Last error / status                                     | Cause and fix                                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "The endpoint secret cannot be decrypted."              | `SESSION_SECRET` changed after the endpoint was created. Delete the endpoint and create it again; give the receiver the new secret                                                                     |
| A message about the URL (non-public address, not https) | Production accepts only https URLs that resolve to public addresses, checked at registration and again at connect time. Fix the URL or the receiver's DNS                                              |
| Status code 3xx                                         | Redirects are not followed and count as failure. Register the final URL                                                                                                                                |
| Status code 4xx or 5xx, timeout                         | The receiver answered with an error or took longer than `WEBHOOK_TIMEOUT_MS` (10 s). Fix the receiver; deliveries retry after 1 min, 5 min, 30 min, 2 h, 6 h, 24 h and then become `dead` (7 attempts) |
| `dead`                                                  | Retry manually after the receiver works: "Retry" in `/admin/webhooks` or `POST /api/v1/webhooks/deliveries/<deliveryId>/retry` (starts a fresh schedule)                                               |
| Nothing is sent at all                                  | `WEBHOOK_POLL_MS=0` on every instance turns the worker off; or the endpoint is disabled or does not subscribe to the event type                                                                        |

The receiver must verify the signature with the raw body and deduplicate on the event id ([webhooks.md](webhooks.md)).

### Docker build fails on a `?raw` import

Symptom: the web build stage fails resolving `.../README.md?raw` or `.../docs/<name>.md?raw` (for example "Could
not resolve" or "ENOENT"). The web app bundles five files for its in-app reader: `README.md`,
`docs/windows-client.md`, `docs/macos-client.md`, `docs/linux-client.md` and `docs/security.md`
(`apps/web/src/features/guides/documents.ts`). The `Dockerfile` copies exactly those files into the web build
stage, and `.dockerignore` excludes the rest of `docs/` (`docs/*`) except the four `!docs/...` lines.

Fix: a file imported in `documents.ts` must also be in the `COPY` line of the `Dockerfile` and re-included in
`.dockerignore`; and none of them may be renamed or removed without changing all three places. The build context
must also contain `README.md` (it is not ignored).

### `vite dev` talks to the production server

By default the Vite dev server proxies `/api` and `/collab` to `http://127.0.0.1:4310`. On the host that runs
the live deployment, that is the live server. Set `RD_API_PROXY=off` to remove the proxy (the browser tests do
this), or `RD_API_TARGET=http://127.0.0.1:<port>` to point it at your own server. Do not develop against the
live deployment ([README.md](../README.md), "Development workflow").

### The server will not start after a configuration change

The start-up check names the variable that is wrong and prints no secret, for example "REDIS_URL must start
with redis:// or rediss://", "METRICS_TOKEN must be at least 24 characters", "CLUSTER_INTERNAL_URL must be an
origin such as http://server-1:4310", "SESSION_SECRET must be at least 32 characters long". Fix that variable
([deployment.md](deployment.md#environment-reference)).

### Sign-in works but actions fail with `csrf_failed` after a deploy

`SESSION_SECRET` was changed: the anti-forgery token is derived from it. Reload the tab
([deployment.md](deployment.md#rotating-session_secret)).
