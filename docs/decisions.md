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
- **Resolution (2026-11-12): fixed.** The cause was found: after a remote change, `@tiptap/y-tiptap` 3.2.0
  re-places a caret that sits at the start of a text block by guessing "the n-th block with this type and
  text". When another editor had just added an identical block (an empty paragraph) before it, the caret
  moved into the other person's paragraph and the next keystrokes landed there. The shared Yjs document
  was always correct; no content was lost or duplicated at the CRDT level, no schema was corrupted and
  nothing diverged. The fix is the `CaretKeeper` plugin in `packages/editor/src/editor/collabPlugins.ts`,
  which keeps the exact Yjs relative position when the block it points into still exists, so no change
  inside the binding package was needed. Tests: `packages/editor/test/concurrent-enter.test.ts` (4 tests)
  and `tests/e2e/specs/convergence.spec.ts` "simultaneous Enter", which is now an ordinary test (no
  `test.fail`, no `E2E_SHOW_KNOWN_DEFECTS`) and passed in Chromium, Firefox and WebKit. The entry above is
  kept as the record of the decision at the time; see `docs/testing.md` §5.1.

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

## Page settings live in the Yjs document, as a flat `page` map (2026-11-12)

- Page size, orientation, margins, unit and colour are stored in a top-level `Y.Map` named `page` in the
  document's own Y.Doc rather than in a database column or a Yjs-external API. That gives live sync, durability,
  snapshot / restore / duplicate inclusion, offline merge and read-only enforcement with no new server code.
  An empty map means defaults, so no schema version bump is needed: older clients simply ignore it.
- Lengths are stored in millimetres only; the unit is a shared display preference. Every value is untrusted and
  normalised on read (clamp, round to 0.1 mm, keep a 50 mm text area); backgrounds are an allow-list of names.
- Margin changes join the writer's own Y.UndoManager (map added to its scope), one undo step per gesture,
  never reverting a collaborator.
- The page is one continuous sheet, not paginated, and narrow screens use a fluid sheet with proportionally
  smaller margins instead of CSS zoom / transform, to keep ProseMirror's caret and selection geometry exact in
  every engine.
- First-line and hanging indent markers are not implemented: they need a per-paragraph length attribute, which
  is a schema change and a schema version.

## Desktop distribution: versioned releases, verified downloads, no silent self-update (2026-11-12)

**Update 2026-11-13:** implemented as document schema 3 (`indentLeft`, `indentRight`, `indentFirstLine` on paragraphs and headings, three ruler markers); older clients are disconnected from a schema-3 document and told to update.

- **Files on disk, not a database.** Releases are directories under `DOWNLOAD_DIR` written by an operator
  script; the server only reads and verifies them. The only database addition is an anonymous counter table
  (`release_download_counts`: day, channel, version, platform, arch, format, count). Rollback is a pointer
  change, previous releases are never deleted, and a published version is immutable (so artifact URLs can be
  cached forever).
- **The server never infers signing.** `signatureStatus` is what the operator states; the publish script
  records `unsigned` unless `--signed-windows` / `--notarized-macos` is given, and the release workflow
  measures the status on the built files (Authenticode, `codesign`, `stapler`) before choosing the flags.
  Installers are preferred over zips only when the status justifies it (`.exe` if signed, `.dmg` if
  notarised).
- **Trust nothing on disk.** The manifest is zod-validated, names must equal the generated pattern, files
  must be regular files (links refused), sizes must match and the SHA-256 is verified once; a mismatching
  file is simply not offered. Requests resolve files only through the loaded manifest.
- **Update URLs are paths.** `downloadUrl` is a path on the same server; the desktop app resolves it
  against its configured origin and refuses anything else (other host, credentials, query, different
  version or file name, redirects).
- **No in-place self-replacement.** An updater that replaces the running app needs signed builds so that
  the operating system can vouch for the replacement; none exist, and an unsigned auto-updater would let a
  tampered mirror or a hostile server run code on the user's machine. The app checks, downloads on request,
  verifies size and SHA-256 and hands the verified file to the user. No `electron-updater` or Squirrel
  dependency was added. Revisit when Windows and macOS signing credentials exist; the hook is
  `UpdateService.reveal('open-installer')`.
  **Superseded on 2026-11-13** by "In-place update on request" below.
- **Install id is a random UUID** in `update-state.json` (not in the preferences schema, which is strict
  and versioned), used only for the staged-rollout hash; it identifies no person.
- **Tray menu unchanged.** The tray labels are the owner's specification and are pinned by tests, so
  "Check for updates" lives in Settings -> Updates, which the existing "Settings" entry opens.
- **Error code.** `RELEASE_NOT_AVAILABLE` (HTTP 404) was added to the shared error enum in the spelling
  the requirement gave, although the other codes are lower case.
- **Linux gets `.tar.gz` and `.zip`, no AppImage**: `appimagetool` and FUSE are not part of the pipeline.
- **CI is written, not run.** `ci.yml` and `desktop-release.yml` could not be executed here. (Update, 2026-11-12: both were executed on GitHub; `ci.yml` passed and `desktop-release.yml` succeeded on four runners after three earlier runs failed and were fixed. See `docs/desktop-release.md`.)

