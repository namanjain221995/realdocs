/** In-page recorders shared by the local-latency, reconnect and resource scenarios. */
import type { Page } from '@playwright/test';
import { CONTENT } from './browser-lib';

/**
 * MutationObserver on the editor content: t1[k] (and the next animation frame, raf[k]) is the first
 * moment the last block's text has k characters; each character is compared with S[k-1].
 */
export async function installTextObserver(page: Page, S: string): Promise<void> {
  await page.evaluate(
    ({ sel, S }) => {
      const content = document.querySelector(sel) as HTMLElement;
      const t1: number[] = [];
      const raf: number[] = [];
      let seen = 0;
      let bad = 0;
      const now = () => performance.timeOrigin + performance.now();
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
      new MutationObserver(() => {
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
      }).observe(content, { subtree: true, childList: true, characterData: true });
      (window as unknown as Record<string, unknown>).__v = { t1, raf, bad: () => bad };
    },
    { sel: CONTENT, S },
  );
}

export async function readTextObserver(page: Page) {
  return page.evaluate(() => {
    const o = (window as unknown as { __v: { t1: number[]; raf: number[]; bad: () => number } })
      .__v;
    return {
      t1: Array.from(o.t1, (x) => x ?? null),
      raf: Array.from(o.raf, (x) => x ?? null),
      bad: o.bad(),
    };
  });
}

/** Records every change of the connection and save indicators with the page clock. */
export async function installStateRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: { t: number; which: string; state: string }[] = [];
    const now = () => performance.timeOrigin + performance.now();
    const read = (which: string, id: string) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      return el ? (el.getAttribute('data-state') ?? '') : '';
    };
    const last: Record<string, string> = {};
    const check = () => {
      for (const [which, id] of [
        ['connection', 'rd-status-connection'],
        ['save', 'rd-status-save'],
      ] as const) {
        const state = read(which, id);
        if (state !== last[which]) {
          last[which] = state;
          log.push({ t: now(), which, state });
        }
      }
    };
    check();
    new MutationObserver(check).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
    (window as unknown as Record<string, unknown>).__states = log;
  });
}

export async function readStates(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __states: { t: number; which: string; state: string }[] }).__states,
  );
}

export async function currentState(page: Page, which: 'connection' | 'save'): Promise<string> {
  return page.evaluate(
    (id) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-state') ?? '',
    which === 'connection' ? 'rd-status-connection' : 'rd-status-save',
  );
}
