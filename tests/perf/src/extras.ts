/**
 * Additional measurements, driven from the host through a Playwright server running in the pinned
 * image (`stack.ts pw-up`), so this process can also stop/start the server and cut the network:
 *   local      keystroke to character in the LOCAL editor DOM (online, 50 ms RTT, server stopped)
 *   reconnect  connection cut while typing N characters; time to convergence and to "Saved"
 *   resources  server RSS/CPU and one viewer's renderer heap/CPU while 10 clients edit for 60 s
 * Usage: extras.ts local|reconnect|resources [args]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { type Browser, type Page, chromium } from '@playwright/test';
import * as Y from 'yjs';
import {
  CONDITIONS,
  type Condition,
  type DocInfo,
  HOST,
  PORTS,
  readState,
  runDir,
  saveJson,
  sleep,
  stats,
} from './common';
import { PerfClient } from './collab';
import {
  CONTENT,
  adminApi,
  clockCheck,
  markerSequence,
  openEditor,
  openViewer,
  withScratchParagraph,
} from './browser-lib';
import {
  currentState,
  installStateRecorder,
  installTextObserver,
  readStates,
  readTextObserver,
} from './extra-lib';
import { ControlledProxy } from './proxy';
import { serverStart, serverStop } from './stack';

export async function connectBrowser(): Promise<Browser> {
  return chromium.connect(`ws://${HOST}:${PORTS.pw}/`, {
    headers: {
      'x-playwright-launch-options': JSON.stringify({
        headless: true,
        args: [
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
        ],
      }),
    },
  });
}

const hostNow = () => performance.timeOrigin + performance.now();
const docOf = (key: 'small' | 'large' | 'medium' | 'huge') => readState().docs[key] as DocInfo;

// ── 1. local keystroke responsiveness ──────────────────────────────────────

export interface LocalResult {
  scenario: 'local';
  network: 'loopback' | 'rtt10' | 'rtt50' | 'offline';
  doc: 'small' | 'large';
  chromium: string;
  connectionDuringTyping: string;
  domMs: number[];
  rafMs: number[];
  missing: number;
  mismatched: number;
  clockMaxUncertaintyMs: number;
}

export async function runLocal(
  network: LocalResult['network'],
  docKey: 'small' | 'large',
  samples: number,
  warmup = 50,
): Promise<LocalResult> {
  const doc = docOf(docKey);
  const condition: Condition = network === 'offline' ? CONDITIONS.loopback : CONDITIONS[network];
  const total = warmup + samples;
  const S = markerSequence(total);
  const cleanup = await withScratchParagraph(doc);
  const browser = await connectBrowser();
  let stopped = false;
  try {
    const editor = await openEditor(browser, condition, doc);
    const pages = [editor];
    if (network !== 'offline') pages.push(await openViewer(browser, condition, doc));
    await editor.waitForFunction((sel) => {
      const last = document.querySelector(sel)?.lastElementChild;
      return !!last && last.tagName === 'P' && (last.textContent ?? '').length === 0;
    }, CONTENT);
    const clock = await clockCheck(pages);
    await installTextObserver(editor, S);
    await editor.click(CONTENT, { position: { x: 20, y: 20 } });
    await editor.keyboard.press('ControlOrMeta+End');
    if (network === 'offline') {
      await serverStop();
      stopped = true;
      await editor.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="rd-status-connection"]')
            ?.getAttribute('data-state') !== 'live',
        undefined,
        { timeout: 30_000 },
      );
    }
    const connectionDuringTyping = await currentState(editor, 'connection');
    await editor.evaluate(() => {
      (window as unknown as Record<string, unknown>).__armed = true;
    });
    for (let k = 1; k <= total; k += 1) {
      await editor.keyboard.press(S[k - 1] as string);
      await sleep(100 + Math.random() * 100);
    }
    await sleep(500);
    const t0 = await editor.evaluate(() => (window as unknown as { __t0: number[] }).__t0);
    const keys = await editor.evaluate(() => (window as unknown as { __keys: string[] }).__keys);
    const r = await readTextObserver(editor);
    const domMs: number[] = [];
    const rafMs: number[] = [];
    let missing = 0;
    for (let k = warmup + 1; k <= total; k += 1) {
      const a = r.t1[k];
      const s = t0[k];
      if (a == null || s == null || keys[k] !== S[k - 1]) {
        missing += 1;
        continue;
      }
      domMs.push(a - s);
      const b = r.raf[k];
      if (b != null) rafMs.push(b - s);
    }
    return {
      scenario: 'local',
      network,
      doc: docKey,
      chromium: browser.version(),
      connectionDuringTyping,
      domMs,
      rafMs,
      missing,
      mismatched: r.bad,
      clockMaxUncertaintyMs: Math.max(...clock.map((c) => c.uncertaintyMs)),
    };
  } finally {
    await browser.close().catch(() => undefined);
    if (stopped) await serverStart();
    await cleanup();
  }
}

// ── 2. reconnect convergence ───────────────────────────────────────────────

export interface ReconnectResult {
  scenario: 'reconnect';
  variant: 'connection-cut' | 'server-restart';
  n: number;
  viewers: number;
  outageMs: number;
  detectedMs: number | null;
  /** from restore until the editor's indicator reads "live" again */
  liveMs: number | null;
  /** from restore until the editor's save indicator reads "saved" */
  savedMs: number | null;
  /** from restore until each viewer shows all N characters */
  viewerMs: (number | null)[];
  mismatched: number;
  saveStateBeforeRestore: string;
}

