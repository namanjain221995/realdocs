# RealDocs load test report

Run on 2026-11-14 with the framework in `tests/performance`. Raw results: `docs/load-test-results/`.

Every number carries one of three labels. **MEASURED**: observed in a run listed here. **ESTIMATED**:
derived from measured numbers, with the derivation stated. **NOT TESTED**: not run, with the reason.

All measurements were made over the loopback interface of one machine, or over a direct 0.5 ms link
between two machines in the same rack. **None of the latencies below is internet latency.** A person on a
real network adds their own round trip to the server twice (once up, once down) to every "edit to
visible" number.

## 1. Executive summary

- **1,000 people editing at once (500 documents, two each) is sustainable on one backend process.**
  MEASURED over 5 minutes: edit to visible in the other person's document p50 0.5 ms, p95 1.4 ms,
  p99 3.8 ms; edit to saved p50 3.5 ms, p95 5.2 ms, p99 10.1 ms; 242,657 acknowledged edits, none
  missing from the server's export; 500 of 500 documents identical between their two clients. The backend
  used 46 % of one core and 550 MB, PostgreSQL about one core.
- **The limit found on this machine is between 3,000 and 4,000 simultaneous active editors per backend,
  and the database reaches it first.** MEASURED: 3,000 editors are clean (saved p99 26 ms); at 4,000 the
  text still reaches the other person in p95 4 ms, but saving queues behind the ten database connections
  (saved p95 189 ms); with 40 connections it is 73 ms; at 5,000 saving takes 0.6 to 0.8 s at the median
  and clients start to drop. Nothing acknowledged was lost in any of these runs.
- **5,000 connected people with a realistic mix** (half idle, three in ten reading, two in ten editing)
  held on one backend: MEASURED p50 0.5 ms, p95 4.0 ms, p99 180 ms, every connection made at the first
  attempt. 10,000 was NOT TESTED (shared machine).
- **100 people editing one document** worked: MEASURED p50 1.2 ms, p95 9.8 ms, p99 14.6 ms, all 100
  copies identical, 11,944 acknowledged edits present on the server.
- **Integrity:** in every run, every edit the server acknowledged as saved was found in the server's
  export afterwards (about 2.6 million checked in total), and no document diverged between clients.
  A backend restart, a 10-second database outage, a storm of 1,000 reconnects and revoked links were
  survived without loss.
