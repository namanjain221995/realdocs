# Enterprise upgrade: final report

_2026-11-12. Everything below was done in the working tree of this repository on the server that also
runs the live site. Nothing was committed and nothing was deployed: both are the owner's steps._

Status labels: IMPLEMENTED AND VERIFIED (it ran here and the result was observed), IMPLEMENTED BUT NOT
NATIVE-TESTED, CONFIGURED BUT REQUIRES CREDENTIAL, PARTIALLY IMPLEMENTED, BLOCKED WITH EXACT REASON.

## 1. Executive summary

The existing product was kept and extended. The two reported failures were traced to their cause and
fixed: uploads now wait and retry instead of failing on the rate limit, and content that an older build
does not know is named, kept and no longer locks a document for good. On top of that the upgrade adds an
interview-session API with its own keys, webhooks and developer portal; shared page margins with a
ruler; a version history that says who changed what and when, by the server's clock; a versioned,
platform-aware download system for the desktop app; operation on several server instances; metrics; a
redesigned landing page; and the documentation set.

What the evidence supports: on this host, 1,000 simultaneous editors connected and typed at 1,000 edits
per second with no acknowledged edit lost in any failure test, on one instance and on two. What it does
not support: the reconnect objective after an instance restart was missed (about 9 s at p95 against 5 s),
the one-hour soak ran for 12 minutes, several load scenarios did not run, and nothing native has run on
Windows or macOS. No desktop build is signed. The live site is unchanged.

## 2. Existing architecture found

One Node.js process (Fastify API, Hocuspocus collaboration endpoint, durable Yjs update log in
PostgreSQL, local asset store, built React app), an Electron desktop app, three shared packages, Docker
Compose behind a Cloudflare Tunnel. This server is production: project `realtimedocs`, ports 4310 and
54310, volumes `realtimedocs_rd_pgdata` and `realtimedocs_rd_assets`. Details and the audit:
[enterprise-upgrade-plan.md](enterprise-upgrade-plan.md), [architecture.md](architecture.md).

## 3. Confirmed defects found

| Defect                                                                                                                    | Outcome                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| One unknown node or mark made the whole document read-only for good, with a message telling web users to "update the app" | Fixed: see section 5                                                      |
| Attributes an older client does not know were erased from the shared document when that client edited the node            | Fixed: unknown attributes now pause editing too                           |
| "Too many uploads at once": 60 uploads a minute per session, no waiting, manual retries counted against the same limit    | Fixed                                                                     |
| The update log could not say who changed what (no actor, mixed batches, deleted on compaction and restore)                | Fixed by a separate history log                                           |
| Desktop package names did not match the names the server serves; Linux could not be published                             | Fixed                                                                     |
| "Open in Desktop" shown to every viewer, guests included                                                                  | Fixed for interview candidates by server permission; other guests keep it |
| The deployed image cannot start on a database that a newer version migrated, so "start the old image" was not a rollback  | Fixed with reversible park and unpark scripts, rehearsed                  |
| The Docker build copies only three guides; the web app now bundles a fourth. The next live deploy would have failed       | Fixed (found by building the image in a trial)                            |
| Administrator navigation overflowed at 768 px after four entries were added                                               | Fixed                                                                     |
| Simultaneous Enter by several editors converges on wrong content                                                          | **Not fixed, not investigated.** Still pinned by an expected-failure test |

## 4. Security issues found

Before the upgrade (audit): a share link could be blocked for everyone by sending wrong secrets for its
id; an account could be locked out of sign-in by anyone who knew its address. Both limiters are now keyed
on the address as well, with a second, ten times higher limit per account from all addresses. No secret
is tracked by Git; the live secrets are in ignored files of mode 600.

In the new code (independent review, 2026-11-12): no critical or high finding. Five medium or low
findings, all fixed the same day and covered by tests where a test is possible:

1. An editor could set a heading level that made the administrator's revision view fail or build a
   very large string. The level is clamped; a failing diff no longer hides the revision.
2. The webhook address filter missed IPv4-mapped IPv6 addresses written in hexadecimal, so a webhook
   could be pointed at an internal address. They are decoded and refused.
3. With several instances, sockets that had not yet sent a frame were not counted against the
   connection limit, and the queue in front of a forwarded socket had no byte limit. Both are bounded.
4. A crafted `Authorization` value made `/metrics` answer 500 instead of 404, which revealed that
   metrics are on and the length of the token. Digests are compared now.
5. Some invisible bidirectional characters survived in generated titles. All format characters are
   removed.

