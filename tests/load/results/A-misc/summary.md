# Load test summary (2026-11-12T02:52:35.493Z, topology A)

## 13. reconnect storm (topology A) [ok]

Started 2026-11-12T02:46:48.781Z, ended 2026-11-12T02:48:00.758Z.

```json
{
 "docs": 250,
 "clients": 1000,
 "rampS": 60,
 "variant": "lb",
 "serverEnvOverrides": {},
 "typingDuringStorm": false
}
```

#### initial connect (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ticketMs | 1000 | 2.8 | 4.0 | 5.5 | 18.3 | 2.9 |
| connect | 1000 | 29.3 | 40.8 | 46.4 | 87.9 | 30.5 |

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 11.8 | 17.2 | 330 | 166 | 1,000 | 0 | 250 | 10 / 10 | 0 (0.0) | 21.6 | 36 | 0.0 | 0 |

Server :4450 persist append: n=933 mean 2.9 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 933; HTTP /api (server-side) n=1,866 mean 3.9 ms, p95 <= 10.0 ms; ws outcomes accepted=933

Generator (4 worker processes): CPU % per worker 3/3/2/3; event-loop lag p99 max 10.9 ms (max 33.4 ms); host load1 max 4.3

```json
{
 "readyAfterInitial": 1000,
 "total": 1000
}
```

#### storm and recovery (2 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ticketMs | 1000 | 189.6 | 368.9 | 384.9 | 1048.7 | 212.4 |
| reconnect | 1000 | 812.9 | 893.9 | 1443.4 | 1474.8 | 774.6 |

Client counters: reconnects=1000

WebSocket close codes seen: 1006=1000

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 76.8 | 76.8 | 361 | 165 | 1,000 | 0 | 250 | 10 / 10 | 0 (0.0) | 23.8 | 0 | 0.0 | 0 |

Server :4450 persist append: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; compact: n=250 mean 36.6 ms, p95 <= 100.0 ms, p99 <= 100.0 ms; yjs updates 0; HTTP /api (server-side) n=1,000 mean 137.3 ms, p95 <= 250.0 ms; ws outcomes accepted=1000

Generator (4 worker processes): CPU % per worker 37/36/35/31; event-loop lag p99 max 11.9 ms (max 16.1 ms); host load1 max 2.4

```json
{
 "timeTo99PctSyncedMs": 1507,
 "timeToAllSyncedMs": 1507,
 "readyAtEnd": 1000,
 "total": 1000
}
```

### Results

```json
{
 "storm": {
  "timeTo99PctSyncedMs": 1507,
  "timeToAllSyncedMs": 1507,
  "total": 1000
 }
}
```

### Notes

- Host load average (1 min) peaked at 4.3 during the run so far.

## 10. rolling restart (2 instances) (topology A) [ok]

Started 2026-11-12T02:48:02.793Z, ended 2026-11-12T02:49:29.320Z.

```json
{
 "instances": 1,
 "docs": 100,
 "clients": 400,
 "settleS": 30,
 "instanceDownS": 5,
 "typingRate": 1,
 "backoff": "400 ms base, x2, cap 30 s, equal jitter 0.5 (same as packages/editor/src/collab/backoff.ts)"
}
```

#### restart of instance 1 (SIGTERM, 5s down, start) (36 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 10562 | 0.8 | 1.7 | 9581.9 | 11911.2 | 199.6 |
| ack | 10570 | 3.8 | 5.9 | 8.1 | 11919.3 | 23.7 |
| ticketMs | 400 | 5.4 | 13.3 | 19.2 | 45.7 | 6.6 |
| ackOffline | 3710 | 4638.9 | 9295.8 | 10368.8 | 11492.9 | 4711.9 |
| reconnect | 400 | 9296.5 | 11099.6 | 11523.9 | 11867.9 | 9288.8 |

Client counters: edits=14282, shutdown_notice=400, connect_errors=1599, reconnects=400

Client errors: net_UND_ERR_SOCKET=838, net_ECONNRESET=761

WebSocket close codes seen: 4503 server_shutdown=400

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 28.9 | 39.8 | 369 | 188 | 400 | 0 | 100 | 10 / 10 | 4 (0.5) | 23.5 | 28 | 0.0 | 0 |

Server :4450 persist append: n=-2,454 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; compact: n=-199 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; yjs updates -2,450; HTTP /api (server-side) n=-2,000 mean n/a ms, p95 <= n/a ms; ws outcomes accepted=-2000

Generator (4 worker processes): CPU % per worker 9/9/9/8; event-loop lag p99 max 11.0 ms (max 15.3 ms); host load1 max 4.6

