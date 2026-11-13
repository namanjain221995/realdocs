# Security

This document is for a reviewer who has to decide whether to trust RealtimeDocs with real
documents. It states what the product defends against, how each defence works and where it lives in
the code, how it was checked, and what remains weak or unverified. It makes no blanket claim. The
last two sections list the limits and the residual risks in plain terms; read them even if you skip
the rest.

Terms used below: a **principal** is whoever a request acts for (a signed-in account, a share-link
guest, or a desktop session). An **origin** is the scheme, host and port of a web address taken
together. A **hash** is a one-way fingerprint of a secret; the server stores the fingerprint, not
the secret.

## Scope and threat model

**What is protected**

- Document content, snapshots and uploaded files: only principals with a current permission may
  read them, and only principals with a current edit permission may change them.
- Accounts: passwords, sessions and the administrator role.
- Share links and invitation links: knowing a document's identifier must never be enough.
- The reader's computer: document content must not be able to run code in the browser, in the
  desktop app or through the desktop app on the operating system.
- The truth of the "Saved" indicator.

**Who is assumed to attack**

- Someone on the internet without any credential, guessing identifiers, links and passwords.
- A holder of a view-only link who tries to edit, to reach other documents, or to keep access
  after the link was revoked.
- A member account that tries to reach documents it was not given.
- **An editor of a document who attacks the other people reading it**, by writing hostile content
  (HTML, links, diagram source, files, raw attribute values) into the shared document.
- A web page in the reader's browser that tries to act with the reader's session, or to drive the
  desktop app through a `realtimedocs://` link.
- Someone who can read or alter network traffic. The defence against this is TLS, which the
  deployment has to provide ([deployment.md](deployment.md)); the server does not do TLS itself.
  Whoever terminates TLS can read the traffic: your own reverse proxy, or a provider when the
  product is published through that provider's tunnel. The deployment on the build server is of
  the second kind: TLS ends at Cloudflare ([deploy/README.md](../deploy/README.md)).

**Who is trusted**

- The operator: whoever controls the server machine, the database, the file volume, `.env` and the
  backups can read everything. Documents are not encrypted at rest and there is no end-to-end
  encryption.
- Workspace administrators: they can open and manage every document.
- The reader's own computer and browser, and the software running on it.

**What is outside what the product can do**

- Content that has already reached someone stays with them. Revocation and expiry stop future
  access; they do not erase what was received, copied, exported or photographed.
- Screen capture. The desktop app can ask the operating system to leave its own windows out of
  capture; that request is not a security control, and on macOS it cannot be relied on at all. See
  [capture-compatibility.md](capture-compatibility.md).

## Authentication

Code: `apps/server/src/auth/`, `apps/server/src/http/routes/auth.ts`, `apps/server/src/cli.ts`.

- **Passwords** are hashed with Argon2id through Node.js' built-in `crypto.argon2`: 64 MiB of
  memory, 3 passes, parallelism 1, a random 16-byte salt per password and a 32-byte result. The
  parameters are stored with each hash; a hash made with weaker parameters is replaced at the next
  successful sign-in. Parameters read back from storage are bounded, so a tampered hash cannot make
  a sign-in allocate gigabytes. At most four hashes are computed at once and 64 wait; beyond that
  the server answers "busy". Passwords must have 12 to 256 characters. Comparison is constant-time.
- **No default credentials.** The first administrator is created by a local command
  (`bootstrap-admin`) that refuses to run once any account exists; the check is repeated under a
  database lock. The password is typed at a hidden prompt, piped in, or generated and printed once.
- **Sign-in failures look the same.** An unknown email address, a wrong password and a disabled
  account get the same message, and an unknown address costs the same hashing work as a real check,
  so timing does not show which addresses exist.
- **Sessions.** A session token is 32 random bytes. The server stores only its SHA-256 hash. The
  browser holds it in the cookie `rd_session`, which is `HttpOnly` (scripts cannot read it),
  `SameSite=Lax`, scoped to `/`, and `Secure` whenever `PUBLIC_ORIGIN` is an `https://` address.
- **Expiry** is enforced on every request: an account session lasts at most 14 days and ends after
  3 days without activity. Share-link guest sessions: 7 days and 1 day, and never beyond the link's
  own expiry. Desktop sessions: 30 days and 14 days. All six values are configurable.
- **Ending sessions.** Signing out ends that session and the desktop sessions derived from it.
  Changing the password ends every other session of the account. "Sign out everywhere else" in the
  web app's settings does the same without a password change
  (`POST /api/auth/sessions/revoke-others`). Disabling an account ends all its sessions. The
  operator's `reset-password` command ends every session of the account.
