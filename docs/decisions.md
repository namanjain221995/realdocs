# Decisions and assumptions

Short record of choices made without asking, with the evidence behind them.
Dates are 2026-11-10 unless noted.

## Environment

- **This workspace is a remote Linux server** (Ubuntu 24.04, aarch64, SSH session, no display, no sudo).
  It can host the backend and run browser tests in containers. It cannot display an overlay on the
  user's Windows or macOS computer and cannot execute Windows or macOS binaries. Native desktop
  behaviour and meeting-capture checks are therefore recorded as pending/NOT TESTED until run on
  those machines.
- No amd64 emulation is registered (`binfmt_misc`), so only arm64 containers run here.
- Unrelated services occupy many ports; RealtimeDocs defaults to `4310` (server), `4311` (web dev),
  `54310` (PostgreSQL), all bound to `127.0.0.1`.

## Toolchain

| Choice                                                                                  | Reason                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js **24.22.2** LTS, installed project-locally in `.toolchain/` (checksum verified) | The host's Node 20.20.2 is end-of-life; Vitest 5, Hocuspocus 4, Electron 45 tooling and React Router 8 require Node ≥ 22. Node 24 also provides built-in Argon2id (`crypto.argon2`), avoiding native add-ons. |
| pnpm **12.18.0** via Corepack                                                           | Current release; workspace + lockfile. Its minimum-release-age policy is kept on, so a few packages are pinned one release behind "latest".                                                                   |
| TypeScript **6.0.3** (not 7.0.2)                                                        | `typescript-eslint` 8.72 supports `<6.1`; type-aware linting matters more than the native compiler.                                                                                                           |
| Tiptap **3.32.3** + `@tiptap/y-tiptap` **3.2.0**                                        | 3.33.1/3.3.0 were published hours before the build (rejected by the release-age policy); y-tiptap ≤3.0.12 is deprecated upstream for document growth.                                                         |
| Hocuspocus **4.8.0**, Yjs 13.6.33                                                       | Current maintained major; v4 processes each connection's messages strictly in order and has a `beforeHandleAwareness` hook, both of which the design relies on.                                               |
| Playwright **1.64.1** (not 1.65.0)                                                      | Matches the `mcr.microsoft.com/playwright:v1.64.1-noble` image already on the host (Chromium, Firefox, WebKit, Xvfb).                                                                                         |
| PostgreSQL **17.11** (`postgres:17.11-alpine`)                                          | Maintained major, image already present.                                                                                                                                                                      |
| Electron **45.2.3** + `@electron/packager` 20.3.0                                       | Current stable line (supported until Electron 48). Packager is Electron-maintained, edits Windows resources without Wine, and can cross-package unsigned bundles; installers/signing run on the native OS.    |
| No Redis/Kafka/Kubernetes                                                               | One backend, one collaboration instance (see architecture §10).                                                                                                                                               |

## Product assumptions

- One workspace per deployment; the schema and every query still carry `workspace_id`.
- Roles: workspace `admin` or `member`; per-document `editor` or `viewer`; share links grant `viewer`
  (default) or `editor`. Only administrators manage documents, memberships, links, invitations and snapshots.
- Archived documents are read-only for everyone; trashed documents are unreachable until restored and
  are purged after 30 days.
- Share-link secrets are shown once (only hashes are stored). Rotation = revoke + new grant.
- Share-link guests get a server-generated display name; they never persist document content locally.
- "Open in Desktop" yields a document-scoped desktop session; administration stays in the browser.
- Remote images in pasted HTML are not fetched (no server-side fetch, strict client CSP); they become
  labelled links and are listed in the paste report. Embedded `data:` images are uploaded as assets.
- SVG uploads are accepted only if they pass a strict allow-list validation; otherwise rejected.
- Exports: plain text, Markdown (optionally zipped with images), ProseMirror JSON, and a print view
  for "Save as PDF". No DOCX export.
- Transparent-window resizing uses renderer-driven `setBounds` (grips, presets, keyboard) because
  native resizing of transparent windows is documented as platform-dependent and could not be
  verified natively from this host.

## Process

- Git is not used by this build (the directory is not a repository; the task forbids Git mutations).
- Work was split across parallel agents with disjoint directory ownership (`docs/notes/build-brief.md`);
  the lead integrates, reviews and re-runs verification.

## Decisions taken while integrating (2026-11-11)

