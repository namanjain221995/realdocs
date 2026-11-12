# RealtimeDocs on this server

This directory runs RealtimeDocs with Docker on this server and publishes it at
**https://realdocs.techsarasolutions.com** through your Cloudflare Tunnel.

First started on 2026-11-11 at 02:19 local time (2026-11-10 20:49 UTC).
The section "What was checked" at the end says what was observed that day and what was not.

## What runs where

Three containers in one Docker Compose project named `realtimedocs`, plus the separate
`realtimedocs-volume-guard` container described in "Volume guard" below:

| Container               | What it is                                        | Port on this server | Data                            |
| ----------------------- | ------------------------------------------------- | ------------------- | ------------------------------- |
| `realtimedocs-db-1`     | PostgreSQL 17.11                                  | `127.0.0.1:54310`   | volume `realtimedocs_rd_pgdata` |
| `realtimedocs-server-1` | RealtimeDocs: web app, API and live collaboration | `127.0.0.1:4310`    | volume `realtimedocs_rd_assets` |
| `realtimedocs-tunnel-1` | Cloudflare Tunnel connector (cloudflared)         | none                | none                            |

Images: `postgres:17.11-alpine`, `realtimedocs-server:local` (built from this repository by
`deploy/up.sh`) and `cloudflare/cloudflared:2026.9.3`.

- Both ports are bound to `127.0.0.1`: they can be reached from this server only, not from
  the network. The tunnel container publishes no port; it only makes outgoing connections
  to Cloudflare.
- **Your data lives in the two Docker volumes.** `realtimedocs_rd_pgdata` is the database
  (accounts, documents, history, audit trail). `realtimedocs_rd_assets` holds uploaded
  images and attachments. Removing a container does not touch them; removing a volume
  deletes the data for good.
- All three containers are set to restart on their own after a crash and when Docker
  starts (`restart: unless-stopped`; Docker is enabled at boot on this server).

How a request travels:

```
browser --HTTPS--> Cloudflare --encrypted tunnel--> realtimedocs-tunnel-1 --plain HTTP--> realtimedocs-server-1:4310
```

Cloudflare ends the HTTPS (TLS) connection: the certificate your browser sees is the one
Cloudflare holds for your domain, and Cloudflare can read the traffic. The tunnel from
Cloudflare to this server is encrypted by cloudflared. The last hop, from the tunnel
container to the server container, is plain HTTP inside a private Docker network on this
server and never leaves the machine.

## Files in this directory

| File                        | Purpose                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `.env.production`           | Settings of the database and the server, with two generated secrets. Mode 600. |
| `.env.tunnel`               | The Cloudflare Tunnel connector token. Mode 600.                               |
| `docker-compose.tunnel.yml` | Adds the `tunnel` container to the project's `docker-compose.yml`.             |
| `up.sh`                     | Build and start, or update after a change.                                     |
| `down.sh`                   | Stop and remove the containers. Keeps the data.                                |
| `status.sh`                 | Containers, local health, public health.                                       |
| `logs.sh`                   | Container logs.                                                                |
| `exec.sh`                   | Run a command inside a container (operator commands).                          |
| `lib.sh`                    | Shared by the scripts; not run on its own.                                     |
| `checks/ws-check.mjs`       | Tests that a WebSocket reaches the collaboration endpoint through Cloudflare.  |
| `checks/browser-check.mjs`  | Opens the public address in a headless browser and reports what it sees.       |

The scripts work from any directory. **Always use them** instead of typing
`docker compose ...` yourself: they pass the right env file and both compose files.

## Everyday commands

```sh
deploy/status.sh                  # is everything up? (exit status 0 = yes)
deploy/logs.sh server             # last 200 log lines of the server
deploy/logs.sh tunnel --follow    # follow the tunnel log
deploy/logs.sh all --since 10m    # all three, last ten minutes
```

### Deploy again after a code change

```sh
deploy/up.sh
```

It builds the server image from the files in this repository **as they are at that
moment**, replaces only the containers whose image or settings changed, and returns when
the database and the server report healthy. Pending database migrations are applied when
the server starts. Expect an interruption of a few seconds (measured: the public address
answered an error for about one second while the server restarted). Take a backup first
when the change is a large one.

The same command applies a changed setting in `.env.production` or `.env.tunnel`.

