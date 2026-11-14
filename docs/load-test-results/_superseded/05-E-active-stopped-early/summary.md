# Performance run (2026-11-14T06:29:35.392Z, topology A)

## E. Escalation of concurrent users (topology A) [ok]

Started 2026-11-14T06:25:29.020Z, ended 2026-11-14T06:29:33.365Z.

```json
{
 "steps": [
  200,
  500,
  1000,
  1500,
  2000,
  3000
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

#### 200 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 7277 | 0.7 | 1.1 | 1.4 | 192.5 | 0.8 |
| ack | 7272 | 3.4 | 4.7 | 5.5 | 14.2 | 3.4 |
| presence | 1274 | 1.0 | 17792.0 | 32759.0 | 50859.0 | 3915.0 |
| ticketMs | 11 | 4.5 | 5.3 | 5.3 | 5.3 | 4.5 |
| reconnect | 11 | 308.3 | 391.9 | 391.9 | 391.9 | 307.7 |
| ackOffline | 4 | 145.7 | 205.7 | 205.7 | 205.7 | 157.5 |

Client counters: edits=7277, cursor_updates=1051, deletes=1034, formats=1018, drops=11, reconnects=11

WebSocket close codes seen: 1005=11

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 10.5 | 12.0 | 319 | 156 | 200 | 0 | 100 | 10 / 10 | 0 (0.0) | 21.1 | 28 | 0.0 | 0 |

Server :4450 persist append: n=8,557 mean 2.6 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 8,569; HTTP /api (server-side) n=11 mean 2.8 ms, p95 <= 5.0 ms; ws outcomes accepted=11

Generator (10 worker processes): CPU % per worker 1/1/1/1/1/1/1/1/1/1; event-loop lag p99 max 10.8 ms (max 13.4 ms); host load1 max 2.5

```json
{
 "firstAttempt": {
  "ok": 200
 },
 "connectS": 20,
 "connected": 200,
 "notConnected": 0,
 "classes": {
  "idle": 0,
  "viewing": 0,
  "activeEditors": 200
 },
 "markerEditsPerSecond": 121.3,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 2.5,
   "availableMbMin": 29867,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 10.8,
    "cpuPctMax": 12,
    "rssMbMax": 318.6
   }
  },
  "postgres": {
   "cpuPctAvg": 19.7,
   "cpuPctMax": 25.8,
   "memMbMax": 77.9,
   "commitsPerSecond": 182.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 303.2,
   "walMbPerSecond": 0.2,
   "blockReadMs": 0.4,
   "blockWriteMs": 25.3,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 500 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 18161 | 0.6 | 1.0 | 1.3 | 365.2 | 0.7 |
| ack | 18158 | 3.2 | 4.6 | 5.6 | 36.4 | 3.3 |
| presence | 3198 | 1.0 | 17867.0 | 32806.0 | 49531.0 | 4274.5 |
| ticketMs | 25 | 3.9 | 5.2 | 8.1 | 8.1 | 4.1 |
| reconnect | 25 | 365.9 | 419.2 | 420.5 | 420.5 | 340.9 |
| ackOffline | 6 | 131.3 | 378.2 | 378.2 | 378.2 | 203.8 |

Client counters: edits=18164, formats=2574, cursor_updates=2656, deletes=2653, drops=25, reconnects=25

WebSocket close codes seen: 1005=25

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 20.2 | 22.1 | 369 | 189 | 500 | 0 | 250 | 10 / 10 | 0 (0.0) | 21.2 | 84 | 0.0 | 0 |

Server :4450 persist append: n=21,537 mean 2.6 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=88 mean 3.0 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; yjs updates 21,582; HTTP /api (server-side) n=25 mean 2.4 ms, p95 <= 5.0 ms; ws outcomes accepted=25

Generator (10 worker processes): CPU % per worker 2/2/2/2/3/2/3/2/2/2; event-loop lag p99 max 10.9 ms (max 13.2 ms); host load1 max 2.7

```json
{
 "firstAttempt": {
  "ok": 300
 },
 "connectS": 20,
 "connected": 500,
 "notConnected": 0,
 "classes": {
  "idle": 0,
  "viewing": 0,
  "activeEditors": 500
 },
 "markerEditsPerSecond": 302.7,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 2.7,
   "availableMbMin": 29809.1,
   "swapUsedMbMax": 17514.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 20.1,
    "cpuPctMax": 21.6,
    "rssMbMax": 367.4
   }
  },
  "postgres": {
   "cpuPctAvg": 44,
   "cpuPctMax": 51.9,
   "memMbMax": 114.3,
   "commitsPerSecond": 451.8,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 764.4,
   "walMbPerSecond": 0.5,
   "blockReadMs": 0.1,
   "blockWriteMs": 56.9,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 4,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 1000 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 36501 | 0.5 | 1.2 | 2.3 | 277.8 | 0.7 |
| ack | 36502 | 3.4 | 4.9 | 7.6 | 40.1 | 3.5 |
| presence | 5945 | 1.0 | 17937.0 | 32834.0 | 47890.0 | 4281.3 |
| ticketMs | 57 | 4.2 | 6.2 | 6.4 | 6.4 | 4.3 |
| ackOffline | 18 | 162.2 | 291.8 | 291.8 | 291.8 | 147.4 |
| reconnect | 57 | 319.6 | 409.8 | 418.4 | 418.4 | 320.8 |

Client counters: edits=36518, formats=5174, cursor_updates=5186, deletes=5333, drops=58, reconnects=57

WebSocket close codes seen: 1005=58

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 39.3 | 42.7 | 495 | 287 | 1,000 | 0 | 500 | 10 / 10 | 0 (0.0) | 21.8 | 222 | 0.0 | 0 |

Server :4450 persist append: n=45,535 mean 2.8 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; compact: n=141 mean 3.3 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; yjs updates 45,693; HTTP /api (server-side) n=57 mean 2.6 ms, p95 <= 5.0 ms; ws outcomes accepted=57

Generator (10 worker processes): CPU % per worker 3/4/3/3/3/3/3/4/3/4; event-loop lag p99 max 10.9 ms (max 13.3 ms); host load1 max 3.1

```json
{
 "firstAttempt": {
  "ok": 500
 },
 "connectS": 22.5,
 "connected": 999,
 "notConnected": 1,
 "classes": {
  "idle": 0,
  "viewing": 0,
  "activeEditors": 1000
 },
 "markerEditsPerSecond": 608.6,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 3.1,
   "availableMbMin": 29418,
   "swapUsedMbMax": 17514.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 39.5,
    "cpuPctMax": 44,
    "rssMbMax": 491.3
   }
  },
  "postgres": {
   "cpuPctAvg": 84.8,
   "cpuPctMax": 92.3,
   "memMbMax": 165.2,
   "commitsPerSecond": 910.3,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1526.3,
   "walMbPerSecond": 1.1,
   "blockReadMs": 0,
   "blockWriteMs": 109.4,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 5,
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
   "users": 200,
   "connected": 200,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 121.3,
   "remote": {
    "n": 7277,
    "min": 0.106201171875,
    "p50": 0.700927734375,
    "p95": 1.101318359375,
    "p99": 1.356201171875,
    "mean": 0.7965978800931015,
    "max": 192.503173828125
   },
   "ack": {
    "n": 7272,
    "min": 1.781494140625,
    "p50": 3.373779296875,
    "p95": 4.689208984375,
    "p99": 5.489501953125,
    "mean": 3.4300200710989066,
    "max": 14.20703125
   },
   "presence": {
    "n": 1274,
    "min": 0,
    "p50": 1,
    "p95": 17792,
    "p99": 32759,
    "mean": 3914.993720565149,
    "max": 50859
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "users": 500,
   "connected": 500,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 302.7,
   "remote": {
    "n": 18161,
    "min": 0.098388671875,
    "p50": 0.562255859375,
    "p95": 0.998291015625,
    "p99": 1.3173828125,
    "mean": 0.663270565402855,
    "max": 365.155029296875
   },
   "ack": {
    "n": 18158,
    "min": 1.66015625,
    "p50": 3.197998046875,
    "p95": 4.552978515625,
    "p99": 5.631591796875,
    "mean": 3.2942149186136964,
    "max": 36.436767578125
   },
   "presence": {
    "n": 3198,
    "min": 0,
    "p50": 1,
    "p95": 17867,
    "p99": 32806,
    "mean": 4274.53095684803,
    "max": 49531
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "users": 1000,
   "connected": 999,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 608.6,
   "remote": {
    "n": 36501,
    "min": 0.075927734375,
    "p50": 0.52392578125,
    "p95": 1.20458984375,
    "p99": 2.251953125,
    "mean": 0.6986933269486624,
    "max": 277.786865234375
   },
   "ack": {
    "n": 36502,
    "min": 1.62158203125,
    "p50": 3.366943359375,
    "p95": 4.94287109375,
    "p99": 7.634765625,
    "mean": 3.5274096175380802,
    "max": 40.061767578125
   },
   "presence": {
    "n": 5945,
    "min": 0,
    "p50": 1,
    "p95": 17937,
    "p99": 32834,
    "mean": 4281.2701429772915,
    "max": 47890
   },
   "verdict": {
    "stable": false,
    "reasons": [
     "1 clients not connected at the end"
    ]
   }
  }
 ],
 "maximumStableUsers": 500,
 "criterion": "all of: p50 <= 50 ms, p95 <= 100 ms, p99 <= 200 ms edit to remote; new connections >= 99.9% on the first attempt; nobody disconnected at the end of the step; watchdog quiet",
 "quiesce": {
  "ok": true,
  "unacked": 0,
  "waitedMs": 501
 },
 "verification": {
  "docs": 500,
  "checked": 77863,
  "missing": 0,
  "missingSamples": [],
  "unackedAtEnd": 0,
  "exportErrors": 0
 },
 "convergence": {
  "docs": 500,
  "diverged": 0,
  "clientsCompared": 1000,
  "samples": []
 },
 "systemWholeScenario": {
  "samples": 48,
  "host": {
   "load1Max": 3.1,
   "availableMbMin": 29418,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 24.6,
    "cpuPctMax": 44.6,
    "rssMbMax": 491.3
   }
  },
  "postgres": {
   "cpuPctAvg": 53.1,
   "cpuPctMax": 164.9,
   "memMbMax": 165.2,
   "commitsPerSecond": 583.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 835.4,
   "walMbPerSecond": 0.6,
   "blockReadMs": 0.8,
   "blockWriteMs": 265.1,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 5,
   "waitingOnLocksMax": 0
  }
 }
}
```