- **Forgotten passwords are recovered by the operator**, not by e-mail: `pnpm reset:password --email <address> --generate`
  (container: `docker compose exec server realtimedocs reset-password …`). The product sends no e-mail at all,
  so a self-service reset link would need a delivery channel that does not exist. Signed-in users can
  change their password and end their other sessions (`POST /api/auth/sessions/revoke-others`).
- **`pnpm setup:env` trusts the Vite development origins only for a loopback setup.** With
  `--public-origin https://…` it writes an empty `ALLOWED_ORIGINS`, because every origin on that list is
  trusted like `PUBLIC_ORIGIN` for cookie sessions.
- **Collaboration frame budget:** 300 frames per second sustained with a burst of 1500 per socket
  (`COLLAB_FRAMES_PER_SECOND`, `COLLAB_FRAME_BURST`). The first value (80/s) would have disconnected an
  honest client during fast typing, because each local change sends an update frame and an acknowledgement
  marker.
- **Server and link hosts use a conservative grammar.** The URL standard accepts characters such as `;`,
  `'`, `"`, `,` and `*` in host names; `normalizeServerOrigin` and `sanitizeLinkHref`
  (`packages/contracts/src/urls.ts`) reject them, as well as backslashes and, for server origins, underscores
  and a trailing dot. Reason: origins are interpolated into headers and content-security policies.
- **Attribute values in a shared document are treated as untrusted at render time.** Another editor's client
  can write any JSON value into any attribute through Yjs. The schema (`packages/editor/src/schema/nodes.ts`)
  validates every attribute again when it renders, and the editor has its own guard for the values it turns
  into URLs, styles and layout. Residual risk, accepted and documented in `docs/security.md`: someone with
  edit rights can still make a document unusable for its readers (for example with extreme table spans or
  sheer size); viewers cannot.
- **Image dimensions are probed on a private copy of the bytes** (`apps/server/src/assets/dimensions.ts`),
  because `image-size` 2.1.0 reads past the end of a view into the underlying buffer.
- **zod runs in `jitless` mode in browsers and in the desktop renderer** (`packages/contracts/src/zod.ts`), so
  the strict content-security policy is never probed with `new Function`. Servers keep the compiled validators.
- **Desktop sessions never carry management rights.** An administrator's desktop session acts as an editor of
  that one document; administration stays in the browser.
- **Share exchange always creates a new guest session**; the per-document share cookie is path-scoped and is
  never presented to the exchange endpoint.

## Public deployment through a Cloudflare Tunnel (owner's request, 2026-11-11)

- The original assignment kept public deployment out of scope. On 2026-11-11 the owner asked
  explicitly to run the stack with Docker and publish it through their Cloudflare Tunnel at
  `https://realdocs.techsarasolutions.com`, and supplied the connector token. That request overrides
  the earlier rule for this hostname only; nothing else is published.
- Layout: everything for this deployment lives in `deploy/` (mode 700). The connector token is in
  `deploy/.env.tunnel` and the generated database password and session secret are in
  `deploy/.env.production` (both mode 600, excluded from Git and from the Docker build context).
  No `.env` is created in the repository root, because test suites would pick it up.
- The connector runs as a third container in the same Compose project and reaches the application at
  `http://server:4310` on the private Docker network. No extra host port is opened and host networking
  is not used. TLS ends at Cloudflare's edge.
- `PUBLIC_ORIGIN=https://realdocs.techsarasolutions.com`, `ALLOWED_ORIGINS` empty, `TRUST_PROXY=1`
  (one proxy hop) so rate limits see the visitor's address instead of the connector's.
- The application was still in its integration pass when it was first published; the acceptance suite
  had not been run against it. That state is reported to the owner as it is.

## Private presenter mode on by default (owner's use case, 2026-11-11)

- The owner's primary use case is personal meeting notes shown in the desktop panel while they share
  their screen. Forgetting to switch private mode on is the most likely way notes would end up in a shared
  screen, so the desktop panel now starts with private mode ON; a user who explicitly turned it off keeps
  that choice. It stays optional and toggleable, as the requirement says.
- The product never claims the panel is hidden from meetings. The reliable method, recommended first in
  the app, on the landing page and in the client guides, is to share a single application window (or keep
  the notes on an unshared display or device). Private mode is described as an extra layer: usually
  effective on Windows 10 version 2004 and later, not reliable on macOS (ScreenCaptureKit), never
  effective against a camera, to be tested once with a second participant.
