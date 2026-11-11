/**
 * Real stack, scenario k: the server goes away while someone is typing.
 *
 * These tests stop and start the shared server, so they are kept out of the
 * parallel run: their own projects (`outage-*`), one worker (see
 * `playwright.real.config.ts`).
 */
import type { Page } from '@playwright/test';
import {
  admin,
  connectionState,
  createDocument,
  createShareLink,
  editorContent,
  expect,
  expectEditorReady,
  expectReconnected,
  expectSaved,
  exportedText,
  killServer,
  occurrences,
  openDocument,
  saveState,
  signIn,
  startServer,
  stopServer,
  test,
  typeLine,
  unique,
} from './support/test';

test.describe.configure({ mode: 'serial' });

/** Browsers report the refused connection attempts of an outage in the console. */
const OUTAGE_NOISE = [
  /WebSocket connection to/i,
  /establish a connection to the server at ws/i,
  /WebSocket network error/i,
];

/**
 * Records, in order, every value the two status indicators take from now on,
 * including ones that would only flash by between two polls.
 */
async function recordStatus(
  page: Page,
): Promise<() => Promise<{ save: string[]; connection: string[] }>> {
  await page.evaluate(() => {
    const seen: { save: string[]; connection: string[] } = { save: [], connection: [] };
    const read = (): void => {
      for (const kind of ['save', 'connection'] as const) {
        const element = document.querySelector(`[data-testid="rd-status-${kind}"]`);
        const state = element?.getAttribute('data-state');
        if (state && seen[kind].at(-1) !== state) seen[kind].push(state);
      }
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
    (window as unknown as { __rdSeen: () => unknown }).__rdSeen = () => {
      observer.disconnect();
      return seen;
    };
  });
  return () =>
    page.evaluate(() =>
      (
        window as unknown as { __rdSeen: () => { save: string[]; connection: string[] } }
      ).__rdSeen(),
    );
}

for (const [how, down] of [
  ['killed', killServer],
  ['shut down', stopServer],
] as const) {
  test(`text typed while the server is ${how} is never shown as saved and is merged when the server is back`, async ({
    page,
    openContext,
    problems,
  }) => {
    problems.allow(...OUTAGE_NOISE);
    await signIn(page, admin);
    const documentId = await createDocument(page, unique('Outage'));
    const link = await createShareLink(page, documentId, { role: 'editor' });
    await openDocument(page, documentId);
    const guest = await (await openContext()).newPage();
    await guest.goto(link.path);
    await expectEditorReady(guest);

    const before = unique('Typed before the outage');
    await typeLine(page, before);
    await expectSaved(page);
    await expect(editorContent(guest)).toContainText(before);

    const fromAdmin = unique('Administrator, during the outage');
    const fromGuest = unique('Guest, during the outage');
    await down();
    try {
      // Both screens say so, and neither claims anything is saved from here on.
      for (const view of [page, guest]) {
        await expect(connectionState(view)).toHaveAttribute(
          'data-state',
          /^(reconnecting|offline)$/,
        );
      }
      const collectAdmin = await recordStatus(page);
      const collectGuest = await recordStatus(guest);
      await typeLine(page, fromAdmin);
      await typeLine(guest, fromGuest);
      await expect(saveState(page)).toHaveAttribute('data-state', 'pending');
      await expect(saveState(guest)).toHaveAttribute('data-state', 'pending');
      // Long enough for several reconnection attempts to fail.
      await page.waitForTimeout(6_000);
      await expect(editorContent(page)).toContainText(fromAdmin);
      for (const collect of [collectAdmin, collectGuest]) {
        const seen = await collect();
        // "Saved" was true for what had been typed before. From the first unsent
        // character on, the indicator says "pending" and nothing else.
        expect(seen.save).toEqual(['saved', 'pending']);
        expect(seen.connection).not.toContain('live');
      }
    } finally {
      await startServer();
    }

    // The server is back: both reconnect, the unsent text of both is merged and saved.
    await expectReconnected(page);
    await expectReconnected(guest);
    await expectSaved(page);
    await expectSaved(guest);
    for (const view of [page, guest]) {
      const content = editorContent(view);
      await expect(content).toContainText(fromAdmin);
      await expect(content).toContainText(fromGuest);
      for (const text of [before, fromAdmin, fromGuest]) {
        expect(await occurrences(view, text)).toBe(1);
      }
    }
    const stored = await exportedText(page, documentId);
    for (const text of [before, fromAdmin, fromGuest]) {
      expect(stored.split(text).length - 1, `"${text}" in the stored document`).toBe(1);
    }

    // A reload after the outage shows the same, once.
    await page.reload();
    await expectEditorReady(page);
    for (const text of [before, fromAdmin, fromGuest]) {
      expect(await occurrences(page, text)).toBe(1);
    }
    await expectSaved(page);
  });
}
