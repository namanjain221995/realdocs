# Performance run (2026-11-14T08:29:21.104Z, topology A)

## Soak (topology A) [ok]

Started 2026-11-14T07:57:54.944Z, ended 2026-11-14T08:29:19.071Z.

```json
{
 "docs": 500,
 "perDoc": 2,
 "assign": [
  "normal",
  "active",
  "heavy",
  "active",
  "normal"
 ],
 "rampS": 60,
 "warmupS": 20,
 "durationS": 1800,
 "name": "soak 30 min, 1,000 editors",
 "minutes": 30,
 "seed": 20261114
}
```

#### minutes 0-5 (300 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 226731 | 0.5 | 1.4 | 3.4 | 388.3 | 0.8 |
| ack | 226699 | 3.5 | 5.3 | 9.9 | 401.2 | 3.7 |
| presence | 27243 | 1.0 | 31373.0 | 46586.0 | 50452.0 | 5415.1 |
| ticketMs | 274 | 4.3 | 6.3 | 8.3 | 14.2 | 4.4 |
| reconnect | 274 | 320.0 | 412.3 | 418.7 | 420.6 | 321.0 |
| ackOffline | 107 | 164.0 | 324.5 | 369.8 | 401.4 | 162.1 |

Client counters: edits=226808, deletes=30477, formats=21603, cursor_updates=24389, drops=274, reconnects=274

WebSocket close codes seen: 1005=274

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 46.0 | 59.0 | 571 | 353 | 1,000 | 0 | 500 | 10 / 10 | 9 (0.1) | 22.6 | 258 | 0.0 | 0 |

Server :4450 persist append: n=270,063 mean 3.0 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; compact: n=1,112 mean 3.8 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 270,848; HTTP /api (server-side) n=267 mean 2.8 ms, p95 <= 5.0 ms; ws outcomes accepted=267

Generator (8 worker processes): CPU % per worker 5/5/5/5/5/5/5/5; event-loop lag p99 max 10.9 ms (max 14.5 ms); host load1 max 5.7

