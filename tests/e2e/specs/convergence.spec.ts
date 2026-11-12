/**
 * Acceptance scenario 3: concurrent editors converge without lost or duplicated paragraphs.
 *
 * Three isolated browser profiles (the administrator and two guests with an edit link) type at
 * the same time into one document on the real server. After every run: identical paragraphs on
 * every client, the same paragraphs in the server's export, nothing lost and nothing duplicated.
 *
 *  1. Each editor appends words to a different paragraph, all at once (no paragraph is split
 *     while others type). Every paragraph must hold exactly its author's words, in order.
 *  2. All three editors create new paragraphs after different paragraphs while the others keep
 *     typing; only the Enter key presses are taken in turns (see EnterTurns). Converged and
 *     conserved: the clients, the export and a fresh browser agree, and every typed paragraph
 *     exists exactly once, intact and in its author's order.
 *  3. Enter pressed by all three editors at the same instant at the same place, then typing.
 *     Every editor's caret must stay in the paragraph that editor created. Until 2026-11-12 this
 *     was a known defect: the shared document was right, but every caret was moved into the first
 *     of the identical empty paragraphs, so the typing of all three landed in one paragraph. Fixed
 *     by `CaretKeeper` (packages/editor/src/editor/collabPlugins.ts); unit-level reproduction in
 *     packages/editor/test/concurrent-enter.test.ts.
 */
import type { BrowserContext, Page } from '@playwright/test';
import {
  admin,
  createDocument,
  createShareLink,
  editorContent,
  exportedMarkdown,
  exportedText,
  expect,
  expectEditorReady,
  expectSaved,
  occurrences,
  openDocument,
  paragraphs,
  signIn,
  test,
  unique,
} from '../support/test';

interface Trio {
  documentId: string;
  clients: [Page, Page, Page];
}

const BASE = ['base-1 first paragraph', 'base-2 second paragraph', 'base-3 third paragraph'];

