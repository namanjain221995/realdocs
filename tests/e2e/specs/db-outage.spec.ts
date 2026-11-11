/**
 * Acceptance scenario 11 in a browser: database unavailability never produces a false "Saved".
 *
 * PostgreSQL (container `rd-e2e-pg`) is stopped while an editor has the document open. The
 * save indicator is recorded from the moment the edit is made: it must leave "Saved" and must
 * not show "Saved" again until PostgreSQL is back and the server has stored the edit. The
 * server's export is then checked, and so is a freshly loaded page. The server process keeps
 * running throughout (its own durability tests cover the queue limits and the error codes).
 *
 * Runs in the `disruptive-*` projects: it stops the database that every other spec uses.
 */
import type { Page } from '@playwright/test';
import {
  admin,
  createDocument,
  editorContent,
  exportedText,
  expect,
  expectSaved,
  occurrences,
  openDocument,
  saveState,
  signIn,
  startDatabase,
  stopDatabase,
  test,
  unique,
} from '../support/test';

type Recorder = { states: string[] };

async function startRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.querySelector('[data-testid="rd-status-save"]') as HTMLElement;
    const recorder: Recorder = { states: [target.dataset.state ?? 'unknown'] };
    (window as unknown as { __saveRecorder: Recorder }).__saveRecorder = recorder;
    new MutationObserver(() => recorder.states.push(target.dataset.state ?? 'unknown')).observe(
      target,
      { attributes: true, attributeFilter: ['data-state'] },
    );
  });
}

const recorded = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __saveRecorder: Recorder }).__saveRecorder.states);

test('with PostgreSQL stopped an edit is never shown as saved, and it is stored once the database is back', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, admin);
  const id = await createDocument(page, unique('Database outage'));
  await openDocument(page, id);
  await editorContent(page).click();
  await page.keyboard.type('Stored before the outage.');
  await expectSaved(page);

  await startRecording(page);
  await stopDatabase();
  try {
    await page.keyboard.type(' Typed while the database was down.');
    await expect(saveState(page)).not.toHaveAttribute('data-state', 'saved');

    // Keep watching while the server retries against a database that is not there.
    const afterTyping = (await recorded(page)).length;
    await page.waitForTimeout(8_000);
    await expect(saveState(page)).not.toHaveAttribute('data-state', 'saved');
    const during = (await recorded(page)).slice(afterTyping - 1);
    expect(during, 'save indicator while the database is down').not.toContain('saved');
  } finally {
    await startDatabase();
  }

  // The server retries on its own; the indicator ends at Saved only after the commit.
  await expectSaved(page);
  const history = await recorded(page);
  const lastNotSaved = history.map((state) => state !== 'saved').lastIndexOf(true);
  expect(lastNotSaved, 'the indicator left "Saved" when the edit was made').toBeGreaterThanOrEqual(
    0,
  );
  expect(history.at(-1)).toBe('saved');

  await expect
    .poll(() => exportedText(page, id), { timeout: 30_000 })
    .toContain('Stored before the outage. Typed while the database was down.');
  const stored = await exportedText(page, id);
  expect(occurrences(stored, 'Typed while the database was down.')).toBe(1);
  expect(occurrences(stored, 'Stored before the outage.')).toBe(1);

  await page.reload();
  await expect(editorContent(page)).toContainText('Typed while the database was down.');
});
