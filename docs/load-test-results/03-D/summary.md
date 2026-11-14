# Performance run (2026-11-14T06:17:53.235Z, topology A)

## D. Up to 100 people editing one document (topology A) [ok]

Started 2026-11-14T06:08:12.711Z, ended 2026-11-14T06:17:51.215Z.

```json
{
 "steps": [
  2,
  5,
  10,
  25,
  50,
  75,
  100
 ],
 "holdS": 60,
 "profile": {
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
 },
 "seed": 20261114,
 "documents": 1
}
```

#### 2 editors (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 83 | 1.3 | 1.7 | 2.2 | 2.2 | 1.3 |
| ack | 83 | 14.0 | 15.4 | 18.1 | 18.1 | 12.0 |
| presence | 16 | 1.0 | 16056.0 | 16056.0 | 16056.0 | 2914.1 |

Client counters: edits=83, cursor_updates=13, formats=14, deletes=8

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 0.5 | 0.7 | 225 | 126 | 2 | 0 | 1 | 6 / 10 | 0 (0.0) | 21.3 | 0 | 0.0 | 0 |

Server :4450 persist append: n=100 mean 10.4 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; yjs updates 101; HTTP /api (server-side) n=0 mean n/a ms, p95 <= n/a ms; ws outcomes accepted=0

Generator (8 worker processes): CPU % per worker 1/0/0/0/0/0/0/0; event-loop lag p99 max 10.8 ms (max 12.6 ms); host load1 max 2.3

```json
{
 "connected": 2,
 "activelyEditing": 2,
 "firstAttempt": {
  "ok": 2
 },
 "markerEditsPerSecond": 1.4,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 2.3,
   "availableMbMin": 30803.7,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 0.5,
    "cpuPctMax": 0.8,
    "rssMbMax": 224.6
   }
  },
  "postgres": {
   "cpuPctAvg": 2.2,
   "cpuPctMax": 2.5,
   "memMbMax": 48.3,
   "commitsPerSecond": 3.3,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 3.9,
   "walMbPerSecond": 0,
   "blockReadMs": 0.2,
   "blockWriteMs": 5.1,
   "deadlocks": 0,
   "backendsMax": 7,
   "activeMax": 0,
   "waitingOnLocksMax": 0
  }
 },
 "connectS": 12.3
}
```

#### 5 editors (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| presence | 62 | 2.0 | 17307.0 | 32307.0 | 32307.0 | 4644.1 |
| remote | 290 | 1.2 | 1.7 | 1.8 | 1.9 | 1.2 |
| ack | 166 | 13.2 | 15.3 | 15.7 | 17.8 | 10.2 |

Client counters: edits=166, cursor_updates=26, formats=28, deletes=27

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 1.0 | 2.8 | 237 | 142 | 5 | 0 | 1 | 10 / 10 | 0 (0.0) | 21.0 | 41 | 0.0 | 0 |

Server :4450 persist append: n=213 mean 8.7 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; compact: n=1 mean 5.8 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 214; HTTP /api (server-side) n=0 mean n/a ms, p95 <= n/a ms; ws outcomes accepted=0

Generator (8 worker processes): CPU % per worker 1/0/0/0/0/0/0/0; event-loop lag p99 max 10.7 ms (max 14.7 ms); host load1 max 1.3

```json
{
 "connected": 5,
 "activelyEditing": 5,
 "firstAttempt": {
  "ok": 3
 },
 "markerEditsPerSecond": 2.8,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 1.3,
   "availableMbMin": 30482.4,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 0.9,
    "cpuPctMax": 2.8,
    "rssMbMax": 237
   }
  },
  "postgres": {
   "cpuPctAvg": 2.7,
   "cpuPctMax": 3.6,
   "memMbMax": 58.9,
   "commitsPerSecond": 5.4,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 7.9,
   "walMbPerSecond": 0,
   "blockReadMs": 0.1,
   "blockWriteMs": 0.9,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 },
 "connectS": 11.6
}
```

