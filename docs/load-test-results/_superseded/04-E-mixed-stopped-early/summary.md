# Performance run (2026-11-14T06:25:02.975Z, topology A)

## E. Escalation of concurrent users (topology A) [ok]

Started 2026-11-14T06:18:19.253Z, ended 2026-11-14T06:25:00.942Z.

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
| idle / presence | 311 | 8.0 | 15.0 | 15.0 | 15.0 | 6.8 |
| viewing / presence | 123 | 15203.0 | 45197.0 | 46727.0 | 47556.0 | 11968.0 |
| viewing / remote | 11 | 1.0 | 1.3 | 1.3 | 1.3 | 1.1 |
| viewing / ack | 11 | 4.8 | 13.7 | 13.7 | 13.7 | 7.0 |
| active / presence | 137 | 1.0 | 17950.0 | 31428.0 | 45890.0 | 4082.8 |
| active / remote | 735 | 1.1 | 1.5 | 2.0 | 118.9 | 1.3 |
| active / ack | 734 | 4.7 | 14.2 | 14.9 | 15.8 | 6.1 |
| active / ticketMs | 1 | 4.6 | 4.6 | 4.6 | 4.6 | 4.6 |
| active / ackOffline | 1 | 131.1 | 131.1 | 131.1 | 131.1 | 131.1 |
| active / reconnect | 1 | 308.9 | 308.9 | 308.9 | 308.9 | 308.9 |
| ALL / presence | 571 | 4.0 | 17950.0 | 45681.0 | 47556.0 | 3561.3 |
| ALL / remote | 746 | 1.1 | 1.5 | 2.0 | 118.9 | 1.3 |
| ALL / ack | 745 | 4.7 | 14.2 | 14.9 | 15.8 | 6.1 |
| ALL / ticketMs | 1 | 4.6 | 4.6 | 4.6 | 4.6 | 4.6 |
| ALL / ackOffline | 1 | 131.1 | 131.1 | 131.1 | 131.1 | 131.1 |
| ALL / reconnect | 1 | 308.9 | 308.9 | 308.9 | 308.9 | 308.9 |

Client counters: cursor_updates=172, edits=746, deletes=102, formats=100, drops=1, reconnects=1

WebSocket close codes seen: 1005=1

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 2.5 | 5.3 | 309 | 155 | 100 | 0 | 50 | 10 / 10 | 0 (0.0) | 21.2 | 91 | 0.0 | 0 |

Server :4450 persist append: n=865 mean 4.9 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; yjs updates 865; HTTP /api (server-side) n=1 mean 2.8 ms, p95 <= 5.0 ms; ws outcomes accepted=1

