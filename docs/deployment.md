# Deployment and operations

This document is for the operator who runs RealtimeDocs on a server for other people. It covers
HTTPS and WebSockets behind a reverse proxy, keeping the database and uploaded files private, every
environment variable, upgrades, backups and restore, password reset, retention, health checks, logs
and the limits of a single-server deployment. The last section lists what was and was not verified.
For a first local run, start with the [README](../README.md).

Related documents: [scaling.md](scaling.md) (running several instances behind a load balancer),
[observability.md](observability.md) (logs, `/metrics`, alerts), [upgrade-and-rollback.md](upgrade-and-rollback.md)
(rehearsal, upgrade and rollback of the live deployment), [incident-response.md](incident-response.md)
(runbooks and disaster recovery), [database-schema.md](database-schema.md) and
[security-checklist.md](security-checklist.md).

## What a deployment consists of

```text
people's browsers and desktop apps
        │  HTTPS and WSS (port 443)
        ▼
reverse proxy with a TLS certificate          ← you provide this (Caddy or nginx examples below)
        │  plain HTTP, same machine
        ▼
server container      127.0.0.1:4310   web app, /api, /collab (WebSocket)
        │
        ├── db container      127.0.0.1:54310   PostgreSQL 17, volume rd_pgdata
        └── volume rd_assets  uploaded images and attachments
```

`docker-compose.yml` defines the two containers and the three volumes (`rd_pgdata`, `rd_assets` and `rd_downloads`, the last for desktop builds). It publishes both ports on
`127.0.0.1` only.

This is the single-instance layout, which is the default and the only one the live deployment uses. With
`REDIS_URL` set, several server instances can run behind one load balancer; that layout (Redis, a second
server, an nginx balancer) is the overlay `deploy/scale/docker-compose.scale.yml` and is described in
[scaling.md](scaling.md). The server does not speak TLS (the encryption behind `https://` and `wss://`)
itself; a reverse proxy in front of it does. Without the proxy, the product is reachable from the
server machine only, which is right for a first look and wrong for anything else.