Also changed: the desktop app refuses an "update" that is not newer; CI secrets are passed through the
environment; Redis needs a password in the multi-instance example. Accepted and documented: Redis is a
trust root in multi-instance mode; `TRUST_PROXY=true` is unsafe (the server now warns); an idempotency
claim older than 120 s can be taken over; CI actions are pinned by tag; rate limits let requests through
while Redis is unreachable. Full list and rotation steps: [security-checklist.md](security-checklist.md).
No credential needs rotating because of this work. `deploy/admin-credentials.txt` still exists.

## 5. Features implemented

| Feature                                                                                                                                                                                                  | Status                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload queue: three at a time, automatic retry with backoff, whole queue pauses for the time a rate-limit answer names, identical files sent once, cancel, clear reasons                                 | IMPLEMENTED AND VERIFIED                                                                                                                                        |
| Unsupported content: a scan names the unknown blocks, formatting and settings; editing pauses in that window only while they exist; nothing is removed; a host-specific "get the current version" action | IMPLEMENTED AND VERIFIED (unit). PARTIALLY IMPLEMENTED against the request: no per-node placeholders (reason in [decisions.md](decisions.md)), no browser check |
| Version negotiation: `/api/meta` and `/api/v1/desktop/update` report minimum and recommended client version, protocol and schema version; the desktop shows "update required"                            | IMPLEMENTED BUT NOT NATIVE-TESTED                                                                                                                               |
| Interview sessions, API keys with scopes, idempotency, webhooks, OpenAPI 3.1 generated from the runtime schemas, developer portal, admin pages                                                           | IMPLEMENTED AND VERIFIED (server). Portal and admin pages: unit tests only                                                                                      |
| Page settings (A4, Letter, orientation, four margins, unit, background) shared through the document; ruler with drag, keyboard and snapping; settings dialog; print                                      | IMPLEMENTED AND VERIFIED. Not done: indent markers, pagination, header and footer rendering                                                                     |
| Version history                                                                                                                                                                                          | IMPLEMENTED AND VERIFIED                                                                                                                                        |
| Release store, manifest, update endpoint, download with resume, counts without personal data, publish script, OS-aware download, `/download` page                                                        | IMPLEMENTED AND VERIFIED                                                                                                                                        |
| Several instances, metrics, readiness, draining                                                                                                                                                          | IMPLEMENTED AND VERIFIED on one host                                                                                                                            |
| Landing page                                                                                                                                                                                             | IMPLEMENTED AND VERIFIED                                                                                                                                        |
| Roles: workspace administrator and member, document editor and viewer, guest, interview candidate and interviewer, API service account                                                                   | IMPLEMENTED AND VERIFIED. A separate "super administrator" role was **not** added                                                                               |
| Large paste: limits of 2,000,000 characters of HTML and 1,000,000 of text, sanitised, reported, images queued                                                                                            | Unchanged from before. Chunked insertion and parsing off the main thread: **not done**                                                                          |

## 6. Database migrations added

`0002_service_api` (API keys, interview sessions and participants, idempotency keys, webhook endpoints
and deliveries, `share_grants.participant_id`, `service` as an audit actor), `0003_history`
(`doc_history`, `documents.history_seq`), `0004_releases` (`release_download_counts`). Additive only.
Rehearsed on a copy of the production database of 2026-11-12: 0.15 s, every existing table unchanged.
Schema: [database-schema.md](database-schema.md).

## 7. API endpoints added

- `/api/v1/interview-sessions`: create, list, read, update, archive; `/participants`, `/rotate-links`,
  `/start`, `/complete`, `/cancel`, `/audit`, `/document`.
- `/api/v1/webhooks`: endpoints, deliveries, manual retry.
- `/api/v1/desktop/releases`, `/releases/latest`, `/releases/:version`, `/update`;
  `/download/releases/:channel/:version/:fileName`.
- `/api/openapi.json`.
- Administrators: `/api/admin/api-keys`, `/api/admin/interview-sessions`, `/api/admin/webhooks`,
  `/api/admin/releases`.
- `/api/documents/:id/history`, `/history/:revision`, `/history/:revision/name`, `/copy`, `/export`,
  `/history/export`.
- `/metrics`.

## 8. Developer documentation URL

`/docs` on the server (after deployment: `https://realdocs.techsarasolutions.com/docs`), machine-readable
at `/api/openapi.json`. The former in-app guide reader moved to `/guides/:name`; old links redirect.
Guides in the repository: [session-integration.md](session-integration.md), [webhooks.md](webhooks.md).

## 9. Download artifacts produced

