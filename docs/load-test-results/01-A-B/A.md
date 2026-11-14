## A. Two people editing one document (topology A) [ok]

Started 2026-11-14T05:51:35.743Z, ended 2026-11-14T05:51:55.639Z.

```json
{
 "documents": 1,
 "users": 2,
 "rounds": 100,
 "workers": "one process, one clock"
}
```

#### pair session (18 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ticketMs | 3 | 6.1 | 9.1 | 9.1 | 9.1 | 6.6 |
| connect | 2 | 37.8 | 95.3 | 95.3 | 95.3 | 66.5 |
| reconnect | 1 | 288.4 | 288.4 | 288.4 | 288.4 | 288.4 |

Client counters: drops=1, reconnects=1

WebSocket close codes seen: 1005=1

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 8.4 | 12.4 | 301 | 150 | 2 | 0 | 1 | 3 / 10 | 0 (0.0) | 21.3 | 31 | 0.0 | 0 |

Server :4450 persist append: n=1,252 mean 2.6 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=1 mean 9.2 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 1,514; HTTP /api (server-side) n=1 mean 4.1 ms, p95 <= 5.0 ms; ws outcomes accepted=1

Generator (8 worker processes): CPU % per worker 26/0/0/0/0/0/0/0; event-loop lag p99 max 11.0 ms (max 300.9 ms); host load1 max 3.0

```json
{
 "firstAttempt": {
  "ok": 2
 },
 "system": {
  "samples": 3,
  "host": {
   "load1Max": 2.8,
   "availableMbMin": 30321.5,
   "swapUsedMbMax": 17515.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 9.6,
    "cpuPctMax": 11.2,
    "rssMbMax": 300.8
   }
  },
  "postgres": {
   "cpuPctAvg": 15.5,
   "cpuPctMax": 23.1,
   "memMbMax": 39.9,
   "commitsPerSecond": 84.2,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 187.2,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0.7,
   "blockWriteMs": 3.6,
   "deadlocks": 0,
   "backendsMax": 4,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 }
}
```

### Results

