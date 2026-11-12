# Web app notes (`apps/web`)

_Status: third pass (landing page, documents, reading mode, sign-up, downloads), 2026-11-11; second pass before it. The real editor is wired in, and the app has run against the
real server, a real PostgreSQL and the server's own Content-Security-Policy in Chromium, Firefox
and WebKit. The mocked-API suite of the first pass still exists and still passes; it now covers
the app around the editor, and a second suite (`test-real/`) covers the product end to end._

All commands need the toolchain prefix: `. scripts/dev-env.sh;` (Node 24.22.2, pnpm 12.18.0).

## Commands that exist

| Command                                                                            | What it does                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @realtimedocs/web run dev`                                          | Vite dev server on `127.0.0.1:4311` (`strictPort`). Proxies `/api` (HTTP) and `/collab` (WebSocket) to `http://127.0.0.1:4310`; override with `RD_API_TARGET`. |
| `pnpm --filter @realtimedocs/web run build`                                        | pass (entry 248 kB / 79 kB gzip)                                                                                                                               |
| `pnpm --filter @realtimedocs/web run preview`                                      | Serves `dist` on `127.0.0.1:4311` with the same proxy and a CSP header.                                                                                        |
| `pnpm --filter @realtimedocs/web run typecheck`                                    | `tsc -p tsconfig.json` (covers `src`, `test`, `test-browser`, `test-real`, config files).                                                                      |
| `pnpm --filter @realtimedocs/web run test` or `pnpm exec vitest run --project web` | Unit tests (Vitest project `web`, happy-dom).                                                                                                                  |
| `pnpm --filter @realtimedocs/web run test:browser`                                 | Playwright specs against the mocked API. Must run inside the Playwright image, see below.                                                                      |
| `pnpm --filter @realtimedocs/web run real:up` / `real:down` / `real:status`        | Starts, stops or reports the real stack for the integration tests (`test-real/stack.mjs`). `real:up` stays in the foreground.                                  |
| `pnpm --filter @realtimedocs/web run test:real`                                    | Playwright specs against the real stack. Must run inside the Playwright image, see below.                                                                      |

Ports and names used by these commands (all on `127.0.0.1`, all inside the web range):

| What                                                  | Where                         |
| ----------------------------------------------------- | ----------------------------- |
| Real server (API, WebSocket, built web app, real CSP) | 4430                          |
| Vite development server in front of the real server   | 4431                          |
| Control endpoint of the stack (stop/start the server) | 4432                          |
| Preview or dev server of the mocked suite             | 4435                          |
| PostgreSQL of the real stack                          | 54430, container `rd-web-pg`  |
| Playwright containers                                 | `rd-web-pw`, `rd-web-pw-real` |

### Mocked-API browser tests

Build first; the tests serve `dist` with `vite preview` on port 4435.

```sh
docker run --rm --name rd-web-pw --network host --user 1000:1000 -e HOME=/tmp \
  -v /home/techsphere/Documents/project/realtimedocs:/work -w /work/apps/web \
  mcr.microsoft.com/playwright:v1.64.1-noble \
  node /work/node_modules/@playwright/test/cli.js test -c playwright.config.ts
```

Add `-e RD_WEB_SERVER=dev` to run the functional specs against `vite dev` instead (React
StrictMode, development warnings). Add `--project=chromium`, a spec file name or `-g <text>` to
narrow a run. Screenshots are written to `apps/web/.stage/screenshots/` (ignored by git).

### Real-stack browser tests

Nothing is mocked. `real:up` does this, and nothing outside the web range:

1. writes `apps/web/.stage/real.env` with generated secrets (`scripts/init-env.mjs --file … --port
4430 --db-port 54430`); the repository's root `.env` is never created or read, and the default
   Compose project is never addressed;
2. starts PostgreSQL 17.11 with `docker run` as `rd-web-pg` (data in memory);
3. builds the web app and the server, and runs the server from a private copy of its bundle
   (`apps/web/.stage/real/server`) with `RD_ENV_FILE`, `NODE_ENV=production` and
   `WEB_DIST_DIR=apps/web/dist`, so the browser gets the app, the API, the WebSocket and the real
   security headers from one origin;
4. creates the first administrator with the server's CLI (`bootstrap-admin --password-stdin`; the
   password is generated per run and never printed) and seeds the sample document
   (`seed-sample`);
5. writes `apps/web/.stage/real/state.json` (owner-only) for the tests and serves a control
   endpoint that lets one spec stop and start the server.

```sh
# terminal 1 (stays in the foreground; Ctrl+C or `real:down` stops server and database)
node apps/web/test-real/stack.mjs up            # --no-build to reuse existing builds

# terminal 2
docker run --rm --name rd-web-pw-real --network host --user 1000:1000 -e HOME=/tmp \
  -v /home/techsphere/Documents/project/realtimedocs:/work -w /work/apps/web \
  mcr.microsoft.com/playwright:v1.64.1-noble \
  node /work/node_modules/@playwright/test/cli.js test -c playwright.real.config.ts \
  --project=chromium --project=firefox --project=webkit

# the outage scenarios (and downloads-outage) restart the shared server, so they run on their own, one at a time
docker run … test -c playwright.real.config.ts \
  --project=outage-chromium --project=outage-firefox --project=outage-webkit --workers=1
```

The server serves `apps/web/dist` from disk, so after `pnpm --filter @realtimedocs/web run build`
the running stack serves the new build (do not rebuild while tests run). Development mode against
the real server: start `RD_API_TARGET=http://127.0.0.1:4430 node node_modules/vite/bin/vite.js
--host 127.0.0.1 --port 4431 --strictPort` in `apps/web` and add `-e
RD_REAL_BASE_URL=http://127.0.0.1:4431` to the `docker run` line (the stack already allows that
origin). Pictures of the real editor go to `apps/web/.stage/screenshots-real/`.