- **Rate limits** count failed sign-ins per client address (20 in 5 minutes) and per email address
  (8 in 15 minutes), failed share-link exchanges per address and per link, failed invitation
  look-ups, failed desktop code redemptions, connection tickets, uploads, WebSocket connections and
  all API requests per address. The numbers are in
  [deployment.md](deployment.md#rate-limits). The counters live in the server's memory.
- **Not present:** multi-factor authentication, single sign-on, email verification, a self-service
  password reset and a check of new passwords against lists of leaked ones.

## Authorization

Code: `apps/server/src/access/resolve.ts`, `apps/server/src/http/auth.ts`.

- **One function decides.** Every HTTP route that touches a document, every upload, download,
  export and snapshot operation, every collaboration ticket and every re-check of a live connection
  calls `resolveAccess`. Nothing else reads memberships or share links to make a decision.
- **Roles.** A workspace administrator signed in through the browser is `admin` on every document:
  edit and manage. An account that was added to a document is `editor` or `viewer` there. A share
  link grants `viewer` (the default) or `editor`. A desktop session never carries management
  rights: an administrator's desktop session acts as an editor of that one document. When a request
  presents several valid permissions, the highest role wins and the server records which permission
  produced it, so revoking one never affects another.
- **The role is never taken from the client.** It is resolved from the database for each request
  and again when a live connection is opened or re-checked.
- **Unknown and forbidden look the same.** A signed-in principal who asks for a document it may not
  reach gets the same `not_found` answer as for a document that does not exist, including for a
  malformed identifier. Without any session the answer is `unauthenticated`. An uploaded file is
  found only through the document it belongs to.
- **Scope.** Share-link sessions and desktop sessions are bound to one document and are useless for
  any other. Every database table carries a workspace identifier, every query filters by it, and
  foreign keys tie memberships to the workspace of both the account and the document.
- **Archived documents** are read-only for everyone, administrators included; only lifecycle
  actions keep working. **Trashed documents** cannot be reached at all except by the
  administrator's restore and delete actions.
- **Administration.** Only administrators create documents and manage members, links, snapshots,
  invitations and accounts. An administrator cannot change their own role or status, and the last
  active administrator cannot be removed.

## Share links and invitations

Code: `apps/server/src/http/routes/shares.ts`, `invitations.ts`, `desktop.ts`;
`apps/web/src/lib/capability.ts`; `packages/contracts/src/links.ts`.

- **Shape.** A share link is `https://<host>/s/<linkId>#<secret>`. The secret is 32 random bytes
  and sits in the fragment, the part after `#`, which browsers do not send to servers and do not
  put in the `Referer` header. The server additionally sends `Referrer-Policy: no-referrer`.
- **Stored as a hash.** The server keeps the SHA-256 hash of the secret. The complete link is shown
  once, when it is created or rotated, and cannot be shown again.
- **Exchange.** The web app reads the fragment and removes it from the address bar in one step,
  before the first request, keeps the secret in memory only, sends it in the body of
  `POST /api/share/exchange`, and then moves to the document's address. The secret is never put in
  storage, a cookie, a request address or a log line. Reloading the page loses it on purpose.
- **A share link is not single-use.** Every exchange creates a new guest session; the link works
  until it expires or is revoked. Whoever holds the link holds the access it grants.
- **Scoped guest session.** The exchange sets the cookie `rd_share_<documentId>`, `HttpOnly`,
  `SameSite=Lax`, limited to the path `/api/documents/<documentId>`, so the browser sends it to
  that document's endpoints only. Guests get a display name generated by the server, and the app
  keeps no document content in the browser's storage for them. (The browser's own cache may hold
  images it has displayed; they are marked private and are re-checked with the server before they
  are used again.)
- **Guessing.** An unknown link and a wrong secret give the same answer, the secret is compared in
  constant time also when the link does not exist, and failures are rate-limited per address and
  per link. Only someone who presents the right secret learns whether a link was revoked or has
  expired.
- **Revocation** marks the link and every session derived from it as revoked in one database
  transaction. The server then closes the live connections of those sessions with a message that
  says why, discards unused connection tickets, and refuses their next request for the document,
  its files or an export. Other links and added people keep their access.
- **Expiry** is enforced by a timer per connection and by a check of every open connection every
  30 seconds. A guest session never outlives its link, also when the expiry is moved earlier.
- **Downgrade.** Changing a link from edit to view switches open connections to read-only in
  place.
- **Rotation** revokes the old link, with everything derived from it, and creates a new one with
  the same role, label and expiry.
- **Invitations** are a separate thing: `https://<host>/invite/<id>#<secret>` creates one account
  and gives no access to any document. The secret is stored as a hash, the link is shown once, it
  can be bound to an email address, it expires (1 hour to 30 days), it can be revoked until it is
  accepted, and it works once. An invitation with the administrator role creates an administrator;
  the form warns about that.
- **Open in Desktop** uses a code of 32 random bytes that lives for 60 seconds, is stored as a hash,
  is bound to the browser principal and the document, and is spent the first time it is presented,
  whatever the outcome. Unknown, used, expired and mismatched codes get one and the same answer.
  The resulting desktop session is derived from the browser or guest session that asked for it and
  ends with it.

## Cross-site request forgery and origin rules

Code: `apps/server/src/http/app.ts`, `apps/server/src/http/auth.ts`.

For every request that changes something (`POST`, `PUT`, `PATCH`, `DELETE` under `/api`):

1. The `Origin` header must be one of the configured origins: `PUBLIC_ORIGIN`, the entries of
   `ALLOWED_ORIGINS`, and the desktop origins. A request without `Origin` is accepted only if it
   carries a bearer token, or on the two public endpoints the desktop app's main process calls
   (share exchange and code redemption), and there only when it carries no cookie at all.
2. The custom header `X-RD-CSRF` must be present. A page on another site cannot send a custom
   header without the browser first asking the server, which refuses. For a signed-in account the
   header must equal that session's token, an HMAC-SHA-256 of the session identifier keyed with
   `SESSION_SECRET`, compared in constant time.
3. Cookies are ignored when the browser marks the request as cross-site, when the `Origin` is not a
   web origin, and whenever a bearer token is sent.

Guest sessions have no per-session token; for them the protection is the origin check, the
required custom header, `SameSite=Lax` and the path-limited cookie.

Cross-origin API access (CORS) is answered for the desktop origins only, without credentials.
Every origin in `ALLOWED_ORIGINS` is trusted exactly like `PUBLIC_ORIGIN`. It exists for the
development server and must be empty in a deployment.

## The collaboration endpoint

Code: `apps/server/src/collab/`.

Live editing uses one WebSocket per open document at `/collab`.

- **No credentials in the address.** Before each connection the client asks the API for a ticket:
  32 random bytes, valid for 60 seconds, usable once, bound to the principal, the document, the
  document's current generation and the client's Yjs identifier, kept in server memory as a hash.
  The ticket travels inside the first message of the socket, not in its address.
