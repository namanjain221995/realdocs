# Performance run (2026-11-14T07:04:39.716Z, topology A)

## E. Escalation of concurrent users (topology A) [ok]

Started 2026-11-14T06:50:08.867Z, ended 2026-11-14T07:04:37.627Z.

```json
{
 "steps": [
  200,
  500,
  1000,
  1500,
  2000,
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

#### 200 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 7274 | 0.7 | 1.1 | 1.3 | 185.7 | 0.8 |
| ack | 7272 | 3.4 | 4.7 | 5.7 | 18.6 | 3.4 |
| presence | 1272 | 1.0 | 17814.0 | 32708.0 | 47991.0 | 3895.2 |
| ticketMs | 11 | 4.2 | 4.7 | 4.7 | 4.7 | 4.1 |
| reconnect | 11 | 317.5 | 378.5 | 378.5 | 378.5 | 318.8 |
| ackOffline | 4 | 130.5 | 200.4 | 200.4 | 200.4 | 158.6 |

Client counters: edits=7276, cursor_updates=1051, deletes=1034, formats=1018, drops=11, reconnects=11

WebSocket close codes seen: 1005=11

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 10.4 | 12.5 | 319 | 157 | 200 | 0 | 100 | 10 / 10 | 0 (0.0) | 21.5 | 56 | 0.0 | 0 |

Server :4450 persist append: n=8,540 mean 2.6 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 8,560; HTTP /api (server-side) n=11 mean 2.5 ms, p95 <= 5.0 ms; ws outcomes accepted=11

Generator (10 worker processes): CPU % per worker 1/1/1/1/1/1/1/1/1/1; event-loop lag p99 max 10.8 ms (max 12.8 ms); host load1 max 3.0

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
   "load1Max": 3.1,
   "availableMbMin": 29813.3,
   "swapUsedMbMax": 17514.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 10.6,
    "cpuPctMax": 12.2,
    "rssMbMax": 318.6
   }
  },
  "postgres": {
   "cpuPctAvg": 18.4,
   "cpuPctMax": 23.4,
   "memMbMax": 76.7,
   "commitsPerSecond": 183,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 304.2,
   "walMbPerSecond": 0.2,
   "blockReadMs": 0.2,
   "blockWriteMs": 24,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 2,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 500 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 18164 | 0.6 | 1.0 | 1.3 | 397.0 | 0.7 |
| ack | 18157 | 3.2 | 4.5 | 5.8 | 20.2 | 3.3 |
| presence | 3195 | 1.0 | 17860.0 | 32867.0 | 47957.0 | 4256.3 |
| ticketMs | 25 | 3.8 | 5.1 | 7.0 | 7.0 | 3.8 |
| reconnect | 25 | 357.9 | 409.4 | 412.6 | 412.6 | 322.5 |
| ackOffline | 6 | 152.4 | 409.6 | 409.6 | 409.6 | 219.3 |

Client counters: edits=18165, formats=2574, cursor_updates=2656, deletes=2653, drops=25, reconnects=25

WebSocket close codes seen: 1005=25

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 20.2 | 23.7 | 339 | 178 | 500 | 0 | 250 | 10 / 10 | 0 (0.0) | 21.1 | 189 | 0.0 | 0 |

Server :4450 persist append: n=21,494 mean 2.6 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=88 mean 3.0 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; yjs updates 21,530; HTTP /api (server-side) n=25 mean 2.1 ms, p95 <= 5.0 ms; ws outcomes accepted=25

Generator (10 worker processes): CPU % per worker 2/2/2/2/3/3/2/3/3/2; event-loop lag p99 max 10.9 ms (max 11.6 ms); host load1 max 2.3

```json
{
 "firstAttempt": {
  "ok": 300
 },
 "connectS": 19.9,
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
   "load1Max": 2.3,
   "availableMbMin": 29911.2,
   "swapUsedMbMax": 17514.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 20.2,
    "cpuPctMax": 22.8,
    "rssMbMax": 339.3
   }
  },
  "postgres": {
   "cpuPctAvg": 45,
   "cpuPctMax": 55,
   "memMbMax": 108.1,
   "commitsPerSecond": 451.8,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 757,
   "walMbPerSecond": 0.5,
   "blockReadMs": 0.1,
   "blockWriteMs": 58.3,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 3,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 1000 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 36777 | 0.5 | 1.2 | 2.3 | 367.5 | 0.7 |
| ack | 36775 | 3.4 | 4.9 | 7.3 | 52.5 | 3.5 |
| presence | 5985 | 1.0 | 17939.0 | 32853.0 | 47960.0 | 4268.3 |
| ticketMs | 59 | 4.2 | 6.8 | 10.9 | 10.9 | 4.4 |
| ackOffline | 18 | 158.3 | 377.5 | 377.5 | 377.5 | 172.7 |
| reconnect | 59 | 312.1 | 416.5 | 417.6 | 417.6 | 316.5 |

Client counters: edits=36793, formats=5210, cursor_updates=5226, deletes=5379, drops=59, reconnects=59

WebSocket close codes seen: 1005=59

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 39.4 | 44.2 | 532 | 292 | 1,000 | 0 | 500 | 10 / 10 | 0 (0.0) | 21.9 | 180 | 0.0 | 0 |

Server :4450 persist append: n=45,767 mean 2.8 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; compact: n=142 mean 3.3 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; yjs updates 45,915; HTTP /api (server-side) n=59 mean 2.6 ms, p95 <= 10.0 ms; ws outcomes accepted=59

Generator (10 worker processes): CPU % per worker 3/4/3/3/4/3/3/3/4/4; event-loop lag p99 max 10.9 ms (max 13.4 ms); host load1 max 3.5

```json
{
 "firstAttempt": {
  "ok": 500
 },
 "connectS": 22.5,
 "connected": 1000,
 "notConnected": 0,
 "classes": {
  "idle": 0,
  "viewing": 0,
  "activeEditors": 1000
 },
 "markerEditsPerSecond": 613.2,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 3.2,
   "availableMbMin": 29558.4,
   "swapUsedMbMax": 17514.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 38.9,
    "cpuPctMax": 41.8,
    "rssMbMax": 531.7
   }
  },
  "postgres": {
   "cpuPctAvg": 84.4,
   "cpuPctMax": 94.4,
   "memMbMax": 165,
   "commitsPerSecond": 920.6,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1530.5,
   "walMbPerSecond": 1.1,
   "blockReadMs": 0,
   "blockWriteMs": 108.2,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 4,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 1500 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 55473 | 0.6 | 1.8 | 4.3 | 330.7 | 0.8 |
| ack | 55463 | 3.9 | 6.8 | 14.1 | 56.6 | 4.3 |
| presence | 8826 | 1.0 | 17936.0 | 32933.0 | 49493.0 | 4154.3 |
| ticketMs | 81 | 4.6 | 9.0 | 17.7 | 17.7 | 5.4 |
| reconnect | 81 | 313.1 | 410.8 | 424.9 | 424.9 | 321.2 |
| ackOffline | 11 | 203.4 | 343.1 | 343.1 | 343.1 | 208.5 |

Client counters: edits=55480, cursor_updates=8055, formats=7886, drops=81, deletes=7953, reconnects=81

WebSocket close codes seen: 1005=81

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 58.0 | 59.8 | 633 | 379 | 1,500 | 0 | 750 | 10 / 10 | 39 (3.9) | 23.1 | 994 | 0.0 | 0 |

Server :4450 persist append: n=67,027 mean 3.4 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; compact: n=325 mean 4.0 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 67,241; HTTP /api (server-side) n=78 mean 3.3 ms, p95 <= 10.0 ms; ws outcomes accepted=78

Generator (10 worker processes): CPU % per worker 5/5/5/5/5/5/5/5/5/5; event-loop lag p99 max 10.9 ms (max 13.1 ms); host load1 max 4.6

```json
{
 "firstAttempt": {
  "ok": 500
 },
 "connectS": 22.5,
 "connected": 1500,
 "notConnected": 0,
 "classes": {
  "idle": 0,
  "viewing": 0,
  "activeEditors": 1500
 },
 "markerEditsPerSecond": 924.7,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 4.6,
   "availableMbMin": 28944.2,
   "swapUsedMbMax": 17514.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 58.1,
    "cpuPctMax": 60.6,
    "rssMbMax": 625.7
   }
  },
  "postgres": {
   "cpuPctAvg": 157.3,
   "cpuPctMax": 192.1,
   "memMbMax": 210.6,
   "commitsPerSecond": 1270.6,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 2299.8,
   "walMbPerSecond": 2,
   "blockReadMs": 1,
   "blockWriteMs": 207.2,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 6,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 2000 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| presence | 11093 | 1.0 | 17970.0 | 32849.0 | 48526.0 | 4263.2 |
| remote | 72972 | 0.7 | 2.8 | 6.5 | 359.3 | 1.1 |
| ack | 72964 | 4.0 | 8.1 | 16.0 | 79.9 | 4.6 |
| ticketMs | 124 | 4.8 | 10.0 | 13.4 | 14.3 | 5.4 |
| reconnect | 124 | 328.3 | 405.3 | 417.2 | 420.4 | 322.5 |
| ackOffline | 32 | 134.6 | 312.0 | 373.3 | 373.3 | 154.6 |

Client counters: cursor_updates=10286, edits=72996, deletes=10468, formats=10418, drops=124, reconnects=124

WebSocket close codes seen: 1005=124

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 67.9 | 73.7 | 740 | 485 | 2,000 | 0 | 1,000 | 10 / 10 | 41 (3.8) | 23.8 | 1,159 | 0.0 | 0 |

Server :4450 persist append: n=86,587 mean 3.6 ms, p95 <= 10.0 ms, p99 <= 25.0 ms; compact: n=376 mean 4.1 ms, p95 <= 10.0 ms, p99 <= 25.0 ms; yjs updates 86,956; HTTP /api (server-side) n=118 mean 3.5 ms, p95 <= 10.0 ms; ws outcomes accepted=118

Generator (10 worker processes): CPU % per worker 6/6/6/6/6/6/6/6/6/7; event-loop lag p99 max 11.0 ms (max 13.5 ms); host load1 max 5.7

```json
{
 "firstAttempt": {
  "ok": 500
 },
 "connectS": 22.5,
 "connected": 2000,
 "notConnected": 0,
 "classes": {
  "idle": 0,
  "viewing": 0,
  "activeEditors": 2000
 },
 "markerEditsPerSecond": 1216.6,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 5.7,
   "availableMbMin": 28391.6,
   "swapUsedMbMax": 17514.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 67.9,
    "cpuPctMax": 74.4,
    "rssMbMax": 740.4
   }
  },
  "postgres": {
   "cpuPctAvg": 176.7,
   "cpuPctMax": 189.1,
   "memMbMax": 216.7,
   "commitsPerSecond": 1836.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 3058.7,
   "walMbPerSecond": 2.3,
   "blockReadMs": 17.4,
   "blockWriteMs": 211.7,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 10,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 3000 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 111168 | 0.5 | 3.5 | 6.9 | 379.7 | 1.1 |
| ack | 111174 | 4.4 | 12.0 | 25.7 | 403.5 | 5.9 |
| presence | 16707 | 1.0 | 17929.0 | 32982.0 | 49283.0 | 4149.7 |
| ticketMs | 153 | 5.9 | 19.8 | 28.5 | 30.4 | 7.6 |
| reconnect | 153 | 333.2 | 412.8 | 427.9 | 431.5 | 328.9 |
| ackOffline | 30 | 192.6 | 377.3 | 393.2 | 393.2 | 196.9 |

Client counters: deletes=15735, formats=15813, edits=111197, cursor_updates=15881, drops=153, reconnects=153

WebSocket close codes seen: 1005=153

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 64.8 | 73.1 | 915 | 568 | 3,000 | 0 | 1,500 | 10 / 10 | 204 (20.0) | 24.9 | 7,196 | 0.0 | 0 |

Server :4450 persist append: n=134,986 mean 4.8 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; compact: n=487 mean 5.8 ms, p95 <= 25.0 ms, p99 <= 50.0 ms; yjs updates 135,567; HTTP /api (server-side) n=148 mean 5.3 ms, p95 <= 25.0 ms; ws outcomes accepted=148

Generator (10 worker processes): CPU % per worker 9/9/10/10/9/9/9/10/9/9; event-loop lag p99 max 11.0 ms (max 14.6 ms); host load1 max 6.6

```json
{
 "firstAttempt": {
  "ok": 1000
 },
 "connectS": 35,
 "connected": 3000,
 "notConnected": 0,
 "classes": {
  "idle": 0,
  "viewing": 0,
  "activeEditors": 3000
 },
 "markerEditsPerSecond": 1853.3,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 6.6,
   "availableMbMin": 28024.6,
   "swapUsedMbMax": 17514.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 64.8,
    "cpuPctMax": 75,
    "rssMbMax": 914.8
   }
  },
  "postgres": {
   "cpuPctAvg": 301.3,
   "cpuPctMax": 412.5,
   "memMbMax": 227.8,
   "commitsPerSecond": 2637.8,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 4606.1,
   "walMbPerSecond": 4,
   "blockReadMs": 9.9,
   "blockWriteMs": 352.4,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 10,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 4000 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ack | 151259 | 80.9 | 188.7 | 262.1 | 1368.0 | 86.8 |
| presence | 21900 | 1.0 | 17942.0 | 32944.0 | 50524.0 | 4146.8 |
| remote | 151217 | 0.5 | 4.1 | 15.0 | 1138.6 | 1.7 |
| ticketMs | 257 | 254.9 | 485.3 | 561.1 | 585.2 | 245.6 |
| reconnect | 257 | 729.4 | 1166.9 | 1425.1 | 1481.4 | 744.7 |
| ackOffline | 116 | 536.3 | 1138.6 | 3115.7 | 6776.2 | 610.8 |

Client counters: deletes=21703, cursor_updates=21502, edits=151330, formats=21373, drops=257, reconnects=257

WebSocket close codes seen: 1005=257

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 74.5 | 83.6 | 936 | 553 | 4,000 | 0 | 2,000 | 10 / 10 | 572 (217.6) | 37.3 | 18,133 | 0.0 | 0 |

Server :4450 persist append: n=182,917 mean 79.5 ms, p95 <= 250.0 ms, p99 <= 250.0 ms; compact: n=921 mean 85.2 ms, p95 <= 250.0 ms, p99 <= 250.0 ms; yjs updates 185,647; HTTP /api (server-side) n=255 mean 244.5 ms, p95 <= 500.0 ms; ws outcomes accepted=255

Generator (10 worker processes): CPU % per worker 13/12/12/12/13/12/12/12/13/12; event-loop lag p99 max 11.0 ms (max 15.3 ms); host load1 max 8.9

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
 "markerEditsPerSecond": 2522.1,
 "completedFullDuration": true,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 8.9,
   "availableMbMin": 27646.6,
   "swapUsedMbMax": 17526.1
  },
  "server": {
   "4450": {
    "cpuPctAvg": 74.7,
    "cpuPctMax": 84.2,
    "rssMbMax": 936.2
   }
  },
  "postgres": {
   "cpuPctAvg": 393.3,
   "cpuPctMax": 403.2,
   "memMbMax": 242.2,
   "commitsPerSecond": 3298.1,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 6108.5,
   "walMbPerSecond": 4.7,
   "blockReadMs": 85.4,
   "blockWriteMs": 506,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 10,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### 5000 users (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ack | 213176 | 839.4 | 1268.3 | 1572.2 | 6073.9 | 877.7 |
| remote | 213413 | 0.6 | 10.0 | 140.6 | 4163.4 | 9.3 |
| presence | 28791 | 1.0 | 30078.0 | 45117.0 | 49869.0 | 4220.6 |
| ackOffline | 836 | 2420.6 | 4325.8 | 4969.4 | 7066.1 | 2505.2 |
| reconnect | 296 | 4150.6 | 5004.1 | 5339.9 | 5544.6 | 4214.3 |
| ticketMs | 304 | 1857.1 | 2339.8 | 2544.0 | 2737.2 | 1917.2 |

Client counters: cursor_updates=30196, formats=30310, deletes=30465, edits=214250, drops=299, reconnects=296

WebSocket close codes seen: 1005=299

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 94.9 | 112.4 | 1,738 | 1,250 | 4,994 | 0 | 2,500 | 10 / 10 | 2,102 (1792.9) | 88.1 | 138,902 | 0.0 | 0 |

Server :4450 persist append: n=166,352 mean 628.8 ms, p95 <= 1000.0 ms, p99 <= 2500.0 ms; compact: n=870 mean 631.4 ms, p95 <= 1000.0 ms, p99 <= 1000.0 ms; yjs updates 228,751; HTTP /api (server-side) n=253 mean 1892.5 ms, p95 <= 2500.0 ms; ws outcomes accepted=253

Generator (10 worker processes): CPU % per worker 14/14/14/14/15/15/14/15/15/15; event-loop lag p99 max 11.0 ms (max 38.1 ms); host load1 max 10.4

```json
{
 "firstAttempt": {
  "ok": 1000
 },
 "connectS": 39.2,
 "connected": 4981,
 "notConnected": 19,
 "classes": {
  "idle": 0,
  "viewing": 0,
  "activeEditors": 5000
 },
 "markerEditsPerSecond": 3570.8,
 "completedFullDuration": true,
 "system": {
  "samples": 13,
  "host": {
   "load1Max": 10.4,
   "availableMbMin": 26473.4,
   "swapUsedMbMax": 17529.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 94.4,
    "cpuPctMax": 113,
    "rssMbMax": 1738.5
   }
  },
  "postgres": {
   "cpuPctAvg": 369.5,
   "cpuPctMax": 379.7,
   "memMbMax": 253.6,
   "commitsPerSecond": 2846.7,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 6010.2,
   "walMbPerSecond": 5.7,
   "blockReadMs": 84.7,
   "blockWriteMs": 537.5,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 10,
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
    "n": 7274,
    "min": 0.095458984375,
    "p50": 0.70849609375,
    "p95": 1.103515625,
    "p99": 1.3408203125,
    "mean": 0.8000577224425178,
    "max": 185.743896484375
   },
   "ack": {
    "n": 7272,
    "min": 1.71337890625,
    "p50": 3.3515625,
    "p95": 4.668212890625,
    "p99": 5.69970703125,
    "mean": 3.4177369976987935,
    "max": 18.649658203125
   },
   "presence": {
    "n": 1272,
    "min": 0,
    "p50": 1,
    "p95": 17814,
    "p99": 32708,
    "mean": 3895.151729559748,
    "max": 47991
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
    "n": 18164,
    "min": 0.102294921875,
    "p50": 0.557373046875,
    "p95": 1.00048828125,
    "p99": 1.33203125,
    "mean": 0.6636839503103666,
    "max": 396.996337890625
   },
   "ack": {
    "n": 18157,
    "min": 1.6259765625,
    "p50": 3.207275390625,
    "p95": 4.54833984375,
    "p99": 5.848388671875,
    "mean": 3.283626596104464,
    "max": 20.2216796875
   },
   "presence": {
    "n": 3195,
    "min": 0,
    "p50": 1,
    "p95": 17860,
    "p99": 32867,
    "mean": 4256.250078247262,
    "max": 47957
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
   "editsPerSecond": 613.2,
   "remote": {
    "n": 36777,
    "min": 0.081787109375,
    "p50": 0.522216796875,
    "p95": 1.175048828125,
    "p99": 2.281494140625,
    "mean": 0.7062069857902018,
    "max": 367.538330078125
   },
   "ack": {
    "n": 36775,
    "min": 1.60205078125,
    "p50": 3.3623046875,
    "p95": 4.949462890625,
    "p99": 7.283935546875,
    "mean": 3.5234234324545377,
    "max": 52.516357421875
   },
   "presence": {
    "n": 5985,
    "min": 0,
    "p50": 1,
    "p95": 17939,
    "p99": 32853,
    "mean": 4268.272514619883,
    "max": 47960
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
   "editsPerSecond": 924.7,
   "remote": {
    "n": 55473,
    "min": 0.079833984375,
    "p50": 0.573974609375,
    "p95": 1.792236328125,
    "p99": 4.2705078125,
    "mean": 0.8344930244077073,
    "max": 330.691650390625
   },
   "ack": {
    "n": 55463,
    "min": 1.681884765625,
    "p50": 3.91845703125,
    "p95": 6.8388671875,
    "p99": 14.1279296875,
    "mean": 4.328778267542945,
    "max": 56.63330078125
   },
   "presence": {
    "n": 8826,
    "min": 0,
    "p50": 1,
    "p95": 17936,
    "p99": 32933,
    "mean": 4154.321323362792,
    "max": 49493
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
   "editsPerSecond": 1216.6,
   "remote": {
    "n": 72972,
    "min": 0.075927734375,
    "p50": 0.653076171875,
    "p95": 2.80615234375,
    "p99": 6.45849609375,
    "mean": 1.0789081155486009,
    "max": 359.29443359375
   },
   "ack": {
    "n": 72964,
    "min": 1.631591796875,
    "p50": 4.004638671875,
    "p95": 8.142578125,
    "p99": 15.9599609375,
    "mean": 4.606755172740367,
    "max": 79.931884765625
   },
   "presence": {
    "n": 11093,
    "min": 0,
    "p50": 1,
    "p95": 17970,
    "p99": 32849,
    "mean": 4263.157035968629,
    "max": 48526
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
   "editsPerSecond": 1853.3,
   "remote": {
    "n": 111168,
    "min": 0.088623046875,
    "p50": 0.453125,
    "p95": 3.53662109375,
    "p99": 6.866455078125,
    "mean": 1.063460662437707,
    "max": 379.7158203125
   },
   "ack": {
    "n": 111174,
    "min": 1.669189453125,
    "p50": 4.365234375,
    "p95": 11.998779296875,
    "p99": 25.688232421875,
    "mean": 5.872918137562655,
    "max": 403.45263671875
   },
   "presence": {
    "n": 16707,
    "min": 0,
    "p50": 1,
    "p95": 17929,
    "p99": 32982,
    "mean": 4149.651762734184,
    "max": 49283
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
   "editsPerSecond": 2522.1,
   "remote": {
    "n": 151217,
    "min": 0.0859375,
    "p50": 0.45947265625,
    "p95": 4.050048828125,
    "p99": 14.971435546875,
    "mean": 1.6644376625612944,
    "max": 1138.559326171875
   },
   "ack": {
    "n": 151259,
    "min": 1.849365234375,
    "p50": 80.8701171875,
    "p95": 188.6572265625,
    "p99": 262.115234375,
    "mean": 86.7630101229901,
    "max": 1368.035400390625
   },
   "presence": {
    "n": 21900,
    "min": 0,
    "p50": 1,
    "p95": 17942,
    "p99": 32944,
    "mean": 4146.847899543379,
    "max": 50524
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "users": 5000,
   "connected": 4981,
   "newConnectionSuccessPct": 100,
   "failuresByCause": {},
   "editsPerSecond": 3570.8,
   "remote": {
    "n": 213413,
    "min": 0.12353515625,
    "p50": 0.637451171875,
    "p95": 10.0478515625,
    "p99": 140.64111328125,
    "mean": 9.256748621931859,
    "max": 4163.3544921875
   },
   "ack": {
    "n": 213176,
    "min": 548.46337890625,
    "p50": 839.395263671875,
    "p95": 1268.25146484375,
    "p99": 1572.226318359375,
    "mean": 877.6716828390095,
    "max": 6073.89599609375
   },
   "presence": {
    "n": 28791,
    "min": 0,
    "p50": 1,
    "p95": 30078,
    "p99": 45117,
    "mean": 4220.623180855128,
    "max": 49869
   },
   "verdict": {
    "stable": false,
    "reasons": [
     "19 clients not connected at the end"
    ]
   }
  }
 ],
 "maximumStableUsers": 4000,
 "criterion": "all of: p50 <= 50 ms, p95 <= 100 ms, p99 <= 200 ms edit to remote; new connections >= 99.9% on the first attempt; nobody disconnected at the end of the step; watchdog quiet",
 "quiesce": {
  "ok": false,
  "unacked": 5,
  "waitedMs": 120238
 },
 "verification": {
  "docs": 2500,
  "checked": 1027523,
  "missing": 0,
  "missingSamples": [],
  "unackedAtEnd": 5,
  "exportErrors": 0
 },
 "convergence": {
  "docs": 2500,
  "diverged": 0,
  "clientsCompared": 5000,
  "samples": []
 },
 "systemWholeScenario": {
  "samples": 173,
  "host": {
   "load1Max": 10.7,
   "availableMbMin": 26473.4,
   "swapUsedMbMax": 17529.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 51.7,
    "cpuPctMax": 113,
    "rssMbMax": 1759.6
   }
  },
  "postgres": {
   "cpuPctAvg": 181.7,
   "cpuPctMax": 412.5,
   "memMbMax": 253.6,
   "commitsPerSecond": 1757.9,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 2863.8,
   "walMbPerSecond": 2.4,
   "blockReadMs": 518.5,
   "blockWriteMs": 3627.2,
   "deadlocks": 0,
   "backendsMax": 12,
   "activeMax": 10,
   "waitingOnLocksMax": 0
  }
 }
}
```
