# Performance run (2026-11-14T07:13:52.842Z, topology B)

## E. Escalation of concurrent users (topology B) [aborted]

Started 2026-11-14T07:05:53.238Z, ended 2026-11-14T07:13:50.756Z.

```json
{
 "steps": [
  3000,
  4000,
  5000
 ],
 "holdS": 60,
 "perDocument": 2,
 "classShares": {
  "idle": 0,
  "viewing": 0,
  "active": 1
 },
 "profiles": {
  "viewing": {
   "rate": 0.05,
   "type": 1,
   "delete": 0,
   "format": 0,
   "cursor": 4,
   "pauseChance": 0.3,
   "pauseS": [
    5,
    30
   ],
   "reconnectChance": 0.002
  },
  "active": {
   "rate": 1,
   "type": 7,
   "delete": 1,
   "format": 1,
   "cursor": 1,
   "pauseChance": 0.04,
   "pauseS": [
    1,
    6
   ],
   "reconnectChance": 0.001
  }
 },
 "seed": 20261114
}
```

#### 3000 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 114013 | 0.5 | 4.1 | 9.5 | 378.4 | 1.2 |
| ack | 113987 | 3.9 | 18.9 | 49.4 | 361.9 | 6.1 |
| presence | 19622 | 1.0 | 17813.0 | 32645.0 | 48006.0 | 4058.5 |
| ticketMs | 180 | 3.8 | 13.3 | 39.6 | 51.3 | 5.8 |
| reconnect | 180 | 315.9 | 408.2 | 423.0 | 423.8 | 318.9 |
| ackOffline | 40 | 146.9 | 338.3 | 391.7 | 391.7 | 156.9 |

Client counters: edits=114039, deletes=16413, formats=16224, cursor_updates=16221, drops=179, reconnects=180

WebSocket close codes seen: 1005=179

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 65.4 | 73.0 | 975 | 671 | 3,000 | 0 | 1,500 | 40 / 40 | 72 (12.1) | 28.0 | 2,672 | 0.0 | 0 |

Server :4450 persist append: n=138,507 mean 4.9 ms, p95 <= 25.0 ms, p99 <= 50.0 ms; yjs updates 138,926; HTTP /api (server-side) n=175 mean 3.9 ms, p95 <= 10.0 ms; ws outcomes accepted=175

Generator (10 worker processes): CPU % per worker 11/11/11/11/11/11/11/11/11/11; event-loop lag p99 max 11.0 ms (max 14.8 ms); host load1 max 6.5

