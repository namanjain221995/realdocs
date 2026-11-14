# Performance run (2026-11-14T05:55:38.031Z, topology A)

## A. Two people editing one document (topology A) [ok]

Started 2026-11-14T05:51:35.743Z, ended 2026-11-14T05:51:55.639Z.

```json
{
 "documents": 1,
 "users": 2,
 "rounds": 100,
 "workers": "one process, one clock"
}
```

#### pair session (18 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ticketMs | 3 | 6.1 | 9.1 | 9.1 | 9.1 | 6.6 |
| connect | 2 | 37.8 | 95.3 | 95.3 | 95.3 | 66.5 |
| reconnect | 1 | 288.4 | 288.4 | 288.4 | 288.4 | 288.4 |

Client counters: drops=1, reconnects=1

WebSocket close codes seen: 1005=1

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 8.4 | 12.4 | 301 | 150 | 2 | 0 | 1 | 3 / 10 | 0 (0.0) | 21.3 | 31 | 0.0 | 0 |

Server :4450 persist append: n=1,252 mean 2.6 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=1 mean 9.2 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 1,514; HTTP /api (server-side) n=1 mean 4.1 ms, p95 <= 5.0 ms; ws outcomes accepted=1

Generator (8 worker processes): CPU % per worker 26/0/0/0/0/0/0/0; event-loop lag p99 max 11.0 ms (max 300.9 ms); host load1 max 3.0

```json
{
 "firstAttempt": {
  "ok": 2
 },
 "system": {
  "samples": 3,
  "host": {
   "load1Max": 2.8,
   "availableMbMin": 30321.5,
   "swapUsedMbMax": 17515.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 9.6,
    "cpuPctMax": 11.2,
    "rssMbMax": 300.8
   }
  },
  "postgres": {
   "cpuPctAvg": 15.5,
   "cpuPctMax": 23.1,
   "memMbMax": 39.9,
   "commitsPerSecond": 84.2,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 187.2,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0.7,
   "blockWriteMs": 3.6,
   "deadlocks": 0,
   "backendsMax": 4,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 }
}
```

### Results

