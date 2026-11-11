# Performance notes (`tests/perf`, package `@realtimedocs/perf`)

Measured on 2026-11-11 (host local time) on the build host. Raw samples (JSON) and the generated
`summary.md` of the run quoted here are in `tests/perf/results/20261110T224854Z/` (the directory name is the
UTC start of the run). A short re-check of four headline configurations on the later build is in
`tests/perf/results/20261110T224854Z-spotcheck/`. Every number below is copied from those summaries.

## 1. Verdict against the brief

Target: plain-text edits after connection, healthy LAN with RTT of 10 ms or less, small document, up to 10
clients, **p95 edit-to-visible-remote-render below 100 ms**.

**Met in every measured configuration, with a wide margin.** p95 of the editor's keystroke until the marker is
in each viewer's DOM (320 edits per configuration, 50 warm-up edits excluded, pooled over all viewers):

| network condition (measured RTT, p50 of 300 pings)                            | small document, 2 / 5 / 10 clients | large document (201 blocks, 50 kB), 2 / 5 / 10 clients |
| ----------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| loopback on one host (0.4 ms)                                                 | 4.2 / 5.6 / 4.3 ms                 | 4.9 / 10.2 / 9.0 ms                                    |
| emulated 10 ms RTT (10.8 ms; userspace delay proxy, not a real LAN)           | 18.0 / 17.3 / 16.7 ms              | 20.0 / 23.4 / 22.7 ms                                  |
| emulated 50 ms RTT, WAN-like (50.9 ms; userspace delay proxy, not a real WAN) | 59.0 / 55.8 / 62.0 ms              | 56.8 / 56.4 / 56.5 ms                                  |

The 10 ms condition measured 10.8 ms RTT at p50 (the proxy adds 5 ms per direction plus about 0.4 ms of
userspace overhead per direction), slightly above the brief's "10 ms or less"; the margin to 100 ms makes that
irrelevant for the verdict. The 50 ms condition also stays below 100 ms (worst p95 62.0 ms), but the brief
asks for wider networks to be reported separately and not as part of the target. The later-build spot check
(section 4) gave p95 of 7.4 / 4.8 ms (loopback, 10 clients, small / large) and 15.8 / 16.6 ms (10 ms RTT).

**Where the time goes (no bottleneck to fix).** The latency follows the network almost exactly:

- The protocol-only client-to-client relay (Node clients, no rendering, section 2a of the results) is 0.8-1.3 ms at p50 on
  loopback and 11.7-12.7 ms at 10 ms RTT; the browser path adds about 2-6 ms (editor keystroke handling and Yjs
  encoding, viewer ProseMirror update and DOM mutation): loopback 3.4-6.8 ms p50 against 0.8-1.3 ms.
- At 50 ms RTT the path editor -> server -> viewer crosses the delay twice (25 ms each way per leg, 50 ms
  in all) and the result is 54.6-58.3 ms p50, again about 3-8 ms above the pure network time.
- Local typing never waits for the network (results section 5): p50 1.6-2.2 ms and p95 2.1-2.7 ms whether the connection is
  loopback, emulated 50 ms RTT or the server is stopped.
- The server's durable "Saved" acknowledgement (results section 2b) costs 4-14 ms at p50..p95 on loopback (two modes, about 4 ms and 13 ms,
  which looks like PostgreSQL commit timing; the cause was not investigated) and one RTT plus that at higher RTT
  (63-65 ms p50 at 50 ms RTT). It is not on the path of remote rendering: relay does not wait for the commit.
- Server CPU with 10 clients typing about 66 edits/s together and a mark per edit: 4.9-5.8 % of one core;
  server RSS about 290-300 MiB.

Findings outside the harness's scope (no change made, `apps/**` and `packages/**` untouched):

1. **Cold load of the sample document transfers about 3.9 MiB in 90 requests** (loopback; median of 30; JavaScript
   chunks of the web app, `index-*.js`, Mermaid, KaTeX, ELK chunks are separate files) and shows content after
   about 470 ms on loopback, 620-625 ms at 10 ms RTT and 1.21-1.22 s at 50 ms RTT. A warm visit still needs about
   434-442 ms on loopback, so most of it is application start-up, not transfer. Proposed: check what the first
   screen imports eagerly (the request counts show 86 requests even when warm), and lazy-load Mermaid/KaTeX
   chunks only when a diagram or formula is in the document. Not a target miss; the brief has no initial-load target.
2. **Images use `loading="lazy"`** (`packages/editor/src/editor/nodeViews/ImageView.tsx`). A remote image below the fold
   is not fetched until the viewer scrolls near it, so "image visible remotely" for long documents depends on
   scroll position. The harness clears the document between samples so the image is in the viewport.
3. **A dead connection is detected by the application ping (15 s) and the idle cut-off (45 s)** when the network
   drops silently. The reconnect test uses clean resets (results section 6 explains), which is the best case.

## 2. Method

### Stack

`pnpm --filter @realtimedocs/perf run stack:up` (`src/stack.ts`):

- PostgreSQL 17.11 as container `rd-perf-pg` on 127.0.0.1:54320, default settings (fsync on), container filesystem.
- The server (`apps/server/dist`, built with `pnpm --filter @realtimedocs/server run build`) as a plain Node
  process on 127.0.0.1:4320; the web app built with `vite build --outDir tests/perf/.stage/web` (private copy,
  `apps/web/dist` is not touched) and served by the server through `WEB_DIST_DIR`.
- Non-default settings: `NODE_ENV=production`, `LOG_LEVEL=warn`, `CLEANUP_INTERVAL_MINUTES=0`,
  `ALLOWED_ORIGINS` for the proxy ports 4321, 4322 and 4324, `WEB_DIST_DIR`, `ASSET_DIR`, and the per-address
  rate limits raised (`RATE_API_PER_MINUTE=1000000`, `RATE_LOGIN_PER_IP`, `RATE_SHARE_EXCHANGE_PER_IP`,
  `RATE_INVITE_PER_IP`, `RATE_DESKTOP_REDEEM_PER_IP`, `RATE_COLLAB_TICKET_PER_MINUTE`, `RATE_UPLOAD_PER_MINUTE`,
  `RATE_WS_UPGRADE_PER_MINUTE`). The per-socket frame budget stays at its default. `DATABASE_URL` and `SESSION_SECRET` are generated per run.
- The administrator is created with the CLI (`bootstrap-admin --generate`); the generated password is written to
  `tests/perf/.stage/admin-password` (mode 600) and never printed. The sample document comes from `seed-sample`;
  the large document (200 paragraphs of about 250 characters, 201 blocks, 49,994 bytes of text) is generated through
  a collaboration client; the medium (101 blocks, 46,839 bytes) and huge (501 blocks, 499,464 bytes) ones for the
  resource test the same way. Documents and viewer share links are created through the HTTP API.
- Two userspace delay proxies (`src/proxy.ts`, own process): 127.0.0.1:4321 adds 5 ms to every chunk in each
  direction, 4322 adds 25 ms. They delay application data only (not the TCP handshake) and model no bandwidth
  limit, loss or jitter. They are **emulated with a userspace delay proxy, not a real LAN or WAN**.
- The RTT is measured through each proxy (`src/ping.ts`): WebSocket ping/pong control frames to `/collab`
  (300 samples, 20 ms apart, sender-side `performance.now()`), plus an HTTP request on a keep-alive connection.
  The measurement is a round trip at one sender, not a one-way delay. Before and after the run: loopback 0.4 / 0.3 ms,
  10 ms condition 10.8 / 10.7 ms, 50 ms condition 50.9 / 50.9 ms (p50).

### Clock method (text tests)

Editor and viewers are pages of **one Chromium process on this host** (Chromium 156.0.8078.4 from the Playwright 1.64.1
image, headless, background throttling disabled, one browser context per viewer). `t0` and `t1` are both
`performance.timeOrigin + performance.now()` read inside those pages, i.e. the same OS clock; no timestamps of separate
computers are ever subtracted. Resolution: Chromium rounds `performance.now()` to 0.1 ms in pages that are not
cross-origin isolated. Agreement of the pages' clocks was checked before and after every run against the driver's
clock (best of 25 round trips per page): the largest absolute offset was 0.28 ms with an uncertainty (half the CDP
round trip) of 0.16-0.84 ms, i.e. no offset is distinguishable from zero.

