## C. 500 documents, 2 active editors each (1,000 users) (topology A) [ok]

Started 2026-11-14T06:01:19.996Z, ended 2026-11-14T06:07:44.877Z.

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
 "durationS": 300,
 "name": "1,000 active editors",
 "profiles": {
  "normal": {
   "rate": 0.3,
   "type": 6,
   "delete": 1,
   "format": 1,
   "cursor": 2,
   "pauseChance": 0.1,
   "pauseS": [
    2,
    15
   ],
   "reconnectChance": 0.002
  },
  "active": {
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
  "heavy": {
   "rate": 3,
   "type": 8,
   "delete": 1,
   "format": 0.5,
   "cursor": 0.5,
   "pauseChance": 0.01,
   "pauseS": [
    0.5,
    3
   ],
   "reconnectChance": 0.0005
  }
 },
 "seed": 20261114
}
```

#### connect (60 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ticketMs | 1000 | 2.9 | 4.1 | 6.2 | 10.0 | 2.9 |
| connect | 1000 | 29.6 | 41.7 | 54.3 | 88.2 | 31.1 |

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 12.3 | 17.0 | 370 | 178 | 1,000 | 0 | 500 | 10 / 10 | 0 (0.0) | 23.9 | 36 | 0.0 | 0 |

Server :4450 persist append: n=954 mean 2.7 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 954; HTTP /api (server-side) n=1,908 mean 3.9 ms, p95 <= 10.0 ms; ws outcomes accepted=954

Generator (8 worker processes): CPU % per worker 2/2/2/2/2/2/2/2; event-loop lag p99 max 11.1 ms (max 32.9 ms); host load1 max 3.0

```json
{
 "firstAttempt": {
  "ok": 1000
 }
}
```

#### 1,000 active editors (300 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| remote | 226793 | 0.5 | 1.4 | 3.8 | 381.0 | 0.8 |
| ack | 226764 | 3.5 | 5.2 | 10.1 | 346.6 | 3.7 |
| presence | 27252 | 1.0 | 31356.0 | 46569.0 | 50639.0 | 5427.5 |
| ticketMs | 274 | 4.1 | 6.9 | 23.7 | 30.7 | 4.6 |
| reconnect | 274 | 317.1 | 407.8 | 415.5 | 443.7 | 318.9 |
| ackOffline | 107 | 154.9 | 327.3 | 377.2 | 393.6 | 156.4 |

Client counters: edits=226876, deletes=30480, formats=21609, cursor_updates=24391, drops=274, reconnects=274

WebSocket close codes seen: 1005=274

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 45.6 | 55.2 | 550 | 325 | 1,000 | 0 | 500 | 10 / 10 | 0 (0.0) | 22.7 | 263 | 0.0 | 0 |

Server :4450 persist append: n=272,677 mean 2.9 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; compact: n=1,111 mean 3.6 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 273,511; HTTP /api (server-side) n=274 mean 2.9 ms, p95 <= 5.0 ms; ws outcomes accepted=274

Generator (8 worker processes): CPU % per worker 5/5/5/5/5/5/5/5; event-loop lag p99 max 10.9 ms (max 14.3 ms); host load1 max 4.6

```json
{
 "usersActive": 1000,
 "markerEditsPerSecond": 756.3,
 "deletesPerSecond": 101.6,
 "formatsPerSecond": 72.03,
 "cursorUpdatesPerSecond": 81.3,
 "connectionDrops": 274,
 "reconnects": 274,
 "completedFullDuration": true,
 "system": {
  "samples": 60,
  "host": {
   "load1Max": 4.6,
   "availableMbMin": 29293.8,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 45.6,
    "cpuPctMax": 51.6,
    "rssMbMax": 549.5
   }
  },
  "postgres": {
   "cpuPctAvg": 102.8,
   "cpuPctMax": 109.7,
   "memMbMax": 214.7,
   "commitsPerSecond": 1059.3,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1838.4,
   "walMbPerSecond": 1.4,
   "blockReadMs": 20.7,
   "blockWriteMs": 663.1,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 6,
   "waitingOnLocksMax": 0
  }
 }
}
```

### Results

```json
{
 "connection": {
  "attempted": 1000,
  "succeededFirstAttempt": 1000,
  "successPct": 100,
  "failuresByCause": {}
 },
 "quiesce": {
  "ok": true,
  "unacked": 0,
  "waitedMs": 502
 },
 "connectedAtEnd": 1000,
 "verification": {
  "docs": 500,
  "checked": 242657,
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
 "topStatements": [
  {
   "calls": 273076,
   "meanMs": 0.226,
   "totalMs": 61625.7,
   "rows": 273076,
   "query": "WITH doc AS ( SELECT id, generation, head_seq, history_seq, schema_version FROM documents WHERE id = $1::uuid AND workspace_id = $2::uuid FOR UPDATE ), ins AS ( I"
  },
  {
   "calls": 1113,
   "meanMs": 0.691,
   "totalMs": 769.4,
   "rows": 1113,
   "query": "WITH doc AS ( SELECT id, generation, head_seq, history_seq, schema_version FROM documents WHERE id = $1::uuid AND workspace_id = $2::uuid FOR UPDATE ), ok AS ( SE"
  },
  {
   "calls": 11046,
   "meanMs": 0.028,
   "totalMs": 307,
   "rows": 11046,
   "query": "SELECT d.id, d.workspace_id AS \"workspaceId\", d.title, d.status, d.generation, d.schema_version AS \"schemaVersion\", d.head_seq AS \"headSeq\", d.created_by AS \"createdBy\", (SELECT u.display_name FROM users u WHERE u"
  },
  {
   "calls": 10271,
   "meanMs": 0.025,
   "totalMs": 253.4,
   "rows": 10271,
   "query": "SELECT id, workspace_id AS \"workspaceId\", kind, user_id AS \"userId\", share_grant_id AS \"shareGrantId\", document_id AS \"documentId\", parent_session_id AS \"parentSessionId\", guest_name AS \"guestName\", created_at A"
  },
  {
   "calls": 10546,
   "meanMs": 0.024,
   "totalMs": 253.4,
   "rows": 10546,
   "query": "SELECT g.id, g.workspace_id AS \"workspaceId\", g.document_id AS \"documentId\", g.role, g.secret_hash AS \"secretHash\", g.label, g.created_by AS \"createdBy\", (SELECT u.display_name FROM users u WHERE u.id = g.created_"
  },
  {
   "calls": 785,
   "meanMs": 0.079,
   "totalMs": 61.8,
   "rows": 4015,
   "query": "UPDATE sessions SET last_seen_at = now() WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL AND last_seen_at < now() - interval $2"
  },
  {
   "calls": 10546,
   "meanMs": 0.003,
   "totalMs": 30.5,
   "rows": 0,
   "query": "SELECT g.id AS \"grantId\", p.id AS \"participantId\", p.session_id AS \"sessionId\", p.role, p.name, s.status AS \"sessionStatus\", s.permissions FROM share_grants g JOIN interview_pa"
  },
  {
   "calls": 1050,
   "meanMs": 0.024,
   "totalMs": 25.7,
   "rows": 1050,
   "query": "SELECT id, workspace_id AS \"workspaceId\", kind, user_id AS \"userId\", share_grant_id AS \"shareGrantId\", document_id AS \"documentId\", parent_session_id AS \"parentSessionId\", guest_name AS \"guestName\", created_at A"
  },
  {
   "calls": 500,
   "meanMs": 0.023,
   "totalMs": 11.7,
   "rows": 500,
   "query": "SELECT id, workspace_id AS \"workspaceId\", email::text AS email, display_name AS \"displayName\", role, status, created_at AS \"createdAt\" FROM users WHERE id = ANY($1::uuid[]) AND workspace_id = $2"
  },
  {
   "calls": 500,
   "meanMs": 0.022,
   "totalMs": 11.1,
   "rows": 500,
   "query": "SELECT id, workspace_id AS \"workspaceId\", email::text AS email, display_name AS \"displayName\", role, status, created_at AS \"createdAt\" FROM users WHERE id = $1 AND workspace_id = $2 AND status = $3"
  },
  {
   "calls": 500,
   "meanMs": 0.018,
   "totalMs": 8.9,
   "rows": 0,
   "query": "SELECT user_id AS \"userId\", role FROM document_members WHERE document_id = $1 AND workspace_id = $2 AND user_id = ANY($3::uuid[])"
  },
  {
   "calls": 151,
   "meanMs": 0.009,
   "totalMs": 1.4,
   "rows": 0,
   "query": "WITH due AS ( SELECT d.id FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id AND e.enabled WHERE d.workspace_id = $1 AND d.status IN ($4, $5) AND d.next_attempt_at <="
  }
 ],
 "verdict": {
  "stable": true,
  "reasons": []
 },
 "systemWholeScenario": {
  "samples": 76,
  "host": {
   "load1Max": 4.6,
   "availableMbMin": 29293.8,
   "swapUsedMbMax": 17514.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 40.5,
    "cpuPctMax": 52.8,
    "rssMbMax": 549.5
   }
  },
  "postgres": {
   "cpuPctAvg": 88.6,
   "cpuPctMax": 116.9,
   "memMbMax": 214.7,
   "commitsPerSecond": 952.8,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1567.5,
   "walMbPerSecond": 1.2,
   "blockReadMs": 21.8,
   "blockWriteMs": 727.2,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 6,
   "waitingOnLocksMax": 0
  }
 }
}
```