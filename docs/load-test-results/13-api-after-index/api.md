## API endpoints (closed loop) (topology A) [ok]

Started 2026-11-14T07:53:05.040Z, ended 2026-11-14T07:57:26.937Z.

```json
{
 "secondsPerEndpoint": 20,
 "concurrency": 16,
 "loop": "closed loop"
}
```

#### api (262 s)

| metric (ms) | n | p50 | p95 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|---:|
| ticketMs | 1 | 5.1 | 5.1 | 5.1 | 5.1 | 5.1 |
| connect | 1 | 56.6 | 56.6 | 56.6 | 56.6 | 56.6 |

WebSocket close codes seen: 1005=1

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 99.6 | 150.9 | 805 | 450 | 0 | 0 | 0 | 10 / 10 | 22 (8.9) | 36.7 | 0 | 0.0 | 0 |

Server :4450 persist append: n=20 mean 3.5 ms, p95 <= 5.0 ms, p99 <= 5.0 ms; compact: n=1 mean 9.7 ms, p95 <= 10.0 ms, p99 <= 10.0 ms; yjs updates 20; HTTP /api (server-side) n=597,505 mean 5.1 ms, p95 <= 25.0 ms; ws outcomes accepted=1

Generator (8 worker processes): CPU % per worker 0/0/0/0/0/0/0/0; event-loop lag p99 max 10.2 ms (max 28.8 ms); host load1 max 9.2