- Side effect, stated in the app: with private mode on, the panel is also missing from the user's own
  screenshots and recordings.

## Owner's continuation spec (2026-11-11): presenter notes with honest protection status

- Architecture stays TypeScript/React/Electron/Fastify/PostgreSQL/Tiptap/Yjs. Native code only where
  Electron cannot report what is needed: a minimal Windows Node-API module (own top-level windows only,
  checked inside the module) reads `GetWindowDisplayAffinity`, sets the affinity, reads
  `DwmIsCompositionEnabled` and waits with `DwmFlush`. It is optional; without it the app uses Electron's API.
- Protection status has two layers (`apps/desktop/src/shared/privacy/status.ts`, the single source of the
  strings): a local request layer (Unsupported, Protection unavailable, Protection off, Protection request
  failed, OS protection accepted) and a verification layer (Manual verification required, Verified for this
  exact configuration, Verification expired after version change). "Protection off" is an addition to the
  owner's list: it is the user's choice, not a failure.
- Verification exists only per exact configuration and only with a second participant's or device's
  observation, recorded in the in-app Privacy Test Center. Records expire on detected OS/Electron/app changes,
  on user-entered browser or meeting-app version changes, and after 30 days.
- Presenter mode omits the panel from the Windows taskbar and the macOS Dock (accessory activation policy) by
  default, with the tray / menu-bar item, a global shortcut and "Return to interactive mode" as recovery.
- Out of scope by the owner's safety boundary: process-name concealment, hiding from Task Manager or Activity
  Monitor, proctoring or lockdown-browser bypass, tab-switch-detection bypass, interview-monitoring evasion,
  meeting-client injection, capture-API hooking, security-tool evasion, stealth drivers, and "verified"
  results without remote evidence.

## Owner's final continuation prompt (2026-11-11)

- Status wording follows the newest prompt: "Verification expired after version change"; the observed
  outcomes gain "partly visible"; Lark and Amazon Chime join the meeting-application list and the matrix.
- Optional self-service sign-up exists behind `ALLOW_SIGNUP` (default off). A signed-up account is a
  workspace member with no document access until an administrator adds it; the first administrator is still
  created only by the one-time CLI command.
- Download metadata (`GET /api/downloads`) is computed from the files the server actually holds (size,
  SHA-256, time) plus an optional operator-written `release.json`; the server never claims a build is signed.
  An empty list is shown as "release not published", never as a fake link.
- The landing page's compatibility matrix is fed only by verified evidence records; every other cell reads
  "Not tested".
- Callouts join the document schema as schema version 2; documents edited by a version-2 client are raised
  to version 2, after which version-1 clients receive `update_required` instead of silently dropping content.
- The desktop app opens a document either in a normal window or in Private Presenter Mode.

## Known defect left open: simultaneous Enter (2026-11-11)

- The acceptance suite found that Enter pressed by several editors at the same instant, in the same or
  adjacent paragraphs, leaves converged but wrong content. It was not fixed in this build: the cause is in how
  the Yjs–ProseMirror binding maps a paragraph split, a fix would need changes inside that binding or an
  upgrade that is not yet allowed by the release-age policy, and a partial workaround could corrupt more than
  it fixes. The defect is documented in `docs/status.md`, `docs/testing.md` and the README's limits, and pinned
  by an expected-failure test that turns red as soon as it is fixed.
- Two WebKit-only races in the editor's own browser check (`callout-toolbar`) were test problems, not product
  problems, and were fixed in the check without weakening its assertions (`docs/testing.md` §5.2).

## Browser "invisible mode": not possible; floating notes instead (2026-11-11)

- The owner asked for the desktop app's private mode in the web app. A web page cannot ask the operating
  system to exclude its window from screen capture: browsers expose no such API, deliberately, because a page
  that could hide from screen sharing would be an abuse tool. Workarounds that exploit unrelated browser
  features are fragile and outside this product's permitted-use boundary, so none is built.
- Built instead: a floating, always-on-top notes window (Document Picture-in-Picture in Chromium-based
  browsers; a separate popup window elsewhere). It reuses the open collaboration session, is read-only, has a
  neutral window title, and while it is open the browser tab shows a placeholder instead of the document.
- The app says plainly that the floating window is visible in an entire-screen share. The reliable method on
  the web is to share a tab or a window; for entire-screen sharing the options are the desktop app's private
  mode on Windows or a second device.
