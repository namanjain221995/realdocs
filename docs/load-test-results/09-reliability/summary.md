# Performance run (2026-11-14T07:35:37.121Z, topology C)

## Reliability: backend restart while typing (topology C) [ok]

Started 2026-11-14T07:27:53.787Z, ended 2026-11-14T07:29:55.590Z.

```json
{
 "instances": 2,
 "docs": 100,
 "clients": 400,
 "settleS": 30,
 "instanceDownS": 5,
 "typingRate": 1,
 "backoff": "400 ms base, x2, cap 30 s, equal jitter 0.5 (same as packages/editor/src/collab/backoff.ts)"
}
```

#### restart of instance 1 (SIGTERM, 5s down, start) (35 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ack | 12923 | 3.3 | 4.7 | 5.9 | 8830.2 | 5.7 |
| remote | 12689 | 0.7 | 1.4 | 5072.2 | 9418.4 | 111.2 |
| ticketMs | 1050 | 4.5 | 14.3 | 22.1 | 25.2 | 6.0 |
| reconnect | 277 | 5699.5 | 8860.0 | 9332.0 | 9505.6 | 4564.2 |
| ackOffline | 1265 | 3471.0 | 7598.1 | 8507.2 | 9429.6 | 3634.0 |

Client counters: shutdown_notice=188, edits=14188, connect_errors=831, reconnects=277

Client errors: net_ECONNRESET=37, net_UND_ERR_SOCKET=21, ws_close_1006=773

WebSocket close codes seen: 4503 server_shutdown=277

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 4.8 | 5.4 | 312 | 145 | 188 | 89 | 47 | 10 / 10 | 0 (0.0) | 21.0 | 0 | 0.6 | 0 |
| :4451 | 27.0 | 51.6 | 347 | 161 | 392 | 75 | 98 | 10 / 10 | 0 (0.0) | 21.4 | 56 | 0.7 | 0 |

Server :4450 persist append: n=-5,586 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; compact: n=2 mean 3.2 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates -5,595; HTTP /api (server-side) n=n/a mean n/a ms, p95 <= n/a ms; ws outcomes forwarded=-20, accepted=-180

Server :4451 persist append: n=12,903 mean 2.6 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=68 mean 2.8 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 12,913; HTTP /api (server-side) n=1,050 mean 4.4 ms, p95 <= 25.0 ms; ws outcomes accepted=269, forwarded=2

Generator (8 worker processes): CPU % per worker 4/5/5/5/4/5/4/4; event-loop lag p99 max 10.9 ms (max 12.3 ms); host load1 max 3.4

```json
{
 "sigtermAt": "2026-11-14T07:28:43.947Z",
 "shutdownMs": 101,
 "startToHealthyMs": 363,
 "readyClientsAtEnd": 400,
 "total": 400
}
```

#### restart of instance 2 (SIGTERM, 5s down, start) (35 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 12240 | 0.7 | 1.8 | 6549.3 | 9056.7 | 166.0 |
| ack | 12426 | 3.3 | 4.8 | 5.9 | 8691.0 | 9.2 |
| ticketMs | 1439 | 4.4 | 43.6 | 91.5 | 98.0 | 11.0 |
| reconnect | 394 | 5528.0 | 8805.9 | 9194.6 | 9505.8 | 4517.3 |
| ackOffline | 1783 | 3325.0 | 7526.7 | 8340.4 | 9067.8 | 3499.3 |

Client counters: edits=14212, shutdown_notice=392, connect_errors=1219, reconnects=394

Client errors: net_UND_ERR_SOCKET=112, net_ECONNRESET=62, ws_close_1006=1045

WebSocket close codes seen: 4503 server_shutdown=394

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 30.3 | 67.6 | 389 | 205 | 392 | 69 | 98 | 10 / 10 | 0 (0.0) | 24.0 | 28 | 0.5 | 0 |
| :4451 | 6.3 | 7.5 | 347 | 147 | 392 | 101 | 98 | 10 / 10 | 0 (0.0) | 21.0 | 0 | 0.3 | 0 |