Built on this host as a check, not published: Linux arm64 `.tar.gz` and `.zip`; Windows x64 and arm64
`.zip`; macOS x64 and arm64 `.zip`. Names follow `RealtimeDocs-<version>-<platform>-<arch>.<ext>`. No
release is in the live download directory, so the site correctly says that none is published.

## 10. Platform and signing status

| Artifact                                              | Status                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Linux arm64                                           | IMPLEMENTED AND VERIFIED (packaged app starts under Xvfb; no real desktop)                                           |
| Windows x64 and arm64, macOS x64 and arm64 zips       | IMPLEMENTED BUT NOT NATIVE-TESTED (cross-built, unsigned, never started)                                             |
| Windows installer, macOS dmg and universal, Linux x64 | BLOCKED: need a Windows host, a Mac, an x64 Electron download                                                        |
| Linux AppImage                                        | Not built: needs tooling this host lacks; `.tar.gz` instead                                                          |
| Windows signing, macOS signing and notarisation       | CONFIGURED BUT REQUIRES CREDENTIAL                                                                                   |
| CI and release workflows                              | Written and read, **never executed**                                                                                 |
| Silent self-update                                    | Not implemented by decision: it needs signed builds. The app checks, downloads on request, verifies size and SHA-256 |

## 11. Candidate-side UI changes

For an interview candidate the server refuses the desktop handoff, export (unless the session allows
it), snapshots and history, and the web app hides those controls from flags the server sends. A closed
session shows a plain screen without download controls. Not done: the print route is not hidden in the
interface for candidates (its data request is refused); `candidateCanShare` is stored and has no effect.

## 12. Margin synchronisation implementation

Page settings are a map named `page` in the same shared document as the text. They therefore reach
every editor at once, are saved by the existing durable log, are part of snapshots, restores and
duplicates, and appear in the version history with the person who changed them. Every reader normalises
the values, because another client can write anything into a shared document. No schema version change:
older clients ignore the map.

## 13. Version-history implementation

Every committed batch writes, in the same database statement, one row per person to `doc_history`: the
update, the actor from the authenticated connection, the server's receive and commit time, a summary of
counts and kinds, and the assets it added. Complete checkpoints make any retained revision rebuildable.
The client's own clock and its "this is a paste" label are stored as untrusted information; without the
label a large single insertion is labelled a paste. Restoring turns a revision into a named version and
restores it as a new generation: nothing earlier is removed. Assets stay while a retained revision shows
them. History of an existing document starts at its first change after the upgrade. Guide:
[version-history.md](version-history.md).

## 14. Scaling architecture

With `REDIS_URL`, a Redis lease names the one instance that holds a document; an instance that receives
a socket for another instance's document forwards it. Tickets, rate limits and revocation go through
Redis. The lease only routes; the database's sequence check is what refuses a second writer. Without
`REDIS_URL` the server runs exactly as before. The TypeScript stack was kept: at 1,000 edits per second
one instance used about half of one core. Guide: [scaling.md](scaling.md).

## 15. Load-test results

One shared host, loopback, one source address. Full report: [load-test-report.md](load-test-report.md).

