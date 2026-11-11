# Performance

This page reports how fast RealtimeDocs feels and how that was measured. Every number in it is
copied from the generated result files of one measurement run
(`tests/perf/results/20261110T224854Z/summary.md`) and one short re-check
(`tests/perf/results/20261110T224854Z-spotcheck/summary.md`). Nothing is estimated, rounded in
favour of the product, or extrapolated. The raw samples are the JSON files in the same directories.

Read [Limitations](#limitations) before quoting a number. In short: one shared Linux host, one
browser engine (headless Chromium), emulated networks, and nothing was measured on Windows or macOS.

## Summary

The target from the project brief is: for plain-text edits after the connection is established, on a
healthy LAN with a round-trip time (RTT) of 10 ms or less, with a small document and up to 10
connected clients, the 95th percentile (p95) of "edit to visible remote render" is below 100 ms.
Initial loading is measured separately.

**Result: the p95 target is met in every one of the 18 measured configurations (3 network conditions,
2 documents, 2 / 5 / 10 clients), with a wide margin.** Three cautions apply:

- The "10 ms" condition is emulated and measured **10.8 ms** RTT at p50 before the run and 10.7 ms
  after it, slightly above the brief's "10 ms or less". The margin to 100 ms makes this irrelevant
  for the verdict, but it is stated here instead of hidden.
- The 50 ms condition also stays below 100 ms (highest p95 62.0 ms), but wider networks are reported
  separately and are not part of the target.
- No real LAN or WAN was involved. The networks are **emulated with a userspace delay proxy, not a
  real LAN or WAN**.

p95 in milliseconds of "keystroke in the editor page until the typed letter is in the viewer's DOM"
(320 measured edits per configuration after 50 warm-up edits, pooled over all viewers; table 1a
below has p50, p99, mean and max):

| Network condition (p50 of the measured WebSocket ping RTT)                    | Small document, 2 / 5 / 10 clients | Large document (201 blocks), 2 / 5 / 10 clients | p95 below 100 ms? |
| ----------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------- | ----------------- |
| loopback on one host (0.4 ms)                                                 | 4.2 / 5.6 / 4.3 ms                 | 4.9 / 10.2 / 9.0 ms                             | yes, in all 6     |
| emulated 10 ms RTT (10.8 ms; userspace delay proxy, not a real LAN)           | 18.0 / 17.3 / 16.7 ms              | 20.0 / 23.4 / 22.7 ms                           | yes, in all 6     |
| emulated 50 ms RTT, WAN-like (50.9 ms; userspace delay proxy, not a real WAN) | 59.0 / 55.8 / 62.0 ms              | 56.8 / 56.4 / 56.5 ms                           | yes, in all 6     |

Other headline numbers from the same run (all tables are below):

- **Local typing never waits for the network.** Key press to the character in the local editor DOM:
  p50 1.6 to 2.2 ms and p95 2.1 to 2.7 ms on loopback, at an emulated 50 ms RTT, and with the server
  stopped (table 5).
- **The durable "Saved" acknowledgement** (local change until the server confirms the PostgreSQL
  commit): p95 13.2 to 14.3 ms on loopback and 23.9 to 26.2 ms at an emulated 10 ms RTT (table 2b).
  It is not on the path of remote rendering.
- **Server load** with 10 clients typing about 67 edits per second together: 4.9 to 5.8 % of one
  core and a resident memory of 211 to 302 MiB (table 7).
- **Initial load** of the sample document: 471.7 ms p50 until content on loopback with an empty
  cache, 625.9 ms at an emulated 10 ms RTT (table 3). There is no initial-load target in the brief.
- **After a connection cut**, editors and viewers converged letter by letter with no incomplete or
  wrong results in any run (table 6).

## Open findings

These were found by the measurements and are **not fixed**. No application code was changed for the
benchmark.

1. **Cold load is heavy.** The first visit to the sample document, with an empty browser cache,
   transfers about 3.9 MiB in 90 requests (table 3: 90 requests, 3978 KiB, median of 30 loads on
   loopback) and shows content after about 470 ms on loopback, 626 ms at 10 ms RTT and 1.22 s at 50 ms
   RTT. A warm visit still takes about 434 ms on loopback, so most of the time is application
   start-up, not transfer. The suggested direction is to check what the first screen loads eagerly
   (the diagram, formula and layout libraries are separate files) and to load them only when a
   document needs them. This is not a miss against the brief, which has no initial-load target.
2. **Images load lazily.** The editor renders images with `loading="lazy"`
   (`packages/editor/src/editor/nodeViews/ImageView.tsx`). A remote image below the fold is not
   fetched until the reader scrolls near it, so "image visible remotely" in a long document depends
   on scroll position. The image benchmark clears the document between samples so that the image is
   in view; it does not measure an image far down a long page.
3. **A silent network loss is detected late.** When the network disappears without the connection
   being reset (a cable pulled, a Wi-Fi drop), the application notices only through its own ping
   (every 15 s) and the idle cut-off (45 s). The reconnect test (table 6) uses clean connection
   resets, which is the best case, so its times do not apply to a silent loss.

## Method

### Hardware, software and load

- Hardware: Cortex-X925 + Cortex-A725, 20 logical cores (10 cores at max 3900.0000 MHz; 10 cores at max 2808.0000 MHz); memory MemTotal: 127598700 kB, MemAvailable: 25857096 kB at start; Ubuntu 24.04.5 LTS, kernel Linux 7.0.0-1025-nvidia aarch64.
- Software: Node v24.22.2 (host scripts, protocol test), server RealtimeDocs 0.1.0 (protocol 1) run as a plain Node process from `apps/server/dist`, postgres (PostgreSQL) 17.11 in container `rd-perf-pg` (default settings, fsync on, container filesystem), Docker version 29.6.2, build dfc4efb, Playwright image `mcr.microsoft.com/playwright:v1.64.1-noble` (Node 24.21.0 inside, Chromium version in the tables below).
- Load: this host is shared with other workloads. 1/5/15-minute load average at the start of the run: 7.68 / 10.90 / 8.70 on 20 cores. Top CPU consumers at start (percent, command): `%CPU COMMAND |  127 MainThread |  127 VLLM::Worker_TP |  100 ps | 78.9 chrome-headless | 78.3 cpptools | 60.4 VLLM::EngineCor | 40.2 python`.
- Server settings (every non-default value): `NODE_ENV=production RD_HOST=127.0.0.1 RD_PORT=4320 PUBLIC_ORIGIN=http://127.0.0.1:4320 ALLOWED_ORIGINS=http://127.0.0.1:4321,http://127.0.0.1:4322 WEB_DIST_DIR=<repository>/tests/perf/.stage/web ASSET_DIR=<repository>/tests/perf/.stage/assets LOG_LEVEL=warn CLEANUP_INTERVAL_MINUTES=0 RATE_API_PER_MINUTE=1000000 RATE_LOGIN_PER_IP=100000 RATE_SHARE_EXCHANGE_PER_IP=100000 RATE_INVITE_PER_IP=100000 RATE_DESKTOP_REDEEM_PER_IP=100000 RATE_COLLAB_TICKET_PER_MINUTE=100000 RATE_UPLOAD_PER_MINUTE=100000 RATE_WS_UPGRADE_PER_MINUTE=100000 DATABASE_URL=postgres://rd:***@127.0.0.1:54320/realtimedocs_perf SESSION_SECRET=*** (generated, 32 random bytes)`. Everything else is the default of `docs/notes/server.md`.

The host is shared with other workloads (a large language model server, other agents' browsers, an
editor's language server), so every latency below was measured on a busy machine. Results may be
better on a quiet machine and worse on a busier one. The load average at the start and end of every
step is in the `Host load during the run` table of `summary.md`.

### Documents

- Documents: **small** = the seeded sample document, 17 blocks, 1594 bytes of text (UTF-8, plain-text export), 5314 bytes Yjs state, it also holds one image and a diagram. **large** = generated, 201 blocks (200 paragraphs of about 250 characters, plus the empty paragraph the editor keeps), 49994 bytes of text, 57448 bytes Yjs state.

The spot check used a fresh database and its sample document had 18 blocks and 1667 bytes of text
(5478 bytes of Yjs state) instead of 17 blocks and 1594 bytes; the cause was not investigated. The
memory test (table 7) used a small, a medium (101 blocks) and a huge (501 blocks) document.

### Single-clock method for edit-to-render

The latency from one person's keystroke to another person's screen can only be measured honestly if
both ends are read from the same clock. Subtracting timestamps from two computers would add the
unknown difference between their clocks to every sample.

- The editor page and every viewer page are open in **one Chromium process on one host**. Both
  moments, t0 and t1, are `performance.timeOrigin + performance.now()` read inside those pages, so
  they come from the same operating-system clock. No timestamps of separate computers are subtracted.
- Chromium rounds `performance.now()` to 100 microseconds in pages that are not cross-origin
  isolated, so the resolution is 0.1 ms.
- **t0** is a capture-phase `keydown` listener on `window` of the editor page: the first script that
  sees the key, before the editor handles it.
- **t1 (table 1a)** is the first MutationObserver callback in the viewer after which the typed letter
  is present in the viewer's DOM.
- **t1 (table 1b)** is the next `requestAnimationFrame` callback after that DOM change, that is the
  frame in which the browser paints it. A headless browser cannot report when pixels reach a display,
  so this frame is the nearest honest proxy for "visible".
- Every typed letter is a marker (position k, letter k of a fixed pseudo-random sequence) and every
  viewer checks both. "missing/mismatched" counts edits that a viewer never showed or showed with a
  wrong letter; it is 0/0 in every row.
- The pages' clocks were compared with the driver's clock before and after each run (best of 25 round
  trips per page). The largest absolute offset found was at most 0.28 ms, with an uncertainty (half
  the round trip of that comparison) of 0.16 to 0.84 ms, so no offset is distinguishable from zero.
- The editor types one letter every 100 to 200 ms (5 to 10 characters per second), after 50 warm-up
  edits. Viewers are share-link guests in their own browser contexts; the editor is the
  administrator's session.
- The protocol test (table 2) runs all clients in **one Node process**, so it also uses one
  `performance.now()` clock.

"Viewer samples" are edits times (clients minus one): every viewer's latency for every edit, pooled.
They are not independent samples. "Worst viewer per edit" is also reported.

### Network conditions

"RTT" is a round-trip time measured at one sender with one clock. It is **not** a one-way delay.
It was measured with WebSocket ping and pong control frames to `/collab` (300 samples after 20
warm-up samples, 20 ms apart) and with an HTTP request on a keep-alive connection.

The "emulated" conditions use a **userspace Node TCP delay proxy** (`tests/perf/src/proxy.ts`) that
adds a fixed delay to every chunk in each direction, WebSocket frames included: 5 ms each way for the
"10 ms" condition and 25 ms each way for the "50 ms" condition. It does not model bandwidth, loss or
jitter, and it does not delay the TCP handshake. **It is emulation with a userspace delay proxy, not
a real LAN or WAN**, and loopback is not a LAN either: there is no network card, switch or Wi-Fi.

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

### Test stack

The stack is started by `pnpm --filter @realtimedocs/perf run stack:up` (`tests/perf/src/stack.ts`):
PostgreSQL 17.11 in a container on 127.0.0.1:54320 with default settings (fsync on), the built
server as a plain Node process on 127.0.0.1:4320, the web app built into a private directory, and the
two delay proxies. Per-address rate limits are raised so that the benchmark is not throttled; every
non-default setting is listed in the first bullets above. The administrator is created with the
operator command `bootstrap-admin --generate` and its password is written to a mode-600 file under
`tests/perf/.stage`, never printed.

## Results

All tables are copied from `tests/perf/results/20261110T224854Z/summary.md`.

### 1. Edit to visible remote render (headline)

#### 1a. t1 = the letter is present in the viewer's DOM

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

#### 1b. t1 = the next animation frame after the DOM change

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

### 2. Protocol relay and "Saved" acknowledgement (no rendering)

Node clients on `@hocuspocus/provider`, `yjs` and `ws`, authenticated with collaboration tickets and
sending `hello` after the sync, like the editor. Client A inserts one character (t0 just before
`doc.transact`) and sends `mark`, exactly as the editor does. "Relay" is t0 until the remote update
is applied in client B's Y.Doc. "Saved" is t0 until the server's `saved` acknowledgement arrives at
A, which only happens after the PostgreSQL commit. Typing rate 5 to 10 characters per second, 50
warm-up edits, 400 measured edits.

#### 2a. Relay: update applied on A until received and applied on B

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

On loopback the "Saved" time shows two clusters (about 4 ms and about 13 ms). This looks like
PostgreSQL commit timing; the cause was not investigated.

### 3. Initial load (separate from editing)

A viewer opens the document. The clock is `performance.now()` in the page, that is milliseconds
since that page's navigation start. "First content" means the editor has text in the DOM; "first
content (frame)" is the following animation frame; "live" means the session indicator reports
`live` (WebSocket authenticated and synced). **cold** is a fresh browser context with an empty HTTP
cache, opened through the share link (it includes the share exchange and the redirect). **warm** is
the same context with the session cookie and a warm cache, opened directly. The request and
transferred-KiB counts cover what had been loaded when "live" and the first frame were reached, not
the whole page, so they can differ between rows (under 50 ms RTT the sample document's image and
diagram files may still be in flight).

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

> Note (lead review): the large document has no diagram and loads in 59 requests / 1531 KiB; the small sample document contains a Mermaid diagram and loads in about 90 requests / 3978 KiB. The difference (about 2.4 MiB) is the diagram libraries, which are fetched because that document contains a diagram. The "emulated 50 ms RTT, small, cold" row reports 59 / 1531 like the large document; most likely the diagram chunks arrived after the "first content" moment at which transfer was counted. Treat that one row's transfer figure as unreliable until it is re-measured.

### 4. Image upload plus remote render (separate from text)

Incompressible PNGs (random pixels). t0 is the file chosen in the editor. "Upload request" is the
editor's POST to `/assets` from request start to response end. "Document update seen" means the image
element is in the viewer's DOM. "Decoded" means `img.decode()` resolved in the viewer, after the
bytes were fetched through the same emulated network and decoded. The document is cleared between
samples so that the image is in the viewers' viewport (see finding 2). The viewer fetch goes through
the emulated condition without a bandwidth limit, so large-image times at 50 ms RTT are limited by
latency only. The step "image rtt50 5 2000000" is marked as not completed in the host-load table of
`summary.md`: its first run failed on a navigation timeout and it was repeated on the newer build;
the numbers below for that row come from the repeat.

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

### 5. Local keystroke responsiveness

Key press to the character in the **local** editor DOM, from a host-side Playwright client in one
Chromium. t0 is the capture-phase `keydown` on `window`; t1 is the first MutationObserver callback of
the editor's own content after which the typed character is in the DOM. "Offline" means the server
process was stopped after the page was ready and the connection indicator had left `live`; the 50 ms
row is the emulated delay proxy. A latency that depended on the network would show here.

| network                                                                              | document | connection indicator while typing | samples | p50 ms | p95 ms | p99 ms | mean ms | max ms |
| ------------------------------------------------------------------------------------ | -------- | --------------------------------- | ------: | -----: | -----: | -----: | ------: | -----: |
| loopback on one host                                                                 | large    | live                              |     320 |    2.1 |    2.6 |    2.8 |     2.1 |    3.3 |
| loopback on one host                                                                 | small    | live                              |     320 |    1.7 |    2.1 |    2.4 |     1.6 |    3.1 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | large    | live                              |     320 |    2.2 |    2.7 |    3.1 |     2.1 |    4.0 |
| emulated 50 ms RTT, WAN-like (emulated with a userspace delay proxy, not a real WAN) | small    | live                              |     320 |    1.6 |    2.1 |    2.7 |     1.6 |    2.9 |
| server stopped (offline)                                                             | large    | reconnecting                      |     320 |    2.2 |    2.6 |    2.8 |     2.1 |    3.4 |
| server stopped (offline)                                                             | small    | reconnecting                      |     320 |    1.8 |    2.1 |    2.5 |     1.7 |    3.1 |

### 6. Reconnect convergence

The editor (administrator session, behind a pass-through TCP proxy that the script can cut) types N
letters while disconnected; 3 viewers stay connected directly.

- **connection-cut:** the proxy closes its listener and resets every open socket, then listens again.
  The editor sees a reset, not a silent black hole. A silent loss would add the idle detection of the
  application ping (45 s by default), see finding 3.
- **server-restart:** the server process is stopped gracefully (SIGTERM) while the editor types, then
  started again; viewers reconnect too.
- t = 0 is the moment the connection is possible again (proxy listening again, or `/api/health`
  answers). "Live" is when the editor's connection indicator reads live; "Saved" is when its save
  indicator reads saved (the server's durable acknowledgement); "last viewer complete" is when the
  last of the 3 viewers shows all N letters, verified letter by letter. The reconnect delay is the web
  app's own retry and backoff, which grows with the time spent disconnected.
- There are 3 to 5 runs per row, so the percentile-like columns are in practice minimum, median and
  maximum.

| variant        |    N | runs | outage ms (median) | editor live p50 / max ms | editor Saved p50 / max ms | last viewer complete p50 / max ms | incomplete | wrong letters |
| -------------- | ---: | ---: | -----------------: | ------------------------ | ------------------------- | --------------------------------- | ---------: | ------------: |
| connection-cut |   10 |    5 |              365.5 | 501.1 / 743.3            | 915.9 / 1147.5            | 506.9 / 749.7                     |          0 |             0 |
| connection-cut |  100 |    5 |              531.6 | 556.1 / 627.3            | 961.3 / 1035.9            | 562.5 / 632.3                     |          0 |             0 |
| connection-cut | 1000 |    5 |             1994.7 | 1828.7 / 2959.4          | 2241.0 / 3371.5           | 1831.7 / 2966.0                   |          0 |             0 |
| server-restart |  100 |    3 |              897.5 | 944.7 / 1170.6           | 1349.6 / 1579.6           | 1148.3 / 1357.1                   |          0 |             0 |
| server-restart | 1000 |    3 |             2433.0 | 334.5 / 2228.0           | 739.1 / 2634.4            | 2663.1 / 2830.8                   |          0 |             0 |

### 7. Memory and CPU

10 Node clients edit the document for 60 s, each typing one character every 100 to 200 ms into its own
paragraph and sending `mark` per edit (about 67 edits per second together); one browser viewer
(loopback, share link) is connected throughout. **Server:** CPU is `/proc/<pid>/stat` utime plus
stime over the 60 s, as a percentage of one core; RSS is `VmRSS` at start and end and the maximum of
1 s samples. **Viewer renderer:** CDP `Performance.getMetrics`, with the heap read after a forced
garbage collection; main-thread CPU is the page's own thread only (not compositor, network or GPU
processes). "Idle" is 10 s of the same page before the edits. PostgreSQL's CPU and memory were not
measured. The server's "start" memory includes its warm-up growth (216 MiB to 288 MiB in the first
run).

| document | blocks | text bytes | server CPU (% of 1 core) | server RSS start / end / sampled max MiB | viewer JS heap after load / after editing (GC) MiB | viewer main-thread CPU editing / idle % | viewer DOM nodes after load |
| -------- | -----: | ---------: | -----------------------: | ---------------------------------------- | -------------------------------------------------- | --------------------------------------- | --------------------------: |
| small    |     18 |       1667 |                      5.8 | 211 / 288 / 288                          | 17.9 / 19.1                                        | 8.6 / 0.0                               |                        1621 |
| medium   |    101 |      46839 |                      4.9 | 288 / 289 / 289                          | 7.6 / 9.2                                          | 7.9 / 0.0                               |                         452 |
| huge     |    501 |     499464 |                      5.0 | 297 / 291 / 302                          | 8.2 / 9.8                                          | 12.1 / 0.0                              |                        1252 |

## Re-check on the newer build

Another agent rebuilt the server and web app after the main run (document schema version 2, the
callout block). The main run's sections 1 to 4 used the earlier build (schema version 1), except the
image row noted above; sections 5 to 7 used the newer one. The spot check repeats four headline cells
(10 clients, small and large documents, loopback and emulated 10 ms RTT) on the newer build. Copied
from `tests/perf/results/20261110T224854Z-spotcheck/summary.md`; the sample document of that run had
18 blocks (see above).

Edit to DOM:

| condition                                                                  | document | clients | edits | viewer samples | p50 ms | p95 ms | p99 ms | mean ms | max ms | worst viewer per edit p95 ms | p95 < 100 ms | missing/mismatched | clock offset                     |
| -------------------------------------------------------------------------- | -------- | ------: | ----: | -------------: | -----: | -----: | -----: | ------: | -----: | ---------------------------: | ------------ | ------------------ | -------------------------------- |
| loopback on one host                                                       | large    |      10 |   320 |           2880 |    4.0 |    4.8 |    5.3 |     4.0 |    7.5 |                          5.3 | yes          | 0/0                | max 0.13 ms, uncertainty 0.37 ms |
| loopback on one host                                                       | small    |      10 |   320 |           2880 |    4.1 |    7.4 |    9.3 |     4.8 |   14.4 |                          9.3 | yes          | 0/0                | max 0.24 ms, uncertainty 0.31 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN) | large    |      10 |   320 |           2880 |   15.1 |   16.6 |   17.5 |    15.2 |   19.6 |                         17.1 | yes          | 0/0                | max 0.19 ms, uncertainty 0.35 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN) | small    |      10 |   320 |           2880 |   14.4 |   15.8 |   16.9 |    14.5 |   26.5 |                         16.5 | yes          | 0/0                | max 0.25 ms, uncertainty 0.45 ms |

