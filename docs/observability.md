# Observability

## Logs

Structured JSON on standard output (pino), one object per line. Every request has an id (`reqId`, also
returned as `x-request-id` and stored with audit events). Cookies, `Authorization`, CSRF tokens, tickets,
codes and secrets are redacted; request bodies and document content are never logged. `LOG_LEVEL` sets
the level.

## Metrics

`GET /metrics` returns Prometheus text. It is **off** unless `METRICS_TOKEN` (24 characters or more) is
set, and then requires `Authorization: Bearer <token>`. It answers 404 otherwise. Scrape every instance,
not the load balancer.

```yaml
scrape_configs:
  - job_name: realtimedocs
    metrics_path: /metrics
    authorization: { credentials_file: /etc/prometheus/realtimedocs.token }
    static_configs: [{ targets: ['server:4310', 'server2:4310'] }]
```

Labels come from fixed sets (route patterns such as `/api/documents/:documentId`, status classes,
outcomes). No label carries an id, an address, a name or content.

| Metric                                                                                                                        | Type                  | Meaning                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| `rd_http_requests_total{method,route,status}`                                                                                 | counter               | Requests; `status` is `2xx`…`5xx`.                                                      |
| `rd_http_request_duration_seconds{method,route}`                                                                              | histogram             | Request duration.                                                                       |
| `rd_ws_connections`                                                                                                           | gauge                 | Collaboration sockets served by this instance.                                          |
| `rd_ws_forwarded_connections`                                                                                                 | gauge                 | Sockets this instance passes on to the owner of their document.                         |
| `rd_ws_connections_total{outcome}`                                                                                            | counter               | `accepted`, `forwarded`, `rejected_origin`, `rejected_rate_limit`, `rejected_capacity`. |
| `rd_documents_loaded`                                                                                                         | gauge                 | Documents in memory.                                                                    |
| `rd_yjs_updates_total`                                                                                                        | counter               | Updates accepted from editors.                                                          |
| `rd_persist_duration_seconds{phase}`                                                                                          | histogram             | Commit of a batch (`append`) and compaction (`compact`).                                |
| `rd_persist_failures_total{phase}`                                                                                            | counter               | Failed log writes (retried).                                                            |
| `rd_persist_queue_bytes`                                                                                                      | gauge                 | Accepted and not yet committed bytes: the depth of the write queue.                     |
| `rd_db_pool_connections`, `_idle`, `_waiting`, `_max`                                                                         | gauge                 | PostgreSQL pool; `waiting > 0` means saturation.                                        |
| `rd_redis_up`, `rd_redis_ping_seconds`, `rd_redis_errors_total`                                                               | gauge, gauge, counter | Redis at scrape time (1 and 0 without Redis).                                           |
| `rd_uploads_total{outcome}`, `rd_upload_bytes_total`                                                                          | counter               | Uploads.                                                                                |
| `rd_webhook_deliveries_total{outcome}`                                                                                        | counter               | Webhook attempts.                                                                       |
| `rd_release_downloads_total{platform}`                                                                                        | counter               | Desktop downloads served by this instance (totals per day are in the database).         |
| `rd_process_resident_memory_bytes`, `rd_process_heap_used_bytes`, `rd_process_cpu_seconds_total`, `rd_process_uptime_seconds` | gauge                 | Process.                                                                                |
| `rd_event_loop_lag_p99_seconds`                                                                                               | gauge                 | Event-loop delay, 99th percentile since the previous scrape.                            |

## Health

- `GET /api/health`: the process answers. No dependency is checked. Use it as the container liveness check.
- `GET /api/ready`: PostgreSQL answers, Redis answers (when configured) and the instance is not stopping.
  503 otherwise. Use it for load-balancer membership.

## Tracing

Not implemented. Requests carry an id through logs, audit events and error bodies, and `/api/v1` accepts
a caller's `X-Request-Id`; spans across services would need an OpenTelemetry exporter and a collector,
which this deployment does not have.

## Recommended alerts

| Alert               | Condition                                                                            | Why                                         |
| ------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------- |
| Instance not ready  | `/api/ready` fails for 1 minute                                                      | Database or Redis unreachable.              |
| Saves failing       | `increase(rd_persist_failures_total[5m]) > 0`                                        | Edits are queued, not committed.            |
| Write queue growing | `rd_persist_queue_bytes > 8e6` for 2 minutes                                         | Storage slower than editing.                |
| Slow commits        | p95 of `rd_persist_duration_seconds{phase="append"}` above 0.25 s for 5 minutes      | Delays "Saved".                             |
| Pool saturated      | `rd_db_pool_waiting > 0` for 2 minutes                                               | Raise `DB_POOL_MAX` or find the slow query. |
| Event loop blocked  | `rd_event_loop_lag_p99_seconds > 0.2` for 5 minutes                                  | One instance is overloaded.                 |
| Server errors       | 5xx share of `rd_http_requests_total` above 1 % for 5 minutes                        |                                             |
| Connection ceiling  | `rd_ws_connections + rd_ws_forwarded_connections > 0.8 × COLLAB_MAX_CONNECTIONS`     | New editors will be refused.                |
| Memory growth       | `rd_process_resident_memory_bytes` rising over 6 hours with flat `rd_ws_connections` | Possible leak.                              |
| Webhooks failing    | failures in `rd_webhook_deliveries_total` for 15 minutes                             | The receiving system is down.               |
| Redis down          | `rd_redis_up == 0` for 1 minute                                                      | New connections cannot be made.             |

## Dashboard specification

One row per topic, one series per instance: (1) connections: served, forwarded, loaded documents, accept
and reject rates; (2) editing: updates per second, commit p50/p95, queue bytes, failures; (3) API:
requests per second by status class, p95 by route (top ten), 4xx/5xx; (4) dependencies: pool
used/idle/waiting, Redis ping, readiness; (5) process: CPU, resident memory, heap, event-loop lag, uptime;
(6) product: uploads and bytes, webhook outcomes, downloads by platform.
