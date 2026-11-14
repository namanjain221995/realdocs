## Stress: reconnect storm (topology A) [ok]

Started 2026-11-14T07:36:02.981Z, ended 2026-11-14T07:37:14.993Z.

```json
{
 "docs": 250,
 "clients": 1000,
 "rampS": 60,
 "variant": "lb",
 "serverEnvOverrides": {},
 "typingDuringStorm": false
}
```

#### initial connect (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ticketMs | 1000 | 2.9 | 4.2 | 5.6 | 21.6 | 3.0 |
| connect | 1000 | 29.5 | 41.4 | 50.0 | 109.0 | 31.1 |

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 11.6 | 15.4 | 329 | 167 | 1,000 | 0 | 250 | 10 / 10 | 0 (0.0) | 21.3 | 72 | 0.0 | 0 |

Server :4450 persist append: n=935 mean 2.9 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 935; HTTP /api (server-side) n=1,870 mean 4.0 ms, p95 <= 25.0 ms; ws outcomes accepted=935

Generator (8 worker processes): CPU % per worker 2/2/2/2/2/2/2/2; event-loop lag p99 max 10.8 ms (max 33.8 ms); host load1 max 2.1

```json
{
 "readyAfterInitial": 1000,
 "total": 1000
}
```

#### storm and recovery (2 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ticketMs | 1000 | 218.3 | 1010.7 | 1092.6 | 1106.3 | 257.9 |
| reconnect | 1000 | 856.5 | 1466.5 | 1498.8 | 1512.1 | 869.2 |

Client counters: reconnects=1000

WebSocket close codes seen: 1006=1000

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 80.4 | 80.4 | 358 | 167 | 1,000 | 0 | 250 | 10 / 10 | 0 (0.0) | 26.0 | 0 | 0.0 | 0 |

Server :4450 persist append: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; compact: n=250 mean 35.7 ms, p95 <= 100.0 ms, p99 <= 100.0 ms; yjs updates 0; HTTP /api (server-side) n=1,000 mean 118.9 ms, p95 <= 250.0 ms; ws outcomes accepted=1000

Generator (8 worker processes): CPU % per worker 25/26/25/27/27/24/27/25; event-loop lag p99 max 11.5 ms (max 12.1 ms); host load1 max 1.7

```json
{
 "timeTo99PctSyncedMs": 1505,
 "timeToAllSyncedMs": 1505,
 "readyAtEnd": 1000,
 "total": 1000
}
```

### Results

```json
{
 "storm": {
  "timeTo99PctSyncedMs": 1505,
  "timeToAllSyncedMs": 1505,
  "total": 1000
 },
 "system": {
  "samples": 14,
  "host": {
   "load1Max": 2.1,
   "availableMbMin": 29936,
   "swapUsedMbMax": 17529.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 10,
    "cpuPctMax": 13.8,
    "rssMbMax": 329.3
   }
  },
  "postgres": {
   "cpuPctAvg": 19.9,
   "cpuPctMax": 132.7,
   "memMbMax": 70.6,
   "commitsPerSecond": 335.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 68.1,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0.5,
   "blockWriteMs": 8.2,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 0,
   "waitingOnLocksMax": 0
  }
 },
 "systemWholeScenario": {
  "samples": 14,
  "host": {
   "load1Max": 2.1,
   "availableMbMin": 29936,
   "swapUsedMbMax": 17529.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 10,
    "cpuPctMax": 13.8,
    "rssMbMax": 329.3
   }
  },
  "postgres": {
   "cpuPctAvg": 19.9,
   "cpuPctMax": 132.7,
   "memMbMax": 70.6,
   "commitsPerSecond": 335.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 68.1,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0.5,
   "blockWriteMs": 8.2,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 0,
   "waitingOnLocksMax": 0
  }
 }
}
```

### Notes

- Scenario s13 of tests/load/src/scenarios.ts, run by the performance framework.