#### 10 editors (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 641 | 1.2 | 1.7 | 1.9 | 2.1 | 1.2 |
| ack | 340 | 5.5 | 15.0 | 15.6 | 16.4 | 8.5 |
| presence | 122 | 1.0 | 31571.0 | 46408.0 | 46408.0 | 5423.2 |
| ticketMs | 1 | 4.9 | 4.9 | 4.9 | 4.9 | 4.9 |
| reconnect | 1 | 309.7 | 309.7 | 309.7 | 309.7 | 309.7 |

Client counters: edits=340, cursor_updates=50, formats=47, deletes=39, drops=1, reconnects=1

WebSocket close codes seen: 1005=1

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 1.5 | 3.5 | 195 | 108 | 10 | 0 | 1 | 10 / 10 | 0 (0.0) | 21.0 | 28 | 0.0 | 0 |

Server :4450 persist append: n=401 mean 7.0 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; compact: n=2 mean 5.0 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 404; HTTP /api (server-side) n=1 mean 3.3 ms, p95 <= 5.0 ms; ws outcomes accepted=1

Generator (8 worker processes): CPU % per worker 1/0/0/0/0/0/0/0; event-loop lag p99 max 10.7 ms (max 13.0 ms); host load1 max 1.2

```json
{
 "connected": 10,
 "activelyEditing": 10,
 "firstAttempt": {
  "ok": 5
 },
 "markerEditsPerSecond": 5.7,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 1.2,
   "availableMbMin": 30569.4,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 1.4,
    "cpuPctMax": 3.2,
    "rssMbMax": 195
   }
  },
  "postgres": {
   "cpuPctAvg": 3.1,
   "cpuPctMax": 4.3,
   "memMbMax": 59.4,
   "commitsPerSecond": 9.1,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 14,
   "walMbPerSecond": 0,
   "blockReadMs": 0,
   "blockWriteMs": 1.5,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 },
 "connectS": 12.7
}
```

#### 25 editors (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| core / remote | 689 | 1.1 | 1.6 | 3.2 | 81.5 | 1.4 |
| core / ack | 362 | 4.9 | 14.3 | 15.5 | 15.5 | 6.0 |
| core / presence | 124 | 1.0 | 16845.0 | 45640.0 | 45640.0 | 4056.1 |
| core / ticketMs | 1 | 5.4 | 5.4 | 5.4 | 5.4 | 5.4 |
| core / ackOffline | 2 | 34.3 | 94.1 | 94.1 | 94.1 | 64.2 |
| core / reconnect | 1 | 412.1 | 412.1 | 412.1 | 412.1 | 412.1 |
| rest / presence | 182 | 1.0 | 30344.0 | 32975.0 | 32975.0 | 5192.2 |
| rest / remote | 1086 | 1.1 | 1.5 | 2.0 | 3.7 | 1.1 |
| rest / ack | 543 | 4.7 | 14.4 | 15.1 | 17.0 | 5.8 |
| ALL / remote | 1775 | 1.1 | 1.6 | 2.3 | 81.5 | 1.2 |
| ALL / ack | 905 | 4.8 | 14.4 | 15.2 | 17.0 | 5.9 |
| ALL / presence | 306 | 1.0 | 30344.0 | 32975.0 | 45640.0 | 4731.9 |
| ALL / ticketMs | 1 | 5.4 | 5.4 | 5.4 | 5.4 | 5.4 |
| ALL / ackOffline | 2 | 34.3 | 94.1 | 94.1 | 94.1 | 64.2 |
| ALL / reconnect | 1 | 412.1 | 412.1 | 412.1 | 412.1 | 412.1 |

Client counters: edits=907, cursor_updates=122, formats=122, deletes=126, drops=1, reconnects=1

WebSocket close codes seen: 1005=1

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 3.0 | 5.0 | 208 | 111 | 25 | 0 | 1 | 10 / 10 | 0 (0.0) | 21.0 | 58 | 0.0 | 0 |

