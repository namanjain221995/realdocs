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