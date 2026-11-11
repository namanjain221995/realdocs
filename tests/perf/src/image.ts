/**
 * Image upload plus remote render, measured apart from text. Clocks: all `performance.timeOrigin +
 * performance.now()` of pages in ONE Chromium on this host (same clock method as the text test).
 *   t0           file chosen in the editor (capture-phase `change` of the toolbar's file input)
 *   uploadStart  the editor's upload request starts (Resource Timing startTime of POST .../assets)
 *   uploadEnd    that request's responseEnd (the server has stored the file and answered)
 *   seen         the viewer's DOM gets the image element (document update arrived)
 *   decoded      `img.decode()` of that element resolved in the viewer (bytes fetched and decoded)
 * Images are incompressible PNGs (random pixels) of the stated size.
 */
import { CONDITIONS, type Condition, type DocInfo, runDir, saveJson, sleep, stats } from './common';
import { CONTENT, adminApi, clockCheck, launch, openEditor, openViewer } from './browser-lib';
import { noisePng } from './png';

export interface ImageSample {
  uploadMs: number;
  t0ToUploadEndMs: number;
  t0ToEditorImgMs: number | null;
  seenMs: number[];
  decodedMs: number[];
  viewerFetchMs: number[];
}

export interface ImageResult {
  scenario: 'image';
  condition: Condition['key'];
  clients: number;
  imageBytes: number;
  width: number;
  height: number;
  chromium: string;
  samples: ImageSample[];
  failures: number;
  clockMaxUncertaintyMs: number;
}

const IMG = `${CONTENT} img.rd-image__img:not(.rd-image__img--pending)`;