- `t0`: capture-phase `keydown` listener on `window` of the editor page, the first script that sees the key.
- `t1` (DOM): first MutationObserver callback in the viewer after which the marker is in the viewer's DOM. A marker is
  (position k, letter k) of a fixed pseudo-random lower-case sequence; every viewer verifies the letter too (mismatches: 0).
- `t1` (frame): the next `requestAnimationFrame` callback, the frame in which that DOM change is painted. Pixels on a display cannot be
  observed in a headless browser; the frame number is the nearest honest proxy.
- Typing: one real key press every 100-200 ms (5-10 characters per second), 50 warm-up edits, then 320 edits. Sample counts in
  the tables are viewer samples (edits x (clients - 1), pooled, not independent); "worst viewer per edit" is also given.
- The protocol test (Node clients on `@hocuspocus/provider` + `yjs` + `ws`, authenticated with tickets, `hello` after sync, one `mark` per edit) runs
  all clients in one Node process, so one `performance.now()` clock; 400 edits per configuration.
- Initial load uses the page's own `performance.now()` since navigation start (one clock). Images use the page clocks like the text test.

### Reconnect, memory, local latency

Driven from the host through a Playwright server in the Playwright image (`stack.ts pw-up`) so the host process can stop and start the
server and cut a TCP proxy; the page clocks and the host's `performance.timeOrigin + performance.now()` are the same OS clock. Method details
are in results sections 5-7 below.

## 3. How to rerun

```sh
. scripts/dev-env.sh
pnpm --filter @realtimedocs/perf run stack:up          # builds server and web, starts rd-perf-pg, server, proxies; --no-build to reuse builds (pass `-- --no-build`)
pnpm perf                                               # ping, headline, protocol, initial load, images -> tests/perf/results/<UTC>/
# flags: node --import tsx tests/perf/src/run.ts --edits 320 --protocol-edits 400 --loads 30 --images 20 --only ping,browser-edit
pnpm --filter @realtimedocs/perf run stack:pw-up       # once, for the three scenarios below
PERF_RUN_DIR=tests/perf/results/<dir> pnpm --filter @realtimedocs/perf run perf:local
PERF_RUN_DIR=tests/perf/results/<dir> pnpm --filter @realtimedocs/perf run perf:reconnect
PERF_RUN_DIR=tests/perf/results/<dir> pnpm --filter @realtimedocs/perf run perf:resources
pnpm --filter @realtimedocs/perf run perf:report -- tests/perf/results/<dir>      # rebuilds summary.md
pnpm --filter @realtimedocs/perf run stack:down        # stops server, proxies, rd-perf-pg and the Playwright server
```

Single scenarios: `perf:ping`, `perf:protocol <cond> <doc> <clients> <edits>`, `perf:browser-edit <cond> <doc> <clients> <edits>`
(conditions `loopback|rtt10|rtt50`, documents `small|large`), `perf:initial-load`, `perf:image <cond> <clients> <bytes> <count>`.
Browser scenarios run in `mcr.microsoft.com/playwright:v1.64.1-noble` with `--network host --user 1000:1000`.
`pnpm --filter @realtimedocs/perf run typecheck`, ESLint and Prettier are clean on `tests/perf`.

## 4. Limitations (read before quoting a number)

- One host, one browser engine (Chromium) for every number. Firefox and WebKit were not measured.
- Loopback is not a LAN: no NIC, switch or Wi-Fi. Emulated RTTs come from a userspace TCP delay proxy (no bandwidth limit,
  loss or jitter, handshake not delayed); this is not a real LAN or the internet.