```json
{
 "operationLatencyMs": {
  "typing:remote": {
   "n": 400,
   "min": 0.23393899999973655,
   "p50": 0.794025999999576,
   "p95": 1.2743839999998272,
   "p99": 1.571299000000181,
   "mean": 0.8127365224999943,
   "max": 3.0562459999998737
  },
  "typing:ack": {
   "n": 400,
   "min": 1.7494290000004185,
   "p50": 3.243271999999706,
   "p95": 4.419575000000805,
   "p99": 5.25339299999996,
   "mean": 3.263885702499976,
   "max": 6.241070000000036
  },
  "deletion:remote": {
   "n": 200,
   "min": 0.17651400000022477,
   "p50": 0.713369000000057,
   "p95": 1.155678999999509,
   "p99": 1.4044169999997393,
   "mean": 0.7471826949999786,
   "max": 2.1669710000001032
  },
  "deletion:ack": {
   "n": 200,
   "min": 1.749478000000181,
   "p50": 3.000836999999592,
   "p95": 4.187426999999843,
   "p99": 4.7025549999998475,
   "mean": 3.110786024999986,
   "max": 5.160224000000198
  },
  "formatting:remote": {
   "n": 200,
   "min": 0.26313900000013746,
   "p50": 0.7721700000001874,
   "p95": 1.2745750000003682,
   "p99": 1.6894609999999375,
   "mean": 0.8024950450000449,
   "max": 2.0959300000004077
  },
  "formatting:ack": {
   "n": 200,
   "min": 1.6914290000004257,
   "p50": 3.068822000000182,
   "p95": 4.139732000000095,
   "p99": 5.045326999999816,
   "mean": 3.1130299450000085,
   "max": 5.2467370000001665
  },
  "paragraph:remote": {
   "n": 200,
   "min": 0.13102600000001985,
   "p50": 0.490629999999328,
   "p95": 0.8526179999998931,
   "p99": 1.0112759999997252,
   "mean": 0.5048826900000074,
   "max": 1.4158099999995102
  },
  "paragraph:ack": {
   "n": 200,
   "min": 1.7277169999997568,
   "p50": 2.918836000000283,
   "p95": 3.9648489999999583,
   "p99": 4.764282999999978,
   "mean": 2.967650664999986,
   "max": 4.936877000000095
  },
  "paste2kB:remote": {
   "n": 200,
   "min": 0.20504200000004857,
   "p50": 0.7671299999997245,
   "p95": 1.1687339999998585,
   "p99": 1.311087999999927,
   "mean": 0.7657182900000157,
   "max": 1.918199999999615
  },
  "paste2kB:ack": {
   "n": 200,
   "min": 1.692613000000165,
   "p50": 2.982212999999774,
   "p95": 4.170851999999968,
   "p99": 4.731082999999899,
   "mean": 3.0422088399999927,
   "max": 5.039038000000346
  },
  "cursor:remote": {
   "n": 200,
   "min": 0.46434099999987666,
   "p50": 11.104777999999897,
   "p95": 16.934514000000036,
   "p99": 18.744488000000274,
   "mean": 10.925675049999965,
   "max": 19.04550100000006
  },
  "reconnect:caughtUp": {
   "n": 1,
   "min": 290.78042600000117,
   "p50": 290.78042600000117,
   "p95": 290.78042600000117,
   "p99": 290.78042600000117,
   "mean": 290.78042600000117,
   "max": 290.78042600000117
  }
 },
 "timeoutsPerOperation": {
  "typing:remote": 0,
  "typing:ack": 0,
  "deletion:remote": 0,
  "deletion:ack": 0,
  "formatting:remote": 0,
  "formatting:ack": 0,
  "paragraph:remote": 0,
  "paragraph:ack": 0,
  "paste2kB:remote": 0,
  "paste2kB:ack": 0,
  "cursor:remote": 0,
  "reconnect:caughtUp": 0
 },
 "editToRemoteVisibleAllOperations": {
  "n": 1200,
  "min": 0.13102600000001985,
  "p50": 0.7226810000001933,
  "p95": 1.1909579999992275,
  "p99": 1.5387069999997038,
  "mean": 0.7409586275000059,
  "max": 3.0562459999998737
 },
 "editToSavedAcknowledgement": {
  "n": 1200,
  "min": 1.6914290000004257,
  "p50": 3.0593340000000353,
  "p95": 4.262741000000005,
  "p99": 4.992062000000033,
  "mean": 3.126907813333322,
  "max": 6.241070000000036
 },
 "simultaneousTyping": {
  "tokensTyped": 1000,
  "missingAfterMerge": 0,
  "inServerExport": 1000
 },
 "convergedBetweenTheTwoClients": true,
 "reloadByFreshClient": [
  {
   "ms": 28.44189453125,
   "stateBytes": 455020,
   "blocks": 203
  },
  {
   "ms": 38.626953125,
   "stateBytes": 455020,
   "blocks": 203
  },
  {
   "ms": 39.6142578125,
   "stateBytes": 455020,
   "blocks": 203
  }
 ],
 "serverExportStatus": 200,
 "documentStateBytes": 455020,
 "verdict": {
  "stable": true,
  "reasons": []
 },
 "systemWholeScenario": {
  "samples": 3,
  "host": {
   "load1Max": 2.8,
   "availableMbMin": 30321.5,
   "swapUsedMbMax": 17515.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 9.6,
    "cpuPctMax": 11.2,
    "rssMbMax": 300.8
   }
  },
  "postgres": {
   "cpuPctAvg": 15.5,
   "cpuPctMax": 23.1,
   "memMbMax": 39.9,
   "commitsPerSecond": 84.2,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 187.2,
   "walMbPerSecond": 0.1,
   "blockReadMs": 0.7,
   "blockWriteMs": 3.6,
   "deadlocks": 0,
   "backendsMax": 4,
   "activeMax": 1,
   "waitingOnLocksMax": 0
  }
 }
}
```

## B. 100 documents, 2 active editors each (200 users) (topology A) [ok]

Started 2026-11-14T05:51:57.649Z, ended 2026-11-14T05:55:36.021Z.

```json
{
 "docs": 100,
 "perDoc": 2,
 "assign": [
  "active"
 ],
 "rampS": 20,
 "warmupS": 15,
 "durationS": 180,
 "name": "200 active editors",
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
 "seed": 20261114
}
```

#### connect (20 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| reader / ticketMs | 3 | 4.5 | 4.8 | 4.8 | 4.8 | 4.5 |
| reader / connect | 3 | 38.6 | 39.6 | 39.6 | 39.6 | 35.5 |
| u / ticketMs | 200 | 3.2 | 4.8 | 8.1 | 22.5 | 3.5 |
| u / connect | 200 | 32.2 | 45.5 | 72.5 | 86.6 | 34.8 |
| ALL / ticketMs | 203 | 3.3 | 4.8 | 8.1 | 22.5 | 3.5 |
| ALL / connect | 203 | 32.3 | 45.5 | 72.5 | 86.6 | 34.8 |