## Enterprise upgrade: decisions of the lead (2026-11-12)

Plan and audit: [enterprise-upgrade-plan.md](enterprise-upgrade-plan.md).

- **Uploads wait instead of failing.** A transient failure (rate limit, network, busy server) puts the
  file back in the queue with capped exponential backoff (1 s doubling to 60 s, 8 attempts); a rate-limit
  answer pauses the whole queue for the time the server names. Identical files (SHA-256) are sent once
  per editor and share the stored asset. `RATE_UPLOAD_PER_MINUTE` default raised from 60 to 240: the limit
  exists to bound abuse, and size, type and the per-document quota already bound storage. Rejected: no
  limit at all (one session could then occupy the upload path), resumable chunked uploads (the largest
  file is 25 MB; a restart of one file is cheap, and a second upload protocol is not).
- **Unsupported content pauses editing, names itself and clears.** The collaboration binding can keep
  content it cannot render, but it cannot write around it, and an older client silently erases attributes
  it does not know when it edits their node. So the editor scans the shared document, pauses editing in
  that window while anything unknown is present (nodes, marks **and** attributes), says what it found and
  how to get the current version, and resumes by itself when the content is gone. Rejected: per-node
  placeholders with editing left on. That needs a patched binding that maps unknown elements to a
  placeholder node and back without rewriting them; a mistake there deletes content, which is the one
  outcome this feature exists to prevent. Recorded as a limitation.
- **History is a second, append-only log written with the working log.** `doc_updates` stays what it was
  (compacted, per generation). `doc_history` gets one row per actor per commit, in the same SQL statement
  as the commit, plus complete checkpoints (first change of a generation, then every
  `HISTORY_CHECKPOINT_EVERY` rows at a compaction). Actor and timestamps come from the server's
  authenticated connection and clock; the client's time and its "this is a paste" label are stored as
  untrusted information. Rejected: deriving history from `doc_updates` (deleted on compaction and
  restore), client-reported audit events as the source of truth, and partitioning (no volume yet that
  justifies it; the retention sweep and the primary key cover the access paths).
- **Restoring a revision is a new generation.** A revision is turned into a named snapshot and restored
  through the existing path. The head moves forward; earlier rows, including the abandoned ones, stay.
- **Assets live as long as a retained revision shows them.** The asset sweep counts every asset a
  retained history row added and every asset in a retained checkpoint as referenced.
