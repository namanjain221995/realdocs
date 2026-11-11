import type { Page } from '@playwright/test';
/**
 * Initial load, measured separately from editing: a viewer opens the document.
 * Clock: `performance.now()` inside the page, i.e. milliseconds since that page's navigation start
 * (one clock, no cross-machine subtraction). "First content visible" = the editor content has text
 * in the DOM (`domMs`) and the next animation-frame callback (`rafMs`). "Live" = the session
 * indicator reports `data-state="live"` (WebSocket authenticated and synced).
 *   cold: fresh browser context (empty HTTP cache), share link `/s/<id>#secret`, i.e. includes the
 *         share exchange and the redirect to the document;
 *   warm: same context again, session cookie present, HTTP cache warm, direct `/d/<id>`.
 */
import {
  CONDITIONS,
  type Condition,
  type DocInfo,
  readState,
  runDir,
  saveJson,
  stats,
} from './common';
import { baseUrl, launch, newContext, waitReady } from './browser-lib';

const INIT = `(() => {
  const m = (window.__load = { firstContent: null, firstContentRaf: null, live: null });
  const check = () => {
    const c = document.querySelector('[data-testid="rd-editor-content"]');
    if (c && m.firstContent === null && (c.textContent || '').trim().length > 0) {
      m.firstContent = performance.now();
      requestAnimationFrame(() => { m.firstContentRaf = performance.now(); });
    }
    const s = document.querySelector('[data-testid="rd-status-connection"]');
    if (s && m.live === null && s.getAttribute('data-state') === 'live') m.live = performance.now();
    if (m.firstContent !== null && m.live !== null) mo.disconnect();
  };
  const mo = new MutationObserver(check);
  mo.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-state'] });
})();`;

interface Load {
  firstContent: number | null;
  firstContentRaf: number | null;
  live: number | null;
  responseEnd: number;
  domContentLoaded: number;
  loadEvent: number;
  requests: number;
  transferBytes: number;
}

export interface InitialLoadResult {
  scenario: 'initial-load';
  condition: Condition['key'];
  doc: 'small' | 'large';
  chromium: string;
  cold: Load[];
  warm: Load[];
}

async function collect(page: Page): Promise<Load> {
  await waitReady(page);
  await page.waitForFunction(() => {
    const m = (
      window as unknown as {
        __load: {
          firstContent: number | null;
          live: number | null;
          firstContentRaf: number | null;
        };
      }
    ).__load;
    return m.firstContent !== null && m.live !== null && m.firstContentRaf !== null;
  });
  return page.evaluate(() => {
    const m = (window as unknown as { __load: Record<string, number | null> }).__load;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return {
      firstContent: m.firstContent as number,
      firstContentRaf: m.firstContentRaf as number,
      live: m.live as number,
      responseEnd: nav.responseEnd,
      domContentLoaded: nav.domContentLoadedEventEnd,
      loadEvent: nav.loadEventEnd,
      requests: res.length + 1,
      transferBytes: res.reduce((a, r) => a + r.transferSize, nav.transferSize),
    };
  });
}

export async function runInitialLoad(
  condition: Condition,
  docKey: 'small' | 'large',
  samples: number,
): Promise<InitialLoadResult> {
  const doc = readState().docs[docKey] as DocInfo;
  const browser = await launch();
  const cold: Load[] = [];
  const warm: Load[] = [];
  try {
    for (let i = 0; i < samples + 3; i += 1) {
      const context = await newContext(browser);
      await context.addInitScript(INIT);
      const page = await context.newPage();
      await page.goto(`${baseUrl(condition)}/s/${doc.viewerShare.id}#${doc.viewerShare.secret}`);
      const c = await collect(page);
      await page.close();
      const page2 = await context.newPage();
      await page2.goto(`${baseUrl(condition)}/d/${doc.id}`);
      const w = await collect(page2);
      await context.close();
      if (i >= 3) {
        cold.push(c);
        warm.push(w);
      }
    }
    return {
      scenario: 'initial-load',
      condition: condition.key,
      doc: docKey,
      chromium: browser.version(),
      cold,
      warm,
    };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cond = 'loopback', doc = 'small', samples = '30'] = process.argv.slice(2);
  const r = await runInitialLoad(
    CONDITIONS[cond as Condition['key']],
    doc as 'small' | 'large',
    Number(samples),
  );
  saveJson(runDir(), `initial-load-${cond}-${doc}.json`, r);
  const line = (name: string, l: Load[]) => {
    const f = stats(l.map((x) => x.firstContent ?? Number.NaN));
    const v = stats(l.map((x) => x.live ?? Number.NaN));
    return `${name}: first content p50 ${f.p50.toFixed(0)} p95 ${f.p95.toFixed(0)}; live p50 ${v.p50.toFixed(0)} p95 ${v.p95.toFixed(0)} (n=${f.n})`;
  };
  process.stdout.write(
    `initial-load ${cond} ${doc}\n ${line('cold', r.cold)}\n ${line('warm', r.warm)}\n`,
  );
}