| Objective                               | Measured                                                                                               | Met                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------- |
| 1,000 connected users                   | 1,000 of 1,000 on one instance and on two; none lost in a 120 s hold                                   | yes                    |
| 99.9 % connection success               | 1,000 of 1,000 at first attempt (a sample of 1,000 cannot prove 99.9 %)                                | consistent, not proven |
| API p95 below 300 ms                    | steady state within 25 ms; 369 ms for tickets during a 1,000-client reconnect storm on one instance    | partly                 |
| Delivery p95 below 250 ms               | 1.8–2.6 ms at 1,000 edits/s; save p95 5.7–8.6 ms                                                       | yes, on loopback only  |
| Reconnect p95 below 5 s after a restart | 8.7–8.9 s (10.5–11.1 s before the client's retry delays were shortened)                                | **no**                 |
| No acknowledged edit lost               | about 580,000 acknowledged markers checked across restart, Redis restart and database pause: 0 missing | yes                    |
| No memory growth in one hour            | 12 minutes ran                                                                                         | **not shown**          |
| One user cannot starve others           | scenario not run                                                                                       | **not shown**          |
| Backpressure instead of crashes         | database paused 10 s under 400 typists: no crash, queue peak 103 KB, all edits saved afterwards        | yes                    |

## 16. Test commands and exact results

| Command                                                                             | Result                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`                      | clean (27 lint warnings in `tests/load`)                            |
| `pnpm test`                                                                         | 80 files, 1,915 passed                                              |
| `pnpm test:integration`                                                             | 21 files, 225 passed                                                |
| `pnpm test:backup-restore`                                                          | passed                                                              |
| Web mocked suite, three browsers                                                    | 949 passed, 2 skipped                                               |
| Web real-stack suite                                                                | 69 passed; outage group 18 passed                                   |
| `pnpm test:e2e`                                                                     | 42 passed including 3 expected failures; disruptive 12 passed       |
| `packages/editor/demo/e2e.mjs`                                                      | Chromium 47/47, Firefox 45/45 (2 skipped), WebKit 45/45 (2 skipped) |
| `node apps/desktop/scripts/smoke.mjs`, packaged check                               | 64/64, 39/39                                                        |
| `scripts/rehearse-migration.sh <backup> --rollback-image realtimedocs-server:local` | data unchanged; rollback and roll-forward rehearsed                 |

Earlier in the day, two WebKit editor checks failed while the load tests held the host at a load average
of 21, and the acceptance suite's disruptive group could not start its database while a load-test process
held its port. Both passed once the load tests had ended. Eight real-stack web tests failed on first run
because their expectations predated the page surface and the release store; the expectations were
updated to the new behaviour, with no assertion dropped.

## 17. Files changed

235 tracked files changed (about 7,200 lines added, 3,500 removed) and 110 new files or directories:
`apps/server` (history, cluster, service API, releases, metrics, three migrations, tests),
`packages/contracts`, `packages/editor` (uploads, unsupported content, page settings, ruler),
`apps/web` (history, developer portal, admin pages, landing, downloads, guides), `apps/desktop`
(packaging names, update check), `tests/load` (new), `scripts/` (release publishing, migration
rehearsal), `deploy/scale/`, `deploy/rollback/`, `.github/workflows/`, `Dockerfile`, `.dockerignore`,
`docs/`. 123 of the changed files are regenerated screenshots under `packages/editor/demo/screenshots`.
One dependency was added: `ioredis` 6.0.0. `git status` lists everything.

## 18. Deployment instructions

[upgrade-and-rollback.md](upgrade-and-rollback.md). In short: rehearse on a fresh backup, tag the running
image as `realtimedocs-server:previous`, take and verify a backup, `deploy/up.sh`, `deploy/status.sh`.
New settings are optional. Several instances: [scaling.md](scaling.md).

## 19. Rollback instructions

Stop, run `deploy/rollback/park-schema.sql`, start the previous image; no data is lost and no restore is
needed. Going forward again: `deploy/rollback/unpark-schema.sql`, then `deploy/up.sh`. Rehearsed with the
deployed image on a copy of the production database. A database restore is the last resort and replaces
everything written since the backup.

## 20. Remaining limitations

[known-limitations.md](known-limitations.md). The ones that matter most: no native verification on
Windows or macOS; unsigned builds; capture exclusion unverified for every meeting application; the
reconnect time after an instance restart; no one-hour soak; the simultaneous-Enter defect; no per-node
placeholders for unknown content; no pagination; no malware scanning of uploads; no tracing; no object
storage adapter; backups not automated; no automatic removal of participants' e-mail addresses.

## 21. Items not genuinely tested

- Anything on a real Windows or macOS machine: packages, installers, signing, notarisation, the update
  flow, Presenter Mode, capture exclusion, every meeting application.
- The CI and release workflows.
- The upgrade and the rollback of the live deployment (rehearsed on a copy only).
- Load: the one-hour soak, paste bursts, a hot document with 10 to 50 editors, concurrent uploads,
  history reads, a tuned database pool, default per-address limits during a reconnect storm, any real
  network, a balancer with health checks.
- Several instances on different hosts; a shared network file system; `proxy_connect_timeout` in the
  nginx example after it was changed.
- The developer portal, the admin pages for sessions, keys, webhooks and releases, and the notice for
  unsupported content in a real browser.
- Printing on paper or to PDF; 200 % zoom; real Safari; phones; screen readers.
- Webhook address checks with real DNS in production mode; rotation of the session secret, database
  password and Redis password; point-in-time recovery; a restore on a second host.

## 22. Recommended next production step

Do not deploy several instances or publish desktop builds yet. Deploy the upgrade to the live site as a
single instance: run the rehearsal on a fresh backup, tag the current image, back up, `deploy/up.sh`,
then check sign-in, an existing document, version history and `/docs`. After that, in this order: build
and start the Windows and macOS packages on real machines and record the results in the Privacy Test
Center; obtain signing credentials and run the release workflow once; run the one-hour soak and the
missing load scenarios, including the restart scenario behind a balancer with health checks, before
relying on more than one instance.