```json
{
 "sigtermAt": "2026-11-12T02:48:52.992Z",
 "shutdownMs": 178,
 "startToHealthyMs": 527,
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
   "shutdownMs": 178,
   "startToHealthyMs": 527
  }
 ],
 "quiesce": {
  "ok": true,
  "unacked": 0,
  "waitedMs": 502
 },
 "verification": {
  "docs": 100,
  "checked": 26294,
  "missing": 0,
  "missingSamples": [],
  "unackedAtEnd": 0,
  "exportErrors": 0
 }
}
```

### Notes

- Host load average (1 min) peaked at 4.6 during the run so far.

## 8. session creation API (topology A) [ok]

Started 2026-11-12T02:49:31.330Z, ended 2026-11-12T02:50:31.322Z.

```json
{
 "requestsPerSecond": 20,
 "durationS": 60,
 "apiKeys": 1,
 "replayShare": 0.3,
 "serverEnvOverrides": {},
 "note": "RATE_API_KEY_PER_MINUTE is per API key (default 600/min)"
}
```

#### 20 req/s for 60 s (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 12 | 1.8 | 3.1 | 3.1 | 3.1 | 1.8 |
| ack | 15 | 6.3 | 8.3 | 8.3 | 8.3 | 6.3 |

Client counters: edits=12

WebSocket close codes seen: 1005=400

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 4.9 | 8.9 | 385 | 207 | 0 | 0 | 0 | 10 / 10 | 0 (0.0) | 21.5 | 0 | 0.0 | 0 |

Server :4450 persist append: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; compact: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; yjs updates 0; HTTP /api (server-side) n=1,200 mean 5.0 ms, p95 <= 25.0 ms; ws outcomes accepted=0

Generator (4 worker processes): CPU % per worker 0/0/0/0; event-loop lag p99 max 10.4 ms (max 16.8 ms); host load1 max 4.1

```json
{
 "sent": 1200,
 "achievedRequestsPerSecond": 20.02,
 "statusCounts": {
  "create_201": 434,
  "replay_201": 166,
  "replay_429": 182,
  "create_429": 418
 },
 "createLatencyMs": {
  "n": 434,
  "min": 7.60815499999444,
  "p50": 11.768993000005139,
  "p95": 17.12375999998767,
  "p99": 22.724431000009645,
  "mean": 12.215957562212415,
  "max": 33.315085000009276
 },
 "replayLatencyMs": {
  "n": 166,
  "min": 2.595039000007091,
  "p50": 3.7436690000176895,
  "p95": 4.922587000008207,
  "p99": 5.4327659999835305,
  "mean": 3.8075573313255453,
  "max": 5.7408960000029765
 },
 "replayResponsesWithReplayedHeader": 166,
 "rateLimited429WithRetryAfter": 600
}
```

### Results

```json
{
 "openApiPaths": [
  "/api/v1/interview-sessions",
  "/api/v1/interview-sessions/{id}",
  "/api/v1/interview-sessions/{id}/participants",
  "/api/v1/interview-sessions/{id}/participants/{participantId}",
  "/api/v1/interview-sessions/{id}/rotate-links",
  "/api/v1/interview-sessions/{id}/start",
  "/api/v1/interview-sessions/{id}/complete",
  "/api/v1/interview-sessions/{id}/cancel",
  "/api/v1/interview-sessions/{id}/audit",
  "/api/v1/interview-sessions/{id}/document",
  "/api/v1/webhooks",
  "/api/v1/webhooks/{id}",
  "/api/v1/webhooks/{id}/deliveries",
  "/api/v1/webhooks/deliveries/{deliveryId}/retry"
 ]
}
```

### Notes

- Host load average (1 min) peaked at 4.6 during the run so far.

## 6. presence updates (topology A) [ok]

Started 2026-11-12T02:50:33.323Z, ended 2026-11-12T02:52:33.476Z.

```json
{
 "docs": 100,
 "perDoc": 4,
 "clients": 400,
 "awarenessUpdatesPerSecondPerClient": 5,
 "durationS": 90
}
```

#### presence updates (90 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| presence | 180000 | 5.0 | 33.0 | 42.0 | 55.0 | 9.7 |

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 32.1 | 41.6 | 428 | 195 | 400 | 0 | 100 | 10 / 10 | 0 (0.0) | 42.5 | 0 | 0.0 | 0 |

Server :4450 persist append: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; compact: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; yjs updates 0; HTTP /api (server-side) n=0 mean n/a ms, p95 <= n/a ms; ws outcomes accepted=0

Generator (4 worker processes): CPU % per worker 6/6/6/6; event-loop lag p99 max 10.9 ms (max 14.4 ms); host load1 max 4.3

```json
{
 "targetUpdatesPerSecond": 2000
}
```

### Notes

- Presence latency is awareness-update send time (timestamp inside the awareness state) to apply time at the sampled receiver in the same worker process. The server throttles/coalesces presence frames (collab/presence.ts), so latency includes that trailing throttle.
- Host load average (1 min) peaked at 4.6 during the run so far.