export async function runReconnect(
  variant: ReconnectResult['variant'],
  n: number,
  proxy: ControlledProxy,
): Promise<ReconnectResult> {
  const doc = docOf('small');
  const S = markerSequence(Math.max(n, 10));
  const cleanup = await withScratchParagraph(doc);
  const browser = await connectBrowser();
  const viewersCount = 3;
  try {
    const cutCondition: Condition = {
      key: 'loopback',
      label: 'cuttable pass-through proxy',
      port: PORTS.cut,
      addedOneWayMs: 0,
    };
    const editor = await openEditor(browser, cutCondition, doc);
    const viewers: Page[] = [];
    for (let i = 0; i < viewersCount; i += 1)
      viewers.push(await openViewer(browser, CONDITIONS.loopback, doc));
    for (const p of [editor, ...viewers]) {
      await p.waitForFunction((sel) => {
        const last = document.querySelector(sel)?.lastElementChild;
        return !!last && last.tagName === 'P' && (last.textContent ?? '').length === 0;
      }, CONTENT);
    }
    for (const v of viewers) await installTextObserver(v, S);
    await installStateRecorder(editor);
    await editor.click(CONTENT, { position: { x: 20, y: 20 } });
    await editor.keyboard.press('ControlOrMeta+End');
    await editor.waitForFunction(
      () =>
        document.querySelector('[data-testid="rd-status-save"]')?.getAttribute('data-state') ===
        'saved',
    );

    const tCut = hostNow();
    if (variant === 'connection-cut') await proxy.cut();
    else await serverStop();
    let detectedMs: number | null = null;
    try {
      await editor.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="rd-status-connection"]')
            ?.getAttribute('data-state') !== 'live',
        undefined,
        { timeout: 15_000 },
      );
      detectedMs = hostNow() - tCut;
    } catch {
      detectedMs = null;
    }
    await editor.keyboard.type(S.slice(0, n));
    await sleep(300);
    const saveStateBeforeRestore = await currentState(editor, 'save');
    if (variant === 'connection-cut') await proxy.start();
    else await serverStart();
    const tRestore = hostNow();

    const wait = (page: Page, fn: () => boolean, arg?: number) =>
      page.waitForFunction(fn, arg, { timeout: 180_000 }).then(
        () => true,
        () => false,
      );
    await Promise.all(
      viewers.map((v) =>
        v
          .waitForFunction(
            (count) =>
              ((window as unknown as { __v: { t1: number[] } }).__v.t1[count] ?? null) !== null,
            n,
            { timeout: 180_000 },
          )
          .catch(() => undefined),
      ),
    );
    await wait(
      editor,
      () =>
        document.querySelector('[data-testid="rd-status-save"]')?.getAttribute('data-state') ===
          'saved' &&
        document
          .querySelector('[data-testid="rd-status-connection"]')
          ?.getAttribute('data-state') === 'live',
    );
    await sleep(300);

    const states = await readStates(editor);
    const after = states.filter((s) => s.t > tRestore);
    const first = (which: string, state: string) =>
      after.find((s) => s.which === which && s.state === state)?.t;
    const live = first('connection', 'live');
    const saved = first('save', 'saved');
    let mismatched = 0;
    const viewerMs: (number | null)[] = [];
    for (const v of viewers) {
      const r = await readTextObserver(v);
      mismatched += r.bad;
      const t = r.t1[n];
      viewerMs.push(t == null ? null : t - tRestore);
    }
    return {
      scenario: 'reconnect',
      variant,
      n,
      viewers: viewersCount,
      outageMs: tRestore - tCut,
      detectedMs,
      liveMs: live === undefined ? null : live - tRestore,
      savedMs: saved === undefined ? null : saved - tRestore,
      viewerMs,
      mismatched,
      saveStateBeforeRestore,
    };
  } finally {
    await browser.close().catch(() => undefined);
    if (variant === 'connection-cut') await proxy.start().catch(() => undefined);
    await cleanup();
  }
}

