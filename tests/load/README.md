# @realtimedocs/load - load-test harness

Builds an isolated stack and drives it with simulated users that behave like the real client: share-link
exchange, single-use collaboration ticket, Hocuspocus provider, the `mark`/`saved`/`hello` acknowledgement
protocol, reconnect with a new ticket and capped exponential backoff. Results of the runs made so far and
their interpretation: `docs/load-test-report.md`.

The capacity tests of 2026-11-14 (two people up to 5,000, activity profiles, API benchmark, second machine as
the generator) are in `tests/performance`, which imports this harness; their report is
`docs/REALDOCS_LOAD_TEST_REPORT.md`.

## What it starts (all bound to 127.0.0.1)

| Resource                            | Name / port                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| PostgreSQL 17.11                    | container `rd-load-pg`, 127.0.0.1:15450                                                    |
| Redis 8.8.3 (topology C)            | container `rd-load-redis`, 127.0.0.1:16450                                                 |
| Server instances                    | host processes from a private copy of the built bundle (`.stage/server`), ports 4450, 4451 |
| Round-robin proxy ("load balancer") | 127.0.0.1:4459 (control 4458: `/drop`, `/stats`) - every client uses this one origin       |

It never touches the production Compose project, never creates a root `.env` and only removes containers named `rd-load-*`.

Topologies: `A` one instance, `DB_POOL_MAX` 10 (default); `B` one instance, `DB_POOL_MAX` 40; `C` two instances + Redis, pool 10 each.

## Commands

```bash
. scripts/dev-env.sh
cd tests/load
node --import tsx src/stack.ts stage                      # build apps/server and copy the bundle to .stage/server
node --import tsx src/run.ts s2 --topology A              # fresh stack, run, results, tear down
node --import tsx src/run.ts s1,s2,s3 --topology C --out my-run
node --import tsx src/run.ts s13 --topology A --env RATE_WS_UPGRADE_PER_MINUTE=120 --env RATE_API_PER_MINUTE=1200 --ramp 660
node --import tsx src/stack.ts up --topology C | status | down   # manual stack (run.ts then needs --no-stack)
./suite.sh phase1                                          # the sequence used for the report (see suite.sh)
```

Flags: `--workers N` (generator processes, default 8), `--docs`, `--per-doc`, `--duration S`, `--rate edits/s per client`,
`--ramp S`, `--hold S`, `--keep` (leave the stack up), `--env K=V` (extra server settings, repeatable), scenario specific
ones (`--editors 10,25,50`, `--rates 1,2,3`, `--sizes 1,5,20`, `--minutes 60`, `--variant lb|restart`, `--keys N`).

Scenarios: `s1` connect-1000, `s2` 250x4 typing, `s2b` rate steps, `s3` 100x10 typing, `s4` hot document, `s5` paste,
`s6` presence, `s7` uploads, `s8` session API, `s9` history reads, `s10` rolling restart, `s11` Redis restart,
`s12` database pause, `s13` reconnect storm, `s14` revoked/expired links, `s15` large documents, `s16` soak.

## Output

`results/<name>/` holds one `<scenario>.json` and `.md` per scenario, `summary.md`, `metrics.json` (server time series,
5 s resolution), `environment.json` (host, masked server settings) and the warning/error lines of the server logs.
Server settings are masked in saved files; the real secrets live only in `.stage/` (mode 600, git-ignored).

## Method notes

- Latency: each edit inserts an 8-character marker into the client's own paragraph; sampled receivers of the same
  document run in the same worker process, so one clock (`performance.timeOrigin + performance.now()`) measures
  edit -> remote apply. Edit -> `saved` is measured by the sender. Connect time is ticket request -> synced + hello acknowledged.
- Per-IP limits are raised (everything comes from 127.0.0.1); per-session, per-email and per-key limits stay at their defaults
  unless a scenario says otherwise. See `RAISED_LIMITS` in `src/stack.ts`.
- Zero-loss check: every marker whose `saved` was received is looked for in `GET /api/documents/:id/export?format=json`.
- The harness samples host load average and stops a scenario early when it stays above 18 for over a minute.