## Routes

| Route                            | Screen                                                                                                                                                                                                                                      | Account needed |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `/login`                         | Sign-in. `?next=` returns to the intended page (same-origin paths only). Says who can reset a forgotten password.                                                                                                                           | no             |
| `/invite/:invitationId#<secret>` | Accept an invitation, create the account.                                                                                                                                                                                                   | no             |
| `/s/:grantId#<secret>`           | Share-link exchange, then `replace` to `/d/<documentId>`.                                                                                                                                                                                   | no             |
| `/d/:documentId`                 | Document workspace. Works for accounts and for share-link guests (`user === null`). `?panel=share` / `?panel=snapshots` open the administrator panels.                                                                                      | no             |
| `/d/:documentId/print`           | Print view.                                                                                                                                                                                                                                 | no             |
| `/`                              | Signed in: the dashboard (`?view=` `active`, `recent`, `archived` or `trash`; `?q=` searches titles). Signed out: the public landing page.                                                                                                  | no (landing)   |
| `/signup`                        | Self-service sign-up (name, email, password). Only when `signupEnabled`; otherwise says it is turned off.                                                                                                                                   | no             |
| `/docs/:name`                    | In-app reader for `README.md`, `docs/windows-client.md`, `docs/macos-client.md`, `docs/security.md` (slugs `readme`, `windows-client`, `macos-client`, `security`, with or without `.md`, any case). Anything else is the not-found screen. | no             |
| `/settings`                      | Profile, password, theme, sessions (sign out here, sign out everywhere else), recovery drafts (`#recovery-drafts`).                                                                                                                         | yes            |
| `/admin/users`                   | Accounts, invitations, audit log (`?tab=`). Administrators only.                                                                                                                                                                            | yes            |
| anything else                    | 404.                                                                                                                                                                                                                                        | no             |

Every route is a lazy chunk. Inside the document route, `EditorMount`, `SharingPanel`,
`SnapshotsPanel` and (print) `PrintMount` are further lazy chunks, so the editor is downloaded
only after the server has confirmed access to a document.

## Landing page, documents and reading mode (third pass, 2026-11-11)

**Routing.** `/` is `features/landing/HomeGate.tsx`: a signed-in session gets the dashboard inside
`AppShell`, everyone else gets `LandingPage`; only the chosen screen's chunk is fetched. `/login`
is unchanged and linked from the page (header, hero, download section, footer). `/s/:grantId`,
`/invite/:invitationId` and `/d/:documentId` are untouched.

**Landing page** (`features/landing/`, redesigned 2026-11-12). Dark by default, light works; tokens
are the global `--rd-*` set plus landing-scoped `--lp-*` under `.rd-landing` (display scale, glass
and glow values, paper colour of the demo page). System font stack, tight tracking on headlines, no
web fonts, no animation library, no inline `<style>`. Files: `LandingPage.tsx` (composition),
`LandingNav.tsx` (sticky nav; below 1000px a disclosure menu with `aria-expanded`, Escape closes and
returns focus; the nav button says "Download for <OS>" only when the server publishes a build for the
detected computer, otherwise "Download", and always goes to `#download`), `Hero.tsx`,
`hero/DemoSlot.tsx` + `hero/ProductDemo.tsx` + `hero/demo.css`, `sections/*.tsx` (Product, Presenter,
Sessions, History, ApiSection, Security, Reliability, Platforms, Faq, GetStarted), `copy.ts`
(required sentence, owner caveats, the protection vocabulary copied from
`apps/desktop/src/shared/privacy/status.ts`; a unit test compares them), `useReveal.ts`,
`useReducedMotion.ts`. Section order: hero (headline, sub-copy, the required sentence "OS-assisted
capture exclusion. Verify your exact meeting and capture setup before relying on it.", compact
download picker, sign in, API docs), demo, collaboration, Presenter Mode (capabilities, way back and
shortcuts, the eight protection states in two layers, the sure way, per-platform lines, Safe Share
Guide), interview sessions, version history, developer API (real `POST /api/v1/interview-sessions`
request and response shape with a copy button), security (only what `docs/security.md` states),
performance and reliability (no figures: `docs/performance.md` is not a bundled guide and there is no
load-test report, so the page says so), platform compatibility (table plus the matrix), download,
get started, FAQ (`<details>`), footer. Skip link is the app-wide one in `RootLayout`.