### Stop without losing data

```sh
deploy/down.sh
```

It stops and removes the three containers and their network and keeps both data volumes.
`deploy/up.sh` brings everything back with the same data.

> **Never run `docker compose down -v` (or `--volumes`) on this project, and never
> `docker volume rm` one of the two volumes.** That deletes every account and document.
> While the deployment is stopped its volumes count as unused, so
> `docker volume prune --all` would delete them as well.

Also do not run `docker compose ...`, `pnpm db:up` or `pnpm db:down` from the repository
root on this server. Those commands address the same project name, `realtimedocs`. Without
a `.env` file in the repository root they stop with an error; with one, they would replace
the live database and server containers with differently configured ones. (The data would
survive and `deploy/up.sh` would put things right, but the site would be down until then.)

### Create the first administrator

```sh
deploy/exec.sh server realtimedocs bootstrap-admin --email <address> --name "<name>" --generate
```

The command prints a generated password **once**; note it down. It refuses to run when an
account already exists. Further people are added from inside the app with invitation links.

The same command without the wrapper, run from the repository root:

```sh
RD_COMPOSE_ENV_FILE=deploy/.env.production docker compose --env-file deploy/.env.production \
  -f docker-compose.yml -f deploy/docker-compose.tunnel.yml \
  exec server realtimedocs bootstrap-admin --email <address> --name "<name>" --generate
```

A forgotten password is replaced with
`deploy/exec.sh server realtimedocs reset-password --email <address> --generate`.

### Back up

```sh
scripts/backup.sh --env-file deploy/.env.production
```

Run it from the repository root. It writes a new directory
`backups/realtimedocs-<UTC timestamp>/` with `database.dump`, `assets.tar.gz`,
`SHA256SUMS` and `manifest.json`. Add `--out <directory>` to write somewhere else, for
example to another disk. The site keeps running during a backup.

- A backup contains password hashes and the content of every document. Keep it private.
- Nothing runs backups automatically. Run the command by hand or from cron, and copy the
  result off this server: a backup on the same disk does not survive a disk failure.
- The two env files are not part of a backup and are not needed to restore one.

Restoring is done with `scripts/restore.sh` and **replaces** the data of the deployment it
is pointed at. Read section 9 of `docs/notes/server.md` before using it. A restore has not
been run against this deployment.

## Cloudflare settings

The public address is a "published application" route of the tunnel. It exists already;
these are the values, in case it has to be created again
(Cloudflare dashboard, the tunnel, **Add published application**):

| Field       | Value                   |
| ----------- | ----------------------- |
| Subdomain   | `realdocs`              |
| Domain      | `techsarasolutions.com` |
| Path        | leave empty             |
| Service URL | `http://server:4310`    |

`server` is the name of the RealtimeDocs server inside the Docker network that the tunnel
container shares. It is `http`, not `https`, and it is not `localhost`: inside the tunnel
container `localhost` is the tunnel container itself. If the dialog asks for a type and a
URL separately, the type is `HTTP` and the URL is `server:4310`.

Three things in Cloudflare are worth changing. They were found on 2026-11-11 and can only
be changed in your Cloudflare account:

1. **Plain HTTP is not redirected to HTTPS.** `http://realdocs.techsarasolutions.com/`
   is answered over HTTP instead of being redirected. A browser that really opens the
   `http://` address shows an empty page, because the app refuses to load its scripts
   over a mix of HTTP and HTTPS. Turn on "Always Use HTTPS" for the zone, or add a
   redirect rule for this hostname. Until then, give people the `https://` address.
2. **Cloudflare adds its Web Analytics script to the page.** RealtimeDocs allows scripts
   from its own address only, so the browser refuses that script and logs one error in the
   developer console on every page load. Nothing else is affected. Turn Web Analytics off
   for this hostname to get rid of the error.
3. **Cloudflare lets browsers keep two small files for four hours.** For `/boot.js` and
   `/favicon.svg` it replaces the server's "always check for a new version" with a
   four-hour browser cache, which matches Cloudflare's default Browser Cache TTL. After a
   new deployment a browser can use the old copy of these two files for up to four hours.
   Everything else (the page itself, the application files, the API) keeps the server's
   own caching rules. Setting Browser Cache TTL to "Respect Existing Headers", for the zone
   or in a cache rule for this hostname, removes the delay.