- The host is shared: other workloads ran during the measurements (vLLM, other agents' browsers). The 1-minute load average
  was between 2 and 19 on 20 cores (10 Cortex-X925 + 10 Cortex-A725) and is listed per step at the end of the results. Results may be better on a quiet machine and worse on a busy one.
- Headless Chromium: "visible" is DOM present plus the next animation frame, not photons.
- The server, PostgreSQL, proxies, browsers and the driver share the same CPUs.
- Two builds were involved. The main run (everything except results sections 5-7 and one image row) used the server bundle and
  web build of about 04:08 host time (document schema version 1). Another agent rebuilt `apps/server/dist` later
  (schema version 2), so the web app was rebuilt and results sections 5-7 and the image row "emulated 50 ms RTT, 5 clients, 2001 kB"
  (the original run of that step failed on a navigation timeout and was repeated) were measured on the newer build. The spot check
  in `results/20261110T224854Z-spotcheck/` repeats four headline cells on the newer build: p95 7.4 and 4.8 ms
  (loopback, 10 clients, small and large), 15.8 and 16.6 ms (10 ms RTT); the main run gave 4.3, 9.0, 16.7 and 22.7 ms.
  The sample document had 17 blocks in the first stack and 18 in the second (fresh database, same seed command); the cause was not investigated.
- Results section 6 (reconnect) uses 3-5 repetitions per cell, so its percentiles are only min/median/max in practice.
- Memory/CPU: 60 s per document, one run each; RSS of the server at "start" includes its warm-up growth (216 MiB to 288 MiB in the first run).
  Renderer CPU is the page's main thread only. PostgreSQL's own CPU and memory were not measured.
- In the image test the viewer fetch goes through the same emulated condition but without a bandwidth limit, so large-image times at 50 ms RTT
  are latency-bound only.

## 5. Results

The sections below are the generated `summary.md` of `tests/perf/results/20261110T224854Z/` (headings demoted by one level).

Run directory: `20261110T224854Z` (UTC timestamp). All numbers below were measured on this host in this run; nothing is estimated or extrapolated.

### Environment

- Hardware: Cortex-X925 + Cortex-A725, 20 logical cores (10 cores at max 3900.0000 MHz; 10 cores at max 2808.0000 MHz); memory MemTotal: 127598700 kB, MemAvailable: 25857096 kB at start; Ubuntu 24.04.5 LTS, kernel Linux 7.0.0-1025-nvidia aarch64.
- Load: this host is shared with other workloads. 1/5/15-minute load average at the start of the run: 7.68 / 10.90 / 8.70 on 20 cores. Top CPU consumers at start (percent, command): `%CPU COMMAND |  127 MainThread |  127 VLLM::Worker_TP |  100 ps | 78.9 chrome-headless | 78.3 cpptools | 60.4 VLLM::EngineCor | 40.2 python`.
- Software: Node v24.22.2 (host scripts, protocol test), server RealtimeDocs 0.1.0 (protocol 1) run as a plain Node process from `apps/server/dist`, postgres (PostgreSQL) 17.11 in container `rd-perf-pg` (default settings, fsync on, container filesystem), Docker version 29.6.2, build dfc4efb, Playwright image `mcr.microsoft.com/playwright:v1.64.1-noble` (Node 24.21.0 inside, Chromium version in the tables below).
- Server settings (every non-default value): `NODE_ENV=production RD_HOST=127.0.0.1 RD_PORT=4320 PUBLIC_ORIGIN=http://127.0.0.1:4320 ALLOWED_ORIGINS=http://127.0.0.1:4321,http://127.0.0.1:4322 WEB_DIST_DIR=/home/techsphere/Documents/project/realtimedocs/tests/perf/.stage/web ASSET_DIR=/home/techsphere/Documents/project/realtimedocs/tests/perf/.stage/assets LOG_LEVEL=warn CLEANUP_INTERVAL_MINUTES=0 RATE_API_PER_MINUTE=1000000 RATE_LOGIN_PER_IP=100000 RATE_SHARE_EXCHANGE_PER_IP=100000 RATE_INVITE_PER_IP=100000 RATE_DESKTOP_REDEEM_PER_IP=100000 RATE_COLLAB_TICKET_PER_MINUTE=100000 RATE_UPLOAD_PER_MINUTE=100000 RATE_WS_UPGRADE_PER_MINUTE=100000 DATABASE_URL=postgres://rd:***@127.0.0.1:54320/realtimedocs_perf SESSION_SECRET=*** (generated, 32 random bytes)`. Everything else is the default of `docs/notes/server.md`.
- Documents: **small** = the seeded sample document, 17 blocks, 1594 bytes of text (UTF-8, plain-text export), 5314 bytes Yjs state, it also holds one image and a diagram. **large** = generated, 201 blocks (200 paragraphs of about 250 characters, plus the empty paragraph the editor keeps), 49994 bytes of text, 57448 bytes Yjs state.

### Network conditions and measured RTT

"RTT" below is a round-trip time measured at one sender with one clock (`performance.now()`), not a one-way delay. Method: WebSocket ping/pong control frames to `/collab` (answered by the `ws` library of the server), 300 samples after 20 warm-up, 20 ms apart; plus an HTTP GET `/api/health` on a keep-alive connection (includes about 0.3 ms of server handling). The "emulated" conditions use a userspace Node TCP delay proxy that adds a fixed delay per direction to every chunk, WebSocket included; it does not model bandwidth, loss, jitter, or the delay of the TCP handshake. **Emulated with a userspace delay proxy, not a real LAN or WAN.**

Measured before the run:

| condition                                                                            | added by proxy (RTT) | WebSocket ping RTT: samples | p50 ms | p95 ms | p99 ms | mean ms | max ms | HTTP RTT p50 | HTTP RTT p95 |
| ------------------------------------------------------------------------------------ | -------------------: | --------------------------: | -----: | -----: | -----: | ------: | -----: | -----------: | -----------: |
| loopback on one host                                                                 |                 0 ms |                         300 |    0.4 |    0.5 |    0.6 |     0.4 |    0.6 |          0.8 |          0.9 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |                10 ms |                         300 |   10.8 |   11.3 |   11.6 |    10.9 |   12.7 |         11.3 |         11.7 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |                50 ms |                         300 |   50.9 |   51.2 |   51.4 |    51.0 |   52.2 |         51.4 |         51.7 |

Measured after the run:

| condition                                                                            | added by proxy (RTT) | WebSocket ping RTT: samples | p50 ms | p95 ms | p99 ms | mean ms | max ms | HTTP RTT p50 | HTTP RTT p95 |
| ------------------------------------------------------------------------------------ | -------------------: | --------------------------: | -----: | -----: | -----: | ------: | -----: | -----------: | -----------: |
| loopback on one host                                                                 |                 0 ms |                         300 |    0.3 |    0.5 |    0.6 |     0.3 |    0.7 |          0.7 |          0.9 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |                10 ms |                         300 |   10.7 |   11.1 |   11.3 |    10.7 |   11.4 |         11.2 |         11.4 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |                50 ms |                         300 |   50.9 |   51.3 |   51.5 |    50.9 |   52.1 |         51.3 |         51.7 |

### 1. Text edit to visible remote render (headline, real editor pages in one Chromium)

Chromium 156.0.8078.4, headless, one process; one editor page plus N-1 viewer pages (viewers are share-link guests, each in its own browser context; the editor is the administrator's session). The editor types one letter every 100-200 ms (5-10 characters per second) after a 50-edit warm-up; each letter is a marker (position k, letter k of a fixed pseudo-random sequence) and every viewer verifies both.

**Clock method.** t0 and t1 are both `performance.timeOrigin + performance.now()` read inside pages of the same Chromium on the same host, so they share one OS clock; no timestamps from separate computers are subtracted. `performance.now()` is rounded by Chromium to 100 microseconds in non-isolated pages, so the resolution is 0.1 ms. t0 = capture-phase `keydown` listener on `window` of the editor page (the first script that sees the key, before ProseMirror handles it). t1 (DOM) = the first MutationObserver callback in the viewer after which the marker is present in the viewer's DOM. t1 (next frame) = the `requestAnimationFrame` callback after that DOM change, i.e. the frame in which the browser paints it (headless cannot report when pixels reach a display). Pages' clocks were compared with the Node driver's clock before and after each run (best of 25 round trips per page); the largest absolute offset and the uncertainty of that comparison (half the CDP round trip) are in the last column.

#### 1a. t1 = marker present in the viewer DOM

| condition                                                                            | document | clients | edits | viewer samples | p50 ms | p95 ms | p99 ms | mean ms | max ms | worst viewer per edit p95 ms | p95 < 100 ms | missing/mismatched | clock offset                     |
| ------------------------------------------------------------------------------------ | -------- | ------: | ----: | -------------: | -----: | -----: | -----: | ------: | -----: | ---------------------------: | ------------ | ------------------ | -------------------------------- |
| loopback on one host                                                                 | large    |      10 |   320 |           2880 |    5.8 |    9.0 |   12.7 |     6.2 |   21.3 |                         11.5 | yes          | 0/0                | max 0.15 ms, uncertainty 0.28 ms |
| loopback on one host                                                                 | large    |       2 |   320 |            320 |    4.1 |    4.9 |    6.2 |     4.2 |    7.9 |                          4.9 | yes          | 0/0                | max 0.04 ms, uncertainty 0.25 ms |
| loopback on one host                                                                 | large    |       5 |   320 |           1280 |    6.8 |   10.2 |   14.1 |     6.8 |   18.6 |                         11.3 | yes          | 0/0                | max 0.16 ms, uncertainty 0.21 ms |
| loopback on one host                                                                 | small    |      10 |   320 |           2880 |    3.4 |    4.3 |    5.5 |     3.5 |   14.7 |                          5.7 | yes          | 0/0                | max 0.20 ms, uncertainty 0.40 ms |
| loopback on one host                                                                 | small    |       2 |   320 |            320 |    3.6 |    4.2 |    4.7 |     3.7 |    7.5 |                          4.2 | yes          | 0/0                | max 0.03 ms, uncertainty 0.21 ms |
| loopback on one host                                                                 | small    |       5 |   320 |           1280 |    3.9 |    5.6 |    7.0 |     4.1 |   10.4 |                          6.0 | yes          | 0/0                | max 0.10 ms, uncertainty 0.28 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    |      10 |   320 |           2880 |   18.4 |   22.7 |   29.0 |    18.9 |   37.2 |                         25.7 | yes          | 0/0                | max 0.18 ms, uncertainty 0.35 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    |       2 |   320 |            320 |   18.2 |   20.0 |   21.4 |    18.3 |   22.0 |                         20.0 | yes          | 0/0                | max 0.26 ms, uncertainty 0.84 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    |       5 |   320 |           1280 |   18.4 |   23.4 |   36.3 |    19.0 |   42.7 |                         25.1 | yes          | 0/0                | max 0.08 ms, uncertainty 0.33 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    |      10 |   320 |           2880 |   14.6 |   16.7 |   18.6 |    14.9 |   40.6 |                         17.3 | yes          | 0/0                | max 0.15 ms, uncertainty 0.41 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    |       2 |   320 |            320 |   15.9 |   18.0 |   19.3 |    16.0 |   22.8 |                         18.0 | yes          | 0/0                | max 0.11 ms, uncertainty 0.31 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    |       5 |   320 |           1280 |   15.8 |   17.3 |   18.3 |    15.8 |   19.6 |                         17.6 | yes          | 0/0                | max 0.24 ms, uncertainty 0.26 ms |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    |      10 |   320 |           2880 |   55.4 |   56.5 |   57.1 |    55.4 |   60.4 |                         57.2 | yes          | 0/0                | max 0.18 ms, uncertainty 0.29 ms |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    |       2 |   320 |            320 |   55.5 |   56.8 |   57.8 |    55.6 |   59.1 |                         56.8 | yes          | 0/0                | max 0.14 ms, uncertainty 0.29 ms |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    |       5 |   320 |           1280 |   55.3 |   56.4 |   57.0 |    55.3 |   57.8 |                         56.7 | yes          | 0/0                | max 0.18 ms, uncertainty 0.16 ms |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    |      10 |   320 |           2880 |   58.3 |   62.0 |   65.0 |    58.2 |   72.2 |                         65.2 | yes          | 0/0                | max 0.14 ms, uncertainty 0.38 ms |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    |       2 |   320 |            320 |   57.3 |   59.0 |   60.5 |    57.4 |   61.1 |                         59.0 | yes          | 0/0                | max 0.28 ms, uncertainty 0.47 ms |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    |       5 |   320 |           1280 |   54.6 |   55.8 |   57.1 |    54.7 |   58.3 |                         55.9 | yes          | 0/0                | max 0.13 ms, uncertainty 0.18 ms |

#### 1b. t1 = next animation frame after the DOM change

| condition                                                                            | document | clients | edits | viewer samples | p50 ms | p95 ms | p99 ms | mean ms | max ms | worst viewer per edit p95 ms | p95 < 100 ms | missing/mismatched | clock offset                     |
| ------------------------------------------------------------------------------------ | -------- | ------: | ----: | -------------: | -----: | -----: | -----: | ------: | -----: | ---------------------------: | ------------ | ------------------ | -------------------------------- |
| loopback on one host                                                                 | large    |      10 |   320 |           2880 |    6.5 |   10.8 |   16.7 |     7.1 |   30.7 |                         13.8 | yes          | 0/0                | max 0.15 ms, uncertainty 0.28 ms |
| loopback on one host                                                                 | large    |       2 |   320 |            320 |    4.4 |    5.3 |    6.8 |     4.5 |    8.3 |                          5.3 | yes          | 0/0                | max 0.04 ms, uncertainty 0.25 ms |
| loopback on one host                                                                 | large    |       5 |   320 |           1280 |    7.4 |   11.8 |   16.5 |     7.5 |   19.3 |                         14.0 | yes          | 0/0                | max 0.16 ms, uncertainty 0.21 ms |
| loopback on one host                                                                 | small    |      10 |   320 |           2880 |    3.8 |    5.2 |    6.8 |     4.0 |   15.2 |                          7.0 | yes          | 0/0                | max 0.20 ms, uncertainty 0.40 ms |
| loopback on one host                                                                 | small    |       2 |   320 |            320 |    4.2 |   14.6 |   18.8 |     5.3 |   19.8 |                         14.6 | yes          | 0/0                | max 0.03 ms, uncertainty 0.21 ms |
| loopback on one host                                                                 | small    |       5 |   320 |           1280 |    4.3 |    7.0 |    9.3 |     4.6 |   12.1 |                          7.6 | yes          | 0/0                | max 0.10 ms, uncertainty 0.28 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    |      10 |   320 |           2880 |   19.5 |   25.0 |   31.1 |    20.2 |   38.8 |                         28.1 | yes          | 0/0                | max 0.18 ms, uncertainty 0.35 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    |       2 |   320 |            320 |   18.9 |   20.9 |   22.5 |    19.0 |   24.0 |                         20.9 | yes          | 0/0                | max 0.26 ms, uncertainty 0.84 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    |       5 |   320 |           1280 |   19.1 |   26.0 |   41.7 |    20.1 |   62.2 |                         29.2 | yes          | 0/0                | max 0.08 ms, uncertainty 0.33 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    |      10 |   320 |           2880 |   15.1 |   17.7 |   21.2 |    15.5 |   45.5 |                         19.0 | yes          | 0/0                | max 0.15 ms, uncertainty 0.41 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    |       2 |   320 |            320 |   16.5 |   19.2 |   20.4 |    16.7 |   23.5 |                         19.2 | yes          | 0/0                | max 0.11 ms, uncertainty 0.31 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    |       5 |   320 |           1280 |   16.4 |   18.3 |   19.8 |    16.5 |   20.4 |                         18.9 | yes          | 0/0                | max 0.24 ms, uncertainty 0.26 ms |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    |      10 |   320 |           2880 |   55.7 |   57.1 |   58.2 |    55.8 |   61.6 |                         58.3 | yes          | 0/0                | max 0.18 ms, uncertainty 0.29 ms |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    |       2 |   320 |            320 |   55.9 |   57.2 |   58.2 |    55.9 |   59.6 |                         57.2 | yes          | 0/0                | max 0.14 ms, uncertainty 0.29 ms |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    |       5 |   320 |           1280 |   55.6 |   56.8 |   57.5 |    55.7 |   58.4 |                         57.1 | yes          | 0/0                | max 0.18 ms, uncertainty 0.16 ms |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    |      10 |   320 |           2880 |   59.4 |   64.4 |   67.3 |    59.4 |   76.5 |                         67.2 | yes          | 0/0                | max 0.14 ms, uncertainty 0.38 ms |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    |       2 |   320 |            320 |   58.0 |   59.7 |   61.4 |    58.1 |   62.4 |                         59.7 | yes          | 0/0                | max 0.28 ms, uncertainty 0.47 ms |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    |       5 |   320 |           1280 |   55.0 |   56.1 |   57.7 |    55.0 |   59.1 |                         56.4 | yes          | 0/0                | max 0.13 ms, uncertainty 0.18 ms |

"edits" = measured keystrokes; "viewer samples" = edits x (clients - 1), every viewer's latency for every edit, pooled (they are not independent). "missing/mismatched" counts edits a viewer never showed or showed with a wrong letter; both should be 0.

### 2. Protocol level, no rendering (Node clients: @hocuspocus/provider + yjs + ws)

All clients run in ONE Node process, so every timestamp is `performance.now()` of one clock. Per edit client A inserts one character (t0 = just before `doc.transact`) and sends `mark`, exactly as the editor does; "relay" = t0 until the remote update has been applied to client B's Y.Doc (`afterTransaction`, non-local), pooled over all other clients; "saved" = t0 until the server's `saved` acknowledgement for that mark arrives at A, which only happens after the PostgreSQL commit. Typing rate 5-10 characters per second, 50-edit warm-up. Clients authenticate with collaboration tickets and send `hello` after sync like the editor.

#### 2a. Update applied on A until received and applied on B

| condition                                                                            | document | clients | edits | samples | p50 ms | p95 ms | p99 ms | mean ms | max ms |
| ------------------------------------------------------------------------------------ | -------- | ------: | ----: | ------: | -----: | -----: | -----: | ------: | -----: |
| loopback on one host                                                                 | large    |      10 |   400 |    3600 |    1.1 |    1.6 |    1.8 |     1.1 |    3.1 |
| loopback on one host                                                                 | large    |       2 |   400 |     400 |    0.9 |    1.1 |    1.3 |     0.9 |    1.8 |
| loopback on one host                                                                 | large    |       5 |   400 |    1600 |    0.9 |    1.3 |    1.4 |     1.0 |    2.1 |
| loopback on one host                                                                 | small    |      10 |   400 |    3600 |    1.3 |    2.0 |    2.9 |     1.3 |    4.7 |
| loopback on one host                                                                 | small    |       2 |   400 |     400 |    0.8 |    1.2 |    1.3 |     0.9 |   10.6 |
| loopback on one host                                                                 | small    |       5 |   400 |    1600 |    1.0 |    1.4 |    1.6 |     1.0 |    2.6 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    |      10 |   400 |    3600 |   12.7 |   14.0 |   15.3 |    12.8 |   19.0 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    |       2 |   400 |     400 |   11.8 |   12.9 |   13.7 |    11.9 |   23.2 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    |       5 |   400 |    1600 |   12.3 |   13.1 |   13.7 |    12.3 |   15.1 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    |      10 |   400 |    3600 |   11.9 |   12.7 |   13.1 |    11.9 |   15.9 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    |       2 |   400 |     400 |   11.7 |   12.7 |   13.5 |    11.9 |   14.9 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    |       5 |   400 |    1600 |   11.7 |   12.4 |   12.6 |    11.7 |   12.9 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    |      10 |   400 |    3600 |   52.2 |   53.0 |   53.4 |    52.2 |   54.3 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    |       2 |   400 |     400 |   51.8 |   52.5 |   52.7 |    51.9 |   53.4 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    |       5 |   400 |    1600 |   52.0 |   52.5 |   52.8 |    52.0 |   53.2 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    |      10 |   400 |    3600 |   52.8 |   54.0 |   54.3 |    52.8 |   54.7 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    |       2 |   400 |     400 |   52.3 |   53.1 |   53.5 |    52.3 |   53.6 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    |       5 |   400 |    1600 |   52.1 |   52.9 |   53.6 |    52.1 |   57.1 |

#### 2b. Local change until the server's durable "saved"

| condition                                                                            | document | clients | edits | samples | p50 ms | p95 ms | p99 ms | mean ms | max ms |
| ------------------------------------------------------------------------------------ | -------- | ------: | ----: | ------: | -----: | -----: | -----: | ------: | -----: |
| loopback on one host                                                                 | large    |      10 |   400 |     400 |    4.0 |   13.2 |   13.7 |     5.9 |   14.0 |
| loopback on one host                                                                 | large    |       2 |   400 |     400 |   12.5 |   13.9 |   14.7 |     9.5 |   15.2 |
| loopback on one host                                                                 | large    |       5 |   400 |     400 |    4.5 |   13.3 |   13.7 |     7.9 |   14.2 |
| loopback on one host                                                                 | small    |      10 |   400 |     400 |   12.5 |   14.3 |   16.2 |     9.0 |   17.0 |
| loopback on one host                                                                 | small    |       2 |   400 |     400 |    4.2 |   13.4 |   14.1 |     7.7 |   20.6 |
| loopback on one host                                                                 | small    |       5 |   400 |     400 |    3.9 |   13.2 |   13.6 |     5.7 |   15.3 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    |      10 |   400 |     400 |   23.3 |   26.2 |   28.6 |    20.6 |   32.2 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    |       2 |   400 |     400 |   23.2 |   25.6 |   26.8 |    20.7 |   30.7 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    |       5 |   400 |     400 |   16.4 |   25.5 |   25.8 |    19.2 |   26.3 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    |      10 |   400 |     400 |   14.7 |   23.9 |   24.5 |    16.7 |   24.8 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    |       2 |   400 |     400 |   23.1 |   25.0 |   25.9 |    20.0 |   28.5 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    |       5 |   400 |     400 |   23.0 |   24.2 |   24.5 |    19.9 |   24.7 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    |      10 |   400 |     400 |   63.3 |   64.8 |   65.5 |    59.8 |   66.3 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    |       2 |   400 |     400 |   63.4 |   64.7 |   65.7 |    60.5 |   66.5 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    |       5 |   400 |     400 |   63.7 |   64.8 |   65.4 |    61.2 |   66.1 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    |      10 |   400 |     400 |   64.8 |   66.8 |   67.5 |    63.0 |   69.1 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    |       2 |   400 |     400 |   64.0 |   65.7 |   66.2 |    61.0 |   66.7 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    |       5 |   400 |     400 |   63.6 |   65.1 |   66.0 |    60.6 |   66.7 |

### 3. Initial load (separate from editing)

A viewer opens the document. Clock: `performance.now()` in the page = milliseconds since that page's navigation start. "first content" = the editor content has text in the DOM; Requests and transferred KiB count what had been loaded when "live" and the first frame were reached, not the whole page (under 50 ms RTT the sample document's image and diagram chunks may still be in flight, so the counts differ between rows). "first content (frame)" = the following animation-frame callback; "live" = the session indicator reports `live` (WebSocket authenticated and synced). **cold** = fresh browser context (empty HTTP cache), share link `/s/<id>#secret` (includes the share exchange and redirect); **warm** = same context, session cookie present, HTTP cache warm, direct `/d/<id>`.

| condition                                                                            | document | visit | metric                | samples | p50 ms | p95 ms | p99 ms | mean ms | max ms | requests / transferred KiB (median) |
| ------------------------------------------------------------------------------------ | -------- | ----- | --------------------- | ------: | -----: | -----: | -----: | ------: | -----: | ----------------------------------- |
| loopback on one host                                                                 | large    | cold  | first content         |      30 |  473.4 |  523.4 |  528.4 |   483.2 |  528.4 | 59 / 1531                           |
| loopback on one host                                                                 | large    | cold  | first content (frame) |      30 |  484.9 |  533.1 |  544.2 |   493.2 |  544.2 |                                     |
| loopback on one host                                                                 | large    | cold  | live                  |      30 |  474.2 |  525.2 |  529.6 |   484.2 |  529.6 |                                     |
| loopback on one host                                                                 | large    | warm  | first content         |      30 |  442.2 |  488.3 |  488.8 |   450.3 |  488.8 | 55 / 7                              |
| loopback on one host                                                                 | large    | warm  | first content (frame) |      30 |  451.7 |  497.0 |  501.7 |   458.9 |  501.7 |                                     |
| loopback on one host                                                                 | large    | warm  | live                  |      30 |  442.9 |  489.6 |  490.1 |   451.3 |  490.1 |                                     |
| loopback on one host                                                                 | small    | cold  | first content         |      30 |  471.7 |  523.5 |  552.3 |   476.5 |  552.3 | 90 / 3978                           |
| loopback on one host                                                                 | small    | cold  | first content (frame) |      30 |  488.7 |  542.5 |  567.5 |   492.4 |  567.5 |                                     |
| loopback on one host                                                                 | small    | cold  | live                  |      30 |  486.7 |  540.3 |  565.7 |   490.2 |  565.7 |                                     |
| loopback on one host                                                                 | small    | warm  | first content         |      30 |  434.2 |  462.7 |  467.6 |   439.1 |  467.6 | 86 / 7                              |
| loopback on one host                                                                 | small    | warm  | first content (frame) |      30 |  451.7 |  480.3 |  483.0 |   455.3 |  483.0 |                                     |
| loopback on one host                                                                 | small    | warm  | live                  |      30 |  448.1 |  477.0 |  479.5 |   452.3 |  479.5 |                                     |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    | cold  | first content         |      30 |  624.1 |  662.4 |  669.2 |   624.5 |  669.2 | 59 / 1531                           |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    | cold  | first content (frame) |      30 |  626.1 |  666.2 |  674.2 |   628.3 |  674.2 |                                     |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    | cold  | live                  |      30 |  625.7 |  663.3 |  671.3 |   625.9 |  671.3 |                                     |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    | warm  | first content         |      30 |  487.0 |  526.8 |  529.2 |   489.9 |  529.2 | 55 / 7                              |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    | warm  | first content (frame) |      30 |  491.6 |  530.9 |  533.6 |   493.1 |  533.6 |                                     |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | large    | warm  | live                  |      30 |  488.5 |  528.1 |  530.5 |   490.8 |  530.5 |                                     |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    | cold  | first content         |      30 |  625.9 |  665.8 |  676.0 |   626.6 |  676.0 | 90 / 3978                           |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    | cold  | first content (frame) |      30 |  642.0 |  691.0 |  702.8 |   643.6 |  702.8 |                                     |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    | cold  | live                  |      30 |  640.0 |  687.2 |  700.0 |   640.9 |  700.0 |                                     |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    | warm  | first content         |      30 |  484.4 |  522.9 |  532.7 |   490.0 |  532.7 | 86 / 7                              |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    | warm  | first content (frame) |      30 |  502.7 |  546.1 |  553.8 |   508.2 |  553.8 |                                     |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           | small    | warm  | live                  |      30 |  499.2 |  540.4 |  549.3 |   504.3 |  549.3 |                                     |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    | cold  | first content         |      30 | 1212.7 | 1256.7 | 1257.4 |  1217.9 | 1257.4 | 59 / 1531                           |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    | cold  | first content (frame) |      30 | 1216.4 | 1262.1 | 1273.8 |  1221.9 | 1273.8 |                                     |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    | cold  | live                  |      30 | 1214.5 | 1258.0 | 1258.6 |  1219.0 | 1258.6 |                                     |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    | warm  | first content         |      30 |  750.9 |  772.3 |  774.0 |   753.2 |  774.0 | 55 / 7                              |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    | warm  | first content (frame) |      30 |  756.0 |  776.9 |  778.4 |   756.7 |  778.4 |                                     |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    | warm  | live                  |      30 |  751.8 |  773.7 |  775.4 |   754.2 |  775.4 |                                     |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    | cold  | first content         |      30 | 1222.4 | 1248.9 | 1249.4 |  1224.5 | 1249.4 | 59 / 1531                           |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    | cold  | first content (frame) |      30 | 1245.8 | 1273.2 | 1276.3 |  1245.6 | 1276.3 |                                     |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    | cold  | live                  |      30 | 1242.6 | 1269.5 | 1272.6 |  1242.6 | 1272.6 |                                     |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    | warm  | first content         |      30 |  761.1 |  779.3 |  781.0 |   761.1 |  781.0 | 75 / 863                            |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    | warm  | first content (frame) |      30 |  781.3 |  803.7 |  807.2 |   780.8 |  807.2 |                                     |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    | warm  | live                  |      30 |  778.3 |  800.4 |  804.0 |   778.1 |  804.0 |                                     |

### 4. Image upload plus remote render (separate from text)

Incompressible PNGs (random pixels). t0 = file chosen in the editor (capture-phase `change` of the toolbar file input). "upload" = the editor's POST to `/assets` from request start to response end (Resource Timing). "document update seen" = the image element is in the viewer's DOM. "decoded" = `img.decode()` resolved in the viewer (bytes fetched through the same network condition and decoded). All clocks are `performance.timeOrigin + performance.now()` of pages in one Chromium on this host. The document is cleared between samples so the image is in the viewers' viewport (the editor renders images with `loading="lazy"`; an image below the fold is not fetched until scrolled near, which this test deliberately avoids).

| condition                                                                            | clients | image             | metric                              | samples | p50 ms | p95 ms | p99 ms | mean ms | max ms | failures |
| ------------------------------------------------------------------------------------ | ------: | ----------------- | ----------------------------------- | ------: | -----: | -----: | -----: | ------: | -----: | -------: |
| loopback on one host                                                                 |       2 | 200 kB (258x258)  | upload request                      |      20 |   21.6 |   25.0 |   25.3 |    21.6 |   25.3 |        0 |
| loopback on one host                                                                 |       2 | 200 kB (258x258)  | t0 to upload response               |      20 |   22.7 |   26.4 |   26.4 |    22.6 |   26.4 |          |
| loopback on one host                                                                 |       2 | 200 kB (258x258)  | t0 to document update seen (viewer) |      20 |   26.3 |   31.0 |   31.1 |    26.7 |   31.1 |          |
| loopback on one host                                                                 |       2 | 200 kB (258x258)  | t0 to decoded (viewer)              |      20 |   36.6 |   48.8 |   50.3 |    38.2 |   50.3 |          |
| loopback on one host                                                                 |       2 | 200 kB (258x258)  | viewer image fetch                  |      20 |    3.7 |    5.1 |    7.2 |     4.0 |    7.2 |          |
| loopback on one host                                                                 |       2 | 2001 kB (816x817) | upload request                      |      20 |   24.9 |   27.7 |   28.2 |    24.5 |   28.2 |        0 |
| loopback on one host                                                                 |       2 | 2001 kB (816x817) | t0 to upload response               |      20 |   26.2 |   28.7 |   29.5 |    25.7 |   29.5 |          |
| loopback on one host                                                                 |       2 | 2001 kB (816x817) | t0 to document update seen (viewer) |      20 |   30.3 |   34.7 |   34.8 |    29.9 |   34.8 |          |
| loopback on one host                                                                 |       2 | 2001 kB (816x817) | t0 to decoded (viewer)              |      20 |   47.5 |   56.2 |   57.5 |    48.0 |   57.5 |          |
| loopback on one host                                                                 |       2 | 2001 kB (816x817) | viewer image fetch                  |      20 |    7.5 |    8.8 |    9.9 |     7.4 |    9.9 |          |
| loopback on one host                                                                 |       5 | 200 kB (258x258)  | upload request                      |      20 |   25.2 |   26.6 |   27.2 |    23.6 |   27.2 |        0 |
| loopback on one host                                                                 |       5 | 200 kB (258x258)  | t0 to upload response               |      20 |   26.3 |   27.3 |   28.2 |    24.6 |   28.2 |          |
| loopback on one host                                                                 |       5 | 200 kB (258x258)  | t0 to document update seen (viewer) |      80 |   30.1 |   32.0 |   32.6 |    28.8 |   32.6 |          |
| loopback on one host                                                                 |       5 | 200 kB (258x258)  | t0 to decoded (viewer)              |      80 |   43.6 |   52.0 |   53.3 |    43.0 |   53.3 |          |
| loopback on one host                                                                 |       5 | 200 kB (258x258)  | viewer image fetch                  |      80 |    5.6 |    7.5 |    8.0 |     5.6 |    8.0 |          |
| loopback on one host                                                                 |       5 | 2001 kB (816x817) | upload request                      |      20 |   22.7 |   26.6 |   27.3 |    23.1 |   27.3 |        0 |
| loopback on one host                                                                 |       5 | 2001 kB (816x817) | t0 to upload response               |      20 |   23.5 |   28.4 |   28.7 |    24.4 |   28.7 |          |
| loopback on one host                                                                 |       5 | 2001 kB (816x817) | t0 to document update seen (viewer) |      80 |   28.0 |   32.7 |   40.8 |    28.7 |   40.8 |          |
| loopback on one host                                                                 |       5 | 2001 kB (816x817) | t0 to decoded (viewer)              |      80 |   58.5 |   71.2 |  122.7 |    59.9 |  122.7 |          |
| loopback on one host                                                                 |       5 | 2001 kB (816x817) | viewer image fetch                  |      80 |   16.1 |   26.2 |   39.0 |    18.1 |   39.0 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       2 | 200 kB (258x258)  | upload request                      |      20 |   27.7 |   35.4 |   36.2 |    28.7 |   36.2 |        0 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       2 | 200 kB (258x258)  | t0 to upload response               |      20 |   28.7 |   36.4 |   36.8 |    29.7 |   36.8 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       2 | 200 kB (258x258)  | t0 to document update seen (viewer) |      20 |   43.5 |   51.0 |   51.9 |    44.1 |   51.9 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       2 | 200 kB (258x258)  | t0 to decoded (viewer)              |      20 |   69.0 |   76.4 |   79.5 |    67.0 |   79.5 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       2 | 200 kB (258x258)  | viewer image fetch                  |      20 |   14.7 |   16.2 |   16.4 |    15.0 |   16.4 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       2 | 2001 kB (816x817) | upload request                      |      20 |   31.5 |   37.6 |   38.7 |    32.1 |   38.7 |        0 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       2 | 2001 kB (816x817) | t0 to upload response               |      20 |   32.8 |   38.6 |   40.6 |    33.4 |   40.6 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       2 | 2001 kB (816x817) | t0 to document update seen (viewer) |      20 |   48.0 |   54.5 |   54.6 |    48.3 |   54.6 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       2 | 2001 kB (816x817) | t0 to decoded (viewer)              |      20 |   78.9 |   85.6 |  150.6 |    81.6 |  150.6 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       2 | 2001 kB (816x817) | viewer image fetch                  |      20 |   17.5 |   19.7 |   19.8 |    17.9 |   19.8 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       5 | 200 kB (258x258)  | upload request                      |      20 |   29.6 |   37.2 |   37.2 |    31.4 |   37.2 |        0 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       5 | 200 kB (258x258)  | t0 to upload response               |      20 |   30.5 |   38.0 |   38.1 |    32.3 |   38.1 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       5 | 200 kB (258x258)  | t0 to document update seen (viewer) |      80 |   45.3 |   52.9 |   53.4 |    47.0 |   53.4 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       5 | 200 kB (258x258)  | t0 to decoded (viewer)              |      80 |   75.4 |   85.3 |   87.3 |    74.9 |   87.3 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       5 | 200 kB (258x258)  | viewer image fetch                  |      80 |   17.8 |   19.5 |   20.1 |    17.8 |   20.1 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       5 | 2001 kB (816x817) | upload request                      |      20 |   35.8 |   39.1 |   50.0 |    36.0 |   50.0 |        0 |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       5 | 2001 kB (816x817) | t0 to upload response               |      20 |   36.9 |   39.8 |   51.3 |    37.1 |   51.3 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       5 | 2001 kB (816x817) | t0 to document update seen (viewer) |      80 |   51.2 |   54.3 |   66.5 |    51.4 |   66.5 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       5 | 2001 kB (816x817) | t0 to decoded (viewer)              |      80 |   90.4 |  116.1 |  134.1 |    93.4 |  134.1 |          |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN)           |       5 | 2001 kB (816x817) | viewer image fetch                  |      80 |   29.6 |   37.6 |   42.4 |    29.8 |   42.4 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       2 | 200 kB (258x258)  | upload request                      |      20 |   75.3 |   77.4 |   77.6 |    74.0 |   77.6 |        0 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       2 | 200 kB (258x258)  | t0 to upload response               |      20 |   76.2 |   78.6 |   78.8 |    74.9 |   78.8 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       2 | 200 kB (258x258)  | t0 to document update seen (viewer) |      20 |  131.3 |  134.1 |  135.2 |   130.3 |  135.2 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       2 | 200 kB (258x258)  | t0 to decoded (viewer)              |      20 |  193.6 |  203.5 |  203.8 |   194.4 |  203.8 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       2 | 200 kB (258x258)  | viewer image fetch                  |      20 |   54.7 |   56.3 |   57.3 |    55.0 |   57.3 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       2 | 2001 kB (816x817) | upload request                      |      20 |   73.7 |   77.8 |   78.7 |    74.1 |   78.7 |        0 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       2 | 2001 kB (816x817) | t0 to upload response               |      20 |   74.9 |   78.4 |   79.6 |    75.1 |   79.6 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       2 | 2001 kB (816x817) | t0 to document update seen (viewer) |      20 |  130.1 |  133.7 |  134.3 |   130.4 |  134.3 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       2 | 2001 kB (816x817) | t0 to decoded (viewer)              |      20 |  201.0 |  206.4 |  272.0 |   203.2 |  272.0 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       2 | 2001 kB (816x817) | viewer image fetch                  |      20 |   58.3 |   59.6 |   59.6 |    58.2 |   59.6 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       5 | 200 kB (258x258)  | upload request                      |      20 |   69.4 |   78.5 |   82.8 |    71.8 |   82.8 |        0 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       5 | 200 kB (258x258)  | t0 to upload response               |      20 |   70.4 |   79.7 |   84.1 |    72.8 |   84.1 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       5 | 200 kB (258x258)  | t0 to document update seen (viewer) |      80 |  125.8 |  135.3 |  139.5 |   128.1 |  139.5 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       5 | 200 kB (258x258)  | t0 to decoded (viewer)              |      80 |  194.8 |  206.4 |  215.4 |   195.2 |  215.4 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       5 | 200 kB (258x258)  | viewer image fetch                  |      80 |   57.3 |   59.8 |   71.8 |    58.0 |   71.8 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       5 | 2001 kB (816x817) | upload request                      |      20 |   76.4 |   80.4 |   82.7 |    76.6 |   82.7 |        0 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       5 | 2001 kB (816x817) | t0 to upload response               |      20 |   78.2 |   82.2 |   84.7 |    78.0 |   84.7 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       5 | 2001 kB (816x817) | t0 to document update seen (viewer) |      80 |  132.8 |  137.5 |  140.4 |   133.1 |  140.4 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       5 | 2001 kB (816x817) | t0 to decoded (viewer)              |      80 |  215.2 |  226.6 |  230.4 |   215.4 |  230.4 |          |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) |       5 | 2001 kB (816x817) | viewer image fetch                  |      80 |   69.5 |   78.7 |   81.2 |    70.5 |   81.2 |          |

