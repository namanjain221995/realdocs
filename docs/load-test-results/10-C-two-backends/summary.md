# Performance run (2026-11-14T07:27:27.185Z, topology C)

## C. 500 documents, 2 active editors each (1,000 users) (topology C) [ok]

Started 2026-11-14T07:21:00.549Z, ended 2026-11-14T07:27:25.156Z.

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
| ticketMs | 1000 | 3.9 | 5.5 | 7.7 | 23.8 | 4.0 |
| connect | 1000 | 31.5 | 44.0 | 54.3 | 95.9 | 32.8 |

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 9.2 | 12.1 | 329 | 157 | 500 | 123 | 250 | 10 / 10 | 0 (0.0) | 21.1 | 0 | 0.6 | 0 |
| :4451 | 8.4 | 12.0 | 341 | 159 | 500 | 124 | 250 | 10 / 10 | 0 (0.0) | 24.2 | 0 | 0.5 | 0 |

Server :4450 persist append: n=476 mean 2.7 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 476; HTTP /api (server-side) n=1,077 mean 5.4 ms, p95 <= 10.0 ms; ws outcomes accepted=476, forwarded=122

Server :4451 persist append: n=474 mean 2.7 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; yjs updates 474; HTTP /api (server-side) n=822 mean 3.5 ms, p95 <= 10.0 ms; ws outcomes accepted=474, forwarded=124

Generator (8 worker processes): CPU % per worker 2/2/2/2/2/2/2/2; event-loop lag p99 max 10.7 ms (max 35.7 ms); host load1 max 3.5

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
| remote | 226794 | 0.5 | 1.1 | 1.7 | 392.5 | 0.7 |
| ack | 226762 | 3.4 | 4.9 | 6.6 | 375.2 | 3.6 |
| presence | 27269 | 1.0 | 31377.0 | 46587.0 | 50793.0 | 5431.8 |
| ticketMs | 275 | 5.0 | 7.5 | 14.7 | 35.3 | 5.3 |
| reconnect | 275 | 322.4 | 411.9 | 420.2 | 440.6 | 322.1 |
| ackOffline | 109 | 138.2 | 339.6 | 399.9 | 401.1 | 162.9 |

Client counters: deletes=30485, formats=21617, edits=226869, cursor_updates=24396, drops=274, reconnects=275

WebSocket close codes seen: 1005=274

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 29.2 | 34.0 | 377 | 197 | 500 | 156 | 250 | 10 / 10 | 0 (0.0) | 21.5 | 112 | 1.3 | 0 |
| :4451 | 28.1 | 32.2 | 380 | 206 | 500 | 160 | 250 | 10 / 10 | 0 (0.0) | 21.5 | 165 | 1.6 | 0 |

Server :4450 persist append: n=141,105 mean 2.9 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=581 mean 3.6 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 141,475; HTTP /api (server-side) n=238 mean 3.7 ms, p95 <= 10.0 ms; ws outcomes accepted=130, forwarded=76

Server :4451 persist append: n=131,626 mean 2.9 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=531 mean 3.6 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 131,978; HTTP /api (server-side) n=35 mean 3.5 ms, p95 <= 10.0 ms; ws outcomes accepted=143, forwarded=70

Generator (8 worker processes): CPU % per worker 5/5/5/5/5/5/5/5; event-loop lag p99 max 10.9 ms (max 13.5 ms); host load1 max 4.3