## Secrets

| Secret                                | Where it is stored                                                       |
| ------------------------------------- | ------------------------------------------------------------------------ |
| Cloudflare Tunnel connector token     | `deploy/.env.tunnel`, line `TUNNEL_TOKEN=`                               |
| Database password                     | `deploy/.env.production`, lines `POSTGRES_PASSWORD=` and `DATABASE_URL=` |
| Session secret                        | `deploy/.env.production`, line `SESSION_SECRET=`                         |
| Passwords of accounts                 | As hashes in the database                                                |
| First administrator's sign-in details | `deploy/admin-credentials.txt`, while that file exists                   |

- These files are readable by the owner only (mode 600, in a directory of mode 700). They
  are excluded from Git (`.gitignore`) and from the Docker build (`.dockerignore`), so they
  are not inside the server image.
- `admin-credentials.txt` was added on 2026-11-11 when the first administrator was created.
  The scripts in this directory neither write nor read it. Delete it once the password is
  in your password manager or has been changed. A generated password is otherwise printed
  only once, by the command that creates it.
- Running containers receive the values of the two env files as environment variables.
  Anyone who may use Docker on this server can read them with `docker inspect`.
- Whoever has the tunnel token can run a connector for this tunnel and receive the traffic
  of its hostnames. Treat it like a password.
- **Do not edit `POSTGRES_PASSWORD` after the first start.** The database stored it when
  it was created; changing the file later only makes the server fail to connect.
  `SESSION_SECRET` may be replaced without signing anyone out (open browser tabs reload once). Since the
  enterprise upgrade it also protects stored webhook secrets and stored idempotent API responses, which
  become unreadable: re-create the webhook endpoints afterwards. See "Rotating SESSION_SECRET" in
  `docs/deployment.md`. With several instances, change it on all of them at the same time.

### Replace the tunnel token

1. In the Cloudflare dashboard, create a new token for the tunnel (rotate or refresh it).
2. In `deploy/.env.tunnel`, replace the line `TUNNEL_TOKEN=...` with `TUNNEL_TOKEN=` followed
   by the new token: one line, no quotes, no spaces. Keep the file at mode 600.
3. Run `deploy/up.sh`. It replaces the tunnel container, which then starts with the new token.
   (It also deploys the current code if that changed since the last build.)
4. Run `deploy/status.sh`. `deploy/logs.sh tunnel` should show four lines
   "Registered tunnel connection".

## Checking the deployment

```sh
deploy/status.sh
. scripts/dev-env.sh; node deploy/checks/ws-check.mjs        # WebSocket through Cloudflare, about 16 s
. scripts/dev-env.sh; node deploy/checks/browser-check.mjs   # the page in a headless browser
```

`browser-check.mjs` needs Playwright's Chromium (`pnpm exec playwright install chromium`),
or the path of another Chromium build in `RD_CHECK_BROWSER`. It lists the console error
described under "Cloudflare settings", point 2, for as long as that is not changed.

When the public address does not answer, `deploy/status.sh` shows which part fails:

- **Local checks fail too:** the server or the database is down. Look at
  `deploy/logs.sh server` and `deploy/logs.sh db`, then run `deploy/up.sh`.
- **Local checks pass, the public one answers 502:** the tunnel runs but cannot reach the
  server. This was seen for about a second during a server restart. If it lasts, run
  `deploy/up.sh`.