// ── 3. memory and CPU ──────────────────────────────────────────────────────

const clockTicks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());

function procStat(pid: number) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const kb = (key: string) =>
    Number(status.match(new RegExp(`${key}:\\s+(\\d+) kB`))?.[1] ?? Number.NaN);
  return {
    cpuSeconds: (Number(fields[11]) + Number(fields[12])) / clockTicks,
    rssKb: kb('VmRSS'),
    hwmKb: kb('VmHWM'),
    threads: Number(status.match(/Threads:\s+(\d+)/)?.[1]),
  };
}

export interface ResourceResult {
  scenario: 'resources';
  doc: 'small' | 'medium' | 'huge';
  blocks: number;
  textBytes: number;
  yStateBytes: number;
  writers: number;
  durationS: number;
  editsPerSecondTotal: number;
  server: {
    cpuSecondsDelta: number;
    cpuPercentOfOneCore: number;
    rssStartKb: number;
    rssEndKb: number;
    rssPeakSampledKb: number;
    vmHwmKb: number;
    rssSamples: number;
  };
  postgresDockerStats: string;
  viewerRenderer: {
    afterLoad: Record<string, number>;
    idle10s: Record<string, number>;
    editing60s: Record<string, number>;
    heapUsedAfterLoadGcBytes: number;
    heapUsedAfterEditingGcBytes: number;
    processCpuSecondsDuringEditing: number | null;
    processCpuSecondsIdle10s: number | null;
    renderThreadCpuPercentEditing: number;
    renderThreadCpuPercentIdle: number;
  };
}