### 5. Local keystroke responsiveness (key to character in the LOCAL editor DOM)

Editor page driven from a host-side Playwright client through a Playwright server in the pinned image (one Chromium). t0 = capture-phase `keydown` on `window` (first script to see the key); t1 = first MutationObserver callback of the editor's own content after which the typed character is in the DOM (the marker check is the same as in section 1). Same clock (page `performance.timeOrigin + performance.now()`, 0.1 ms resolution). "offline" = the server process was stopped (SIGTERM) after the page was ready and the connection indicator had left `live`; the "50 ms" row is the emulated delay proxy (userspace, not a real WAN). A latency that depends on the network would show here.

| network                                                                              | document | connection indicator while typing | samples | p50 ms | p95 ms | p99 ms | mean ms | max ms |
| ------------------------------------------------------------------------------------ | -------- | --------------------------------- | ------: | -----: | -----: | -----: | ------: | -----: |
| loopback on one host                                                                 | large    | live                              |     320 |    2.1 |    2.6 |    2.8 |     2.1 |    3.3 |
| loopback on one host                                                                 | small    | live                              |     320 |    1.7 |    2.1 |    2.4 |     1.6 |    3.1 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    | live                              |     320 |    2.2 |    2.7 |    3.1 |     2.1 |    4.0 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    | live                              |     320 |    1.6 |    2.1 |    2.7 |     1.6 |    2.9 |
| server stopped (offline)                                                             | large    | reconnecting                      |     320 |    2.2 |    2.6 |    2.8 |     2.1 |    3.4 |
| server stopped (offline)                                                             | small    | reconnecting                      |     320 |    1.8 |    2.1 |    2.5 |     1.7 |    3.1 |

