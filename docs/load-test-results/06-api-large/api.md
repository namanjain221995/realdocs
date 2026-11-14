## API endpoints (closed loop) (topology A) [ok]

Started 2026-11-14T06:30:01.215Z, ended 2026-11-14T06:34:23.088Z.

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
| ticketMs | 1 | 6.5 | 6.5 | 6.5 | 6.5 | 6.5 |
| connect | 1 | 63.3 | 63.3 | 63.3 | 63.3 | 63.3 |

WebSocket close codes seen: 1005=1

| server | CPU avg % | CPU max % | RSS max MB | heap max MB | ws max | fwd ws max | docs loaded | pool conn max / max | pool waiting max (avg) | loop lag p99 max ms | queue max B | redis ping max ms | persist failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| :4450 | 97.8 | 151.7 | 825 | 432 | 0 | 0 | 0 | 10 / 10 | 20 (7.0) | 32.9 | 0 | 0.0 | 0 |

Server :4450 persist append: n=20 mean 3.9 ms, p95 <= 5.0 ms, p99 <= 10.0 ms; compact: n=1 mean 10.6 ms, p95 <= 25.0 ms, p99 <= 25.0 ms; yjs updates 20; HTTP /api (server-side) n=606,816 mean 5.1 ms, p95 <= 25.0 ms; ws outcomes accepted=1

Generator (8 worker processes): CPU % per worker 0/0/0/0/0/0/0/0; event-loop lag p99 max 10.2 ms (max 16.8 ms); host load1 max 9.2