export async function runResources(
  docKey: 'small' | 'medium' | 'huge',
  seconds = 60,
): Promise<ResourceResult> {
  const state = readState();
  const doc = docOf(docKey);
  const api = await adminApi();
  const writers: PerfClient[] = [];
  for (let i = 0; i < 10; i += 1) writers.push(await PerfClient.connect(api, doc.id));
  const w0 = writers[0] as PerfClient;
  w0.edit(() => {
    for (let i = 0; i < 10; i += 1) {
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText()]);
      w0.fragment.push([p]);
    }
  });
  await w0.save();
  for (const w of writers) {
    for (let t = 0; t < 400 && w.fragment.length < doc.blocks + 10; t += 1) await sleep(25);
  }

  const browser = await connectBrowser();
  try {
    const viewer = await openViewer(browser, CONDITIONS.loopback, doc);
    await sleep(3000);
    const cdp = await viewer.context().newCDPSession(viewer);
    await cdp.send('Performance.enable');
    const metrics = async () => {
      const r = (await cdp.send('Performance.getMetrics')) as {
        metrics: { name: string; value: number }[];
      };
      return Object.fromEntries(r.metrics.map((m) => [m.name, m.value])) as Record<string, number>;
    };
    const gcHeap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const h = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number; totalSize: number };
      return h.usedSize;
    };
    const browserCdp = await browser.newBrowserCDPSession().catch(() => null);
    const processCpu = async (): Promise<number | null> => {
      if (!browserCdp) return null;
      try {
        const r = (await browserCdp.send('SystemInfo.getProcessInfo' as never)) as {
          processInfo: { type: string; cpuTime: number }[];
        };
        return r.processInfo
          .filter((p) => p.type === 'renderer')
          .reduce((a, p) => a + p.cpuTime, 0);
      } catch {
        return null;
      }
    };
    const heapAfterLoad = await gcHeap();
    const m0 = await metrics();
    const c0 = await processCpu();
    await sleep(10_000);
    const m1 = await metrics();
    const c1 = await processCpu();
    const diff = (a: Record<string, number>, b: Record<string, number>) =>
      Object.fromEntries(Object.keys(b).map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]));

    const pid = state.serverPid;
    const s0 = procStat(pid);
    let peak = s0.rssKb;
    let samples = 1;
    const sampler = setInterval(() => {
      peak = Math.max(peak, procStat(pid).rssKb);
      samples += 1;
    }, 1000);
    const m2 = await metrics();
    const c2 = await processCpu();
    const deadline = Date.now() + seconds * 1000;
    let docker = '';
    let dockerTaken = false;
    let edits = 0;
    await Promise.all(
      writers.map(async (w, i) => {
        const S = markerSequence(2000);
        let k = 0;
        while (Date.now() < deadline) {
          const text = (w.fragment.get(doc.blocks + i) as Y.XmlElement).get(0) as Y.XmlText;
          w.edit(() => text.insert(text.length, S[k % S.length] as string));
          k += 1;
          edits += 1;
          w.provider.sendStateless(JSON.stringify({ t: 'mark', n: w.n }));
          if (i === 0 && !dockerTaken && Date.now() > deadline - (seconds * 1000) / 2) {
            dockerTaken = true;
            try {
              docker = execFileSync(
                'docker',
                [
                  'stats',
                  '--no-stream',
                  '--format',
                  '{{.CPUPerc}} cpu, {{.MemUsage}}',
                  'rd-perf-pg',
                ],
                { encoding: 'utf8' },
              ).trim();
            } catch {
              docker = 'unavailable';
            }
          }
          await sleep(100 + Math.random() * 100);
        }
      }),
    );
    clearInterval(sampler);
    const s1 = procStat(pid);
    const m3 = await metrics();
    const c3 = await processCpu();
    await sleep(1500);
    const heapAfterEditing = await gcHeap();
    const ed = diff(m2, m3);
    const idle = diff(m0, m1);
    const result: ResourceResult = {
      scenario: 'resources',
      doc: docKey,
      blocks: doc.blocks,
      textBytes: doc.textBytes,
      yStateBytes: doc.yStateBytes,
      writers: 10,
      durationS: seconds,
      editsPerSecondTotal: edits / seconds,
      server: {
        cpuSecondsDelta: s1.cpuSeconds - s0.cpuSeconds,
        cpuPercentOfOneCore: ((s1.cpuSeconds - s0.cpuSeconds) / seconds) * 100,
        rssStartKb: s0.rssKb,
        rssEndKb: s1.rssKb,
        rssPeakSampledKb: Math.max(peak, s1.rssKb),
        vmHwmKb: s1.hwmKb,
        rssSamples: samples,
      },
      postgresDockerStats: docker,
      viewerRenderer: {
        afterLoad: m0,
        idle10s: idle,
        editing60s: ed,
        heapUsedAfterLoadGcBytes: heapAfterLoad,
        heapUsedAfterEditingGcBytes: heapAfterEditing,
        processCpuSecondsDuringEditing: c2 !== null && c3 !== null ? c3 - c2 : null,
        processCpuSecondsIdle10s: c0 !== null && c1 !== null ? c1 - c0 : null,
        renderThreadCpuPercentEditing: ((ed.TaskDuration ?? 0) / seconds) * 100,
        renderThreadCpuPercentIdle: ((idle.TaskDuration ?? 0) / 10) * 100,
      },
    };
    for (const w of writers) w.destroy();
    return result;
  } finally {
    await browser.close().catch(() => undefined);
    const c = await PerfClient.connect(await adminApi(), doc.id);
    const extra = c.fragment.length - doc.blocks;
    if (extra > 0) c.edit(() => c.fragment.delete(doc.blocks, extra));
    await c.save();
    c.destroy();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [which, ...rest] = process.argv.slice(2);
  const dir = runDir();
  const edits = Number(process.env.PERF_EDITS ?? '320');
  if (which === 'local') {
    for (const network of ['loopback', 'rtt50', 'offline'] as const) {
      for (const doc of ['small', 'large'] as const) {
        const r = await runLocal(network, doc, edits);
        saveJson(dir, `local-${network}-${doc}.json`, r);
        const s = stats(r.domMs);
        process.stdout.write(
          `local ${network} ${doc}: p50 ${s.p50.toFixed(2)} p95 ${s.p95.toFixed(2)} p99 ${s.p99.toFixed(2)} n=${s.n} conn=${r.connectionDuringTyping}\n`,
        );
      }
    }
  } else if (which === 'reconnect') {
    const proxy = new ControlledProxy(PORTS.cut, PORTS.server);
    await proxy.start();
    try {
      const plan: [ReconnectResult['variant'], number, number][] = [
        ['connection-cut', 10, 5],
        ['connection-cut', 100, 5],
        ['connection-cut', 1000, 5],
        ['server-restart', 100, 3],
        ['server-restart', 1000, 3],
      ];
      const all: ReconnectResult[] = [];
      for (const [variant, n, reps] of plan) {
        for (let i = 0; i < reps; i += 1) {
          const r = await runReconnect(variant, n, proxy);
          all.push(r);
          saveJson(dir, 'reconnect.json', all);
          process.stdout.write(
            `reconnect ${variant} N=${n}: live ${r.liveMs?.toFixed(0)} saved ${r.savedMs?.toFixed(0)} viewers ${r.viewerMs.map((x) => x?.toFixed(0)).join('/')} outage ${r.outageMs.toFixed(0)} mismatched ${r.mismatched}\n`,
          );
        }
      }
    } finally {
      await proxy.stop();
    }
  } else if (which === 'resources') {
    const all: ResourceResult[] = [];
    for (const doc of ['small', 'medium', 'huge'] as const) {
      const r = await runResources(doc, Number(rest[0] ?? '60'));
      all.push(r);
      saveJson(dir, 'resources.json', all);
      process.stdout.write(
        `resources ${doc}: server cpu ${r.server.cpuPercentOfOneCore.toFixed(1)}% rss ${r.server.rssStartKb}->${r.server.rssEndKb} kB; viewer heap ${r.viewerRenderer.heapUsedAfterLoadGcBytes}->${r.viewerRenderer.heapUsedAfterEditingGcBytes} B; edits/s ${r.editsPerSecondTotal.toFixed(1)}\n`,
      );
    }
  } else {
    process.stderr.write('usage: extras.ts local|reconnect|resources\n');
  }
}