Server :4450 persist append: n=1,032 mean 4.3 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; compact: n=3 mean 4.2 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 1,047; HTTP /api (server-side) n=1 mean 3.2 ms, p95 <= 5.0 ms; ws outcomes accepted=1

Generator (8 worker processes): CPU % per worker 4/0/0/0/0/0/0/0; event-loop lag p99 max 10.9 ms (max 13.1 ms); host load1 max 0.7

```json
{
 "connected": 25,
 "activelyEditing": 25,
 "firstAttempt": {
  "ok": 15
 },
 "markerEditsPerSecond": 15.1,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 0.7,
   "availableMbMin": 30892.3,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 2.7,
    "cpuPctMax": 4.8,
    "rssMbMax": 207.5
   }
  },
  "postgres": {
   "cpuPctAvg": 4.3,
   "cpuPctMax": 6.5,
   "memMbMax": 62.1,
   "commitsPerSecond": 23.4,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 38.4,
   "walMbPerSecond": 0,
   "blockReadMs": 0,
   "blockWriteMs": 3.3,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 0,
   "waitingOnLocksMax": 0
  }
 },
 "connectS": 12.8
}
```

#### 50 editors (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| rest / remote | 3066 | 1.1 | 2.9 | 6.8 | 10.9 | 1.3 |
| rest / ack | 1533 | 4.9 | 7.7 | 13.9 | 16.1 | 5.2 |
| rest / presence | 502 | 1.0 | 31985.0 | 47104.0 | 47865.0 | 5557.6 |
| rest / ticketMs | 4 | 5.1 | 9.1 | 9.1 | 9.1 | 6.3 |
| rest / reconnect | 4 | 274.3 | 318.4 | 318.4 | 318.4 | 277.5 |
| core / ack | 342 | 5.2 | 8.2 | 14.4 | 15.7 | 5.3 |
| core / remote | 652 | 1.1 | 3.7 | 7.1 | 61.3 | 1.5 |
| core / presence | 119 | 1.0 | 31772.0 | 32821.0 | 32821.0 | 5002.6 |
| core / ticketMs | 1 | 4.2 | 4.2 | 4.2 | 4.2 | 4.2 |
| core / ackOffline | 2 | 13.0 | 72.6 | 72.6 | 72.6 | 42.8 |
| core / reconnect | 1 | 388.8 | 388.8 | 388.8 | 388.8 | 388.8 |
| ALL / remote | 3718 | 1.1 | 3.0 | 6.8 | 61.3 | 1.3 |
| ALL / ack | 1875 | 5.0 | 7.8 | 14.2 | 16.1 | 5.2 |
| ALL / presence | 621 | 1.0 | 31888.0 | 46813.0 | 47865.0 | 5451.3 |
| ALL / ticketMs | 5 | 5.1 | 9.1 | 9.1 | 9.1 | 5.9 |
| ALL / reconnect | 5 | 279.4 | 388.8 | 388.8 | 388.8 | 299.8 |
| ALL / ackOffline | 2 | 13.0 | 72.6 | 72.6 | 72.6 | 42.8 |

Client counters: deletes=247, edits=1877, cursor_updates=238, formats=244, drops=5, reconnects=5

WebSocket close codes seen: 1005=5

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 5.6 | 8.3 | 251 | 132 | 50 | 0 | 1 | 10 / 10 | 0 (0.0) | 21.4 | 50 | 0.0 | 0 |

Server :4450 persist append: n=2,191 mean 3.1 ms, p95 <= 5.0 ms, p99 <= 25.0 ms; compact: n=6 mean 8.3 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; yjs updates 2,236; HTTP /api (server-side) n=5 mean 2.8 ms, p95 <= 5.0 ms; ws outcomes accepted=5

Generator (8 worker processes): CPU % per worker 15/0/0/0/0/0/0/0; event-loop lag p99 max 12.5 ms (max 15.9 ms); host load1 max 1.0