- **Access is resolved again** from the database when the ticket is used. An old client that does
  not understand the document's format is refused (`update_required`) instead of being allowed to
  drop content it does not know.
- **Origin allow-list.** A WebSocket whose `Origin` is not a configured web origin or desktop
  origin is closed.
- **View-only is enforced on the server**, in the path that processes updates: update frames from
  a read-only connection are refused, and the write queue additionally refuses to store any update
  that originated from a read-only connection. If one is ever seen, the document is discarded from
  memory and reloaded from storage, and an audit event is written. A hostile client that crafts raw
  frames is the case this is built for.
- **Presence** (who is here, and where an editor's cursor is) is kept apart from document content
  and never stored. A connection can describe only itself; the name, colour and role it claims are
  replaced by what the server knows; cursors of view-only connections are dropped; updates are
  limited to one per 60 milliseconds and 2048 bytes.
- **Budgets per socket.** At most 4 MiB per frame; a burst of 1500 frames and 300 per second
  after that; a byte budget on top; binary frames only; 15 seconds to authenticate; a slow reader
  is disconnected when 32 MiB are waiting for it. Per process: 1000 sockets, and 120 new
  connections per minute from one address.
- **Changes of access reach open connections**: revocation, expiry, removal from the document,
  downgrade, account disabling, sign-out, password change, trashing and snapshot restore each close
  or downgrade the affected connections at once. A change made by an operator command or directly
  in the database is picked up by the periodic check, at most 30 seconds later.

## "Saved" means committed

Code: `apps/server/src/collab/durable-log.ts`, `pg-log-store.ts`; `packages/editor/src/collab/`.

The save indicator is an integrity property: it must never say "Saved" for a change that could
still be lost.

- Every update is put into an ordered queue for its document in the same step in which it is
  applied in memory. One writer per document commits the queue to PostgreSQL in a transaction that
  locks the document's row, checks the generation and assigns the next sequence number. An older
  write therefore cannot land after a newer one.
- The client counts its own changes and sends a marker after them. The server answers "saved" for a
  marker only after everything queued before it is committed. This covers edits that only delete,
  which a comparison of version vectors would miss.
- After every (re)connection the client sends a proof of what it holds, including deletions. The
  server confirms only if its stored document contains all of it; otherwise both sides synchronise
  again. This is what keeps the indicator truthful for work done offline and after a server crash.
- If the database fails, the server reports an error, never "saved", keeps the batch and retries.
  The queue is bounded: when it is full the document stops accepting edits and says so, and clients
  keep their work. A document with uncommitted changes is never dropped from memory.
- Restoring a snapshot starts a new generation. Tickets, room names and writes are bound to the
  generation, so a client that was offline on the old one cannot merge stale edits into the
  restored document; its unsent work becomes a separate recovery draft.

Signed-in editors keep unsent changes in the browser's IndexedDB storage, separated by account,
document and generation, and cleared at sign-out. For share-link guests nothing is stored there.

## Uploads and files

Code: `apps/server/src/assets/`, `apps/server/src/http/routes/assets.ts`.

- **Who may upload.** Only a principal with edit access to that document. File bytes travel over
  the HTTP upload endpoint, never through the collaboration channel; documents refer to files by
  identifier.
- **Size** is cut off while the file streams in: 10 MiB for images, 1 MiB for SVG, 25 MiB for
  attachments, and 500 MiB of stored files per document. All four are configurable.
- **Type is decided from the bytes**, not from the declared type or the extension. Images are
  recognised by their signature (PNG, JPEG, GIF, WebP) and must agree with what the size probe
  detects. Anything else is accepted only with one of 15 allowed attachment extensions and content
  that plausibly matches it (for example a PDF header for `.pdf`).
- **Dimensions** are read from the image header without decoding the image: at most 12,000 pixels
  per side and 40 million pixels.
- **SVG** is accepted unchanged or rejected as a whole. It must pass an allow-list of drawing
  elements; a script, an event handler, embedded HTML, an external reference, a document type
  definition or an unknown element rejects the file. SVG with editor-specific metadata from drawing
  tools is therefore rejected and has to be exported as plain SVG.
- **Names.** The stored name is random and never derived from the file name. The display name is
  reduced to its last path segment, stripped of control and non-printing characters and of characters
  that are unsafe on common file systems, and kept clear of reserved device names.
- **Serving.** Each download is authorized against the document. Images are sent with their
  verified type; everything else is sent as `application/octet-stream` with
  `Content-Disposition: attachment`, so a browser saves it instead of showing it. Every file
  response carries `X-Content-Type-Options: nosniff`, the policy
  `default-src 'none'; style-src 'unsafe-inline'; sandbox`, and `Cache-Control: private, no-cache`
  with an `ETag`, so access is checked again on each use. The responses are marked
  `Cross-Origin-Resource-Policy: cross-origin` because the desktop app displays them from another
  origin; the access control is the authorization, and the session cookie is not sent with, or
  honoured on, a cross-site request.
- **Not done:** attachments are not scanned for malware. They are stored and handed back as opaque
  downloads.

### A defect that was found and fixed: the dimension probe

During the build, a re-run of the integration tests failed on one case: an image file cut off after
20 bytes was rejected with the reason `dimensions_too_large` instead of `content_mismatch`. The
cause was real.
The library that reads image dimensions (`image-size` 2.1.0) reads past the end of the bytes it is
given, into whatever memory follows in the same underlying buffer, and Node.js places small buffers
in a shared pool. A truncated image was therefore "measured" from unrelated memory, and the width
and height in the rejection message could reveal up to 8 neighbouring bytes of server memory per
request to an authenticated editor.

The fix is in `apps/server/src/assets/dimensions.ts`: every probe runs on a private copy of exactly
the right size, where reading past the end fails. Unit tests cover the truncated case inside a
larger buffer. The defect was found by a test, not by review; a reviewer should treat other uses of
binary parsers on untrusted bytes with the same suspicion.

## Content safety in the editor

Code: `packages/editor/src/clipboard/`, `packages/editor/src/editor/`,
`packages/contracts/src/urls.ts`.

- **Pasted HTML** is parsed by DOMPurify into an inert document with an allow-list, and the result
  is then rebuilt from scratch: the editor writes its own nodes from the formatting it recognised
  and copies no attribute of the source markup. Scripts, frames, objects, forms and styles do not
  survive. Nothing in this path touches the network. If the sanitizer reports that the browser is
  unsupported, HTML is refused and the plain-text version is pasted. A paste report names what was
  dropped or simplified.
- **Remote images are never fetched**, neither by the server nor by the browser. A pasted image
  that points to another site becomes a labelled link. Images embedded in the pasted data are
  uploaded like any other file.
- **Links** may only be `http`, `https`, `mailto` or `tel`, with a conservative host name grammar.
  `javascript:`, `data:`, `file:` and similar schemes are rejected, also when hidden behind control
  or non-printing characters. A click on a link never navigates the editor itself.
- **Mermaid diagrams** are rendered with `securityLevel: 'strict'` and HTML labels off, with those
  settings locked so that a diagram's own directives cannot change them. The resulting SVG is
  sanitised again and shown only as an image (`<img src="data:image/svg+xml…">`). An SVG shown as
  an image cannot run script or load anything. A broken diagram shows its error as text and affects
  nothing else.
- **Attribute values written by another editor.** Through the collaboration channel, an editor's
  client can write any value into any attribute of any node; the editor's own input rules are not
  involved. This was found during the build: with the guard removed, a crafted value in the
  line-spacing attribute made one paragraph cover the whole window, and since every reader's
  client renders the same node, it would have covered the document for everyone who opened it.
  (The value also named a remote background image. The product's policy would have blocked that
  request; it would not have blocked the overlay.) The hole is closed in two places: the shared
  schema (`packages/editor/src/schema/nodes.ts`) renders an attribute only after checking it
  against its list of allowed values, and the editor (`packages/editor/src/editor/attrs.ts`)
  checks every value that it turns into an address, a style or a layout decision. File
  identifiers, for example, must be well-formed before they become part of a request address.

**What remains: an editor can still deny service to readers.** An extreme table span (a cell
declared to cover a billion columns) makes the table library loop. A document can also simply be
made enormous; the 8 MiB document size is a warning in the log, not a limit that refuses edits.
Anyone with edit access can make a document unusable for the people who open it. Viewers cannot,
because they cannot write. Give edit access, including edit links, only to people you would trust
with that.

## Browser security headers

Code: `apps/server/src/http/app.ts`. The server sends these with every response. The content
security policy (CSP, the browser rule set that says what a page may load and run) is built from
the configuration. With `PUBLIC_ORIGIN=https://docs.example.com` and an empty `ALLOWED_ORIGINS` it
has these directives:

```text
default-src 'self'
script-src 'self'
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob:
font-src 'self'
connect-src 'self' wss://docs.example.com
frame-ancestors 'none'
object-src 'none'
base-uri 'self'
form-action 'self'
upgrade-insecure-requests
```

`connect-src` lists the WebSocket form of every configured web origin (`ws://…` for an `http://`
origin). `upgrade-insecure-requests` is present only when `PUBLIC_ORIGIN` is HTTPS. Points to note:

- No inline scripts and no `unsafe-eval`. Fonts and scripts are served by the server itself;
  nothing is loaded from other sites.
- **`style-src` allows inline styles.** The editor needs them for formatting. Injected markup
  could therefore style content, though not run script; the attribute checks above exist because
  of that.
- Also sent: `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin` (except on file downloads, see above), and
  `Strict-Transport-Security` for 180 days when `PUBLIC_ORIGIN` is HTTPS. The remaining default
  headers of the `helmet` library (version 8.3.0) are left on.
- API responses are sent with `Cache-Control: no-store`.
- In Chromium, sanitising pasted markup that contains inline event handlers produces policy
  violation reports although nothing executes (the markup is parsed in an inert document). Firefox
  and the WebKit build that was tested produce none. The sanitizers were also checked on a page
  without any policy, so they do not depend on it.

## Desktop app

Code: `apps/desktop/src/main/`, `apps/desktop/src/shared/`, `apps/desktop/scripts/`.

Everything in this section is how the app is built. The hardening was exercised on Linux only
(Electron under Xvfb, and the packaged Linux build probed from outside the process). **None of it
was run on Windows or macOS.** The Windows and macOS packages were inspected as files; the same
settings are in them, but they were never started.

- **Local pages only.** The windows load pages that are packaged with the app, from the private
  scheme `app://realtimedocs`. The handler serves a fixed set of files and nothing outside the
  app's page folder. No window ever loads a page from the network.
- **Renderer hardening** for every window: context isolation on, operating-system sandbox on, no
  Node.js in pages, workers or sub-frames, web security on, no `<webview>`, developer tools
  disabled in packaged builds.
- **Fuses** (switches burnt into the packaged executable): the executable cannot be run as plain
  Node.js, ignores `NODE_OPTIONS` and the debugger command-line flags, loads application code only
  from its `app.asar` archive and, on Windows and macOS, validates that archive against an embedded
  hash; `file://` pages get no extra privileges; cookie encryption is on. The build fails if a
  future Electron adds a fuse that the configuration does not decide. Packaged builds also drop the
  remote-debugging switches at start-up.
- **Content security policy per window.** The panel may connect only to the configured server
  (`https://…` and `wss://…`); the settings window and the diagnostic window have no network access
  at all. The server address is written into the policy only if it is a plain origin with a strict
  host name, so that it cannot inject a directive.
- **A small typed bridge.** Pages reach the main process only through `window.rdDesktop`, a fixed
  list of functions. There is no generic message channel and no function for running commands,
  reading files or loading addresses. Each call is accepted only if it comes from the main frame of
  the app's own page in the window registered for it, if that kind of window may make the call, if
  the argument is plain data, and if it matches a strict schema. The panel, where other people's
  document content is shown, cannot set the server address, change the shortcuts or switch private
  mode. It can ask to open a pasted share link, but it can neither see, answer nor dismiss the
  question whether to switch to that link's server: that question is asked by the main process
  alone (see "What the desktop panel may ask for" below).
- **Navigation and pop-ups.** A window can show only its own packaged page; any other navigation,
  any redirect, any sub-frame navigation and any attempt to attach a web view is cancelled. Nothing
  can open a new window.
- **External links** go to the operating system's default browser or mail program only after
  validation: they must start with `https://`, `http://` or `mailto:` written out, contain no
  control characters, spaces or backslashes, be at most 2048 characters long, and pass the same
  link check as the editor. Everything else is dropped.
- **Permissions.** Every permission request, permission check, device request and screen-capture
  request from a page is denied. The app asks the operating system for no screen-recording,
  microphone, camera, accessibility, input-monitoring, location or device access, and the packaged
  macOS bundles contain no usage-description entries. It needs no administrator rights for normal
  use: the Windows application manifest asks for `asInvoker`, and the Windows installer installs
  for the current user only. If a future feature needs a permission, the app has to explain it
  before the operating system asks, and the permission has to be added deliberately (usage
  description, entitlement, tests).
- **The session token stays in the main process.** The desktop session is a bearer token for one
  document. Pages never see it. The main process attaches it to a request only if all of this
  holds: the request goes to exactly the configured server origin, to a path under `/api/`, it was
  issued by the app's own page, it is not a WebSocket handshake, it is not a preflight request, and
  it has not been redirected. In every other case an `Authorization` header is removed. A request
  that the main process makes itself refuses redirects outright. The WebSocket authenticates with a
  short-lived ticket, like in the browser.
- **Storage of the session.** The token is written to disk only when the operating system offers
  real encryption for it (the Keychain on macOS, DPAPI on Windows), as one encrypted file. When
  that is unavailable, nothing is written: the session lives in memory, ends when the app quits,
  and the Connection tab says "In memory only". An old file is deleted in that case. The
  preferences file never contains the token, a share link or document content.
- **Document data on the computer.** The document view has its own browser storage inside the
  app's profile, so that a signed-in editor's unsent changes survive a restart. "Close document and
  forget session" removes that account's unsent changes and recovery drafts, ending a document
  session clears the cache that held its images, and changing the server clears the storage
  altogether. A session opened from a share link keeps no unsent changes or drafts.
- **Which server.** The server address is set explicitly by the user. HTTPS is required. Plain
  HTTP is accepted for `localhost` and `127.0.0.1`, and for private-network addresses only behind a
  development switch that is off by default and labelled as unencrypted.
- **Links from outside.** Any web page can trigger a `realtimedocs://` link, so such a link can
  never configure the app or make it contact a server the user did not set: a link for another
  server is rejected without any network request, and a burst of links is dropped. A pasted share
  link for another server leads to an explicit question before the app switches, and the secret is
  sent only to a server that has identified itself as RealtimeDocs.
- **Logging.** One JSON line per event on standard error; values under sensitive-looking keys and
  anything shaped like a secret are masked; packaged builds do not log the text of page errors.

### What the desktop panel may ask for

The panel window renders other people's document content, so it is the least trusted window of the
app. An audit of what it could ask the main process for found one real defect: the panel could send
both "open this share link" and "confirm the change of server", so page script in the panel could
have switched the app to another server on its own. It is fixed in three layers, none of which
trusts the panel:

1. **No confirmation channel exists.** A change of server is asked in a dialog of the main process
   (`dialog.showMessageBox`), naming the full normalised origin of the link and of the current
   server, with "Cancel" as the default and cancel button. No window can see, answer or dismiss it.
   The question is withdrawn after 3 minutes, a refusal blocks the same origin for 10 seconds, only
   one question is asked at a time, and the panel can cause it only while no document is open.
2. **User activation.** Every panel request that acts (window actions, bounds, presets, nudges,
   click-through, open share link, close document, revalidate, open external link and others) is
   forwarded by the preload script only while the browser reports a real click or key press in
   the last few seconds. Page script cannot create that activation and cannot reach the preload
   script. Without it the bridge answers `no_user_activation` and sends nothing. Passive requests
   (reading state, display preferences, the editor's status report) need none.
3. **The panel's state, checked in the main process.** Whatever the renderer claims: a hidden panel
   cannot reveal itself, a click-through panel can only leave click-through, a collapsed panel cannot
   reach anything that lives in the document area.

Two panel paths do not pass through the preload script, so the main process checks them itself: a
`window.open` or `target=_blank` link and following a link to an attachment need operating-system
input (a key or button) in the last 5 seconds. With private mode on, a position the panel asks for
stays on its own display.

Settings and the Privacy Test Center records are readable only from the settings window; the panel
and the probe window get `forbidden_window`. These checks are covered by unit tests of the request
policy and by Electron smoke tests on Linux (page script without a click or key press can make the
panel do nothing that acts). **None of it was run on Windows or macOS.** The activation gate runs in
the preload script's isolated world: it stops page script, not a compromised renderer process; the
main process's sender, schema and state checks apply regardless.

### The Windows diagnostics module

`apps/desktop/native/win-display-affinity` is an optional C++ Node-API module for Windows that reads
back the display affinity of the app's own window and waits for one desktop composition. It exports
exactly four functions. Before any call that takes a window it checks inside the module that the
buffer has the size of a window handle, that the handle is a window, that the window belongs to the
current process and that it is a top-level window; a window of another application is refused
without being touched. The affinity value is validated first and only `0`, `1` and `0x11` are
accepted. It does not hook or inject into anything, patch capture interfaces, touch other
processes, install drivers, change security settings or hide any process.

The loader in the main process (`apps/desktop/src/main/native`) refuses a file whose SHA-256 differs
from the hash recorded in `native-manifest.json` inside the application archive, and the module is
never exposed to pages. The module sits outside the archive, so the archive's integrity check does
not cover it: **sign the module with the same certificate as the app, before its hash is computed**
and written into the manifest, as described in [windows-client.md](windows-client.md). Anyone who
can write to the installation folder can also replace the executable, so code signing is the real
protection. **The module has never been compiled or run, and no shipped package contains it.**
Reading `WDA_EXCLUDEFROMCAPTURE` back is an operating-system return value, not evidence of what a
meeting participant receives.

## Optional sign-up, desktop downloads and the HTTPS redirect

Code: `apps/server/src/http/routes/auth.ts`, `routes/meta.ts`, `routes/download.ts`,
`apps/server/src/http/app.ts`, `apps/server/src/http/rate-limits.ts`.

- **Self-service sign-up is off by default** (`ALLOW_SIGNUP=false`). `GET /api/meta` publishes
  `signupEnabled`, and `POST /api/auth/signup` answers `forbidden` while it is off and creates
  nothing. When it is on, a sign-up creates a workspace **member**, never an administrator (the
  first administrator can only be created by the local command, and extra fields in the request
  are ignored). A new member has **no access to any document** until an administrator adds the
  account; documents answer `not_found`. The password is hashed with Argon2id before the account is
  looked up, so an address that already exists costs the same time, and a duplicate answers
  `conflict` without touching the existing account. Origin and anti-forgery rules are the generic
  ones for unsafe requests, with no exception. Every attempt, duplicates included, counts against
  two limits: `RATE_SIGNUP_PER_IP` (10 per client address per 10 minutes) and `RATE_SIGNUP_PER_EMAIL`
  (3 per address per hour). The audit trail records `auth.signup`. The trade-off is stated in the
  limits: **when sign-up is on, anyone who can reach the server can create an account**, which has no
  access to any document until an administrator adds it.
- **Desktop downloads.** `GET /api/downloads` is public and lists only the builds that exist as
  regular files in `DOWNLOAD_DIR` (name, size, SHA-256, modification time, URL), plus an optional
  `release.json` written by the operator (`version`, `notes`, `signed`; at most 64 KiB; invalid files
  are ignored). `GET` and `HEAD /download/:file` serve only the four fixed names
  `realtimedocs-windows-x64.zip`, `realtimedocs-windows-arm64.zip`, `realtimedocs-macos-arm64.zip`
  and `realtimedocs-macos-x64.zip` from that one directory, as attachments; any other name is a 404,
  there is no path traversal and no listing. With `DOWNLOAD_DIR` unset nothing is offered. **The
  server never decides that a build is signed**: `signed` is whatever the operator wrote. A download
  is only as trustworthy as the file the operator put there; the published SHA-256 lets a person
  compare what they received with the file on the server, but it does not tell them who built it.
- **HTTP to HTTPS redirect behind a trusting proxy.** When `PUBLIC_ORIGIN` is an `https://` address
  and `TRUST_PROXY` is set, a request that the trusted proxy marked as plain HTTP
  (`X-Forwarded-Proto: http`) is redirected with status 308 to the public HTTPS origin if it is a
  page request, and refused with 403 if it is an API call or not a `GET` or `HEAD`. The target is
  always the deployment's own origin, whatever the request line says. Requests without the header
  (the container's health check, a direct call on the loopback address) are left alone. This closes
  the blank page that appears when a browser opens the `http://` address of a site whose content
  security policy upgrades every sub-request to HTTPS. Cloudflare's "Always Use HTTPS" does the same
  at the edge ([deployment.md](deployment.md#cloudflare-settings)).
- **Document schema version 2.** The document format gained the `callout` block, so
  `DOCUMENT_SCHEMA_VERSION` is 2. A version-2 client's collaboration ticket raises a document to
  version 2; a client that speaks version 1 then receives `update_required` (426) instead of opening
  the document and silently dropping the block it does not know. Callouts are subject to the same
  render-time attribute validation as every other node: the `variant` attribute is checked against
  the five allowed values (`info`, `tip`, `success`, `warning`, `danger`) when the node is rendered
  or pasted, and anything else renders as `info`. Nothing is written to a `style` attribute. See
  "Content safety in the editor" for why attributes written by another client are never trusted.

## What a visitor without an account can reach

Since 2026-11-13 the web app shows a visitor nothing but the sign-in page. The table says what is
enforced where.

| Surface                                                                                                                      | Without an account                                                                                                      | Enforced by                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` and every unknown address                                                                                                | Sign-in page                                                                                                            | Route guard in the app                                                                                                                                                                |
| Product page (`/product`), `/download`, `/releases/:version`, `/guides/:name`, `/docs`                                       | Sent to sign in, then back to the page asked for                                                                        | Route guard in the app. These pages are static text inside the application bundle, which any visitor's browser downloads: the guard hides them, it does not make their wording secret |
| `GET /api/openapi.json`                                                                                                      | 401                                                                                                                     | The server: an account session or any valid API key                                                                                                                                   |
| `/login`, `/signup` (when enabled), `/invite/:id`, `/s/:grantId`, `/d/:documentId`                                           | Reachable, as before: sign-in, invitations and share links must work without an account                                 | The server decides what a share link or an invitation may do                                                                                                                          |
| `/api/v1/**`                                                                                                                 | 401 without an API key                                                                                                  | The server                                                                                                                                                                            |
| `/api/health`, `/api/ready`, `/api/meta`, `/api/downloads`, `/api/v1/desktop/**`, `/download/releases/**`, `/download/:file` | Public, as before: the desktop app asks for them before anybody has signed in, and its update check downloads from them | By design; the files are the published desktop packages                                                                                                                               |

A guest who holds only a share link has no account session: the guard treats them as a visitor, so
a share link opens its document and nothing else. After sign-in an administrator is sent to
`/admin/users` and a member to the product page; an address asked for while signed out wins over
that default, and only a path on the same origin is accepted as a return address (`safeNextPath`).

## Public deployment through a Cloudflare Tunnel

The deployment on the build server (`deploy/`) is published through a Cloudflare Tunnel. What that
means for security, as recorded in [deploy/README.md](../deploy/README.md):

- **TLS ends at Cloudflare's edge.** The certificate a browser sees is Cloudflare's, and Cloudflare
  can read the traffic. The tunnel from Cloudflare to the server is encrypted by `cloudflared`; the
  last hop, from the tunnel container to the `server` container, is plain HTTP on a private Docker
  network that never leaves the machine. Whether that is acceptable for your documents is a
  decision to make knowingly.
- **Ports.** The database and server ports are bound to `127.0.0.1` on the host. The tunnel
  container publishes no port and only makes outgoing connections. It runs with a read-only file
  system, without Linux capabilities and with `no-new-privileges`.
- **Client address.** `TRUST_PROXY=1` (one hop) makes rate limits and logs see the visitor's address.
  Visitors coming through Cloudflare cannot forge it, but a program on the server that calls
  `http://127.0.0.1:4310` directly can pass any `X-Forwarded-For`, because the server trusts one
  proxy in front of it.
- **The Cloudflare Web Analytics script is blocked.** Cloudflare can inject its Web Analytics script
  into the page. The product's content security policy allows scripts from its own address only, so
  the browser refuses it and logs one console error per page load. Nothing else is affected, and the
  policy was not loosened to hide the error; turn Web Analytics off for the hostname instead.
- **Two Cloudflare settings** found worth changing (Always Use HTTPS, Browser Cache TTL) are listed
  in [deployment.md](deployment.md#cloudflare-settings).
- **The volume guard.** The live Compose project shares its name with the repository's default, so a
  careless `docker compose down -v` typed in the repository root would address the live data. A
  separate container, `realtimedocs-volume-guard` (a `sleep infinity` container with no network, a
  read-only file system and both data volumes mounted read-only), holds the database and asset
  volumes, and Docker refuses to delete a volume that a container uses. `docker compose down -v`,
  `docker volume rm`, `docker volume prune` and `docker system prune --volumes` therefore leave the
  data in place (checked on scratch volumes). It does not protect against `docker rm -f` of the guard
  followed by deleting the volumes, against a disk failure, or against someone with root access;
  backups still matter ([backup-and-restore.md](backup-and-restore.md)).
- **Secrets** live in `deploy/.env.production` and `deploy/.env.tunnel` (mode 600, excluded from Git
  and from the Docker build). This document does not repeat them.

## Permitted-use boundary

RealtimeDocs asks the operating system to leave its own windows out of screen capture and helps
people check what a meeting participant receives. It is not a tool for evading monitoring, and the
following are **not built and will not be built**:

- process-name concealment, or hiding the app from Task Manager, Activity Monitor or any process list;
- defeating proctoring software or lockdown browsers;
- defeating tab-switch or focus-change detection;
- evading interview or exam monitoring in any form;
- injecting into, hooking, patching or modifying a meeting client or its recording pipeline;
- hooking or intercepting capture APIs;
- evading security tools, or kernel-mode or "stealth" drivers;
- fake compatibility results, or marking a configuration "verified" without a second participant's
  or device's observation;
- broad administrator rights: normal use needs none.

The only native code is the Windows diagnostics module described above, which touches the app's own
top-level windows through four documented functions. Permissions are kept minimal: no screen
recording, microphone, camera, accessibility or input-monitoring permission, and any permission a
future feature needs must be explained in the app before the operating system asks.

## Logging and audit

Code: `apps/server/src/logger.ts`, `apps/server/src/audit.ts`.

- Logs are structured JSON. Request bodies are never logged. Cookies, `Authorization` headers, the
  anti-forgery header and any field whose name suggests a secret are masked, as are the values of
  sensitive-looking address parameters. The backup and restore rehearsal searches the server log of
  a filled deployment for the secrets it used and fails if one appears.
- Error answers carry a request identifier made by the server (one supplied by the client is not
  trusted) and no internal detail.
- The audit trail records administrative and security events with who, what, when and the request
  identifier: sign-ins and failures, password changes and resets, account changes, invitations,
  memberships, share links (created, changed, used, failed exchanges, revoked, rotated), document
  lifecycle, snapshots, desktop sessions, uploads rejected for active content, and blocked updates
  from read-only connections. Detail fields whose names suggest content or secrets are dropped
  before storage. Keystrokes and document content are never audited.
- Audit events are kept for 365 days by default. The administrators' view shows at most 500 of
  them.

## Dependencies and supply chain

- Every dependency is pinned to an exact version in the `package.json` files, and
  `pnpm-lock.yaml` fixes the whole tree. The Docker build installs with `--frozen-lockfile`.
- pnpm does not run install scripts of dependencies unless they are listed; the list contains one
  entry, `esbuild` (`pnpm-workspace.yaml`).
- pnpm's minimum-release-age policy was left on during the build, so very recent releases were not
  taken ([decisions.md](decisions.md)).
- Password hashing uses Node.js itself; the server has no native add-on.
- The server image is built from `node:24.22.2-trixie-slim`, contains a bundled server without
  `node_modules` or build tools, and runs as an unprivileged user. The database image is
  `postgres:17.11-alpine`. Both base images are pinned by tag, not by content digest.
- The desktop app is built on Electron 45.2.3. There is no automatic update: when Electron or
  Chromium publish security fixes, a new build has to be made and handed out by hand.
- **Not done, as far as the engineers' notes record:** an automated vulnerability scan of the
  dependencies, a software bill of materials, and a licence audit.

## How this was checked

Results and counts are in [testing.md](testing.md). The kinds of evidence are:

- **Server unit tests** for SVG validation, file-name sanitising, type detection, the dimension
  probe, password hashing and tokens, configuration rules, presence rules, the write queue and the
  reconnection proof.
- **Server integration tests** against a real PostgreSQL container and a real server process, with
  a real collaboration client and a client that crafts raw frames: sign-in rules, origin and
  anti-forgery rules, the role matrix, cross-document access, share-link revocation, expiry,
  rotation and downgrade on live connections, crafted frames from a view-only connection,
  acknowledged edits surviving a killed server, a stopped database, snapshot restore against stale
  clients, upload rules, and desktop code redemption.
- **Editor tests**, including a corpus of hostile clipboard content, hostile attribute values and
  hostile diagrams, run in Chromium, Firefox and the Playwright build of WebKit on Linux, under the
  product's content security policy and without it.
- **Web app browser tests** against a mocked API, which check among other things that the share
  secret leaves the address bar before the first request and that no page violates the policy.
  Browser tests of the web app and the desktop panel against the real server belong to the
  integration pass; whether and how they ran is recorded in [testing.md](testing.md).
- **Desktop tests** on Linux: unit tests for link validation, sender checks and token attachment;
  Electron smoke tests under Xvfb; and checks of the packaged Linux build from outside the process
  that its fuses take effect.
- **The deployment on the build server**, published over HTTPS through a Cloudflare Tunnel. Its
  guide ([deploy/README.md](../deploy/README.md)) records what was observed there before any
  account existed, among other things the attributes of the session cookie, the security headers,
  the refusal of a WebSocket with a foreign `Origin`, and that a forged `X-Forwarded-For` header
  from a visitor is ignored. Signing in and working with documents through that address are listed
  there as not covered.

What this evidence is not: there was no independent security review and no penetration test. No
real Safari, no Windows and no macOS were involved. The reverse-proxy examples of the deployment
guide were not run. The clipboard fixtures were written by hand from documented formats, not
captured from real Google Docs, Word or Excel sessions.

## Known limitations

- **No TLS in the server.** Confidentiality in transit depends entirely on what is put in front of
  it. The reverse-proxy examples of the deployment guide were not run. The deployment that does
  run uses a Cloudflare Tunnel, which means Cloudflare sees the traffic in the clear.
- **Rate limits are per process and in memory unless `REDIS_URL` is set** (then they are counted in Redis for all instances, and let requests through while Redis is unreachable). They reset on restart. Behind a proxy they work
  per client only if `TRUST_PROXY` is set correctly; set wrongly, either everyone shares one
  counter or a client can forge its address. With `TRUST_PROXY` set, any program that can reach
  the server's port directly, without going through the proxy, can present whatever client address
  it likes; this is one reason the port is bound to `127.0.0.1`.
- **One workspace, powerful administrators.** Every administrator can read and manage every
  document. There is no finer-grained administration.
- **Share links are bearer capabilities.** Anyone who obtains a link has its access until it
  expires or is revoked. The form preselects a 7-day expiry, and "Never" can be chosen.
- **Viewers can take content with them.** A view-only principal can read, copy, export and download
  everything in the document.
- **Everyone connected to a document sees the display names of the others connected to it.**
- **Operator actions reach open connections with a delay** of up to 30 seconds.
- **No malware scanning** of attachments.
- **Backups are unencrypted** and contain password hashes and all content.
- **Local recovery data.** A signed-in editor's unsent changes and recovery drafts are stored
  unencrypted in that browser profile until sign-out, and in the desktop app's profile until the
  document is closed there. On a shared computer, sign out and close the document.
- **Desktop builds are unsigned** unless you sign them. An unsigned build cannot be told apart from
  a tampered one by the operating system or by the user.
- **Sign-up, when enabled, is open to anyone who can reach the server.** The accounts it creates are
  members without document access, but they exist, and the two rate limits are per process and in
  memory.
- **Downloads are as trustworthy as the operator's upload.** The server lists and serves what is in
  `DOWNLOAD_DIR`, checks nothing about who built it, and never claims a build is signed.
- **Desktop development switch.** With the plain-HTTP switch on, the document and the session
  token cross that network unencrypted.

## Residual risks

- **Nothing native has been verified.** Whether the sandbox, the fuses, the archive integrity
  check, the credential stores, the deep-link registration and the permission denials behave on
  Windows and macOS as they do on Linux is unknown until the checklists in the client guides are
  run.
- **Private mode is not a security control.** It is a request to the operating system. Microsoft
  documents that the underlying Windows function is not a security feature and gives no guarantee;
  Electron documents that on macOS it does not stop ScreenCaptureKit-based capture. No meeting
  application has been tested. Treat the panel as visible in a screen share unless a recorded test
  for your exact setup shows otherwise.
- **An editor can deny service to readers** of the same document, as described above.
- **Mermaid lays a diagram out in the live page before the result is sanitised.** With the strict,
  locked configuration no way was found to make that step load or run anything, and the policy
  would block it, but that step is Mermaid's code.
- **Binary parsers on untrusted input.** The dimension probe defect shows the class of problem.
  The image header reader and the SVG parser are third-party code that reads attacker-controlled
  bytes.
- **macOS bundle defaults.** The packaged macOS app keeps Electron's stock setting that allows
  arbitrary network loads at the operating-system level; the app's own rule that the server must
  be HTTPS is what applies.
- **Private-network servers from the desktop app.** How Chromium's local-network access rules
  treat the app's pages when the server is on a private address was not exercised beyond
  `localhost`.
- **No scan, no review.** Dependencies were not scanned for known vulnerabilities and nobody
  outside the build has reviewed the design or the code.
