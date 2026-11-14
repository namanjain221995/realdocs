## Stand-alone generator (this machine or another one) (topology A) [ok]

Started 2026-11-14T07:39:12.331Z, ended 2026-11-14T07:42:01.829Z.

```json
{
 "generator": "local",
 "origin": "http://127.0.0.1:4459",
 "documents": 500,
 "users": 1000,
 "processes": 6,
 "rate": 1,
 "durationS": 120
}
```

#### remote generator (168 s)

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 40.5 | 84.0 | 623 | 354 | 1,000 | 0 | 500 | 10 / 10 | 56 (2.5) | 30.9 | 196 | 0.0 | 0 |

Server :4450 persist append: n=135,851 mean 3.1 ms, p95 <= 5.0 ms, p99 <= 25.0 ms; compact: n=1,000 mean 14.3 ms, p95 <= 50.0 ms, p99 <= 100.0 ms; yjs updates 135,913; HTTP /api (server-side) n=2,326 mean 4.0 ms, p95 <= 10.0 ms; ws outcomes accepted=913

Generator (8 worker processes): CPU % per worker 0/0/0/0/0/0/0/0; event-loop lag p99 max 10.2 ms (max 15.6 ms); host load1 max 4.2

```json
{
 "system": {
  "samples": 33,
  "host": {
   "load1Max": 4.2,
   "availableMbMin": 29146.3,
   "swapUsedMbMax": 17529.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 39.9,
    "cpuPctMax": 46.8,
    "rssMbMax": 623.4
   }
  },
  "postgres": {
   "cpuPctAvg": 96.3,
   "cpuPctMax": 120.7,
   "memMbMax": 202.5,
   "commitsPerSecond": 1055,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1701,
   "walMbPerSecond": 1.2,
   "blockReadMs": 0.6,
   "blockWriteMs": 357.1,
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
 "link": "loopback",
 "clients": 1000,
 "firstAttempt": {
  "ok": 1000
 },
 "readyAtEnd": 1000,
 "editsPerSecond": 1000,
 "editToRemoteVisibleMs": {
  "n": 120004,
  "p50Max": 0.502197265625,
  "p95Max": 1.239990234375,
  "p99Max": 2.647216796875,
  "max": 73.255126953125,
  "perProcess": [
   {
    "p50": 0.5,
    "p95": 1.24,
    "p99": 2.41
   },
   {
    "p50": 0.48,
    "p95": 1.14,
    "p99": 1.91
   },
   {
    "p50": 0.48,
    "p95": 1.15,
    "p99": 2.65
   },
   {
    "p50": 0.49,
    "p95": 1.14,
    "p99": 1.81
   },
   {
    "p50": 0.49,
    "p95": 1.17,
    "p99": 2.08
   },
   {
    "p50": 0.49,
    "p95": 1.17,
    "p99": 2.05
   }
  ]
 },
 "editToSavedMs": {
  "n": 120034,
  "p50Max": 3.5029296875,
  "p95Max": 5.139892578125,
  "p99Max": 17.244140625,
  "max": 93.469970703125,
  "perProcess": [
   {
    "p50": 3.5,
    "p95": 5.14,
    "p99": 14.96
   },
   {
    "p50": 3.48,
    "p95": 5.02,
    "p99": 11.8
   },
   {
    "p50": 3.48,
    "p95": 5.08,
    "p99": 17.24
   },
   {
    "p50": 3.5,
    "p95": 5.03,
    "p99": 13.48
   },
   {
    "p50": 3.48,
    "p95": 5.11,
    "p99": 14.28
   },
   {
    "p50": 3.5,
    "p95": 5.08,
    "p99": 15.24
   }
  ]
 },
 "connectMs": {
  "n": 0,
  "p50Max": 0,
  "p95Max": 0,
  "p99Max": 0,
  "max": 0,
  "perProcess": [
   {
    "p50": null,
    "p95": null,
    "p99": null
   },
   {
    "p50": null,
    "p95": null,
    "p99": null
   },
   {
    "p50": null,
    "p95": null,
    "p99": null
   },
   {
    "p50": null,
    "p95": null,
    "p99": null
   },
   {
    "p50": null,
    "p95": null,
    "p99": null
   },
   {
    "p50": null,
    "p95": null,
    "p99": null
   }
  ]
 },
 "generatorProcesses": [
  {
   "cpuPct": 6,
   "rssMb": 140,
   "eventLoopP99Ms": 10.9
  },
  {
   "cpuPct": 5.6,
   "rssMb": 139,
   "eventLoopP99Ms": 10.9
  },
  {
   "cpuPct": 5.6,
   "rssMb": 139,
   "eventLoopP99Ms": 10.9
  },
  {
   "cpuPct": 5.7,
   "rssMb": 138,
   "eventLoopP99Ms": 10.9
  },
  {
   "cpuPct": 5.7,
   "rssMb": 139,
   "eventLoopP99Ms": 10.9
  },
  {
   "cpuPct": 5.5,
   "rssMb": 163,
   "eventLoopP99Ms": 10.9
  }
 ],
 "errors": [
  {},
  {},
  {},
  {},
  {},
  {}
 ],
 "verification": {
  "checked": 135000,
  "missing": 0
 },
 "note": "Percentiles are per generator process; the table gives the worst process (p50Max, p95Max, p99Max), not a merged distribution.",
 "systemWholeScenario": {
  "samples": 33,
  "host": {
   "load1Max": 4.2,
   "availableMbMin": 29146.3,
   "swapUsedMbMax": 17529.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 39.9,
    "cpuPctMax": 46.8,
    "rssMbMax": 623.4
   }
  },
  "postgres": {
   "cpuPctAvg": 96.3,
   "cpuPctMax": 120.7,
   "memMbMax": 202.5,
   "commitsPerSecond": 1055,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1701,
   "walMbPerSecond": 1.2,
   "blockReadMs": 0.6,
   "blockWriteMs": 357.1,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 5,
   "waitingOnLocksMax": 0
  }
 }
}
```