```json
{
 "system": {
  "samples": 52,
  "host": {
   "load1Max": 9.2,
   "availableMbMin": 29287.8,
   "swapUsedMbMax": 17529.6
  },
  "server": {
   "4450": {
    "cpuPctAvg": 99.8,
    "cpuPctMax": 150.8,
    "rssMbMax": 814.7
   }
  },
  "postgres": {
   "cpuPctAvg": 313,
   "cpuPctMax": 425.5,
   "memMbMax": 193.9,
   "commitsPerSecond": 12809.8,
   "rollbacksPerSecond": 66,
   "rowsInsertedPerSecond": 838.8,
   "walMbPerSecond": 0.7,
   "blockReadMs": 1.2,
   "blockWriteMs": 261.7,
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
 "endpoints": {
  "login": {
   "attempts": 12,
   "statuses": {
    "200": 12
   },
   "latencyOfSuccessfulMs": {
    "n": 12,
    "min": 95.63838200000009,
    "p50": 97.75043300000016,
    "p95": 131.32273799999984,
    "p99": 131.32273799999984,
    "mean": 100.54207250000006,
    "max": 131.32273799999984
   },
   "note": "sequential; correct password; the per-account limit of the stack was left at its default"
  },
  "session": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 167633,
   "successfulPerSecond": 8381.2,
   "latencyOfSuccessfulMs": {
    "n": 167633,
    "min": 0.5536169999995764,
    "p50": 1.6793780000007246,
    "p95": 3.2736990000012156,
    "p99": 6.260839000002306,
    "mean": 1.9065652612493158,
    "max": 27.28463499999998
   },
   "statuses": {
    "200": 167633
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "documentCreate": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 32950,
   "successfulPerSecond": 1647,
   "latencyOfSuccessfulMs": {
    "n": 32950,
    "min": 4.3964039999991655,
    "p50": 9.396953000003123,
    "p95": 12.566010999995342,
    "p99": 14.552413999997952,
    "mean": 9.700006303975888,
    "max": 39.075637000001734
   },
   "statuses": {
    "201": 32950
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "documentList": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 8795,
   "successfulPerSecond": 439,
   "latencyOfSuccessfulMs": {
    "n": 8795,
    "min": 6.79328600000008,
    "p50": 35.84507299999677,
    "p95": 42.856455000001006,
    "p99": 47.90476399999898,
    "mean": 35.9057534355883,
    "max": 55.47192300000461
   },
   "statuses": {
    "200": 8795
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0,
   "documentsInWorkspace": 32950
  },
  "documentSearch": {
   "concurrency": 16,
   "seconds": 20.1,
   "requests": 9411,
   "successfulPerSecond": 469,
   "latencyOfSuccessfulMs": {
    "n": 9411,
    "min": 7.069061999995029,
    "p50": 25.061302000001888,
    "p95": 68.84121500000765,
    "p99": 80.28715999999258,
    "mean": 33.9825402048665,
    "max": 128.1101950000011
   },
   "statuses": {
    "200": 9411
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "documentOpen": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 75432,
   "successfulPerSecond": 3771.2,
   "latencyOfSuccessfulMs": {
    "n": 75432,
    "min": 1.2212969999964116,
    "p50": 3.34877100000449,
    "p95": 8.640247999996063,
    "p99": 25.85565499999211,
    "mean": 4.235373055401157,
    "max": 39.19605099999171
   },
   "statuses": {
    "200": 75432
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "shareCreate": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 33013,
   "successfulPerSecond": 1649.9,
   "latencyOfSuccessfulMs": {
    "n": 33013,
    "min": 4.241716000004089,
    "p50": 8.828198999995948,
    "p95": 15.463740999999573,
    "p99": 28.478392000004533,
    "mean": 9.685992437797408,
    "max": 47.27459999998973
   },
   "statuses": {
    "201": 33013
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "members": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 53806,
   "successfulPerSecond": 2689.9,
   "latencyOfSuccessfulMs": {
    "n": 53806,
    "min": 2.0795369999832474,
    "p50": 4.071748000002117,
    "p95": 19.0132159999921,
    "p99": 35.12830099998973,
    "mean": 5.942578101735891,
    "max": 56.320653999981005
   },
   "statuses": {
    "200": 53806
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "collabTicket": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 74254,
   "successfulPerSecond": 6,
   "latencyOfSuccessfulMs": {
    "n": 120,
    "min": 2.8392340000136755,
    "p50": 4.12341099997866,
    "p95": 9.25029500000528,
    "p99": 9.956424000003608,
    "mean": 5.040971758334733,
    "max": 10.571673000027658
   },
   "statuses": {
    "200": 120,
    "429": 74134
   },
   "refusedByLimiter": 74134,
   "errorRatePct": 0
  },
  "history": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 26918,
   "successfulPerSecond": 1345.4,
   "latencyOfSuccessfulMs": {
    "n": 26918,
    "min": 5.588276000024052,
    "p50": 11.402824999997392,
    "p95": 14.781323999981396,
    "p99": 17.346252999996068,
    "mean": 11.78072117824505,
    "max": 28.21870999998646
   },
   "statuses": {
    "200": 26918
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "exportJson": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 6768,
   "successfulPerSecond": 337.7,
   "latencyOfSuccessfulMs": {
    "n": 6768,
    "min": 25.425427999987733,
    "p50": 44.94064200000139,
    "p95": 63.493969000002835,
    "p99": 69.02429199998733,
    "mean": 47.111242700650166,
    "max": 81.3495980000007
   },
   "statuses": {
    "200": 6768
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "snapshotList": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 68740,
   "successfulPerSecond": 3436.5,
   "latencyOfSuccessfulMs": {
    "n": 68740,
    "min": 1.847024999995483,
    "p50": 3.71201800002018,
    "p95": 9.03019900000072,
    "p99": 24.29902599999332,
    "mean": 4.650306832237418,
    "max": 32.04162400000496
   },
   "statuses": {
    "200": 68740
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "snapshotCreate": {
   "concurrency": 4,
   "seconds": 10,
   "requests": 17031,
   "successfulPerSecond": 20.2,
   "latencyOfSuccessfulMs": {
    "n": 202,
    "min": 8.954518999991706,
    "p50": 16.79438099998515,
    "p95": 26.53530000001774,
    "p99": 31.59340000001248,
    "mean": 17.488558158417355,
    "max": 33.439320999983465
   },
   "statuses": {
    "201": 202,
    "409": 16829
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "upload100kB": {
   "concurrency": 4,
   "seconds": 15,
   "requests": 28600,
   "successfulPerSecond": 16,
   "latencyOfSuccessfulMs": {
    "n": 240,
    "min": 14.55405899998732,
    "p50": 21.76923199999146,
    "p95": 27.829203999979654,
    "p99": 37.157050999987405,
    "mean": 22.145386895833507,
    "max": 38.62641200001235
   },
   "statuses": {
    "201": 240,
    "429": 28360
   },
   "refusedByLimiter": 28360,
   "errorRatePct": 0
  },
  "download100kB": {
   "concurrency": 16,
   "seconds": 15,
   "requests": 13718,
   "successfulPerSecond": 913.6,
   "latencyOfSuccessfulMs": {
    "n": 13718,
    "min": 8.5228220000281,
    "p50": 16.979900000005728,
    "p95": 23.046543999982532,
    "p99": 27.088724000001093,
    "mean": 17.495986923750085,
    "max": 39.31030000001192
   },
   "statuses": {
    "200": 13718
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  }
 },
 "topStatements": [
  {
   "calls": 9411,
   "meanMs": 12.775,
   "totalMs": 120226.1,
   "rows": 963993,
   "query": "SELECT d.id, d.workspace_id AS \"workspaceId\", d.title, d.status, d.generation, d.schema_version AS \"schemaVersion\", d.head_seq AS \"headSeq\", d.created_by AS \"createdBy\", (SELECT u.display_name FROM users u WHERE u"
  },
  {
   "calls": 464186,
   "meanMs": 0.026,
   "totalMs": 12086.4,
   "rows": 464186,
   "query": "SELECT d.id, d.workspace_id AS \"workspaceId\", d.title, d.status, d.generation, d.schema_version AS \"schemaVersion\", d.head_seq AS \"headSeq\", d.created_by AS \"createdBy\", (SELECT u.display_name FROM users u WHERE u"
  },
  {
   "calls": 617073,
   "meanMs": 0.017,
   "totalMs": 10626.3,
   "rows": 617073,
   "query": "SELECT id, workspace_id AS \"workspaceId\", kind, user_id AS \"userId\", share_grant_id AS \"shareGrantId\", document_id AS \"documentId\", parent_session_id AS \"parentSessionId\", guest_name AS \"guestName\", created_at A"
  },
  {
   "calls": 617071,
   "meanMs": 0.017,
   "totalMs": 10535.9,
   "rows": 617071,
   "query": "SELECT id, workspace_id AS \"workspaceId\", email::text AS email, display_name AS \"displayName\", role, status, created_at AS \"createdAt\" FROM users WHERE id = $1 AND workspace_id = $2 AND status = $3"
  },
  {
   "calls": 93098,
   "meanMs": 0.113,
   "totalMs": 10518.9,
   "rows": 93098,
   "query": "INSERT INTO audit_events (id, workspace_id, actor_kind, actor_user_id, actor_name, action, target_type, target_id, details, request_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)"
  },
  {
   "calls": 482390,
   "meanMs": 0.021,
   "totalMs": 10254,
   "rows": 4,
   "query": "UPDATE sessions SET last_seen_at = now() WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL AND last_seen_at < now() - interval $2"
  },
  {
   "calls": 8795,
   "meanMs": 1.125,
   "totalMs": 9893.1,
   "rows": 4397500,
   "query": "SELECT d.id, d.workspace_id AS \"workspaceId\", d.title, d.status, d.generation, d.schema_version AS \"schemaVersion\", d.head_seq AS \"headSeq\", d.created_by AS \"createdBy\", (SELECT u.display_name FROM users u WHERE u"
  },
  {
   "calls": 13739,
   "meanMs": 0.688,
   "totalMs": 9449.1,
   "rows": 13739,
   "query": "SELECT d.generation, d.head_seq AS \"headSeq\", d.status, s.state, COALESCE(s.upto_seq, $3) AS \"uptoSeq\", u.updates, u.seqs FROM documents d LEFT JOIN doc_states s ON s.document_id = d"
  },
  {
   "calls": 26918,
   "meanMs": 0.292,
   "totalMs": 7866.9,
   "rows": 5363134,
   "query": "SELECT id, at, action, \"actorName\", \"actorKind\" FROM ( (SELECT id, at, action, actor_name AS \"actorName\", actor_kind AS \"actorKind\" FROM audit_events WHERE workspace_id = $1 AND tar"
  },
  {
   "calls": 431232,
   "meanMs": 0.018,
   "totalMs": 7842.6,
   "rows": 431232,
   "query": "SELECT id, workspace_id AS \"workspaceId\", email::text AS email, display_name AS \"displayName\", role, status, created_at AS \"createdAt\" FROM users WHERE id = ANY($1::uuid[]) AND workspace_id = $2"
  },
  {
   "calls": 431232,
   "meanMs": 0.017,
   "totalMs": 7489.6,
   "rows": 0,
   "query": "SELECT user_id AS \"userId\", role FROM document_members WHERE document_id = $1 AND workspace_id = $2 AND user_id = ANY($3::uuid[])"
  },
  {
   "calls": 33014,
   "meanMs": 0.205,
   "totalMs": 6769.3,
   "rows": 33014,
   "query": "INSERT INTO share_grants (id, workspace_id, document_id, role, secret_hash, label, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
  },
  {
   "calls": 32951,
   "meanMs": 0.113,
   "totalMs": 3718.5,
   "rows": 32951,
   "query": "INSERT INTO documents (id, workspace_id, title, schema_version, created_by) VALUES ($1, $2, $3, $4, $5)"
  },
  {
   "calls": 32951,
   "meanMs": 0.081,
   "totalMs": 2676.9,
   "rows": 32951,
   "query": "INSERT INTO doc_states (document_id, generation, workspace_id, state, upto_seq) VALUES ($1, $4, $2, $3, $5)"
  },
  {
   "calls": 26918,
   "meanMs": 0.097,
   "totalMs": 2604.6,
   "rows": 565278,
   "query": "SELECT h.hseq, h.generation, h.kind, h.operation_type AS \"operationType\", h.actor_kind AS \"actorKind\", h.actor_user_id AS \"actorUserId\", h.actor_name AS \"actorName\", h.participant_role AS \"participantRole\", h.sess"
  }
 ],
 "systemWholeScenario": {
  "samples": 52,
  "host": {
   "load1Max": 9.2,
   "availableMbMin": 29287.8,
   "swapUsedMbMax": 17529.6
  },
  "server": {
   "4450": {
    "cpuPctAvg": 99.8,
    "cpuPctMax": 150.8,
    "rssMbMax": 814.7
   }
  },
  "postgres": {
   "cpuPctAvg": 313,
   "cpuPctMax": 425.5,
   "memMbMax": 193.9,
   "commitsPerSecond": 12809.8,
   "rollbacksPerSecond": 66,
   "rowsInsertedPerSecond": 838.8,
   "walMbPerSecond": 0.7,
   "blockReadMs": 1.2,
   "blockWriteMs": 261.7,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 10,
   "waitingOnLocksMax": 0
  }
 }
}
```