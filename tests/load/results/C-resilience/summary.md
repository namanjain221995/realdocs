# Load test summary (2026-11-12T03:11:02.828Z, topology C)

## 13. reconnect storm (topology C) [ok]

Started 2026-11-12T03:02:15.495Z, ended 2026-11-12T03:03:26.802Z.

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
| ticketMs | 1000 | 4.1 | 5.6 | 7.3 | 10.7 | 4.2 |
| connect | 1000 | 31.6 | 43.4 | 54.4 | 92.3 | 33.1 |

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 8.8 | 13.3 | 313 | 159 | 512 | 171 | 128 | 10 / 10 | 0 (0.0) | 22.2 | 0 | 0.6 | 0 |
| :4451 | 8.5 | 11.6 | 311 | 162 | 488 | 184 | 122 | 10 / 10 | 0 (0.0) | 21.0 | 0 | 0.7 | 0 |

Server :4450 persist append: n=478 mean 3.0 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; yjs updates 478; HTTP /api (server-side) n=934 mean 4.1 ms, p95 <= 10.0 ms; ws outcomes accepted=478, forwarded=171

Server :4451 persist append: n=457 mean 2.9 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; yjs updates 457; HTTP /api (server-side) n=936 mean 5.8 ms, p95 <= 25.0 ms; ws outcomes accepted=457, forwarded=182

Generator (4 worker processes): CPU % per worker 2/3/2/3; event-loop lag p99 max 10.9 ms (max 33.0 ms); host load1 max 5.7

```json
{
 "readyAfterInitial": 1000,
 "total": 1000
}
```

#### storm and recovery (1 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ticketMs | 1000 | 143.3 | 252.0 | 253.9 | 255.3 | 144.0 |
| reconnect | 1000 | 679.2 | 814.9 | 832.5 | 843.3 | 655.7 |

Client counters: reconnects=1000

WebSocket close codes seen: 1006=1000

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 96.6 | 96.6 | 333 | 134 | 512 | 224 | 128 | 10 / 10 | 0 (0.0) | 40.6 | 0 | 0.3 | 0 |
| :4451 | 114.8 | 114.8 | 324 | 138 | 568 | 184 | 142 | 10 / 10 | 0 (0.0) | 59.5 | 0 | 0.4 | 0 |

Server :4450 persist append: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; compact: n=128 mean 13.5 ms, p95 <= 25.0 ms, p99 <= 50.0 ms; yjs updates 0; HTTP /api (server-side) n=505 mean 95.2 ms, p95 <= 250.0 ms; ws outcomes accepted=432, forwarded=224

Server :4451 persist append: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; compact: n=122 mean 17.6 ms, p95 <= 50.0 ms, p99 <= 50.0 ms; yjs updates 0; HTTP /api (server-side) n=495 mean 112.5 ms, p95 <= 250.0 ms; ws outcomes accepted=568, forwarded=168

Generator (4 worker processes): CPU % per worker 45/50/49/47; event-loop lag p99 max 15.1 ms (max 26.8 ms); host load1 max 3.5

```json
{
 "timeTo99PctSyncedMs": 1012,
 "timeToAllSyncedMs": 1012,
 "readyAtEnd": 1000,
 "total": 1000
}
```

### Results

```json
{
 "storm": {
  "timeTo99PctSyncedMs": 1012,
  "timeToAllSyncedMs": 1012,
  "total": 1000
 }
}
```

### Notes

- Host load average (1 min) peaked at 6.0 during the run so far.

## 10. rolling restart (2 instances) (topology C) [ok]

Started 2026-11-12T03:03:28.826Z, ended 2026-11-12T03:05:30.776Z.

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
| ack | 12846 | 3.5 | 5.2 | 6.5 | 11060.5 | 7.2 |
| remote | 12234 | 0.7 | 1.5 | 3554.1 | 11050.0 | 92.3 |
| ticketMs | 863 | 3.8 | 9.7 | 22.3 | 24.9 | 4.7 |
| reconnect | 254 | 5522.6 | 10865.1 | 11295.3 | 11515.3 | 5300.2 |
| ackOffline | 1335 | 4103.5 | 9192.4 | 10374.7 | 10809.2 | 4357.6 |

Client counters: shutdown_notice=164, edits=14183, connect_errors=622, reconnects=254

