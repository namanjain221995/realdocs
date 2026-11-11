# RealtimeDocs

This file is for a technically capable person who has never seen the project and starts from an
empty directory. It says what the product is, how to get a first working document with Docker
Compose, how the product is used day to day, and where everything else is documented.

## What it is

RealtimeDocs is a self-hosted product for rich documents that update live for everyone who has
them open, with a desktop presenter panel for private meeting notes. It has three parts:

- **A server** (Fastify for the HTTP API, Hocuspocus and Yjs for live collaboration, PostgreSQL for
  storage, a private directory for uploaded files). It also serves the web app.
- **A web app** (React) with a public landing page, sign-in, invitations and optional sign-up, a
  dashboard, the document editor and viewer, sharing controls, snapshots, exports and account
  administration. A share link opens in any modern browser, so the browser is also the fallback for
  people without the desktop app.
- **A desktop app** (Electron) for Windows and macOS. A document opens either in a normal window or
  in **Private Presenter Mode**: a small, frameless, see-through panel that floats above other
  applications, can be collapsed, hidden or made click-through (with a way back that is always
  available), and by default asks the operating system to leave it out of screen capture. It has a
  Privacy Test Center for recording what a second participant actually saw.

An administrator creates a document, lets colleagues edit it, and hands out links. People who open
a link see the document at once and see later edits without reloading. A link is view-only unless
the administrator explicitly creates it with edit access. The rich editor includes tables, code
blocks, images, Mermaid diagrams and callouts.

**A live deployment exists** at <https://realdocs.techsarasolutions.com>, published through a
Cloudflare Tunnel from the build server. How it is run is in [deploy/README.md](deploy/README.md).
It publishes no desktop build yet: the download section of its landing page says so.

## What it is not

- **It is not a way to hide content from a meeting or a recording.** The desktop panel has an
  optional "private mode" that asks the operating system to leave RealtimeDocs' own windows out of
  screen capture. That is a request to the operating system, not proof of what another participant
  sees. On macOS, Electron documents that applications using ScreenCaptureKit capture the window
  despite the request. A browser tab has no capture exclusion at all. Read
  [docs/capture-compatibility.md](docs/capture-compatibility.md) before relying on it.
- **The desktop app has not been run on Windows or macOS.** It was built and exercised on a
  headless Linux server only (Electron under Xvfb, a virtual display), and the Windows and macOS
  packages and the Windows installers were built there and inspected as files. Every native
  behaviour on those systems (the see-through panel, the tray and menu-bar items, shortcuts,
  omission from the taskbar and Dock, several monitors, installers, signing, notarization) is
  recorded as `NOT TESTED` until someone runs the checklists in
  [docs/windows-client.md](docs/windows-client.md) and [docs/macos-client.md](docs/macos-client.md).
  No meeting application (Zoom, Teams, Meet, Webex, Lark, Amazon Chime) has been tested with private
  mode either; every cell of the matrix in
  [docs/capture-compatibility.md](docs/capture-compatibility.md) reads `NOT TESTED`.
- **It does not replace an office suite.** There is no DOCX import or export, no comments or
  suggestion mode, and pasted formatting from other applications is normalised on a best-effort
  basis; what could not be kept is named in a paste report.
- **It sends no email.** Invitation links and share links are copied and sent by a person. A
  forgotten password is reset by the operator with a command.