```json
{
 "system": {
  "samples": 52,
  "host": {
   "load1Max": 9.2,
   "availableMbMin": 29117.1,
   "swapUsedMbMax": 17514.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 98,
    "cpuPctMax": 151.6,
    "rssMbMax": 823.4
   }
  },
  "postgres": {
   "cpuPctAvg": 320.3,
   "cpuPctMax": 424.1,
   "memMbMax": 172.3,
   "commitsPerSecond": 12781.3,
   "rollbacksPerSecond": 65.8,
   "rowsInsertedPerSecond": 790.9,
   "walMbPerSecond": 0.5,
   "blockReadMs": 1.4,
   "blockWriteMs": 199.5,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 9,
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
    "min": 93.4781640000001,
    "p50": 99.62407099999928,
    "p95": 131.90099499999997,
    "p99": 131.90099499999997,
    "mean": 104.69860599999977,
    "max": 131.90099499999997
   },
   "note": "sequential; correct password; the per-account limit of the stack was left at its default"
  },
  "session": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 171467,
   "successfulPerSecond": 8572.9,
   "latencyOfSuccessfulMs": {
    "n": 171467,
    "min": 0.6611689999990631,
    "p50": 1.6647369999991497,
    "p95": 3.1963530000030005,
    "p99": 5.999139000001378,
    "mean": 1.863916340934432,
    "max": 50.01736299999993
   },
   "statuses": {
    "200": 171467
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "documentCreate": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 32444,
   "successfulPerSecond": 1621.6,
   "latencyOfSuccessfulMs": {
    "n": 32444,
    "min": 4.742353999994521,
    "p50": 9.457492000001366,
    "p95": 13.046932999997807,
    "p99": 15.967094999999972,
    "mean": 9.851382000277473,
    "max": 41.20185700000002
   },
   "statuses": {
    "201": 32444
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "documentList": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 8818,
   "successfulPerSecond": 440.2,
   "latencyOfSuccessfulMs": {
    "n": 8818,
    "min": 8.187186999995902,
    "p50": 35.77807999999641,
    "p95": 43.13870599999791,
    "p99": 48.826372000003175,
    "mean": 35.807197539805024,
    "max": 61.608938000004855
   },
   "statuses": {
    "200": 8818
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0,
   "documentsInWorkspace": 32444
  },
  "documentSearch": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 9437,
   "successfulPerSecond": 471.6,
   "latencyOfSuccessfulMs": {
    "n": 9437,
    "min": 7.3729319999984,
    "p50": 25.210042999999132,
    "p95": 68.71119800000452,
    "p99": 77.34264200000325,
    "mean": 33.79607268962591,
    "max": 117.38848399999551
   },
   "statuses": {
    "200": 9437
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "documentOpen": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 82660,
   "successfulPerSecond": 4132.8,
   "latencyOfSuccessfulMs": {
    "n": 82660,
    "min": 1.3918089999933727,
    "p50": 3.2466420000127982,
    "p95": 6.7653319999953965,
    "p99": 18.032055999996373,
    "mean": 3.8645016701793686,
    "max": 28.337692999994033
   },
   "statuses": {
    "200": 82660
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "shareCreate": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 36916,
   "successfulPerSecond": 1845.1,
   "latencyOfSuccessfulMs": {
    "n": 36916,
    "min": 4.229473999992479,
    "p50": 8.505875999995624,
    "p95": 10.820613000003505,
    "p99": 13.657110999993165,
    "mean": 8.660453900666662,
    "max": 27.83897199999774
   },
   "statuses": {
    "201": 36916
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "members": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 63341,
   "successfulPerSecond": 3164.4,
   "latencyOfSuccessfulMs": {
    "n": 63341,
    "min": 1.3008640000189189,
    "p50": 3.8398420000157785,
    "p95": 11.416245999978855,
    "p99": 28.421165000007022,
    "mean": 5.050720835667284,
    "max": 34.81908899999689
   },
   "statuses": {
    "200": 63341
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "collabTicket": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 78283,
   "successfulPerSecond": 6,
   "latencyOfSuccessfulMs": {
    "n": 120,
    "min": 3.0196329999889713,
    "p50": 4.176290000003064,
    "p95": 13.470774999994319,
    "p99": 15.801960000011604,
    "mean": 6.343027974999859,
    "max": 15.944407000002684
   },
   "statuses": {
    "200": 120,
    "429": 78163
   },
   "refusedByLimiter": 78163,
   "errorRatePct": 0
  },
  "history": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 8417,
   "successfulPerSecond": 420.3,
   "latencyOfSuccessfulMs": {
    "n": 8417,
    "min": 13.680567000003066,
    "p50": 31.042400000005728,
    "p95": 63.483680000004824,
    "p99": 69.47043499999563,
    "mean": 37.911966382321246,
    "max": 80.12383199998294
   },
   "statuses": {
    "200": 8417
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "exportJson": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 6818,
   "successfulPerSecond": 340.3,
   "latencyOfSuccessfulMs": {
    "n": 6818,
    "min": 28.048798000003444,
    "p50": 44.71331900000223,
    "p95": 61.89739099997678,
    "p99": 67.82011500000954,
    "mean": 46.72977571853904,
    "max": 80.70471299998462
   },
   "statuses": {
    "200": 6818
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "snapshotList": {
   "concurrency": 16,
   "seconds": 20,
   "requests": 68537,
   "successfulPerSecond": 3426.2,
   "latencyOfSuccessfulMs": {
    "n": 68537,
    "min": 1.377344999986235,
    "p50": 3.742690000013681,
    "p95": 8.953780999989249,
    "p99": 23.587660999997752,
    "mean": 4.664985427404238,
    "max": 36.987859000015305
   },
   "statuses": {
    "200": 68537
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "snapshotCreate": {
   "concurrency": 4,
   "seconds": 10,
   "requests": 16986,
   "successfulPerSecond": 20.2,
   "latencyOfSuccessfulMs": {
    "n": 202,
    "min": 8.794164999999339,
    "p50": 16.49375299998792,
    "p95": 23.144349000009242,
    "p99": 30.025296000007074,
    "mean": 16.95304595049523,
    "max": 31.021856999985175
   },
   "statuses": {
    "201": 202,
    "409": 16784
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  },
  "upload100kB": {
   "concurrency": 4,
   "seconds": 15,
   "requests": 28068,
   "successfulPerSecond": 16,
   "latencyOfSuccessfulMs": {
    "n": 240,
    "min": 15.597703999985242,
    "p50": 22.402779999974882,
    "p95": 28.225471000012476,
    "p99": 31.59217700001318,
    "mean": 22.53881971249854,
    "max": 31.873105000006035
   },
   "statuses": {
    "201": 240,
    "429": 27828
   },
   "refusedByLimiter": 27828,
   "errorRatePct": 0
  },
  "download100kB": {
   "concurrency": 16,
   "seconds": 15,
   "requests": 13727,
   "successfulPerSecond": 914.2,
   "latencyOfSuccessfulMs": {
    "n": 13727,
    "min": 6.838019000017084,
    "p50": 16.992952999979025,
    "p95": 23.251083999988623,
    "p99": 26.873598000005586,
    "mean": 17.484351479347087,
    "max": 41.14190999997663
   },
   "statuses": {
    "200": 13727
   },
   "refusedByLimiter": 0,
   "errorRatePct": 0
  }
 },
 "topStatements": [
  {
   "calls": 9437,
   "meanMs": 12.687,
   "totalMs": 119729.4,
   "rows": 954665,
   "query": "SELECT d.id, d.workspace_id AS \"workspaceId\", d.title, d.status, d.generation, d.schema_version AS \"schemaVersion\", d.head_seq AS \"headSeq\", d.created_by AS \"createdBy\", (SELECT u.display_name FROM users u WHERE u"
  },
  {
   "calls": 8417,
   "meanMs": 11.687,
   "totalMs": 98373.1,
   "rows": 1662423,
   "query": "SELECT id, at, action, actor_name AS \"actorName\", actor_kind AS \"actorKind\" FROM audit_events WHERE workspace_id = $1 AND (target_id::text = $2::text OR details->>$4 = $2::text) ORDER BY at DES"
  },
  {
   "calls": 468647,
   "meanMs": 0.026,
   "totalMs": 12037.2,
   "rows": 468647,
   "query": "SELECT d.id, d.workspace_id AS \"workspaceId\", d.title, d.status, d.generation, d.schema_version AS \"schemaVersion\", d.head_seq AS \"headSeq\", d.created_by AS \"createdBy\", (SELECT u.display_name FROM users u WHERE u"
  },
  {
   "calls": 625923,
   "meanMs": 0.017,
   "totalMs": 10803.7,
   "rows": 625923,
   "query": "SELECT id, workspace_id AS \"workspaceId\", kind, user_id AS \"userId\", share_grant_id AS \"shareGrantId\", document_id AS \"documentId\", parent_session_id AS \"parentSessionId\", guest_name AS \"guestName\", created_at A"
  },
  {
   "calls": 625921,
   "meanMs": 0.017,
   "totalMs": 10706.8,
   "rows": 625921,
   "query": "SELECT id, workspace_id AS \"workspaceId\", email::text AS email, display_name AS \"displayName\", role, status, created_at AS \"createdAt\" FROM users WHERE id = $1 AND workspace_id = $2 AND status = $3"
  },
  {
   "calls": 486900,
   "meanMs": 0.021,
   "totalMs": 10279.2,
   "rows": 4,
   "query": "UPDATE sessions SET last_seen_at = now() WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL AND last_seen_at < now() - interval $2"
  },
  {
   "calls": 8818,
   "meanMs": 1.137,
   "totalMs": 10023.1,
   "rows": 4409000,
   "query": "SELECT d.id, d.workspace_id AS \"workspaceId\", d.title, d.status, d.generation, d.schema_version AS \"schemaVersion\", d.head_seq AS \"headSeq\", d.created_by AS \"createdBy\", (SELECT u.display_name FROM users u WHERE u"
  },
  {
   "calls": 13839,
   "meanMs": 0.695,
   "totalMs": 9612.8,
   "rows": 13839,
   "query": "SELECT d.generation, d.head_seq AS \"headSeq\", d.status, s.state, COALESCE(s.upto_seq, $3) AS \"uptoSeq\", u.updates, u.seqs FROM documents d LEFT JOIN doc_states s ON s.document_id = d"
  },
  {
   "calls": 436199,
   "meanMs": 0.018,
   "totalMs": 7787.5,
   "rows": 436199,
   "query": "SELECT id, workspace_id AS \"workspaceId\", email::text AS email, display_name AS \"displayName\", role, status, created_at AS \"createdAt\" FROM users WHERE id = ANY($1::uuid[]) AND workspace_id = $2"
  },
  {
   "calls": 436199,
   "meanMs": 0.017,
   "totalMs": 7412.5,
   "rows": 0,
   "query": "SELECT user_id AS \"userId\", role FROM document_members WHERE document_id = $1 AND workspace_id = $2 AND user_id = ANY($3::uuid[])"
  },
  {
   "calls": 77994,
   "meanMs": 0.087,
   "totalMs": 6801.5,
   "rows": 77994,
   "query": "INSERT INTO audit_events (id, workspace_id, actor_kind, actor_user_id, actor_name, action, target_type, target_id, details, request_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)"
  },
  {
   "calls": 36917,
   "meanMs": 0.15,
   "totalMs": 5545,
   "rows": 36917,
   "query": "INSERT INTO share_grants (id, workspace_id, document_id, role, secret_hash, label, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
  },
  {
   "calls": 32445,
   "meanMs": 0.115,
   "totalMs": 3724.3,
   "rows": 32445,
   "query": "INSERT INTO documents (id, workspace_id, title, schema_version, created_by) VALUES ($1, $2, $3, $4, $5)"
  },
  {
   "calls": 32445,
   "meanMs": 0.082,
   "totalMs": 2674.7,
   "rows": 32445,
   "query": "INSERT INTO doc_states (document_id, generation, workspace_id, state, upto_seq) VALUES ($1, $4, $2, $3, $5)"
  },
  {
   "calls": 36917,
   "meanMs": 0.033,
   "totalMs": 1210.3,
   "rows": 36917,
   "query": "SELECT g.id, g.workspace_id AS \"workspaceId\", g.document_id AS \"documentId\", g.role, g.secret_hash AS \"secretHash\", g.label, g.created_by AS \"createdBy\", (SELECT u.display_name FROM users u WHERE u.id = g.created_"
  }
 ],
 "systemWholeScenario": {
  "samples": 52,
  "host": {
   "load1Max": 9.2,
   "availableMbMin": 29117.1,
   "swapUsedMbMax": 17514.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 98,
    "cpuPctMax": 151.6,
    "rssMbMax": 823.4
   }
  },
  "postgres": {
   "cpuPctAvg": 320.3,
   "cpuPctMax": 424.1,
   "memMbMax": 172.3,
   "commitsPerSecond": 12781.3,
   "rollbacksPerSecond": 65.8,
   "rowsInsertedPerSecond": 790.9,
   "walMbPerSecond": 0.5,
   "blockReadMs": 1.4,
   "blockWriteMs": 199.5,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 9,
   "waitingOnLocksMax": 0
  }
 }
}
```