**Demo.** The only moving thing on the page. `DemoSlot` reserves the box (aspect ratio, no layout
shift) and loads `ProductDemo` with `React.lazy` once the box is within 200px of the viewport
(IntersectionObserver); its chunk is separate. Six scenes (typing, two labelled collaborators,
margin marker dragged with the text following, translucent Presenter panel showing "OS protection
accepted" and "Manual verification required", Saving… to Saved, people joining) are one number of
React state; CSS classes `s0`..`sN` mark the scenes reached and only `transform`, `opacity` and
`clip-path` change. Play/pause (`aria-pressed`), previous/next and one button per scene. It pauses
while off-screen or the tab is hidden. With `prefers-reduced-motion: reduce` there is no play button,
no transition and no auto-advance; the visitor steps through. The stage is `aria-hidden`; a
screen-reader paragraph describes it. Scroll reveal (`data-reveal`) fades each block in once, only
below the fold, never under reduced motion. The nav, hero and download picker share one
`useDesktopRelease` query. `DownloadPicker` got a `compact` prop (hero) which only changes classes
and prefixes its test ids with `hero-`; `compatibility.tsx` got `data-label` on cells so tables stack
as cards below 720px.

**Wording that stays fixed** (owner): the required sentence above, the caveat "Behavior depends on
your operating system, meeting application, capture mode, and version. Verify your setup before
relying on it." in the Presenter section, the macOS whole-display sentence, and the sure-way text.
The old h1 ("Private presenter notes with OS-supported screen-share exclusion.") was replaced by
"Collaborative documents with a private presenter panel." The banned words ("invisible",
"undetectable", "guaranteed", "100%", "bypass", "proctoring", ...) appear nowhere, not even negated;
`landing.spec.ts` scans the rendered text including closed FAQ answers and `landing.test.tsx` scans
the static sections. Tests: `landing.spec.ts` (OS labels for Windows, macOS and Linux user agents,
chooser, unavailable state without a link, six widths x two themes with no sideways scroll,
reduced motion, nav menu, keyboard path, axe), `landing-screenshots.spec.ts` (dark and light at 1440,
1024 and 375 into `.stage/screenshots/landing-*.png`). Default Playwright "Desktop Chrome" reports
Windows, so specs that publish one platform set their own `userAgent`.

**Compatibility matrix** (`compatibility.tsx`, `verified-configurations.json`). Windows and macOS
times Zoom, Microsoft Teams, Google Meet, Webex, Lark and Amazon Chime times tab, window,
application and entire display: 48 cells, each "Not tested" unless the JSON file holds a complete
record for exactly that platform, meeting app and capture mode. The file is `[]` today. Each record
has `platform`, `osVersion`, `meetingApp` (`zoom`, `teams`, `meet`, `webex`, `lark`, `chime`),
`client`, `captureMode` (`tab`, `window`, `application`, `entire_display`), `monitors`,
`protectionEnabled`, `outcome`, `testedAt`, `appVersion` and `evidence` (the record in
`docs/capture-compatibility.md`, shown as text because that file is not bundled). Incomplete
records are ignored. There is no check mark and no "works" anywhere; unit tests cover the empty file,
one entry and malformed entries.

**Downloads** (`#download`). The section reads `GET /api/downloads` (`api.downloads()`), shows the
release version and notes when the server has a `release.json`, and lists only the builds the
server lists, in a fixed order, each with its size, its SHA-256 and a link to the `url` the server
gave (only paths on this origin are linked; nothing is invented). Empty list: "Release not
published — build the desktop app locally (see the Windows and macOS guides)". A failed request
shows a retry button. When `release.signed` is not `true` (including no `release.json`) the notice
says the builds are unsigned, names SmartScreen and Gatekeeper, links the Windows and macOS
guides and tells people to leave those protections on. It also says "No install? Open your share
link in any modern browser." and offers sign-in. The desktop app needing no microphone, camera or
screen-recording permission and no administrator rights is stated in the privacy section (from
`docs/security.md`; the Windows installer installs per user, without administrator rights).

**Accounts.** `/login` is linked everywhere. `/signup` (`features/auth/SignupPage.tsx`: name, email,
password with the strength hint, the login screen's error handling) is offered on the landing page
and the login screen only when `GET /api/meta` says `signupEnabled`; opened directly while it is
off it says "Sign-up is turned off on this server.", and a 403 on submit says the same. Invitation
links are explained on the landing page ("come from your administrator").

**Documents** (`features/docs/`). The four files are imported with Vite's `?raw` at build time
(`documents.ts`). `markdown.tsx` is a finished, dependency-free renderer that builds React elements
only: raw HTML is shown as text, images become their alt text, `javascript:`, `data:` and
`vbscript:` links are never made into anchors whatever the resolver says, web links open in a new
tab with `noopener noreferrer`. `resolveDocumentLink` turns links between the bundled files
(relative to the file they are written in, fragments kept) into `/docs/<slug>` routes; links to
other repository files (`testing.md`, `deploy/README.md`, ...) are shown as plain text because they
are not part of the site. Because the files are bundled, the documents are as old as the build.

**Reading mode** (`lib/readingMode.ts`, `lib/wakeLock.ts`, `features/document/ReadingBar.tsx`).
A "Reading mode" switch at the top of the display menu (popover on wide screens, dialog on phones).
When on: the header is replaced by a one-line bar (back, title, exit, connection and save state,
text size, light/dark), the editor is read-only and always follows the latest changes, text size
defaults to 140% (100-180%, the editor's limit), the document is dark unless the reader chose
light, the side panels and the status strip are gone. Stored per device in `localStorage`
(`rd.reading.v1`, every access in try/catch, nothing stored for the default). The screen is kept
awake with `navigator.wakeLock.request('screen')`: asked again on `visibilitychange` when the page is
visible, released when reading mode is turned off or the page is left. Without the API (or when the
browser refuses) the bar says "Your screen may sleep". Not verified on a real phone or tablet (see
"What was not verified").

**Test stack change.** `test-real/stack.mjs` has new control routes: `POST
/downloads/publish?file=&bytes=[&version=&signed=]` (restarts the server with `DOWNLOAD_DIR`
pointing at a scratch folder holding one dummy file, and a `release.json` when `version` is given),
`POST /downloads/reset` (restarts it with `DOWNLOAD_DIR` unset; the stack otherwise always runs
with it unset), and `POST /signup/enable|disable` (restarts it with `ALLOW_SIGNUP=true` or unset).
Specs that use them are `downloads-outage.spec.ts` and run with the outage projects, one worker,
because they restart the shared server. **Dependency:** `@axe-core/playwright` 4.11.3 (dev, exact,
released 2026-04-30; installed through the lock, `verify-install.mjs` clean; it adds `axe-core`
and changes the root `pnpm-lock.yaml`). **Accessibility:** `test-browser/a11y.spec.ts` runs axe
(WCAG 2 A/AA and 2.1 A/AA tags) in both themes on the landing page (also with every FAQ answer
open), sign-in, sign-up (on and off), invitation, dashboard, document viewer and a guide page, and
fails on serious or critical findings; plus a keyboard test of the landing page (skip link, tab
order, visible focus, FAQ from the keyboard, matrix scroll areas as tab stops). Colours of the
landing page are measured in the settled state (reduced motion), not mid-animation. Axe finds a
subset of problems; no screen reader was used.

**Docker build.** The docs reader imports exactly `README.md`, `docs/windows-client.md`,
`docs/macos-client.md` and `docs/security.md` from outside `apps/web` (`?raw`); the Dockerfile's
web-build stage and `.dockerignore` carry those four files. Any further import from outside
`apps/web` needs the same change there.

## Layout of the code

```
apps/web
  index.html, public/boot.js, public/favicon.svg
  src/main.tsx, src/router.tsx, src/styles/app.css
  src/lib/         api client + CSRF, session, capability secrets, errors, time, expiry,
                   permissions, display preferences, document order, query client and keys
  src/components/  shells, error presentation, side panel, sign-out flow, brand
  src/features/    auth, dashboard, document, share, settings, drafts, admin, landing, docs
  test/            Vitest unit tests
  test-browser/    Playwright specs against the mocked API (support/mockApi.ts)
  test-real/       Playwright specs against the real stack, and stack.mjs that runs it
```

Visual language: only `--rd-*` tokens of `@realtimedocs/ui`, both themes. App classes are
prefixed `app-`; each feature has its own stylesheet next to its components. Breakpoints: 640px
(phone header, navigation moves into the account menu), 960px (side panels dock beside the
document; below that they are full-screen sheets, and the header shows the status as icons).

## How the editor is wired

Four files import `@realtimedocs/editor`; nothing else does.

1. **`src/features/document/EditorMount.tsx`** owns one `createCollabSession` per open document
   and principal. The session is created in an effect, so React's development double mount
   destroys the first one and starts a clean second one. It renders `SessionBanners` and
   `DocumentEditor`, and portals `SessionStatusIndicator` and `ParticipantStack` into the header.
   - The editor's `variant` follows the role the server reports live (`canEdit`), not the role
     that was fetched with the page: a link changed to view-only loses its toolbar at once.
   - Display preferences (`src/lib/displayPreferences.ts`, this browser only) are passed through.
   - Follow Latest is remembered in this browser for readers (`rd.follow-latest.v1`); for someone
     who can edit it is a switch for the moment.
   - `onOpenLink`: `mailto:` and `tel:` are followed in place; web links are left to the editor,
     which opens them in a new tab without an opener and without a referrer.
   - The editor's own `installBeforeUnloadGuard` asks before a tab with unsent changes closes.
   - What the page does with the session's status (`sessionSync.ts`): access revoked or expired
     takes the document off the screen and shows `AccessEnded.tsx` (the reason is only known to
     the session); a document that became unavailable, a changed role or a new generation re-read
     `GET /api/documents/:id`, whose answer decides what is shown.
2. **`src/features/document/PrintMount.tsx`** loads `export?format=json` and renders it with
   `StaticDocument` (full width, light). "Print" is enabled when the document is on the sheet,
   every image has loaded and every diagram is drawn, or after 10 seconds.
3. **`src/features/drafts/draftsApi.ts`** delegates to the editor's recovery store through a
   dynamic import. Consumers: Settings → Recovery drafts (list, rendered preview, download as
   JSON, delete), the sign-out flow (warn, then clear) and the notices on the document.
4. **`src/features/drafts/DraftPreview.tsx`** renders one draft with `StaticDocument` (lazy).

**Local data.** The session gets `access.accountId`, which is `null` for share-link guests, so
the editor writes nothing to a guest's browser (verified: no IndexedDB database, nothing of the
document in web storage). For an account the editor keeps unsent changes and recovery drafts in
an IndexedDB database of that account (`realtimedocs-local-v1:<accountId>`). Signing out deletes
it, after asking when it holds unsaved work. An account whose session was ended elsewhere could
not clean up: its database stays in that browser profile, separate by account. The interface
offers it to that account only (another account's Settings lists nothing, and its sign-out
leaves the database alone); a person with access to the browser's developer tools can still read
it, which `docs/security.md` states ("on a shared computer, sign out").

## How the security-relevant parts work

- **Capability secrets** (`src/lib/capability.ts`, `useCapability.ts`). `main.tsx` calls
  `captureCapabilityFragment()` before the router is created and before any request: on `/s/…`
  and `/invite/…` the fragment is read and removed with `history.replaceState` in one synchronous
  step, and the secret is kept in a module-level map only. A `hashchange` listener covers the same
  link being opened again without a page load. The secret is dropped after a successful exchange,
  after a refusal, and when the screen closes. It is never in storage, a cookie, a query key, a log
  line or an error message. Consequence (intended): reloading the page loses the secret and the
  screen asks for the original link.
- **Share exchange** (`src/features/share/exchange.ts`): `POST /api/share/exchange` with
  `mode: 'cookie'`, then `navigate('/d/<id>', { replace: true })`.
- **CSRF** (`src/lib/api.ts`): `createApiClient({ credentials: 'same-origin', getCsrfToken })`.
  The token comes from every `SessionResponse` and lives in memory. Guests send the contract's
  placeholder value.
- **Session** (`src/lib/session.tsx`): `GET /api/auth/session` on start, on window focus, at the
  announced expiry, and when another tab signs in or out (`BroadcastChannel`). A 401 or
  `csrf_failed` on any request while signed in re-reads the session (never retries the request).
  When the account changes, all cached API data is reset.
- **Open in Desktop** (`OpenInDesktop.tsx`): the returned URL is checked with
  `parseDesktopHandoffUrl` and must name the same document before it is followed with
  `location.assign`. The code is never rendered or stored. Chromium and WebKit follow the link
  right after the click that opened the dialog; Firefox replaces the page with an error when no
  app handles a custom scheme, so there the dialog explains first and waits for a second click.
- **Retry rules** (`src/lib/queryClient.ts`): 4xx never retried, network/5xx twice with backoff,
  mutations never. `networkMode: 'always'` so offline requests fail visibly instead of pausing.
- **CSP.** The built app has no inline script. `public/boot.js` (an external classic script) only
  applies the saved theme before first paint. The zod switch that used to live there is gone:
  `@realtimedocs/contracts` now turns zod's `new Function` probe off itself.

## What the built app needs from the server

Confirmed against the real server in this pass:

- `dist/index.html` for every non-API path (SPA fallback), `/boot.js`, `/favicon.svg` and
  `/assets/*` as files; `index.html` is sent with `Cache-Control: no-cache`.
- The server's policy (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://…; frame-ancestors 'none';
object-src 'none'; base-uri 'self'; form-action 'self'`) works unchanged. Every real-stack test
  fails on a violation, and none was reported.
- `Content-Disposition: attachment` on `GET …/export` (the Export menu uses plain download
  links); the browser saves the file under the server's name.

## What was verified, and how

All results below were observed on this host on 2026-11-11, after the last change to the code.

| Check                                                                                                   | Result                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @realtimedocs/web run typecheck`                                                         | pass                                                                                                                                                      |
| `pnpm exec eslint apps/web`                                                                             | pass, no warnings                                                                                                                                         |
| `pnpm exec prettier --check apps/web`                                                                   | pass                                                                                                                                                      |
| `pnpm --filter @realtimedocs/web run build`                                                             | pass (entry 248 kB / 78 kB gzip; editor chunk 806 kB / 250 kB gzip; see "Known gaps" for ELK)                                                             |
| Unit tests, `vitest run --project web` (third pass, 2026-11-11)                                         | 12 files, 221 tests, all pass                                                                                                                             |
| **Real stack**, production build + server CSP, Chromium (third pass)                                    | 27 tests, all pass (the landing page and the document pages with zero CSP violations)                                                                     |
| **Real stack**, Firefox (third pass)                                                                    | 21 tests, all pass                                                                                                                                        |
| **Real stack**, WebKit (third pass)                                                                     | 21 tests, all pass                                                                                                                                        |
| **Real stack**, outage scenarios and downloads / sign-up (`outage-*` projects), each browser on its own | 18 tests (6 per browser: 2 outage, 4 downloads and sign-up), all pass                                                                                     |
| **Real stack** through `vite dev` on 4431 (StrictMode, proxy for HTTP and WebSocket), Chromium          | 20 tests, all pass                                                                                                                                        |
| Mocked API, production build + CSP, Chromium / Firefox / WebKit (third pass)                            | 834 tests: 832 pass (406 / 213 / 213), 2 skipped (clipboard read can only be granted in Chromium), 0 fail; includes 17 axe and keyboard tests per browser |
| Mocked API, `vite dev` (StrictMode), Chromium (first pass; not rerun in the third pass)                 | 131 tests, all pass                                                                                                                                       |
| `packages/editor` after the wording change: `vitest run --project editor`, typecheck                    | 9 files, 216 tests, all pass; typecheck pass                                                                                                              |

### Real-stack scenarios (`apps/web/test-real`)

Each runs in Chromium, Firefox and WebKit against the real server and database. A second,
isolated browser profile plays the guest or the other account. Every test fails on a CSP
violation, an uncaught error or an unexpected console error in any of its profiles.

| Spec                | Scenario and what is asserted                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editing.spec.ts`   | Sign in, create a document, type, heading, bold, italic, list. **"Saved" waits for the server**: while the server's frames are held back the indicator stays "Saving" (2 s), and when it says "Saved" the server's export has the text. Markdown export shows the structure. Reload: same content, once.                                                                                                                                        |
| `sharing.spec.ts`   | View-only link made in the panel: secret never in a URL; the administrator's typing appears without reload; the guest has no toolbar, typing, deleting and pasting change nothing anywhere, and the API refuses the guest's write; "Browser mode: capture exclusion unavailable" is shown.                                                                                                                                                      |
|                     | Follow Latest for a viewer: off by default (not scrolled), on (scrolled to the change), remembered after reload; not stored for an editor.                                                                                                                                                                                                                                                                                                      |
|                     | Edit link: guest types, administrator sees it and the reverse; the panel shows the connection; **the administrator's browser has a local database under the account id, the guest's has none and nothing of the document in web storage**.                                                                                                                                                                                                      |
|                     | Link changed from edit to view-only while the guest is connected: toolbar gone, role badge and notice updated, typing does nothing; changed back: editing works again.                                                                                                                                                                                                                                                                          |
|                     | Revoke while connected: the guest's screen switches to "access revoked" without reload, the text is off the screen, reload and the link itself get nothing, the API answers the guest with errors.                                                                                                                                                                                                                                              |
|                     | Link with a 12 s expiry: the connected guest is switched to "access expired" on time; the link no longer exchanges; the administrator extends the expired link and the same address works again.                                                                                                                                                                                                                                                |
|                     | Image pasted or dropped by the administrator (upload delayed to see the placeholder): placeholder, then image; the guest gets it from `/api/documents/:id/assets/:assetId` with `200 image/png`; a profile without the cookie gets 401/404. Path used: Chromium and WebKit a paste event, Firefox a drop event (it does not let a script attach a file to a paste event).                                                                       |
| `document.spec.ts`  | Seeded sample document as administrator and as view-only guest: table, highlighted code, checklist, link, Mermaid diagram, image from the asset endpoint; **zero** console errors, page errors and CSP violations (no allowance at all).                                                                                                                                                                                                        |
|                     | Display preferences of a guest (size, width, light): change the guest's view only, nothing reaches the other participant or the document, kept after reload.                                                                                                                                                                                                                                                                                    |
|                     | Links: a reader's click opens a web link in a new tab with no opener and no referrer; a `mailto:` link opens no tab; a `javascript:` address never becomes a link.                                                                                                                                                                                                                                                                              |
|                     | Open in Desktop: the real handoff answer is accepted and followed (Firefox: explained first); no code in the address, in a web request or on the page.                                                                                                                                                                                                                                                                                          |
|                     | Exports download as `<title>.txt`, `.md`, `.zip` (title with a colon and an umlaut) with the right content; print view opens in a new tab and hides its toolbar in print.                                                                                                                                                                                                                                                                       |
|                     | Print view of the sample document: image and diagram far below the fold are loaded without scrolling before "Print" is enabled; the sheet is white.                                                                                                                                                                                                                                                                                             |
|                     | Printing the document screen itself in the dark theme: whole document, light, without the app around it; Chromium writes a PDF of two or more pages.                                                                                                                                                                                                                                                                                            |
|                     | 360px: toolbar usable (including a tool at its far end), no horizontal page overflow, a nine-column table and a long code line scroll inside their blocks, the sharing panel is a sheet, the sample document does not overflow.                                                                                                                                                                                                                 |
| `people.spec.ts`    | Member invited on the People page accepts in another profile: empty list, no "New document", no People, no Trash; added to one document as editor: sees exactly that one in every view and in search, can edit it, cannot manage it; the other document's page, panels and print view show "not found"; its summary, asset, exports, snapshots, shares, access list and collaboration ticket answer `404 not_found`.                            |
|                     | **Sign-out deletes local work.** An editor is cut off (their connection only), types, a snapshot is restored meanwhile: the unsent text is not merged and becomes a recovery draft (listed and previewed in Settings). Sign-out names the draft and deletes the database. The next account in the same profile finds no draft, cannot open the document, and going back shows nothing; the first account signing in again finds the draft gone. |
|                     | **Account switch without sign-out.** Same draft; the session is ended from another profile with "Sign out everywhere else" (which reports one session): the open document is replaced by "Your session has ended" without reload. Another account signs in: no drafts offered, cannot open the document, its sign-out asks nothing and leaves the first account's database; the owner signs in again and the draft is still there.              |
| `snapshots.spec.ts` | Named snapshot saved in the panel; administrator and an editing guest both write more; restore: both screens show the restored text without reload, are told why, move to the next generation, an automatic "before restore" snapshot exists; text typed afterwards reaches the other side and the server; a reload shows the same.                                                                                                             |
| `outage.spec.ts`    | Server killed (and, separately, shut down) while an administrator and an editing guest have the document open: both show reconnecting/offline; text typed then is "pending", and the recorded sequence of the save indicator is exactly Saved → pending (never Saved again) with no "Live"; server back: both reconnect, both texts are merged, present once on both screens and in the export, also after a reload.                            |

`screenshots.spec.ts` (Chromium) walks the real app at 1280, 820 and 360px in both themes: 11
screens × 3 widths × 2 themes = 66 pictures, each also checked for horizontal overflow.

### Mocked-API suite (`apps/web/test-browser`)

Unchanged in purpose: the user interface against a stand-in API whose requests and responses are
validated with the contract schemas. Since this pass the document pages mount the real editor.
The mock has no collaboration server and answers the ticket request with `server_busy`, so the
editor stays in "Reconnecting…" with no content, and these specs assert the app around it:
header, panels, menus, roles, error screens, and the access-ended screens (driven by the ticket
answers `share_revoked`, `share_expired`, `not_found`, `unauthenticated`). The mock grew with the
contract: `POST /api/auth/sessions/revoke-others`, `export?format=json` (rendered by the print
view), wrong current password as `validation_failed` with the issue path `currentPassword`,
`view=recent` as the twelve most recently changed active documents, the server's list orders,
editing an expired link, and `409` for rotating a link that is not active or changing a revoked
one.

**Unit tests** (`apps/web/test`): as before, plus Follow Latest storage, draft file names, the
eager tab value and the "last changed" order of documents.

### Defects found in this pass and fixed

Found by running the real stack and by looking at the pictures.

1. **Print view lost images.** The editor marks images for lazy loading; in Firefox and WebKit an
   image below the fold was never loaded, and "Print" was enabled before the document's blocks
   had mounted. `PrintMount` now asks for every image and waits for images and diagrams.
2. **Print view drew a tinted page inside the white sheet** (the renderer's own surface and
   margins). The document now sits on the sheet.
3. **Dark page margins on paper.** With the dark theme and "Background graphics" on, the PDF had
   dark margins (the page's `color-scheme`). Paper is now light in every theme (`app.css`).
4. **A diagram's title bar was left at the foot of a page**, its picture on the next one.
5. **Printing the document screen itself** (Ctrl+P) printed one clipped screen with the header
   and toolbar. It now prints the whole document without the app around it (`document.css`).
6. **Header at tablet width.** With the real status indicator, "Saved" ran under the Share
   button between 640 and 960px. The status is shown as icons below 960px, and status and
   avatars no longer shrink; the title gives way (checked from 640 to 1400px, also while
   reconnecting with pending changes).
7. **Access-ended screens.** One per cause, in the product's words ("Access revoked", "Access
   expired"): link revoked, link or share session expired (says to open the link again first),
   member removed, account session ended ("Your session has ended", with sign-in). The session is
   checked before the wording is chosen, so the text does not change under the reader.
8. **Dashboard order did not match its labels.** The server orders the active view by
   `updatedAt`, which editing the text does not move, so a document edited a minute ago sat
   below one renamed yesterday while both rows said "Edited …". The active and recent lists are
   now ordered by the latest change of either kind (`src/lib/documentOrder.ts`) and the row says
   "Edited" or "Updated" accordingly. Reported to the lead as a server observation.
9. **Tabs kept in the address** (dashboard, People): a key pressed while the navigation of the
   previous key was still pending was judged against the old tab, leaving focus and selection on
   different tabs. The tab row now shows a choice at once (`useEagerValue`).
10. The toast after revoking an _expired_ link claimed that people were disconnected.

### What was not verified

- Real Safari, a real phone or tablet, touch input, a screen reader. WebKit in Playwright on
  Linux is not Safari.
- HTTPS. The stack runs on plain HTTP on the loopback interface, so `Secure` cookies, `wss://`
  and the policy's `connect-src` for a public name were not exercised here.
- A desktop app receiving the handoff: no desktop build exists on this host. The test ends where
  the browser is asked to open `realtimedocs://…`.
- A PDF as a person saves it was produced in Chromium only (`page.pdf`, every page inspected by
  eye: image, diagram, code colours, link address printed after the link). Firefox and WebKit
  were checked with print media emulation, not with a printed file.
- Idle and absolute expiry of account sessions over real time, rate limits through the
  interface, upload refusals (too large, wrong type), attachments other than images, documents
  near the size limits, and many simultaneous participants. The first three have mocked or
  server-side tests; none ran through the browser against the real server here.
- Real clipboards of other applications (the image scenario builds the file in the page).
- Devanagari and emoji in the sample document were looked at in the Chromium pictures only.

## Server behaviour the app relies on (confirmed in this pass)

- Wrong credentials answer `unauthenticated`. A wrong current password on
  `POST /api/auth/password` is `validation_failed` with one issue whose path is
  `currentPassword`; the form treats only that as "not your current password".
- A document request without any principal answers `unauthenticated`; one for a document the
  account cannot reach answers `not_found` (summary, assets, exports, snapshots, shares, access
  list, collaboration ticket).
- `view=recent`: the twelve active documents that changed last, by content or metadata. `q`:
  case-insensitive title substring. A member asking for `view=trash` gets an empty list; the app
  never asks (members who open `?view=trash` get the active view).
- An expired link can be edited, for example extended; rotating needs an active link; a revoked
  link cannot be changed. The panel offers "Extend or edit" and "Revoke link" on an expired link,
  nothing on a revoked one.
- Revocation, expiry and a role change reach a connected guest without a reload (the tests allow
  15 s; each step took about a second); a restored snapshot moves every connected client to the
  next generation.
- The sharing panel reads everything from `GET …/access` (polled every 15 s while open) and
  patches it with the responses of member and share mutations.
- Archived documents: role capped at viewer; management is still offered when
  `access.via === 'workspace_admin'`; rename and snapshot save/restore are not offered.

## Page setup and print (enterprise phase 3)

- `EditorMount` passes `layout="reading"` in reading mode and `layout="page"` otherwise, plus the controlled
  `pageSetupOpen` / `onPageSetupOpenChange`. The document header has a "Page setup" button (icon-only below
  1180 px, an item in the phone overflow menu), shown when `capabilities.canEdit`; the editor toolbar has the
  same button. The dialog lives in `@realtimedocs/editor` (`PageSetupDialog`).
- The normal document screen is now a sheet (A4, 25.4 mm margins by default) with a ruler for editors. Reading
  mode no longer changes with the per-user reading width (the document screen forces `normal`; the preference is stored and still applies to the desktop panel). The per-user `readingWidth` preference no longer changes the editor
  screen; it applies to reading mode and the desktop panel.
- `/d/:id/print`: `PrintMount` reads `pageSettings` from the JSON export (defaults when absent, e.g. an older
  server), `PrintPage` sets `--print-page-width` and `--print-m*` on the sheet and `usePrintPageRule` inserts
  the `@page` rule (`printPage.ts`). The static `@page` in `app.css` stays as the fallback.
- Not verified here: the web mocked and real-stack Playwright suites (`apps/web/test-browser`, `test-real`)
  were not run in this pass; they assert on the document screen and print view, and the screen's geometry
  changed. Unit project `web`: all tests pass except `test/errors.test.ts`, which fails because of new error
  codes added elsewhere in the upgrade (not this work).

## Known gaps

- **The mocked suite cannot show a document.** Without a collaboration server its document pages
  show the editor waiting to connect. Content, typing and saving are covered by the real-stack
  suite only.
- **Settings and sign-out load the whole editor chunk** (806 kB, 250 kB gzip) to reach the local
  draft store, because the editor package exports the store only from its index. It is one
  download, usually cached from reading a document. A small `./local-store` export in
  `packages/editor` would remove it.
- **Mermaid's ELK layout chunk** (1.5 MB, 459 kB gzip) makes Vite print its chunk-size warning.
  It is a lazy chunk of Mermaid, fetched only by a diagram that asks for the ELK layout.
- **"Your access ends in N days" for guests** shows `access.expiresAt`, which the server sets to
  the earlier of the link's expiry and the share session's end. For a link that never expires it
  therefore shows the session's end (7 days by default), after which opening the link again
  works. The contract does not say which of the two it is, so the interface cannot either.
- **Printing the document screen in the dark theme** keeps diagrams in their dark rendering
  (they are images drawn for the screen). The print view draws everything light.
- **No list of sessions.** Settings can sign out this browser and everything else, not one
  chosen device (the API has no session list).
- **Forgotten password.** There is no self-service reset: RealtimeDocs sends no email. The
  sign-in screen says that the person who runs the server can set a new password with the
  server's `reset-password` command.
- `zod` is still listed in `apps/web/package.json` although only the tests import it now.
- The capture guidance is a dialog in the workspace, not a separate page.
- A share or invitation secret does not survive a reload (by design, see above).
- English only.

## Notes for the other packages

Changed outside `apps/web` in the third pass: `packages/editor/src/react/DocumentEditor.tsx` (the
loading placeholder `.rd-editor__loading` had `aria-label` on a plain `div`, which axe reports as a
serious `aria-prohibited-attr` finding; it now has `role="status"`; editor tests and typecheck
re-run: 10 files, 223 tests pass) and the root `pnpm-lock.yaml` (new dev dependency
`@axe-core/playwright` 4.11.3).

Changed outside `apps/web` in this pass:

- `packages/editor/src/react/SessionStatus.tsx`: the state `access_revoked` is named "Access
  revoked" (it said "Access removed") in the indicator, its tooltip and the banner, as asked by
  the lead, so that editor, web app and desktop panel use the same word.

Worked around in `apps/web`, better solved at the source:

1. **Editor: `StaticDocument` images are `loading="lazy"`.** Right for the editor, wrong for a
   print or preview surface. `PrintMount` flips them to eager; a prop on `StaticDocument` would
   be cleaner.
2. **Editor: print rules.** `break-inside: avoid` is on `.rd-diagram__preview`, not on
   `.rd-diagram`, so the title bar can be separated from the picture (the web app adds the rule
   for its two print surfaces). The language selector of a code block prints as a control.
3. **Editor: a `./local-store` export** (see "Known gaps").
4. **Server: order of `view=active`.** `ORDER BY d.updated_at`, which content saves do not
   touch (`content_updated_at` only). Reproduction: create A, create B, edit A; `GET
/api/documents?view=active` lists B before A, `view=recent` lists A before B. The web app
   orders both views by the later of the two times.
5. **Contracts: `AccessInfo.expiresAt`** does not distinguish link expiry from the end of the
   share session (see "Known gaps").
6. **UI kit: `Tabs` with `activation="auto"`** compares the pressed tab with its `value` prop. A
   host whose value follows a pending navigation has to keep an eager copy (`useEagerValue`).

The seven kit defects listed after the first pass are fixed in `@realtimedocs/ui`, and the
workarounds are gone from the app: `SidePanel` uses the kit's overlay hooks (`useOverlayLayer`,
`useFocusTrap`, `useScrollLock`, `useOverlayFocus`) and shares the kit's Escape stack; header
buttons use `Button pressed`; the restore confirmation is a `ConfirmDialog` with children; links
use the kit's `rd-link`; the anchor handler of `MenuItem` is typed as an anchor's. `SidePanel`
was not replaced by the kit's `Sheet`: it has to be a docked, non-modal region on wide screens
and a modal sheet on narrow ones with the same DOM node, so that a share link shown once
survives a resize; `Sheet` is always modal.

## Version history (`features/history`)

Administrator screen at `/d/:documentId/history` (lazy route inside the signed-in layout; the page
fetches the document and shows the forbidden screen unless `documentCapabilities(...).canManage`).
Entry points: `HistoryHeaderLink` / `HistoryMenuItem` (`HistoryLinks.tsx`), used by `DocumentHeader`.
User and admin guide: `docs/version-history.md`.

- `model.ts`: pure helpers (operation labels, summaries, day/editor grouping, interleaving of
  administrative events, diff folding). `test/history.test.ts` fails when a value of
  `HISTORY_OPERATIONS` has no label.
- `HistoryPage.tsx` (filters, infinite query, `?rev=` selects a revision so Back works on a phone),
  `Timeline.tsx` (list of buttons, Up/Down/Home/End, one tab stop), `RevisionDetail.tsx` (facts,
  Changes/Preview tabs, name / restore / copy / download), `RevisionPreview.tsx` (lazy chunk with
  `StaticDocument`).
- Restore is `api.history.name` (automatic name) followed by `api.snapshots.restore`; there is no
  history-specific restore endpoint.
- Mocked suite: handlers in `test-browser/support/mockApi.ts` (`history`, `historyEvents`,
  `historyPageSize`, `historyRetentionDays`), data in `test-browser/support/historyFixtures.ts`,
  spec `test-browser/history.spec.ts`.

## Desktop download (phase 5)

- `features/landing/platform.ts` (pure, `test/platform.test.ts`): `navigator.userAgentData` (platform, then
  `getHighEntropyValues(['architecture','bitness'])`) -> user-agent parsing -> unknown. `navigator.platform` is
  never read. Phones, tablets (an iPad in desktop mode is told apart by touch points) and Chromebooks get
  "not available for this device". A Mac's architecture is never claimed as detected (Apple Silicon reports
  Intel): the page defaults to Apple Silicon or universal, says so, and always offers "Choose another platform".
- `features/landing/downloads.ts` picks the file with `pickArtifact` from `@realtimedocs/contracts` (same rules as
  the server: `.exe` only if signed, `.dmg` only if notarised, Windows on Arm may get x64, macOS may get
  universal). A platform without a build shows "No release published for <platform> yet" and no link. The
  legacy `GET /api/downloads` listing is used when the versioned list is empty (signature then shown as "not
  stated").
- Pages: `DownloadSection` (landing), `/download` (`DownloadPage`: every file, requirements, release history),
  `/releases/:version` (`ReleaseNotesPage`, notes rendered by the guide Markdown renderer; only absolute https
  links), `/admin/releases` (`AdminReleasesPage`, read-only, with the operator workflow).
- Mocked suite: `test-browser/support/mockApi.ts` gained `desktopReleases` and `adminReleases`; the landing
  specs were rewritten (`landing.spec.ts` "downloads"). **Not run:** the mocked Playwright container
  `rd-web-pw` / port 4435 was in use by another agent when this was finished. `tsc` and `vitest --project web`
  were run.
