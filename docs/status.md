# Implementation checkpoint

_Last updated: 2026-11-12, after the enterprise upgrade was committed, pushed and deployed. The public site
runs the upgraded server image (deployed 2026-11-12 10:28 UTC) and serves desktop release 0.1.0 (unsigned)._

_Desktop 0.1.2 is the current release (2026-11-13): paragraph indents on the ruler (document schema 3), panel in front of full-screen browsers (checked on native Windows and macOS runners), margins in the panel; see [desktop-release.md](desktop-release.md). The live server runs the same code._

## How to resume

1. `. scripts/dev-env.sh` (pinned Node 24.22.2 + pnpm 12.18.0 in `.toolchain/`), then
   `node scripts/verify-install.mjs`.
2. Read [enterprise-upgrade-report.md](enterprise-upgrade-report.md) (what was done and what was not),
   [enterprise-upgrade-plan.md](enterprise-upgrade-plan.md), [decisions.md](decisions.md),
   [known-limitations.md](known-limitations.md), then the area notes in `docs/notes/`.
3. The live deployment is described in `deploy/README.md`. Operate it only through `deploy/*.sh`; never
   run a plain `docker compose … down -v` in this repository. Upgrading it:
   [upgrade-and-rollback.md](upgrade-and-rollback.md).
4. Git: the upgrade is committed and pushed to `https://github.com/namanjain221995/realdocs` (`main`:
   commits `f306fce`, `66b887c`, `8394888`, `c599e4e`; later commits will follow). 117 regenerated editor
   screenshots under `packages/editor/demo/screenshots` were deliberately left uncommitted.
   `apps/desktop/build/` (icons, installer script) had been hidden by the `build/` ignore rule and is
   now tracked.

## State

Labels: IMPLEMENTED AND VERIFIED (ran on this host), IMPLEMENTED BUT NOT NATIVE-TESTED, CONFIGURED BUT
REQUIRES CREDENTIAL, PARTIALLY IMPLEMENTED, BLOCKED WITH EXACT REASON.

| Area                                                                                                    | State                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload queue (automatic retry, pause on rate limit, de-duplication)                                     | IMPLEMENTED AND VERIFIED                                                                                                                                   |
| Unsupported content (named, pauses editing in that window, clears itself)                               | IMPLEMENTED AND VERIFIED in unit tests; PARTIALLY IMPLEMENTED against the request (no per-node placeholders, no browser check of the notice)               |
| Interview session API, API keys, idempotency, webhooks, OpenAPI, `/docs` portal, admin pages            | IMPLEMENTED AND VERIFIED (server); portal and admin pages have unit tests only, no browser spec                                                            |
| Page settings, margins, ruler, print                                                                    | IMPLEMENTED AND VERIFIED; printing on paper or to PDF not checked; paragraph indent markers since 2026-11-13; no pagination                                |
| Version history (attributed log, timeline, diff, preview, restore, copy, export, attachment retention)  | IMPLEMENTED AND VERIFIED                                                                                                                                   |
| Release store, manifest and update endpoints, OS-aware download, publish script                         | IMPLEMENTED AND VERIFIED                                                                                                                                   |
| Desktop release 0.1.0 (stable), all unsigned and not notarised: ten files built by CI on native runners | PUBLISHED on the live site; downloaded from the public URL and checked (see below); the `.exe` installers were not produced                                |
| Desktop packages: Windows x64, macOS arm64 and x64 zips                                                 | Launch-tested natively in CI (the packaged app stayed running 20 s on its own OS); not manually tested; capture exclusion not measured                     |
| Desktop packages: Linux x64                                                                             | IMPLEMENTED AND VERIFIED (packaged-app Xvfb check in CI)                                                                                                   |
| Desktop packages: Linux arm64                                                                           | IMPLEMENTED AND VERIFIED (local Xvfb checks on this host); built and inspected in CI, not started on its architecture there                                |
| Desktop packages: Windows arm64                                                                         | IMPLEMENTED BUT NOT NATIVE-TESTED (built and inspected, never started on Windows arm64)                                                                    |
| Windows installer `.exe`, AppImage, macOS universal build                                               | NOT PRODUCED: `makensis` was not on the path in CI and the installer step is `continue-on-error`; no AppImage; no universal build                          |
| Windows signing, macOS signing and notarisation                                                         | CONFIGURED BUT REQUIRES CREDENTIAL (no credentials exist; every published file is unsigned)                                                                |
| Desktop update check, verified download, "update required" state                                        | IMPLEMENTED; "Update and restart" verified end to end on Linux (update-check.mjs), Windows and macOS not yet                                               |
| CI and desktop release workflows                                                                        | EXECUTED on GitHub: `ci.yml` passed on `c599e4e`; `desktop-release.yml` run 43195585865 succeeded on all four runners (after three failed runs and fixes)  |
| Several server instances (Redis lease, forwarded sockets, shared tickets and limits)                    | IMPLEMENTED AND VERIFIED (integration tests, Compose trial, load tests on one host)                                                                        |
| Metrics, readiness with Redis and drain                                                                 | IMPLEMENTED AND VERIFIED; no tracing                                                                                                                       |
| Landing page                                                                                            | IMPLEMENTED AND VERIFIED (three browsers, six widths); 200 % zoom not checked                                                                              |
| Load tests                                                                                              | PARTIALLY IMPLEMENTED: see [load-test-report.md](load-test-report.md) for what ran and what did not                                                        |
| Migration and rollback                                                                                  | Migration APPLIED to production on 2026-11-12 (migrations 2, 3 and 4); rollback rehearsed on copies, the wrapper rollback on the live project NOT executed |
| Live site smoke test (`scripts/live-smoke.mjs`)                                                         | IMPLEMENTED AND VERIFIED: 26/26 checks passed against the public site                                                                                      |
| Manual operation of the app on Windows and macOS, capture exclusion, every meeting application          | NOT TESTED                                                                                                                                                 |