```json
{
 "system": {
  "samples": 60,
  "host": {
   "load1Max": 5.7,
   "availableMbMin": 28811.1,
   "swapUsedMbMax": 17529.4
  },
  "server": {
   "4450": {
    "cpuPctAvg": 46,
    "cpuPctMax": 53.8,
    "rssMbMax": 563.3
   }
  },
  "postgres": {
   "cpuPctAvg": 104.2,
   "cpuPctMax": 116.6,
   "memMbMax": 214.5,
   "commitsPerSecond": 1058.4,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1836,
   "walMbPerSecond": 1.4,
   "blockReadMs": 15,
   "blockWriteMs": 675.9,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 7,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### minutes 5-10 (300 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ack | 226770 | 3.5 | 5.4 | 9.0 | 379.3 | 3.8 |
| remote | 226794 | 0.6 | 1.5 | 3.0 | 364.5 | 0.8 |
| presence | 20569 | 1.0 | 31299.0 | 46618.0 | 50829.0 | 4996.8 |
| ticketMs | 240 | 4.5 | 6.6 | 14.1 | 25.7 | 4.8 |
| reconnect | 240 | 314.5 | 406.5 | 415.0 | 416.6 | 317.8 |
| ackOffline | 84 | 143.3 | 308.1 | 375.5 | 375.5 | 150.4 |

Client counters: edits=226855, formats=21875, deletes=30074, cursor_updates=24674, drops=239, reconnects=240

WebSocket close codes seen: 1005=239

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 48.1 | 62.9 | 617 | 387 | 1,000 | 0 | 500 | 10 / 10 | 0 (0.0) | 22.5 | 298 | 0.0 | 0 |

Server :4450 persist append: n=269,805 mean 3.0 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; compact: n=1,224 mean 4.1 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 270,939; HTTP /api (server-side) n=238 mean 3.0 ms, p95 <= 5.0 ms; ws outcomes accepted=238

Generator (8 worker processes): CPU % per worker 5/5/5/5/5/5/4/5; event-loop lag p99 max 10.9 ms (max 29.5 ms); host load1 max 3.9

```json
{
 "system": {
  "samples": 61,
  "host": {
   "load1Max": 3.9,
   "availableMbMin": 28801.4,
   "swapUsedMbMax": 17529.4
  },
  "server": {
   "4450": {
    "cpuPctAvg": 48.2,
    "cpuPctMax": 64.2,
    "rssMbMax": 618.9
   }
  },
  "postgres": {
   "cpuPctAvg": 103.5,
   "cpuPctMax": 112.6,
   "memMbMax": 228.5,
   "commitsPerSecond": 1055.8,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1867.8,
   "walMbPerSecond": 1.5,
   "blockReadMs": 120.7,
   "blockWriteMs": 689.8,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 7,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### minutes 10-15 (300 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 227345 | 0.6 | 1.6 | 3.1 | 350.4 | 0.8 |
| ack | 227327 | 3.8 | 6.7 | 10.7 | 423.6 | 4.2 |
| presence | 16152 | 1.0 | 31182.0 | 46623.0 | 48262.0 | 4494.1 |
| ticketMs | 234 | 4.7 | 8.2 | 10.3 | 17.9 | 5.0 |
| reconnect | 234 | 315.7 | 407.3 | 419.1 | 421.6 | 317.0 |
| ackOffline | 82 | 176.6 | 324.0 | 361.7 | 361.7 | 171.5 |

Client counters: edits=227408, deletes=30491, formats=21821, cursor_updates=24843, drops=234, reconnects=234

WebSocket close codes seen: 1005=234

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 49.6 | 57.2 | 515 | 268 | 1,000 | 0 | 500 | 10 / 10 | 0 (0.0) | 22.4 | 240 | 0.0 | 0 |

Server :4450 persist append: n=270,995 mean 3.3 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; compact: n=1,310 mean 4.8 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 272,206; HTTP /api (server-side) n=234 mean 3.1 ms, p95 <= 10.0 ms; ws outcomes accepted=234

Generator (8 worker processes): CPU % per worker 5/5/5/5/5/5/5/5; event-loop lag p99 max 10.9 ms (max 24.7 ms); host load1 max 4.6

```json
{
 "system": {
  "samples": 60,
  "host": {
   "load1Max": 4.6,
   "availableMbMin": 28727,
   "swapUsedMbMax": 17529.4
  },
  "server": {
   "4450": {
    "cpuPctAvg": 49.6,
    "cpuPctMax": 57,
    "rssMbMax": 515
   }
  },
  "postgres": {
   "cpuPctAvg": 104.2,
   "cpuPctMax": 113.3,
   "memMbMax": 239.7,
   "commitsPerSecond": 1059.7,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1891.2,
   "walMbPerSecond": 1.5,
   "blockReadMs": 113.3,
   "blockWriteMs": 693.4,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 6,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### minutes 15-20 (300 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 227056 | 0.6 | 1.7 | 2.9 | 380.3 | 0.8 |
| ack | 227020 | 5.7 | 8.9 | 25.8 | 387.8 | 6.2 |
| presence | 12256 | 1.0 | 30855.0 | 46426.0 | 50502.0 | 4047.9 |
| ticketMs | 251 | 4.8 | 8.7 | 32.7 | 37.0 | 5.5 |
| reconnect | 251 | 326.9 | 411.3 | 419.5 | 420.3 | 325.5 |
| ackOffline | 97 | 167.7 | 352.1 | 392.4 | 392.4 | 167.0 |

Client counters: edits=227121, deletes=30471, cursor_updates=24595, formats=21614, drops=251, reconnects=251

WebSocket close codes seen: 1005=251

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 50.6 | 60.0 | 530 | 300 | 1,000 | 0 | 500 | 10 / 10 | 7 (0.1) | 22.4 | 478 | 0.0 | 0 |

Server :4450 persist append: n=270,534 mean 5.3 ms, p95 <= 10.0 ms, p99 <= 25.0 ms; compact: n=1,233 mean 7.2 ms, p95 <= 10.0 ms, p99 <= 50.0 ms; yjs updates 271,813; HTTP /api (server-side) n=251 mean 3.5 ms, p95 <= 10.0 ms; ws outcomes accepted=251

Generator (8 worker processes): CPU % per worker 5/5/5/5/5/5/5/5; event-loop lag p99 max 10.9 ms (max 21.4 ms); host load1 max 4.8

```json
{
 "system": {
  "samples": 60,
  "host": {
   "load1Max": 4.8,
   "availableMbMin": 28505.9,
   "swapUsedMbMax": 17529.4
  },
  "server": {
   "4450": {
    "cpuPctAvg": 50.6,
    "cpuPctMax": 59.4,
    "rssMbMax": 530
   }
  },
  "postgres": {
   "cpuPctAvg": 108.4,
   "cpuPctMax": 120.3,
   "memMbMax": 248.3,
   "commitsPerSecond": 1058,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1916.3,
   "walMbPerSecond": 1.6,
   "blockReadMs": 109.8,
   "blockWriteMs": 776.1,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 10,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### minutes 20-25 (300 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ack | 226104 | 5.7 | 8.7 | 24.3 | 418.6 | 6.2 |
| remote | 226143 | 0.7 | 1.8 | 3.1 | 374.6 | 0.9 |
| presence | 9461 | 1.0 | 17943.0 | 46095.0 | 50839.0 | 3193.4 |
| ticketMs | 256 | 5.0 | 8.6 | 23.5 | 48.8 | 5.7 |
| reconnect | 256 | 327.1 | 415.7 | 419.6 | 422.5 | 326.5 |
| ackOffline | 100 | 159.6 | 339.1 | 382.5 | 389.4 | 164.9 |

Client counters: edits=226204, deletes=30272, cursor_updates=24745, formats=21758, drops=256, reconnects=256

WebSocket close codes seen: 1005=256

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 52.0 | 62.1 | 567 | 312 | 1,000 | 0 | 500 | 10 / 10 | 26 (0.6) | 22.8 | 1,060 | 0.0 | 0 |

Server :4450 persist append: n=269,750 mean 5.3 ms, p95 <= 10.0 ms, p99 <= 25.0 ms; compact: n=1,230 mean 7.4 ms, p95 <= 10.0 ms, p99 <= 25.0 ms; yjs updates 271,058; HTTP /api (server-side) n=253 mean 3.5 ms, p95 <= 10.0 ms; ws outcomes accepted=253

Generator (8 worker processes): CPU % per worker 5/5/5/5/5/5/5/6; event-loop lag p99 max 10.9 ms (max 31.4 ms); host load1 max 5.0

```json
{
 "system": {
  "samples": 60,
  "host": {
   "load1Max": 5,
   "availableMbMin": 28464.4,
   "swapUsedMbMax": 17529.4
  },
  "server": {
   "4450": {
    "cpuPctAvg": 52,
    "cpuPctMax": 61.4,
    "rssMbMax": 567.3
   }
  },
  "postgres": {
   "cpuPctAvg": 108.1,
   "cpuPctMax": 116.6,
   "memMbMax": 256.5,
   "commitsPerSecond": 1054.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1929.5,
   "walMbPerSecond": 1.7,
   "blockReadMs": 123.1,
   "blockWriteMs": 796.3,
   "deadlocks": 0,
   "backendsMax": 12,
   "activeMax": 10,
   "waitingOnLocksMax": 0
  }
 }
}
```

#### minutes 25-30 (300 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ack | 227951 | 5.8 | 9.1 | 24.7 | 396.4 | 6.3 |
| remote | 227975 | 0.7 | 1.9 | 3.5 | 382.9 | 0.9 |
| presence | 7526 | 1.0 | 17553.0 | 45365.0 | 49255.0 | 2429.9 |
| ticketMs | 225 | 5.2 | 11.0 | 34.4 | 42.8 | 6.0 |
| reconnect | 225 | 327.0 | 411.2 | 418.9 | 442.2 | 325.0 |
| ackOffline | 86 | 176.8 | 345.0 | 394.6 | 394.6 | 175.4 |

Client counters: edits=228036, formats=21806, deletes=30282, cursor_updates=24738, drops=225, reconnects=225

WebSocket close codes seen: 1005=225

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 53.9 | 63.9 | 585 | 336 | 1,000 | 0 | 500 | 10 / 10 | 18 (0.4) | 22.2 | 843 | 0.0 | 0 |

Server :4450 persist append: n=271,773 mean 5.3 ms, p95 <= 10.0 ms, p99 <= 25.0 ms; compact: n=1,310 mean 7.8 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; yjs updates 273,216; HTTP /api (server-side) n=225 mean 3.8 ms, p95 <= 10.0 ms; ws outcomes accepted=225

Generator (8 worker processes): CPU % per worker 6/5/6/5/5/6/5/5; event-loop lag p99 max 10.9 ms (max 30.6 ms); host load1 max 4.4

```json
{
 "system": {
  "samples": 60,
  "host": {
   "load1Max": 4.4,
   "availableMbMin": 28425.9,
   "swapUsedMbMax": 17529.4
  },
  "server": {
   "4450": {
    "cpuPctAvg": 53.8,
    "cpuPctMax": 64,
    "rssMbMax": 584.7
   }
  },
  "postgres": {
   "cpuPctAvg": 108.8,
   "cpuPctMax": 116.3,
   "memMbMax": 263.4,
   "commitsPerSecond": 1060.2,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1971.5,
   "walMbPerSecond": 1.7,
   "blockReadMs": 112.6,
   "blockWriteMs": 756.1,
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
 "firstAttempt": {
  "ok": 1000
 },
 "windows": [
  {
   "fromMinute": 0,
   "remote": {
    "n": 226731,
    "min": 0.06689453125,
    "p50": 0.534423828125,
    "p95": 1.3623046875,
    "p99": 3.427734375,
    "mean": 0.7619442320880112,
    "max": 388.318359375
   },
   "ack": {
    "n": 226699,
    "min": 1.585205078125,
    "p50": 3.514404296875,
    "p95": 5.291748046875,
    "p99": 9.87939453125,
    "mean": 3.7427874133470347,
    "max": 401.22314453125
   },
   "serverRssMbEnd": 491.58203125,
   "serverHeapMbMax": 352.9085235595703,
   "eventLoopP99MaxMs": 22.626303,
   "poolWaitingMax": 9,
   "connected": 1000
  },
  {
   "fromMinute": 5,
   "remote": {
    "n": 226794,
    "min": 0.061767578125,
    "p50": 0.562744140625,
    "p95": 1.451171875,
    "p99": 3.008544921875,
    "mean": 0.7613379472912367,
    "max": 364.523681640625
   },
   "ack": {
    "n": 226770,
    "min": 1.576904296875,
    "p50": 3.545654296875,
    "p95": 5.375732421875,
    "p99": 9.036376953125,
    "mean": 3.7544904843185,
    "max": 379.328369140625
   },
   "serverRssMbEnd": 494.8203125,
   "serverHeapMbMax": 387.2870635986328,
   "eventLoopP99MaxMs": 22.462463,
   "poolWaitingMax": 0,
   "connected": 1000
  },
  {
   "fromMinute": 10,
   "remote": {
    "n": 227345,
    "min": 0.0732421875,
    "p50": 0.5859375,
    "p95": 1.55029296875,
    "p99": 3.096435546875,
    "mean": 0.7969261831378247,
    "max": 350.395751953125
   },
   "ack": {
    "n": 227327,
    "min": 1.585205078125,
    "p50": 3.773681640625,
    "p95": 6.681640625,
    "p99": 10.67431640625,
    "mean": 4.155641739979055,
    "max": 423.61328125
   },
   "serverRssMbEnd": 515.1328125,
   "serverHeapMbMax": 267.92942810058594,
   "eventLoopP99MaxMs": 22.364159,
   "poolWaitingMax": 0,
   "connected": 1000
  },
  {
   "fromMinute": 15,
   "remote": {
    "n": 227056,
    "min": 0.081298828125,
    "p50": 0.617919921875,
    "p95": 1.666748046875,
    "p99": 2.947998046875,
    "mean": 0.8443800855175183,
    "max": 380.257080078125
   },
   "ack": {
    "n": 227020,
    "min": 2.2958984375,
    "p50": 5.651123046875,
    "p95": 8.859130859375,
    "p99": 25.806884765625,
    "mean": 6.236491057841476,
    "max": 387.82568359375
   },
   "serverRssMbEnd": 529.9765625,
   "serverHeapMbMax": 300.40138244628906,
   "eventLoopP99MaxMs": 22.364159,
   "poolWaitingMax": 7,
   "connected": 1000
  },
  {
   "fromMinute": 20,
   "remote": {
    "n": 226143,
    "min": 0.080322265625,
    "p50": 0.655029296875,
    "p95": 1.76953125,
    "p99": 3.129150390625,
    "mean": 0.8929884677591309,
    "max": 374.6181640625
   },
   "ack": {
    "n": 226104,
    "min": 2.343505859375,
    "p50": 5.6875,
    "p95": 8.7158203125,
    "p99": 24.336181640625,
    "mean": 6.215006026679094,
    "max": 418.6171875
   },
   "serverRssMbEnd": 567.3203125,
   "serverHeapMbMax": 312.0639953613281,
   "eventLoopP99MaxMs": 22.806527,
   "poolWaitingMax": 26,
   "connected": 1000
  },
  {
   "fromMinute": 25,
   "remote": {
    "n": 227975,
    "min": 0.0859375,
    "p50": 0.686279296875,
    "p95": 1.928955078125,
    "p99": 3.52392578125,
    "mean": 0.939847715578394,
    "max": 382.911865234375
   },
   "ack": {
    "n": 227951,
    "min": 2.24462890625,
    "p50": 5.764404296875,
    "p95": 9.113037109375,
    "p99": 24.695556640625,
    "mean": 6.309785104969448,
    "max": 396.35009765625
   },
   "serverRssMbEnd": 584.6640625,
   "serverHeapMbMax": 335.8923873901367,
   "eventLoopP99MaxMs": 22.200319,
   "poolWaitingMax": 18,
   "connected": 1000
  }
 ],
 "wholeRun": {
  "samples": 361,
  "host": {
   "load1Max": 5.7,
   "availableMbMin": 28425.9,
   "swapUsedMbMax": 17529.4
  },
  "server": {
   "4450": {
    "cpuPctAvg": 50,
    "cpuPctMax": 64.2,
    "rssMbMax": 618.9
   }
  },
  "postgres": {
   "cpuPctAvg": 106.2,
   "cpuPctMax": 120.3,
   "memMbMax": 263.4,
   "commitsPerSecond": 1055.8,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1901.9,
   "walMbPerSecond": 1.6,
   "blockReadMs": 597.3,
   "blockWriteMs": 4449.9,
   "deadlocks": 0,
   "backendsMax": 12,
   "activeMax": 10,
   "waitingOnLocksMax": 0
  }
 },
 "quiesce": {
  "ok": true,
  "unacked": 0,
  "waitedMs": 501
 },
 "verification": {
  "docs": 500,
  "checked": 1378271,
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
 "abortedBy": null,
 "systemWholeScenario": {
  "samples": 376,
  "host": {
   "load1Max": 5.7,
   "availableMbMin": 28425.9,
   "swapUsedMbMax": 17529.4
  },
  "server": {
   "4450": {
    "cpuPctAvg": 48.9,
    "cpuPctMax": 64.2,
    "rssMbMax": 618.9
   }
  },
  "postgres": {
   "cpuPctAvg": 103.3,
   "cpuPctMax": 120.3,
   "memMbMax": 263.4,
   "commitsPerSecond": 1036.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1848,
   "walMbPerSecond": 1.5,
   "blockReadMs": 597.8,
   "blockWriteMs": 4509.5,
   "deadlocks": 0,
   "backendsMax": 12,
   "activeMax": 10,
   "waitingOnLocksMax": 0
  }
 }
}
```
