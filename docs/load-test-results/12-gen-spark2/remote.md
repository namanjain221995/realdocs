## Stand-alone generator (this machine or another one) (topology A) [ok]

Started 2026-11-14T07:42:24.652Z, ended 2026-11-14T07:45:20.433Z.

```json
{
 "generator": "10.100.184.2",
 "origin": "http://10.100.184.1:4460",
 "documents": 500,
 "users": 1000,
 "processes": 6,
 "rate": 1,
 "durationS": 120
}
```

#### remote generator (169 s)

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 38.2 | 51.8 | 587 | 342 | 1,000 | 0 | 500 | 10 / 10 | 9 (0.5) | 27.2 | 182 | 0.0 | 0 |

Server :4450 persist append: n=135,887 mean 3.1 ms, p95 <= 5.0 ms, p99 <= 25.0 ms; compact: n=1,000 mean 9.0 ms, p95 <= 50.0 ms, p99 <= 50.0 ms; yjs updates 135,938; HTTP /api (server-side) n=2,376 mean 3.7 ms, p95 <= 10.0 ms; ws outcomes accepted=938

Generator (8 worker processes): CPU % per worker 0/0/0/0/0/0/0/0; event-loop lag p99 max 10.2 ms (max 14.4 ms); host load1 max 4.6

```json
{
 "system": {
  "samples": 33,
  "host": {
   "load1Max": 4.6,
   "availableMbMin": 29854.2,
   "swapUsedMbMax": 17529.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 37.9,
    "cpuPctMax": 53,
    "rssMbMax": 589.2
   }
  },
  "postgres": {
   "cpuPctAvg": 97.2,
   "cpuPctMax": 122.9,
   "memMbMax": 200.5,
   "commitsPerSecond": 1048.7,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1692.1,
   "walMbPerSecond": 1.2,
   "blockReadMs": 0.3,
   "blockWriteMs": 352.4,
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
 "link": "rtt min/avg/max/mdev = 0.285/0.493/0.819/0.193 ms",
 "clients": 1000,
 "firstAttempt": {
  "ok": 1000
 },
 "readyAtEnd": 1000,
 "editsPerSecond": 1000,
 "editToRemoteVisibleMs": {
  "n": 120006,
  "p50Max": 0.757080078125,
  "p95Max": 1.53076171875,
  "p99Max": 7.52490234375,
  "max": 68.608154296875,
  "perProcess": [
   {
    "p50": 0.72,
    "p95": 1.44,
    "p99": 4.13
   },
   {
    "p50": 0.74,
    "p95": 1.47,
    "p99": 3.46
   },
   {
    "p50": 0.73,
    "p95": 1.47,
    "p99": 4.01
   },
   {
    "p50": 0.76,
    "p95": 1.53,
    "p99": 7.52
   },
   {
    "p50": 0.72,
    "p95": 1.45,
    "p99": 3.28
   },
   {
    "p50": 0.75,
    "p95": 1.52,
    "p99": 6.67
   }
  ]
 },
 "editToSavedMs": {
  "n": 120018,
  "p50Max": 3.71875,
  "p95Max": 5.501220703125,
  "p99Max": 26.31005859375,
  "max": 95.788330078125,
  "perProcess": [
   {
    "p50": 3.65,
    "p95": 5.31,
    "p99": 19.74
   },
   {
    "p50": 3.66,
    "p95": 5.31,
    "p99": 16.38
   },
   {
    "p50": 3.66,
    "p95": 5.35,
    "p99": 17.82
   },
   {
    "p50": 3.72,
    "p95": 5.5,
    "p99": 26.31
   },
   {
    "p50": 3.64,
    "p95": 5.33,
    "p99": 16.49
   },
   {
    "p50": 3.69,
    "p95": 5.49,
    "p99": 23.52
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
   "cpuPct": 7.3,
   "rssMb": 130,
   "eventLoopP99Ms": 11
  },
  {
   "cpuPct": 7.6,
   "rssMb": 128,
   "eventLoopP99Ms": 11
  },
  {
   "cpuPct": 7.2,
   "rssMb": 130,
   "eventLoopP99Ms": 11
  },
  {
   "cpuPct": 7.4,
   "rssMb": 129,
   "eventLoopP99Ms": 11
  },
  {
   "cpuPct": 7.6,
   "rssMb": 128,
   "eventLoopP99Ms": 11
  },
  {
   "cpuPct": 7.6,
   "rssMb": 127,
   "eventLoopP99Ms": 11
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
  "samples": 34,
  "host": {
   "load1Max": 4.6,
   "availableMbMin": 29854.2,
   "swapUsedMbMax": 17529.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 37.9,
    "cpuPctMax": 53,
    "rssMbMax": 589.2
   }
  },
  "postgres": {
   "cpuPctAvg": 94.4,
   "cpuPctMax": 122.9,
   "memMbMax": 200.5,
   "commitsPerSecond": 1066.4,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1656.8,
   "walMbPerSecond": 1.2,
   "blockReadMs": 1.2,
   "blockWriteMs": 355.9,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 10,
   "waitingOnLocksMax": 0
  }
 }
}
```