```json
{
 "connected": 50,
 "activelyEditing": 50,
 "firstAttempt": {
  "ok": 25
 },
 "markerEditsPerSecond": 31.3,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 1,
   "availableMbMin": 30522.5,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 5.6,
    "cpuPctMax": 8,
    "rssMbMax": 250.5
   }
  },
  "postgres": {
   "cpuPctAvg": 7.1,
   "cpuPctMax": 8.8,
   "memMbMax": 65.9,
   "commitsPerSecond": 47.3,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 81.4,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0,
   "blockWriteMs": 6.3,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 },
 "connectS": 13
}
```

#### 75 editors (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| rest / remote | 4790 | 1.2 | 7.1 | 13.4 | 20.6 | 2.0 |
| rest / ack | 2395 | 5.7 | 11.6 | 15.1 | 20.8 | 6.5 |
| rest / presence | 862 | 1.0 | 30101.0 | 46152.0 | 47255.0 | 4494.9 |
| rest / ticketMs | 5 | 9.4 | 13.4 | 13.4 | 13.4 | 8.8 |
| rest / reconnect | 5 | 370.3 | 415.7 | 415.7 | 415.7 | 350.6 |
| core / remote | 672 | 1.2 | 7.2 | 16.5 | 87.8 | 2.4 |
| core / ack | 352 | 6.1 | 13.8 | 18.4 | 20.4 | 7.1 |
| core / presence | 124 | 1.0 | 17822.0 | 46685.0 | 46685.0 | 4193.2 |
| core / ticketMs | 1 | 8.0 | 8.0 | 8.0 | 8.0 | 8.0 |
| core / ackOffline | 2 | 35.9 | 97.4 | 97.4 | 97.4 | 66.6 |
| core / reconnect | 1 | 415.7 | 415.7 | 415.7 | 415.7 | 415.7 |
| ALL / remote | 5462 | 1.2 | 7.2 | 13.7 | 87.8 | 2.1 |
| ALL / ack | 2747 | 5.8 | 12.2 | 15.6 | 20.8 | 6.6 |
| ALL / presence | 986 | 1.0 | 30101.0 | 46493.0 | 47255.0 | 4457.0 |
| ALL / ticketMs | 6 | 8.0 | 13.4 | 13.4 | 13.4 | 8.7 |
| ALL / reconnect | 6 | 370.3 | 415.7 | 415.7 | 415.7 | 361.5 |
| ALL / ackOffline | 2 | 35.9 | 97.4 | 97.4 | 97.4 | 66.6 |

Client counters: deletes=383, edits=2749, cursor_updates=392, formats=356, drops=6, reconnects=6

WebSocket close codes seen: 1005=6

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 9.7 | 13.2 | 309 | 156 | 75 | 0 | 1 | 10 / 10 | 0 (0.0) | 21.7 | 58 | 0.0 | 0 |

Server :4450 persist append: n=3,061 mean 2.9 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=5 mean 10.2 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; yjs updates 3,189; HTTP /api (server-side) n=6 mean 3.5 ms, p95 <= 5.0 ms; ws outcomes accepted=6

Generator (8 worker processes): CPU % per worker 36/0/0/0/0/0/0/0; event-loop lag p99 max 17.1 ms (max 23.9 ms); host load1 max 1.6

```json
{
 "connected": 75,
 "activelyEditing": 75,
 "firstAttempt": {
  "ok": 25
 },
 "markerEditsPerSecond": 45.8,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 1.5,
   "availableMbMin": 30216.7,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 9.5,
    "cpuPctMax": 12.8,
    "rssMbMax": 309.3
   }
  },
  "postgres": {
   "cpuPctAvg": 8.6,
   "cpuPctMax": 10.3,
   "memMbMax": 73.7,
   "commitsPerSecond": 66.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 117.9,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0,
   "blockWriteMs": 9.6,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 },
 "connectS": 13
}
```

