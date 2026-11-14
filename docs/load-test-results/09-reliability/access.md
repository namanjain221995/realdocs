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