## Reliability: database unavailable for a while (topology C) [ok]

Started 2026-11-14T07:29:57.611Z, ended 2026-11-14T07:31:47.997Z.

```json
{
 "docs": 100,
 "clients": 400,
 "typingRate": 1,
 "pauseS": 10
}
```

#### database paused for 10 s during typing (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 24028 | 0.6 | 1.1 | 1.4 | 17.7 | 0.7 |
| ack | 24029 | 3.5 | 7082.0 | 9499.5 | 10066.0 | 851.7 |

Client counters: edits=24027, save_error_storage_unavailable=1889, persistence_degraded=320, persistence_ok=320

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 13.1 | 17.7 | 416 | 167 | 204 | 76 | 51 | 10 / 10 | 42 (6.0) | 21.1 | 47,338 | 6.0 | 0 |
| :4451 | 13.9 | 17.9 | 323 | 160 | 196 | 80 | 49 | 10 / 10 | 48 (6.4) | 21.0 | 47,776 | 0.8 | 0 |

Server :4450 persist append: n=10,299 mean 31.2 ms, p95 <= 5.0 ms, p99 <= 25.0 ms; compact: n=51 mean 2.8 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 12,261; HTTP /api (server-side) n=0 mean n/a ms, p95 <= n/a ms; ws outcomes forwarded=0, accepted=0

Server :4451 persist append: n=9,906 mean 31.1 ms, p95 <= 5.0 ms, p99 <= 25.0 ms; compact: n=49 mean 3.0 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; yjs updates 11,774; HTTP /api (server-side) n=0 mean n/a ms, p95 <= n/a ms; ws outcomes forwarded=0, accepted=0

Generator (8 worker processes): CPU % per worker 3/2/3/3/2/3/2/2; event-loop lag p99 max 10.9 ms (max 14.6 ms); host load1 max 2.7

```json
{
 "pausedAt": "2026-11-14T07:30:52.797Z",
 "resumedAt": "2026-11-14T07:31:02.835Z"
}
```

### Results

```json
{
 "quiesce": {
  "ok": true,
  "unacked": 0,
  "waitedMs": 1
 },
 "verification": {
  "docs": 100,
  "checked": 36052,
  "missing": 0,
  "missingSamples": [],
  "unackedAtEnd": 0,
  "exportErrors": 0
 },
 "system": {
  "samples": 22,
  "host": {
   "load1Max": 3.4,
   "availableMbMin": 29242.8,
   "swapUsedMbMax": 17529.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 13.2,
    "cpuPctMax": 17.4,
    "rssMbMax": 416
   },
   "4451": {
    "cpuPctAvg": 13,
    "cpuPctMax": 18,
    "rssMbMax": 322.8
   }
  },
  "postgres": {
   "cpuPctAvg": 41.3,
   "cpuPctMax": 97.4,
   "memMbMax": 189.8,
   "commitsPerSecond": 404.6,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 603.1,
   "walMbPerSecond": 0.4,
   "blockReadMs": 0,
   "blockWriteMs": 78.4,
   "deadlocks": 0,
   "backendsMax": 21,
   "activeMax": 3,
   "waitingOnLocksMax": 0
  }
 },
 "systemWholeScenario": {
  "samples": 22,
  "host": {
   "load1Max": 3.4,
   "availableMbMin": 29242.8,
   "swapUsedMbMax": 17529.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 13.2,
    "cpuPctMax": 17.4,
    "rssMbMax": 416
   },
   "4451": {
    "cpuPctAvg": 13,
    "cpuPctMax": 18,
    "rssMbMax": 322.8
   }
  },
  "postgres": {
   "cpuPctAvg": 41.3,
   "cpuPctMax": 97.4,
   "memMbMax": 189.8,
   "commitsPerSecond": 404.6,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 603.1,
   "walMbPerSecond": 0.4,
   "blockReadMs": 0,
   "blockWriteMs": 78.4,
   "deadlocks": 0,
   "backendsMax": 21,
   "activeMax": 3,
   "waitingOnLocksMax": 0
  }
 }
}
```

### Notes

- Scenario s12 of tests/load/src/scenarios.ts, run by the performance framework.