#### 100 editors (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| rest / remote | 6712 | 1.2 | 9.8 | 14.3 | 90.5 | 2.8 |
| rest / ack | 3355 | 6.8 | 12.1 | 16.6 | 36.7 | 7.4 |
| rest / presence | 1198 | 4.0 | 30563.0 | 46102.0 | 47886.0 | 4667.4 |
| rest / ticketMs | 6 | 5.8 | 10.7 | 10.7 | 10.7 | 6.9 |
| rest / reconnect | 6 | 327.7 | 410.8 | 410.8 | 410.8 | 338.8 |
| rest / ackOffline | 1 | 100.5 | 100.5 | 100.5 | 100.5 | 100.5 |
| core / remote | 653 | 1.3 | 10.1 | 17.4 | 31.9 | 3.1 |
| core / ack | 345 | 7.2 | 12.8 | 25.9 | 30.3 | 8.1 |
| core / presence | 123 | 3.0 | 30761.0 | 45752.0 | 45752.0 | 5387.2 |
| core / ticketMs | 1 | 4.2 | 4.2 | 4.2 | 4.2 | 4.2 |
| core / ackOffline | 1 | 42.8 | 42.8 | 42.8 | 42.8 | 42.8 |
| core / reconnect | 1 | 353.7 | 353.7 | 353.7 | 353.7 | 353.7 |
| ALL / remote | 7365 | 1.2 | 9.8 | 14.6 | 90.5 | 2.9 |
| ALL / ack | 3700 | 6.8 | 12.3 | 16.8 | 36.7 | 7.4 |
| ALL / presence | 1321 | 3.0 | 30578.0 | 46088.0 | 47886.0 | 4734.4 |
| ALL / ticketMs | 7 | 5.8 | 10.7 | 10.7 | 10.7 | 6.5 |
| ALL / reconnect | 7 | 353.1 | 410.8 | 410.8 | 410.8 | 340.9 |
| ALL / ackOffline | 2 | 42.8 | 100.5 | 100.5 | 100.5 | 71.6 |

Client counters: edits=3702, deletes=510, formats=515, cursor_updates=520, drops=7, reconnects=7

WebSocket close codes seen: 1005=7

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 13.4 | 16.6 | 324 | 161 | 100 | 0 | 1 | 10 / 10 | 0 (0.0) | 22.2 | 28 | 0.0 | 0 |

Server :4450 persist append: n=4,202 mean 2.8 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=6 mean 13.7 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; yjs updates 4,522; HTTP /api (server-side) n=7 mean 3.1 ms, p95 <= 5.0 ms; ws outcomes accepted=7

Generator (8 worker processes): CPU % per worker 51/0/0/0/0/0/0/0; event-loop lag p99 max 18.2 ms (max 32.2 ms); host load1 max 1.8

```json
{
 "connected": 100,
 "activelyEditing": 100,
 "firstAttempt": {
  "ok": 25
 },
 "markerEditsPerSecond": 61.7,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 1.8,
   "availableMbMin": 29959.4,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 13.1,
    "cpuPctMax": 16.2,
    "rssMbMax": 322.7
   }
  },
  "postgres": {
   "cpuPctAvg": 10.3,
   "cpuPctMax": 13.6,
   "memMbMax": 79.9,
   "commitsPerSecond": 87.1,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 162.3,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0,
   "blockWriteMs": 12.8,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 },
 "connectS": 12.9
}
```

