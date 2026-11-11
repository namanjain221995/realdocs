/**
 * Headline benchmark: text edit to visible remote render, real editor pages, ONE Chromium process.
 *
 * Clock: t0 and t1 are both `performance.timeOrigin + performance.now()` taken inside pages of the
 * same Chromium on the same host, i.e. the same OS clock (monotonic `now()` anchored to the wall
 * clock at each page's navigation start). Resolution: Chromium rounds performance.now() to 100 us
 * (cross-origin-isolated pages 5 us); we are not cross-origin isolated. Clock agreement between
 * pages and the Node driver is measured before and after every run (`clockChecks`).
 *
 * t0 = capture-phase `keydown` listener on window of the editor page (first script to see the key).
 * t1 = first MutationObserver callback in a viewer page after which the marker (position k, letter k)
 *      is present in the viewer's DOM. `rafMs` additionally takes the next requestAnimationFrame
 *      callback (the frame in which the browser will paint that DOM change, not the moment pixels
 *      reach a screen, which a headless browser cannot report).
 */
import {
  CONDITIONS,
  type Condition,
  type DocInfo,
  readState,
  runDir,
  saveJson,
  sleep,
  stats,
} from './common';
import {
  CONTENT,
  clockCheck,
  launch,
  markerSequence,
  openEditor,
  openViewer,
  withScratchParagraph,
} from './browser-lib';

export interface BrowserEditResult {
  scenario: 'browser-edit';
  condition: Condition['key'];
  doc: 'small' | 'large';
  clients: number;
  warmup: number;
  chromium: string;
  /** latency (ms) per measured edit, one array per viewer */
  domMs: number[][];
  rafMs: number[][];
  missing: number;
  mismatched: number;
  clockChecks: {
    atStart: unknown;
    atEnd: unknown;
    maxAbsOffsetMs: number;
    maxUncertaintyMs: number;
  };
  typingGapMs: [number, number];
}