export async function runImage(
  condition: Condition,
  clients: number,
  targetBytes: number,
  count: number,
): Promise<ImageResult> {
  const api = await adminApi();
  const created = await api.ok<{ document: { id: string } }>('POST', '/api/documents', {
    title: `Perf images ${targetBytes}`,
  });
  const share = await api.ok<{ share: { id: string }; url: string }>(
    'POST',
    `/api/documents/${created.document.id}/shares`,
    { role: 'viewer', label: 'perf image viewers' },
  );
  const doc: DocInfo = {
    id: created.document.id,
    title: 'images',
    blocks: 0,
    textBytes: 0,
    yStateBytes: 0,
    viewerShare: { id: share.share.id, secret: new URL(share.url).hash.slice(1) },
  };
  const browser = await launch();
  const samples: ImageSample[] = [];
  let failures = 0;
  let width = 0;
  let height = 0;
  let size = 0;
  try {
    const editor = await openEditor(browser, condition, doc);
    const viewers = [];
    for (let i = 0; i < clients - 1; i += 1)
      viewers.push(await openViewer(browser, condition, doc));
    const clock = await clockCheck([editor, ...viewers]);
    await editor.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__up = [] as { start: number; end: number }[];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as PerformanceResourceTiming[]) {
          if (
            e.name.endsWith('/assets') &&
            (e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest')
          ) {
            (w.__up as unknown[]).push({
              start: performance.timeOrigin + e.startTime,
              end: performance.timeOrigin + e.responseEnd,
            });
          }
        }
      }).observe({ type: 'resource', buffered: true });
      document.addEventListener(
        'change',
        (e) => {
          if ((e.target as HTMLInputElement)?.type === 'file')
            w.__t0 = performance.timeOrigin + performance.now();
        },
        true,
      );
    });
    for (const [vi, p] of [editor, ...viewers].entries()) {
      await p.evaluate(
        ({ sel, imgSel, isEditor }) => {
          const w = window as unknown as { __img: { seen: number | null; decoded: number | null } };
          const now = () => performance.timeOrigin + performance.now();
          w.__img = { seen: null, decoded: null };
          const content = document.querySelector(sel) as HTMLElement;
          new MutationObserver(() => {
            // `w.__img` is replaced between samples: always read it fresh.
            if (w.__img.seen !== null) return;
            const img = document.querySelector(imgSel) as HTMLImageElement | null;
            if (!img) return;
            const state = w.__img;
            state.seen = now();
            if (isEditor) return;
            void img.decode().then(
              () => {
                state.decoded = now();
              },
              () => {
                state.decoded = -1;
              },
            );
          }).observe(content, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['src', 'class'],
          });
        },
        { sel: CONTENT, imgSel: IMG, isEditor: vi === 0 },
      );
    }
    await editor.click(CONTENT, { position: { x: 20, y: 20 } });

    for (let i = 0; i < count + 2; i += 1) {
      const png = noisePng(targetBytes);
      width = png.width;
      height = png.height;
      size = png.bytes.length;
      for (const p of [editor, ...viewers]) {
        await p.evaluate(() => {
          const w = window as unknown as Record<string, unknown>;
          w.__img = { seen: null, decoded: null };
          w.__t0 = null;
          (w.__up as unknown[] | undefined)?.splice(0);
        });
      }
      await editor.setInputFiles('[data-testid="rd-image-input"]', {
        name: `perf-${i}.png`,
        mimeType: 'image/png',
        buffer: png.bytes,
      });
      try {
        await Promise.all(
          viewers.map((v) =>
            v.waitForFunction(
              () =>
                (window as unknown as { __img: { decoded: number | null } }).__img.decoded !== null,
              undefined,
              { timeout: 60_000 },
            ),
          ),
        );
        await editor.waitForFunction(
          () => (window as unknown as { __up: unknown[] }).__up.length > 0,
          undefined,
          { timeout: 60_000 },
        );
      } catch {
        failures += 1;
      }
      const ed = await editor.evaluate(() => {
        const w = window as unknown as {
          __t0: number | null;
          __up: { start: number; end: number }[];
          __img: { seen: number | null };
        };
        return { t0: w.__t0, up: w.__up[0] ?? null, seen: w.__img.seen };
      });
      const vs = [];
      for (const v of viewers) {
        vs.push(
          await v.evaluate(() => {
            const w = window as unknown as {
              __img: { seen: number | null; decoded: number | null };
            };
            const res = (
              performance.getEntriesByType('resource') as PerformanceResourceTiming[]
            ).filter((r) => /\/assets\/[^/]+/.test(r.name) && r.initiatorType === 'img');
            const last = res[res.length - 1];
            return {
              seen: w.__img.seen,
              decoded: w.__img.decoded,
              fetch: last ? last.responseEnd - last.startTime : null,
            };
          }),
        );
      }
      if (
        i >= 2 &&
        ed.t0 !== null &&
        ed.up &&
        vs.every((x) => x.seen !== null && x.decoded !== null && x.decoded > 0)
      ) {
        samples.push({
          uploadMs: ed.up.end - ed.up.start,
          t0ToUploadEndMs: ed.up.end - ed.t0,
          t0ToEditorImgMs: ed.seen !== null ? ed.seen - ed.t0 : null,
          seenMs: vs.map((x) => (x.seen as number) - (ed.t0 as number)),
          decodedMs: vs.map((x) => (x.decoded as number) - (ed.t0 as number)),
          viewerFetchMs: vs.map((x) => x.fetch ?? Number.NaN),
        });
      } else if (i >= 2) failures += 1;
      // Clear the document so the next image is again in the viewport of every viewer.
      await editor.click(CONTENT, { position: { x: 20, y: 20 } });
      await editor.keyboard.press('ControlOrMeta+a');
      await editor.keyboard.press('Backspace');
      await Promise.all(
        [editor, ...viewers].map((p) =>
          p
            .waitForFunction((s) => !document.querySelector(s), IMG, { timeout: 20_000 })
            .catch(() => undefined),
        ),
      );
      await sleep(400);
    }
    return {
      scenario: 'image',
      condition: condition.key,
      clients,
      imageBytes: size,
      width,
      height,
      chromium: browser.version(),
      samples,
      failures,
      clockMaxUncertaintyMs: Math.max(...clock.map((c) => c.uncertaintyMs)),
    };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cond = 'loopback', clients = '2', bytes = '200000', count = '20'] = process.argv.slice(2);
  const r = await runImage(
    CONDITIONS[cond as Condition['key']],
    Number(clients),
    Number(bytes),
    Number(count),
  );
  saveJson(runDir(), `image-${cond}-${clients}-${bytes}.json`, r);
  const u = stats(r.samples.map((s) => s.uploadMs));
  const d = stats(r.samples.flatMap((s) => s.decodedMs));
  process.stdout.write(
    `image ${cond} clients=${clients} ${r.imageBytes} B (${r.width}x${r.height}): upload p50 ${u.p50.toFixed(0)} p95 ${u.p95.toFixed(0)}; decoded p50 ${d.p50.toFixed(0)} p95 ${d.p95.toFixed(0)} (n=${u.n}, failures ${r.failures})\n`,
  );
}