async function openTrio(
  page: Page,
  openContext: () => Promise<BrowserContext>,
  title: string,
): Promise<Trio> {
  await signIn(page, admin);
  const documentId = await createDocument(page, unique(title));
  const shareA = await createShareLink(page, documentId, { role: 'editor', label: 'guest A' });
  const shareB = await createShareLink(page, documentId, { role: 'editor', label: 'guest B' });
  await openDocument(page, documentId);
  const guestA = await (await openContext()).newPage();
  const guestB = await (await openContext()).newPage();
  await guestA.goto(shareA.path);
  await guestB.goto(shareB.path);
  await expectEditorReady(guestA);
  await expectEditorReady(guestB);

  await editorContent(page).click();
  for (const [index, line] of BASE.entries()) {
    if (index > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  for (const client of [guestA, guestB]) {
    await expect.poll(() => paragraphs(client)).toEqual(BASE);
  }
  return { documentId, clients: [page, guestA, guestB] };
}

/** Puts the caret at the end of the paragraph that starts with `text` and waits until it is there. */
async function caretAtEndOf(page: Page, text: string): Promise<void> {
  const caretParent = () =>
    page.evaluate(() => {
      const host = document.querySelector('[data-testid="rd-editor-content"]') as HTMLElement & {
        editor: {
          state: { selection: { empty: boolean; $from: { parent: { textContent: string } } } };
        };
      };
      return host.editor.state.selection.$from.parent.textContent;
    });
  // The editor applies a click to its selection asynchronously: place, verify, retry.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await editorContent(page).locator('p', { hasText: text }).first().click();
    await page.keyboard.press('End');
    await page.waitForTimeout(250);
    if ((await caretParent()).includes(text)) return;
  }
  throw new Error(`the caret never reached the paragraph "${text}"`);
}

async function caretAtEndOfDocument(page: Page): Promise<void> {
  await editorContent(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.waitForTimeout(300);
}

const lineText = (prefix: string, index: number): string =>
  `${prefix}-${String(index).padStart(2, '0')} paragraph typed by ${prefix}`;

/**
 * Lets one editor at a time press Enter (and gives the split time to reach the others) while all
 * editors keep typing. Two paragraph splits made at the same instant are the known defect below.
 */
class EnterTurns {
  private tail: Promise<void> = Promise.resolve();
  async press(page: Page, settleMs = 150): Promise<void> {
    const mine = this.tail.then(async () => {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(settleMs);
    });
    this.tail = mine.catch(() => undefined);
    await mine;
  }
}

async function typeLines(
  page: Page,
  prefix: string,
  count: number,
  delay: number,
  turns?: EnterTurns,
): Promise<void> {
  for (let index = 1; index <= count; index += 1) {
    if (turns) await turns.press(page);
    else await page.keyboard.press('Enter');
    await page.keyboard.type(lineText(prefix, index), { delay });
  }
}

/** Waits for identical paragraphs everywhere and returns them; explains a failure with the views. */
async function converged(clients: Page[], expectedCount: number): Promise<string[]> {
  let views: string[][] = [];
  const same = async () => {
    views = await Promise.all(clients.map((client) => paragraphs(client)));
    return views.every(
      (view) => view.length === expectedCount && view.join('\n') === (views[0] ?? []).join('\n'),
    );
  };
  try {
    await expect.poll(same, { timeout: 60_000, intervals: [250, 500, 1000] }).toBe(true);
  } catch (error) {
    throw new Error(
      `clients did not converge on ${expectedCount} identical paragraphs (sizes ${views.map((v) => v.length).join('/')})\n` +
        views.map((view, index) => `--- client ${index}\n${view.join('\n')}`).join('\n'),
      { cause: error },
    );
  }
  return views[0] ?? [];
}

/** The server's stored document, as text lines, after every client reports Saved. */
async function exportedParagraphs(trio: Trio): Promise<string[]> {
  await Promise.all(trio.clients.map((client) => expectSaved(client)));
  const [page] = trio.clients;
  const text = await exportedText(page, trio.documentId);
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

test('editors typing words into different paragraphs at once keep every paragraph intact', async ({
  page,
  openContext,
}) => {
  test.setTimeout(120_000);
  const trio = await openTrio(page, openContext, 'Convergence words');
  const [admin1, guestA, guestB] = trio.clients;
  const words = (prefix: string) =>
    Array.from({ length: 12 }, (_, index) => ` ${prefix}${index + 1}`).join('');

  await Promise.all([
    (async () => {
      await caretAtEndOf(admin1, 'base-1');
      for (let i = 1; i <= 12; i += 1) await admin1.keyboard.type(` ADM${i}`, { delay: 15 });
    })(),
    (async () => {
      await caretAtEndOf(guestA, 'base-2');
      for (let i = 1; i <= 12; i += 1) await guestA.keyboard.type(` GA${i}`, { delay: 15 });
    })(),
    (async () => {
      await caretAtEndOf(guestB, 'base-3');
      for (let i = 1; i <= 12; i += 1) await guestB.keyboard.type(` GB${i}`, { delay: 15 });
    })(),
  ]);

  const expected = [
    `${BASE[0]}${words('ADM')}`,
    `${BASE[1]}${words('GA')}`,
    `${BASE[2]}${words('GB')}`,
  ];
  expect(await converged(trio.clients, 3)).toEqual(expected);
  expect(await exportedParagraphs(trio)).toEqual(expected);
});

test('three editors creating paragraphs at once, in different places, keep every paragraph intact', async ({
  page,
  openContext,
}) => {
  test.setTimeout(180_000);
  const trio = await openTrio(page, openContext, 'Convergence paragraphs');
  const [admin1, guestA, guestB] = trio.clients;
  const LINES = 10;
  const turns = new EnterTurns();

  await Promise.all([
    (async () => {
      await caretAtEndOf(admin1, 'base-1');
      await typeLines(admin1, 'ADM', LINES, 25, turns);
    })(),
    (async () => {
      await caretAtEndOf(guestA, 'base-2');
      await typeLines(guestA, 'GA', LINES, 25, turns);
    })(),
    (async () => {
      await caretAtEndOf(guestB, 'base-3');
      await typeLines(guestB, 'GB', LINES, 25, turns);
    })(),
  ]);

  const final = await converged(trio.clients, 3 + 3 * LINES);
  const lines = (prefix: string) =>
    Array.from({ length: LINES }, (_, i) => lineText(prefix, i + 1));
  expect(final).toEqual([
    BASE[0],
    ...lines('ADM'),
    BASE[1],
    ...lines('GA'),
    BASE[2],
    ...lines('GB'),
  ]);

  // The server holds the same document as the clients; a fresh browser sees it too.
  expect(await exportedParagraphs(trio)).toEqual(final);
  expect(occurrences(await exportedMarkdown(admin1, trio.documentId), 'typed by ADM'), 'md').toBe(
    LINES,
  );
  const late = await (await openContext()).newPage();
  await signIn(late, admin);
  await openDocument(late, trio.documentId);
  await expect.poll(() => paragraphs(late)).toEqual(final);
});

test.describe('simultaneous Enter', () => {
  test('editors pressing Enter at the same instant at the same place get the paragraphs they typed', async ({
    page,
    openContext,
  }) => {
    test.setTimeout(180_000);
    const trio = await openTrio(page, openContext, 'Convergence same place');
    const ROUNDS = 6;
    const prefixes = ['X', 'Y', 'Z'];
    for (let round = 1; round <= ROUNDS; round += 1) {
      await Promise.all(
        trio.clients.map(async (client, index) => {
          await caretAtEndOfDocument(client);
          await client.keyboard.press('Enter');
          await client.keyboard.type(`${prefixes[index]}${round}`, { delay: 25 });
        }),
      );
    }
    const typed = prefixes.flatMap((prefix) =>
      Array.from({ length: ROUNDS }, (_, i) => `${prefix}${i + 1}`),
    );
    const final = await converged(trio.clients, 3 + typed.length);
    expect([...final].sort()).toEqual([...BASE, ...typed].sort());
  });
});
