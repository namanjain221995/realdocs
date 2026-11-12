# Implementation checkpoint

_Last updated: 2026-11-12, at the end of the enterprise upgrade. Nothing of the upgrade is deployed: the
public site still runs the image built on 2026-11-11._

## How to resume

1. `. scripts/dev-env.sh` (pinned Node 24.22.2 + pnpm 12.18.0 in `.toolchain/`), then
   `node scripts/verify-install.mjs`.
2. Read [enterprise-upgrade-report.md](enterprise-upgrade-report.md) (what was done and what was not),
   [enterprise-upgrade-plan.md](enterprise-upgrade-plan.md), [decisions.md](decisions.md),
   [known-limitations.md](known-limitations.md), then the area notes in `docs/notes/`.
3. The live deployment is described in `deploy/README.md`. Operate it only through `deploy/*.sh`; never
   run a plain `docker compose … down -v` in this repository. Upgrading it:
   [upgrade-and-rollback.md](upgrade-and-rollback.md).
4. Git: the repository has one commit; everything of the upgrade is uncommitted working-tree change. The
   owner commits.

## State

Labels: IMPLEMENTED AND VERIFIED (ran on this host), IMPLEMENTED BUT NOT NATIVE-TESTED, CONFIGURED BUT
REQUIRES CREDENTIAL, PARTIALLY IMPLEMENTED, BLOCKED WITH EXACT REASON.

| Area                                                                                                   | State                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload queue (automatic retry, pause on rate limit, de-duplication)                                    | IMPLEMENTED AND VERIFIED                                                                                                                     |
| Unsupported content (named, pauses editing in that window, clears itself)                              | IMPLEMENTED AND VERIFIED in unit tests; PARTIALLY IMPLEMENTED against the request (no per-node placeholders, no browser check of the notice) |
| Interview session API, API keys, idempotency, webhooks, OpenAPI, `/docs` portal, admin pages           | IMPLEMENTED AND VERIFIED (server); portal and admin pages have unit tests only, no browser spec                                              |
| Page settings, margins, ruler, print                                                                   | IMPLEMENTED AND VERIFIED; printing on paper or to PDF not checked; no indent markers, no pagination                                          |
| Version history (attributed log, timeline, diff, preview, restore, copy, export, attachment retention) | IMPLEMENTED AND VERIFIED                                                                                                                     |
| Release store, manifest and update endpoints, OS-aware download, publish script                        | IMPLEMENTED AND VERIFIED                                                                                                                     |
| Desktop packages: Linux arm64                                                                          | IMPLEMENTED AND VERIFIED (Xvfb smoke only)                                                                                                   |
| Desktop packages: Windows x64/arm64, macOS x64/arm64 zips                                              | IMPLEMENTED BUT NOT NATIVE-TESTED (cross-built, unsigned)                                                                                    |
| Windows installer, macOS dmg and universal build, Linux x64                                            | BLOCKED WITH EXACT REASON: need a Windows host, a Mac, and an x64 Electron download                                                          |
| Windows signing, macOS signing and notarisation                                                        | CONFIGURED BUT REQUIRES CREDENTIAL                                                                                                           |
| Desktop update check, verified download, "update required" state                                       | IMPLEMENTED BUT NOT NATIVE-TESTED (unit tests; no silent self-update by decision)                                                            |
| CI and desktop release workflows                                                                       | IMPLEMENTED, NOT EXECUTED (no runner)                                                                                                        |
| Several server instances (Redis lease, forwarded sockets, shared tickets and limits)                   | IMPLEMENTED AND VERIFIED (integration tests, Compose trial, load tests on one host)                                                          |
| Metrics, readiness with Redis and drain                                                                | IMPLEMENTED AND VERIFIED; no tracing                                                                                                         |
| Landing page                                                                                           | IMPLEMENTED AND VERIFIED (three browsers, six widths); 200 % zoom not checked                                                                |
| Load tests                                                                                             | PARTIALLY IMPLEMENTED: see [load-test-report.md](load-test-report.md) for what ran and what did not                                          |
| Migration and rollback                                                                                 | Rehearsed on a copy of the production database; not applied to production                                                                    |
| Everything native on Windows and macOS, every meeting application                                      | NOT TESTED                                                                                                                                   |

## Verified results (observed on this host on 2026-11-12)

| Suite                                                                        | Result                                                                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`               | clean (lint: 27 `any` warnings in `tests/load`, no errors)                                            |
| `pnpm test` (unit, all packages)                                             | 80 files, 1,915 passed                                                                                |
| `pnpm test:integration` (real PostgreSQL, real server, Redis for cluster)    | 21 files, 225 passed                                                                                  |
| `pnpm test:backup-restore`                                                   | passed (35 s)                                                                                         |
| Web, mocked API (`apps/web/test-browser`), Chromium + Firefox + WebKit       | 949 passed, 2 skipped                                                                                 |
| Web, real stack (`apps/web/test-real`)                                       | 69 passed; outage group 18 passed                                                                     |
| Acceptance (`pnpm test:e2e`)                                                 | 42 passed (3 of them are the expected failures of the known defect below); disruptive group 12 passed |
| Editor browser checks (`packages/editor/demo/e2e.mjs`)                       | Chromium 47/47; Firefox 45/45, 2 skipped; WebKit 45/45, 2 skipped                                     |
| Desktop: Xvfb smoke, packaged-app check (Linux)                              | 64/64, 39/39                                                                                          |
| `scripts/rehearse-migration.sh … --rollback-image realtimedocs-server:local` | data unchanged; rollback and roll-forward rehearsed                                                   |
| Two-instance Compose trial (`deploy/scale/`)                                 | ran once; details in [scaling.md](scaling.md)                                                         |

Two things seen during the day that were not product defects: the editor's WebKit checks
`scroll-stability-manual` and `typing-performance` failed while the load tests held the host at a load
average of 21 and passed at a load of 9 and again in the final run; the acceptance suite's disruptive
group could not start its database while the load-test proxy held local port 54330.

## Known defects and open items

- **Simultaneous Enter:** unchanged from 2026-11-11 (pinned by `tests/e2e/specs/convergence.spec.ts`,
  `test.fail`). Not investigated in this upgrade.
- **Reconnect after an instance restart:** p95 8.7–8.9 s in the load harness (objective 5 s). The server
  hands documents over at once (integration test); the rest was not isolated. See the load-test report.
- **Soak test:** 12 minutes ran, not 60. Paste-burst, hot-document, upload and history-read load
  scenarios and the tuned-pool topology did not run.
- **Document size limit** is a warning only.
- **Developer portal and admin pages** have no browser spec; the notice for unsupported content has no
  browser check.
- **Retention:** no automatic removal of interview participants' e-mail addresses, API keys or download
  counts.
- **Backups** are not automated.
- Everything else: [known-limitations.md](known-limitations.md).

## For the owner before the live upgrade

1. Read [upgrade-and-rollback.md](upgrade-and-rollback.md) and run the rehearsal once more on a fresh
   backup.
2. `docker tag realtimedocs-server:local realtimedocs-server:previous`, take a backup, `deploy/up.sh`.
3. Delete `deploy/admin-credentials.txt` once the password is stored elsewhere.
4. Publishing desktop builds needs a Windows machine, a Mac and signing credentials
   ([desktop-release.md](desktop-release.md)).