#### 100 connected, 10 editing (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| core / remote | 673 | 1.3 | 2.4 | 19.4 | 86.8 | 2.0 |
| core / ack | 354 | 13.6 | 16.3 | 20.9 | 24.7 | 12.3 |
| core / presence | 124 | 1.0 | 30892.0 | 32876.0 | 32876.0 | 4630.2 |
| core / ticketMs | 1 | 4.6 | 4.6 | 4.6 | 4.6 | 4.6 |
| core / ackOffline | 2 | 36.4 | 99.5 | 99.5 | 99.5 | 68.0 |
| core / reconnect | 1 | 418.5 | 418.5 | 418.5 | 418.5 | 418.5 |
| rest / presence | 376 | 32601.0 | 47721.0 | 47963.0 | 47999.0 | 34939.4 |
| ALL / remote | 673 | 1.3 | 2.4 | 19.4 | 86.8 | 2.0 |
| ALL / ack | 354 | 13.6 | 16.3 | 20.9 | 24.7 | 12.3 |
| ALL / presence | 500 | 31306.0 | 47646.0 | 47962.0 | 47999.0 | 27422.7 |
| ALL / ticketMs | 1 | 4.6 | 4.6 | 4.6 | 4.6 | 4.6 |
| ALL / ackOffline | 2 | 36.4 | 99.5 | 99.5 | 99.5 | 68.0 |
| ALL / reconnect | 1 | 418.5 | 418.5 | 418.5 | 418.5 | 418.5 |

Client counters: edits=356, cursor_updates=52, formats=45, deletes=42, drops=1, reconnects=1

WebSocket close codes seen: 1005=1

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 2.7 | 4.2 | 324 | 170 | 100 | 0 | 1 | 10 / 10 | 0 (0.0) | 21.8 | 0 | 0.0 | 0 |

Server :4450 persist append: n=420 mean 7.0 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; compact: n=2 mean 11.4 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; yjs updates 425; HTTP /api (server-side) n=1 mean 2.2 ms, p95 <= 5.0 ms; ws outcomes accepted=1

Generator (8 worker processes): CPU % per worker 13/0/0/0/0/0/0/0; event-loop lag p99 max 15.7 ms (max 26.5 ms); host load1 max 1.7