WebSocket close codes seen: 1005=5

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 8.4 | 10.5 | 308 | 155 | 200 | 0 | 100 | 10 / 10 | 0 (0.0) | 21.0 | 36 | 0.0 | 0 |

Server :4450 persist append: n=182 mean 2.8 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=0 mean n/a ms, p95 <= n/a ms, p99 <= n/a ms; yjs updates 182; HTTP /api (server-side) n=364 mean 5.0 ms, p95 <= 25.0 ms; ws outcomes accepted=182

Generator (8 worker processes): CPU % per worker 1/1/1/1/1/1/1/1; event-loop lag p99 max 10.6 ms (max 31.9 ms); host load1 max 2.4

```json
{
 "firstAttempt": {
  "ok": 200
 }
}
```

#### 200 active editors (180 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 21802 | 0.7 | 1.0 | 1.2 | 330.0 | 0.7 |
| ack | 21793 | 3.3 | 4.6 | 5.3 | 14.5 | 3.3 |
| presence | 3740 | 1.0 | 30096.0 | 45007.0 | 47969.0 | 4560.9 |
| ticketMs | 30 | 4.0 | 5.2 | 6.1 | 6.1 | 4.1 |
| ackOffline | 12 | 104.8 | 342.0 | 342.0 | 342.0 | 115.3 |
| reconnect | 30 | 328.0 | 417.6 | 422.1 | 422.1 | 325.4 |

Client counters: edits=21806, cursor_updates=3158, deletes=3133, formats=3124, drops=30, reconnects=30

WebSocket close codes seen: 1005=30

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 9.3 | 12.1 | 318 | 165 | 200 | 0 | 100 | 10 / 10 | 0 (0.0) | 21.2 | 82 | 0.0 | 0 |

Server :4450 persist append: n=26,577 mean 2.6 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=100 mean 3.0 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 26,631; HTTP /api (server-side) n=30 mean 2.3 ms, p95 <= 5.0 ms; ws outcomes accepted=30

Generator (8 worker processes): CPU % per worker 2/1/1/1/1/1/1/1; event-loop lag p99 max 10.9 ms (max 20.2 ms); host load1 max 2.3

```json
{
 "usersActive": 200,
 "markerEditsPerSecond": 121.1,
 "deletesPerSecond": 17.41,
 "formatsPerSecond": 17.36,
 "cursorUpdatesPerSecond": 17.54,
 "connectionDrops": 30,
 "reconnects": 30,
 "completedFullDuration": true,
 "system": {
  "samples": 36,
  "host": {
   "load1Max": 2.3,
   "availableMbMin": 30478.3,
   "swapUsedMbMax": 17515.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 9.5,
    "cpuPctMax": 13.2,
    "rssMbMax": 318.3
   }
  },
  "postgres": {
   "cpuPctAvg": 19.6,
   "cpuPctMax": 25.5,
   "memMbMax": 100.2,
   "commitsPerSecond": 180,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 305.3,
   "walMbPerSecond": 0.2,
   "blockReadMs": 0.3,
   "blockWriteMs": 74.8,
   "deadlocks": 0,
   "backendsMax": 12,
   "activeMax": 2,
   "waitingOnLocksMax": 0
  }
 }
}
```

### Results