- **Weak spots measured:** reconnecting after a backend restart takes 5.5 s at the median and 8.8 s at
  p95 (the client's backoff, not the server: it is back in 0.4 s); document search and the document
  list slow down with the number of documents; the events list of the version history scanned the whole
  audit log (fixed here, section 24).
- **One product change** was made: two indexes and a rewritten query for the history's events list.
- The latency objectives (p50 < 50 ms, p95 < 100 ms, p99 < 200 ms) are met with a wide margin up to
  3,000 active editors **on loopback**. Whether they are met for real users depends on their network,
  which was not part of this test.

## 2. Current application architecture

Read from the source, not from the documentation.

| Part                   | What it is                                                                                                                                                                                                                                                       | Where                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Frontend               | React 19, Vite 8, Tiptap 3 editor bound to Yjs with `@tiptap/y-tiptap`                                                                                                                                                                                           | `apps/web`, `packages/editor`                                |
| Backend                | Node.js 24, Fastify 5: REST API, static web app, release downloads                                                                                                                                                                                               | `apps/server/src/http`                                       |
| Collaboration          | Hocuspocus 4 on the same process and port (`/collab`), Yjs 13 documents in memory while open                                                                                                                                                                     | `apps/server/src/collab/server.ts`                           |
| Database               | PostgreSQL 17 through `pg` with a pool (`DB_POOL_MAX`, default 10)                                                                                                                                                                                               | `apps/server/src/config.ts:393`                              |
| Authentication         | Cookie sessions for accounts (Argon2id password hashes, `src/auth/password.ts`), guest sessions from share links, service API keys                                                                                                                               | `src/http/auth.ts`, `routes/shares.ts`                       |
| Collaboration access   | A single-use ticket per connection from `POST /api/documents/:id/collab-ticket`, checked when the socket authenticates                                                                                                                                           | `src/collab/tickets.ts`                                      |
| Persistence            | `DurableLog`: one writer per document; every event-loop turn's updates are merged and committed as one statement that locks the document row, inserts into `doc_updates` and writes the attributed `doc_history` rows; a failed commit is retried, never dropped | `src/collab/durable-log.ts:343-420`, `pg-log-store.ts:78-90` |
| Acknowledgement        | The client counts its local changes and sends `mark n`; the server answers `saved n` only after the commit that contains them. After a reconnect the client proves its state with `hello` and a snapshot                                                         | `src/collab/server.ts:1140-1262`                             |
| Autosave               | There is no timer: every change is sent at once and is durable when `saved` arrives. Hocuspocus's own store hook (debounce 2 s, at most 10 s) only compacts                                                                                                      | `src/collab/server.ts:381-409`                               |
| Offline                | The editor keeps unacknowledged updates in IndexedDB for account users and replays them; guests keep nothing                                                                                                                                                     | `packages/editor/src/collab/persistence.ts`, `session.ts`    |
| Several backends       | Optional (`REDIS_URL`): one backend owns a document (Redis lease); other backends forward that document's sockets to the owner; tickets and rate limits move to Redis                                                                                            | `src/cluster/cluster.ts`                                     |
| Limits                 | Per-address, per-account, per-session and per-key rate limits; 1,000 collaboration connections per process by default (`COLLAB_MAX_CONNECTIONS`); document state 8 MiB                                                                                           | `src/http/rate-limits.ts`, `config.ts:332-407`               |
| Metrics                | Prometheus text at `/metrics` behind a token                                                                                                                                                                                                                     | `src/metrics.ts`                                             |
| Deployment             | One Docker image; Compose with PostgreSQL; the live site behind a Cloudflare Tunnel                                                                                                                                                                              | `Dockerfile`, `docker-compose.yml`, `deploy/`                |
| Tests before this work | Unit, integration, browser suites, and a load harness `tests/load` with a report `docs/load-test-report.md`                                                                                                                                                      | `docs/testing.md`                                            |

Consequences for load: a backend is one Node.js process, so one core does all collaboration work of the
documents it owns; a document lives in exactly one process; every acknowledged change is a database
commit.

## 3. DGX Spark hardware information

|                       | This machine (`spark-0e68`)                                                                  | Second machine (`spark-476e`)         |
| --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------- |
| Model                 | NVIDIA DGX Spark                                                                             | NVIDIA DGX Spark                      |
| CPU                   | 20 cores, aarch64: 10 Cortex-X925 and 10 Cortex-A725, one thread per core                    | 20 cores                              |
| Memory                | 121 GiB total; about 31 GiB available at the start; 17 GiB of 64 GiB swap already in use     | 121 GiB total, about 50 GiB available |
| Load before the tests | 1-minute load average about 0.9                                                              | about 1.0                             |
| Other work on it      | 54 unrelated containers (language-model serving and others) and the live RealDocs deployment | 27 unrelated containers               |
| Disk                  | 3.7 TB, 2.2 TB free                                                                          | 3.7 TB, 2.8 TB free                   |
| Link between them     | direct connection, addresses 10.100.184.1 and 10.100.184.2, ping 0.3 to 0.8 ms               |                                       |
| Role in the tests     | backend, database, load generators                                                           | load generator only, in one run       |

All MEASURED on 2026-11-14. The ten performance cores and ten efficiency cores are not equal, and the
scheduler decides where a process runs: CPU percentages below are "per cent of one core" as the kernel
accounts them, on whatever core was used.

## 4. Test environment

- An isolated stack per run, started and removed by the framework: PostgreSQL 17.11 in a container
  (`rd-load-pg`, 127.0.0.1:15450, limited to 4 CPUs and 6 GiB, database on the container's own
  storage, `pg_stat_statements` on), the backend as one or two local processes on 127.0.0.1:4450-4451
  from a private copy of the production build, a round-robin proxy on 127.0.0.1:4459 that every client
  used as its one origin, Redis 8.8 (`rd-load-redis`) only for the two-backend runs.
- Synthetic data only: an administrator created by the product's CLI, documents and share links created
  through the API, one guest session per simulated user.
- The live deployment (Compose project `realtimedocs`, port 4310) was not contacted and not changed.
- Settings of the test stack that differ from the defaults: the per-address rate limits were raised
  (all clients come from one address; `RAISED_LIMITS` in `tests/load/src/stack.ts`),
  `COLLAB_MAX_CONNECTIONS` 5000 (12000 in the escalations), `CLEANUP_INTERVAL_MINUTES` 0. Per-account,
  per-session and per-key limits kept their defaults. `DB_POOL_MAX` 10 unless a run says 40.
- Safety: a watchdog stopped a run when the 1-minute load average exceeded 18, available memory fell
  below 10 GiB, or swap grew by more than 2 GiB. It fired once (section 14).
- Load generators: 8 or 10 Node.js processes on the same machine, each holding the clients of whole
  documents. They share the machine with the backend and the database, so at the top steps the backend
  did not have the machine to itself.

## 5. Testing tools

| Tool                                                                                    | Use                                                           | Why                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js clients with `@hocuspocus/provider` and Yjs (the libraries the product uses)    | every collaboration scenario                                  | the product's protocol has an acknowledgement (`mark`/`saved`) and a proof after reconnect (`hello`); a generic WebSocket tool cannot follow it or hold a real Y.Doc |
| Closed-loop HTTP driver built on `fetch`                                                | API benchmark                                                 | needs the product's cookies and CSRF header; no extra dependency                                                                                                     |
| `/metrics` of the backend                                                               | event-loop delay, pool, WebSocket counts, persistence timings | server-side view                                                                                                                                                     |
| `/proc/<pid>/stat`, `docker stats`                                                      | CPU and memory of the backend and PostgreSQL                  | per process                                                                                                                                                          |
| `pg_stat_database`, `pg_stat_activity`, `pg_locks`, `pg_stat_wal`, `pg_stat_statements` | commits, rows, WAL, locks, slowest statements                 | in the test container only                                                                                                                                           |
| k6, autocannon                                                                          | not used                                                      | nothing they add over the above for this protocol; not installed                                                                                                     |

## 6. Test scripts created

In `tests/performance` (new):

| File                                                            | Purpose                                                                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `perf.sh`                                                       | entry point                                                                                                       |
| `src/run.ts`                                                    | runner: stack, watchdog, scenarios, result files, cleanup                                                         |
| `src/scenarios.ts`                                              | scenarios A, B, C, D, E, `api`, `large`, `soak`, `remote`, and wrappers around five scenarios of `tests/load`     |
| `src/worker.ts`                                                 | generator process: seeded activity profiles, convergence check, connection drops, the scripted two-person session |
| `src/monitor.ts`                                                | watchdog; host, backend and PostgreSQL sampling; slowest statements                                               |
| `src/profiles.json`                                             | the activity profiles                                                                                             |
| `src/remote-gen.ts`, `src/bundle-remote.mjs`, `src/forward.mjs` | stand-alone generator for a second machine, its bundler, and the forwarder bound to the direct link               |
| `README.md`, `tsconfig.json`                                    | documentation, type check                                                                                         |

Reused from `tests/load` (existing, imported): the stack, the simulated client, the orchestration, the
metrics sampler, the renderer, and the scenarios for rate steps, restart, database pause, reconnect storm
and revoked links. Three small changes were made there: the worker script is replaceable, its command
table is exported, and the PostgreSQL container accepts CPU and memory limits and statement statistics.

## 7. Exact commands to reproduce tests

```bash
tests/performance/perf.sh A,B --rounds 100 --out 01-A-B
tests/performance/perf.sh C --out 02-C
tests/performance/perf.sh D --out 03-D
tests/performance/perf.sh E --env COLLAB_MAX_CONNECTIONS=12000 --workers 10 --out 04-E-mixed
tests/performance/perf.sh E --mix active --steps 200,500,1000,1500,2000,3000,4000,5000 \
  --env COLLAB_MAX_CONNECTIONS=12000 --workers 10 --out 05-E-active
tests/performance/perf.sh api,large --sizes 5,100,1024,5120 --out 06-api-large
tests/performance/perf.sh E --mix active --steps 3000,4000,5000 --topology B \
  --env COLLAB_MAX_CONNECTIONS=12000 --workers 10 --out 07-E-active-pool40
tests/performance/perf.sh storm --out 08-stress-storm
tests/performance/perf.sh restart,dbpause,access --topology C --out 09-reliability
tests/performance/perf.sh C --topology C --out 10-C-two-backends
tests/performance/perf.sh remote --gen-host local --docs 500 --out 11-gen-local
tests/performance/perf.sh remote --gen-host 10.100.184.2 --link 10.100.184.1 --docs 500 \
  --env ALLOWED_ORIGINS=http://127.0.0.1:4459,http://127.0.0.1:4450,http://10.100.184.1:4460 \
  --out 12-gen-spark2
tests/performance/perf.sh api --out 13-api-after-index
tests/performance/perf.sh soak --minutes 30 --out 14-soak-30min
```

Seed 20261114 (the default). Each directory under `docs/load-test-results/` holds the JSON and Markdown
of its run, the environment, and the time series.

## 8. Test scenarios

Activity profiles (`tests/performance/src/profiles.json`). A client draws each action from a generator
seeded with the run's seed and its own key; gaps between actions are exponentially distributed.

| Profile | Actions per second | Typing : deleting : formatting : cursor | Pauses                     | Connection drops |
| ------- | ------------------ | --------------------------------------- | -------------------------- | ---------------- |
| light   | 0.05               | 1 : 0 : 0 : 4                           | 30 % of actions, 5 to 30 s | 0.2 % of actions |
| normal  | 0.3                | 6 : 1 : 1 : 2                           | 10 %, 2 to 15 s            | 0.2 %            |
| active  | 1                  | 7 : 1 : 1 : 1                           | 4 %, 1 to 6 s              | 0.1 %            |
| heavy   | 3                  | 8 : 1 : 0.5 : 0.5                       | 1 %, 0.5 to 3 s            | 0.05 %           |
| collab  | 2                  | 7 : 1 : 1 : 1                           | 2 %, 0.5 to 4 s            | 0.1 %            |

"Typing" inserts a unique 8-character marker into the person's own paragraph; deleting and formatting
(bold, italic) work on a second paragraph of the same person, so that markers stay checkable. A dropped
connection is re-established by the client with a new ticket, as the editor does.

| Scenario                        | What ran                                                                                                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A                               | one document, two people, 100 rounds of typing, deletion, formatting, paragraph insertion, a 2 kB paste, cursor movement; 1,000 simultaneous insertions into the same paragraph; one disconnect and catch-up; reload by a fresh client |
| B                               | 100 documents, 2 people each, all on `active`, 180 s measured                                                                                                                                                                          |
| C                               | 500 documents, 2 people each: two in five `normal`, two in five `active`, one in five `heavy`; 300 s measured                                                                                                                          |
| D                               | one document, 2, 5, 10, 25, 50, 75, 100 people all on `active`, 60 s each; then 100 connected with 10 editing                                                                                                                          |
| E mixed                         | 100 to 5,000 people, two per document: 50 % idle (connected, presence every 10 s), 30 % viewing (`light`), 20 % `active`; 60 s per step                                                                                                |
| E active                        | 200 to 5,000 people, two per document, all `active`; 60 s per step                                                                                                                                                                     |
| api                             | 16 concurrent requests per endpoint for 20 s (4 for snapshots and uploads), one administrator session                                                                                                                                  |
| large                           | documents of 5 KiB, 100 KiB, 1 MiB and 5 MiB of Yjs state                                                                                                                                                                              |
| storm, restart, dbpause, access | 1,000 clients dropped at once; each of two backends restarted while 400 people type; the database paused for 10 s; 50 links revoked and 100 expired                                                                                    |
| soak                            | the workload of C for 30 minutes                                                                                                                                                                                                       |
| remote                          | 500 documents, 2 people each, 1 edit per second each, generator on this machine and on the second one                                                                                                                                  |

Users are guests of share links with the editor role, one session each: the product's real authorisation
path for collaborators without an account. Account sessions were used for administration and the API
benchmark. Not simulated: browsers (rendering, the editor's own work), document switching by one person.

## 9. 2-user collaboration results

Run `01-A-B`, scenario A. All MEASURED, loopback, milliseconds.

| Operation               | n     | Edit to visible in the other person's document: p50 / p95 / p99 / max | Edit to saved: p50 / p95 / p99 / max |
| ----------------------- | ----- | --------------------------------------------------------------------- | ------------------------------------ |
| Typing                  | 400   | 0.79 / 1.27 / 1.57 / 3.06                                             | 3.24 / 4.42 / 5.25 / 6.24            |
| Deletion                | 200   | 0.71 / 1.16 / 1.40 / 2.17                                             | 3.00 / 4.19 / 4.70 / 5.16            |
| Formatting (bold)       | 200   | 0.77 / 1.27 / 1.69 / 2.10                                             | 3.07 / 4.14 / 5.05 / 5.25            |
| Paragraph insertion     | 200   | 0.49 / 0.85 / 1.01 / 1.42                                             | 2.92 / 3.96 / 4.76 / 4.94            |
| Paste of 2 kB           | 200   | 0.77 / 1.17 / 1.31 / 1.92                                             | 2.98 / 4.17 / 4.73 / 5.04            |
| Cursor and selection    | 200   | 11.1 / 16.9 / 18.7 / 19.1                                             | not saved (presence only)            |
| All document operations | 1,200 | **0.72 / 1.19 / 1.54 / 3.06**                                         | **3.06 / 4.26 / 4.99 / 6.24**        |

- Delivery: 1,200 of 1,200 operations arrived; no timeout.
- Simultaneous typing into the same paragraph: 1,000 insertions by the two people at the same moments;
  0 missing after the merge; 1,000 found in the server's export.
- Convergence: both clients held identical content at the end.
- Reconnection: one person was disconnected while the other typed; reconnected and caught up after
  291 ms (one sample).
- Save and reload: a fresh client received the document (455 kB of Yjs state, 203 blocks) in 28, 39 and
  40 ms.
- Resources during the session: backend about 10 % of one core, 301 MB; PostgreSQL 16 to 23 % of one
  core, 40 MB.
- Cursor updates take about 11 ms because presence is batched by the collaboration library; they are
  not document changes.

## 10. 100-document / 200-user results

Run `01-A-B`, scenario B: 100 documents, 200 people, every one of them editing for the whole 180 s. MEASURED.

| Measure                 | Value                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Connections             | 200 of 200 at the first attempt; connect time p50 32 ms, p95 46 ms                            |
| Marker edits per second | 121 (plus 17 deletions, 17 formatting changes and 18 cursor updates per second)               |
| Edit to visible, ms     | p50 0.7, p95 1.0, p99 1.2, max 330 (n = 21,802)                                               |
| Edit to saved, ms       | p50 3.3, p95 4.6, p99 5.3, max 14.5                                                           |
| Database                | 180 commits/s, 305 rows/s, 0.2 MB/s of WAL, no lock waits, at most 2 active connections of 10 |
| Backend                 | 9.5 % of one core on average (peak 13 %), 318 MB                                              |
| PostgreSQL              | 20 % of one core on average (peak 26 %), 100 MB                                               |
| Failed updates          | 0: 23,697 acknowledged edits checked against the export, 0 missing                            |
| Reconnections           | 30 deliberate drops, 30 reconnects, p50 328 ms, p95 418 ms                                    |
| Convergence             | 100 of 100 documents identical between their two clients                                      |
| Verdict                 | stable                                                                                        |

The maximum of 330 ms is an edit made while the other person was reconnecting.

## 11. 500-document / 1,000-user results

Run `02-C`, scenario C: 500 documents, 1,000 people, all editing, 300 s measured. MEASURED.

| Measure             | Value                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Connections         | 1,000 of 1,000 at the first attempt; connect time p50 30 ms, p95 42 ms, p99 54 ms                                    |
| Activity per second | 756 marker edits, 102 deletions, 72 formatting changes, 81 cursor updates                                            |
| Edit to visible, ms | **p50 0.5, p95 1.4, p99 3.8**, max 381 (n = 226,793)                                                                 |
| Edit to saved, ms   | p50 3.5, p95 5.2, p99 10.1, max 347                                                                                  |
| Database            | 1,059 commits/s, 1,838 rows/s, 1.4 MB/s of WAL, no lock waits, at most 6 active connections, no waiting for the pool |
| Backend             | 46 % of one core on average (peak 52 %), 550 MB, heap up to 325 MB                                                   |
| PostgreSQL          | 103 % of one core on average (peak 110 %), 215 MB                                                                    |
| Reconnections       | 274 deliberate drops, 274 reconnects, p50 317 ms, p95 408 ms                                                         |
| Integrity           | 242,657 acknowledged edits checked, 0 missing; 500 of 500 documents identical                                        |
| Verdict             | **stable: 1,000 active editors are sustainable on one backend process on this machine**                              |

The same workload on two backends with Redis (run `10-C-two-backends`): p50 0.5 ms, p95 1.1 ms,
p99 1.7 ms; each backend 29 % of one core and about 380 MB; 242,660 edits checked, 0 missing; all
documents identical. MEASURED.

## 12. 100-user single-document results

Run `03-D`. Everyone connected was editing (`active` profile), 60 s per step. MEASURED.

| People in the document    | Marker edits/s | Edit to visible, ms: p50 / p95 / p99 | Edit to saved, ms: p50 / p95 / p99 | Backend CPU (one core) | Backend memory |
| ------------------------- | -------------- | ------------------------------------ | ---------------------------------- | ---------------------- | -------------- |
| 2                         | 1.4            | 1.3 / 1.7 / 2.2                      | 14.0 / 15.4 / 18.1                 | 0.5 %                  | 225 MB         |
| 5                         | 2.8            | 1.2 / 1.7 / 1.8                      | 13.2 / 15.3 / 15.7                 | 0.9 %                  | 237 MB         |
| 10                        | 5.7            | 1.2 / 1.7 / 1.9                      | 5.5 / 15.0 / 15.6                  | 1.4 %                  | 195 MB         |
| 25                        | 15.1           | 1.1 / 1.6 / 2.3                      | 4.8 / 14.4 / 15.2                  | 2.7 %                  | 208 MB         |
| 50                        | 31.3           | 1.1 / 3.0 / 6.8                      | 5.0 / 7.8 / 14.2                   | 5.6 %                  | 251 MB         |
| 75                        | 45.8           | 1.2 / 7.2 / 13.7                     | 5.8 / 12.2 / 15.6                  | 9.5 %                  | 309 MB         |
| 100                       | 61.7           | **1.2 / 9.8 / 14.6**                 | 6.8 / 12.3 / 16.8                  | 13.1 %                 | 323 MB         |
| 100 connected, 10 editing | about 6        | 1.3 / 2.4 / 19.4                     | 13.6 / 16.3 / 20.9                 | 2.7 %                  | 324 MB         |

- Integrity: 11,944 acknowledged edits checked, 0 missing; all 100 clients held identical content.
- No update was lost and no connection failed; 21 deliberate drops were reconnected.
- Reading the table: with few edits the "saved" time is longer (about 14 ms) than with many
  (5 ms). The same was seen at the smallest steps of section 13. The cause was not investigated; it
  is far below the objective.
- The 100 simulated people ran in one generator process, each applying every remote change to its own
  Y.Doc. Part of the growth of p95 from 1.7 to 9.8 ms is that process's own work, so the server-side
  share is at most what is shown.
- Browser responsiveness with 100 carets in one document: NOT TESTED (no browsers in this framework).

## 13. Maximum concurrent connection results

Run `04-E-mixed`: two people per document; half the people idle, three in ten viewing, two in ten
editing. 60 s per step on one backend. MEASURED.

| People connected | of which editing | Marker edits/s | Edit to visible, ms: p50 / p95 / p99 | Edit to saved, ms: p50 / p95 / p99 | Backend CPU | Backend memory | PostgreSQL CPU |
| ---------------- | ---------------- | -------------- | ------------------------------------ | ---------------------------------- | ----------- | -------------- | -------------- |
| 100              | 20               | 12             | 1.1 / 1.5 / 1.7                      | 4.5 / 14.2 / 15.0                  | 2.5 %       | 309 MB         | 4 %            |
| 250              | 50               | 31             | 0.9 / 1.2 / 1.5                      | 4.0 / 5.5 / 13.7                   | 4.2 %       | 320 MB         | 7 %            |
| 500              | 100              | 60             | 0.8 / 1.2 / 1.5                      | 3.6 / 4.9 / 5.9                    | 6.8 %       | 339 MB         | 11 %           |
| 750              | 150              | 88             | 0.7 / 1.1 / 1.6                      | 3.3 / 4.7 / 6.3                    | 8.8 %       | 380 MB         | 15 %           |
| 1,000            | 200              | 122            | 0.7 / 1.1 / 2.1                      | 3.3 / 4.6 / 7.4                    | 12.7 %      | 425 MB         | 19 %           |
| 1,500            | 300              | 180            | 0.6 / 1.0 / 2.6                      | 3.2 / 4.6 / 11.9                   | 15.7 %      | 462 MB         | 27 %           |
| 2,000            | 400              | 244            | 0.5 / 1.0 / 10.5                     | 3.1 / 4.7 / 25.3                   | 20.6 %      | 519 MB         | 35 %           |
| 3,000            | 600              | 368            | 0.5 / 1.2 / 66.5                     | 3.2 / 5.4 / 77.5                   | 30.3 %      | 556 MB         | 50 %           |
| 5,000            | 1,000            | 624            | 0.5 / 4.0 / 180.3                    | 3.6 / 16.5 / 214.4                 | 50.6 %      | 667 MB         | 92 %           |

- Every new connection at every step succeeded at the first attempt (100 %); nobody was disconnected at
  the end of a step other than through the deliberate drops, all of which reconnected.
- 152,894 acknowledged edits checked, 0 missing; 2,500 of 2,500 documents identical.
- **Maximum stable connected users: 5,000 (MEASURED), the highest step attempted.** At 5,000 the p99 of
  180 ms is close to the 200 ms objective: the tail, not the median, is what grows.
- 10,000 connections: NOT TESTED. The generators and the backend share one machine that also runs other
  people's work; the 5,000-editor step already pushed the load average to the watchdog's limit.
- Memory per connection, ESTIMATED from the first and last rows: (667 - 309) MB / 4,900 people = about
  73 kB per connected person in this mix, including their share of open documents.

## 14. Maximum active editor results

Run `05-E-active` (pool of 10 database connections) and `07-E-active-pool40` (pool of 40): two people
per document, every person on the `active` profile. 60 s per step. MEASURED.

| Active editors | Pool | Marker edits/s | Edit to visible, ms: p50 / p95 / p99 | Edit to saved, ms: p50 / p95 / p99 | Backend CPU | Backend memory | PostgreSQL CPU | Commits/s | Waiting for a connection (peak) |
| -------------- | ---- | -------------- | ------------------------------------ | ---------------------------------- | ----------- | -------------- | -------------- | --------- | ------------------------------- |
| 200            | 10   | 121            | 0.7 / 1.1 / 1.3                      | 3.4 / 4.7 / 5.7                    | 11 %        | 319 MB         | 18 %           | 183       | 0                               |
| 500            | 10   | 303            | 0.6 / 1.0 / 1.3                      | 3.2 / 4.5 / 5.8                    | 20 %        | 339 MB         | 45 %           | 452       | 0                               |
| 1,000          | 10   | 613            | 0.5 / 1.2 / 2.3                      | 3.4 / 4.9 / 7.3                    | 39 %        | 532 MB         | 84 %           | 921       | 0                               |
| 1,500          | 10   | 925            | 0.6 / 1.8 / 4.3                      | 3.9 / 6.8 / 14.1                   | 58 %        | 626 MB         | 157 %          | 1,271     | 39                              |
| 2,000          | 10   | 1,217          | 0.7 / 2.8 / 6.5                      | 4.0 / 8.1 / 16.0                   | 68 %        | 740 MB         | 177 %          | 1,837     | 41                              |
| 3,000          | 10   | 1,853          | 0.5 / 3.5 / 6.9                      | 4.4 / 12.0 / 25.7                  | 65 %        | 915 MB         | 301 %          | 2,638     | 204                             |
| 4,000          | 10   | 2,522          | 0.5 / 4.1 / 15.0                     | 80.9 / 188.7 / 262.1               | 75 %        | 936 MB         | 393 %          | 3,298     | 572                             |
| 5,000          | 10   | 3,571          | 0.6 / 10.0 / 140.6                   | 839 / 1,268 / 1,572                | 94 %        | 1,739 MB       | 370 %          | 2,847     | 2,102                           |
| 3,000          | 40   | 1,901          | 0.5 / 4.1 / 9.5                      | 3.9 / 18.9 / 49.4                  | 65 %        | 926 MB         | 295 %          | 2,623     | 72                              |
| 4,000          | 40   | 2,445          | 0.5 / 7.1 / 15.8                     | 6.0 / 72.9 / 122.3                 | 72 %        | 1,016 MB       | 390 %          | 3,553     | 106                             |
| 5,000          | 40   | 3,627          | 1.4 / 14.4 / 87.0                    | 588 / 1,094 / 1,235                | 88 %        | 1,555 MB       | 407 %          | 3,229     | 1,761                           |

- **Maximum stable active editors on one backend: 3,000 (MEASURED)** with the default pool: every
  objective met, saving p99 26 ms. This is the number to plan with.
- 4,000 meets the edit-to-visible objectives but saving is no longer prompt with the default pool
  (p95 189 ms); a pool of 40 brings it to p95 73 ms, p99 122 ms. Usable, without headroom.
- 5,000 is not stable in either configuration: saving falls behind (median 0.6 to 0.8 s), commits per
  second fall instead of rising, 19 to 21 clients were disconnected at the end of the step, and in the
  pool-40 run the watchdog stopped the run (load average 18.5: generators, backend and a database at
  its 4-CPU limit on one machine). 1,027,523 and 668,633 acknowledged edits were checked in the two
  runs: 0 missing. 5 and 2 edits were still unacknowledged two minutes after the end, on clients that
  had not reconnected.
- What gives way: the database. PostgreSQL was at its 4-CPU limit from 4,000 editors on, and requests
  queued for a pooled connection. The backend process itself was at 65 to 75 % of one core at 3,000 to
  4,000.

## 15. Maximum same-document collaborator results

**100 people editing one document at once: stable (MEASURED, section 12)**, the highest number
attempted. More than 100 in one document: NOT TESTED. The trend from 50 to 100 (p95 3.0, 7.2, 9.8 ms)
leaves room, but the generator's own share in that trend is unknown, so no number above 100 is claimed.

## 16. API performance results

Run `06-api-large`: one administrator session, 16 concurrent requests per endpoint for 20 s (4 for
snapshot creation and uploads), closed loop, loopback. The workspace held 32,444 documents by the time
the list and search ran, because the creation test had just made them. Latency is that of successful
requests. MEASURED.

| Endpoint                                        | Successful requests/s | p50 ms | p95 ms | p99 ms | Notes                                                                                                               |
| ----------------------------------------------- | --------------------- | ------ | ------ | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login`                          | sequential            | 100    | 132    | 132    | 12 logins, all accepted; Argon2id by design                                                                         |
| `GET /api/auth/session`                         | 8,573                 | 1.7    | 3.2    | 6.0    |                                                                                                                     |
| `POST /api/documents`                           | 1,622                 | 9.5    | 13.0   | 16.0   |                                                                                                                     |
| `GET /api/documents` (list)                     | 440                   | 35.8   | 43.1   | 48.8   | returns at most 500 of 32,444 documents                                                                             |
| `GET /api/documents?q=` (search)                | 472                   | 25.2   | 68.7   | 77.3   | title search over 32,444 documents                                                                                  |
| `GET /api/documents/:id`                        | 4,133                 | 3.2    | 6.8    | 18.0   |                                                                                                                     |
| `POST /api/documents/:id/shares`                | 1,845                 | 8.5    | 10.8   | 13.7   |                                                                                                                     |
| `GET /api/documents/:id/members`                | 3,164                 | 3.8    | 11.4   | 28.4   |                                                                                                                     |
| `POST /api/documents/:id/collab-ticket`         | limited               | 4.2    | 13.5   | 15.8   | 120 accepted, the rest refused with 429 by the per-session ticket limit, as designed                                |
| `GET /api/documents/:id/history`                | 420                   | 31.0   | 63.5   | 69.5   | before the fix of section 24                                                                                        |
| `GET /api/documents/:id/export?format=json`     | 340                   | 44.7   | 61.9   | 67.8   | a 200 kB document                                                                                                   |
| `GET /api/documents/:id/snapshots`              | 3,426                 | 3.7    | 9.0    | 23.6   |                                                                                                                     |
| `POST /api/documents/:id/snapshots`             | 20                    | 16.5   | 23.1   | 30.0   | 202 created; further ones refused with 409 (the per-document snapshot limit)                                        |
| `POST /api/documents/:id/assets` (100 kB image) | 16                    | 22.4   | 28.2   | 31.6   | 240 accepted in the minute, the rest refused with 429 by the per-session upload limit (240 per minute), as designed |
| `GET /api/documents/:id/assets/:id` (100 kB)    | 914                   | 17.0   | 23.3   | 26.9   |                                                                                                                     |

- HTTP errors other than the refusals named above: none.
- Common API p95 below 150 ms: met on loopback for every endpoint measured.
- During this run the backend averaged 98 % of one core and PostgreSQL 320 % (its limit is 400 %), with
  up to 20 requests waiting for one of the 10 pooled connections. For API traffic at this intensity the
  backend process and the pool are the limits, not the disk.
- Not measured: sign-up, invitations, the service API for interview sessions and webhooks (measured
  earlier in `docs/load-test-report.md`), permission changes on members.

## 17. Database performance results

MEASURED from `pg_stat_database`, `pg_stat_wal`, `pg_locks` and `pg_stat_statements` in the test container.

| Workload          | Commits/s | Rows inserted/s | WAL MB/s | PostgreSQL CPU (cores) | Lock waits | Deadlocks |
| ----------------- | --------- | --------------- | -------- | ---------------------- | ---------- | --------- |
| 200 editors (B)   | 180       | 305             | 0.2      | 0.2                    | 0          | 0         |
| 1,000 editors (C) | 1,059     | 1,838           | 1.4      | 1.0                    | 0          | 0         |
| 3,000 editors     | 2,638     | 4,606           | 4.0      | 3.0                    | 0          | 0         |
| 4,000 editors     | 3,298     | 6,109           | 4.7      | 3.9 (limit 4)          | 0          | 0         |
| API benchmark     | 12,781    | 791             | 0.5      | 3.2                    | 0          | 0         |

- The statement that carries collaboration, "lock the document row, insert the update, insert its
  history rows", took 0.21 ms on average (27,155 calls in scenario B) and accounts for almost all
  database time in the editing scenarios.
- ESTIMATED from the table: about one PostgreSQL core per 1,000 commits per second on this hardware,
  and one commit per acknowledged burst of typing per person.
- No lock contention and no deadlock in any run: each document has one writer, so writers of different
  documents do not meet.
- Pool: with 10 connections, requests waited from 1,500 editors on (peak 39) and heavily from 4,000
  (572). With 40 connections the wait at 4,000 fell to 106 and saving p95 from 189 ms to 73 ms.
- Slow statements, from the API benchmark: the title search (12.7 ms on average over 32,444 documents;
  a pattern match that no index serves) and the events list of the history (11.7 ms; fixed, section 24).
- Disk: block write time was 75 ms in total over 180 s in scenario B and 341 ms over 300 s in scenario
  C: the test database is small and stays in memory, so disk speed was not exercised. A production
  database on network storage: NOT TESTED.

## 18. CPU and memory measurements

MEASURED per process (per cent of one core; resident memory).

| Workload                 | Backend CPU avg / peak | Backend memory | PostgreSQL CPU avg / peak | PostgreSQL memory | Host load average (peak) |
| ------------------------ | ---------------------- | -------------- | ------------------------- | ----------------- | ------------------------ |
| A, two people            | 10 % / 11 %            | 301 MB         | 16 % / 23 %               | 40 MB             | 2.8                      |
| B, 200 editors           | 9.5 % / 13 %           | 318 MB         | 20 % / 26 %               | 100 MB            | 2.3                      |
| C, 1,000 editors         | 46 % / 52 %            | 550 MB         | 103 % / 110 %             | 215 MB            | 4.6                      |
| D, 100 in one document   | 13 % / 16 %            | 323 MB         | 10 % / 14 %               | 80 MB             | 1.8                      |
| 5,000 connected, mixed   | 51 % / 66 %            | 667 MB         | 92 % / 104 %              | 209 MB            | 4.0                      |
| 3,000 editors            | 65 % / 75 %            | 915 MB         | 301 % / 413 %             | 228 MB            | 6.6                      |
| 5,000 editors (overload) | 94 % / 113 %           | 1,739 MB       | 370 % / 380 %             | 254 MB            | 10.4                     |
| API benchmark            | 98 % / 152 %           | 823 MB         | 320 % / 424 %             | 172 MB            | about 6                  |

- **Peak CPU:** backend 152 % of one core (API benchmark; above 100 % because of the helper threads
  for password hashing, file reads and garbage collection); PostgreSQL 424 % (its limit was 4 CPUs).
- **Peak memory:** backend 1,739 MB (5,000 editors, in overload, with a save queue); PostgreSQL 393 MB.
- Host: available memory never fell below 29 GiB and swap did not grow; the load average peaked at
  18.5 once (section 14).
- ESTIMATED per person, from scenario C: 0.046 % of one backend core and about 0.25 MB of backend
  memory per active editor (two per document), plus 0.1 % of a PostgreSQL core.
- Event-loop delay p99 as reported by the backend stayed between 21 and 37 ms up to 4,000 editors and
  reached 88 ms at 5,000. The reported floor of about 21 ms is the sampler's own resolution (it is 21 ms
  with two people connected), so only the rise above it is information.

## 19. p50/p95/p99 latency

Edit to visible in the other person's Y.Doc, milliseconds, loopback, MEASURED.

| Workload                                                     | p50  | p95  | p99   | Objective (50 / 100 / 200)      |
| ------------------------------------------------------------ | ---- | ---- | ----- | ------------------------------- |
| 2 people, all operations                                     | 0.72 | 1.19 | 1.54  | met                             |
| 200 editors in 100 documents                                 | 0.7  | 1.0  | 1.2   | met                             |
| 1,000 editors in 500 documents                               | 0.5  | 1.4  | 3.8   | met                             |
| 100 editors in one document                                  | 1.2  | 9.8  | 14.6  | met                             |
| 3,000 editors                                                | 0.5  | 3.5  | 6.9   | met                             |
| 4,000 editors                                                | 0.5  | 4.1  | 15.0  | met (saving is not, section 14) |
| 5,000 connected, mixed                                       | 0.5  | 4.0  | 180.3 | met, p99 close to the limit     |
| 1,000 editors, generator on the second machine (0.5 ms link) | 0.76 | 1.53 | 7.5   | met (worst generator process)   |

The parts of the path, MEASURED where the framework can separate them:

| Part                                                                       | Value                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------- |
| Client to server and server to the other client together (the table above) | 0.5 to 1.3 ms at the median                             |
| Server processing and database commit, seen as "edit to saved"             | 3.1 to 4.5 ms at the median while the database keeps up |
| Database commit alone                                                      | 0.21 ms mean for the append statement                   |
| Presence (cursor) delivery                                                 | 11 ms median                                            |
| Browser rendering                                                          | NOT TESTED                                              |
| Network of a real user                                                     | NOT TESTED; add the user's round trip to the server     |

## 20. Error and disconnect rates

MEASURED.

| Run                   | First-attempt connection success | Unplanned disconnects                                            | Save errors | HTTP errors                                               |
| --------------------- | -------------------------------- | ---------------------------------------------------------------- | ----------- | --------------------------------------------------------- |
| A, B, C, D            | 100 % (2, 200, 1,000, 100)       | 0                                                                | 0           | 0                                                         |
| E mixed, up to 5,000  | 100 % at every step              | 0                                                                | 0           | 0                                                         |
| E active, up to 4,000 | 100 % at every step              | 0                                                                | 0           | 0                                                         |
| E active, 5,000       | 100 % of new connections         | 19 (pool 10) and 21 (pool 40) clients not reconnected at the end | 0           | 0                                                         |
| Reconnect storm       | 1,000 of 1,000 reconnected       | all 1,000 dropped on purpose                                     | 0           | 0                                                         |
| Backend restarts      | 400 of 400 back                  | 277 and 394 sockets closed by the restarting backend             | 0           | connection refusals while the backend was down (expected) |

Deliberate drops by the profiles (close code 1005) were all reconnected: 30 in B, 274 in C, 21 in D,
up to 257 per step in E. WebSocket connection success of at least 99.9 %: met in every step up to 4,000
active editors and 5,000 connected.

## 21. Document integrity results

MEASURED. "Checked" means: an edit for which the client received `saved`, looked for afterwards in
`GET /api/documents/:id/export?format=json`.

| Run                               | Acknowledged edits checked    | Missing | Documents compared between clients | Diverged |
| --------------------------------- | ----------------------------- | ------- | ---------------------------------- | -------- |
| A                                 | 1,000 simultaneous insertions | 0       | 1                                  | 0        |
| B                                 | 23,697                        | 0       | 100                                | 0        |
| C                                 | 242,657                       | 0       | 500                                | 0        |
| C on two backends                 | 242,660                       | 0       | 500                                | 0        |
| D                                 | 11,944                        | 0       | 1 (100 clients)                    | 0        |
| E mixed                           | 152,894                       | 0       | 2,500                              | 0        |
| E active, pool 10                 | 1,027,523                     | 0       | 2,500                              | 0        |
| E active, pool 40                 | 668,633                       | 0       | 2,500                              | 0        |
| Backend restarts                  | 40,416                        | 0       |                                    |          |
| Database pause                    | 36,052                        | 0       |                                    |          |
| Stand-alone generator, both hosts | 135,000 each                  | 0       |                                    |          |
| Soak                              | see section 22                |         |                                    |          |

Zero corrupted documents and zero lost acknowledged saves in every run. Edits that were never
acknowledged (5 and 2 at the end of the overloaded 5,000-editor steps) are not counted as saved by the
product either: the editor keeps showing them as unsaved.

## 22. Recovery test results

Runs `09-reliability` (two backends, Redis), `08-stress-storm`, scenario A. MEASURED.

| Test                                                                                           | Result                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend restart while 400 people type (each of two backends in turn: SIGTERM, 5 s down, start) | shutdown 0.10 and 0.13 s; healthy again 0.36 s after start; all 400 clients connected again; reconnect p50 5.5 to 5.7 s, p95 8.8 to 8.9 s, max 9.5 s; edits made meanwhile were saved 3.3 to 3.5 s later at the median (p95 7.5 s); 40,416 acknowledged edits checked, 0 missing |
| Database unavailable for 10 s while 400 people type                                            | nobody was disconnected; text kept reaching the other person (p50 0.6 ms, p99 1.4 ms); saving waited for the database (p95 7.1 s, max 10.1 s) and then completed; 36,052 checked, 0 missing                                                                                      |
| Reconnect storm: 1,000 connections cut at once                                                 | all 1,000 synced again after 1.5 s; reconnect p50 0.86 s, p95 1.47 s                                                                                                                                                                                                             |
| Interrupted client                                                                             | catches up after reconnecting (291 ms in A; p50 317 ms, p95 408 ms across the profile drops in C)                                                                                                                                                                                |
| Pending saves across a restart or an outage                                                    | delivered after reconnection, acknowledged, found in the export                                                                                                                                                                                                                  |
| Conflicting edits                                                                              | 1,000 simultaneous insertions into one paragraph merged without loss (A)                                                                                                                                                                                                         |
| Revoked link                                                                                   | 200 sockets of 50 revoked links closed within 133 ms (p50 105 ms), also when the revocation went through the other backend                                                                                                                                                       |
| Expired link                                                                                   | 100 guests disconnected within 102 ms of the expiry; a new exchange answered 410                                                                                                                                                                                                 |
| Stale updates from an older document generation (after a restore)                              | NOT TESTED here; covered by the integration suite (`apps/server/test/integration/snapshots.test.ts`)                                                                                                                                                                             |
| Restart of the machines                                                                        | not done, by instruction                                                                                                                                                                                                                                                         |

**Soak** (run `14-soak-30min`, the 1,000-editor workload for 30 minutes): MEASURED.

| Minutes  | Edit to visible, ms: p50 / p95 / p99 | Edit to saved, ms: p50 / p95 / p99 | Backend memory at the end of the window | Heap (peak) | Requests waiting for a database connection (peak) | Connected |
| -------- | ------------------------------------ | ---------------------------------- | --------------------------------------- | ----------- | ------------------------------------------------- | --------- |
| 0 to 5   | 0.5 / 1.4 / 3.4                      | 3.5 / 5.3 / 9.9                    | 492 MB                                  | 353 MB      | 9                                                 | 1,000     |
| 5 to 10  | 0.6 / 1.5 / 3.0                      | 3.5 / 5.4 / 9.0                    | 495 MB                                  | 387 MB      | 0                                                 | 1,000     |
| 10 to 15 | 0.6 / 1.6 / 3.1                      | 3.8 / 6.7 / 10.7                   | 515 MB                                  | 268 MB      | 0                                                 | 1,000     |
| 15 to 20 | 0.6 / 1.7 / 2.9                      | 5.7 / 8.9 / 25.8                   | 530 MB                                  | 300 MB      | 7                                                 | 1,000     |
| 20 to 25 | 0.7 / 1.8 / 3.1                      | 5.7 / 8.7 / 24.3                   | 567 MB                                  | 312 MB      | 26                                                | 1,000     |
| 25 to 30 | 0.7 / 1.9 / 3.5                      | 5.8 / 9.1 / 24.7                   | 585 MB                                  | 336 MB      | 18                                                | 1,000     |

- 1,000 of 1,000 connections at the first attempt and 1,000 connected in every window; the watchdog
  stayed quiet; backend 50 % of one core on average, PostgreSQL 106 %; 1,056 commits/s throughout.
- 1,378,271 acknowledged edits checked after the run, 0 missing; 500 of 500 documents identical.
- Trends over the 30 minutes: saving became slower by about 2 ms at the median (3.5 to 5.8 ms) and its
  p99 rose from 10 to 25 ms; delivery p95 rose from 1.4 to 1.9 ms; backend memory rose by 93 MB (about
  3 MB per minute) while the heap went up and down with garbage collection. Every document grew during
  the run from empty to about 2,750 edits, and about 3.4 million rows were inserted into the update and history tables, so growth
  of the data and a leak cannot be told apart from this run. No pool exhaustion, no growing queue, no
  rising event-loop delay (22 ms, the sampler's floor, in every window).
- 30 minutes is not a long soak. Hours or days: NOT TESTED.

The slow part of recovery is the client: after a backend goes away the editor waits with a growing
backoff before it tries again, so a restart that takes 0.4 s costs the people on that backend 5 to 9 s.

## 23. Identified bottlenecks

Ranked by what was measured.

### HIGH: the database bounds active editing

- **Root cause.** Every acknowledged burst of typing is one PostgreSQL commit (row lock, update row,
  history rows). Commits cost about one database core per 1,000 per second, and the backend holds 10
  connections by default.
- **Evidence.** Section 14: PostgreSQL at its 4-CPU limit from 4,000 editors; 572 requests waiting for
  a connection; saving p95 189 ms while delivery p95 stayed at 4 ms; commits per second falling at 5,000.
- **User impact.** Text still appears for others, but "Saved" lags; beyond the limit clients time out
  and reconnect.
- **Recommended fix.** Size PostgreSQL for the editing rate (about one core per 1,000 active editors on
  this hardware, to be re-measured on the production database), and set `DB_POOL_MAX` to 30-40 per
  backend when a backend is expected to carry more than about 1,500 editors.
- **Expected benefit.** MEASURED: saving p95 at 4,000 editors 189 ms with 10 connections, 73 ms with 40.
- **Regression risk.** More connections per backend multiply with the number of backends; the database's
  `max_connections` (100 by default) must cover them all.

### HIGH: reconnecting after a backend restart takes 5 to 9 seconds

- **Root cause.** The client's reconnect backoff, not the server (healthy 0.36 s after start).
- **Evidence.** Section 22; the same was found in `docs/load-test-report.md` (8.7 to 8.9 s at p95).
- **User impact.** Every deployment or instance replacement freezes saving for the people on that
  backend for several seconds; with autoscaling this happens whenever an instance is removed.
- **Recommended fix.** A faster first retry after a clean server shutdown (close code 4503), keeping the
  backoff for failures; draining with a notice before an instance is stopped. Not changed here: it is
  the editor's reconnect behaviour and needs its own browser tests.
- **Expected benefit.** ESTIMATED: reconnect near the 0.9 s seen in the reconnect storm.
- **Regression risk.** A thundering herd against a backend that is really down; the jitter must stay.

### MEDIUM: the events list of the version history scanned the workspace's audit log (fixed)

Section 24.

### MEDIUM: document search and the document list grow with the number of documents

- **Root cause.** Title search is a pattern match that no index serves; the list returns up to 500
  documents per request.
- **Evidence.** Section 16: search 12.7 ms per query in the database and p95 69 ms at 16 concurrent
  requests with 32,444 documents; list p50 36 ms.
- **User impact.** Noticeable only for workspaces with tens of thousands of documents.
- **Recommended fix.** A trigram index (`pg_trgm`) on the title, and pagination of the list. Not done:
  the extension needs a decision about database privileges, and pagination changes the API contract.
- **Expected benefit.** Search time independent of the number of documents (not measured).
- **Regression risk.** Low for the index; the pagination touches the web app.

### LOW: one backend is one core

- **Evidence.** 46 % of a core at 1,000 editors, 65 to 75 % at 3,000 to 4,000; two backends shared the
  1,000-editor workload at 29 % each.
- **Impact and fix.** Beyond a few thousand editors, or for redundancy, several backends are needed, and
  that requires the cluster mode with Redis (section 27 explains why instances alone are not enough).

### LOW: every API request looks the session up in the database

- **Evidence.** In the API benchmark the session and account lookups and the "last seen" update were
  the most frequent statements (about 626,000 and 487,000 calls); the pool of 10 had up to 20 waiters.
- **Fix.** None needed at the measured rates (8,573 session checks per second on one backend); a short
  cache would trade a little revocation delay for it. Not recommended now.

Not found: lock contention, deadlocks, memory growth during the runs made, excessive presence traffic
(presence is batched), blocking of the event loop by Yjs work up to 4,000 editors.

Profiling with a CPU profiler or heap snapshots: NOT TESTED. The measurements above already located the
first limit outside the Node.js process (the database), so the time went into measuring that.

## 24. Optimizations performed

One change to the product, because the measurement was unambiguous and the change is additive.

**Events list of the version history** (`listDocumentEvents`, `apps/server/src/history/service.ts`).
The query selected audit events "whose target is the document, or whose details name the document",
newest first. No index could serve that condition, so PostgreSQL walked the whole audit log of the
workspace for every request: 11.7 ms per call with about 70,000 audit rows, growing with the age of the
workspace rather than with the document.

- Migration `apps/server/migrations/0005_audit_document_indexes.sql`: two partial indexes on
  `audit_events` (by target, and by the document named in the details). Additive; no column, constraint
  or row changes.
- The query became two indexed lookups joined with `UNION` (which also removes an event that matches
  both), with the same ordering and limit.
- Regression test in `apps/server/test/integration/history.test.ts`: events of both kinds are listed,
  each once, in the database's order, another document's events are not, and both indexes exist.
- Suites after the change: see section 25.

**Configuration, not code:** `DB_POOL_MAX` 40 instead of 10 for a backend that carries thousands of
editors (section 14). The default was left as it is: it is right for the current single small
deployment, and a larger pool must be matched to the database's connection limit.

Nothing else was changed. In particular the reconnect backoff, the search and the list were left alone
for the reasons given in section 23.

## 25. Before-and-after comparisons

MEASURED, same workload and stack, runs `06-api-large` (before) and `13-api-after-index` (after).

| Measure                                                                           | Before                 | After                  |
| --------------------------------------------------------------------------------- | ---------------------- | ---------------------- |
| `GET /api/documents/:id/history`, successful requests per second at 16 concurrent | 420                    | 1,345                  |
| Its latency, ms: p50 / p95 / p99                                                  | 31.0 / 63.5 / 69.5     | 11.4 / 14.8 / 17.3     |
| The events statement in PostgreSQL, mean per call                                 | 11.69 ms (8,417 calls) | 0.29 ms (26,918 calls) |
| Audit rows in the workspace at the time                                           | about 70,000           | about 70,000           |
| Control: document search, p50 / p95                                               | 25.2 / 68.7            | 25.1 / 68.8            |
| Control: document list, p50 / p95                                                 | 35.8 / 43.1            | 35.8 / 42.9            |
| Control: JSON export, p50 / p95                                                   | 44.7 / 61.9            | 44.9 / 63.5            |

The endpoints that were not changed measured the same in both runs, so the difference is the change.
Suites after the change: format and lint clean, type check clean, unit tests 1,981 passed, the history
integration tests 7 of 7 passed. The full integration suite: 226 of 226 passed on a
quiet host. In the run made directly before, two tests of the cluster suite failed on timing (a
hand-over took 10.2 s against a 5 s limit, and the Redis-outage test); they do not touch the changed
code and passed in the rerun.

Configuration comparison (section 14), MEASURED: 4,000 active editors, saving p95 188.7 ms and p99
262.1 ms with 10 pooled connections; 72.9 ms and 122.3 ms with 40.

Topology comparison, MEASURED, the 1,000-editor workload:

| Topology                                                                            | Edit to visible, ms: p50 / p95 / p99 | Edit to saved, ms: p50 / p95 / p99 | Backend CPU | Notes                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------- | ----------- | --------------------------------------------------- |
| A: one backend, generators on the same machine (profiles of scenario C)             | 0.5 / 1.4 / 3.8                      | 3.5 / 5.2 / 10.1                   | 46 %        | run `02-C`                                          |
| C: two backends and Redis on this machine (same profiles)                           | 0.5 / 1.1 / 1.7                      | 3.4 / 4.9 / 6.6                    | 29 % each   | run `10-C-two-backends`                             |
| A with the stand-alone generator on this machine (1 edit/s per person)              | 0.50 / 1.24 / 2.65                   | 3.50 / 5.14 / 17.2                 | 40 %        | run `11-gen-local`; worst of 6 generator processes  |
| B: backend here, generator on the second Spark over the 0.5 ms link (same workload) | 0.76 / 1.53 / 7.52                   | 3.72 / 5.50 / 26.3                 | 38 %        | run `12-gen-spark2`; worst of 6 generator processes |

- Moving the generator to the second machine added about 0.25 ms at the median, which is the link's
  round trip, and did not lower the backend's CPU use: at 1,000 editors the generators were not
  competing with the backend. 1,000 of 1,000 connections succeeded and 135,000 acknowledged edits were
  found on the server in both runs.
- On the second machine the six generator processes used 7 % of a core and 130 MB each; they were
  removed afterwards together with their directory.
- Network use on the link during run B: NOT MEASURED separately (the per-process figures above are the
  record).
- D (backends on both machines): NOT TESTED. It would have meant running the product's server and
  Redis traffic on the second, shared machine; the rules for this test allowed that machine as a load
  generator only.

## 26. AWS EC2 recommendations

Measured inputs for the recommendation (this hardware, not AWS):

| Input                                     | Value                                                                                                                                                                        | Label                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Backend CPU per active editor             | 0.046 % of one core (46 % at 1,000)                                                                                                                                          | MEASURED                                        |
| Backend memory                            | about 300 MB idle, 550 MB at 1,000 editors, 915 MB at 3,000, 667 MB at 5,000 connected of whom 1,000 edit                                                                    | MEASURED                                        |
| One backend process, clean                | 3,000 active editors, or 5,000 connected in the mixed profile                                                                                                                | MEASURED                                        |
| PostgreSQL                                | about one core per 1,000 active editors (1,059 commits/s); 4 cores were the limit at 4,000                                                                                   | MEASURED / ESTIMATED                            |
| Database connections per backend          | 10 by default; 40 measured better above 1,500 editors                                                                                                                        | MEASURED                                        |
| Several backends                          | need `REDIS_URL` (document ownership, tickets, rate limits) and a secret shared by the backends; a document is served by exactly one backend, the others forward its sockets | from the source, and MEASURED with two backends |
| A backend uses one core for collaboration | more vCPUs per instance do not raise one backend's limit                                                                                                                     | from the source                                 |

### Recommendation

Prices are AWS On-Demand, Linux, Mumbai (ap-south-1), read from the AWS Price List on 2026-11-14
(VERIFIED on that date); everything about how the application will behave on these instances is
ESTIMATED from the measurements above, because nothing was run on AWS.

| Instance       | vCPU / GiB | USD per hour | Kind                              | Assessment                                                                                                  |
| -------------- | ---------- | ------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| t2.large       | 2 / 8      | 0.0992       | burstable, old generation         | Not recommended: dearer than t3.large, low network performance.                                             |
| t3.large       | 2 / 8      | 0.0896       | burstable x86, baseline 30 %/vCPU | Works for the tested load, but costs twice the ARM equivalent.                                              |
| t3a.large      | 2 / 8      | 0.0493       | burstable x86 (AMD)               | The cheapest x86 choice if ARM is ruled out.                                                                |
| t3.xlarge      | 4 / 16     | 0.1792       | burstable x86                     | No benefit: one backend process uses one core for collaboration, the extra vCPUs stay idle.                 |
| **t4g.large**  | 2 / 8      | 0.0448       | burstable ARM, baseline 30 %/vCPU | **Lowest cost that fits the tested workload**, as long as the 24-hour average CPU stays under the baseline. |
| **m7g.large**  | 2 / 8      | 0.0583       | fixed performance ARM             | **Recommended for production**: no credit accounting, full cores, 30 % dearer than t4g.large.               |
| m8g.large      | 2 / 8      | 0.06416      | fixed performance ARM, newer      | Alternative to m7g.large; faster cores, 10 % dearer.                                                        |
| m7i-flex.large | 2 / 8      | 0.10075      | x86                               | x86 alternative to m7g.large at 1.7 times the price.                                                        |
| m7i.large      | 2 / 8      | 0.10605      | fixed performance x86             | Only if x86 and guaranteed full performance are both required.                                              |
| m7i.xlarge     | 4 / 16     | 0.2121       | fixed performance x86             | Not needed: see t3.xlarge.                                                                                  |
| m7i.2xlarge    | 8 / 32     | 0.4242       | fixed performance x86             | Not needed.                                                                                                 |

Why these conclusions:

- **Two vCPUs and 8 GiB per backend are enough.** MEASURED here: one backend process used 46 % of one
  core and 550 MB for 1,000 active editors and 915 MB for 3,000. Collaboration work runs on one thread,
  so a larger instance does not raise the limit of one backend; more instances do.
- **ARM is compatible.** The application was built, tested and deployed on an ARM (aarch64) machine
  throughout this project, including its Docker image. Graviton instances therefore need no porting.
  An AWS vCPU on Graviton is a full core; on x86 it is one hyper-thread, which is one more reason the
  ARM types are the better value. How a Graviton core compares with the Cortex-X925/A725 cores of the
  DGX Spark is NOT TESTED; the estimates below assume an AWS core does between half and all of the work
  of a core of this machine.
- **Burstable instances fit the tested load, with a condition.** ESTIMATED: with four backends, 1,000
  active editors are 250 per backend, about 12 to 25 % of one vCPU, well under the t4g.large baseline
  (30 % per vCPU). At 3,000 active editors in total (750 per backend, an estimated 35 to 70 % of one
  vCPU) a backend runs near or above the baseline and pays for surplus credits (0.04 USD per vCPU-hour
  on T4g, 0.05 on T3). A burstable instance that has spent its credits in standard mode slows down,
  which a collaboration backend shows as latency. For that reason the production recommendation is the
  fixed-performance m7g.large, and t4g.large (in unlimited mode) is the cost-minimal variant.
- **The backends are not the limit; the database is.** MEASURED: PostgreSQL used about one core per
  1,000 active editors and was the first component to queue (between 3,000 and 4,000 editors with four
  database cores). The database was in memory on this machine; on RDS every commit waits for network
  storage, which this test did not measure.

| Component                           | Recommendation                                                                                                              | Label             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Backend instance                    | m7g.large (production) or t4g.large unlimited (lowest cost)                                                                 | ESTIMATED         |
| Backends                            | minimum 4, desired 4, maximum 12, as planned. For capacity alone two would carry 1,000 active editors; four give two per AZ | ESTIMATED         |
| Capacity planning figure            | 1,000 to 1,500 active editors per backend (a third to a half of the limit measured here), 4,000 to 6,000 for four backends  | ESTIMATED         |
| Database                            | RDS PostgreSQL 17, Multi-AZ, db.m7g.large up to about 1,000 active editors, db.m7g.xlarge above; `DB_POOL_MAX` 20 to 40     | ESTIMATED         |
| Coordination                        | ElastiCache (Valkey or Redis OSS), two small nodes: required as soon as there is more than one backend                      | from the source   |
| Uploaded files and desktop releases | shared storage for `ASSET_DIR` and `DOWNLOAD_DIR` (Amazon EFS): the application has no S3 adapter                           | from the source   |
| Frontend                            | the backend already serves the built web app; Nginx on the same instances can serve it, no separate fleet is needed         | from the source   |
| Load balancer                       | one Application Load Balancer, idle timeout raised from the default 60 s                                                    | AWS documentation |

**What still has to be tested on AWS** before these numbers are relied on: the per-core speed of the
chosen instance type against this machine; commit latency on RDS with gp3 storage and Multi-AZ; the load
balancer with long-lived WebSockets (idle timeout, connection draining); forwarding between backends in
different Availability Zones; EFS latency for uploads; credit behaviour of burstable instances under a
day-long profile; and the reconnect time after an instance is replaced.

## 27. AWS autoscaling architecture

Measured facts the design must respect:

- A document is owned by one backend; a socket that arrives at another backend is forwarded to the
  owner. Adding instances spreads documents, it does not split one document.
- Removing or restarting a backend costs its users 5 to 9 s of reconnecting today (section 22).
- Collaboration connections are long-lived: a new instance receives new connections only.
- Readiness: `/api/ready` reports database, Redis and draining; `SHUTDOWN_DRAIN_SECONDS` exists.

### Design

```text
Route 53 ─▶ Application Load Balancer (HTTPS, WebSocket) ─▶ Auto Scaling group, 4 to 12 backends in 2+ AZs
                                                             │  each: Nginx + Node.js backend (one process)
                                                             ├─▶ ElastiCache (document ownership, tickets, rate limits, control channel)
                                                             ├─▶ RDS PostgreSQL Multi-AZ (documents, history, accounts)
                                                             └─▶ EFS (uploaded files, desktop releases)
```

**Why more instances alone do not solve a shared document.** A document's edits must pass through one
ordered log. In this application exactly one backend owns a document at a time (a lease in Redis); a
connection that reaches another backend is forwarded to the owner. Adding backends therefore spreads
_documents_ over machines; it does not divide the work of one document. One hundred people in one
document are served by one backend however many exist (MEASURED: 100 editors in one document used 13 %
of a core, so this is not a practical limit yet). Without the coordination service, two backends would
each accept edits for the same document and the copies would diverge; the application refuses to run
that way without `REDIS_URL`.

**Routing.** The load balancer cannot see which document a WebSocket belongs to, and it does not have
to: the application routes by document itself. Round robin (or least outstanding requests) is correct.
Sticky sessions add nothing for WebSockets, which stay on their target once open. A document-aware
proxy (hashing the document id in Nginx so that most connections reach the owner directly) would save
the forwarding hop; it is an optimisation to consider only if forwarding shows up in measurements.

**Scaling policies** (all thresholds ESTIMATED from this machine and to be tuned on AWS):

| Signal                                                   | Use                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Average CPU of the group                                 | Target tracking at 50 %. Use 1-minute detailed monitoring.                                                                                                   |
| Active WebSocket connections per backend (custom metric) | Target tracking at about 1,500 per backend, published from the backend's `/metrics` to CloudWatch. This is the signal that moves first.                      |
| Save latency (edit to saved, p95) and event-loop delay   | Alarms, not scaling targets: above 100 ms saved p95 or a rising event-loop delay means a backend or the database is saturated; scale out and look at the DB. |
| Memory                                                   | Alarm at 75 % (needs the CloudWatch agent). MEASURED memory was far from 8 GiB, so memory should not drive scaling.                                          |
| Backend health                                           | Load balancer health check on `/api/ready` (database, Redis and draining state).                                                                             |
| Database CPU, connections, commit latency                | Alarms on RDS. The Auto Scaling group cannot fix a saturated database: the remedy is a larger database class or a larger pool, which is a planned change.    |

**Scale-in is the dangerous direction.** A backend that is removed drops its connections, and MEASURED
here a client needs 5.5 s (median) to 8.8 s (p95) to be back. So: scale in slowly (one instance at a
time, long cooldown), prefer scheduled scaling to the office day over reactive scale-in, set the target
group's deregistration delay (default 300 s) together with the backend's `SHUTDOWN_DRAIN_SECONDS`, and
use a termination lifecycle hook so that the backend is told to drain before it is stopped. New
instances receive only new connections, so scaling out relieves a hot backend only as people reconnect
or open documents.

**Load balancer settings.** The idle timeout defaults to 60 s and is reset only by data, not by HTTP/2
pings; set it to a few minutes and keep the application's own WebSocket heartbeat shorter than it
(the heartbeat interval was not measured against a load balancer: NOT TESTED).

## 28. Estimated AWS costs in INR

All prices VERIFIED from the AWS Price List for ap-south-1 on 2026-11-14 (On-Demand, Linux, no
commitment). Converted at 1 USD = 94.25 INR (ECB-derived reference rate of 2026-11-13; a Reserve Bank of
India rate was not retrieved). 730 hours per month. Usage quantities are ESTIMATED assumptions and are
stated in the table. Totals are therefore ESTIMATED.

| Item                                  | Quantity assumed                              | USD per month | INR per month |
| ------------------------------------- | --------------------------------------------- | ------------- | ------------- |
| Backends, m7g.large                   | 4 × 0.0583 USD/h                              | 170.24        | 16,045        |
| Application Load Balancer             | 1 × 0.0239 USD/h + 2 LCU × 0.008 USD/h        | 29.13         | 2,745         |
| RDS PostgreSQL db.m7g.large, Multi-AZ | 0.479 USD/h                                   | 349.67        | 32,956        |
| RDS storage, gp3, Multi-AZ            | 100 GB × 0.262 USD                            | 26.20         | 2,469         |
| ElastiCache Valkey cache.t4g.small    | 2 nodes × 0.0328 USD/h                        | 47.89         | 4,513         |
| EBS gp3 for the backends              | 4 × 30 GB × 0.0912 USD                        | 10.94         | 1,031         |
| NAT gateway (hourly charge only)      | 1 × 0.056 USD/h                               | 40.88         | 3,853         |
| Data transfer out to the internet     | 200 GB × 0.1093 USD (volume is an assumption) | 21.86         | 2,060         |
| **Total, recommended baseline**       |                                               | **696.81**    | **≈ 65,700**  |

| Variant                                                         | USD per month | INR per month    |
| --------------------------------------------------------------- | ------------- | ---------------- |
| Lowest cost: t4g.large instead of m7g.large (4 × 0.0448 USD/h)  | 657.39        | ≈ 62,000         |
| Baseline with the larger database (db.m7g.xlarge Multi-AZ)      | 1,046.48      | ≈ 98,600         |
| Larger database and all 12 backends running for the whole month | 1,386.95      | ≈ 130,700        |
| x86 instead of ARM for the four backends: t3.large / m7i.large  | +91 / +139    | +8,600 / +13,100 |

A 1-year Compute Savings Plan without upfront payment lowers the EC2 part by about 26 to 28 %
(computed from the Savings Plan price list; RDS and ElastiCache have their own reservation schemes, not
priced here).

**Not included:** Amazon EFS for uploaded files (not priced here), backups and snapshots beyond the
free allowance, CloudWatch metrics, logs and alarms, Route 53, certificates, WAF, NAT data processing
(the per-GB rate for a zonal NAT gateway could not be verified), traffic between Availability Zones,
surplus CPU credits on burstable instances, AWS support plans, and taxes (GST). The free monthly
allowance for data transfer out could not be verified and is not deducted. The load balancer's capacity
units assume about 5,000 open connections and little traffic; collaboration traffic was small in the
tests, but its volume on the internet was not measured.

## 29. Remaining risks

- **Real networks and browsers were not part of the test.** All latencies are loopback or a 0.5 ms
  link; the editor's own work in a browser with many carets was not measured.
- **The generators shared the machine with the system under test** in all but one run, and the machine
  also served other people's workloads. Numbers at the top steps are therefore conservative for the
  backend and unknown in precision.
- **The database of the test is small and in memory.** Disk latency, checkpoints on network storage,
  backups and a large history table were not exercised. `doc_history` grows with every edit; its
  long-term size and the cost of retention were not measured.
- **Soak length.** 30 minutes, not hours or days (section 22).
- **Two backends were tested on one machine only**, and with a simple round-robin proxy. A real load
  balancer, cross-machine forwarding and a Redis failure under this framework were not tested (a Redis
  restart was tested earlier in `docs/load-test-report.md`).
- **Not tested at all:** 10,000 connections; more than 100 people in one document; documents above
  5 MiB (the product's soft limit for a document's state is 8 MiB, so 20 MB is not a supported size);
  uploads under concurrency beyond the per-session limit; the desktop app.
- **Reconnect time** after a restart is a known weakness that autoscaling will make visible.
- **Guest sessions were used for the simulated users.** Account users take the same collaboration path
  after the ticket; the account-specific offline queue of the browser was not exercised.

## 30. Production-readiness verdict

Inputs, all MEASURED on this machine: one backend with the default settings carried 1,000 active editors
at a third of its limit, with no loss and no divergence, and survived restarts, a database outage and a
reconnect storm without losing an acknowledged edit. The first limit is the database, at about 3,000 to
4,000 active editors per backend. What is not established is listed in section 29: real networks,
browsers, AWS hardware, long duration.

### Verdict

**For the stated target of 1,000 active users: ready, with conditions.**

MEASURED and passed on this machine: 1,000 active editors at about a third of one backend's limit;
100 people in one document; 5,000 connected people in a mixed profile; no acknowledged edit lost and no
document diverged in about 2.6 million checked edits; recovery from a backend restart, a database
outage and a reconnect storm; a 30-minute soak without failure.

Conditions before calling it production-ready on AWS:

1. **Repeat the key scenarios on the AWS architecture** (C, the active-editor ramp, the restart test):
   the instance cores, RDS on network storage, the load balancer and cross-AZ forwarding were NOT
   TESTED. The database was in memory here, which flatters commit latency.
2. **Run with several backends for real.** Two backends were MEASURED on one machine only. Redis is
   then a required component, and uploaded files need shared storage.
3. **Shorten the reconnect after a restart** (5.5 s median, 8.8 s p95, MEASURED). Every deployment and
   every scale-in shows this to users.
4. **Run a soak of hours, not 30 minutes,** watching memory (the backend grew by 93 MB in 30 minutes;
   whether that levels off is not known) and the growth of the history table.
5. **Apply migration 0005** (the history events indexes) through the normal upgrade procedure; it is in
   the working tree and not on the live site.
6. Real networks and real browsers were not part of this test: the latency objectives are met on
   loopback, and what users see will be their network's delay plus the few milliseconds measured here.

Not ready as it stands for: 10,000 connections (NOT TESTED), more than 100 people in one document (NOT
TESTED), or documents beyond the 8 MiB soft limit.

## Large documents (phase 7)

Run `06-api-large`. Sizes are the Yjs state of the document (`encodeStateAsUpdate`), not attached files:
images and attachments are separate files and do not travel through the document. MEASURED.

| Target  | Actual state    | Paragraphs | Time to write it (one client, saved in batches) | A fresh client opens it (5 runs), ms                                                                                                 | JSON export |
| ------- | --------------- | ---------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 5 KiB   | 5,358 bytes     | 24         | 0.07 s                                          | 25 to 37                                                                                                                             | 4.6 ms      |
| 100 KiB | 103,107 bytes   | 427        | 0.09 s                                          | 28 to 37                                                                                                                             | 8.7 ms      |
| 1 MiB   | 1,147,327 bytes | 1,102      | 0.13 s                                          | 48 to 63                                                                                                                             | 24.6 ms     |
| 5 MiB   | 5,328,347 bytes | 5,102      | 1.04 s                                          | 103 to 174                                                                                                                           | 111 ms      |
| 20 MB   |                 |            |                                                 | NOT TESTED: the product's limit for a document's state is 8 MiB (a soft limit that logs a warning), so 20 MB is not a supported size |             |

- Opening includes the ticket request, the WebSocket handshake, the sync and the `hello` proof.
- Backend memory rose by about 87 MB while the 5 MiB document was written and opened (809 to 896 MB;
  the process had just run the API benchmark, so the absolute figures are not a clean baseline).
- Typing latency inside a large document and the browser's responsiveness with it: NOT TESTED.
