# Performance framework

Scenarios for the capacity questions of `docs/REALDOCS_LOAD_TEST_REPORT.md`: how many people can edit at
once, with what latency, and what gives way first. It drives an isolated copy of the product with clients
that speak the real protocol; nothing here touches the live deployment.

## What it reuses

The building blocks come from the load harness in `tests/load` and are imported, not copied:

- `stack.ts`: the isolated stack (PostgreSQL container `rd-load-pg` on 127.0.0.1:15450, optional Redis
  `rd-load-redis` on 16450, backends as local processes on 127.0.0.1:4450 and up, a round-robin proxy on
  4459 that every client uses as its one origin);
- `client.ts`: a simulated user: share-link exchange (its own guest session), single-use collaboration
  ticket, Hocuspocus provider, the `hello` / `mark` / `saved` acknowledgement protocol, reconnect with a
  new ticket and capped backoff;
- `ctx.ts`, `metrics.ts`, `render.ts`: generator processes, the `/metrics` sampler, result tables;
- scenarios `s2b`, `s10`, `s12`, `s13`, `s14` (rate steps, backend restart, database pause, reconnect
  storm, revoked links), run from here as `rates`, `restart`, `dbpause`, `storm`, `access`.

New in this directory: seeded activity profiles (typing, deleting, formatting, cursor movement, pauses,
connection drops), the two-person scripted session, same-document convergence checks, the escalation with
user classes, the API benchmark, a host watchdog, per-process and PostgreSQL sampling (including
`pg_stat_statements` in the test container), and a stand-alone generator for a second machine.

## Commands

```bash
tests/performance/perf.sh A --rounds 100                 # two people, one document
tests/performance/perf.sh B                              # 100 documents x 2 active editors
tests/performance/perf.sh C                              # 500 documents x 2 active editors
tests/performance/perf.sh D                              # 2 ... 100 people in one document
tests/performance/perf.sh E --env COLLAB_MAX_CONNECTIONS=12000 --workers 10   # idle / viewing / active mix
tests/performance/perf.sh E --mix active --steps 200,500,1000,1500,2000,3000  # every user an active editor
tests/performance/perf.sh api
tests/performance/perf.sh large --sizes 5,100,1024,5120  # Yjs state size in KiB
tests/performance/perf.sh storm,rates
tests/performance/perf.sh restart,dbpause,access --topology C
tests/performance/perf.sh soak --minutes 30
```

`perf.sh` loads the pinned toolchain, stages the server bundle if needed (`tests/load/.stage/server`;
remove that directory after changing server code), raises the open-file limit of its own shell and runs
`src/run.ts` from `tests/load`, whose installed dependencies the generator uses. Each run starts a fresh
stack and removes it afterwards (`--keep` leaves it up, `--no-stack` uses one that is up).

Options: `--topology A|B|C` (A one backend with a pool of 10, B one backend with a pool of 40, C two
backends with Redis), `--instances N`, `--pool N`, `--workers N` (generator processes, default 8),
`--seed N`, `--out NAME`, `--env K=V` (a server setting of the test stack, repeatable), and per scenario
`--docs`, `--duration S`, `--ramp S`, `--steps a,b,c`, `--mix mixed|active`, `--sizes`, `--minutes`,
`--rounds`, `--concurrency`.

## Output

`docs/load-test-results/<run>/`: one `<scenario>.json` and `.md` per scenario, `summary.md`,
`environment.json` (host, limits, masked server settings), `system.json` (host, backend and PostgreSQL
samples every 5 s), `metrics.json` (the backend's `/metrics` series) and the warning and error lines of the
backend logs. Secrets of the test stack are masked in every saved file.

## Method

- **Latency.** An edit inserts a unique 8-character marker; the other client of the same document runs
  in the same generator process, so one clock measures "edit to visible in the other person's Y.Doc".
  "Edit to saved" is measured by the sender from the local transaction to the server's `saved`
  acknowledgement, which the server sends only after the update is committed to PostgreSQL. Everything
  runs over loopback (or the direct link between the two machines): it is not internet latency.
- **Profiles** (`src/profiles.json`): `light`, `normal`, `active`, `heavy`, `collab`. Each client draws
  its actions from a generator seeded with `--seed` and its own key, with exponential gaps between
  actions, so users neither act in step nor differ between runs with the same seed.
- **Durability.** After a run, every marker whose `saved` arrived is looked for in
  `GET /api/documents/:id/export?format=json`. An echo over the WebSocket is never counted as saved.
- **Convergence.** The clients of each document compare a hash of their content.
- **Stable.** A step counts as stable only when the edit-to-remote latency meets p50 <= 50 ms,
  p95 <= 100 ms, p99 <= 200 ms, at least 99.9 % of new connections succeed at the first attempt, nobody
  is disconnected at the end, nothing acknowledged is missing, no document diverged and the watchdog was
  quiet.
- **Limits raised for synthetic load.** Every client comes from one address, so the per-address limits
  are raised in the test stack (`RAISED_LIMITS` in `tests/load/src/stack.ts`) and
  `COLLAB_MAX_CONNECTIONS` is 5000 unless set. Per-account and per-session limits keep their defaults.

## Safety

- The stack binds to 127.0.0.1, uses its own database and asset directory, and only removes containers
  named `rd-load-*`. The PostgreSQL container is limited to 4 CPUs and 6 GiB
  (`RD_LOAD_PG_CPUS`, `RD_LOAD_PG_MEMORY`).
- The watchdog (`src/monitor.ts`) refuses to start, and stops a run, when the host's 1-minute load
  average exceeds 18, available memory falls below 10 GiB, or swap use grows by more than 2 GiB.

## Second machine as the generator

```bash
cd tests/load && node ../performance/src/bundle-remote.mjs /tmp/remote-gen.mjs   # one file, Node.js 18+
```

Start the stack with `--keep` and the allowed origin of the address the other machine will use, forward
that address to the proxy, copy `remote-gen.mjs` and a `docs.json` (document id, share id and secret per
document) to the other machine and run it there; it prints one JSON object. The report describes the run
that was made this way.