```json
{
 "connection": {
  "attempted": 200,
  "succeededFirstAttempt": 200,
  "successPct": 100,
  "failuresByCause": {}
 },
 "quiesce": {
  "ok": true,
  "unacked": 0,
  "waitedMs": 0
 },
 "connectedAtEnd": 200,
 "verification": {
  "docs": 100,
  "checked": 23697,
  "missing": 0,
  "missingSamples": [],
  "unackedAtEnd": 0,
  "exportErrors": 0
 },
 "convergence": {
  "docs": 100,
  "diverged": 0,
  "clientsCompared": 200,
  "samples": []
 },
 "topStatements": [
  {
   "calls": 27155,
   "meanMs": 0.214,
   "totalMs": 5806.1,
   "rows": 27155,
   "query": "WITH doc AS ( SELECT id, generation, head_seq, history_seq, schema_version FROM documents WHERE id = $1::uuid AND workspace_id = $2::uuid FOR UPDATE ), ins AS ( I"
  },
  {
   "calls": 100,
   "meanMs": 0.533,
   "totalMs": 53.3,
   "rows": 100,
   "query": "WITH doc AS ( SELECT id, generation, head_seq, history_seq, schema_version FROM documents WHERE id = $1::uuid AND workspace_id = $2::uuid FOR UPDATE ), ok AS ( SE"
  },
  {
   "calls": 1359,
   "meanMs": 0.027,
   "totalMs": 36.6,
   "rows": 1359,
   "query": "SELECT d.id, d.workspace_id AS \"workspaceId\", d.title, d.status, d.generation, d.schema_version AS \"schemaVersion\", d.head_seq AS \"headSeq\", d.created_by AS \"createdBy\", (SELECT u.display_name FROM users u WHERE u"
  },
  {
   "calls": 1259,
   "meanMs": 0.02,
   "totalMs": 25.1,
   "rows": 1259,
   "query": "SELECT g.id, g.workspace_id AS \"workspaceId\", g.document_id AS \"documentId\", g.role, g.secret_hash AS \"secretHash\", g.label, g.created_by AS \"createdBy\", (SELECT u.display_name FROM users u WHERE u.id = g.created_"
  },
  {
   "calls": 1229,
   "meanMs": 0.02,
   "totalMs": 24.5,
   "rows": 1229,
   "query": "SELECT id, workspace_id AS \"workspaceId\", kind, user_id AS \"userId\", share_grant_id AS \"shareGrantId\", document_id AS \"documentId\", parent_session_id AS \"parentSessionId\", guest_name AS \"guestName\", created_at A"
  },
  {
   "calls": 136,
   "meanMs": 0.124,
   "totalMs": 16.9,
   "rows": 458,
   "query": "UPDATE sessions SET last_seen_at = now() WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL AND last_seen_at < now() - interval $2"
  },
  {
   "calls": 160,
   "meanMs": 0.022,
   "totalMs": 3.6,
   "rows": 160,
   "query": "SELECT id, workspace_id AS \"workspaceId\", kind, user_id AS \"userId\", share_grant_id AS \"shareGrantId\", document_id AS \"documentId\", parent_session_id AS \"parentSessionId\", guest_name AS \"guestName\", created_at A"
  },
  {
   "calls": 1259,
   "meanMs": 0.003,
   "totalMs": 3.2,
   "rows": 0,
   "query": "SELECT g.id AS \"grantId\", p.id AS \"participantId\", p.session_id AS \"sessionId\", p.role, p.name, s.status AS \"sessionStatus\", s.permissions FROM share_grants g JOIN interview_pa"
  },
  {
   "calls": 100,
   "meanMs": 0.023,
   "totalMs": 2.3,
   "rows": 100,
   "query": "SELECT id, workspace_id AS \"workspaceId\", email::text AS email, display_name AS \"displayName\", role, status, created_at AS \"createdAt\" FROM users WHERE id = $1 AND workspace_id = $2 AND status = $3"
  },
  {
   "calls": 100,
   "meanMs": 0.023,
   "totalMs": 2.3,
   "rows": 100,
   "query": "SELECT id, workspace_id AS \"workspaceId\", email::text AS email, display_name AS \"displayName\", role, status, created_at AS \"createdAt\" FROM users WHERE id = ANY($1::uuid[]) AND workspace_id = $2"
  },
  {
   "calls": 100,
   "meanMs": 0.015,
   "totalMs": 1.5,
   "rows": 0,
   "query": "SELECT user_id AS \"userId\", role FROM document_members WHERE document_id = $1 AND workspace_id = $2 AND user_id = ANY($3::uuid[])"
  },
  {
   "calls": 90,
   "meanMs": 0.008,
   "totalMs": 0.7,
   "rows": 0,
   "query": "WITH due AS ( SELECT d.id FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id AND e.enabled WHERE d.workspace_id = $1 AND d.status IN ($4, $5) AND d.next_attempt_at <="
  }
 ],
 "verdict": {
  "stable": true,
  "reasons": []
 },
 "systemWholeScenario": {
  "samples": 43,
  "host": {
   "load1Max": 2.3,
   "availableMbMin": 30191.4,
   "swapUsedMbMax": 17515.5
  },
  "server": {
   "4450": {
    "cpuPctAvg": 9.5,
    "cpuPctMax": 14.2,
    "rssMbMax": 318.3
   }
  },
  "postgres": {
   "cpuPctAvg": 19,
   "cpuPctMax": 30.6,
   "memMbMax": 100.2,
   "commitsPerSecond": 180.6,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 281.9,
   "walMbPerSecond": 0.2,
   "blockReadMs": 0.7,
   "blockWriteMs": 83,
   "deadlocks": 0,
   "backendsMax": 12,
   "activeMax": 2,
   "waitingOnLocksMax": 0
  }
 }
}
```