```json
{
 "connected": 100,
 "activelyEditing": 10,
 "system": {
  "samples": 12,
  "host": {
   "load1Max": 1.7,
   "availableMbMin": 30097.9,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 2.7,
    "cpuPctMax": 4.8,
    "rssMbMax": 324.1
   }
  },
  "postgres": {
   "cpuPctAvg": 2.9,
   "cpuPctMax": 3.4,
   "memMbMax": 81,
   "commitsPerSecond": 16.7,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 17.7,
   "walMbPerSecond": 0,
   "blockReadMs": 0,
   "blockWriteMs": 1.2,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 1,
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
   "connected": 2,
   "activelyEditing": 2,
   "editsPerSecond": 1.4,
   "remote": {
    "n": 83,
    "min": 0.35302734375,
    "p50": 1.319091796875,
    "p95": 1.678955078125,
    "p99": 2.179443359375,
    "mean": 1.3000694182981927,
    "max": 2.179443359375
   },
   "ack": {
    "n": 83,
    "min": 2.86474609375,
    "p50": 14.005859375,
    "p95": 15.445556640625,
    "p99": 18.058837890625,
    "mean": 12.012486469314759,
    "max": 18.058837890625
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "connected": 5,
   "activelyEditing": 5,
   "editsPerSecond": 2.8,
   "remote": {
    "n": 290,
    "min": 0.5810546875,
    "p50": 1.225830078125,
    "p95": 1.668212890625,
    "p99": 1.81103515625,
    "mean": 1.2404507341056035,
    "max": 1.8505859375
   },
   "ack": {
    "n": 166,
    "min": 2.632568359375,
    "p50": 13.2314453125,
    "p95": 15.2509765625,
    "p99": 15.7255859375,
    "mean": 10.183356963008283,
    "max": 17.753173828125
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "connected": 10,
   "activelyEditing": 10,
   "editsPerSecond": 5.7,
   "remote": {
    "n": 641,
    "min": 0.359375,
    "p50": 1.1884765625,
    "p95": 1.6640625,
    "p99": 1.885009765625,
    "mean": 1.1859559343311232,
    "max": 2.091796875
   },
   "ack": {
    "n": 340,
    "min": 2.962158203125,
    "p50": 5.49072265625,
    "p95": 14.963134765625,
    "p99": 15.550537109375,
    "mean": 8.47691219554228,
    "max": 16.371826171875
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "connected": 25,
   "activelyEditing": 25,
   "editsPerSecond": 15.1,
   "remote": {
    "n": 1775,
    "min": 0.21484375,
    "p50": 1.072021484375,
    "p95": 1.567626953125,
    "p99": 2.341552734375,
    "mean": 1.207158065580986,
    "max": 81.5498046875
   },
   "ack": {
    "n": 905,
    "min": 2.37255859375,
    "p50": 4.75,
    "p95": 14.3681640625,
    "p99": 15.235595703125,
    "mean": 5.880642211239641,
    "max": 17.00634765625
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "connected": 50,
   "activelyEditing": 50,
   "editsPerSecond": 31.3,
   "remote": {
    "n": 3718,
    "min": 0.207763671875,
    "p50": 1.066650390625,
    "p95": 2.978515625,
    "p99": 6.84130859375,
    "mean": 1.3360403962774006,
    "max": 61.254150390625
   },
   "ack": {
    "n": 1875,
    "min": 2.19873046875,
    "p50": 4.95458984375,
    "p95": 7.761962890625,
    "p99": 14.18896484375,
    "mean": 5.232651302083333,
    "max": 16.0927734375
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "connected": 75,
   "activelyEditing": 75,
   "editsPerSecond": 45.8,
   "remote": {
    "n": 5462,
    "min": 0.195068359375,
    "p50": 1.15625,
    "p95": 7.156494140625,
    "p99": 13.65380859375,
    "mean": 2.0541559510595935,
    "max": 87.826171875
   },
   "ack": {
    "n": 2747,
    "min": 2.48388671875,
    "p50": 5.7568359375,
    "p95": 12.1611328125,
    "p99": 15.5546875,
    "mean": 6.56768356673189,
    "max": 20.751953125
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "connected": 100,
   "activelyEditing": 100,
   "editsPerSecond": 61.7,
   "remote": {
    "n": 7365,
    "min": 0.21337890625,
    "p50": 1.249755859375,
    "p95": 9.820068359375,
    "p99": 14.61376953125,
    "mean": 2.866914188465292,
    "max": 90.45751953125
   },
   "ack": {
    "n": 3700,
    "min": 2.795654296875,
    "p50": 6.83740234375,
    "p95": 12.291748046875,
    "p99": 16.81494140625,
    "mean": 7.420598342483108,
    "max": 36.704833984375
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  },
  {
   "connected": 100,
   "activelyEditing": 10,
   "remote": {
    "n": 673,
    "min": 0.3251953125,
    "p50": 1.3173828125,
    "p95": 2.396240234375,
    "p99": 19.407470703125,
    "mean": 2.0376027349554233,
    "max": 86.83837890625
   },
   "ack": {
    "n": 354,
    "min": 4.7109375,
    "p50": 13.634033203125,
    "p95": 16.290771484375,
    "p99": 20.934326171875,
    "mean": 12.313068282132768,
    "max": 24.740478515625
   },
   "verdict": {
    "stable": true,
    "reasons": []
   }
  }
 ],
 "quiesce": {
  "ok": true,
  "unacked": 0,
  "waitedMs": 1
 },
 "verification": {
  "docs": 1,
  "checked": 11944,
  "missing": 0,
  "missingSamples": [],
  "unackedAtEnd": 0,
  "exportErrors": 0
 },
 "convergence": {
  "docs": 1,
  "diverged": 0,
  "clientsCompared": 100,
  "samples": []
 },
 "systemWholeScenario": {
  "samples": 115,
  "host": {
   "load1Max": 2.6,
   "availableMbMin": 29959.4,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 4.7,
    "cpuPctMax": 16.2,
    "rssMbMax": 324.1
   }
  },
  "postgres": {
   "cpuPctAvg": 5.1,
   "cpuPctMax": 13.6,
   "memMbMax": 81,
   "commitsPerSecond": 34.6,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 55.7,
   "walMbPerSecond": 0,
   "blockReadMs": 0.7,
   "blockWriteMs": 52.4,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 }
}
```