Server :4450 persist append: n=12,507 mean 2.7 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; yjs updates 12,516; HTTP /api (server-side) n=1,439 mean 7.3 ms, p95 <= 50.0 ms; ws outcomes forwarded=5, accepted=386

Server :4451 persist append: n=-19,256 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; yjs updates -19,265; HTTP /api (server-side) n=n/a mean n/a ms, p95 <= n/a ms; ws outcomes forwarded=24, accepted=-473

Generator (8 worker processes): CPU % per worker 4/4/5/4/4/4/4/4; event-loop lag p99 max 10.9 ms (max 13.3 ms); host load1 max 3.6

```json
{
 "sigtermAt": "2026-11-14T07:29:19.450Z",
 "shutdownMs": 126,
 "startToHealthyMs": 361,
 "readyClientsAtEnd": 400,
 "total": 400
}
```

### Results

```json
{
 "restarts": [
  {
   "instance": 1,
   "shutdownMs": 101,
   "startToHealthyMs": 363
  },
  {
   "instance": 2,
   "shutdownMs": 126,
   "startToHealthyMs": 361
  }
 ],
 "quiesce": {
  "ok": true,
  "unacked": 0,
  "waitedMs": 500
 },
 "verification": {
  "docs": 100,
  "checked": 40416,
  "missing": 0,
  "missingSamples": [],
  "unackedAtEnd": 0,
  "exportErrors": 0
 },
 "system": {
  "samples": 24,
  "host": {
   "load1Max": 3.6,
   "availableMbMin": 29420.6,
   "swapUsedMbMax": 17529.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 16.8,
    "cpuPctMax": 49.4,
    "rssMbMax": 389.3
   },
   "4451": {
    "cpuPctAvg": 16.8,
    "cpuPctMax": 46,
    "rssMbMax": 346.7
   }
  },
  "postgres": {
   "cpuPctAvg": 48.1,
   "cpuPctMax": 109.3,
   "memMbMax": 110.6,
   "commitsPerSecond": 564.1,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 661.9,
   "walMbPerSecond": 0.5,
   "blockReadMs": 0.9,
   "blockWriteMs": 103.5,
   "deadlocks": 0,
   "backendsMax": 21,
   "activeMax": 3,
   "waitingOnLocksMax": 0
  }
 },
 "systemWholeScenario": {
  "samples": 24,
  "host": {
   "load1Max": 3.6,
   "availableMbMin": 29420.6,
   "swapUsedMbMax": 17529.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 16.8,
    "cpuPctMax": 49.4,
    "rssMbMax": 389.3
   },
   "4451": {
    "cpuPctAvg": 16.8,
    "cpuPctMax": 46,
    "rssMbMax": 346.7
   }
  },
  "postgres": {
   "cpuPctAvg": 48.1,
   "cpuPctMax": 109.3,
   "memMbMax": 110.6,
   "commitsPerSecond": 564.1,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 661.9,
   "walMbPerSecond": 0.5,
   "blockReadMs": 0.9,
   "blockWriteMs": 103.5,
   "deadlocks": 0,
   "backendsMax": 21,
   "activeMax": 3,
   "waitingOnLocksMax": 0
  }
 }
}
```

### Notes

- Scenario s10 of tests/load/src/scenarios.ts, run by the performance framework.

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

## Reliability: revoked and expired links (topology C) [ok]

Started 2026-11-14T07:31:50.002Z, ended 2026-11-14T07:35:35.117Z.

```json
{
 "revokedLinks": 50,
 "guests": 200,
 "expiringLinks": 25,
 "expiringGuests": 100,
 "revokedThroughInstance": 2,
 "collabSweepIntervalS": "server default 30",
 "expiresInS": 150
}
```

#### revoke 50 links through the other instance (20 s)

Client counters: access_revoked=200

WebSocket close codes seen: 4403 access_revoked=200

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 2.6 | 8.0 | 417 | 141 | 132 | 63 | 33 | 10 / 10 | 0 (0.0) | 20.9 | 0 | 0.7 | 0 |
| :4451 | 3.2 | 9.5 | 325 | 160 | 168 | 46 | 42 | 10 / 10 | 0 (0.0) | 21.0 | 0 | 0.5 | 0 |