## Verified results (observed on this host on 2026-11-12)

| Suite                                                                           | Result                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`                  | clean (lint: 27 `any` warnings in `tests/load`, no errors)                                                                           |
| `pnpm test` (unit, all packages)                                                | 81 files, 1,919 passed (before two later test-only changes; desktop unit tests: 704 passed after them)                               |
| `pnpm test:integration` (real PostgreSQL, real server, Redis for cluster)       | 21 files, 225 passed                                                                                                                 |
| `pnpm test:backup-restore`                                                      | passed (35 s)                                                                                                                        |
| Web, mocked API (`apps/web/test-browser`), Chromium + Firefox + WebKit          | 948 passed, 2 skipped; 1 failed once (Firefox landing keyboard test) and passed on rerun                                             |
| Web, real stack (`apps/web/test-real`)                                          | 69 passed; outage group 18 passed                                                                                                    |
| Acceptance (`pnpm test:e2e`)                                                    | 42 passed, disruptive group 12 passed; no expected failures                                                                          |
| Editor browser checks (`packages/editor/demo/e2e.mjs`)                          | Chromium 47/47; Firefox 44 passed + 1 flake (`scroll-stability-manual`) that passed on rerun, 2 skipped; WebKit 45 passed, 2 skipped |
| Desktop: Xvfb smoke, packaged-app check (Linux)                                 | 64/64, 39/39                                                                                                                         |
| `scripts/rehearse-migration.sh … --rollback-image realtimedocs-server:previous` | on a backup taken the same day: data unchanged; rollback and roll-forward rehearsed                                                  |
| Two-instance Compose trial (`deploy/scale/`)                                    | ran once; details in [scaling.md](scaling.md)                                                                                        |
| GitHub Actions `ci.yml` on `c599e4e`                                            | passed: format, lint, types, unit tests, builds; server integration tests                                                            |
| GitHub Actions `desktop-release.yml`, run 43195585865                           | succeeded on windows-latest, macos-15 (arm64), macos-15-intel (x64), ubuntu-latest                                                   |
| `apps/desktop/scripts/launch-check.mjs` in CI                                   | packaged app stayed running 20 s: Windows x64, macOS arm64, macOS x64                                                                |
| `scripts/live-smoke.mjs` against `https://realdocs.techsarasolutions.com`       | 26/26 checks passed (see [deployment.md](deployment.md))                                                                             |
| Live deployment, 2026-11-12 10:28 UTC (`deploy/up.sh`)                          | migrations 2, 3, 4 applied; health and ready 200 locally and through Cloudflare; container replacement took about nine seconds       |

Two things seen during the day that were not product defects: the editor's WebKit checks
`scroll-stability-manual` and `typing-performance` failed while the load tests held the host at a load
average of 21 and passed at a load of 9 and again in the final run; the acceptance suite's disruptive
group could not start its database while the load-test proxy held local port 54330.

## Known defects and open items

- **Simultaneous Enter: fixed on 2026-11-12.** The defect first recorded on 2026-11-11 is no longer
  open. The shared document was always correct; the cause was the editor binding re-placing a caret
  in the wrong paragraph, and the `CaretKeeper` plugin now prevents that. Details in
  [testing.md](testing.md) section 5.1 and [decisions.md](decisions.md).
- **Desktop release 0.1.0 is unsigned and not notarised.** The Windows `.exe` installers were not
  produced, so none is published. Windows arm64 and Linux arm64 were never started on their own
  architecture in CI. Nobody operated the app by hand on Windows or macOS; capture exclusion was not
  measured; no meeting application was tested.
- **Wrapper rollback on the live project** was not executed (it was only rehearsed on copies).
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

## What remains for the owner

The upgrade is deployed (2026-11-12). What is left:

1. Obtain signing credentials (Windows Authenticode certificate, Apple Developer ID and notarisation
   account) and run the release workflow with them ([desktop-release.md](desktop-release.md)). Release
   0.1.0 is unsigned and not notarised.
2. Test the Windows and macOS builds by hand, including capture exclusion with real meeting
   applications, following [capture-compatibility.md](capture-compatibility.md). Only a launch check in
   CI has run there.
3. Delete `deploy/admin-credentials.txt` once the password is stored elsewhere.
4. Copy backups off the server and automate them. They are not automated.
5. Run the load-test items that did not run: the one-hour soak and the scenarios listed in
   [load-test-report.md](load-test-report.md).
6. Optionally execute the rollback through the deploy wrappers against the live project once, in a
   planned window; so far it has only been rehearsed on copies
   ([upgrade-and-rollback.md](upgrade-and-rollback.md)).