- **Local checks pass, the public one shows a Cloudflare error page (for example error 1033) or a 404:** the tunnel is not connected, or the route for the hostname is missing
  in Cloudflare. `deploy/logs.sh tunnel` shows the connections ("Registered tunnel
  connection") and the routes Cloudflare sent ("Updated to new configuration"). These
  cases were not seen here; the description follows Cloudflare's documentation.

## What was checked

Observed on 2026-11-11 with the deployment checks. None of them signs in, and all of them
were first run before any account existed:

- `deploy/up.sh` built the image (linux/arm64) and started the three containers; database
  and server reported healthy.
- On this server: `/api/health` and `/api/ready` answer 200; the page is served with its
  security headers (Content-Security-Policy naming `wss://realdocs.techsarasolutions.com`,
  Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy).
- The tunnel registered four connections to Cloudflare and received the route
  `realdocs.techsarasolutions.com` to `http://server:4310`. The token appears nowhere in the
  container logs or on a command line. The tunnel runs with a read-only file system, without
  Linux capabilities and with `no-new-privileges`.
- Through the public address: `/api/health` and `/api/ready` answer 200 over HTTPS with a
  valid certificate; the page and the 23 files it refers to arrive unchanged apart from the
  analytics script Cloudflare adds; a headless Chromium renders the sign-in page with no
  failed request of the site itself.
- A sign-in with wrong credentials answers 401 and sets no cookie. The session cookie is
  issued with `HttpOnly; Secure; SameSite=Lax` (seen on the cookie-clearing answer of a
  signed-out `logout` call).
- WebSocket through Cloudflare to `/collab`: the connection opens; with a foreign `Origin`
  the server closes it at once with code 4400 (`bad_origin`); with the right `Origin` it
  stays open until the server's 15-second sign-in deadline closes it with code 1008.
- The server logs the visitor's real address for requests that come through Cloudflare,
  not the tunnel container's, and ignores an `X-Forwarded-For` header sent by the visitor.
  The login rate limit therefore counts per visitor.
- Restarting the server container: the public address answered 502 for about one second,
  then 200 again; the tunnel container kept running and needed no restart.
- `deploy/down.sh` followed by `deploy/up.sh`: the volumes and the database content were
  still there.
- `scripts/backup.sh --env-file deploy/.env.production` produced a backup whose checksums
  verify (written outside the repository and deleted again).

Not covered by these checks:

- Signing in, creating and editing documents, two people editing at the same time, share
  links, uploads and downloads through Cloudflare. They need an account and are tested
  separately.
- WebSocket connections that stay open for a long time through Cloudflare (only the first
  15 seconds of an unauthenticated connection were observed).
- A reboot of this server or a restart of Docker.
- Replacing the tunnel token for real. (That `deploy/up.sh` replaces a container whose env
  file value changed was confirmed with a throw-away test project.)
- A restore into this deployment.
- Behaviour under load.

## Good to know

- **Logs are rotated** for `db` and `server` (json-file, 10 MB × 5 files, set in
  `docker-compose.yml` since 2026-11-11). The tunnel container keeps Docker's default; it logs
  little.
- **The tunnel version is pinned** to `cloudflare/cloudflared:2026.9.3` and does not
  update itself. To change it, edit the `image:` line in `docker-compose.tunnel.yml` and
  run `deploy/up.sh`.
- **cloudflared's diagnostics page** (port 20241 of the tunnel container) is reachable from
  this server and from the other two containers; no port is published for it. It shows
  connection statistics and the tunnel's routes, not the token.
- **Programs on this server** that call `http://127.0.0.1:4310` directly can pass any
  address in an `X-Forwarded-For` header, and the server will believe it, because it trusts
  one proxy in front of it. Visitors coming through Cloudflare cannot do this.

## Volume guard (added 2026-11-11)

The live deployment shares its Compose project name (`realtimedocs`) with the repository's default, so a
plain `docker compose down -v` typed in the repository root would address the live project. To make that
mistake harmless, a separate container holds both data volumes:

- `realtimedocs-volume-guard` — a running `sleep infinity` container on the Node image, with no
  network, a read-only file system, and `realtimedocs_rd_pgdata` and `realtimedocs_rd_assets` mounted
  read-only. It restarts with Docker (`--restart unless-stopped`) and uses next to no resources.
- Docker refuses to delete a volume that any container uses, so `docker compose down -v`,
  `docker volume rm …`, `docker volume prune` and `docker system prune --volumes` all leave the live data in
  place (checked on scratch volumes: "volume is in use"; the guarded volumes are not "dangling").
- `deploy/up.sh`, `deploy/down.sh`, `deploy/status.sh`, backups and restores are unaffected.
- Do not remove the guard while the deployment holds real data. Deleting the data on purpose is
  irreversible: take a backup, then `docker rm -f realtimedocs-volume-guard`, then remove the volumes.
- After the next `deploy/up.sh`, the downloads volume `realtimedocs_rd_downloads` exists too. It only holds
  rebuildable desktop builds; add it to the guard if it ever holds anything that matters.

A backup taken before the guard was added is in `backups/realtimedocs-20261110T232801Z/` (mode 700; it
contains password hashes and document content).