```json
{
 "usersActive": 1000,
 "markerEditsPerSecond": 756.2,
 "deletesPerSecond": 101.62,
 "formatsPerSecond": 72.06,
 "cursorUpdatesPerSecond": 81.32,
 "connectionDrops": 274,
 "reconnects": 275,
 "completedFullDuration": true,
 "system": {
  "samples": 60,
  "host": {
   "load1Max": 4.3,
   "availableMbMin": 28800.7,
   "swapUsedMbMax": 17529.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 29.2,
    "cpuPctMax": 33,
    "rssMbMax": 377.3
   },
   "4451": {
    "cpuPctAvg": 28.1,
    "cpuPctMax": 33.2,
    "rssMbMax": 380.4
   }
  },
  "postgres": {
   "cpuPctAvg": 107,
   "cpuPctMax": 134.9,
   "memMbMax": 261.8,
   "commitsPerSecond": 1060.2,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1838.8,
   "walMbPerSecond": 1.4,
   "blockReadMs": 22.3,
   "blockWriteMs": 699.5,
   "deadlocks": 0,
   "backendsMax": 21,
   "activeMax": 8,
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
  "waitedMs": 0
 },
 "connectedAtEnd": 1000,
 "verification": {
  "docs": 500,
  "checked": 242660,
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
   "calls": 273196,
   "meanMs": 0.23,
   "totalMs": 62954.7,
   "rows": 273196,
   "query": "WITH doc AS ( SELECT id, generation, head_seq, history_seq, schema_version FROM documents WHERE id = $1::uuid AND workspace_id = $2::uuid FOR UPDATE ), ins AS ( I"
  },
  {
   "calls": 1114,
   "meanMs": 0.701,
   "totalMs": 780.5,
   "rows": 1114,
   "query": "WITH doc AS ( SELECT id, generation, head_seq, history_seq, schema_version FROM documents WHERE id = $1::uuid AND workspace_id = $2::uuid FOR UPDATE ), ok AS ( SE"
  },
  {
   "calls": 11045,
   "meanMs": 0.027,
   "totalMs": 294.8,
   "rows": 11045,
   "query": "SELECT d.id, d.workspace_id AS \"workspaceId\", d.title, d.status, d.generation, d.schema_version AS \"schemaVersion\", d.head_seq AS \"headSeq\", d.created_by AS \"createdBy\", (SELECT u.display_name FROM users u WHERE u"
  },
  {
   "calls": 10545,
   "meanMs": 0.027,
   "totalMs": 289.7,
   "rows": 10545,
   "query": "SELECT g.id, g.workspace_id AS \"workspaceId\", g.document_id AS \"documentId\", g.role, g.secret_hash AS \"secretHash\", g.label, g.created_by AS \"createdBy\", (SELECT u.display_name FROM users u WHERE u.id = g.created_"
  },
  {
   "calls": 10270,
   "meanMs": 0.023,
   "totalMs": 239.2,
   "rows": 10270,
   "query": "SELECT id, workspace_id AS \"workspaceId\", kind, user_id AS \"userId\", share_grant_id AS \"shareGrantId\", document_id AS \"documentId\", parent_session_id AS \"parentSessionId\", guest_name AS \"guestName\", created_at A"
  },
  {
   "calls": 500,
   "meanMs": 0.296,
   "totalMs": 147.9,
   "rows": 500,
   "query": "SELECT d.generation, d.head_seq AS \"headSeq\", d.status, s.state, COALESCE(s.upto_seq, $3) AS \"uptoSeq\", u.updates, u.seqs FROM documents d LEFT JOIN doc_states s ON s.document_id = d"
  },
  {
   "calls": 795,
   "meanMs": 0.077,
   "totalMs": 61.5,
   "rows": 3996,
   "query": "UPDATE sessions SET last_seen_at = now() WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL AND last_seen_at < now() - interval $2"
  },
  {
   "calls": 10545,
   "meanMs": 0.003,
   "totalMs": 30.2,
   "rows": 0,
   "query": "SELECT g.id AS \"grantId\", p.id AS \"participantId\", p.session_id AS \"sessionId\", p.role, p.name, s.status AS \"sessionStatus\", s.permissions FROM share_grants g JOIN interview_pa"
  },
  {
   "calls": 1050,
   "meanMs": 0.026,
   "totalMs": 27.5,
   "rows": 1050,
   "query": "SELECT id, workspace_id AS \"workspaceId\", kind, user_id AS \"userId\", share_grant_id AS \"shareGrantId\", document_id AS \"documentId\", parent_session_id AS \"parentSessionId\", guest_name AS \"guestName\", created_at A"
  },
  {
   "calls": 500,
   "meanMs": 0.026,
   "totalMs": 13.1,
   "rows": 500,
   "query": "SELECT id, workspace_id AS \"workspaceId\", email::text AS email, display_name AS \"displayName\", role, status, created_at AS \"createdAt\" FROM users WHERE id = ANY($1::uuid[]) AND workspace_id = $2"
  },
  {
   "calls": 500,
   "meanMs": 0.025,
   "totalMs": 12.7,
   "rows": 500,
   "query": "SELECT id, workspace_id AS \"workspaceId\", email::text AS email, display_name AS \"displayName\", role, status, created_at AS \"createdAt\" FROM users WHERE id = $1 AND workspace_id = $2 AND status = $3"
  },
  {
   "calls": 500,
   "meanMs": 0.021,
   "totalMs": 10.4,
   "rows": 0,
   "query": "SELECT user_id AS \"userId\", role FROM document_members WHERE document_id = $1 AND workspace_id = $2 AND user_id = ANY($3::uuid[])"
  }
 ],
 "verdict": {
  "stable": true,
  "reasons": []
 },
 "systemWholeScenario": {
  "samples": 76,
  "host": {
   "load1Max": 4.3,
   "availableMbMin": 28800.7,
   "swapUsedMbMax": 17529.9
  },
  "server": {
   "4450": {
    "cpuPctAvg": 26.2,
    "cpuPctMax": 36.2,
    "rssMbMax": 377.3
   },
   "4451": {
    "cpuPctAvg": 25.2,
    "cpuPctMax": 33.2,
    "rssMbMax": 380.4
   }
  },
  "postgres": {
   "cpuPctAvg": 92.6,
   "cpuPctMax": 134.9,
   "memMbMax": 261.8,
   "commitsPerSecond": 955.8,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 1568.5,
   "walMbPerSecond": 1.2,
   "blockReadMs": 22.9,
   "blockWriteMs": 766.2,
   "deadlocks": 0,
   "backendsMax": 21,
   "activeMax": 8,
   "waitingOnLocksMax": 0
  }
 }
}
```