Edit to next frame:

| condition                                                                  | document | clients | edits | viewer samples | p50 ms | p95 ms | p99 ms | mean ms | max ms | worst viewer per edit p95 ms | p95 < 100 ms | missing/mismatched | clock offset                     |
| -------------------------------------------------------------------------- | -------- | ------: | ----: | -------------: | -----: | -----: | -----: | ------: | -----: | ---------------------------: | ------------ | ------------------ | -------------------------------- |
| loopback on one host                                                       | large    |      10 |   320 |           2880 |    4.3 |    5.3 |    6.2 |     4.4 |    7.9 |                          6.2 | yes          | 0/0                | max 0.13 ms, uncertainty 0.37 ms |
| loopback on one host                                                       | small    |      10 |   320 |           2880 |    4.6 |    9.0 |   11.7 |     5.5 |   25.8 |                         11.4 | yes          | 0/0                | max 0.24 ms, uncertainty 0.31 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN) | large    |      10 |   320 |           2880 |   15.5 |   17.1 |   18.2 |    15.6 |   21.0 |                         18.0 | yes          | 0/0                | max 0.19 ms, uncertainty 0.35 ms |
| emulated 10 ms RTT (emulated with a userspace delay proxy, not a real LAN) | small    |      10 |   320 |           2880 |   14.8 |   16.5 |   17.7 |    15.0 |   30.9 |                         17.2 | yes          | 0/0                | max 0.25 ms, uncertainty 0.45 ms |

