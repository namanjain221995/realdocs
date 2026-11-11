/** Playwright helpers shared by the browser scenarios. These run inside the Playwright image. */
import { type Browser, type BrowserContext, type Page, chromium } from '@playwright/test';
import * as Y from 'yjs';
import {
  type Condition,
  type DocInfo,
  HOST,
  PORTS,
  adminPassword,
  readState,
  sleep,
} from './common';
import { PerfClient } from './collab';
import { Api } from './http';

export const CONTENT = '[data-testid="rd-editor-content"]';

export async function launch(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    // Keep timers and frames of non-focused tabs running; otherwise background throttling would
    // delay the viewers' animation-frame callbacks. MutationObserver is not throttled either way.
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
}

/** tsx compiles with keepNames, which injects a `__name` helper into functions sent to the page. */
export async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'en-GB',
    timezoneId: 'UTC',
  });
  await context.addInitScript('window.__name = window.__name || ((f) => f);');
  return context;
}

export const baseUrl = (condition: Condition) => `http://${HOST}:${condition.port}`;

export async function adminApi(port: number = PORTS.server): Promise<Api> {
  const state = readState();
  const api = new Api(port);
  await api.login(state.adminEmail, adminPassword(state));
  return api;
}

export async function newAdminContext(
  browser: Browser,
  condition: Condition,
): Promise<BrowserContext> {
  const api = await adminApi(condition.port);
  const context = await newContext(browser);
  await context.addCookies([
    { name: 'rd_session', value: api.cookies.get('rd_session') as string, url: baseUrl(condition) },
  ]);
  return context;
}

export async function waitReady(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForSelector('[data-testid="rd-editor"][data-ready="true"]', {
    timeout: timeoutMs,
  });
  await page.waitForSelector('[data-testid="rd-status-connection"][data-state="live"]', {
    timeout: timeoutMs,
  });
}

export async function openEditor(
  browser: Browser,
  condition: Condition,
  doc: DocInfo,
): Promise<Page> {
  const context = await newAdminContext(browser, condition);
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__t0 = [] as number[];
    w.__keys = [] as string[];
    w.__k = 0;
    w.__armed = false;
    // Capture phase on window: the first JavaScript that sees the key, before ProseMirror.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!w.__armed || e.key.length !== 1) return;
        const k = ((w.__k as number) += 1);
        (w.__t0 as number[])[k] = performance.timeOrigin + performance.now();
        (w.__keys as string[])[k] = e.key;
      },
      true,
    );
  });
  await page.goto(`${baseUrl(condition)}/d/${doc.id}`);
  await waitReady(page);
  return page;
}

export async function openViewer(
  browser: Browser,
  condition: Condition,
  doc: DocInfo,
): Promise<Page> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto(`${baseUrl(condition)}/s/${doc.viewerShare.id}#${doc.viewerShare.secret}`);
  await page.waitForURL(new RegExp(`/d/${doc.id}$`), { timeout: 30_000 });
  await waitReady(page);
  return page;
}

/**
 * Clock readings of each page against the Node process. Best of 25 round trips per page (the one
 * with the smallest evaluate round trip), so the uncertainty is the CDP latency of that trip / 2.
 */
export async function clockCheck(
  pages: Page[],
): Promise<{ page: number; offsetMs: number; uncertaintyMs: number }[]> {
  const out: { page: number; offsetMs: number; uncertaintyMs: number }[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    let best = { offsetMs: Number.NaN, uncertaintyMs: Number.POSITIVE_INFINITY };
    for (let j = 0; j < 25; j += 1) {
      const before = performance.timeOrigin + performance.now();
      const pageClock = await (pages[i] as Page).evaluate(
        () => performance.timeOrigin + performance.now(),
      );
      const after = performance.timeOrigin + performance.now();
      const uncertaintyMs = (after - before) / 2;
      if (uncertaintyMs < best.uncertaintyMs)
        best = { offsetMs: pageClock - (before + after) / 2, uncertaintyMs };
    }
    out.push({ page: i, ...best });
  }
  return out;
}

/** A pseudo-random lower-case letter sequence: marker k is (position k, letter k). */
export function markerSequence(length: number): string {
  let seed = 0x2f6e2b1;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    out += String.fromCharCode(97 + ((seed >>> 24) % 26));
  }
  return out;
}

/** Appends an empty paragraph where the editor will type, and returns a function that removes it again. */
export async function withScratchParagraph(doc: DocInfo): Promise<() => Promise<void>> {
  const api = await adminApi();
  const writer = await PerfClient.connect(api, doc.id);
  writer.edit(() => {
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText()]);
    writer.fragment.push([p]);
  });
  await writer.save();
  writer.destroy();
  return async () => {
    const cleaner = await PerfClient.connect(await adminApi(), doc.id);
    const extra = cleaner.fragment.length - doc.blocks;
    if (extra > 0) cleaner.edit(() => cleaner.fragment.delete(doc.blocks, extra));
    await cleaner.save();
    cleaner.destroy();
    await sleep(100);
  };
}
