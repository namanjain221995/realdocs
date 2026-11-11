/** Builds summary.md from the raw JSON files of one results directory. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONDITIONS, type Condition, type Stats, fmt, stats } from './common';
import type { BrowserEditResult } from './browser-edit';
import type { ImageResult } from './image';
import type { InitialLoadResult } from './initial-load';
import type { PingResult } from './ping';
import type { ProtocolResult } from './protocol';

const TARGET_MS = 100;

interface Env {
  docs?: { small?: DocShape; large?: DocShape };
  cpuModel: string;
  cpuCoresLogical: number;
  cpuCoreClasses: string;
  memTotal: string;
  memAvailable: string;
  os: string;
  kernel: string;
  loadavg: number[];
  topCpuAtStart: string;
  node: string;
  serverMeta?: { name?: string; version?: string; protocolVersion?: number };
  postgres: string;
  docker: string;
  playwrightImage: string;
  serverSettings: Record<string, string>;
}
interface DocShape {
  blocks: number;
  textBytes: number;
  yStateBytes: number;
}
const cols = (s: Stats) =>
  `${s.n} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${fmt(s.mean)} | ${fmt(s.max)}`;
const HEAD = '| samples | p50 ms | p95 ms | p99 ms | mean ms | max ms |';
const SEP = '| ---: | ---: | ---: | ---: | ---: | ---: |';
const read = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const order = ['loopback', 'rtt10', 'rtt50'];

function load<T extends { condition: string }>(dir: string, prefix: string): T[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => read<T>(path.join(dir, f)))
    .sort((a, b) => order.indexOf(a.condition) - order.indexOf(b.condition));
}

const condLabel = (key: string) => CONDITIONS[key as Condition['key']].label;

export function writeSummary(dir: string): string {
  const out: string[] = [];
  const env = existsSync(path.join(dir, 'env.json')) ? read<Env>(path.join(dir, 'env.json')) : null;
  const small = env?.docs?.small;
  const large = env?.docs?.large;
  out.push(
    `# RealtimeDocs performance results`,
    '',
    `Run directory: \`${path.basename(dir)}\` (UTC timestamp). All numbers below were measured on this host in this run; nothing is estimated or extrapolated.`,
    '',
  );

  // ── Environment
  if (env) {
    out.push('## Environment', '');
    out.push(
      `- Hardware: ${env.cpuModel}, ${env.cpuCoresLogical} logical cores (${env.cpuCoreClasses.replace(/\n/g, '; ')}); memory ${env.memTotal}, ${env.memAvailable} at start; ${env.os}, kernel ${env.kernel}.`,
    );
    out.push(
      `- Load: this host is shared with other workloads. 1/5/15-minute load average at the start of the run: ${env.loadavg.map((x: number) => x.toFixed(2)).join(' / ')} on ${env.cpuCoresLogical} cores. Top CPU consumers at start (percent, command): \`${String(env.topCpuAtStart).replace(/\n/g, ' | ')}\`.`,
    );
    out.push(
      `- Software: Node ${env.node} (host scripts, protocol test), server ${env.serverMeta?.name ?? ''} ${env.serverMeta?.version ?? ''} (protocol ${env.serverMeta?.protocolVersion}) run as a plain Node process from \`apps/server/dist\`, ${env.postgres} in container \`rd-perf-pg\` (default settings, fsync on, container filesystem), ${env.docker}, Playwright image \`${env.playwrightImage}\` (Node 24.21.0 inside, Chromium version in the tables below).`,
    );
    out.push(
      `- Server settings (every non-default value): \`${Object.entries(
        env.serverSettings as Record<string, string>,
      )
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}\`. Everything else is the default of \`docs/notes/server.md\`.`,
    );
    if (small && large) {
      out.push(
        `- Documents: **small** = the seeded sample document, ${small.blocks} blocks, ${small.textBytes} bytes of text (UTF-8, plain-text export), ${small.yStateBytes} bytes Yjs state, it also holds one image and a diagram. **large** = generated, ${large.blocks} blocks (200 paragraphs of about 250 characters, plus the empty paragraph the editor keeps), ${large.textBytes} bytes of text, ${large.yStateBytes} bytes Yjs state.`,
      );
    }
    out.push('');
  }

  // ── RTT
  out.push('## Network conditions and measured RTT', '');
  out.push(
    '"RTT" below is a round-trip time measured at one sender with one clock (`performance.now()`), not a one-way delay. Method: WebSocket ping/pong control frames to `/collab` (answered by the `ws` library of the server), 300 samples after 20 warm-up, 20 ms apart; plus an HTTP GET `/api/health` on a keep-alive connection (includes about 0.3 ms of server handling). The "emulated" conditions use a userspace Node TCP delay proxy that adds a fixed delay per direction to every chunk, WebSocket included; it does not model bandwidth, loss, jitter, or the delay of the TCP handshake. **Emulated with a userspace delay proxy, not a real LAN or WAN.**',
    '',
  );
  for (const file of ['ping-before.json', 'ping-after.json']) {
    const f = path.join(dir, file);
    if (!existsSync(f)) continue;
    out.push(
      `Measured ${file.includes('before') ? 'before' : 'after'} the run:`,
      '',
      `| condition | added by proxy (RTT) | WebSocket ping RTT: ${HEAD.slice(2)} HTTP RTT p50 | HTTP RTT p95 |`.replace(
        '| samples',
        ' samples',
      ),
      `| --- | ---: | ${SEP.slice(2)} ---: | ---: |`,
    );
    for (const p of read<PingResult[]>(f)) {
      out.push(
        `| ${condLabel(p.condition)} | ${p.addedRttMs} ms | ${cols(p.rtt)} | ${fmt(p.httpRtt.p50)} | ${fmt(p.httpRtt.p95)} |`,
      );
    }
    out.push('');
  }

  // ── Headline
  const edits = load<BrowserEditResult>(dir, 'browser-edit-');
  if (edits.length) {
    out.push(
      '## 1. Text edit to visible remote render (headline, real editor pages in one Chromium)',
      '',
    );
    out.push(
      `Chromium ${edits[0]?.chromium}, headless, one process; one editor page plus N-1 viewer pages (viewers are share-link guests, each in its own browser context; the editor is the administrator's session). The editor types one letter every 100-200 ms (5-10 characters per second) after a 50-edit warm-up; each letter is a marker (position k, letter k of a fixed pseudo-random sequence) and every viewer verifies both.`,
      '',
    );
    out.push(
      "**Clock method.** t0 and t1 are both `performance.timeOrigin + performance.now()` read inside pages of the same Chromium on the same host, so they share one OS clock; no timestamps from separate computers are subtracted. `performance.now()` is rounded by Chromium to 100 microseconds in non-isolated pages, so the resolution is 0.1 ms. t0 = capture-phase `keydown` listener on `window` of the editor page (the first script that sees the key, before ProseMirror handles it). t1 (DOM) = the first MutationObserver callback in the viewer after which the marker is present in the viewer's DOM. t1 (next frame) = the `requestAnimationFrame` callback after that DOM change, i.e. the frame in which the browser paints it (headless cannot report when pixels reach a display). Pages' clocks were compared with the Node driver's clock before and after each run (best of 25 round trips per page); the largest absolute offset and the uncertainty of that comparison (half the CDP round trip) are in the last column.",
      '',
    );
    for (const kind of ['domMs', 'rafMs'] as const) {
      out.push(
        kind === 'domMs'
          ? '### 1a. t1 = marker present in the viewer DOM'
          : '### 1b. t1 = next animation frame after the DOM change',
        '',
      );
      out.push(
        `| condition | document | clients | edits | ${HEAD.slice(2).replace('samples', 'viewer samples')} worst viewer per edit p95 ms | p95 < ${TARGET_MS} ms | missing/mismatched | clock offset |`,
        `| --- | --- | ---: | ---: | ${SEP.slice(2)} ---: | --- | --- | --- |`,
      );
      for (const r of edits) {
        const all = stats(r[kind].flat());
        const perEdit = r[kind][0]?.map((_, i) => Math.max(...r[kind].map((v) => v[i] ?? 0))) ?? [];
        const worst = stats(perEdit);
        out.push(
          `| ${condLabel(r.condition)} | ${r.doc} | ${r.clients} | ${r.domMs[0]?.length ?? 0} | ${cols(all)} | ${fmt(worst.p95)} | ${all.p95 < TARGET_MS ? 'yes' : '**no**'} | ${r.missing}/${r.mismatched} | max ${r.clockChecks.maxAbsOffsetMs.toFixed(2)} ms, uncertainty ${r.clockChecks.maxUncertaintyMs.toFixed(2)} ms |`,
        );
      }
      out.push('');
    }
    out.push(
      '"edits" = measured keystrokes; "viewer samples" = edits x (clients - 1), every viewer\'s latency for every edit, pooled (they are not independent). "missing/mismatched" counts edits a viewer never showed or showed with a wrong letter; both should be 0.',
      '',
    );
  }

  // ── Protocol
  const proto = load<ProtocolResult>(dir, 'protocol-');
  if (proto.length) {
    out.push(
      '## 2. Protocol level, no rendering (Node clients: @hocuspocus/provider + yjs + ws)',
      '',
    );
    out.push(
      'All clients run in ONE Node process, so every timestamp is `performance.now()` of one clock. Per edit client A inserts one character (t0 = just before `doc.transact`) and sends `mark`, exactly as the editor does; "relay" = t0 until the remote update has been applied to client B\'s Y.Doc (`afterTransaction`, non-local), pooled over all other clients; "saved" = t0 until the server\'s `saved` acknowledgement for that mark arrives at A, which only happens after the PostgreSQL commit. Typing rate 5-10 characters per second, 50-edit warm-up. Clients authenticate with collaboration tickets and send `hello` after sync like the editor.',
      '',
    );
    for (const kind of ['relay', 'saved'] as const) {
      out.push(
        kind === 'relay'
          ? '### 2a. Update applied on A until received and applied on B'
          : '### 2b. Local change until the server\'s durable "saved"',
        '',
      );
      out.push(
        `| condition | document | clients | edits | ${HEAD.slice(2)}`,
        `| --- | --- | ---: | ---: | ${SEP.slice(2)}`,
      );
      for (const r of proto) {
        const s = kind === 'relay' ? stats(r.relayMs.flat()) : stats(r.savedMs);
        out.push(
          `| ${condLabel(r.condition)} | ${r.doc} | ${r.clients} | ${r.savedMs.length} | ${cols(s)} |`,
        );
      }
      out.push('');
    }
  }

  // ── Initial load
  const loads = load<InitialLoadResult>(dir, 'initial-load-');
  if (loads.length) {
    out.push('## 3. Initial load (separate from editing)', '');
    out.push(
      'A viewer opens the document. Clock: `performance.now()` in the page = milliseconds since that page\'s navigation start. "first content" = the editor content has text in the DOM; Requests and transferred KiB count what had been loaded when "live" and the first frame were reached, not the whole page (under 50 ms RTT the sample document\'s image and diagram chunks may still be in flight, so the counts differ between rows). "first content (frame)" = the following animation-frame callback; "live" = the session indicator reports `live` (WebSocket authenticated and synced). **cold** = fresh browser context (empty HTTP cache), share link `/s/<id>#secret` (includes the share exchange and redirect); **warm** = same context, session cookie present, HTTP cache warm, direct `/d/<id>`.',
      '',
    );
    out.push(
      `| condition | document | visit | metric | ${HEAD.slice(2)} requests / transferred KiB (median) |`,
      `| --- | --- | --- | --- | ${SEP.slice(2)} --- |`,
    );
    for (const r of loads) {
      for (const visit of ['cold', 'warm'] as const) {
        const rows = r[visit];
        const reqs = stats(rows.map((x) => x.requests)).p50;
        const kib = stats(rows.map((x) => x.transferBytes / 1024)).p50;
        const metrics: [string, number[]][] = [
          ['first content', rows.map((x) => x.firstContent ?? Number.NaN)],
          ['first content (frame)', rows.map((x) => x.firstContentRaf ?? Number.NaN)],
          ['live', rows.map((x) => x.live ?? Number.NaN)],
        ];
        metrics.forEach(([name, values], i) => {
          out.push(
            `| ${condLabel(r.condition)} | ${r.doc} | ${visit} | ${name} | ${cols(stats(values))} | ${i === 0 ? `${reqs} / ${kib.toFixed(0)}` : ''} |`,
          );
        });
      }
    }
    out.push('');
  }

  // ── Images
  const images = load<ImageResult>(dir, 'image-');
  if (images.length) {
    out.push('## 4. Image upload plus remote render (separate from text)', '');
    out.push(
      'Incompressible PNGs (random pixels). t0 = file chosen in the editor (capture-phase `change` of the toolbar file input). "upload" = the editor\'s POST to `/assets` from request start to response end (Resource Timing). "document update seen" = the image element is in the viewer\'s DOM. "decoded" = `img.decode()` resolved in the viewer (bytes fetched through the same network condition and decoded). All clocks are `performance.timeOrigin + performance.now()` of pages in one Chromium on this host. The document is cleared between samples so the image is in the viewers\' viewport (the editor renders images with `loading="lazy"`; an image below the fold is not fetched until scrolled near, which this test deliberately avoids).',
      '',
    );
    out.push(
      `| condition | clients | image | metric | ${HEAD.slice(2)} failures |`,
      `| --- | ---: | --- | --- | ${SEP.slice(2)} ---: |`,
    );
    for (const r of images.sort(
      (a, b) =>
        order.indexOf(a.condition) - order.indexOf(b.condition) ||
        a.clients - b.clients ||
        a.imageBytes - b.imageBytes,
    )) {
      const label = `${(r.imageBytes / 1000).toFixed(0)} kB (${r.width}x${r.height})`;
      const rows: [string, number[]][] = [
        ['upload request', r.samples.map((s) => s.uploadMs)],
        ['t0 to upload response', r.samples.map((s) => s.t0ToUploadEndMs)],
        ['t0 to document update seen (viewer)', r.samples.flatMap((s) => s.seenMs)],
        ['t0 to decoded (viewer)', r.samples.flatMap((s) => s.decodedMs)],
        ['viewer image fetch', r.samples.flatMap((s) => s.viewerFetchMs)],
      ];
      rows.forEach(([name, v], i) =>
        out.push(
          `| ${condLabel(r.condition)} | ${r.clients} | ${label} | ${name} | ${cols(stats(v))} | ${i === 0 ? r.failures : ''} |`,
        ),
      );
    }
    out.push('');
  }

  // ── Extras
  out.push(...extrasSections(dir));

  // ── Run log
  const logFile = path.join(dir, 'run-log.json');
  if (existsSync(logFile)) {
    const log =
      read<{ step: string; loadavgStart: string; loadavgEnd: string; ok: boolean }[]>(logFile);
    out.push(
      '## Host load during the run',
      '',
      'Load average (1/5/15 min) read from `/proc/loadavg` at the start and end of each step; this host is shared, so these numbers qualify every latency above.',
      '',
      '| step | load at start | load at end | completed |',
      '| --- | --- | --- | --- |',
    );
    for (const l of log)
      out.push(`| ${l.step} | ${l.loadavgStart} | ${l.loadavgEnd} | ${l.ok ? 'yes' : '**no**'} |`);
    out.push('');
  }
  const text = `${out.join('\n')}\n`;
  writeFileSync(path.join(dir, 'summary.md'), text);
  return text;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: report.ts <results directory>');
  writeSummary(path.resolve(dir));
}

function extrasSections(dir: string): string[] {
  const out: string[] = [];
  const locals = readdirSync(dir)
    .filter((f) => f.startsWith('local-') && f.endsWith('.json'))
    .map((f) => read<LocalShape>(path.join(dir, f)));
  if (locals.length) {
    const nets = ['loopback', 'rtt10', 'rtt50', 'offline'];
    locals.sort(
      (a, b) => nets.indexOf(a.network) - nets.indexOf(b.network) || a.doc.localeCompare(b.doc),
    );
    out.push(
      '## 5. Local keystroke responsiveness (key to character in the LOCAL editor DOM)',
      '',
      'Editor page driven from a host-side Playwright client through a Playwright server in the pinned image (one Chromium). t0 = capture-phase `keydown` on `window` (first script to see the key); t1 = first MutationObserver callback of the editor\'s own content after which the typed character is in the DOM (the marker check is the same as in section 1). Same clock (page `performance.timeOrigin + performance.now()`, 0.1 ms resolution). "offline" = the server process was stopped (SIGTERM) after the page was ready and the connection indicator had left `live`; the "50 ms" row is the emulated delay proxy (userspace, not a real WAN). A latency that depends on the network would show here.',
      '',
      `| network | document | connection indicator while typing | ${HEAD.slice(2)}`,
      `| --- | --- | --- | ${SEP.slice(2)}`,
    );
    for (const r of locals) {
      out.push(
        `| ${r.network === 'offline' ? 'server stopped (offline)' : condLabel(r.network)} | ${r.doc} | ${r.connectionDuringTyping} | ${cols(stats(r.domMs))} |`,
      );
    }
    out.push('');
  }
  const rf = path.join(dir, 'reconnect.json');
  if (existsSync(rf)) {
    const rs = read<ReconnectShape[]>(rf);
    out.push(
      '## 6. Reconnect convergence',
      '',
      'The editor (administrator session, via a pass-through TCP proxy that this script can cut) types N letters while disconnected; 3 viewers stay connected directly. **connection-cut**: the proxy closes its listener and resets every open socket (the editor sees a reset, not a silent black hole; a silent loss would add the idle detection of the application ping, 45 s by default), types N letters, then listens again. **server-restart**: the server process is stopped (SIGTERM, graceful) while the editor types, then started again; viewers reconnect too. t = 0 is the moment the connection is possible again (proxy listening again / `/api/health` answers), read on the host with the same OS clock as the pages. "live" = editor connection indicator reads live; "Saved" = editor save indicator reads saved (the server\'s durable acknowledgement); "viewers" = the last of the 3 viewers shows all N letters (verified letter by letter). The reconnect delay is the browser app\'s own retry/backoff, which grows with the time spent disconnected.',
      '',
      '| variant | N | runs | outage ms (median) | editor live p50 / max ms | editor Saved p50 / max ms | last viewer complete p50 / max ms | incomplete | wrong letters |',
      '| --- | ---: | ---: | ---: | --- | --- | --- | ---: | ---: |',
    );
    const groups = new Map<string, ReconnectShape[]>();
    for (const r of rs)
      groups.set(`${r.variant}|${r.n}`, [...(groups.get(`${r.variant}|${r.n}`) ?? []), r]);
    for (const [key, g] of groups) {
      const [variant, n] = key.split('|');
      const num = (v: (number | null)[]) => v.filter((x): x is number => x !== null);
      const live = stats(num(g.map((x) => x.liveMs)));
      const saved = stats(num(g.map((x) => x.savedMs)));
      const view = stats(
        num(
          g.map((x) =>
            x.viewerMs.some((v) => v === null) ? null : Math.max(...(x.viewerMs as number[])),
          ),
        ),
      );
      const incomplete = g.filter(
        (x) => x.viewerMs.some((v) => v === null) || x.savedMs === null,
      ).length;
      out.push(
        `| ${variant} | ${n} | ${g.length} | ${fmt(stats(g.map((x) => x.outageMs)).p50)} | ${fmt(live.p50)} / ${fmt(live.max)} | ${fmt(saved.p50)} / ${fmt(saved.max)} | ${fmt(view.p50)} / ${fmt(view.max)} | ${incomplete} | ${g.reduce((a, x) => a + x.mismatched, 0)} |`,
      );
    }
    out.push('');
  }
  const resf = path.join(dir, 'resources.json');
  if (existsSync(resf)) {
    const rs = read<ResourceShape[]>(resf);
    out.push(
      '## 7. Memory and CPU',
      '',
      "10 Node clients (`@hocuspocus/provider`) edit the document for 60 s, each typing one character every 100-200 ms into its own paragraph and sending `mark` per edit (about 67 edits/s together); one browser viewer (loopback, share link) is connected throughout. **Server**: `/proc/<pid>/stat` utime+stime (clock ticks / `CLK_TCK`) before and after the 60 s, divided by 60 s = percent of one core; RSS from `/proc/<pid>/status` `VmRSS` at start and end and the maximum of 1 s samples (`VmHWM` is the process lifetime peak). **Viewer renderer**: CDP `Performance.getMetrics` of the viewer page (`JSHeapUsedSize`, `Nodes`, `TaskDuration` = main-thread task seconds, `ScriptDuration`); heap after `HeapProfiler.collectGarbage` via `Runtime.getHeapUsage`; Main-thread CPU is the page's own thread only (not compositor, network or GPU processes). Idle = 10 s of the same page before the edits start. PostgreSQL was not measured (a single `docker stats --no-stream` reading is not a CPU measurement).",
      '',
      '| document | blocks | text bytes | server CPU (% of 1 core) | server RSS start / end / sampled max MiB | viewer JS heap after load / after editing (GC) MiB | viewer main-thread CPU editing / idle % | viewer DOM nodes after load |',
      '| --- | ---: | ---: | ---: | --- | --- | --- | ---: |',
    );
    for (const r of rs) {
      const mib = (b: number) => (b / 1048576).toFixed(1);
      out.push(
        `| ${r.doc} | ${r.blocks} | ${r.textBytes} | ${r.server.cpuPercentOfOneCore.toFixed(1)} | ${(r.server.rssStartKb / 1024).toFixed(0)} / ${(r.server.rssEndKb / 1024).toFixed(0)} / ${(r.server.rssPeakSampledKb / 1024).toFixed(0)} | ${mib(r.viewerRenderer.heapUsedAfterLoadGcBytes)} / ${mib(r.viewerRenderer.heapUsedAfterEditingGcBytes)} | ${r.viewerRenderer.renderThreadCpuPercentEditing.toFixed(1)} / ${r.viewerRenderer.renderThreadCpuPercentIdle.toFixed(1)} | ${r.viewerRenderer.afterLoad.Nodes ?? 'n/a'} |`,
      );
    }
    out.push('');
  }
  return out;
}

interface LocalShape {
  network: string;
  doc: string;
  connectionDuringTyping: string;
  domMs: number[];
}
interface ReconnectShape {
  variant: string;
  n: number;
  outageMs: number;
  liveMs: number | null;
  savedMs: number | null;
  viewerMs: (number | null)[];
  mismatched: number;
}
interface ResourceShape {
  doc: string;
  blocks: number;
  textBytes: number;
  postgresDockerStats: string;
  server: {
    cpuPercentOfOneCore: number;
    rssStartKb: number;
    rssEndKb: number;
    rssPeakSampledKb: number;
  };
  viewerRenderer: {
    afterLoad: Record<string, number>;
    heapUsedAfterLoadGcBytes: number;
    heapUsedAfterEditingGcBytes: number;
    renderThreadCpuPercentEditing: number;
    renderThreadCpuPercentIdle: number;
  };
}
