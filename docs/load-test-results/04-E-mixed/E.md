## E. Escalation of concurrent users (topology A) [ok]

Started 2026-11-14T06:36:33.500Z, ended 2026-11-14T06:49:40.086Z.

```json
{
 "steps": [
  100,
  250,
  500,
  750,
  1000,
  1500,
  2000,
  3000,
  5000
 ],
 "holdS": 60,
 "perDocument": 2,
 "classShares": {
  "idle": 0.5,
  "viewing": 0.3,
  "active": 0.2
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

#### 100 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| idle / presence | 317 | 5.0 | 12.0 | 13.0 | 13.0 | 5.3 |
| viewing / presence | 123 | 15229.0 | 45217.0 | 46747.0 | 47581.0 | 11978.9 |
| viewing / remote | 11 | 1.1 | 1.4 | 1.4 | 1.4 | 1.1 |
| viewing / ack | 11 | 4.6 | 14.1 | 14.1 | 14.1 | 7.0 |
| active / presence | 137 | 1.0 | 17970.0 | 31452.0 | 45917.0 | 4086.9 |
| active / remote | 735 | 1.1 | 1.5 | 1.7 | 108.5 | 1.3 |
| active / ack | 734 | 4.5 | 14.2 | 15.0 | 15.6 | 5.9 |
| active / ticketMs | 1 | 4.6 | 4.6 | 4.6 | 4.6 | 4.6 |
| active / ackOffline | 1 | 122.2 | 122.2 | 122.2 | 122.2 | 122.2 |
| active / reconnect | 1 | 300.0 | 300.0 | 300.0 | 300.0 | 300.0 |
| ALL / presence | 577 | 3.0 | 17970.0 | 45705.0 | 47581.0 | 3526.8 |
| ALL / remote | 746 | 1.1 | 1.5 | 1.7 | 108.5 | 1.3 |
| ALL / ack | 745 | 4.5 | 14.2 | 15.0 | 15.6 | 6.0 |
| ALL / ticketMs | 1 | 4.6 | 4.6 | 4.6 | 4.6 | 4.6 |
| ALL / ackOffline | 1 | 122.2 | 122.2 | 122.2 | 122.2 | 122.2 |
| ALL / reconnect | 1 | 300.0 | 300.0 | 300.0 | 300.0 | 300.0 |

Client counters: cursor_updates=172, edits=746, deletes=102, formats=100, drops=1, reconnects=1

WebSocket close codes seen: 1005=1

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 2.4 | 4.7 | 309 | 154 | 100 | 0 | 50 | 10 / 10 | 0 (0.0) | 21.0 | 87 | 0.0 | 0 |

Server :4450 persist append: n=864 mean 4.7 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; yjs updates 865; HTTP /api (server-side) n=1 mean 3.3 ms, p95 <= 5.0 ms; ws outcomes accepted=1

Generator (10 worker processes): CPU % per worker 1/1/1/1/1/1/1/1/1/1; event-loop lag p99 max 10.6 ms (max 13.3 ms); host load1 max 2.0

```json
{
 "firstAttempt": {
  "ok": 100
 },
 "connectS": 19.9,
 "connected": 100,
 "notConnected": 0,
 "classes": {
  "idle": 50,
  "viewing": 30,
  "activeEditors": 20
 },
 "markerEditsPerSecond": 12.4,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 2,
   "availableMbMin": 29933.2,
   "swapUsedMbMax": 17514.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 2.5,
    "cpuPctMax": 4.6,
    "rssMbMax": 309.3
   }
  },
  "postgres": {
   "cpuPctAvg": 4.2,
   "cpuPctMax": 5.2,
   "memMbMax": 63.8,
   "commitsPerSecond": 31,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 31.9,
   "walMbPerSecond": 0,
   "blockReadMs": 0.2,
   "blockWriteMs": 3.4,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 250 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| idle / presence | 760 | 19.0 | 23.0 | 23.0 | 23.0 | 14.3 |
| active / remote | 1798 | 0.9 | 1.2 | 1.5 | 20.7 | 0.9 |
| active / ack | 1797 | 4.0 | 5.5 | 13.9 | 23.9 | 4.2 |
| active / presence | 300 | 1.0 | 17999.0 | 32571.0 | 47572.0 | 5146.6 |
| viewing / presence | 333 | 1.0 | 32409.0 | 47640.0 | 48408.0 | 9723.7 |
| viewing / remote | 50 | 0.9 | 1.2 | 1.3 | 1.3 | 0.9 |
| viewing / ack | 50 | 3.9 | 5.3 | 5.7 | 5.7 | 4.0 |
| viewing / ticketMs | 1 | 4.7 | 4.7 | 4.7 | 4.7 | 4.7 |
| viewing / reconnect | 1 | 267.3 | 267.3 | 267.3 | 267.3 | 267.3 |
| ALL / presence | 1393 | 11.0 | 17636.0 | 45281.0 | 48408.0 | 3440.6 |
| ALL / remote | 1848 | 0.9 | 1.2 | 1.5 | 20.7 | 0.9 |
| ALL / ack | 1847 | 4.0 | 5.5 | 13.7 | 23.9 | 4.2 |
| ALL / ticketMs | 1 | 4.7 | 4.7 | 4.7 | 4.7 | 4.7 |
| ALL / reconnect | 1 | 267.3 | 267.3 | 267.3 | 267.3 | 267.3 |

Client counters: edits=1848, formats=256, deletes=248, cursor_updates=420, drops=1, reconnects=1

WebSocket close codes seen: 1005=1

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 4.3 | 6.3 | 320 | 159 | 250 | 0 | 125 | 10 / 10 | 0 (0.0) | 21.9 | 56 | 0.0 | 0 |

Server :4450 persist append: n=2,135 mean 3.2 ms, p95 <= 5.0 ms, p99 <= 25.0 ms; compact: n=8 mean 3.7 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 2,139; HTTP /api (server-side) n=1 mean 3.1 ms, p95 <= 5.0 ms; ws outcomes accepted=1

Generator (10 worker processes): CPU % per worker 1/1/1/1/1/1/1/1/1/1; event-loop lag p99 max 11.1 ms (max 13.2 ms); host load1 max 1.8

```json
{
 "firstAttempt": {
  "ok": 150
 },
 "connectS": 20,
 "connected": 250,
 "notConnected": 0,
 "classes": {
  "idle": 125,
  "viewing": 75,
  "activeEditors": 50
 },
 "markerEditsPerSecond": 30.8,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 1.7,
   "availableMbMin": 29881.2,
   "swapUsedMbMax": 17514.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 4.2,
    "cpuPctMax": 6,
    "rssMbMax": 320.1
   }
  },
  "postgres": {
   "cpuPctAvg": 7.4,
   "cpuPctMax": 9.6,
   "memMbMax": 72.8,
   "commitsPerSecond": 63.9,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 77.2,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0.1,
   "blockWriteMs": 7.8,
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
| idle / presence | 1518 | 35.0 | 46.0 | 49.0 | 49.0 | 27.2 |
| active / remote | 3515 | 0.8 | 1.2 | 1.4 | 360.1 | 1.0 |
| active / ack | 3514 | 3.6 | 4.9 | 5.8 | 46.8 | 3.7 |
| active / presence | 602 | 1.0 | 30032.0 | 32656.0 | 46843.0 | 4368.1 |
| active / ticketMs | 7 | 3.3 | 4.9 | 4.9 | 4.9 | 3.6 |
| active / reconnect | 7 | 292.1 | 411.0 | 411.0 | 411.0 | 298.4 |
| active / ackOffline | 2 | 49.0 | 372.2 | 372.2 | 372.2 | 210.6 |
| viewing / presence | 604 | 15016.0 | 45919.0 | 47751.0 | 47896.0 | 12509.9 |
| viewing / remote | 82 | 0.8 | 1.1 | 6.1 | 6.1 | 0.9 |
| viewing / ack | 82 | 3.5 | 5.0 | 9.7 | 9.7 | 3.7 |
| ALL / presence | 2724 | 24.0 | 30336.0 | 46256.0 | 47896.0 | 3754.4 |
| ALL / remote | 3597 | 0.8 | 1.2 | 1.5 | 360.1 | 1.0 |
| ALL / ack | 3596 | 3.6 | 4.9 | 5.9 | 46.8 | 3.7 |
| ALL / ticketMs | 7 | 3.3 | 4.9 | 4.9 | 4.9 | 3.6 |
| ALL / reconnect | 7 | 292.1 | 411.0 | 411.0 | 411.0 | 298.4 |
| ALL / ackOffline | 2 | 49.0 | 372.2 | 372.2 | 372.2 | 210.6 |

Client counters: deletes=503, edits=3599, cursor_updates=814, formats=467, drops=7, reconnects=7

WebSocket close codes seen: 1005=7

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 6.9 | 9.2 | 339 | 166 | 500 | 0 | 250 | 10 / 10 | 0 (0.0) | 22.3 | 28 | 0.0 | 0 |

Server :4450 persist append: n=4,201 mean 2.7 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=14 mean 3.1 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 4,213; HTTP /api (server-side) n=6 mean 2.1 ms, p95 <= 5.0 ms; ws outcomes accepted=6

Generator (10 worker processes): CPU % per worker 1/1/1/1/1/1/1/1/1/1; event-loop lag p99 max 11.2 ms (max 12.5 ms); host load1 max 2.3

```json
{
 "firstAttempt": {
  "ok": 250
 },
 "connectS": 20,
 "connected": 500,
 "notConnected": 0,
 "classes": {
  "idle": 250,
  "viewing": 150,
  "activeEditors": 100
 },
 "markerEditsPerSecond": 60,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 2.3,
   "availableMbMin": 30470.3,
   "swapUsedMbMax": 17514.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 6.8,
    "cpuPctMax": 9,
    "rssMbMax": 338.8
   }
  },
  "postgres": {
   "cpuPctAvg": 10.9,
   "cpuPctMax": 13.4,
   "memMbMax": 78.4,
   "commitsPerSecond": 143.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 151.9,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0,
   "blockWriteMs": 13,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 2,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 750 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| idle / presence | 2318 | 53.0 | 57.0 | 63.0 | 64.0 | 46.0 |
| active / remote | 5186 | 0.7 | 1.1 | 1.6 | 244.0 | 1.1 |
| active / ack | 5185 | 3.3 | 4.7 | 6.3 | 66.0 | 3.7 |
| active / presence | 878 | 1.0 | 30295.0 | 32684.0 | 47814.0 | 4623.7 |
| active / ticketMs | 8 | 4.0 | 4.2 | 4.2 | 4.2 | 3.9 |
| active / reconnect | 8 | 330.5 | 402.1 | 402.1 | 402.1 | 325.2 |
| active / ackOffline | 3 | 208.2 | 256.9 | 256.9 | 256.9 | 217.3 |
| viewing / presence | 970 | 15083.0 | 45948.0 | 47546.0 | 50939.0 | 12641.5 |
| viewing / remote | 115 | 0.8 | 1.2 | 1.7 | 1.9 | 0.8 |
| viewing / ack | 115 | 3.5 | 4.6 | 7.3 | 14.3 | 3.6 |
| ALL / presence | 4166 | 53.0 | 30596.0 | 46206.0 | 50939.0 | 3943.5 |
| ALL / remote | 5301 | 0.7 | 1.1 | 1.6 | 244.0 | 1.1 |
| ALL / ack | 5300 | 3.3 | 4.7 | 6.3 | 66.0 | 3.7 |
| ALL / ticketMs | 8 | 4.0 | 4.2 | 4.2 | 4.2 | 3.9 |
| ALL / reconnect | 8 | 330.5 | 402.1 | 402.1 | 402.1 | 325.2 |
| ALL / ackOffline | 3 | 208.2 | 256.9 | 256.9 | 256.9 | 217.3 |

Client counters: edits=5303, deletes=761, formats=756, cursor_updates=1224, drops=8, reconnects=8

WebSocket close codes seen: 1005=8

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 8.7 | 11.1 | 381 | 192 | 750 | 0 | 375 | 10 / 10 | 0 (0.0) | 21.6 | 28 | 0.0 | 0 |

Server :4450 persist append: n=6,284 mean 2.6 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=29 mean 3.1 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; yjs updates 6,306; HTTP /api (server-side) n=8 mean 2.3 ms, p95 <= 5.0 ms; ws outcomes accepted=8

Generator (10 worker processes): CPU % per worker 1/1/1/1/1/1/1/1/1/1; event-loop lag p99 max 11.0 ms (max 11.9 ms); host load1 max 1.2

```json
{
 "firstAttempt": {
  "ok": 250
 },
 "connectS": 20,
 "connected": 750,
 "notConnected": 0,
 "classes": {
  "idle": 375,
  "viewing": 225,
  "activeEditors": 150
 },
 "markerEditsPerSecond": 88.4,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 1.2,
   "availableMbMin": 30375,
   "swapUsedMbMax": 17514.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 8.8,
    "cpuPctMax": 11,
    "rssMbMax": 379.9
   }
  },
  "postgres": {
   "cpuPctAvg": 15.1,
   "cpuPctMax": 19.9,
   "memMbMax": 89.7,
   "commitsPerSecond": 222.4,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 222.3,
   "walMbPerSecond": 0.2,
   "blockReadMs": 0,
   "blockWriteMs": 17.5,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 1000 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| idle / presence | 3527 | 40.0 | 80.0 | 80.0 | 81.0 | 46.6 |
| active / remote | 7148 | 0.7 | 1.1 | 2.2 | 352.0 | 1.0 |
| active / ack | 7143 | 3.3 | 4.6 | 7.5 | 73.9 | 3.6 |
| active / presence | 1083 | 1.0 | 30164.0 | 32992.0 | 47607.0 | 4420.7 |
| active / ticketMs | 12 | 3.6 | 4.7 | 4.7 | 4.7 | 3.7 |
| active / reconnect | 12 | 326.4 | 408.0 | 408.0 | 408.0 | 328.0 |
| active / ackOffline | 5 | 202.5 | 367.5 | 367.5 | 367.5 | 199.1 |
| viewing / remote | 178 | 0.7 | 1.1 | 1.8 | 1.9 | 0.7 |
| viewing / ack | 178 | 3.2 | 4.5 | 5.2 | 33.1 | 3.4 |
| viewing / presence | 1315 | 15390.0 | 46400.0 | 47745.0 | 50610.0 | 13820.2 |
| viewing / ticketMs | 2 | 3.7 | 3.8 | 3.8 | 3.8 | 3.7 |
| viewing / reconnect | 2 | 273.0 | 359.8 | 359.8 | 359.8 | 316.4 |
| ALL / presence | 5925 | 39.0 | 30889.0 | 46724.0 | 50610.0 | 3903.1 |
| ALL / remote | 7326 | 0.7 | 1.1 | 2.1 | 352.0 | 1.0 |
| ALL / ack | 7321 | 3.3 | 4.6 | 7.4 | 73.9 | 3.6 |
| ALL / ticketMs | 14 | 3.7 | 4.7 | 4.7 | 4.7 | 3.7 |
| ALL / reconnect | 14 | 326.4 | 408.0 | 408.0 | 408.0 | 326.4 |
| ALL / ackOffline | 5 | 202.5 | 367.5 | 367.5 | 367.5 | 199.1 |

Client counters: formats=1062, edits=7328, deletes=1037, cursor_updates=1594, drops=14, reconnects=14

WebSocket close codes seen: 1005=14

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 13.2 | 17.3 | 425 | 186 | 1,000 | 0 | 500 | 10 / 10 | 0 (0.0) | 21.3 | 56 | 0.0 | 0 |

Server :4450 persist append: n=8,660 mean 2.6 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=39 mean 3.0 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 8,699; HTTP /api (server-side) n=14 mean 2.2 ms, p95 <= 5.0 ms; ws outcomes accepted=14

Generator (10 worker processes): CPU % per worker 2/2/2/2/1/1/1/1/1/1; event-loop lag p99 max 10.9 ms (max 12.8 ms); host load1 max 1.6

```json
{
 "firstAttempt": {
  "ok": 250
 },
 "connectS": 19.9,
 "connected": 1000,
 "notConnected": 0,
 "classes": {
  "idle": 500,
  "viewing": 300,
  "activeEditors": 200
 },
 "markerEditsPerSecond": 122.1,
 "completedFullDuration": true,
 "system": {
  "samples": 13,
  "host": {
   "load1Max": 1.6,
   "availableMbMin": 30318.8,
   "swapUsedMbMax": 17514.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 12.7,
    "cpuPctMax": 16.8,
    "rssMbMax": 425.1
   }
  },
  "postgres": {
   "cpuPctAvg": 18.9,
   "cpuPctMax": 21.6,
   "memMbMax": 102.3,
   "commitsPerSecond": 288.3,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 303.4,
   "walMbPerSecond": 0.2,
   "blockReadMs": 0,
   "blockWriteMs": 24,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 3,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 1500 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| idle / presence | 4543 | 56.0 | 93.0 | 94.0 | 94.0 | 57.6 |
| active / remote | 10538 | 0.6 | 1.0 | 2.7 | 274.9 | 1.0 |
| active / ack | 10536 | 3.2 | 4.6 | 12.0 | 91.7 | 3.6 |
| active / presence | 1627 | 1.0 | 17917.0 | 32769.0 | 47886.0 | 4308.6 |
| active / ticketMs | 19 | 3.9 | 5.0 | 5.0 | 5.0 | 3.9 |
| active / ackOffline | 3 | 243.6 | 288.0 | 288.0 | 288.0 | 194.5 |
| active / reconnect | 19 | 317.0 | 415.2 | 415.2 | 415.2 | 328.2 |
| viewing / presence | 1887 | 15089.0 | 45952.0 | 47671.0 | 49162.0 | 12620.4 |
| viewing / remote | 276 | 0.6 | 1.0 | 1.7 | 83.0 | 0.9 |
| viewing / ack | 276 | 3.1 | 4.4 | 9.5 | 82.9 | 3.5 |
| ALL / presence | 8057 | 50.0 | 30635.0 | 46437.0 | 49162.0 | 3858.3 |
| ALL / remote | 10814 | 0.6 | 1.0 | 2.6 | 274.9 | 1.0 |
| ALL / ack | 10812 | 3.2 | 4.6 | 11.9 | 91.7 | 3.6 |
| ALL / ticketMs | 19 | 3.9 | 5.0 | 5.0 | 5.0 | 3.9 |
| ALL / ackOffline | 3 | 243.6 | 288.0 | 288.0 | 288.0 | 194.5 |
| ALL / reconnect | 19 | 317.0 | 415.2 | 415.2 | 415.2 | 328.2 |

Client counters: edits=10816, deletes=1513, formats=1521, cursor_updates=2446, drops=18, reconnects=19

WebSocket close codes seen: 1005=18

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 16.6 | 26.8 | 468 | 228 | 1,500 | 0 | 750 | 10 / 10 | 0 (0.0) | 39.3 | 62 | 0.0 | 0 |

Server :4450 persist append: n=12,487 mean 2.6 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; compact: n=56 mean 3.1 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; yjs updates 12,528; HTTP /api (server-side) n=17 mean 2.3 ms, p95 <= 5.0 ms; ws outcomes accepted=17

Generator (10 worker processes): CPU % per worker 2/2/2/2/2/2/2/2/2/2; event-loop lag p99 max 10.9 ms (max 12.5 ms); host load1 max 2.1

```json
{
 "firstAttempt": {
  "ok": 500
 },
 "connectS": 22.5,
 "connected": 1500,
 "notConnected": 0,
 "classes": {
  "idle": 750,
  "viewing": 450,
  "activeEditors": 300
 },
 "markerEditsPerSecond": 180.3,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 2.1,
   "availableMbMin": 29852,
   "swapUsedMbMax": 17514.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 15.7,
    "cpuPctMax": 18,
    "rssMbMax": 461.6
   }
  },
  "postgres": {
   "cpuPctAvg": 26.8,
   "cpuPctMax": 28.8,
   "memMbMax": 118.7,
   "commitsPerSecond": 397.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 456.4,
   "walMbPerSecond": 0.3,
   "blockReadMs": 0,
   "blockWriteMs": 32.7,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 2,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 2000 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| idle / presence | 6072 | 95.0 | 108.0 | 111.0 | 112.0 | 77.3 |
| active / presence | 2075 | 1.0 | 30057.0 | 32678.0 | 47943.0 | 4212.7 |
| active / remote | 14257 | 0.5 | 1.0 | 10.6 | 295.3 | 1.2 |
| active / ack | 14257 | 3.1 | 4.7 | 25.3 | 119.0 | 3.9 |
| active / ticketMs | 23 | 3.6 | 4.5 | 4.6 | 4.6 | 3.6 |
| active / ackOffline | 5 | 167.7 | 308.2 | 308.2 | 308.2 | 182.4 |
| active / reconnect | 23 | 351.4 | 413.5 | 417.5 | 417.5 | 341.3 |
| viewing / presence | 2527 | 15068.0 | 45767.0 | 47705.0 | 49843.0 | 12454.2 |
| viewing / remote | 349 | 0.5 | 1.1 | 7.8 | 97.5 | 1.1 |
| viewing / ack | 349 | 3.1 | 4.6 | 16.2 | 112.5 | 3.9 |
| viewing / ticketMs | 7 | 3.8 | 58.5 | 58.5 | 58.5 | 11.6 |
| viewing / reconnect | 7 | 393.6 | 403.9 | 403.9 | 403.9 | 354.0 |
| ALL / presence | 10674 | 69.0 | 30459.0 | 46267.0 | 49843.0 | 3811.3 |
| ALL / remote | 14606 | 0.5 | 1.0 | 10.5 | 295.3 | 1.2 |
| ALL / ack | 14606 | 3.1 | 4.7 | 25.3 | 119.0 | 3.9 |
| ALL / ticketMs | 30 | 3.7 | 4.6 | 58.5 | 58.5 | 5.5 |
| ALL / ackOffline | 5 | 167.7 | 308.2 | 308.2 | 308.2 | 182.4 |
| ALL / reconnect | 30 | 356.1 | 413.5 | 417.5 | 417.5 | 344.3 |

Client counters: cursor_updates=3279, edits=14614, deletes=1995, formats=2023, drops=29, reconnects=30

WebSocket close codes seen: 1005=29

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 20.0 | 25.5 | 519 | 235 | 2,000 | 0 | 1,000 | 10 / 10 | 11 (1.4) | 25.1 | 84 | 0.0 | 0 |

Server :4450 persist append: n=17,693 mean 2.7 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; compact: n=78 mean 3.2 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 17,769; HTTP /api (server-side) n=29 mean 2.1 ms, p95 <= 5.0 ms; ws outcomes accepted=29

Generator (10 worker processes): CPU % per worker 2/2/2/2/2/2/2/2/2/2; event-loop lag p99 max 10.9 ms (max 13.9 ms); host load1 max 1.8

```json
{
 "firstAttempt": {
  "ok": 500
 },
 "connectS": 22.5,
 "connected": 2000,
 "notConnected": 0,
 "classes": {
  "idle": 1000,
  "viewing": 600,
  "activeEditors": 400
 },
 "markerEditsPerSecond": 243.6,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 1.8,
   "availableMbMin": 29552.3,
   "swapUsedMbMax": 17514.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 20.6,
    "cpuPctMax": 26.6,
    "rssMbMax": 519.4
   }
  },
  "postgres": {
   "cpuPctAvg": 35.1,
   "cpuPctMax": 39.5,
   "memMbMax": 142.6,
   "commitsPerSecond": 508.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 612.1,
   "walMbPerSecond": 0.4,
   "blockReadMs": 0,
   "blockWriteMs": 43.9,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 3000 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| idle / presence | 9033 | 131.0 | 158.0 | 164.0 | 164.0 | 116.9 |
| active / presence | 3248 | 1.0 | 17870.0 | 32814.0 | 47813.0 | 4066.9 |
| active / remote | 21562 | 0.5 | 1.2 | 66.6 | 290.2 | 2.0 |
| active / ack | 21567 | 3.2 | 5.4 | 77.9 | 164.0 | 4.9 |
| active / ticketMs | 33 | 4.0 | 45.9 | 133.1 | 133.1 | 9.3 |
| active / reconnect | 33 | 344.2 | 413.3 | 418.8 | 418.8 | 335.9 |
| active / ackOffline | 7 | 119.4 | 304.0 | 304.0 | 304.0 | 140.6 |
| viewing / presence | 3709 | 15077.0 | 45869.0 | 47566.0 | 50500.0 | 12472.2 |
| viewing / remote | 475 | 0.5 | 1.2 | 5.9 | 135.9 | 1.6 |
| viewing / ack | 475 | 3.2 | 5.6 | 38.2 | 135.8 | 4.5 |
| viewing / ticketMs | 8 | 3.0 | 6.6 | 6.6 | 6.6 | 3.8 |
| viewing / reconnect | 8 | 359.1 | 380.7 | 380.7 | 380.7 | 351.6 |
| ALL / presence | 15990 | 127.0 | 30456.0 | 46232.0 | 50500.0 | 3785.1 |
| ALL / remote | 22037 | 0.5 | 1.2 | 66.5 | 290.2 | 2.0 |
| ALL / ack | 22042 | 3.2 | 5.4 | 77.5 | 164.0 | 4.9 |
| ALL / ticketMs | 41 | 3.8 | 7.4 | 133.1 | 133.1 | 8.2 |
| ALL / reconnect | 41 | 349.0 | 412.5 | 418.8 | 418.8 | 338.9 |
| ALL / ackOffline | 7 | 119.4 | 304.0 | 304.0 | 304.0 | 140.6 |

Client counters: deletes=3099, cursor_updates=4997, edits=22052, formats=2999, drops=41, reconnects=41

WebSocket close codes seen: 1005=41

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 30.4 | 34.1 | 562 | 307 | 3,000 | 0 | 1,500 | 10 / 10 | 4 (0.6) | 35.2 | 84 | 0.0 | 0 |

Server :4450 persist append: n=27,006 mean 3.0 ms, p95 <= 5.0 ms, p99 <= 25.0 ms; compact: n=96 mean 3.3 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; yjs updates 27,155; HTTP /api (server-side) n=41 mean 3.4 ms, p95 <= 5.0 ms; ws outcomes accepted=41

Generator (10 worker processes): CPU % per worker 3/3/3/3/3/3/3/3/3/3; event-loop lag p99 max 10.9 ms (max 13.1 ms); host load1 max 3.2

```json
{
 "firstAttempt": {
  "ok": 1000
 },
 "connectS": 35,
 "connected": 3000,
 "notConnected": 0,
 "classes": {
  "idle": 1500,
  "viewing": 900,
  "activeEditors": 600
 },
 "markerEditsPerSecond": 367.5,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 3.1,
   "availableMbMin": 28886.4,
   "swapUsedMbMax": 17514.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 30.3,
    "cpuPctMax": 35.4,
    "rssMbMax": 556
   }
  },
  "postgres": {
   "cpuPctAvg": 50.4,
   "cpuPctMax": 54.8,
   "memMbMax": 179.5,
   "commitsPerSecond": 898.4,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 919.2,
   "walMbPerSecond": 0.7,
   "blockReadMs": 0,
   "blockWriteMs": 64,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 2,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 5000 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| active / ack | 36623 | 3.6 | 16.6 | 214.9 | 409.8 | 9.9 |
| active / remote | 36623 | 0.5 | 4.0 | 180.3 | 330.5 | 5.2 |
| active / presence | 5427 | 1.0 | 30036.0 | 45011.0 | 47984.0 | 4363.1 |
| active / ticketMs | 49 | 4.1 | 17.3 | 281.6 | 281.6 | 14.9 |
| active / reconnect | 49 | 315.1 | 413.5 | 615.5 | 615.5 | 325.4 |
| active / ackOffline | 9 | 154.8 | 335.0 | 335.0 | 335.0 | 175.7 |
| idle / presence | 15109 | 233.0 | 328.0 | 382.0 | 387.0 | 232.1 |
| viewing / presence | 6103 | 15109.0 | 45877.0 | 47598.0 | 50668.0 | 12537.3 |
| viewing / remote | 798 | 0.5 | 3.7 | 157.8 | 290.3 | 3.7 |
| viewing / ack | 798 | 3.5 | 14.5 | 185.2 | 360.0 | 7.9 |
| viewing / ticketMs | 9 | 4.1 | 4.9 | 4.9 | 4.9 | 3.7 |
| viewing / reconnect | 9 | 306.1 | 404.0 | 404.0 | 404.0 | 308.6 |
| ALL / ack | 37421 | 3.6 | 16.5 | 214.4 | 409.8 | 9.8 |
| ALL / remote | 37421 | 0.5 | 4.0 | 180.3 | 330.5 | 5.1 |
| ALL / presence | 26639 | 230.0 | 30456.0 | 46317.0 | 50668.0 | 3892.8 |
| ALL / ticketMs | 58 | 4.1 | 17.3 | 281.6 | 281.6 | 13.2 |
| ALL / reconnect | 58 | 312.4 | 413.5 | 615.5 | 615.5 | 322.8 |
| ALL / ackOffline | 9 | 154.8 | 335.0 | 335.0 | 335.0 | 175.7 |

Client counters: edits=37430, cursor_updates=8118, deletes=5224, formats=5150, drops=58, reconnects=58

WebSocket close codes seen: 1005=58

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 51.9 | 63.7 | 667 | 351 | 5,000 | 0 | 2,500 | 10 / 10 | 11 (1.5) | 27.1 | 511 | 0.0 | 0 |

Server :4450 persist append: n=43,229 mean 4.0 ms, p95 <= 10.0 ms, p99 <= 50.0 ms; compact: n=143 mean 4.4 ms, p95 <= 10.0 ms, p99 <= 50.0 ms; yjs updates 43,540; HTTP /api (server-side) n=55 mean 7.3 ms, p95 <= 25.0 ms; ws outcomes accepted=55

Generator (10 worker processes): CPU % per worker 4/4/4/4/4/4/4/4/4/4; event-loop lag p99 max 10.9 ms (max 14.6 ms); host load1 max 4.1

```json
{
 "firstAttempt": {
  "ok": 2000
 },
 "connectS": 60,
 "connected": 5000,
 "notConnected": 0,
 "classes": {
  "idle": 2500,
  "viewing": 1500,
  "activeEditors": 1000
 },
 "markerEditsPerSecond": 623.8,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 4,
   "availableMbMin": 28094.5,
   "swapUsedMbMax": 17514.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 50.6,
    "cpuPctMax": 66,
    "rssMbMax": 666.9
   }
  },
  "postgres": {
   "cpuPctAvg": 92.1,
   "cpuPctMax": 104.3,
   "memMbMax": 209.1,
   "commitsPerSecond": 1412.8,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1561.1,
   "walMbPerSecond": 1.2,
   "blockReadMs": 5.4,
   "blockWriteMs": 114,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 6,
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
   "users": 100,
   "connected": 100,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 12.4,
   "remote": {
    "n": 746,
    "min": 0.436767578125,
    "p50": 1.130615234375,
    "p95": 1.493896484375,
    "p99": 1.7265625,
    "mean": 1.269358780684484,
    "max": 108.4677734375
   },
   "ack": {
    "n": 745,
    "min": 2.44775390625,
    "p50": 4.53857421875,
    "p95": 14.17822265625,
    "p99": 15.0009765625,
    "mean": 5.957471030830537,
    "max": 15.623046875
   },
   "presence": {
    "n": 577,
    "min": 0,
    "p50": 3,
    "p95": 17970,
    "p99": 45705,
    "mean": 3526.82842287695,
    "max": 47581
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "users": 250,
   "connected": 250,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 30.8,
   "remote": {
    "n": 1848,
    "min": 0.1982421875,
    "p50": 0.875244140625,
    "p95": 1.240966796875,
    "p99": 1.5166015625,
    "mean": 0.9255256157416802,
    "max": 20.6982421875
   },
   "ack": {
    "n": 1847,
    "min": 1.981201171875,
    "p50": 4.014404296875,
    "p95": 5.525146484375,
    "p99": 13.732421875,
    "mean": 4.2421585520861536,
    "max": 23.880859375
   },
   "presence": {
    "n": 1393,
    "min": 0,
    "p50": 11,
    "p95": 17636,
    "p99": 45281,
    "mean": 3440.64824120603,
    "max": 48408
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
   "editsPerSecond": 60,
   "remote": {
    "n": 3597,
    "min": 0.169189453125,
    "p50": 0.81640625,
    "p95": 1.182861328125,
    "p99": 1.464599609375,
    "mean": 0.9752858013188074,
    "max": 360.07373046875
   },
   "ack": {
    "n": 3596,
    "min": 1.761962890625,
    "p50": 3.56298828125,
    "p95": 4.926025390625,
    "p99": 5.8876953125,
    "mean": 3.6789403455010774,
    "max": 46.80517578125
   },
   "presence": {
    "n": 2724,
    "min": 0,
    "p50": 24,
    "p95": 30336,
    "p99": 46256,
    "mean": 3754.383994126285,
    "max": 47896
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "users": 750,
   "connected": 750,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 88.4,
   "remote": {
    "n": 5301,
    "min": 0.1318359375,
    "p50": 0.731201171875,
    "p95": 1.136474609375,
    "p99": 1.594970703125,
    "mean": 1.0687869549966988,
    "max": 243.957275390625
   },
   "ack": {
    "n": 5300,
    "min": 1.70947265625,
    "p50": 3.343017578125,
    "p95": 4.7421875,
    "p99": 6.299072265625,
    "mean": 3.650939158313679,
    "max": 66.01513671875
   },
   "presence": {
    "n": 4166,
    "min": 0,
    "p50": 53,
    "p95": 30596,
    "p99": 46206,
    "mean": 3943.4673547767643,
    "max": 50939
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "users": 1000,
   "connected": 1000,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 122.1,
   "remote": {
    "n": 7326,
    "min": 0.123779296875,
    "p50": 0.674072265625,
    "p95": 1.07763671875,
    "p99": 2.1318359375,
    "mean": 1.0266211923926767,
    "max": 351.95361328125
   },
   "ack": {
    "n": 7321,
    "min": 1.664306640625,
    "p50": 3.268798828125,
    "p95": 4.58349609375,
    "p99": 7.369873046875,
    "mean": 3.578212405078285,
    "max": 73.920166015625
   },
   "presence": {
    "n": 5925,
    "min": 0,
    "p50": 39,
    "p95": 30889,
    "p99": 46724,
    "mean": 3903.0528270042196,
    "max": 50610
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "users": 1500,
   "connected": 1500,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 180.3,
   "remote": {
    "n": 10814,
    "min": 0.08984375,
    "p50": 0.599365234375,
    "p95": 1.0283203125,
    "p99": 2.5517578125,
    "mean": 0.9798490744058628,
    "max": 274.890625
   },
   "ack": {
    "n": 10812,
    "min": 1.68115234375,
    "p50": 3.1669921875,
    "p95": 4.5791015625,
    "p99": 11.855224609375,
    "mean": 3.608274854292395,
    "max": 91.65576171875
   },
   "presence": {
    "n": 8057,
    "min": 0,
    "p50": 50,
    "p95": 30635,
    "p99": 46437,
    "mean": 3858.3174878987215,
    "max": 49162
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "users": 2000,
   "connected": 2000,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 243.6,
   "remote": {
    "n": 14606,
    "min": 0.081298828125,
    "p50": 0.5380859375,
    "p95": 1.047119140625,
    "p99": 10.464111328125,
    "mean": 1.1960318673886159,
    "max": 295.31396484375
   },
   "ack": {
    "n": 14606,
    "min": 1.590576171875,
    "p50": 3.14599609375,
    "p95": 4.744384765625,
    "p99": 25.291259765625,
    "mean": 3.9129166303392013,
    "max": 119.049072265625
   },
   "presence": {
    "n": 10674,
    "min": 0,
    "p50": 69,
    "p95": 30459,
    "p99": 46267,
    "mean": 3811.34682405846,
    "max": 49843
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "users": 3000,
   "connected": 3000,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 367.5,
   "remote": {
    "n": 22037,
    "min": 0.0810546875,
    "p50": 0.517333984375,
    "p95": 1.200439453125,
    "p99": 66.50146484375,
    "mean": 1.9547819035528315,
    "max": 290.219482421875
   },
   "ack": {
    "n": 22042,
    "min": 1.57275390625,
    "p50": 3.23291015625,
    "p95": 5.354248046875,
    "p99": 77.49169921875,
    "mean": 4.913773201888015,
    "max": 163.982666015625
   },
   "presence": {
    "n": 15990,
    "min": 0,
    "p50": 127,
    "p95": 30456,
    "p99": 46232,
    "mean": 3785.1186991869918,
    "max": 50500
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "users": 5000,
   "connected": 5000,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 623.8,
   "remote": {
    "n": 37421,
    "min": 0.090087890625,
    "p50": 0.544677734375,
    "p95": 4.02001953125,
    "p99": 180.263671875,
    "mean": 5.127588206394387,
    "max": 330.5087890625
   },
   "ack": {
    "n": 37421,
    "min": 1.618408203125,
    "p50": 3.552978515625,
    "p95": 16.471923828125,
    "p99": 214.444091796875,
    "mean": 9.834276141999563,
    "max": 409.80078125
   },
   "presence": {
    "n": 26639,
    "min": 0,
    "p50": 230,
    "p95": 30456,
    "p99": 46317,
    "mean": 3892.824580502271,
    "max": 50668
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  }
 ],
 "maximumStableUsers": 5000,
 "criterion": "all of: p50 <= 50 ms, p95 <= 100 ms, p99 <= 200 ms edit to remote; new connections >= 99.9% on the first attempt; nobody disconnected at the end of the step; watchdog quiet",
 "quiesce": {
  "ok": true,
  "unacked": 0,
  "waitedMs": 502
 },
 "verification": {
  "docs": 2500,
  "checked": 152894,
  "missing": 0,
  "missingSamples": [],
  "unackedAtEnd": 0,
  "exportErrors": 0
 },
 "convergence": {
  "docs": 2500,
  "diverged": 0,
  "clientsCompared": 5000,
  "samples": []
 },
 "systemWholeScenario": {
  "samples": 157,
  "host": {
   "load1Max": 4.1,
   "availableMbMin": 28094.5,
   "swapUsedMbMax": 17514.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 21.5,
    "cpuPctMax": 66,
    "rssMbMax": 666.9
   }
  },
  "postgres": {
   "cpuPctAvg": 35.7,
   "cpuPctMax": 115.9,
   "memMbMax": 209.1,
   "commitsPerSecond": 635.4,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 534.1,
   "walMbPerSecond": 0.4,
   "blockReadMs": 6.1,
   "blockWriteMs": 556.4,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 10,
   "waitingOnLocksMax": 0
  }
 }
}
```