Client errors: ws_close_1006=609, net_UND_ERR_SOCKET=10, net_ECONNRESET=3

WebSocket close codes seen: 4503 server_shutdown=254

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 5.1 | 6.2 | 337 | 153 | 164 | 90 | 41 | 10 / 10 | 0 (0.0) | 21.9 | 28 | 0.5 | 0 |
| :4451 | 29.2 | 63.0 | 350 | 177 | 396 | 54 | 99 | 10 / 10 | 0 (0.0) | 21.1 | 56 | 0.8 | 0 |

Server :4450 persist append: n=-5,491 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; yjs updates -5,492; HTTP /api (server-side) n=n/a mean n/a ms, p95 <= n/a ms; ws outcomes forwarded=-422, accepted=-1104

Server :4451 persist append: n=12,938 mean 2.8 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=59 mean 2.9 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; yjs updates 12,941; HTTP /api (server-side) n=863 mean 3.5 ms, p95 <= 10.0 ms; ws outcomes accepted=250, forwarded=2

Generator (4 worker processes): CPU % per worker 8/8/8/8; event-loop lag p99 max 11.0 ms (max 15.0 ms); host load1 max 4.5

```json
{
 "sigtermAt": "2026-11-12T03:04:18.886Z",
 "shutdownMs": 101,
 "startToHealthyMs": 364,
 "readyClientsAtEnd": 400,
 "total": 400
}
```

#### restart of instance 2 (SIGTERM, 5s down, start) (36 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ack | 12345 | 4.1 | 6.0 | 9.6 | 11174.7 | 14.1 |
| remote | 11809 | 0.9 | 2.0 | 7972.4 | 11167.5 | 141.6 |
| ticketMs | 1191 | 6.3 | 128.0 | 161.9 | 167.2 | 20.7 |
| reconnect | 398 | 3809.8 | 10478.2 | 11131.1 | 11372.5 | 4865.7 |
| ackOffline | 1948 | 3636.0 | 8909.6 | 10012.6 | 11062.0 | 4015.9 |

Client counters: edits=14294, shutdown_notice=396, connect_errors=956, reconnects=398

Client errors: net_ECONNRESET=88, net_UND_ERR_SOCKET=75, ws_close_1006=793

WebSocket close codes seen: 4503 server_shutdown=398

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 44.3 | 113.7 | 396 | 222 | 396 | 63 | 99 | 10 / 10 | 0 (0.0) | 26.5 | 82 | 0.7 | 0 |
| :4451 | 6.8 | 7.8 | 350 | 177 | 396 | 84 | 99 | 10 / 10 | 0 (0.0) | 21.0 | 28 | 0.7 | 0 |

Server :4450 persist append: n=12,559 mean 3.2 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; compact: n=1 mean 4.7 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 12,569; HTTP /api (server-side) n=1,191 mean 10.7 ms, p95 <= 100.0 ms; ws outcomes forwarded=2, accepted=394

Server :4451 persist append: n=-20,637 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; yjs updates -20,643; HTTP /api (server-side) n=n/a mean n/a ms, p95 <= n/a ms; ws outcomes accepted=-1538, forwarded=-324

Generator (4 worker processes): CPU % per worker 11/11/12/12; event-loop lag p99 max 11.0 ms (max 16.4 ms); host load1 max 5.1

```json
{
 "sigtermAt": "2026-11-12T03:04:54.396Z",
 "shutdownMs": 151,
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
   "shutdownMs": 101,
   "startToHealthyMs": 364
  },
  {
   "instance": 2,
   "shutdownMs": 151,
   "startToHealthyMs": 527
  }
 ],
 "quiesce": {
  "ok": true,
  "unacked": 0,
  "waitedMs": 501
 },
 "verification": {
  "docs": 100,
  "checked": 40489,
  "missing": 0,
  "missingSamples": [],
  "unackedAtEnd": 0,
  "exportErrors": 0
 }
}
```

### Notes

- Host load average (1 min) peaked at 6.0 during the run so far.

## 11. Redis restart during typing (topology C) [ok]

Started 2026-11-12T03:05:32.792Z, ended 2026-11-12T03:07:13.703Z.

```json
{
 "docs": 100,
 "clients": 400,
 "typingRate": 1
}
```

#### Redis restarted during typing (51 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ack | 20228 | 3.4 | 5.0 | 6.6 | 39.6 | 3.5 |
| remote | 20228 | 0.7 | 1.2 | 1.7 | 34.6 | 0.7 |

