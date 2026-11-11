/**
 * Acceptance scenarios 12 (restart and reconnect do not duplicate initial content), and, at the
 * browser level, 10 (an acknowledged save survives forced termination and restart, including a
 * deletion-only edit) and 6 (edits made while disconnected are kept and merged exactly once).
 *
 * The stack's server is stopped (SIGTERM) and killed (SIGKILL) and started again by the control
 * endpoint of `stack.mjs`; PostgreSQL keeps running. The browser keeps its page open while the
 * server is gone, and a viewer-only second profile watches the same document.
 *
 * These specs share one server and one database with the whole stack: they run in the
 * `disruptive-*` projects, one worker, after all other specs.
 */
import type { Page } from '@playwright/test';
import {
  admin,
  callApi,
  connectionState,
  createShareLink,
  editorContent,
  exportedText,
  expect,
  expectEditorReady,
  expectSaved,
  killServer,
  occurrences,
  openDocument,
  saveState,
  signIn,
  startServer,
  stopServer,
  test,
  unique,
  createDocument,
} from '../support/test';

const SAMPLE_MARKERS = ['Launch notes: RealtimeDocs demo', 'End of sample.'];

async function sampleId(page: Page): Promise<string> {
  const { body } = await callApi<{ documents: { id: string; title: string }[] }>(
    page,
    'GET',
    '/api/documents',
  );
  const sample = body.documents.find((document) =>
    document.title.startsWith('Welcome to RealtimeDocs'),
  );
  expect(sample, 'the sample document exists').toBeTruthy();
  return sample!.id;
}

/** The document's text (headings, paragraphs, code), without editor chrome such as menus and carets. */
async function pageText(page: Page): Promise<string> {
  return editorContent(page).evaluate((root) =>
    [...root.querySelectorAll('h1, h2, h3, h4, p, pre code')]
      .map((element) => {
        const copy = element.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('.rd-caret').forEach((caret) => caret.remove());
        return (copy.textContent ?? '').trim();
      })
      .filter(Boolean)
      .join('\n'),
  );
}

async function expectOnce(page: Page, documentId: string, markers: string[]): Promise<void> {
  const [shown, stored] = [await pageText(page), await exportedText(page, documentId)];
  for (const marker of markers) {
    expect(occurrences(shown, marker), `"${marker}" on the screen`).toBe(1);
    expect(occurrences(stored, marker), `"${marker}" in the server's export`).toBe(1);
  }
}

test('the sample document’s initial content is present exactly once after a stop, a kill and each reconnect', async ({
  page,
  openContext,
}) => {
  test.setTimeout(180_000);
  await signIn(page, admin);
  const id = await sampleId(page);
  const share = await createShareLink(page, id, { role: 'viewer' });
  await openDocument(page, id);
  await expectOnce(page, id, SAMPLE_MARKERS);
  const original = await pageText(page);

  const guest = await (await openContext()).newPage();
  await guest.goto(share.path);
  await expectEditorReady(guest);
  expect(await pageText(guest)).toEqual(original);

  for (const [how, stop] of [
    ['stopped (SIGTERM)', stopServer],
    ['killed (SIGKILL)', killServer],
  ] as const) {
    await stop();
    await expect(connectionState(page)).not.toHaveAttribute('data-state', 'live', {
      timeout: 30_000,
    });
    await startServer();
    await expectEditorReady(page);
    await expectEditorReady(guest);
    await signIn(await (await openContext()).newPage(), admin); // a fresh profile can sign in again
    expect(await pageText(page), `administrator's screen after the server was ${how}`).toEqual(
      original,
    );
    expect(await pageText(guest), `viewer's screen after the server was ${how}`).toEqual(original);
    await expectOnce(page, id, SAMPLE_MARKERS);
  }

  // A reload (new page, local database present, server restarted twice) changes nothing either.
  await page.reload();
  await expectEditorReady(page);
  expect(await pageText(page)).toEqual(original);
  await expectOnce(page, id, SAMPLE_MARKERS);
});

test('an acknowledged save, a deletion-only edit and an edit made while the server was gone all survive a kill', async ({
  page,
  openContext,
}) => {
  test.setTimeout(180_000);
  await signIn(page, admin);
  const id = await createDocument(page, unique('Restart durability'));
  await openDocument(page, id);

  // 1. Typed and acknowledged.
  await editorContent(page).click();
  await page.keyboard.type('Keep this sentence. DELETE-ME-TOKEN stays out.');
  await expectSaved(page);

  // 2. A deletion-only edit, acknowledged: remove the token with Backspace only.
  await page.keyboard.press('ControlOrMeta+End');
  for (let index = 0; index < ' DELETE-ME-TOKEN stays out.'.length; index += 1) {
    await page.keyboard.press('Backspace');
  }
  await expect.poll(() => pageText(page)).toBe('Keep this sentence.');
  await expectSaved(page);
  expect(await exportedText(page, id)).toContain('Keep this sentence.');
  expect(await exportedText(page, id)).not.toContain('DELETE-ME-TOKEN');

  // 3. The server is killed with no chance to flush; the stored document is the acknowledged one.
  await killServer();
  await expect(connectionState(page)).not.toHaveAttribute('data-state', 'live', {
    timeout: 30_000,
  });

  // 4. An edit made while the server is gone is pending, never "Saved".
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Typed while the server was dead.');
  await expect(saveState(page)).not.toHaveAttribute('data-state', 'saved');

  await startServer();
  await expectEditorReady(page);
  await expectSaved(page);

  const expected = 'Keep this sentence. Typed while the server was dead.';
  await expect.poll(() => exportedText(page, id)).toContain(expected);
  const stored = await exportedText(page, id);
  expect(occurrences(stored, 'Keep this sentence.')).toBe(1);
  expect(occurrences(stored, 'Typed while the server was dead.')).toBe(1);
  expect(stored).not.toContain('DELETE-ME-TOKEN');

  // 5. A new profile after the restart reads the same document.
  const other = await (await openContext()).newPage();
  await signIn(other, admin);
  await openDocument(other, id);
  expect(await pageText(other)).toBe(expected);
});