- **Several instances: one owner per document, sockets forwarded to it.** With `REDIS_URL`, a Redis
  lease names the instance that holds a document; an instance that receives a socket for a document it
  does not own pipes it to the owner over the private network. The single-writer durable log, the
  acknowledgement protocol and presence are unchanged, which is why this was chosen over fan-out of
  updates between instances (Hocuspocus' Redis extension): that needs every instance to write the log of
  the same document, a compaction that no longer trusts memory, and a new answer to "is this saved" for
  content that arrived from a peer. If two instances ever believe they own a document, the database's
  `head_seq` check refuses the second writer and its clients reconnect; the lease only decides routing.
  Tickets (`GETDEL`), rate-limit counters and revocation messages go through the same Redis. Without
  `REDIS_URL` nothing changes. Cost: one extra hop for sockets that land on a non-owner, and Redis as a
  dependency of new connections (open documents keep saving while it is away).
- **Rate limits fail open when Redis is unreachable.** A limiter that cannot count allows the request and
  logs it. Refusing every sign-in during a Redis restart would turn the failure of a helper into an
  outage; the exposure is a short window without throttling.
- **No rewrite in another language.** Measurements before this upgrade: 10 editors used 5 % of one core.
  The load tests in [load-test-report.md](load-test-report.md) decide whether a bottleneck exists that
  the current stack cannot remove; none was assumed.
- **Metrics without a client library.** `GET /metrics` (Prometheus text) is a small in-process registry,
  off unless `METRICS_TOKEN` is set, with label values from fixed sets only.

## Service API and interview sessions (phase 2)

- **Identifiers are bare UUIDs everywhere**, including `sessionId` and `documentId` in `/api/v1`. Existing
  documents, routes and the web app use bare UUIDs; a prefixed form (`doc_…`) would need translation at
  every boundary. Cost: ids are not self-describing in logs. The prefix is only used for API keys (`rdk_`),
  webhook secrets (`whsec_`) and request ids (`req_`).
- **A participant's link is an ordinary share grant** (`share_grants.participant_id`). Expiry, hashed secret,
  revocation, rotation and live disconnection are reused; nothing new can bypass `resolveAccess`. Rotation
  creates a new grant and revokes the old one (kept as history); the participant row points at the current one.
- **Participant permissions live in `resolveAccess`.** It joins grant → participant → session and returns
  `participant` and `capabilities`. Routes enforce them (export 403, desktop handoff 403, collab role from
  the grant role). `candidateCanEdit`/`interviewerCanEdit` set the grant role (`editor`/`viewer`) and are
  re-applied on PATCH. `candidateCanShare` is stored and reported but no participant can create share links
  (that needs workspace admin), so it has no effect today. `candidateCanViewHistory` only gates future
  history routes; the snapshot routes already require an administrator.
- **API keys are only valid on `/api/v1/*`.** A bearer token starting `rdk_` is recognised first and never
  looked up as a desktop session; the request ignores cookies, cannot pass `requireAccount`/`requireAdmin`,
  and `requireService(scope)` rejects it on other paths. Hash: SHA-256 of the full key with constant-time
  comparison (the key is 256 bits of randomness, so a slow hash adds nothing). Failures return one generic
  `UNAUTHENTICATED` except a disallowed address (`FORBIDDEN`). Failed attempts are throttled per address and
  audited without the secret. Rotation revokes the old key at once (no overlap period).
- **Idempotency keeps an encrypted response for 24 h.** AES-256-GCM, key derived with HKDF from
  `SESSION_SECRET` per purpose, so a replay returns identical links. Changing `SESSION_SECRET` makes stored
  responses and webhook secrets undecryptable (replays fail, webhook deliveries fail until the endpoint is
  recreated). The claim row is a unique insert; completion is written in the creating transaction, so a crash
  leaves either nothing or the full result. Failed requests release the key. A claim older than two minutes
  with no result is taken over.
- **Closed sessions.** Complete/cancel revoke the candidate's links and the candidate gets `session_closed`
  (410). Interviewers keep read-only access (role capped to viewer in `resolveAccess`) until expiry, so notes
  can still be read. Archive revokes everyone and archives the document. Start allowed only from
  `scheduled`; complete only from `in_progress`; cancel from either; archive from anything but `archived`.
  A joined link can be opened while `scheduled`.
- **Title.** Generated once, kept in `interview_sessions.generated_title`, never regenerated when the schedule
  changes; uniqueness is checked against non-trashed documents (case-insensitive) without a database
  constraint, so two simultaneous creations with identical inputs could collide (accepted, 1 in 1 million
  chance of equal suffix is irrelevant; the check merely reduces confusion).
- **Webhooks.** A table queue claimed with `FOR UPDATE SKIP LOCKED` plus a lease (`next_attempt_at` pushed out
  while an attempt runs) so the HTTP call holds no transaction. Events are inserted in the transaction of the
  change. `participant.joined` fires on a participant's first join only. `document.first_edited` is emitted by
  `emitDocumentFirstEdited(ctx, documentId)` (exported from `service/sessions.ts`), idempotent through
  `interview_sessions.first_edited_at`; the collaboration server calls it with the first applied edit of each loaded document (`onFirstEdit` in `main.ts`). Total attempts =
  schedule length + 1. SSRF: https only (http for localhost outside production), production resolves and
  refuses non-public addresses at registration and again at connect time (custom `lookup`), no redirects.
- **OpenAPI from the registry.** Every `/api/v1` route is declared once with its zod schemas and examples;
  the same declaration registers the Fastify route and the spec. Admin mirrors (`/api/admin/…`) reuse the
  handlers and are not in the spec. Spec examples are validated against the schemas in a unit test.
- **`/guides/:name`** replaces `/docs/:name` for the in-app markdown reader; `/docs` is the developer portal.
  Old URLs redirect on the client.
- Known gap: `/d/:id/print` is hidden for candidates without export, and the data it needs (`export?format=json`)
  is refused by the server, which is the real control.

## In-place update on request (2026-11-13)

- **The owner asked for it.** After using 0.1.2 the owner wanted an update to be one action: show that a
  new version exists, download it, install it and restart into it. The decision of 2026-11-12 ("no
  in-place self-replacement") is reversed for a user-started update. There is still no silent mode:
  nothing is installed without a click on "Update and restart".
- **Trust statement.** The builds are unsigned, so an update rests on the configured server (HTTPS) and
  the SHA-256 it announces. Whoever controls that server can ship code to the desktops that update. That
  was already true of the manual download; the difference is that the person no longer handles the file
  and macOS no longer shows its first-open check for the new version. Accepted by the owner's request;
  signing remains the way to add an independent check.
- **Own swap instead of `electron-updater` or Squirrel.** Both expect signed installers and their own
  package formats; the releases are plain archives. The swap is two renames next to the installation,
  done by a helper script after the app has exited, with the previous version kept until the new one
  runs and moved back otherwise.
- **The helper must be running before the app quits.** If PowerShell is blocked by policy the app stays
  up and says so, rather than quitting into nothing.
- **Fallback, never elevation.** Translocated, read-only, installer-made and AppImage copies, and folders
  that hold other files, get the manual download with the reason.
- **Tray menu.** One entry is added while an update is on offer ("Update to version …"); the pinned
  labels are unchanged.
- **Not verified on Windows and macOS when written:** the code for both was written on Linux. The check
  script and its workflow exist to find out on native runners.