**One deployment already exists.** On the build server the product runs from the `deploy/`
directory and is published through a Cloudflare Tunnel (browser, Cloudflare, the `tunnel` container,
then the `server` container on the private Docker network) instead of a reverse proxy on the
machine.
That setup has its own guide, [deploy/README.md](../deploy/README.md), and is summarised under
[The deployment on the build server](#the-deployment-on-the-build-server) below. The commands in
"Configure and start" are for a new deployment on another machine. **Do not run them on a machine
where the `deploy/` deployment runs**: they address the same Compose project, `realtimedocs`, and
would replace its containers.

## Configure and start

Run the commands from the repository root on the server.

### 1. Create `.env` for a deployment

```sh
node scripts/init-env.mjs --public-origin https://docs.example.com
```

Replace `docs.example.com` with the name people will type. The script writes `.env` with a
generated database password and session secret, sets `PUBLIC_ORIGIN`, and leaves `ALLOWED_ORIGINS`
empty because the public origin is not a local address. It never overwrites an existing `.env`; if
you already have one from a local trial, edit these values in it by hand.

Then set the number of reverse proxies in front of the server in `.env` (one, in the setups shown
below):

```text
TRUST_PROXY=1
```

Check these four values before you go on:

| Variable          | Must be                             | Why                                                                                                                                                                                       |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN`   | `https://docs.example.com`, no path | Share links, invitation links and "Open in Desktop" links are built from it. Because it starts with `https://`, session cookies are marked `Secure` and the server sends an HSTS header   |
| `ALLOWED_ORIGINS` | empty                               | Every origin listed here may use sign-in cookies exactly like `PUBLIC_ORIGIN`. The development value from `.env.example` must not stay in a deployment                                    |
| `COOKIE_SECURE`   | unset or `auto`                     | `auto` marks cookies `Secure` when `PUBLIC_ORIGIN` is HTTPS. Do not set `false`                                                                                                           |
| `TRUST_PROXY`     | the number of proxies, usually `1`  | Rate limits and logs then use the real client address from `X-Forwarded-For`. With `false`, everybody shares the proxy's address and one person's failed sign-ins can lock out the others |

Prefer a number over `TRUST_PROXY=true`. With `true` the server believes the left-most entry of
`X-Forwarded-For`, which a client can forge if the proxy appends to the header instead of
replacing it. With a number, only the entries added by your own proxies count.

### 2. Start and create the administrator

```sh
docker compose up -d --build --wait
```

```sh
docker compose exec server realtimedocs bootstrap-admin --email you@example.com --name "Your Name" --generate
```

The second command works once. It refuses as soon as any account exists. The generated password is
printed a single time.

### Stop and start

```sh
docker compose stop
```

```sh
docker compose up -d --wait
```

`docker compose down` removes the containers and keeps the two volumes. Adding `--volumes` to it
deletes the database and every uploaded file. Never use that on a deployment you want to keep.

## HTTPS and WSS behind a reverse proxy

### What the proxy has to do

- Terminate TLS for `docs.example.com` and forward everything to `http://127.0.0.1:4310`: the web
  app, `/api/…` and `/collab`.
- Forward WebSocket upgrades for `/collab`. This is the live connection; browsers and desktop apps
  reach it as `wss://docs.example.com/collab`.
- Not close a quiet WebSocket early. The server sends a ping every 15 seconds
  (`COLLAB_PING_INTERVAL_SECONDS`) and drops a socket that has been silent for 45 seconds
  (`COLLAB_IDLE_TIMEOUT_SECONDS`), so any proxy idle timeout comfortably above 15 seconds is
  enough.
- Accept request bodies as large as the largest upload. The server takes files up to the larger of
  `LIMIT_MAX_IMAGE_BYTES` and `LIMIT_MAX_ATTACHMENT_BYTES` (25 MiB by default) plus 64 KiB of
  multipart framing. If you raise those limits, raise the proxy limit with them.
- Set `X-Forwarded-For`. It is the only forwarded header the server acts on. Whether cookies are
  marked `Secure` follows from `PUBLIC_ORIGIN`, not from a forwarded protocol header.
- Pass the `Origin` header through unchanged, which both proxies below do by default. The server
  compares it with its configured origins (`PUBLIC_ORIGIN`, `ALLOWED_ORIGINS`, `DESKTOP_ORIGINS`)
  on every state-changing request and on every WebSocket connection.
- Not cache `/api/…`. Responses there are sent with `Cache-Control: no-store`, and uploaded files
  with `private, no-cache`, so that revoked access takes effect on the next request.

The server does not compress responses. If you turn on compression in the proxy, limit it to the
static files of the web app (`/assets/…`, `/boot.js`, `/favicon.svg`), which carry no data that
belongs to a session.

Neither of the two configurations below was run on the build host. They follow the documentation
of Caddy and nginx and the behaviour of the server's code. Treat the first start as a test.

### Caddy

```caddyfile
docs.example.com {
	# Uploads: LIMIT_MAX_ATTACHMENT_BYTES (25 MiB by default) plus 64 KiB of multipart framing.
	# "MiB" matters: 26MB would be smaller than the server's own limit.
	request_body {
		max_size 26MiB
	}

	# The web app, /api and the /collab WebSocket all go to the server.
	reverse_proxy 127.0.0.1:4310
}
```

Caddy obtains and renews the certificate itself when the name resolves to the machine and ports 80
and 443 are reachable. `reverse_proxy` forwards WebSocket upgrades without further configuration
and sets `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` itself, replacing whatever a
client sent. It applies no idle timeout to a proxied WebSocket by default, so nothing needs to be
raised. If you add `stream_timeout` to `reverse_proxy`, or `read_timeout` to its `transport http`
block, keep the value far above the 15-second ping.

When Caddy reloads its configuration it closes open WebSocket connections. Clients reconnect on
their own and keep unsent edits meanwhile.

### nginx

The `map` block belongs in the `http { }` context, the two `server` blocks next to it, for example
in a file under `/etc/nginx/conf.d/`.

```nginx
# "upgrade" for WebSocket requests, "close" for everything else.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name docs.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name docs.example.com;

    # Replace with your certificate and key.
    ssl_certificate     /etc/nginx/tls/docs.example.com.fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/docs.example.com.key.pem;

    # Uploads: LIMIT_MAX_ATTACHMENT_BYTES (25 MiB by default) plus 64 KiB of multipart framing.
    client_max_body_size 26m;

    # These apply to every location below. Do not add a proxy_set_header line inside a
    # location: nginx would then drop all of these for that location.
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header Upgrade           $http_upgrade;
    proxy_set_header Connection        $connection_upgrade;

    # Live collaboration (WebSocket). The server pings every 15 seconds, so a healthy
    # connection is never silent for long; five minutes leaves a wide margin.
    location = /collab {
        proxy_pass http://127.0.0.1:4310;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # API. Uploads are handed to the server as they arrive, so its own size and type
    # checks answer first and nothing is spooled to the proxy's disk.
    location /api/ {
        proxy_pass http://127.0.0.1:4310;
        proxy_request_buffering off;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    # Web app.
    location / {
        proxy_pass http://127.0.0.1:4310;
    }
}
```

`X-Forwarded-For` is set to the address nginx itself saw, replacing anything the client sent,
which is what `TRUST_PROXY=1` expects.

### Check the result

```sh
curl -sS https://docs.example.com/api/ready
```

```sh
curl -sSI https://docs.example.com/ | grep -i -E 'strict-transport-security|content-security-policy'
```

The first must answer `{"status":"ok",…}`. The second must show both headers; a missing
`Strict-Transport-Security` means `PUBLIC_ORIGIN` is not an `https://` address. Then sign in, open
a document and type: the header must show "Live" and, after a moment, "Saved". "Reconnecting…"
that never ends usually means the proxy does not forward the WebSocket upgrade for `/collab`, or
that the address in the browser differs from `PUBLIC_ORIGIN`.

### The deployment on the build server

The deployment that runs on the build server uses neither Caddy nor nginx. It is described in
full, with its own commands and its own list of what was observed, in
[deploy/README.md](../deploy/README.md). In short:

- A third container, the Cloudflare Tunnel connector (`cloudflared`), joins the same Compose
  project through `deploy/docker-compose.tunnel.yml`. It makes outgoing connections to Cloudflare
  only and reaches the server at `http://server:4310` on the private Docker network. No further
  port is opened on the machine. A fourth container, the volume guard, holds the data volumes so
  that they cannot be deleted by accident (see [The volume guard](#the-volume-guard)).
- **TLS ends at Cloudflare.** Browsers see Cloudflare's certificate for the public name, and
  Cloudflare can read the traffic. Whether that is acceptable for your documents is a decision to
  make knowingly; see [security.md](security.md).
- Its settings are in `deploy/.env.production`, not in a root `.env`: an HTTPS `PUBLIC_ORIGIN`, an
  empty `ALLOWED_ORIGINS` and `TRUST_PROXY=1`. The connector's token is in `deploy/.env.tunnel`.
  Both files are readable by their owner only and are excluded from the Docker build.
- Use the scripts in `deploy/` there (`deploy/up.sh`, `deploy/down.sh`, `deploy/status.sh`,
  `deploy/logs.sh`, `deploy/exec.sh`) instead of typing `docker compose` yourself. Operator
  commands take the form `deploy/exec.sh server realtimedocs <command>`, and a backup is
  `scripts/backup.sh --env-file deploy/.env.production`.
- Three Cloudflare account settings were found worth changing; they are listed under
  [Cloudflare settings](#cloudflare-settings) below.
- Every redeploy follows the routine under [Redeploy routine](#redeploy-routine).

What the proxy has to do, as listed above, holds for a tunnel as well. Of those points,
`deploy/README.md` records the WebSocket connection and the client address as observed through
Cloudflare. Signing in, editing and uploading through Cloudflare are listed there as not covered
by its checks.

## Keep the database and the files private

- **Ports.** `docker-compose.yml` publishes PostgreSQL on `127.0.0.1:${RD_DB_PORT:-54310}` and the
  server on `127.0.0.1:${RD_PORT:-4310}`. Leave both bindings on `127.0.0.1`. Only the reverse
  proxy's ports 80 and 443 should be open to other machines. The server container reaches the
  database over the Compose network, not through the published port; that port exists for a server
  run on the host and for maintenance tools.
- **Database.** It holds accounts with password hashes, all document content, snapshots, sessions
  (as hashes) and the audit trail. Nobody but the server and the operator needs to reach it.
- **Uploaded files.** They live in the `rd_assets` volume under random names that are not derived
  from file names or content. The only way to read one is
  `GET /api/documents/<documentId>/assets/<assetId>`, which checks the caller's access to that
  document on every request. Do not serve the volume from the proxy, a web server, a bucket or a
  CDN: that would skip authorization and make revocation meaningless. There is no public bucket
  and no signed-URL mechanism in the product.
- **Secrets.** `.env` contains the database password and the session secret. The script creates it
  readable by its owner only. Keep it out of backups that other people can read and out of version
  control (`.gitignore` already excludes it).
- **The server runs unprivileged** inside its container (user `node`, uid 1000), and the image
  contains neither `node_modules` nor build tools.

## Desktop clients

People who use the desktop companion enter the deployment's address
(`https://docs.example.com`) under Settings → Connection in the app. The app accepts HTTPS
addresses; plain HTTP is accepted only for `localhost` and `127.0.0.1` and, behind a development
switch that is off by default, for private-network addresses.

The app's pages are served inside the app from the origin `app://realtimedocs`. The server allows
exactly the origins in `DESKTOP_ORIGINS` (default `app://realtimedocs`) to call the API across
origins, without cookies, and to open the `/collab` WebSocket. Leave the variable at its default.
An empty value means the default, not "no desktop clients".

A desktop client never signs in with a password. It holds a session for one document, obtained
through "Open in Desktop" or a pasted share link. The proxy needs nothing extra for it: the app
sends ordinary HTTPS requests (including `OPTIONS` preflight requests, which the proxy must pass
on) and one WebSocket.

"Open in Desktop" links carry `PUBLIC_ORIGIN`. A client accepts such a link only if it is set to
that same address, so tell people to enter the address exactly as they see it in the browser.

The app asks the server about new versions (`GET /api/v1/desktop/update`) and never installs one by itself;
the operator side is in [desktop-release.md](desktop-release.md). Interview candidates cannot use the desktop
handoff (the server answers 403).

## Remote development and local desktop connectivity

This section is for the setup where the repository and its services live on a remote machine that
you reach over SSH, while the presenter app runs on your own Windows PC or Mac. Nothing here
exposes a service to the network: every service stays on `127.0.0.1` of the remote machine, and
SSH carries the traffic.

Two different machines are involved, and `localhost` means a different one on each:

- the **remote host**: the SSH server, which runs PostgreSQL, the RealtimeDocs server and the web
  development server;
- your **laptop** (the Windows PC or Mac): which runs your browser and the desktop app.

The commands below that start services are for the remote host. The commands that open a tunnel,
and everything about the desktop app, are for the laptop.

None of the laptop-side steps were run on Windows or macOS by this project. The tunnel behaviour
follows from the configuration files named in each paragraph.

### A. Backend and web development on the remote host

On the remote host, from the repository root:

```sh
. scripts/dev-env.sh              # only on the build host, which keeps its toolchain in .toolchain/
pnpm install --frozen-lockfile
pnpm setup:env                    # skip if .env exists
pnpm db:up                        # PostgreSQL, 127.0.0.1:54310
pnpm bootstrap:admin --email you@example.com --name "Your Name" --generate
pnpm dev                          # server (127.0.0.1:4310) and web dev server (127.0.0.1:4311)
```

`pnpm dev` starts both halves together. To run them in two terminals, use `pnpm dev:server` and
`pnpm dev:web`. The `bootstrap:admin` command refuses once any account exists, and with
`--generate` it prints the password once; keep it.

Keep all three services on `127.0.0.1`. The defaults already do this: `RD_HOST=127.0.0.1` in
`.env`, the web dev server bound to `127.0.0.1:4311` in `apps/web/vite.config.ts`, and Docker
Compose publishing PostgreSQL on `127.0.0.1`. Do not change them to `0.0.0.0` to reach the
services from your laptop. The tunnel below makes that unnecessary.

#### Open a tunnel from the laptop

On the laptop, in PowerShell (Windows) or Terminal (macOS), forward the two ports and leave the
window open:

```sh
ssh -N -L 4310:127.0.0.1:4310 -L 4311:127.0.0.1:4311 user@host
```

Replace `user@host` with your SSH login. `-N` means "forward only, run no command". While this
runs, port 4310 and port 4311 on your laptop's `127.0.0.1` lead to the same ports on the remote
host's `127.0.0.1`. To make the command fail loudly if a local port is already taken, add
`-o ExitOnForwardFailure=yes`.

Then open **`http://127.0.0.1:4311`** in the laptop's browser. The web dev server forwards `/api`
and `/collab` to the server on its side, so the browser sees one address.

#### Why the address in the browser has to match

The server only accepts browser sessions from origins it was told about. An origin is the scheme,
the host name and the port, written exactly. The relevant settings are in `.env` (see
`.env.example` and `apps/server/src/config.ts`):

- `PUBLIC_ORIGIN` (default `http://127.0.0.1:4310`): the address people type, and the address that
  generated links (share links, invitation links, "Open in Desktop" links) start with. It is always
  trusted.
- `ALLOWED_ORIGINS` (default `http://127.0.0.1:4311,http://localhost:4311`): additional web
  origins that may use cookie sessions. This is what lets the Vite development server on port 4311
  work.
- `DESKTOP_ORIGINS` (default `app://realtimedocs`): the desktop app, see part B.

The server compares the `Origin` header of every state-changing request and of every WebSocket
connection with these lists. So:

- **`localhost` and `127.0.0.1` are different origins.** To a browser, `http://localhost:4311` and
  `http://127.0.0.1:4311` are not the same site, even though they lead to the same machine. Both
  are listed in the default `ALLOWED_ORIGINS`, but cookies are kept per host name: if you open
  `localhost` after signing in on `127.0.0.1`, you are not signed in. Pick one and use it
  everywhere.
- **The port is part of the origin.** The tunnel must use the same port numbers on the laptop as on
  the remote host (`4311:…:4311`, not `8080:…:4311`). With a different local port the browser sends
  `http://127.0.0.1:8080` as its origin, which is not in any list, and sign-in or the live
  connection is refused. Vite's port is also fixed (`strictPort`), so it cannot move to another
  free port. If you really must use another local port, add the exact origin to `ALLOWED_ORIGINS`
  in `.env` on the remote host and restart the server.
- **Links point at `PUBLIC_ORIGIN`.** Share links and invitation links start with
  `http://127.0.0.1:4310`. Forwarding 4310 as well makes those links work on the laptop. In
  development, replace the port with 4311 to get the web dev server, or run `pnpm build` once so
  that port 4310 serves the built web app as well.

If the page loads but sign-in or the "Live" indicator fails, compare the address in the browser's
address bar with those three settings first.

### B. Desktop app on a local Windows or Mac computer

The presenter app has to run on the machine whose screen you share, so it cannot run over SSH. It
needs a desktop session. There are two ways to get it.

**Install an artifact built for that platform.** Use a package built for Windows or macOS, as
described in [windows-client.md](windows-client.md) and [macos-client.md](macos-client.md). A
package cross-built on Linux is unsigned and was never started on Windows or macOS; a macOS package
should be built on a Mac.

**Or build and run it from source on the laptop.** First get the sources there without the folders
that were built for Linux. This example assumes `ssh` and `tar` are available on both machines
(recent Windows and macOS include them). Run the first command on the remote host through SSH,
replacing `/path/to` with the directory that contains the repository folder:

```sh
ssh user@host "cd /path/to && tar -czf /tmp/realtimedocs-src.tgz --exclude=node_modules --exclude=dist --exclude=out --exclude=.stage --exclude=.toolchain --exclude=backups --exclude=.env --exclude=.env.production --exclude=.env.tunnel realtimedocs"
scp user@host:/tmp/realtimedocs-src.tgz .
tar -xzf realtimedocs-src.tgz
```

The `--exclude` options also keep `.env` and the deploy env files, which hold secrets, off your
laptop. (Copy to a file with `scp` rather than redirecting `ssh` output: PowerShell can alter
binary data that is redirected.)

Then, with Node.js 24.22.2 installed (the version in `.node-version`):

**Windows (PowerShell), in the repository folder:**

```powershell
corepack enable
pnpm --version
pnpm install --frozen-lockfile
pnpm --filter @realtimedocs/desktop run test
pnpm --filter @realtimedocs/desktop run dev
```

To produce a package instead of running from source: `pnpm --filter @realtimedocs/desktop run package:win`, then `pnpm --filter @realtimedocs/desktop run inspect-package`.

**macOS (Terminal), in the repository folder:**

```sh
corepack enable
pnpm --version
pnpm install --frozen-lockfile
pnpm --filter @realtimedocs/desktop run test
pnpm --filter @realtimedocs/desktop run dev
```

To produce a package instead: `pnpm --filter @realtimedocs/desktop run package:mac`, then
`pnpm --filter @realtimedocs/desktop run inspect-package`.

`corepack enable` makes the pnpm version named in `package.json` available, and `pnpm --version`
should print `12.18.0`. The root shortcut `pnpm desktop:dev` does the same as the `dev` command
above. The development run keeps its settings in its own folder (`apps/desktop/.stage/dev-profile`)
and does not touch the settings of an installed app. All desktop scripts are listed in
`apps/desktop/package.json`: `dev`, `build`, `icons`, `package`, `package:win`, `package:mac`,
`package:mac:universal`, `package:linux`, `inspect-package`, `test`, `test:smoke`, `test:real`,
`test:packaged` and `typecheck`.

#### Tell the app where the backend is

In the app, open Settings → Connection, enter the address under "Server address" and choose "Save
and check". Which address depends on where the backend is:

- **A backend reached through the SSH tunnel:** `http://127.0.0.1:4310`, with the tunnel from part
  A open. Plain HTTP is accepted here because the host is loopback. `localhost` on the laptop is
  the laptop itself: it reaches the remote backend only because the tunnel forwards that port.
  Without the tunnel the status line says "Server could not be reached".
- **A deployed backend:** its HTTPS address exactly as the browser shows it, for example
  `https://docs.example.com`.

#### Why the origins have to line up

- The desktop app's pages are served inside the app from the origin `app://realtimedocs`. The
  server lets only the origins in `DESKTOP_ORIGINS` call it from there, and open the `/collab`
  WebSocket. The default, `app://realtimedocs`, is right; keep it. An empty value means the
  default.
- "Open in Desktop" links carry `PUBLIC_ORIGIN`. The app accepts such a link only if the server
  address it is configured with is that same address. With the tunnel above, `PUBLIC_ORIGIN` is
  `http://127.0.0.1:4310` and so is the address in the app, so they agree. For a deployed backend,
  enter the address exactly as it appears in `PUBLIC_ORIGIN`.

#### HTTPS, WSS and trusted certificates

The app accepts HTTPS addresses. It accepts plain HTTP only for loopback addresses (`localhost` and
`127.0.0.1`), which is how an SSH tunnel appears. Anything else, such as `http://192.168.1.20:4310`
or a public host name over HTTP, is refused, unless you turn on the clearly labelled development
switch "Development: allow plain HTTP to private-network addresses" for a private-network address.
Plain HTTP to a public host is never accepted. With HTTP, documents and your session cross the
network unencrypted, so do not use the switch outside a test setup.

When the page is served over HTTPS, the live connection must be secure too: the app and browsers
reach `/collab` as `wss://…`, which the reverse proxy has to forward (see part C).

If the backend is not on loopback but you want to try it over HTTPS before it has a real
certificate, the certificate has to be trusted by the laptop's operating system. A self-signed or
private-CA certificate is not trusted until you install its certificate authority in the laptop's
trust store (a local development certificate tool such as `mkcert` does this). A search of the app's
code found no setting that accepts an untrusted certificate, so do not expect the app to offer a
"continue anyway" choice. That the operating system's trust store is what the app consults on
Windows and macOS was not verified by this project. Install a development authority on your own
machine only, and remove it when you are done.

Only trusted origins belong in `PUBLIC_ORIGIN`, `ALLOWED_ORIGINS` and `DESKTOP_ORIGINS`. Every
origin listed in `ALLOWED_ORIGINS` is trusted like `PUBLIC_ORIGIN` itself, so leave that list empty
in a deployment that other people use, as `pnpm setup:env --public-origin https://…` does.

### C. A deployed environment with HTTPS and WSS

For a deployment that other people use, do not tunnel. Put a TLS-terminating reverse proxy in front
of the server and set `PUBLIC_ORIGIN` to its `https://` address. The requirements, example Caddy
and nginx configurations and the checks are in
[HTTPS and WSS behind a reverse proxy](#https-and-wss-behind-a-reverse-proxy) above. The deployment
on the build server, which uses a Cloudflare Tunnel instead, is in
[deploy/README.md](../deploy/README.md).

## Environment reference

Names and defaults come from `.env.example` and `apps/server/src/config.ts`. A missing or invalid
value stops the server at start-up with a message that names the variable and never prints a
secret. `GET /api/meta` publishes the effective limits.

In a Compose deployment, `docker-compose.yml` fixes some values inside the server container
whatever `.env` says: `NODE_ENV=production`, `RD_HOST=0.0.0.0`, `RD_PORT=4310`,
`ASSET_DIR=/data/assets`, `WEB_DIST_DIR=/app/web`, `DOWNLOAD_DIR=/data/downloads`, and a
`DATABASE_URL` that points at the `db` container.

### Required

| Variable            | Default | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_PASSWORD` | none    | Compose only. Password of the database user `realtimedocs`. It is placed inside a connection address, so use letters and digits                                                                                                                                                                                                                                                                                                            |
| `SESSION_SECRET`    | none    | At least 32 characters and not repetitive. Root key for four things: the per-session anti-forgery (CSRF) token, the encryption of webhook signing secrets, the encryption of stored idempotent API responses, and the key that authenticates sockets forwarded between instances. Changing it signs nobody out, but it has side effects: see [Rotating `SESSION_SECRET`](#rotating-session_secret). It must be identical on every instance |
| `DATABASE_URL`      | none    | `postgres://user:password@host:port/database`. Required when the server runs on the host. The Compose server container ignores the value in `.env` and uses its own                                                                                                                                                                                                                                                                        |

### Addresses and trust

| Variable          | Default                      | Meaning                                                                                                                                                                                 |
| ----------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN`   | `http://127.0.0.1:<RD_PORT>` | The address people use, without a path. Generated links, `Secure` cookies and HSTS follow from it                                                                                       |
| `ALLOWED_ORIGINS` | empty                        | Further web origins that may use cookie sessions, comma separated. `.env.example` lists the two development origins; leave it empty in a deployment                                     |
| `DESKTOP_ORIGINS` | `app://realtimedocs`         | Origins of packaged desktop apps. They get cross-origin API access with bearer tokens only, never cookies                                                                               |
| `COOKIE_SECURE`   | `auto`                       | `auto`, `true` or `false`. `auto` marks cookies `Secure` when `PUBLIC_ORIGIN` is HTTPS                                                                                                  |
| `TRUST_PROXY`     | `false`                      | `false`, `true`, or the number of trusted proxies (0 to 16; `0` means `false`). Use the number: with `true` the left-most `X-Forwarded-For` entry is believed, which a client can forge |
| `RD_HOST`         | `127.0.0.1`                  | Listen address of a server run on the host                                                                                                                                              |
| `RD_PORT`         | `4310`                       | Listen port of a server run on the host; in Compose, the port published on `127.0.0.1`. The server exits if the port is taken                                                           |
| `RD_DB_PORT`      | `54310`                      | Compose only. Port on `127.0.0.1` where PostgreSQL is published                                                                                                                         |

### General

| Variable                    | Default             | Meaning                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | `development`       | `development`, `production` or `test`                                                                                                                                                                                                                                                                                                          |
| `LOG_LEVEL`                 | `info`              | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                                                                                                                                                                                                                                                                                 |
| `AUTO_MIGRATE`              | `true`              | Apply pending database migrations at start-up                                                                                                                                                                                                                                                                                                  |
| `ASSET_DIR`                 | `data/assets`       | Private directory for uploaded files. With several instances: the same shared storage on all of them                                                                                                                                                                                                                                           |
| `WEB_DIST_DIR`              | `apps/web/dist`     | Built web app. It is served only when `index.html` exists there; otherwise the server offers the API only                                                                                                                                                                                                                                      |
| `MIN_CLIENT_SCHEMA_VERSION` | `1`                 | Oldest document format a client may speak. Older clients are told to update                                                                                                                                                                                                                                                                    |
| `ALLOW_SIGNUP`              | `false`             | `true` lets anyone who can reach the server create a member account (no document access until an administrator adds it). Off by default                                                                                                                                                                                                        |
| `DOWNLOAD_DIR`              | unset               | Directory with the desktop releases (`releases/`, `channels/`, or the legacy flat files), served under `/download/` and listed by `/api/downloads` and `/api/v1/desktop/releases`. Unset: nothing is offered. Compose sets `/data/downloads` (volume `rd_downloads`). With several instances it must be the same shared storage on all of them |
| `RD_ENV_FILE`               | `<repository>/.env` | Environment file read by the server and the operator commands when they run on the host. Real variables win over it                                                                                                                                                                                                                            |

### Session lifetimes (seconds)

| Variable                           | Default   | Meaning                                                                    |
| ---------------------------------- | --------- | -------------------------------------------------------------------------- |
| `SESSION_TTL_SECONDS`              | `1209600` | Signed-in accounts: longest lifetime (14 days)                             |
| `SESSION_IDLE_TTL_SECONDS`         | `259200`  | Signed-in accounts: ends after this long without activity (3 days)         |
| `SHARE_SESSION_TTL_SECONDS`        | `604800`  | Share-link guests: longest lifetime (7 days), never past the link's expiry |
| `SHARE_SESSION_IDLE_TTL_SECONDS`   | `86400`   | Share-link guests: idle limit (1 day)                                      |
| `DESKTOP_SESSION_TTL_SECONDS`      | `2592000` | Desktop sessions: longest lifetime (30 days)                               |
| `DESKTOP_SESSION_IDLE_TTL_SECONDS` | `1209600` | Desktop sessions: idle limit (14 days)                                     |

### Limits (bytes unless noted)

| Variable                           | Default     | Meaning                                                                                                    |
| ---------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `LIMIT_MAX_IMAGE_BYTES`            | `10485760`  | Largest inline image (10 MiB)                                                                              |
| `LIMIT_MAX_ATTACHMENT_BYTES`       | `26214400`  | Largest download-only attachment (25 MiB)                                                                  |
| `LIMIT_MAX_SVG_BYTES`              | `1048576`   | Largest SVG image (1 MiB). Must not exceed `LIMIT_MAX_IMAGE_BYTES`                                         |
| `LIMIT_MAX_IMAGE_PIXELS`           | `40000000`  | Largest image area in pixels, read from the image header                                                   |
| `LIMIT_MAX_IMAGE_DIMENSION`        | `12000`     | Largest image width or height in pixels                                                                    |
| `LIMIT_DOCUMENT_ASSET_QUOTA_BYTES` | `524288000` | Stored files per document (500 MiB)                                                                        |
| `LIMIT_MAX_DOCUMENT_STATE_BYTES`   | `8388608`   | Soft limit (8 MiB): a warning is logged when a stored document is larger. No edit is refused because of it |
| `LIMIT_MAX_COLLAB_MESSAGE_BYTES`   | `4194304`   | Largest WebSocket frame on `/collab` (4 MiB)                                                               |
| `LIMIT_MAX_JSON_BODY_BYTES`        | `262144`    | Largest JSON request body (256 KiB)                                                                        |

### Retention

| Variable                              | Default | Meaning                                                                            |
| ------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `TRASH_RETENTION_DAYS`                | `30`    | Trashed documents are deleted for good after this many days                        |
| `ASSET_GRACE_DAYS`                    | `30`    | An uploaded file is deleted after being unreferenced this long                     |
| `PENDING_UPLOAD_HOURS`                | `24`    | Unfinished uploads and stale temporary files are removed after this long           |
| `PRE_RESTORE_SNAPSHOT_RETENTION_DAYS` | `90`    | Automatic snapshots taken before a restore. Named snapshots are kept until deleted |
| `AUDIT_RETENTION_DAYS`                | `365`   | Audit events                                                                       |
| `SESSION_RETENTION_DAYS`              | `30`    | Rows of ended or expired sessions                                                  |
| `CLEANUP_INTERVAL_MINUTES`            | `360`   | Minutes between retention runs inside the server. `0` turns the timer off          |
| `HISTORY_RETENTION_DAYS`              | `0`     | Version history rows (see [History](#version-history)). `0` keeps everything       |

No variable limits the age of webhook deliveries, API keys, interview sessions or their participants;
nothing removes them (see [database-schema.md](database-schema.md)).

### Collaboration endpoint

| Variable                        | Default    | Meaning                                                                    |
| ------------------------------- | ---------- | -------------------------------------------------------------------------- |
| `COLLAB_MAX_CONNECTIONS`        | `1000`     | Open WebSockets per server process. A limit, not a measured capacity       |
| `COLLAB_MAX_QUEUE_BYTES`        | `16777216` | Unsaved update bytes per document before it stops accepting edits (16 MiB) |
| `COLLAB_FRAME_BURST`            | `1500`     | Frames one socket may send in a burst                                      |
| `COLLAB_FRAMES_PER_SECOND`      | `300`      | Sustained frames per second per socket                                     |
| `COLLAB_TICKET_TTL_SECONDS`     | `60`       | Lifetime of a connection ticket. Cannot be raised above 60                 |
| `COLLAB_PING_INTERVAL_SECONDS`  | `15`       | Seconds between pings from the server                                      |
| `COLLAB_IDLE_TIMEOUT_SECONDS`   | `45`       | A silent socket is closed after this long                                  |
| `COLLAB_SWEEP_INTERVAL_SECONDS` | `30`       | How often every open connection is re-checked against the database         |
| `COLLAB_COMPACT_AFTER_UPDATES`  | `200`      | Saved update rows of an open document before its log is compacted          |

### Database

| Variable                  | Default | Meaning                           |
| ------------------------- | ------- | --------------------------------- |
| `DB_POOL_MAX`             | `10`    | Connections in the pool           |
| `DB_STATEMENT_TIMEOUT_MS` | `15000` | Longest single statement          |
| `DB_LOCK_TIMEOUT_MS`      | `5000`  | Longest wait for a lock           |
| `DB_CONNECT_TIMEOUT_MS`   | `5000`  | Longest wait for a new connection |

### Multi-instance coordination, shutdown and metrics

All optional. Without `REDIS_URL` the server runs alone and none of the cluster settings are used. Details
and the failure behaviour are in [scaling.md](scaling.md); metrics are in [observability.md](observability.md).

| Variable                    | Default                       | Meaning                                                                                                                                                                                                                                                                              |
| --------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REDIS_URL`                 | unset                         | `redis://` or `rediss://` address. Setting it turns on coordination: document ownership leases, shared collaboration tickets, shared rate-limit counters, revocation messages. Put a password in it; Redis becomes a trust root (see [security-checklist.md](security-checklist.md)) |
| `CLUSTER_INTERNAL_URL`      | `http://<hostname>:<RD_PORT>` | Origin (`http(s)://host[:port]`, no path) at which the **other instances** reach this one on the private network. Never a public address                                                                                                                                             |
| `CLUSTER_LEASE_TTL_SECONDS` | `10`                          | 3 to 300. After an instance dies without saying goodbye, its documents can be taken over this many seconds later                                                                                                                                                                     |
| `SHUTDOWN_DRAIN_SECONDS`    | `0`                           | 0 to 120. Time between `/api/ready` turning 503 and the sockets being closed on a stop. Set it a little above the load balancer's health-check interval. Keep the container's stop grace period longer than this                                                                     |
| `METRICS_TOKEN`             | unset                         | At least 24 characters. Enables `GET /metrics` for `Authorization: Bearer <token>`. Unset: `/metrics` answers 404                                                                                                                                                                    |

### Version history

| Variable                   | Default | Meaning                                                                                                                                                                                                                      |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HISTORY_ENABLED`          | `true`  | Record the attributed history. With `false` nothing new is recorded; existing rows stay readable. A document edited while it is off gets a new starting point ("History starts here") when it is next opened with history on |
| `HISTORY_CHECKPOINT_EVERY` | `500`   | 1 to 1,000,000. History rows after which a compaction also stores a complete checkpoint. Smaller: faster revision views, more storage                                                                                        |
| `HISTORY_RETENTION_DAYS`   | `0`     | 0 to 36,500. Days of history kept; `0` keeps everything. Rows are removed only in front of the newest checkpoint older than the limit, so actual retention can be longer                                                     |

### Webhooks

| Variable                         | Default                        | Meaning                                                                                                                                     |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEBHOOK_POLL_MS`                | `2000`                         | How often each instance looks for due deliveries. `0` turns the worker off on that instance (events are still queued)                       |
| `WEBHOOK_TIMEOUT_MS`             | `10000`                        | 100 to 120,000. An unanswered attempt is abandoned after this long                                                                          |
| `WEBHOOK_RETRY_SCHEDULE_SECONDS` | `60,300,1800,7200,21600,86400` | Seconds to wait after the 1st, 2nd, ... failed attempt (each 0 to 604,800). One more failure after the last entry marks the delivery `dead` |

### Rate limits

Without `REDIS_URL` the counters live in the memory of the server process and start again when it
restarts. With `REDIS_URL` they are kept in Redis and are the same whichever instance a request reaches,
except `RATE_WS_UPGRADE_PER_MINUTE`, which stays per instance. **When Redis cannot be reached, a limiter
lets the request through** and logs a warning ("rate limit could not be counted; request allowed"). A caller over
a limit gets status 429 with a `Retry-After` header.

| Variable                        | Default | Counted                                                                                                                                                                      | Window     |
| ------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `RATE_LOGIN_PER_IP`             | `20`    | Failed sign-ins per client address                                                                                                                                           | 5 minutes  |
| `RATE_LOGIN_PER_EMAIL`          | `8`     | Failed sign-ins per email address from one client address. A second limit, ten times this value (80 by default), counts failures for the account from all addresses together | 15 minutes |
| `RATE_SHARE_EXCHANGE_PER_IP`    | `30`    | Failed share-link exchanges per client address                                                                                                                               | 5 minutes  |
| `RATE_SHARE_EXCHANGE_PER_GRANT` | `20`    | Failed share-link exchanges per link                                                                                                                                         | 5 minutes  |
| `RATE_INVITE_PER_IP`            | `20`    | Failed invitation look-ups and accepts per client address                                                                                                                    | 10 minutes |
| `RATE_DESKTOP_REDEEM_PER_IP`    | `20`    | Failed "Open in Desktop" redemptions per client address                                                                                                                      | 5 minutes  |
| `RATE_COLLAB_TICKET_PER_MINUTE` | `120`   | Connection tickets per session                                                                                                                                               | 1 minute   |
| `RATE_UPLOAD_PER_MINUTE`        | `240`   | Uploads per session (raised from 60; the editor waits and retries instead of failing)                                                                                        | 1 minute   |
| `RATE_WS_UPGRADE_PER_MINUTE`    | `120`   | WebSocket connections per client address                                                                                                                                     | 1 minute   |
| `RATE_API_PER_MINUTE`           | `1200`  | All API requests per client address                                                                                                                                          | 1 minute   |
| `RATE_API_KEY_PER_MINUTE`       | `600`   | Requests per service API key on `/api/v1`                                                                                                                                    | 1 minute   |
| `RATE_DOWNLOAD_PER_IP`          | `60`    | Desktop release file downloads (GET) per client address                                                                                                                      | 10 minutes |
| `RATE_SIGNUP_PER_IP`            | `10`    | Sign-up attempts per client address (counted only when `ALLOW_SIGNUP=true`)                                                                                                  | 10 minutes |
| `RATE_SIGNUP_PER_EMAIL`         | `3`     | Sign-up attempts per email address (counted only when `ALLOW_SIGNUP=true`)                                                                                                   | 1 hour     |

One limit has no variable: failed API key authentications are throttled at 60 per client address per 5
minutes.

### Read by Docker Compose only

| Variable              | Default                     | Meaning                                                                                                                                                           |
| --------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RD_COMPOSE_ENV_FILE` | `.env`                      | Environment file handed to the server container. The backup and restore scripts set it                                                                            |
| `RD_IMAGE`            | `realtimedocs-server:local` | Name of the server image                                                                                                                                          |
| `RD_BUILD_TARGET`     | `runtime`                   | `runtime` builds the image with the web app; `server-runtime` builds API and collaboration only                                                                   |
| `REDIS_PASSWORD`      | none                        | Only with the scale overlay `deploy/scale/docker-compose.scale.yml`, which refuses to start without it. Used for the Redis `--requirepass` and inside `REDIS_URL` |
| `RD_LB_PORT`          | `4460`                      | Only with the scale overlay. Port on `127.0.0.1` where the nginx balancer is published                                                                            |

### Docker image and the bundled documents

The server image contains the web app, and the web app bundles five Markdown files at build time (`?raw`
imports in `apps/web/src/features/guides/documents.ts`) for its in-app reader at `/guides/:name`:
`README.md`, `docs/windows-client.md`, `docs/macos-client.md`, `docs/linux-client.md` and `docs/security.md`.
The `Dockerfile` copies exactly those files into the web build stage, and `.dockerignore` excludes the rest of
`docs/` (`docs/*`, then `!docs/windows-client.md`, `!docs/macos-client.md`, `!docs/linux-client.md`,
`!docs/security.md`). If a bundled document is added or renamed, change `documents.ts`, the `COPY` line and the
`.dockerignore` exception together; otherwise the image build fails (see
[troubleshooting.md](troubleshooting.md)). The links in a bundled document that point to a file that is not
bundled are shown as plain text in the reader.

## Publish desktop downloads

The server offers the packaged desktop apps at `/download` and on the landing page, but it never
builds or signs them: the operator publishes them as files. The complete guide (layout, manifest,
signing flags, rollout, rollback, CI) is [desktop-release.md](desktop-release.md); this section is the
short operational version. **Until something is published the site says "Release not published" and
offers no link, and that is the honest state.**

**Versioned releases (current method).** Build, then publish with the operator script into a staging
directory and copy that into the `rd_downloads` volume (`DOWNLOAD_DIR`, `/data/downloads` in the
container; `realtimedocs_rd_downloads` in the live deployment):

```sh
node scripts/publish-release.mjs apps/desktop/out --channel stable --notes-file NOTES.md --target ./release-staging
# Not run on this host. Copy the new version directory first, the channel pointer last:
docker cp ./release-staging/releases/. realtimedocs-server-1:/data/downloads/releases/
docker cp ./release-staging/channels/. realtimedocs-server-1:/data/downloads/channels/
```

- Files must be named `RealtimeDocs-<version>-<windows|macos|linux>-<arch>.<ext>`; the packaging
  scripts now produce exactly those names.
- Pass `--signed-windows` / `--notarized-macos` only for files that really are. Without the flags
  every Windows and macOS file is recorded as unsigned, and the page says "Unsigned build — Windows
  SmartScreen / macOS Gatekeeper will warn you". The server never infers signing.
- Releases are immutable and previous ones stay on disk; roll back with `--rollback <version>`; a staged
  rollout is `--rollout <percent>`.
- The server re-reads the directory every couple of seconds, checks name, size and SHA-256 of every
  file, and offers only what verifies. `GET /api/admin/releases` and the page `/admin/releases` (signed
  in as an administrator) show what it found, with problems and download counts.
- `RATE_DOWNLOAD_PER_IP` (default 60 downloads per client address per 10 minutes) limits file downloads.

**Legacy flat files (still served).** The four names `realtimedocs-windows-x64.zip`,
`realtimedocs-windows-arm64.zip`, `realtimedocs-macos-arm64.zip` and `realtimedocs-macos-x64.zip` in the
top of `DOWNLOAD_DIR`, with an optional `release.json` (`{"version","notes","signed"}`), keep working at
`/download/<file>` and in `GET /api/downloads`, so the live site does not change until you publish a
versioned release. Once a current stable release with verified files exists, `/api/downloads` is fed
from it instead. Migration: publish a versioned release, check `/download`, then delete the flat files.

Do not publish zips built on the Linux server as "ready to use": the Windows and macOS packages made
there are unsigned and have never been started on those systems, and the cross-built Apple Silicon app
cannot start until it is signed on a Mac ([macos-client.md](macos-client.md)). People can compare the
SHA-256 on the page with their download (`Get-FileHash` on Windows, `shasum -a 256` on macOS,
`sha256sum` on Linux); the checksum proves the file is the one on the server, not who built it.

## Cloudflare settings

These apply to the live deployment, which is published through a Cloudflare Tunnel; the values for the
published-application route are in [deploy/README.md](../deploy/README.md). Three settings in the
Cloudflare account were found worth changing on 2026-11-11. They can only be changed there, and they
are **still open** as far as the project's records show:

1. **Always Use HTTPS.** Plain HTTP at the public name was not redirected. A browser that really
   opens the `http://` address shows an empty page, because the app refuses to load its scripts over
   a mix of HTTP and HTTPS. The server now redirects such requests itself when the proxy reports them
   as plain HTTP (308 to the HTTPS origin; 403 for the API; see [security.md](security.md)); after the
   redeploy of 2026-11-11 a plain-HTTP request to the live site was observed to answer 308
   ([status.md](status.md)). Still, turn on "Always Use HTTPS" for the zone (or add a redirect rule for
   the hostname) so that the redirect happens at the edge too.
2. **Web Analytics injection.** Cloudflare adds its Web Analytics script to the page. The content
   security policy allows scripts from the site's own address only, so the browser refuses it and
   logs one console error on every page load. Nothing else is affected. Turn Web Analytics off for
   the hostname to remove the error; do not loosen the policy.
3. **Browser Cache TTL.** Cloudflare replaces the server's "always check for a new version" for
   `/boot.js` and `/favicon.svg` with a four-hour browser cache. After a deployment a browser can use
   the old copy of those two files for up to four hours. Set Browser Cache TTL to "Respect Existing
   Headers", for the zone or in a cache rule for the hostname.

## The volume guard

The live deployment shares its Compose project name (`realtimedocs`) with the repository's default.
A plain `docker compose down -v` typed in the repository root would therefore address the live
project and delete its data. To make that mistake harmless, a separate container holds the data
volumes (`deploy/README.md`, "Volume guard"):

- `realtimedocs-volume-guard` is a running `sleep infinity` container with no network, a read-only
  file system, and `realtimedocs_rd_pgdata` and `realtimedocs_rd_assets` mounted read-only. It
  restarts with Docker.
- Docker refuses to delete a volume that any container uses, so `docker compose down -v`,
  `docker volume rm`, `docker volume prune` and `docker system prune --volumes` all leave the live
  data in place (checked on scratch volumes: "volume is in use").
- `deploy/up.sh`, `deploy/down.sh`, `deploy/status.sh`, backups and restores are unaffected.
- **Do not remove the guard while the deployment holds real data.** To delete the data on purpose,
  which is irreversible: take a backup, then `docker rm -f realtimedocs-volume-guard`, then remove the
  volumes.
- The downloads volume `realtimedocs_rd_downloads` holds only rebuildable desktop builds and is not
  guarded; add it to the guard if it ever holds anything that matters.

The guard protects against a mistyped command, not against someone who removes the guard first, a
disk failure or a compromised host. Keep backups ([backup-and-restore.md](backup-and-restore.md)).

## Redeploy routine

Use this routine for the deployment in `deploy/` after a code change. Every step has a command that
exists; the sequence as a whole was run once, on 2026-11-11 ([status.md](status.md)).

1. **Gates.** Before building, on a machine with the toolchain (`. scripts/dev-env.sh`): the
   type checks, the unit tests, lint and formatting.

   ```sh
   . scripts/dev-env.sh
   pnpm typecheck && pnpm test && pnpm lint && pnpm format:check
   ```

   Run the integration tests as well (`pnpm test:integration`, needs Docker; it uses its own
   containers and ports) when server code changed.

2. **Backup** (and, for a release that contains a migration, a rehearsal and a tag of the running image;
   see [upgrade-and-rollback.md](upgrade-and-rollback.md)). From the repository root, before anything is
   replaced:

   ```sh
   scripts/backup.sh --env-file deploy/.env.production
   ```

   It writes `backups/realtimedocs-<UTC timestamp>/` and the site keeps running. Copy it off the
   machine; it contains password hashes and all document content.

3. **Deploy.**

   ```sh
   deploy/up.sh
   ```

   It builds the server image from the files as they are at that moment, replaces only the
   containers whose image or settings changed, applies pending migrations when the server starts,
   and returns when the database and the server report healthy. The volumes are untouched. Expect an
   interruption of a few seconds.

4. **Verify.**

   ```sh
   deploy/status.sh
   . scripts/dev-env.sh; node deploy/checks/ws-check.mjs        # WebSocket through Cloudflare, about 16 s
   . scripts/dev-env.sh; node deploy/checks/browser-check.mjs   # the page in a headless browser
   ```

   Then open the public address, sign in and open a document. The checks do not sign in. The
   browser check lists the Web Analytics console error for as long as Cloudflare setting 2 above
   is open.

Never run `docker compose ...`, `pnpm db:up` or `pnpm db:down` from the repository root on the
machine that runs the live deployment, and never `docker compose down -v`.

## Upgrades and migrations

The database schema is changed by numbered SQL files in `apps/server/migrations/`. Four exist
(`0001_init.sql`, `0002_service_api.sql`, `0003_history.sql`, `0004_releases.sql`; the tables are in
[database-schema.md](database-schema.md)). With `AUTO_MIGRATE=true`, the default, the server applies pending
files at start-up, each in its own transaction and under a database lock, so that two processes cannot
migrate at once. It records a checksum of every applied file and refuses to start if an applied
file was changed afterwards. Migrations 0002 to 0004 only add tables and columns and widen one `CHECK`
constraint, so the previous server version can keep running on the migrated database after the migration
records are parked. Rehearse on a backup copy first, and use the rollback steps, in
[upgrade-and-rollback.md](upgrade-and-rollback.md); for the live deployment follow that guide rather than the
generic steps below.

To upgrade a Compose deployment:

1. Take a backup (next section).
2. Replace the source tree with the new version. Keep `.env`.
3. Rebuild and restart:

   ```sh
   docker compose up -d --build --wait
   ```

During the restart, open documents show "Reconnecting…". The server tells clients that it is
shutting down and writes out what is queued; clients keep every edit that was not yet confirmed as
saved and send it again after they reconnect.

Things to know:

- **There are no down migrations.** A server refuses to start against a database that records a
  migration it does not know ("The database is at schema version N, which is newer than this server (M).
  Upgrade the server."). To run an older server on a migrated database, park the newer migration records
  with `deploy/rollback/park-schema.sql` ([upgrade-and-rollback.md](upgrade-and-rollback.md)); restoring the
  backup from step 1 is the last resort and loses everything written since.
- With `AUTO_MIGRATE=false` the server only checks the schema version and refuses to start when it
  does not match. The migrations are then applied with `realtimedocs migrate` (host form:
  `pnpm db:migrate`). This mode was not exercised in a Compose deployment.
- The web app is part of the server image, so browsers get the new version on their next page
  load. Desktop apps are installed separately. A desktop app that is too old for a document is told
  so and shows "Update required" instead of opening it.
- The upgrade from schema version 1 to 4 was rehearsed on a copy of a production backup in throw-away
  containers (`scripts/rehearse-migration.sh`), not on the live deployment ([upgrade-and-rollback.md](upgrade-and-rollback.md)).

## Backups and restore

Backing up and restoring is done with `scripts/backup.sh` and `scripts/restore.sh`. The details are
in [backup-and-restore.md](backup-and-restore.md): what a backup contains, the exact commands for
the default project and for another project name or env file, checksum verification, restoring
into an empty target, rehearsing a restore beside a live system, and what is not covered.

Three points to keep in mind here:

- A backup contains password hashes and the full content of every document. Store it encrypted
  and access-controlled.
- Nothing is scheduled, rotated or encrypted for you, and there is no point-in-time recovery (WAL
  archiving is not configured). Restoring on a new host and what to do first when data loss is suspected
  are in [incident-response.md](incident-response.md).
- Never run `docker compose down -v` on a live project: it deletes the database and the uploaded
  files.

For the deployment in `deploy/`, the backup command is
`scripts/backup.sh --env-file deploy/.env.production`.

## Reset a password

The product sends no email, so there is no "forgot password" link. The operator sets a new
password:

```sh
docker compose exec server realtimedocs reset-password --email you@example.com --generate
```

`--generate` prints a new password once. Without it, the command asks at a hidden prompt. To pass a
password from a script, pipe it in and add `-T` and `--password-stdin`:

```sh
printf '%s' "$NEW_PASSWORD" | docker compose exec -T server realtimedocs reset-password --email you@example.com --password-stdin
```

Here `NEW_PASSWORD` is a shell variable of your own that holds the new password (at least 12
characters).

The command stores a new password hash, ends every session of that account and writes an audit
event. It refuses an unknown or disabled account. Requests with an old session fail at once; a
document that the person has open is disconnected at the server's next periodic check, at most
`COLLAB_SWEEP_INTERVAL_SECONDS` (30 seconds) later.

On a server that runs on the host, the same command is `pnpm reset:password` with the same options.

## Rotating `SESSION_SECRET`

`SESSION_SECRET` is no longer only the key of the anti-forgery token. Replacing it (edit the env file,
then `deploy/up.sh` for the live deployment) has these effects, read from the code:

| Used for                                                         | Effect of changing it                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anti-forgery (CSRF) token of a signed-in session                 | The token changes. Sessions stay valid (session tokens are random and stored as hashes). A tab opened before the change sends the old token and is refused until the page is reloaded                                                                                                                |
| Webhook endpoint signing secrets                                 | The stored secrets cannot be decrypted. Every delivery to those endpoints fails with the recorded error "The endpoint secret cannot be decrypted." until each endpoint is deleted and created again (a new secret is shown once and must be given to the receiver)                                   |
| Stored responses of idempotent `POST /api/v1/interview-sessions` | A replay of a key used in the last 24 hours reads a response that can no longer be decrypted. The code does not catch that error, so the caller can receive an internal error instead of the stored result. Not tested. Access links of the original response are not recoverable from it either way |
| Authentication of forwarded sockets between instances            | Instances with different values cannot forward sockets to each other. Change all instances together, not one by one                                                                                                                                                                                  |

Nothing else is encrypted with it. Share link, invitation, API key and session secrets are random values
stored as SHA-256 hashes, independent of `SESSION_SECRET`.

## Retention and cleanup

The retention job runs inside the server every `CLEANUP_INTERVAL_MINUTES` (six hours by default;
the first run is ten minutes after start-up). It can also be run by hand, and prints a report in
JSON:

```sh
docker compose exec server realtimedocs cleanup
```

What it removes, with the default periods:

- Documents that have been in the trash for 30 days, with their snapshots and files.
- Uploaded files that neither the live document nor any snapshot has referred to for 30 days. A
  file is deleted only after two runs have found it unreferenced, a full grace period apart, so
  undo, reconnecting clients and snapshot restores still find their images.
- Uploads that never finished, after 24 hours.
- Automatic pre-restore snapshots after 90 days. Named snapshots stay until an administrator
  deletes them.
- Rows of ended sessions after 30 days, "Open in Desktop" codes a day after they expired, audit
  events after 365 days.
- Stored idempotency records of the service API, 24 hours after they were created.
- Version history, only when `HISTORY_RETENTION_DAYS` is above 0 (default: nothing is removed).

Nothing removes webhook deliveries, API keys, interview sessions or participants; see
[database-schema.md](database-schema.md). With several instances, every instance runs the timer, and the
database lock lets only one run at a time.

With `CLEANUP_INTERVAL_MINUTES=0` the timer is off; run the command above from cron instead. Two
runs at the same time are safe: the second one reports that it was skipped.

## Health endpoints

| Endpoint          | Answer                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health` | 200 while the process runs. Checks nothing else. The container's own health check uses it                                                                              |
| `GET /api/ready`  | 200 `{"status":"ok"}` when PostgreSQL answers, Redis answers (only if `REDIS_URL` is set) and the instance is not shutting down. Otherwise 503 `{"status":"degraded"}` |
| `GET /api/meta`   | Product name, version, document format versions, the public origin, the effective limits and the desktop client version fields. Public                                 |
| `GET /metrics`    | Prometheus text. 404 unless `METRICS_TOKEN` is set and sent as `Authorization: Bearer <token>`. Not under `/api`: no cookie, no session, no rate limit                 |

`/api/ready` checks the database and Redis with a 2 second timeout each. From the moment a stop begins
(`SIGTERM`) it answers 503, which is the signal for a load balancer to stop sending new connections; the
sockets are closed after `SHUTDOWN_DRAIN_SECONDS`. With Redis configured and unreachable it answers 503 while
open documents keep saving ([scaling.md](scaling.md)). The metric names, alerts and the dashboard layout are in
[observability.md](observability.md).

## Logs

The server writes one JSON object per line to standard output:

```sh
docker compose logs -f server
```

Each request line carries a request id that the server generates itself; the same id is returned in
the `x-request-id` response header and in error messages, so a person can quote it to you.

What the logs deliberately leave out: request bodies, document content, passwords, password hashes,
share-link and invitation secrets, session tokens, cookies, `Authorization` headers and the
anti-forgery header. Values of address parameters whose names look sensitive are masked. The
start-up line lists the configuration without secrets and without database credentials.

Administrative and security events (sign-ins and failed sign-ins, password changes, invitations,
membership changes, share links created, changed, used, revoked or rotated, snapshot operations,
rejected uploads with active content) are also stored in the database as an audit trail, without
document content, and shown to administrators under "People" → "Audit log".

The operator commands write their result to standard output and their log to standard error. Metrics,
recommended alerts and the tracing status (not implemented) are in [observability.md](observability.md).

`docker-compose.yml` gives the `db` and `server` containers the `json-file` log driver capped at
10 MB for 5 files each, so container logs do not grow without bound. (The "Logs are not rotated"
remark in `deploy/README.md` predates this setting.)

## Scaling boundary

**Default: one server process.** Without `REDIS_URL` these things live in the memory of that process: the
open documents and their ordered write queues, connection tickets, rate-limit counters and the list of live
connections used to disconnect people when access is revoked. This is how the live deployment runs.

**Optional: several instances.** With `REDIS_URL` on every instance, instances share document ownership
(a Redis lease; a socket that lands on a non-owner is forwarded to the owner), tickets, rate-limit counters and
revocation messages. Requirements, failure behaviour, the rolling deployment and what was verified are in
[scaling.md](scaling.md). The limits that remain:

- Redis is a dependency of new collaboration connections. Open documents keep saving without it.
- `ASSET_DIR` and `DOWNLOAD_DIR` must be the same shared storage on every instance; there is no S3-compatible
  storage adapter.
- Instances on different hosts, a network file system, TLS between instances and Redis Sentinel or Cluster
  were not verified.
- `RATE_WS_UPGRADE_PER_MINUTE` is counted per instance.

`COLLAB_MAX_CONNECTIONS=1000` is a per-process safety limit. Measured capacity, if any, is in
[load-test-report.md](load-test-report.md); no number from it is repeated here.

## What was and was not verified

Results are recorded in [testing.md](testing.md) and, for the deployment in `deploy/`, in
[deploy/README.md](../deploy/README.md); this list only says what kind of evidence exists.
Everything was done on the build host: Ubuntu 24.04 on arm64, Docker 29.6.2, Docker Compose v5.2.0.

**Run on the build host**

- The `Dockerfile`, `docker-compose.yml` and `scripts/init-env.mjs`, under other project names and
  ports than the defaults: image build for `linux/arm64`, `docker compose up -d --build --wait`,
  the readiness endpoint, the web app served with a content security policy header, the server
  running as uid 1000, `bootstrap-admin` with `--password-stdin` and `seed-sample` inside the
  container.
- `scripts/backup.sh` and `scripts/restore.sh`, through the rehearsal described above.
- Server unit tests, including the configuration rules (`Secure` cookies derived from the public
  origin, origin parsing, the client address behind trusted proxies) and integration tests against
  a real PostgreSQL container and a real server process.
- **The deployment in `deploy/`**, under the project name `realtimedocs` and the default ports,
  published through a Cloudflare Tunnel since 2026-11-11. Its guide records, as observed that day
  and before any account existed: health and readiness through the public HTTPS address, the
  security headers including HSTS, the attributes of the session cookie, a WebSocket to `/collab`
  through Cloudflare that is closed for a foreign `Origin`, the visitor's real address in the
  server log with a forged `X-Forwarded-For` ignored, a restart of the server container, stopping
  and starting with the data kept, and a backup. It also lists what its checks do not cover:
  signing in, editing, share links and uploads through Cloudflare, long-lived WebSocket
  connections, a reboot, a restore into that deployment, and load.

**Not run**

- The first-run path with a `.env` in the repository root, exactly as the README gives it.
- **The Caddy and nginx examples in this document.** They were never started. The only setup with
  TLS in front of the server that ran is the Cloudflare Tunnel deployment above, and only to the
  extent its guide states.
- An `amd64` image. The host builds and runs `linux/arm64` only.
- The backup and restore scripts on macOS or Windows.
- A server started with `AUTO_MIGRATE=false`, an upgrade between two versions, and running
  `cleanup` from cron.
- The hidden password prompt of `bootstrap-admin` and `reset-password` through
  `docker compose exec`; the rehearsal pipes the password in.
- Load or capacity measurements are reported in [load-test-report.md](load-test-report.md), not here.
- Several instances: verified on this host as described in [scaling.md](scaling.md); not on the live deployment.
- Copying desktop builds into the downloads volume: the commands under "Publish desktop downloads"
  were not run, and the live site has no build published.
- The volume guard was checked on scratch volumes (Docker refused to delete a volume in use), not by
  trying to delete the live volumes.
- Desktop apps on Windows or macOS against any server.
