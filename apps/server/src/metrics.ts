/**
 * Process metrics in the Prometheus text format (docs/observability.md).
 *
 * A small registry instead of a client library: counters, gauges (set or read
 * when scraped) and fixed-bucket histograms. Label values come from fixed sets
 * in the code (route patterns, status classes, outcomes), never from request
 * data, so the number of series is bounded and nothing identifies a user or a
 * document.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';

type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  return keys.map((key) => `${key}="${escapeLabel(labels[key] ?? '')}"`).join(',');
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function line(name: string, key: string, value: number): string {
  return `${name}${key ? `{${key}}` : ''} ${Number.isFinite(value) ? value : 0}\n`;
}

/** Upper bound on distinct label sets per metric; further ones are dropped. */
const MAX_SERIES = 500;

export class Counter {
  private readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    const current = this.values.get(key);
    if (current === undefined && this.values.size >= MAX_SERIES) return;
    this.values.set(key, (current ?? 0) + by);
  }

  render(): string {
    let out = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} counter\n`;
    if (this.values.size === 0) out += line(this.name, '', 0);
    for (const [key, value] of this.values) out += line(this.name, key, value);
    return out;
  }
}

export class Gauge {
  private value = 0;
  constructor(
    readonly name: string,
    readonly help: string,
    private readonly read?: () => number,
  ) {}

  set(value: number): void {
    this.value = value;
  }

  render(): string {
    let value = this.value;
    if (this.read) {
      try {
        value = this.read();
      } catch {
        value = 0;
      }
    }
    return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} gauge\n${line(this.name, '', value)}`;
  }
}

export class Histogram {
  private readonly series = new Map<string, { buckets: number[]; sum: number; count: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    /** Upper bounds in seconds, ascending. */
    private readonly bounds: readonly number[],
  ) {}

  observe(seconds: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    let entry = this.series.get(key);
    if (!entry) {
      if (this.series.size >= MAX_SERIES) return;
      entry = { buckets: new Array<number>(this.bounds.length).fill(0), sum: 0, count: 0 };
      this.series.set(key, entry);
    }
    entry.sum += seconds;
    entry.count += 1;
    for (let index = 0; index < this.bounds.length; index += 1) {
      if (seconds <= (this.bounds[index] ?? Infinity)) {
        entry.buckets[index] = (entry.buckets[index] ?? 0) + 1;
      }
    }
  }

  render(): string {
    let out = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} histogram\n`;
    for (const [key, entry] of this.series) {
      const prefix = key ? `${key},` : '';
      this.bounds.forEach((bound, index) => {
        out += line(`${this.name}_bucket`, `${prefix}le="${bound}"`, entry.buckets[index] ?? 0);
      });
      out += line(`${this.name}_bucket`, `${prefix}le="+Inf"`, entry.count);
      out += line(`${this.name}_sum`, key, entry.sum);
      out += line(`${this.name}_count`, key, entry.count);
    }
    return out;
  }
}

const LATENCY = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class Metrics {
  private readonly all: { render(): string }[] = [];
  private readonly loopDelay: ReturnType<typeof monitorEventLoopDelay>;

  readonly httpRequests = this.add(
    new Counter(
      'rd_http_requests_total',
      'HTTP requests by method, route pattern and status class.',
    ),
  );
  readonly httpDuration = this.add(
    new Histogram('rd_http_request_duration_seconds', 'HTTP request duration.', LATENCY),
  );
  readonly wsConnections = this.add(
    new Counter('rd_ws_connections_total', 'Collaboration sockets by outcome.'),
  );
  readonly yjsUpdates = this.add(
    new Counter('rd_yjs_updates_total', 'Document updates accepted from editors.'),
  );
  readonly persistDuration = this.add(
    new Histogram(
      'rd_persist_duration_seconds',
      'Time to commit a batch of updates (append) or to compact a log (compact).',
      LATENCY,
    ),
  );
  readonly persistFailures = this.add(
    new Counter('rd_persist_failures_total', 'Failed durable-log writes by phase.'),
  );
  readonly uploads = this.add(new Counter('rd_uploads_total', 'Uploads by outcome.'));
  readonly uploadBytes = this.add(new Counter('rd_upload_bytes_total', 'Bytes of stored uploads.'));
  readonly webhookDeliveries = this.add(
    new Counter('rd_webhook_deliveries_total', 'Webhook delivery attempts by outcome.'),
  );
  readonly downloads = this.add(
    new Counter('rd_release_downloads_total', 'Desktop release downloads by platform.'),
  );
  readonly redisErrors = this.add(new Counter('rd_redis_errors_total', 'Redis command failures.'));

  constructor() {
    this.loopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.loopDelay.enable();
    this.gauge(
      'rd_process_resident_memory_bytes',
      'Resident memory of the process.',
      () => process.memoryUsage().rss,
    );
    this.gauge(
      'rd_process_heap_used_bytes',
      'JavaScript heap in use.',
      () => process.memoryUsage().heapUsed,
    );
    this.gauge('rd_process_cpu_seconds_total', 'CPU time used by the process.', () => {
      const usage = process.cpuUsage();
      return (usage.user + usage.system) / 1e6;
    });
    this.gauge('rd_process_uptime_seconds', 'Seconds since the process started.', () =>
      process.uptime(),
    );
    this.gauge(
      'rd_event_loop_lag_p99_seconds',
      'Event-loop delay, 99th percentile since the last scrape.',
      () => {
        const value = this.loopDelay.percentile(99) / 1e9;
        this.loopDelay.reset();
        return value;
      },
    );
  }

  private add<T extends { render(): string }>(metric: T): T {
    this.all.push(metric);
    return metric;
  }

  /** A gauge whose value is read when the metrics are scraped. */
  gauge(name: string, help: string, read: () => number): void {
    this.add(new Gauge(name, help, read));
  }

  /** A gauge that is set by the caller (for values that need an await to obtain). */
  settable(name: string, help: string): Gauge {
    return this.add(new Gauge(name, help));
  }

  render(): string {
    return this.all.map((metric) => metric.render()).join('');
  }

  close(): void {
    this.loopDelay.disable();
  }
}

/** Status class label: `2xx`, `4xx` … */
export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}