Server :4450 persist append: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; compact: n=22 mean 8.1 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; yjs updates 0; HTTP /api (server-side) n=110 mean 2.9 ms, p95 <= 10.0 ms; ws outcomes forwarded=0, accepted=0

Server :4451 persist append: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; compact: n=28 mean 12.5 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; yjs updates 0; HTTP /api (server-side) n=160 mean 28.0 ms, p95 <= 100.0 ms; ws outcomes forwarded=0, accepted=0

Generator (8 worker processes): CPU % per worker 1/0/0/0/0/0/0/0; event-loop lag p99 max 10.6 ms (max 12.0 ms); host load1 max 2.3

```json
{
 "revokeApiStatus": {
  "200": 50
 },
 "revokeApiMs": 131.699951171875,
 "socketsToCloseAfterRevoke": 200,
 "closeLatencyMs": {
  "n": 200,
  "min": 47.439453125,
  "p50": 105.4755859375,
  "p95": 129.90771484375,
  "p99": 132.5712890625,
  "mean": 104.0702197265625,
  "max": 132.881591796875
 },
 "socketsClosed": 200,
 "socketsStillOpen": 0,
 "closeCodes": {
  "4403 access_revoked": 200
 },
 "ticketAfterRevokeStatusCounts": {
  "410": 200
 },
 "exchangeAfterRevokeStatusCounts": {
  "410": 20
 }
}
```

### Results

```json
{
 "expiry": {
  "guests": 100,
  "closedAfterExpiryMs": {
   "n": 100,
   "min": 58.918701171875,
   "p50": 72.355712890625,
   "p95": 97.267822265625,
   "p99": 101.31396484375,
   "mean": 75.74417236328125,
   "max": 101.60009765625
  },
  "stillOpen": 0,
  "exchangeAfterExpiryStatus": 410
 },
 "revocation": {
  "closeLatencyMs": {
   "n": 200,
   "min": 47.439453125,
   "p50": 105.4755859375,
   "p95": 129.90771484375,
   "p99": 132.5712890625,
   "mean": 104.0702197265625,
   "max": 132.881591796875
  },
  "stillOpen": 0
 },
 "system": {
  "samples": 45,
  "host": {
   "load1Max": 3.4,
   "availableMbMin": 29318.6,
   "swapUsedMbMax": 17529.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 1.1,
    "cpuPctMax": 8.6,
    "rssMbMax": 416.7
   },
   "4451": {
    "cpuPctAvg": 1.2,
    "cpuPctMax": 8.8,
    "rssMbMax": 325.1
   }
  },
  "postgres": {
   "cpuPctAvg": 3.8,
   "cpuPctMax": 30,
   "memMbMax": 199.6,
   "commitsPerSecond": 43.3,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 5.8,
   "walMbPerSecond": 0,
   "blockReadMs": 0,
   "blockWriteMs": 1.3,
   "deadlocks": 0,
   "backendsMax": 21,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 },
 "systemWholeScenario": {
  "samples": 45,
  "host": {
   "load1Max": 3.4,
   "availableMbMin": 29318.6,
   "swapUsedMbMax": 17529.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 1.1,
    "cpuPctMax": 8.6,
    "rssMbMax": 416.7
   },
   "4451": {
    "cpuPctAvg": 1.2,
    "cpuPctMax": 8.8,
    "rssMbMax": 325.1
   }
  },
  "postgres": {
   "cpuPctAvg": 3.8,
   "cpuPctMax": 30,
   "memMbMax": 199.6,
   "commitsPerSecond": 43.3,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 5.8,
   "walMbPerSecond": 0,
   "blockReadMs": 0,
   "blockWriteMs": 1.3,
   "deadlocks": 0,
   "backendsMax": 21,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 }
}
```

### Notes

- Scenario s14 of tests/load/src/scenarios.ts, run by the performance framework.