```json
{
 "firstAttempt": {
  "ok": 3000
 },
 "connectS": 85.2,
 "connected": 3000,
 "notConnected": 0,
 "classes": {
  "idle": 0,
  "viewing": 0,
  "activeEditors": 3000
 },
 "markerEditsPerSecond": 1900.6,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 6.5,
   "availableMbMin": 27956.3,
   "swapUsedMbMax": 17529.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 65.4,
    "cpuPctMax": 70.8,
    "rssMbMax": 925.6
   }
  },
  "postgres": {
   "cpuPctAvg": 294.6,
   "cpuPctMax": 354.9,
   "memMbMax": 308.6,
   "commitsPerSecond": 2622.9,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 4567.2,
   "walMbPerSecond": 3.2,
   "blockReadMs": 1.7,
   "blockWriteMs": 353,
   "deadlocks": 0,
   "backendsMax": 41,
   "activeMax": 32,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 4000 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 146658 | 0.5 | 7.1 | 15.8 | 682.3 | 2.0 |
| ack | 146661 | 6.0 | 72.9 | 122.3 | 385.6 | 22.9 |
| presence | 23906 | 1.0 | 30122.0 | 35380.0 | 50375.0 | 4435.7 |
| ticketMs | 219 | 6.6 | 174.5 | 270.0 | 286.6 | 37.6 |
| reconnect | 219 | 367.8 | 612.7 | 766.7 | 831.6 | 381.5 |
| ackOffline | 59 | 168.3 | 583.8 | 747.1 | 747.1 | 225.5 |

Client counters: edits=146715, cursor_updates=20953, deletes=20965, formats=20775, drops=219, reconnects=219

WebSocket close codes seen: 1005=219

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 72.4 | 82.4 | 1,021 | 673 | 4,000 | 0 | 2,000 | 40 / 40 | 106 (18.8) | 46.2 | 4,025 | 0.0 | 0 |

Server :4450 persist append: n=178,601 mean 19.9 ms, p95 <= 100.0 ms, p99 <= 100.0 ms; compact: n=1,481 mean 21.6 ms, p95 <= 100.0 ms, p99 <= 250.0 ms; yjs updates 179,744; HTTP /api (server-side) n=216 mean 34.8 ms, p95 <= 250.0 ms; ws outcomes accepted=216

Generator (10 worker processes): CPU % per worker 15/15/15/15/15/15/15/15/15/15; event-loop lag p99 max 11.0 ms (max 17.4 ms); host load1 max 10.4

```json
{
 "firstAttempt": {
  "ok": 1000
 },
 "connectS": 35,
 "connected": 4000,
 "notConnected": 0,
 "classes": {
  "idle": 0,
  "viewing": 0,
  "activeEditors": 4000
 },
 "markerEditsPerSecond": 2445.3,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 10.4,
   "availableMbMin": 27459.3,
   "swapUsedMbMax": 17529.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 72.4,
    "cpuPctMax": 82,
    "rssMbMax": 1015.9
   }
  },
  "postgres": {
   "cpuPctAvg": 390.4,
   "cpuPctMax": 411.8,
   "memMbMax": 368.9,
   "commitsPerSecond": 3552.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 6116.6,
   "walMbPerSecond": 5.8,
   "blockReadMs": 64.9,
   "blockWriteMs": 865,
   "deadlocks": 0,
   "backendsMax": 42,
   "activeMax": 26,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 5000 users (54 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| presence | 29196 | 3.0 | 30274.0 | 45155.0 | 49783.0 | 4539.3 |
| remote | 195443 | 1.4 | 14.4 | 87.0 | 3545.6 | 7.6 |
| ack | 194437 | 588.3 | 1093.7 | 1234.8 | 5488.7 | 621.7 |
| ackOffline | 493 | 1877.5 | 3817.3 | 6747.6 | 7767.9 | 2013.9 |
| ticketMs | 272 | 1226.2 | 1895.0 | 2116.0 | 2153.8 | 1368.8 |
| reconnect | 264 | 2778.2 | 4289.7 | 4687.1 | 4805.9 | 3035.5 |

Client counters: cursor_updates=27366, formats=27860, edits=195959, deletes=27685, reconnects=264, drops=275

WebSocket close codes seen: 1005=275

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 88.2 | 101.6 | 1,555 | 1,085 | 4,997 | 0 | 2,500 | 40 / 40 | 1,761 (1425.9) | 64.6 | 93,752 | 0.0 | 0 |

Server :4450 persist append: n=171,669 mean 450.9 ms, p95 <= 1000.0 ms, p99 <= 1000.0 ms; compact: n=841 mean 480.9 ms, p95 <= 1000.0 ms, p99 <= 1000.0 ms; yjs updates 210,340; HTTP /api (server-side) n=230 mean 1309.6 ms, p95 <= 2500.0 ms; ws outcomes accepted=230

Generator (10 worker processes): CPU % per worker 17/16/16/16/16/16/17/17/16/17; event-loop lag p99 max 11.3 ms (max 21.5 ms); host load1 max 18.5

```json
{
 "firstAttempt": {
  "ok": 1000
 },
 "connectS": 35.7,
 "connected": 4979,
 "notConnected": 21,
 "classes": {
  "idle": 0,
  "viewing": 0,
  "activeEditors": 5000
 },
 "markerEditsPerSecond": 3626.9,
 "completedFullDuration": false,
 "system": {
  "samples": 11,
  "host": {
   "load1Max": 18.5,
   "availableMbMin": 26120.5,
   "swapUsedMbMax": 17529.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 88,
    "cpuPctMax": 101,
    "rssMbMax": 1554.7
   }
  },
  "postgres": {
   "cpuPctAvg": 406.9,
   "cpuPctMax": 417.8,
   "memMbMax": 393.3,
   "commitsPerSecond": 3229.2,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 6575.8,
   "walMbPerSecond": 6.7,
   "blockReadMs": 264.9,
   "blockWriteMs": 1486,
   "deadlocks": 0,
   "backendsMax": 42,
   "activeMax": 40,
   "waitingOnLocksMax": 0
  }
 }
}
```

### Results

```json
{
 "steps": [
  {
   "users": 3000,
   "connected": 3000,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 1900.6,
   "remote": {
    "n": 114013,
    "min": 0.064208984375,
    "p50": 0.471435546875,
    "p95": 4.087890625,
    "p99": 9.5458984375,
    "mean": 1.1958447836506307,
    "max": 378.389892578125
   },
   "ack": {
    "n": 113987,
    "min": 1.739013671875,
    "p50": 3.89404296875,
    "p95": 18.927978515625,
    "p99": 49.413818359375,
    "mean": 6.126033562986486,
    "max": 361.917724609375
   },
   "presence": {
    "n": 19622,
    "min": 0,
    "p50": 1,
    "p95": 17813,
    "p99": 32645,
    "mean": 4058.478595454082,
    "max": 48006
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "users": 4000,
   "connected": 4000,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 2445.3,
   "remote": {
    "n": 146658,
    "min": 0.067138671875,
    "p50": 0.489990234375,
    "p95": 7.1484375,
    "p99": 15.7666015625,
    "mean": 1.9843420357385464,
    "max": 682.30517578125
   },
   "ack": {
    "n": 146661,
    "min": 1.75830078125,
    "p50": 5.96923828125,
    "p95": 72.85986328125,
    "p99": 122.320556640625,
    "mean": 22.904420086436577,
    "max": 385.5908203125
   },
   "presence": {
    "n": 23906,
    "min": 0,
    "p50": 1,
    "p95": 30122,
    "p99": 35380,
    "mean": 4435.659959842717,
    "max": 50375
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "users": 5000,
   "connected": 4979,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 3626.9,
   "remote": {
    "n": 195443,
    "min": 0.07861328125,
    "p50": 1.4033203125,
    "p95": 14.35498046875,
    "p99": 87.024169921875,
    "mean": 7.603427055428645,
    "max": 3545.64208984375
   },
   "ack": {
    "n": 194437,
    "min": 304.407958984375,
    "p50": 588.329833984375,
    "p95": 1093.685791015625,
    "p99": 1234.841552734375,
    "mean": 621.7197866531097,
    "max": 5488.72412109375
   },
   "presence": {
    "n": 29196,
    "min": 0,
    "p50": 3,
    "p95": 30274,
    "p99": 45155,
    "mean": 4539.289046444718,
    "max": 49783
   },
   "verdict": {
    "stable": false,
    "reasons": [
     "21 clients not connected at the end",
     "aborted by the watchdog: load average 18.5 > 18"
    ]
   }
  }
 ],
 "maximumStableUsers": 4000,
 "criterion": "all of: p50 <= 50 ms, p95 <= 100 ms, p99 <= 200 ms edit to remote; new connections >= 99.9% on the first attempt; nobody disconnected at the end of the step; watchdog quiet",
 "quiesce": {
  "ok": false,
  "unacked": 2,
  "waitedMs": 120221
 },
 "verification": {
  "docs": 2500,
  "checked": 668633,
  "missing": 0,
  "missingSamples": [],
  "unackedAtEnd": 2,
  "exportErrors": 0
 },
 "convergence": {
  "docs": 2500,
  "diverged": 0,
  "clientsCompared": 5000,
  "samples": []
 },
 "systemWholeScenario": {
  "samples": 95,
  "host": {
   "load1Max": 18.5,
   "availableMbMin": 25653.8,
   "swapUsedMbMax": 17529.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 52,
    "cpuPctMax": 101,
    "rssMbMax": 1567.9
   }
  },
  "postgres": {
   "cpuPctAvg": 220.9,
   "cpuPctMax": 417.8,
   "memMbMax": 393.3,
   "commitsPerSecond": 2330.7,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 3458.8,
   "walMbPerSecond": 2.9,
   "blockReadMs": 618.2,
   "blockWriteMs": 4782.6,
   "deadlocks": 0,
   "backendsMax": 42,
   "activeMax": 40,
   "waitingOnLocksMax": 0
  }
 }
}
```

### Notes

- Stopped by the watchdog: load average 18.5 > 18.