Generator (10 worker processes): CPU % per worker 1/1/1/1/1/1/1/1/1/0; event-loop lag p99 max 10.5 ms (max 13.0 ms); host load1 max 1.5

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
   "load1Max": 1.5,
   "availableMbMin": 30134.4,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 2.4,
    "cpuPctMax": 5,
    "rssMbMax": 309.5
   }
  },
  "postgres": {
   "cpuPctAvg": 4.7,
   "cpuPctMax": 8.2,
   "memMbMax": 64.6,
   "commitsPerSecond": 31.2,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 32.3,
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
| idle / presence | 768 | 15.0 | 21.0 | 22.0 | 22.0 | 13.8 |
| active / remote | 1797 | 0.9 | 1.3 | 1.5 | 17.7 | 0.9 |
| active / ack | 1797 | 4.0 | 5.6 | 13.6 | 22.0 | 4.2 |
| active / presence | 298 | 1.0 | 17864.0 | 32620.0 | 47599.0 | 5065.4 |
| viewing / presence | 333 | 1.0 | 32079.0 | 46967.0 | 47694.0 | 9688.2 |
| viewing / remote | 50 | 0.9 | 1.4 | 2.0 | 2.0 | 0.9 |
| viewing / ack | 50 | 4.0 | 6.0 | 7.7 | 7.7 | 4.2 |
| viewing / ticketMs | 1 | 3.2 | 3.2 | 3.2 | 3.2 | 3.2 |
| viewing / reconnect | 1 | 326.7 | 326.7 | 326.7 | 326.7 | 326.7 |
| ALL / presence | 1399 | 12.0 | 17598.0 | 45102.0 | 47694.0 | 3392.6 |
| ALL / remote | 1847 | 0.9 | 1.3 | 1.5 | 17.7 | 0.9 |
| ALL / ack | 1847 | 4.0 | 5.6 | 13.6 | 22.0 | 4.2 |
| ALL / ticketMs | 1 | 3.2 | 3.2 | 3.2 | 3.2 | 3.2 |
| ALL / reconnect | 1 | 326.7 | 326.7 | 326.7 | 326.7 | 326.7 |

Client counters: formats=256, edits=1848, deletes=249, cursor_updates=419, drops=1, reconnects=1

WebSocket close codes seen: 1005=1

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 4.2 | 5.0 | 324 | 162 | 250 | 0 | 125 | 10 / 10 | 0 (0.0) | 21.5 | 56 | 0.0 | 0 |

Server :4450 persist append: n=2,133 mean 3.1 ms, p95 <= 5.0 ms, p99 <= 25.0 ms; compact: n=8 mean 3.1 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 2,137; HTTP /api (server-side) n=1 mean 1.6 ms, p95 <= 5.0 ms; ws outcomes accepted=1

Generator (10 worker processes): CPU % per worker 1/1/1/1/1/1/1/1/1/1; event-loop lag p99 max 10.7 ms (max 13.3 ms); host load1 max 2.0

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
   "load1Max": 1.8,
   "availableMbMin": 30110.7,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 4.5,
    "cpuPctMax": 7.2,
    "rssMbMax": 324.2
   }
  },
  "postgres": {
   "cpuPctAvg": 7.6,
   "cpuPctMax": 10.3,
   "memMbMax": 77.8,
   "commitsPerSecond": 63.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 76.7,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0,
   "blockWriteMs": 7.6,
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
| idle / presence | 1520 | 36.0 | 48.0 | 49.0 | 49.0 | 29.7 |
| active / remote | 3507 | 0.8 | 1.2 | 1.5 | 285.6 | 1.0 |
| active / ack | 3507 | 3.6 | 5.0 | 6.0 | 51.7 | 3.7 |
| active / presence | 599 | 1.0 | 30048.0 | 32654.0 | 46819.0 | 4392.7 |
| active / ticketMs | 7 | 4.2 | 4.6 | 4.6 | 4.6 | 4.1 |
| active / reconnect | 7 | 321.7 | 341.5 | 341.5 | 341.5 | 305.6 |
| active / ackOffline | 2 | 79.8 | 298.0 | 298.0 | 298.0 | 188.9 |
| viewing / presence | 604 | 15015.0 | 46090.0 | 47763.0 | 47995.0 | 12521.0 |
| viewing / remote | 82 | 0.8 | 1.2 | 28.4 | 28.4 | 1.1 |
| viewing / ack | 82 | 3.6 | 4.9 | 33.1 | 33.1 | 4.0 |
| ALL / presence | 2723 | 25.0 | 30373.0 | 46294.0 | 47995.0 | 3760.2 |
| ALL / remote | 3589 | 0.8 | 1.2 | 1.6 | 285.6 | 1.0 |
| ALL / ack | 3589 | 3.6 | 5.0 | 6.0 | 51.7 | 3.8 |
| ALL / ticketMs | 7 | 4.2 | 4.6 | 4.6 | 4.6 | 4.1 |
| ALL / reconnect | 7 | 321.7 | 341.5 | 341.5 | 341.5 | 305.6 |
| ALL / ackOffline | 2 | 79.8 | 298.0 | 298.0 | 298.0 | 188.9 |

Client counters: deletes=502, edits=3592, cursor_updates=811, formats=465, drops=7, reconnects=7

WebSocket close codes seen: 1005=7

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 7.2 | 9.4 | 352 | 175 | 500 | 0 | 250 | 10 / 10 | 0 (0.0) | 21.2 | 39 | 0.0 | 0 |

Server :4450 persist append: n=4,190 mean 2.8 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=14 mean 2.8 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 4,202; HTTP /api (server-side) n=6 mean 2.6 ms, p95 <= 5.0 ms; ws outcomes accepted=6

Generator (10 worker processes): CPU % per worker 1/1/1/1/1/1/1/1/1/1; event-loop lag p99 max 10.8 ms (max 13.3 ms); host load1 max 2.0

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
 "markerEditsPerSecond": 59.9,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 2.1,
   "availableMbMin": 30035.4,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 7.1,
    "cpuPctMax": 9.4,
    "rssMbMax": 352.3
   }
  },
  "postgres": {
   "cpuPctAvg": 10.9,
   "cpuPctMax": 13.1,
   "memMbMax": 79.5,
   "commitsPerSecond": 138.8,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 150.9,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0,
   "blockWriteMs": 13.1,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 0,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 750 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| idle / presence | 2264 | 21.0 | 58.0 | 59.0 | 59.0 | 29.6 |
| active / remote | 5188 | 0.7 | 1.1 | 1.6 | 266.5 | 0.9 |
| active / ack | 5188 | 3.4 | 4.7 | 5.9 | 62.1 | 3.6 |
| active / presence | 878 | 1.0 | 30355.0 | 32818.0 | 47845.0 | 4580.6 |
| active / ticketMs | 8 | 3.6 | 4.3 | 4.3 | 4.3 | 3.7 |
| active / reconnect | 8 | 356.5 | 410.0 | 410.0 | 410.0 | 333.7 |
| active / ackOffline | 4 | 40.1 | 278.6 | 278.6 | 278.6 | 101.5 |
| viewing / presence | 970 | 15076.0 | 45861.0 | 47484.0 | 50703.0 | 12633.5 |
| viewing / remote | 115 | 0.7 | 1.1 | 1.3 | 1.3 | 0.7 |
| viewing / ack | 115 | 3.4 | 4.5 | 5.0 | 5.6 | 3.4 |
| ALL / presence | 4112 | 20.0 | 30654.0 | 46162.0 | 50703.0 | 3974.5 |
| ALL / remote | 5303 | 0.7 | 1.1 | 1.5 | 266.5 | 0.9 |
| ALL / ack | 5303 | 3.4 | 4.7 | 5.8 | 62.1 | 3.6 |
| ALL / ticketMs | 8 | 3.6 | 4.3 | 4.3 | 4.3 | 3.7 |
| ALL / reconnect | 8 | 356.5 | 410.0 | 410.0 | 410.0 | 333.7 |
| ALL / ackOffline | 4 | 40.1 | 278.6 | 278.6 | 278.6 | 101.5 |

Client counters: edits=5306, deletes=761, formats=754, cursor_updates=1225, drops=8, reconnects=8

WebSocket close codes seen: 1005=8

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 9.1 | 11.1 | 369 | 176 | 750 | 0 | 375 | 10 / 10 | 0 (0.0) | 21.4 | 28 | 0.0 | 0 |

Server :4450 persist append: n=6,294 mean 2.7 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=28 mean 3.2 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 6,314; HTTP /api (server-side) n=8 mean 2.1 ms, p95 <= 5.0 ms; ws outcomes accepted=8

Generator (10 worker processes): CPU % per worker 1/1/1/1/1/1/1/1/1/1; event-loop lag p99 max 10.9 ms (max 13.5 ms); host load1 max 1.4

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
   "load1Max": 1.4,
   "availableMbMin": 29962.2,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 9.2,
    "cpuPctMax": 12,
    "rssMbMax": 368.5
   }
  },
  "postgres": {
   "cpuPctAvg": 14.6,
   "cpuPctMax": 17.9,
   "memMbMax": 89.5,
   "commitsPerSecond": 222,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 221.4,
   "walMbPerSecond": 0.2,
   "blockReadMs": 0,
   "blockWriteMs": 17.8,
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
| idle / presence | 3034 | 59.0 | 70.0 | 71.0 | 72.0 | 48.4 |
| active / remote | 7102 | 0.7 | 1.1 | 2.8 | 244.9 | 1.0 |
| active / ack | 7096 | 3.3 | 4.6 | 7.8 | 70.7 | 3.6 |
| active / presence | 1075 | 1.0 | 30253.0 | 32901.0 | 47428.0 | 4432.6 |
| active / ticketMs | 11 | 3.6 | 4.0 | 4.0 | 4.0 | 3.5 |
| active / reconnect | 11 | 331.7 | 396.2 | 396.2 | 396.2 | 327.0 |
| active / ackOffline | 7 | 120.1 | 257.8 | 257.8 | 257.8 | 135.7 |
| viewing / remote | 178 | 0.7 | 1.1 | 1.2 | 2.5 | 0.7 |
| viewing / ack | 178 | 3.3 | 4.5 | 5.3 | 22.1 | 3.5 |
| viewing / presence | 1301 | 15367.0 | 46172.0 | 47603.0 | 50146.0 | 13699.6 |
| viewing / ticketMs | 2 | 3.6 | 4.4 | 4.4 | 4.4 | 4.0 |
| viewing / reconnect | 2 | 234.1 | 390.6 | 390.6 | 390.6 | 312.3 |
| ALL / presence | 5410 | 58.0 | 31204.0 | 46777.0 | 50146.0 | 4202.4 |
| ALL / remote | 7280 | 0.7 | 1.1 | 2.8 | 244.9 | 1.0 |
| ALL / ack | 7274 | 3.3 | 4.6 | 7.8 | 70.7 | 3.6 |
| ALL / ticketMs | 13 | 3.6 | 4.4 | 4.4 | 4.4 | 3.6 |
| ALL / reconnect | 13 | 331.7 | 396.2 | 396.2 | 396.2 | 324.7 |
| ALL / ackOffline | 7 | 120.1 | 257.8 | 257.8 | 257.8 | 135.7 |

Client counters: formats=1056, edits=7281, deletes=1034, cursor_updates=1583, drops=14, reconnects=13

WebSocket close codes seen: 1005=14

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 11.3 | 16.4 | 423 | 195 | 1,000 | 0 | 500 | 10 / 10 | 0 (0.0) | 26.1 | 62 | 0.0 | 0 |

Server :4450 persist append: n=8,609 mean 2.6 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=39 mean 3.1 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 8,647; HTTP /api (server-side) n=13 mean 2.3 ms, p95 <= 5.0 ms; ws outcomes accepted=13

Generator (10 worker processes): CPU % per worker 2/2/2/1/1/1/1/2/1/1; event-loop lag p99 max 10.9 ms (max 13.3 ms); host load1 max 1.7

```json
{
 "firstAttempt": {
  "ok": 250
 },
 "connectS": 19.9,
 "connected": 999,
 "notConnected": 1,
 "classes": {
  "idle": 500,
  "viewing": 300,
  "activeEditors": 200
 },
 "markerEditsPerSecond": 121.3,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 1.7,
   "availableMbMin": 29806.9,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 11.4,
    "cpuPctMax": 16.4,
    "rssMbMax": 422.9
   }
  },
  "postgres": {
   "cpuPctAvg": 20.3,
   "cpuPctMax": 24.2,
   "memMbMax": 101.1,
   "commitsPerSecond": 301.4,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 304.6,
   "walMbPerSecond": 0.2,
   "blockReadMs": 0,
   "blockWriteMs": 22.7,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 3,
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
    "min": 0.321533203125,
    "p50": 1.09423828125,
    "p95": 1.47802734375,
    "p99": 1.98193359375,
    "mean": 1.261570498387232,
    "max": 118.9013671875
   },
   "ack": {
    "n": 745,
    "min": 2.210205078125,
    "p50": 4.703125,
    "p95": 14.214599609375,
    "p99": 14.85205078125,
    "mean": 6.082970454068792,
    "max": 15.77392578125
   },
   "presence": {
    "n": 571,
    "min": 0,
    "p50": 4,
    "p95": 17950,
    "p99": 45681,
    "mean": 3561.3204903677756,
    "max": 47556
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
    "n": 1847,
    "min": 0.177978515625,
    "p50": 0.9033203125,
    "p95": 1.252197265625,
    "p99": 1.48828125,
    "mean": 0.9268909200307932,
    "max": 17.737060546875
   },
   "ack": {
    "n": 1847,
    "min": 1.858154296875,
    "p50": 3.99609375,
    "p95": 5.595947265625,
    "p99": 13.570556640625,
    "mean": 4.165656485813143,
    "max": 22.018310546875
   },
   "presence": {
    "n": 1399,
    "min": 0,
    "p50": 12,
    "p95": 17598,
    "p99": 45102,
    "mean": 3392.606147248034,
    "max": 47694
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
   "editsPerSecond": 59.9,
   "remote": {
    "n": 3589,
    "min": 0.1728515625,
    "p50": 0.819580078125,
    "p95": 1.209716796875,
    "p99": 1.5546875,
    "mean": 1.0182782351455837,
    "max": 285.57568359375
   },
   "ack": {
    "n": 3589,
    "min": 1.679931640625,
    "p50": 3.592529296875,
    "p95": 5.03759765625,
    "p99": 6.0341796875,
    "mean": 3.7521199215484815,
    "max": 51.678955078125
   },
   "presence": {
    "n": 2723,
    "min": 0,
    "p50": 25,
    "p95": 30373,
    "p99": 46294,
    "mean": 3760.225853837679,
    "max": 47995
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
    "n": 5303,
    "min": 0.14013671875,
    "p50": 0.73046875,
    "p95": 1.13671875,
    "p99": 1.519287109375,
    "mean": 0.922005334171106,
    "max": 266.506103515625
   },
   "ack": {
    "n": 5303,
    "min": 1.748291015625,
    "p50": 3.38427734375,
    "p95": 4.734375,
    "p99": 5.76416015625,
    "mean": 3.5536355269128324,
    "max": 62.1357421875
   },
   "presence": {
    "n": 4112,
    "min": 0,
    "p50": 20,
    "p95": 30654,
    "p99": 46162,
    "mean": 3974.4992704280157,
    "max": 50703
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
   "editsPerSecond": 121.3,
   "remote": {
    "n": 7280,
    "min": 0.095703125,
    "p50": 0.652099609375,
    "p95": 1.0634765625,
    "p99": 2.766845703125,
    "mean": 1.0254633306146979,
    "max": 244.869873046875
   },
   "ack": {
    "n": 7274,
    "min": 1.665771484375,
    "p50": 3.286865234375,
    "p95": 4.599853515625,
    "p99": 7.81982421875,
    "mean": 3.608071596503815,
    "max": 70.670654296875
   },
   "presence": {
    "n": 5410,
    "min": 0,
    "p50": 58,
    "p95": 31204,
    "p99": 46777,
    "mean": 4202.4173752310535,
    "max": 50146
   },
   "verdict": {
    "stable": false,
    "reasons": [
     "1 clients not connected at the end"
    ]
   }
  }
 ],
 "maximumStableUsers": 750,
 "criterion": "all of: p50 <= 50 ms, p95 <= 100 ms, p99 <= 200 ms edit to remote; new connections >= 99.9% on the first attempt; nobody disconnected at the end of the step; watchdog quiet",
 "quiesce": {
  "ok": true,
  "unacked": 0,
  "waitedMs": 502
 },
 "verification": {
  "docs": 500,
  "checked": 24004,
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
  "samples": 80,
  "host": {
   "load1Max": 2.4,
   "availableMbMin": 29806.9,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 8.2,
    "cpuPctMax": 24.6,
    "rssMbMax": 422.9
   }
  },
  "postgres": {
   "cpuPctAvg": 15.4,
   "cpuPctMax": 75.4,
   "memMbMax": 101.1,
   "commitsPerSecond": 205.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 168,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0.5,
   "blockWriteMs": 101.3,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 3,
   "waitingOnLocksMax": 0
  }
 }
}
```