```json
{
 "operationLatencyMs": {
  "typing:remote": {
   "n": 400,
   "min": 0.23393899999973655,
   "p50": 0.794025999999576,
   "p95": 1.2743839999998272,
   "p99": 1.571299000000181,
   "mean": 0.8127365224999943,
   "max": 3.0562459999998737
  },
  "typing:ack": {
   "n": 400,
   "min": 1.7494290000004185,
   "p50": 3.243271999999706,
   "p95": 4.419575000000805,
   "p99": 5.25339299999996,
   "mean": 3.263885702499976,
   "max": 6.241070000000036
  },
  "deletion:remote": {
   "n": 200,
   "min": 0.17651400000022477,
   "p50": 0.713369000000057,
   "p95": 1.155678999999509,
   "p99": 1.4044169999997393,
   "mean": 0.7471826949999786,
   "max": 2.1669710000001032
  },
  "deletion:ack": {
   "n": 200,
   "min": 1.749478000000181,
   "p50": 3.000836999999592,
   "p95": 4.187426999999843,
   "p99": 4.7025549999998475,
   "mean": 3.110786024999986,
   "max": 5.160224000000198
  },
  "formatting:remote": {
   "n": 200,
   "min": 0.26313900000013746,
   "p50": 0.7721700000001874,
   "p95": 1.2745750000003682,
   "p99": 1.6894609999999375,
   "mean": 0.8024950450000449,
   "max": 2.0959300000004077
  },
  "formatting:ack": {
   "n": 200,
   "min": 1.6914290000004257,
   "p50": 3.068822000000182,
   "p95": 4.139732000000095,
   "p99": 5.045326999999816,
   "mean": 3.1130299450000085,
   "max": 5.2467370000001665
  },
  "paragraph:remote": {
   "n": 200,
   "min": 0.13102600000001985,
   "p50": 0.490629999999328,
   "p95": 0.8526179999998931,
   "p99": 1.0112759999997252,
   "mean": 0.5048826900000074,
   "max": 1.4158099999995102
  },
  "paragraph:ack": {
   "n": 200,
   "min": 1.7277169999997568,
   "p50": 2.918836000000283,
   "p95": 3.9648489999999583,
   "p99": 4.764282999999978,
   "mean": 2.967650664999986,
   "max": 4.936877000000095
  },
  "paste2kB:remote": {
   "n": 200,
   "min": 0.20504200000004857,
   "p50": 0.7671299999997245,
   "p95": 1.1687339999998585,
   "p99": 1.311087999999927,
   "mean": 0.7657182900000157,
   "max": 1.918199999999615
  },
  "paste2kB:ack": {
   "n": 200,
   "min": 1.692613000000165,
   "p50": 2.982212999999774,
   "p95": 4.170851999999968,
   "p99": 4.731082999999899,
   "mean": 3.0422088399999927,
   "max": 5.039038000000346
  },
  "cursor:remote": {
   "n": 200,
   "min": 0.46434099999987666,
   "p50": 11.104777999999897,
   "p95": 16.934514000000036,
   "p99": 18.744488000000274,
   "mean": 10.925675049999965,
   "max": 19.04550100000006
  },
  "reconnect:caughtUp": {
   "n": 1,
   "min": 290.78042600000117,
   "p50": 290.78042600000117,
   "p95": 290.78042600000117,
   "p99": 290.78042600000117,
   "mean": 290.78042600000117,
   "max": 290.78042600000117
  }
 },
 "timeoutsPerOperation": {
  "typing:remote": 0,
  "typing:ack": 0,
  "deletion:remote": 0,
  "deletion:ack": 0,
  "formatting:remote": 0,
  "formatting:ack": 0,
  "paragraph:remote": 0,
  "paragraph:ack": 0,
  "paste2kB:remote": 0,
  "paste2kB:ack": 0,
  "cursor:remote": 0,
  "reconnect:caughtUp": 0
 },
 "editToRemoteVisibleAllOperations": {
  "n": 1200,
  "min": 0.13102600000001985,
  "p50": 0.7226810000001933,
  "p95": 1.1909579999992275,
  "p99": 1.5387069999997038,
  "mean": 0.7409586275000059,
  "max": 3.0562459999998737
 },
 "editToSavedAcknowledgement": {
  "n": 1200,
  "min": 1.6914290000004257,
  "p50": 3.0593340000000353,
  "p95": 4.262741000000005,
  "p99": 4.992062000000033,
  "mean": 3.126907813333322,
  "max": 6.241070000000036
 },
 "simultaneousTyping": {
  "tokensTyped": 1000,
  "missingAfterMerge": 0,
  "inServerExport": 1000
 },
 "convergedBetweenTheTwoClients": true,
 "reloadByFreshClient": [
  {
   "ms": 28.44189453125,
   "stateBytes": 455020,
   "blocks": 203
  },
  {
   "ms": 38.626953125,
   "stateBytes": 455020,
   "blocks": 203
  },
  {
   "ms": 39.6142578125,
   "stateBytes": 455020,
   "blocks": 203
  }
 ],
 "serverExportStatus": 200,
 "documentStateBytes": 455020,
 "verdict": {
  "stable": true,
  "reasons": []
 },
 "systemWholeScenario": {
  "samples": 3,
  "host": {
   "load1Max": 2.8,
   "availableMbMin": 30321.5,
   "swapUsedMbMax": 17515.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 9.6,
    "cpuPctMax": 11.2,
    "rssMbMax": 300.8
   }
  },
  "postgres": {
   "cpuPctAvg": 15.5,
   "cpuPctMax": 23.1,
   "memMbMax": 39.9,
   "commitsPerSecond": 84.2,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 187.2,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0.7,
   "blockWriteMs": 3.6,
   "deadlocks": 0,
   "backendsMax": 4,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 }
}
```