# Load test summary (2026-11-12T02:42:05.937Z, topology A)

## 2. 250 docs x 4 collaborators typing (topology A) [ok]

Started 2026-11-12T02:38:02.246Z, ended 2026-11-12T02:42:03.906Z.

```json
{
 "docs": 250,
 "perDoc": 4,
 "rate": 1,
 "rampS": 40,
 "warmupS": 15,
 "durationS": 180
}
```

#### connect (40 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ticketMs | 1000 | 3.0 | 4.2 | 6.3 | 15.7 | 3.1 |
| connect | 1000 | 29.4 | 38.4 | 50.7 | 104.8 | 30.5 |

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 16.1 | 17.6 | 364 | 163 | 1,000 | 0 | 250 | 10 / 10 | 0 (0.0) | 23.3 | 0 | 0.0 | 0 |

Server :4450 persist append: n=923 mean 2.9 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 923; HTTP /api (server-side) n=1,844 mean 3.7 ms, p95 <= 10.0 ms; ws outcomes accepted=923

Generator (8 worker processes): CPU % per worker 2/2/2/2/2/2/2/2; event-loop lag p99 max 10.8 ms (max 33.9 ms); host load1 max 15.6

```json
{
 "firstAttempt": {
  "ok": 1000
 }
}
```

#### typing (180 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 180002 | 0.8 | 2.6 | 5.3 | 108.3 | 1.1 |
| ack | 180001 | 4.3 | 8.6 | 15.2 | 121.7 | 4.9 |

Client counters: edits=180003

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 51.8 | 70.4 | 505 | 285 | 1,000 | 0 | 250 | 10 / 10 | 23 (1.6) | 26.1 | 1,004 | 0.0 | 0 |

Server :4450 persist append: n=179,941 mean 3.8 ms, p95 <= 10.0 ms, p99 <= 25.0 ms; compact: n=750 mean 5.5 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; yjs updates 180,041; HTTP /api (server-side) n=0 mean n/a ms, p95 <= n/a ms; ws outcomes accepted=0

Generator (8 worker processes): CPU % per worker 8/8/8/8/8/8/8/8; event-loop lag p99 max 11.2 ms (max 21.2 ms); host load1 max 25.8

```json
{
 "editsPerSecondAchieved": 1000,
 "targetEditsPerSecond": 1000,
 "completedFullDuration": true
}
```

### Results

```json
{
 "quiesce": {
  "ok": true,
  "unacked": 0,
  "waitedMs": 502
 },
 "verification": {
  "docs": 250,
  "checked": 195330,
  "missing": 0,
  "missingSamples": [],
  "unackedAtEnd": 0,
  "exportErrors": 0
 }
}
```

### Notes

- Host load average (1 min) peaked at 25.8 during the run so far.
