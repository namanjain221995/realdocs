# Implementation checkpoint

_Last updated: 2026-11-11, after the final verification and the last redeploy._

## How to resume

1. `. scripts/dev-env.sh` (pinned Node 24.22.2 + pnpm 12.18.0 in `.toolchain/`), then
   `node scripts/verify-install.mjs`.
2. Read `docs/architecture.md`, `docs/decisions.md`, `docs/requirements-checklist.md`, `docs/testing.md`,
   then the area notes in `docs/notes/` (server, web, editor, desktop, perf).
3. The live deployment is described in `deploy/README.md`. Operate it only through `deploy/*.sh`; never run
   a plain `docker compose … down -v` in this repository.

## State

| Area                                                                                                                                           | State                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Server (Fastify, Hocuspocus, PostgreSQL, durable log, assets, exports, CLI, sign-up, downloads)                                                | done                                                                  |
| Web app (landing page, sign-in/up, dashboard, editor, sharing, snapshots, reading mode, docs reader)                                           | done                                                                  |
| Editor package (schema v2 with callouts, collaboration session, clipboard, uploads, Mermaid)                                                   | done                                                                  |
| Desktop app (normal window and Private Presenter Mode, tray/menu bar, shortcuts, Safe Share Guide, Privacy Test Center, packaging, installers) | done in code and packaging configuration; **nothing native executed** |
| Windows diagnostics N-API module                                                                                                               | written and reviewed; **never compiled or run**                       |
| Acceptance layer (`tests/e2e`, 20 scenarios mapped in `docs/testing.md`)                                                                       | done                                                                  |
| Performance harness (`tests/perf`, results in `docs/performance.md`)                                                                           | done                                                                  |
| Documentation (README and every required `docs/*.md`)                                                                                          | done                                                                  |
| Public deployment `https://realdocs.techsarasolutions.com` (Cloudflare Tunnel)                                                                 | live; desktop downloads deliberately unpublished                      |

## Verified results (observed on this host on 2026-11-11; details and commands in `docs/testing.md`)

- Unit tests: contracts, ui, editor, server and web 991 passed; desktop 670 passed.
- Server integration (real PostgreSQL and server process): 149 passed. Backup → restore rehearsal: passed.
- Web: mocked suite 832 passed (2 skipped) in Chromium, Firefox and WebKit; real-stack suite 69 + 18 passed.
- Editor browser checks: Chromium 38/38, Firefox 36/36, WebKit 36/36 (2 skipped each in Firefox and WebKit).
- Desktop (Linux/Xvfb smoke only): smoke 64/64, real-stack 20/20; packages: `inspect-package` 212 ok,
  `test:packaged` 39/39 (reported by the desktop agent).
- Acceptance suite: 54 passed, 0 failed, plus 3 expected failures that pin the known defect below.
  Fresh documented Compose setup: passed twice.
- Performance: p95 text edit → visible remote render 4.2–10.2 ms on loopback, 16.7–23.4 ms at an emulated
  10 ms RTT, 55.8–62.0 ms at an emulated 50 ms RTT (2/5/10 clients, small and large documents); the
  < 100 ms target holds in all 18 configurations. Emulation is a userspace delay proxy, not a real LAN.

## Known defects and open items

- **Simultaneous Enter (acceptance scenario 3):** when two or three editors press Enter at the same instant
  in the same or adjacent paragraphs, every client converges on the same document, but it is not what was
  typed (empty paragraphs; characters in or duplicated into another editor's paragraph). Splits taken in
  turns and ordinary concurrent typing are correct. Pinned by `tests/e2e/specs/convergence.spec.ts`
  (`test.fail`). Cause not investigated; it matches how the Yjs–ProseMirror binding turns a paragraph split
  into delete + insert operations. Re-test with `@tiptap/y-tiptap` 3.3.0 or later once the release-age policy
  allows it.
- Three editor toolbar menus (block type, font size, code language) use a native `<select>`; on Windows such
  popups are separate windows that private mode does not cover. They show option names, not document text.
- A cold load of a document with a Mermaid diagram transfers about 3.9 MiB (about 1.5 MiB without one);
  images below the fold load lazily; a silent network loss is detected after the 15 s ping / 45 s idle timeout.
- Cloudflare settings for the owner: disable Web Analytics injection for the hostname (blocked by the CSP);
  optionally "Always Use HTTPS" (the server already redirects) and "Respect Existing Headers" for browser cache.

## NOT TESTED (needs real machines; steps in `docs/windows-client.md`, `docs/macos-client.md`, `docs/capture-compatibility.md`)

Everything native on Windows and macOS: transparency, click-through, tray and menu bar, shortcuts, focus,
multiple monitors, Spaces and fullscreen, capture exclusion, key stores, deep links, installers, signing,
notarisation, the diagnostics module, and all 114 meeting-capture combinations in the matrix. Real Safari,
real phones and tablets, screen readers, HTTPS on a reverse proxy other than the Cloudflare tunnel.