- **It runs as one server process.** Running several instances needs coordination that is not
  built; see [docs/deployment.md](docs/deployment.md#scaling-boundary).

## Requirements

| To do this                             | You need                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Run the product                        | Docker Engine with the Compose plugin (`docker compose`), and internet access for the first build     |
| Create `.env` with the provided script | Node.js (the script uses only built-in modules)                                                       |
| Develop, test or build outside Docker  | Node.js 24 (`.node-version` pins 24.22.2) and pnpm 12 (`package.json` pins 12.18.0, through Corepack) |
| Build the desktop app for real use     | A Windows PC or a Mac; see the two client guides                                                      |

The build host used Docker 29.6.2 and Docker Compose v5.2.0. Older versions were not tried.

On the build host itself, Node.js and pnpm live inside the project (`.toolchain/`). Put them on the
`PATH` in every new shell before any `node` or `pnpm` command:

```sh
. scripts/dev-env.sh
```

On any other machine, install Node.js 24.22.2 and run `corepack enable` once, as the project's
`Dockerfile` does; `scripts/dev-env.sh` then changes nothing and can be skipped.

## First run with Docker Compose

Run every command from the repository root. The path ends with you signed in as the administrator
and looking at the sample document.

> **Not on a machine that already runs a deployment of this repository.** The build server runs
> one, started from the `deploy/` directory and described in [deploy/README.md](deploy/README.md).
> The commands below address the same Compose project (`realtimedocs`) and the same ports, and
> would replace its running containers with differently configured ones. On such a machine, use
> the scripts in `deploy/` and do this first run somewhere else.

### 1. Create `.env`

```sh
node scripts/init-env.mjs
```

This copies `.env.example` to `.env`, generates a database password and a session secret, and
never overwrites an existing `.env`. With pnpm installed, `pnpm setup:env` runs the same script.

Without Node.js on the machine, copy `.env.example` to `.env` yourself and fill in the two empty
values: `POSTGRES_PASSWORD` (letters and digits only, because it is placed inside a connection
address) and `SESSION_SECRET` (at least 32 random characters). Docker Compose refuses to start
without them.

### 2. Start the database and the server

```sh
docker compose up -d --build --wait
```

The first run builds the server image. The command returns when both containers report healthy.
The server listens on `127.0.0.1:4310` and PostgreSQL on `127.0.0.1:54310`. Both are reachable
from this machine only.

### 3. Create the first administrator

```sh
docker compose exec server realtimedocs bootstrap-admin --email you@example.com --name "Your Name" --generate
```

`--generate` prints a generated password exactly once; store it in a password manager. Leave the
option out to type a password at a hidden prompt instead (at least 12 characters). The command
works one time only: it refuses as soon as any account exists. There is no default account and no
default password.

### 4. Create the sample document

```sh
docker compose exec server realtimedocs seed-sample
```

It prints the address of the new document. The sample is titled "Welcome to RealtimeDocs — sample
launch notes" and contains mixed English and Hindi text, a table, an image, a code block, a link
and a Mermaid diagram.

### 5. Open the address

Open `http://127.0.0.1:4310` in a browser **on the machine that runs Docker**, sign in with the
email address and password from step 3, and open the sample document from the list.

Use exactly this address. `http://localhost:4310` is a different origin (the scheme, host and port
of a web address taken together) as far as the server is concerned, and it rejects sign-in from an
origin it was not configured for.

If Docker runs on a remote server that you reach over SSH, `127.0.0.1` on that server is not your
own computer. Forward the port first, keeping the same port number on both sides, and then open
the same address on your own computer:

```sh
ssh -L 4310:127.0.0.1:4310 you@server.example.com
```

This is a development tunnel. To let other people use the product, put it behind HTTPS as
described in [docs/deployment.md](docs/deployment.md).

## Normal use

Labels in quotation marks are the labels in the web app.

### Create a document

On the "Documents" page, choose "New document". The document opens in the editor. Click the title
to rename it. Type or paste content; images can be pasted, dropped or uploaded. The header shows
two separate states: the connection ("Live", "Reconnecting…", "Offline", …) and the save state.
"Saved" appears only after the server has confirmed that the change is committed to the database.

Only administrators create, rename, duplicate, archive and delete documents. Archived documents
are read-only for everyone. Documents moved to the trash can be restored for 30 days and are then
deleted for good.

### Add an editor: invitation link or share link

There are two separate ways to let someone edit, and they are different things.

**A person with an account.** An invitation link creates an account. It gives no access to any
document by itself.

1. Open "People", then the "Invitations" tab.
2. Optionally enter the person's email address, choose the role ("Member" or "Administrator") and
   how long the link is valid, and choose "Create invitation".
3. Copy the link and send it yourself. It is shown once.
4. After the person has created their account, open the document, choose "Share", and under
   "People" pick the account, choose "Can edit" and "Add".

The person signs in with their own password, appears under their own name, and keeps access until
you remove them from the document or disable the account. Use "View only" instead of "Can edit"
for a reader with an account.

**Anyone who holds a link.** A share link opens one document without an account. Whoever has the
link has the access it grants, so an edit link should go only to people who should edit. See the
next section.

Removing a person never affects a share link, and revoking a share link never affects a person.

### Create share links

In the document, choose "Share", then "New link" under "Share links".

- **View-only link (the default).** Leave "Access" on "View only" and choose "Create link".
- **Edit link (an explicit choice).** Switch "Access" to "Can edit". The form warns that anyone who
  gets the link can change the document.
- **Expiry.** "Expires" offers 1 hour, 1 day, 7 days (preselected), 30 days, a custom date and time,
  or never.
- **Copy it now.** The complete link is shown once, right after it is created. The server keeps
  only a fingerprint (a hash) of the secret part, so it cannot show the link again.

Each active link has an actions menu:

- "Edit access and expiry" changes the role, the label or the expiry. The change applies at once,
  also for people who have the document open through that link.
- "Rotate link" makes the current link stop working, disconnects the people using it and gives you
  a new link with the same access and expiry.
- "Revoke link" makes the link stop working immediately and disconnects the people using it.

Revoking, expiry and rotation stop future access. They cannot take back what someone has already
seen, copied, exported or photographed.

A recipient opens the link in a browser and sees the document straight away, under a generated
guest name. The secret part of the link is removed from the address bar as the page loads, so the
address shown afterwards is not a share link; forward the original link if someone else needs it.

### Snapshots and exports

"Snapshots" (administrators) saves a named copy of the document and can restore one. Restoring
replaces the document for everyone and first saves the current state as an automatic snapshot.
"Export" offers plain text, Markdown, Markdown with images as a zip file, and a print view for the
browser's "Save as PDF".

### Sign up (optional)

Self-service sign-up is **off by default** (`ALLOW_SIGNUP=false`). When an operator turns it on,
the landing page and the sign-in page offer "Sign up", which creates a member account that cannot see
any document until an administrator adds it. Without it, accounts are created by the first-administrator
command and by invitation links.

### Open a document in the desktop app

The desktop app runs on the reader's own Windows PC or Mac, not on the server. Getting it and
starting it is described in [docs/windows-client.md](docs/windows-client.md) and
[docs/macos-client.md](docs/macos-client.md). Builds are not published on the live site yet (the
download section says "Release not published"); an operator publishes them as described in
[docs/deployment.md](docs/deployment.md#publish-desktop-downloads). In short:

1. Start RealtimeDocs Desktop and enter the server address under Settings → Connection. It must be
   an address that the computer can reach: the HTTPS address of the deployment, or
   `http://127.0.0.1:4310` while an SSH tunnel like the one above is open on that computer.
2. Then either choose "Open in Desktop" on the document in the browser, which hands the app a
   single-use code that is valid for 60 seconds, or copy a share link and paste it into the panel
   ("Paste share link").

The document opens in Private Presenter Mode (the default) or in a normal window; "More" in the panel
switches between them without a new link. The panel shows the same live document, with its own
text size, reading density, reading width and background opacity.

Private mode is on by default and is a **request to the operating system, not proof of what a
meeting participant sees**: on macOS it is best effort only, and nothing was tested on Windows or
macOS. Before relying on it, read [docs/capture-compatibility.md](docs/capture-compatibility.md),
use the Safe Share Guide in the app, and record a check with a second participant or device in
Settings → Privacy Test Center ([docs/privacy-test-center.md](docs/privacy-test-center.md)). The
panel is left out of the Windows taskbar and the macOS Dock by default; the tray or menu-bar item
(with "Return to interactive mode") and two global shortcuts bring it back.

## Development workflow

```sh
. scripts/dev-env.sh              # build host only
pnpm install --frozen-lockfile
pnpm setup:env                    # skip if .env exists
pnpm db:up                        # PostgreSQL container only, 127.0.0.1:54310
pnpm bootstrap:admin --email you@example.com --name "Your Name" --generate
pnpm seed:sample                  # optional
pnpm dev                          # server and web dev server together
```

| What                                                  | Address                 |
| ----------------------------------------------------- | ----------------------- |
| Server: API, `/collab` WebSocket (restarts on change) | `127.0.0.1:4310`        |
| Web dev server (Vite); open this one in the browser   | `http://127.0.0.1:4311` |
| PostgreSQL                                            | `127.0.0.1:54310`       |

All three listen on `127.0.0.1` only. The web dev server forwards `/api` and `/collab` to the
server, so the browser sees one origin. `pnpm dev:server` and `pnpm dev:web` start the two halves
separately; `pnpm db:down` stops the database container.

Things to know:

- **Do not develop this way on a machine that runs a deployment from `deploy/`**, such as the build
  server. `pnpm db:up` and `pnpm db:down` act on the Compose project `realtimedocs`, which is the
  live one there, and ports 4310 and 54310 are taken by it. See
  [deploy/README.md](deploy/README.md). Commands that touch neither that project nor those ports,
  such as `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build`, are not affected; the
  integration and backup tests use containers, project names and ports of their own.
- `pnpm dev` and the Compose `server` container both want port 4310. Stop one before starting the
  other (`docker compose stop server`).
- Links that the server generates (share links, invitation links, the address printed by
  `pnpm seed:sample`) start with `PUBLIC_ORIGIN`, which is port 4310. In development, open the same
  path on port 4311, or run `pnpm build` once so that port 4310 serves the built web app as well.
- `pnpm desktop:dev` builds the desktop app and starts it. It needs a desktop session, so it works
  on a Windows PC, a Mac or a Linux desktop, not over plain SSH.
- If `pnpm` reports errors about empty or unreadable package manifests after an install, run
  `node scripts/verify-install.mjs`; it detects the problem and names the repair command.

## Remote development and local desktop connectivity

If the repository lives on a remote machine that you reach over SSH, while you run the presenter
app on your own Windows PC or Mac, two machines are involved and `localhost` is a different
machine on each. The full guide, with the reasons, is in
[docs/deployment.md](docs/deployment.md#remote-development-and-local-desktop-connectivity). In
short:

1. **On the remote host**, start PostgreSQL, the server and the web dev server as in the
   development workflow above (`pnpm db:up`, then `pnpm dev`). Keep them on `127.0.0.1`.
2. **On your laptop**, open a tunnel and leave it running. Use the same port numbers on both
   sides:

   ```sh
   ssh -N -L 4310:127.0.0.1:4310 -L 4311:127.0.0.1:4311 user@host
   ```

3. Open `http://127.0.0.1:4311` in the laptop's browser. The address has to match `PUBLIC_ORIGIN`
   and `ALLOWED_ORIGINS` in `.env`: `localhost` and `127.0.0.1` are different origins, and so are
   different ports.
4. **Desktop app:** install a package built for Windows or macOS, or copy the sources to the
   laptop and run `corepack enable`, `pnpm install --frozen-lockfile` and
   `pnpm --filter @realtimedocs/desktop run dev` there (Node.js 24.22.2, pnpm 12.18.0). In
   Settings → Connection enter `http://127.0.0.1:4310` while the tunnel is open. The desktop
   origin `app://realtimedocs` must be in `DESKTOP_ORIGINS` (it is by default).
5. **A deployed backend** is reached over HTTPS and WSS behind a reverse proxy, not through a
   tunnel; see [HTTPS and WSS behind a reverse proxy](docs/deployment.md#https-and-wss-behind-a-reverse-proxy).

## Tests, builds and packages

These commands exist. Results are not listed here; they are recorded in
[docs/testing.md](docs/testing.md).

| Command                                                         | What it does                                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                     | All unit tests (Vitest projects `contracts`, `ui`, `editor`, `server`, `web`, `desktop`)              |
| `pnpm exec vitest run --project server`                         | Unit tests of one project                                                                             |
| `pnpm test:integration`                                         | Server integration tests against a real PostgreSQL container and a real server process (needs Docker) |
| `pnpm test:backup-restore`                                      | Backup and restore rehearsal in two throw-away Compose projects (needs Docker)                        |
| `pnpm --filter @realtimedocs/web run test:browser`              | Web app browser tests; run inside the Playwright container as described in `docs/notes/web.md`        |
| `pnpm --filter @realtimedocs/desktop run test:smoke`            | Electron smoke tests under Xvfb in the Playwright container. Linux evidence only                      |
| `pnpm --filter @realtimedocs/desktop run test:packaged`         | Checks the packaged Linux build from outside the process (run `package:linux` first)                  |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`              | TypeScript, ESLint and Prettier checks                                                                |
| `pnpm check`                                                    | Format check, lint, type check and unit tests in one go                                               |
| `pnpm build`                                                    | Builds the web app (`apps/web/dist`) and the server bundle (`apps/server/dist`)                       |
| `pnpm start`                                                    | Runs the built server, which also serves the built web app                                            |
| `docker compose build`                                          | Builds the server image (`realtimedocs-server:local`)                                                 |
| `pnpm desktop:build`                                            | Development build of the desktop app into `apps/desktop/dist`                                         |
| `pnpm desktop:package`                                          | Packages the desktop app for the machine it runs on                                                   |
| `pnpm --filter @realtimedocs/desktop run package:win`           | Windows packages for x64 and arm64                                                                    |
| `pnpm --filter @realtimedocs/desktop run package:mac`           | macOS packages for Intel (x64) and Apple Silicon (arm64)                                              |
| `pnpm --filter @realtimedocs/desktop run package:mac:universal` | One macOS app for both architectures. Works on a Mac only                                             |
| `pnpm --filter @realtimedocs/desktop run package:win:installer` | Per-user Windows installers for the packaged Windows folders (NSIS)                                   |
| `pnpm test:e2e`                                                 | Acceptance suite (Playwright, needs Docker)                                                           |
| `pnpm perf`                                                     | Latency harness; the stack must be up first (see docs/performance.md)                                 |
| `pnpm --filter @realtimedocs/desktop run inspect-package`       | Inspects the packages in `apps/desktop/out` as files, without running them                            |

Two more root scripts exist: `pnpm test:e2e` (the Playwright acceptance suite in `tests/e2e`; it
starts its own stack in Docker and needs the Playwright image, see the header of `tests/e2e/run.mjs`)
and `pnpm perf` (the latency harness in `tests/perf`; start its stack first with
`pnpm --filter @realtimedocs/perf run stack:up`, see [docs/performance.md](docs/performance.md#how-to-rerun)).

Packages made on Linux for Windows and macOS are unsigned and have never been started on those
systems. Signed builds need the native system and a certificate; the client guides give the steps.

## Operator commands

For a Compose deployment, run these from the repository root. `docker compose exec` allocates a
terminal, so a password prompt works; add `-T` when a password is piped in with
`--password-stdin`.

| Task                               | Command                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| Create the first administrator     | `docker compose exec server realtimedocs bootstrap-admin --email <address> --name "<name>"` |
| Reset a forgotten password         | `docker compose exec server realtimedocs reset-password --email <address> --generate`       |
| Create the sample document         | `docker compose exec server realtimedocs seed-sample`                                       |
| Apply database migrations by hand  | `docker compose exec server realtimedocs migrate`                                           |
| Run the retention rules once       | `docker compose exec server realtimedocs cleanup`                                           |
| Back up the database and the files | `scripts/backup.sh`                                                                         |
| Restore a backup                   | `scripts/restore.sh backups/<backup directory>`                                             |

When the server runs on the host instead of in a container, the same commands are
`pnpm bootstrap:admin`, `pnpm reset:password`, `pnpm seed:sample`, `pnpm db:migrate` and
`pnpm cleanup`, with the same options.

For the deployment in `deploy/` on the build server, the forms are different because its settings
are not in a root `.env`: `deploy/exec.sh server realtimedocs <command>` for the operator commands
and `scripts/backup.sh --env-file deploy/.env.production` for a backup. See
[deploy/README.md](deploy/README.md).

`reset-password` sets a new password and ends every session of that account. The retention rules
also run inside the server every six hours. A backup contains password hashes and all document
content; `restore.sh` replaces the target's data and refuses a target that already has accounts
unless `--force` is given. Details, including what a backup does not do, are in
[docs/deployment.md](docs/deployment.md#backups-and-restore).

## Configuration

All configuration is environment variables, read from `.env`. `.env.example` lists every variable
with its default and contains no secrets.

**Required**

| Variable            | Purpose                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | Password of the database user that Compose creates. Generated by `scripts/init-env.mjs`                                                |
| `SESSION_SECRET`    | At least 32 random characters. Generated by `scripts/init-env.mjs`                                                                     |
| `DATABASE_URL`      | Used when the server runs on the host (`pnpm dev`, `pnpm start`). The Compose server container builds its own from `POSTGRES_PASSWORD` |

**Required to be right as soon as other people use it**

| Variable          | Purpose                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN`   | The address people type, for example `https://docs.example.com`. Links and cookie security follow from it       |
| `ALLOWED_ORIGINS` | Extra web origins that are trusted like `PUBLIC_ORIGIN`. Needed for `pnpm dev` only; empty in a real deployment |
| `TRUST_PROXY`     | Number of reverse proxies in front of the server, so that rate limits and logs see the real client address      |

**Optional.** `ALLOW_SIGNUP` (self-service sign-up, off by default), `DOWNLOAD_DIR` (where the
desktop builds for the download section live; unset means none are offered), ports (`RD_PORT`,
`RD_DB_PORT`), session lifetimes, upload and document limits,
retention periods, collaboration limits, database timeouts and rate limits all have working
defaults. The full reference is in
[docs/deployment.md](docs/deployment.md#environment-reference). A wrong or missing value stops the
server at start-up with a message that names the variable.

## Documentation map

| Document                                                         | Content                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [docs/deployment.md](docs/deployment.md)                         | HTTPS and WebSockets behind a reverse proxy, environment reference, publishing desktop downloads, redeploying, operations |
| [deploy/README.md](deploy/README.md)                             | The deployment that runs on the build server, published through a Cloudflare Tunnel                                       |
| [docs/security.md](docs/security.md)                             | Threat model, what is enforced where, known limits, residual risks, the permitted-use boundary                            |
| [docs/capture-compatibility.md](docs/capture-compatibility.md)   | What private mode does and does not do, the test matrix (all `NOT TESTED`), the test procedure                            |
| [docs/privacy-test-center.md](docs/privacy-test-center.md)       | The in-app Privacy Test Center: statuses, recording a test, expiry, export                                                |
| [docs/backup-and-restore.md](docs/backup-and-restore.md)         | Backing up and restoring the database and files, and what is not covered                                                  |
| [docs/windows-client.md](docs/windows-client.md)                 | The desktop app on Windows: getting it, modes, tray, shortcuts, building, signing, manual checklist                       |
| [docs/macos-client.md](docs/macos-client.md)                     | The desktop app on macOS: the same, plus signing, notarization and capture limits                                         |
| [docs/architecture.md](docs/architecture.md)                     | System design, data model, data flows and the deployment topology                                                         |
| [docs/decisions.md](docs/decisions.md)                           | Choices made during the build and the reasons                                                                             |
| [docs/requirements-checklist.md](docs/requirements-checklist.md) | Requirement by requirement: status, where it is implemented, where it is verified                                         |
| [docs/testing.md](docs/testing.md)                               | Which tests exist and their recorded results                                                                              |
| [docs/performance.md](docs/performance.md)                       | Latency measurements, how they were taken and how to rerun them                                                           |
| [docs/status.md](docs/status.md)                                 | Short checkpoint of what is done and what is pending                                                                      |
| `docs/notes/`                                                    | Engineers' working notes per area (server, editor, web, desktop, performance)                                             |

## Status and limits

This README describes how the product is built to work. It does not state test results.

- What is finished, what is in progress and what is pending is in [docs/status.md](docs/status.md).
  Which tests were run, on what, and with what result is in [docs/testing.md](docs/testing.md).
  Measured latency is in [docs/performance.md](docs/performance.md), with its limits.
- **The native boundary.** Nothing has been run on Windows or macOS. The only evidence for the desktop
  app is Electron on Linux under Xvfb, plus inspection of the cross-built packages and installers as
  files. Native behaviour, installers, signing and notarization are `NOT TESTED`.
- **No meeting application has been tested with private mode.** What the app requests from the
  operating system and what was verified are different things; see
  [docs/capture-compatibility.md](docs/capture-compatibility.md). On macOS the request is best effort.
- Known product defect: when two or three editors press Enter at the same instant at the same place
  in a document, the clients converge but the result is not what they typed
  ([docs/requirements-checklist.md](docs/requirements-checklist.md), row 17.3).
- The first-run path of this README, with a `.env` in the repository root, was not run as written
  on the build host. The same files were run there under other project names and ports by the
  test suites, and under the project name `realtimedocs` by the deployment in `deploy/`. What was
  observed on that deployment is listed in [deploy/README.md](deploy/README.md); the Caddy and nginx
  examples of the deployment guide were never run. See
  [docs/deployment.md](docs/deployment.md#what-was-and-was-not-verified).