export async function runBrowserEdit(
  condition: Condition,
  docKey: 'small' | 'large',
  clients: number,
  samples: number,
  warmup = 50,
): Promise<BrowserEditResult> {
  const doc = readState().docs[docKey] as DocInfo;
  const total = warmup + samples;
  const S = markerSequence(total);
  const cleanup = await withScratchParagraph(doc);
  const browser = await launch();
  try {
    const editor = await openEditor(browser, condition, doc);
    const viewers = [];
    for (let i = 0; i < clients - 1; i += 1)
      viewers.push(await openViewer(browser, condition, doc));
    const pages = [editor, ...viewers];
    // The scratch paragraph has reached every page.
    for (const p of pages) {
      await p.waitForFunction((sel) => {
        const c = document.querySelector(sel);
        const last = c?.lastElementChild;
        return !!last && last.tagName === 'P' && (last.textContent ?? '').length === 0;
      }, CONTENT);
    }
    const clockStart = await clockCheck(pages);

    // Viewers: observer on the editor content.
    for (const v of viewers) {
      await v.evaluate(
        ({ sel, S }) => {
          const content = document.querySelector(sel) as HTMLElement;
          const t1: number[] = [];
          const raf: number[] = [];
          let seen = 0;
          let bad = 0;
          const now = () => performance.timeOrigin + performance.now();
          // Text of a block without remote-cursor widgets or other non-editable decorations.
          const textOf = (node: Node): string => {
            if (node.nodeType === Node.TEXT_NODE) return (node as Text).data;
            if (node.nodeType !== Node.ELEMENT_NODE) return '';
            const el = node as HTMLElement;
            if (
              el.getAttribute('contenteditable') === 'false' ||
              el.classList.contains('ProseMirror-widget')
            )
              return '';
            let s = '';
            for (const child of el.childNodes) s += textOf(child);
            return s;
          };
          const observer = new MutationObserver(() => {
            const t = now();
            const last = content.lastElementChild;
            if (!last) return;
            const text = textOf(last);
            while (seen < text.length) {
              seen += 1;
              if (text[seen - 1] !== S[seen - 1]) bad += 1;
              t1[seen] = t;
              const k = seen;
              requestAnimationFrame(() => {
                raf[k] = now();
              });
            }
          });
          observer.observe(content, { subtree: true, childList: true, characterData: true });
          (window as unknown as Record<string, unknown>).__v = { t1, raf, bad: () => bad };
        },
        { sel: CONTENT, S },
      );
    }
    // Editor: caret in the scratch paragraph at the end of the document.
    await editor.click(CONTENT, { position: { x: 20, y: 20 } });
    await editor.keyboard.press('ControlOrMeta+End');
    const inLast = await editor.evaluate((sel) => {
      const content = document.querySelector(sel) as HTMLElement;
      const anchor = window.getSelection()?.anchorNode ?? null;
      return !!anchor && content.lastElementChild?.contains(anchor) === true;
    }, CONTENT);
    if (!inLast) throw new Error('caret is not in the scratch paragraph');
    await editor.evaluate(() => {
      (window as unknown as Record<string, unknown>).__armed = true;
    });

    const gap: [number, number] = [100, 200]; // 5-10 characters per second
    for (let k = 1; k <= total; k += 1) {
      await editor.keyboard.press(S[k - 1] as string);
      await sleep(gap[0] + Math.random() * (gap[1] - gap[0]));
    }
    await sleep(1200 + condition.addedOneWayMs * 4);

    const t0 = await editor.evaluate(() => (window as unknown as { __t0: number[] }).__t0);
    const keys = await editor.evaluate(() => (window as unknown as { __keys: string[] }).__keys);
    let missing = 0;
    let mismatched = 0;
    const domMs: number[][] = [];
    const rafMs: number[][] = [];
    for (const v of viewers) {
      const r = await v.evaluate(() => {
        const o = (window as unknown as { __v: { t1: number[]; raf: number[]; bad: () => number } })
          .__v;
        return {
          t1: Array.from(o.t1, (x) => x ?? null),
          raf: Array.from(o.raf, (x) => x ?? null),
          bad: o.bad(),
        };
      });
      mismatched += r.bad;
      const dom: number[] = [];
      const raf: number[] = [];
      for (let k = warmup + 1; k <= total; k += 1) {
        const a = r.t1[k];
        const b = r.raf[k];
        const s = t0[k];
        if (a == null || s == null || keys[k] !== S[k - 1]) {
          missing += 1;
          continue;
        }
        dom.push(a - s);
        if (b != null) raf.push(b - s);
      }
      domMs.push(dom);
      rafMs.push(raf);
    }
    const clockEnd = await clockCheck(pages);
    const all = [...clockStart, ...clockEnd];
    const clockChecks = {
      atStart: clockStart,
      atEnd: clockEnd,
      maxAbsOffsetMs: Math.max(...all.map((c) => Math.abs(c.offsetMs))),
      maxUncertaintyMs: Math.max(...all.map((c) => c.uncertaintyMs)),
    };
    const chromiumVersion = browser.version();
    return {
      scenario: 'browser-edit',
      condition: condition.key,
      doc: docKey,
      clients,
      warmup,
      chromium: chromiumVersion,
      domMs,
      rafMs,
      missing,
      mismatched,
      clockChecks,
      typingGapMs: gap,
    };
  } finally {
    await browser.close();
    await cleanup();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cond = 'loopback', doc = 'small', clients = '2', samples = '300'] = process.argv.slice(2);
  const result = await runBrowserEdit(
    CONDITIONS[cond as Condition['key']],
    doc as 'small' | 'large',
    Number(clients),
    Number(samples),
  );
  saveJson(runDir(), `browser-edit-${cond}-${doc}-${clients}.json`, result);
  const s = stats(result.domMs.flat());
  const r = stats(result.rafMs.flat());
  process.stdout.write(
    `browser-edit ${cond} ${doc} clients=${clients}: dom p50 ${s.p50.toFixed(1)} p95 ${s.p95.toFixed(1)} p99 ${s.p99.toFixed(1)} n=${s.n}; raf p50 ${r.p50.toFixed(1)} p95 ${r.p95.toFixed(1)}; missing ${result.missing} mismatched ${result.mismatched}; clock max |offset| ${result.clockChecks.maxAbsOffsetMs.toFixed(3)} ms (+-${result.clockChecks.maxUncertaintyMs.toFixed(3)})\n`,
  );
}