### 6. Reconnect convergence

The editor (administrator session, via a pass-through TCP proxy that this script can cut) types N letters while disconnected; 3 viewers stay connected directly. **connection-cut**: the proxy closes its listener and resets every open socket (the editor sees a reset, not a silent black hole; a silent loss would add the idle detection of the application ping, 45 s by default), types N letters, then listens again. **server-restart**: the server process is stopped (SIGTERM, graceful) while the editor types, then started again; viewers reconnect too. t = 0 is the moment the connection is possible again (proxy listening again / `/api/health` answers), read on the host with the same OS clock as the pages. "live" = editor connection indicator reads live; "Saved" = editor save indicator reads saved (the server's durable acknowledgement); "viewers" = the last of the 3 viewers shows all N letters (verified letter by letter). The reconnect delay is the browser app's own retry/backoff, which grows with the time spent disconnected.

| variant        |    N | runs | outage ms (median) | editor live p50 / max ms | editor Saved p50 / max ms | last viewer complete p50 / max ms | incomplete | wrong letters |
| -------------- | ---: | ---: | -----------------: | ------------------------ | ------------------------- | --------------------------------- | ---------: | ------------: |
| connection-cut |   10 |    5 |              365.5 | 501.1 / 743.3            | 915.9 / 1147.5            | 506.9 / 749.7                     |          0 |             0 |
| connection-cut |  100 |    5 |              531.6 | 556.1 / 627.3            | 961.3 / 1035.9            | 562.5 / 632.3                     |          0 |             0 |
| connection-cut | 1000 |    5 |             1994.7 | 1828.7 / 2959.4          | 2241.0 / 3371.5           | 1831.7 / 2966.0                   |          0 |             0 |
| server-restart |  100 |    3 |              897.5 | 944.7 / 1170.6           | 1349.6 / 1579.6           | 1148.3 / 1357.1                   |          0 |             0 |
| server-restart | 1000 |    3 |             2433.0 | 334.5 / 2228.0           | 739.1 / 2634.4            | 2663.1 / 2830.8                   |          0 |             0 |

### 7. Memory and CPU

10 Node clients (`@hocuspocus/provider`) edit the document for 60 s, each typing one character every 100-200 ms into its own paragraph and sending `mark` per edit (about 67 edits/s together); one browser viewer (loopback, share link) is connected throughout. **Server**: `/proc/<pid>/stat` utime+stime (clock ticks / `CLK_TCK`) before and after the 60 s, divided by 60 s = percent of one core; RSS from `/proc/<pid>/status` `VmRSS` at start and end and the maximum of 1 s samples (`VmHWM` is the process lifetime peak). **Viewer renderer**: CDP `Performance.getMetrics` of the viewer page (`JSHeapUsedSize`, `Nodes`, `TaskDuration` = main-thread task seconds, `ScriptDuration`); heap after `HeapProfiler.collectGarbage` via `Runtime.getHeapUsage`; Main-thread CPU is the page's own thread only (not compositor, network or GPU processes). Idle = 10 s of the same page before the edits start. PostgreSQL was not measured (a single `docker stats --no-stream` reading is not a CPU measurement).

| document | blocks | text bytes | server CPU (% of 1 core) | server RSS start / end / sampled max MiB | viewer JS heap after load / after editing (GC) MiB | viewer main-thread CPU editing / idle % | viewer DOM nodes after load |
| -------- | -----: | ---------: | -----------------------: | ---------------------------------------- | -------------------------------------------------- | --------------------------------------- | --------------------------: |
| small    |     18 |       1667 |                      5.8 | 211 / 288 / 288                          | 17.9 / 19.1                                        | 8.6 / 0.0                               |                        1621 |
| medium   |    101 |      46839 |                      4.9 | 288 / 289 / 289                          | 7.6 / 9.2                                          | 7.9 / 0.0                               |                         452 |
| huge     |    501 |     499464 |                      5.0 | 297 / 291 / 302                          | 8.2 / 9.8                                          | 12.1 / 0.0                              |                        1252 |

### Host load during the run

Load average (1/5/15 min) read from `/proc/loadavg` at the start and end of each step; this host is shared, so these numbers qualify every latency above.

| step                           | load at start    | load at end      | completed |
| ------------------------------ | ---------------- | ---------------- | --------- |
| ping before                    | 7.68 10.90 8.70  | 6.52 9.88 8.50   | yes       |
| browser-edit loopback small 2  | 6.52 9.88 8.50   | 6.58 9.25 8.36   | yes       |
| browser-edit loopback small 5  | 6.58 9.25 8.36   | 11.64 10.27 8.78 | yes       |
| browser-edit loopback small 10 | 11.64 10.27 8.78 | 7.48 9.25 8.53   | yes       |
| browser-edit loopback large 2  | 7.48 9.25 8.53   | 5.97 8.53 8.32   | yes       |
| browser-edit loopback large 5  | 5.97 8.53 8.32   | 12.71 10.36 8.99 | yes       |
| browser-edit loopback large 10 | 12.71 10.36 8.99 | 10.91 10.15 9.01 | yes       |
| browser-edit rtt10 small 2     | 10.91 10.15 9.01 | 8.80 9.77 8.96   | yes       |
| browser-edit rtt10 small 5     | 8.80 9.77 8.96   | 7.15 9.08 8.77   | yes       |
| browser-edit rtt10 small 10    | 7.15 9.08 8.77   | 5.44 8.38 8.57   | yes       |
| browser-edit rtt10 large 2     | 5.44 8.38 8.57   | 8.19 8.71 8.67   | yes       |
| browser-edit rtt10 large 5     | 8.19 8.71 8.67   | 10.64 9.10 8.80  | yes       |
| browser-edit rtt10 large 10    | 10.64 9.10 8.80  | 10.94 9.59 8.99  | yes       |
| browser-edit rtt50 small 2     | 10.94 9.59 8.99  | 7.70 8.92 8.80   | yes       |
| browser-edit rtt50 small 5     | 7.70 8.92 8.80   | 4.60 7.80 8.42   | yes       |
| browser-edit rtt50 small 10    | 4.60 7.80 8.42   | 10.82 8.97 8.78  | yes       |
| browser-edit rtt50 large 2     | 10.82 8.97 8.78  | 9.20 8.94 8.78   | yes       |
| browser-edit rtt50 large 5     | 9.20 8.94 8.78   | 5.87 8.02 8.47   | yes       |
| browser-edit rtt50 large 10    | 5.87 8.02 8.47   | 5.95 7.48 8.25   | yes       |
| protocol loopback small 2      | 5.95 7.48 8.25   | 7.30 7.57 8.22   | yes       |
| protocol loopback small 5      | 7.30 7.57 8.22   | 8.93 7.99 8.32   | yes       |
| protocol loopback small 10     | 8.93 7.99 8.32   | 15.62 9.78 8.89  | yes       |
| protocol loopback large 2      | 15.62 9.78 8.89  | 7.31 8.58 8.55   | yes       |
| protocol loopback large 5      | 7.31 8.58 8.55   | 6.90 8.15 8.39   | yes       |
| protocol loopback large 10     | 6.90 8.15 8.39   | 7.96 8.21 8.40   | yes       |
| protocol rtt10 small 2         | 7.96 8.21 8.40   | 15.65 10.19 9.05 | yes       |
| protocol rtt10 small 5         | 15.65 10.19 9.05 | 9.43 9.71 8.99   | yes       |
| protocol rtt10 small 10        | 9.43 9.71 8.99   | 6.62 8.85 8.74   | yes       |
| protocol rtt10 large 2         | 6.62 8.85 8.74   | 9.94 9.56 9.00   | yes       |
| protocol rtt10 large 5         | 9.94 9.56 9.00   | 7.79 9.01 8.86   | yes       |
| protocol rtt10 large 10        | 7.79 9.01 8.86   | 9.16 9.24 8.95   | yes       |
| protocol rtt50 small 2         | 9.16 9.24 8.95   | 6.48 8.53 8.73   | yes       |
| protocol rtt50 small 5         | 6.48 8.53 8.73   | 6.42 7.97 8.51   | yes       |
| protocol rtt50 small 10        | 6.42 7.97 8.51   | 4.74 7.20 8.21   | yes       |
| protocol rtt50 large 2         | 4.74 7.20 8.21   | 2.80 6.07 7.74   | yes       |
| protocol rtt50 large 5         | 2.80 6.07 7.74   | 2.07 5.15 7.29   | yes       |
| protocol rtt50 large 10        | 2.07 5.15 7.29   | 2.45 4.64 6.95   | yes       |
| initial-load loopback small    | 2.45 4.64 6.95   | 2.26 4.14 6.63   | yes       |
| initial-load loopback large    | 2.26 4.14 6.63   | 3.06 4.07 6.45   | yes       |
| initial-load rtt10 small       | 3.06 4.07 6.45   | 3.78 4.06 6.28   | yes       |
| initial-load rtt10 large       | 3.78 4.06 6.28   | 3.68 4.04 6.13   | yes       |
| initial-load rtt50 small       | 3.68 4.04 6.13   | 4.30 4.22 6.03   | yes       |
| initial-load rtt50 large       | 4.30 4.22 6.03   | 2.81 3.78 5.73   | yes       |
| image loopback 2 200000        | 2.81 3.78 5.73   | 2.67 3.73 5.69   | yes       |
| image loopback 2 2000000       | 2.67 3.73 5.69   | 3.64 3.87 5.69   | yes       |
| image loopback 5 200000        | 3.64 3.87 5.69   | 2.88 3.69 5.59   | yes       |
| image loopback 5 2000000       | 2.88 3.69 5.59   | 3.06 3.66 5.54   | yes       |
| image rtt10 2 200000           | 3.06 3.66 5.54   | 3.48 3.73 5.53   | yes       |
| image rtt10 2 2000000          | 3.48 3.73 5.53   | 3.66 3.75 5.50   | yes       |
| image rtt10 5 200000           | 3.66 3.75 5.50   | 3.47 3.70 5.45   | yes       |
| image rtt10 5 2000000          | 3.47 3.70 5.45   | 4.04 3.82 5.45   | yes       |
| image rtt50 2 200000           | 4.04 3.82 5.45   | 3.88 3.80 5.41   | yes       |
| image rtt50 2 2000000          | 3.88 3.80 5.41   | 5.26 4.13 5.47   | yes       |
| image rtt50 5 200000           | 5.26 4.13 5.47   | 5.96 4.34 5.51   | yes       |
| image rtt50 5 2000000          | 5.96 4.34 5.51   | 5.31 4.38 5.48   | **no**    |
| ping after                     | 5.31 4.38 5.48   | 3.81 4.09 5.30   | yes       |

## 6. Housekeeping

Raw result files are written unformatted; run `pnpm exec prettier --write tests/perf` after a run, or add `tests/perf/results` to the root `.prettierignore` (not owned by this package). The `.stage` directory (generated password, server log, built web copy) is git-ignored.