The spot check's p95 values (4.8, 7.4, 16.6 and 15.8 ms) are within the same range as the main run's
(9.0, 4.3, 22.7 and 16.7 ms for the same four cells) and below 100 ms.

## Limitations

- **One host, one browser engine.** Every number comes from one Linux arm64 machine and headless
  Chromium. Firefox, WebKit and Safari were not measured. **Nothing was measured on Windows or macOS,
  and nothing on the desktop app's panel.**
- **Emulated networks.** The 10 ms and 50 ms conditions are a userspace delay proxy with no bandwidth
  limit, loss or jitter. Loopback has no network hardware. A real office LAN, Wi-Fi or the public
  internet may behave differently.
- **A shared, busy host.** Other workloads ran during the measurements. The one-minute load average was
  between 2 and 19 on 20 cores (listed per step in `summary.md`). The server, PostgreSQL, the proxies,
  the browsers and the driver share the same CPUs.
- **"Visible" is a proxy.** Headless Chromium reports the DOM change and the next animation frame, not
  the moment pixels reach a display or a screen share.
- **Two builds.** See [Re-check on the newer build](#re-check-on-the-newer-build). The two builds differ
  by the document schema version; the results of the main run and the spot check are close, but they
  are not the same build.
- **Few repetitions in some places.** The reconnect rows have 3 to 5 runs. The memory test ran 60 s per
  document, once.
- **Resource use is partial.** PostgreSQL's own CPU and memory were not measured. Renderer CPU is the
  page's main thread only.
- **Image timing is latency-bound** at higher RTT because the emulated network has no bandwidth limit.
- **One client count ceiling.** The brief's target covers up to 10 clients; 10 is the largest count
  measured. No capacity or load test was run, and `COLLAB_MAX_CONNECTIONS=1000` in the server is a
  safety limit without a measurement behind it.
- **No promise for other setups.** The numbers above are what was measured on this setup, not a promise
  for another one.

## How to rerun

Run from the repository root on a machine with Docker. On the build host the toolchain prefix is
needed in every new shell: `. scripts/dev-env.sh`. **Do not run the stack on a machine where the live
deployment from `deploy/` runs without checking the ports first**: the benchmark uses its own
container name (`rd-perf-pg`) and its own ports (54320 for PostgreSQL, 4320 for the server, 4321 and
4322 for the delay proxies), but it competes for CPU with the live site.

```sh
. scripts/dev-env.sh
pnpm --filter @realtimedocs/perf run stack:up      # builds the server and the web app, starts rd-perf-pg, the server and the proxies
pnpm perf                                           # ping, headline, protocol, initial load, images -> tests/perf/results/<UTC>/
pnpm --filter @realtimedocs/perf run stack:pw-up   # once, for the three scenarios below
PERF_RUN_DIR=tests/perf/results/<directory> pnpm --filter @realtimedocs/perf run perf:local
PERF_RUN_DIR=tests/perf/results/<directory> pnpm --filter @realtimedocs/perf run perf:reconnect
PERF_RUN_DIR=tests/perf/results/<directory> pnpm --filter @realtimedocs/perf run perf:resources
pnpm --filter @realtimedocs/perf run perf:report -- tests/perf/results/<directory>   # rebuilds summary.md
pnpm --filter @realtimedocs/perf run stack:down    # stops everything
```

`stack:up` takes `--no-build` (pass it after `--`) to reuse earlier builds. `pnpm perf` accepts
`--edits N`, `--protocol-edits N`, `--loads N`, `--images N` and `--only a,b` with names from
`ping,browser-edit,protocol,initial-load,image`; to pass them call the script directly:
`node --import tsx tests/perf/src/run.ts --edits 320 --only ping,browser-edit`.

The scenario scripts in `tests/perf/package.json` can also be run on their own:

| Script                                                                   | What it runs                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `perf:ping`                                                              | Round-trip time for each network condition                                   |
| `perf:protocol <condition> <document> <clients> <edits>`                 | Protocol relay and "Saved" latency                                           |
| `perf:browser-edit <condition> <document> <clients> <edits>`             | Edit to visible remote render in Chromium (runs in the Playwright container) |
| `perf:initial-load`                                                      | Cold and warm initial load                                                   |
| `perf:image <condition> <clients> <bytes> <count>`                       | Image upload plus remote render                                              |
| `perf:local`, `perf:reconnect`, `perf:resources`                         | Local keystroke latency, reconnect convergence, memory and CPU               |
| `perf:report`                                                            | Rebuild `summary.md` from the raw JSON of a run directory                    |
| `stack:up`, `stack:down`, `stack:status`, `stack:pw-up`, `stack:pw-down` | Start, stop and inspect the test stack and the Playwright server             |

The conditions are `loopback`, `rtt10` and `rtt50`; the documents are `small` and `large`. Browser
scenarios run in the image `mcr.microsoft.com/playwright:v1.64.1-noble`. The method and the reasons
behind each choice are also in `docs/notes/perf.md`. A rerun on different hardware gives different
numbers; compare shapes, not digits.