Client counters: edits=20229

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 16.6 | 20.9 | 443 | 245 | 204 | 71 | 51 | 10 / 10 | 0 (0.0) | 21.1 | 56 | 0.8 | 0 |
| :4451 | 15.4 | 18.7 | 326 | 172 | 196 | 75 | 49 | 10 / 10 | 6 (0.5) | 21.4 | 54 | 0.9 | 0 |

Server :4450 persist append: n=10,314 mean 2.8 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; compact: n=51 mean 3.0 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 10,316; HTTP /api (server-side) n=0 mean n/a ms, p95 <= n/a ms; ws outcomes forwarded=0, accepted=0

Server :4451 persist append: n=9,913 mean 2.8 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; compact: n=49 mean 3.0 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; yjs updates 9,913; HTTP /api (server-side) n=0 mean n/a ms, p95 <= n/a ms; ws outcomes accepted=0, forwarded=0

Generator (4 worker processes): CPU % per worker 5/5/5/5; event-loop lag p99 max 11.0 ms (max 13.7 ms); host load1 max 6.6

```json
{
 "dockerRestartMs": 381,
 "readinessProbes": 398,
 "readinessNon200": 2,
 "readinessStatusCounts": {
  "4450:503": 1,
  "4451:503": 1
 },
 "notReadyWindowMs": 0,
 "firstNotReadyAfterRestartMs": 384
}
```

### Results

```json
{
 "quiesce": {
  "ok": true,
  "unacked": 0,
  "waitedMs": 0
 },
 "verification": {
  "docs": 100,
  "checked": 32240,
  "missing": 0,
  "missingSamples": [],
  "unackedAtEnd": 0,
  "exportErrors": 0
 }
}
```

### Notes

- Host load average (1 min) peaked at 6.6 during the run so far.

## 14. revoked and expired links (topology C) [ok]

Started 2026-11-12T03:07:15.713Z, ended 2026-11-12T03:11:00.820Z.

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
| :4450 | 4.0 | 13.3 | 302 | 130 | 164 | 49 | 41 | 10 / 10 | 0 (0.0) | 20.8 | 0 | 0.4 | 0 |
| :4451 | 4.1 | 13.8 | 332 | 140 | 136 | 62 | 34 | 10 / 10 | 0 (0.0) | 20.9 | 0 | 0.7 | 0 |

Server :4450 persist append: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; compact: n=26 mean 15.8 ms, p95 <= 50.0 ms, p99 <= 50.0 ms; yjs updates 0; HTTP /api (server-side) n=110 mean 2.0 ms, p95 <= 5.0 ms; ws outcomes forwarded=0, accepted=0

Server :4451 persist append: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; compact: n=24 mean 14.9 ms, p95 <= 50.0 ms, p99 <= 50.0 ms; yjs updates 0; HTTP /api (server-side) n=160 mean 22.1 ms, p95 <= 100.0 ms; ws outcomes accepted=0, forwarded=0

Generator (4 worker processes): CPU % per worker 1/1/1/1; event-loop lag p99 max 10.5 ms (max 13.2 ms); host load1 max 6.6

```json
{
 "revokeApiStatus": {
  "200": 50
 },
 "revokeApiMs": 119.593017578125,
 "socketsToCloseAfterRevoke": 200,
 "closeLatencyMs": {
  "n": 200,
  "min": 41.899658203125,
  "p50": 104.982421875,
  "p95": 143.16650390625,
  "p99": 144.587158203125,
  "mean": 103.80426025390625,
  "max": 145.008056640625
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
   "min": 57.130126953125,
   "p50": 79.02783203125,
   "p95": 105.275146484375,
   "p99": 106.91748046875,
   "mean": 80.43180419921875,
   "max": 108.1005859375
  },
  "stillOpen": 0,
  "exchangeAfterExpiryStatus": 410
 },
 "revocation": {
  "closeLatencyMs": {
   "n": 200,
   "min": 41.899658203125,
   "p50": 104.982421875,
   "p95": 143.16650390625,
   "p99": 144.587158203125,
   "mean": 103.80426025390625,
   "max": 145.008056640625
  },
  "stillOpen": 0
 }
}
```

### Notes

- Host load average (1 min) peaked at 9.7 during the run so far.
