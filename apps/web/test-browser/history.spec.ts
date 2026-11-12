import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { DOC_IDS, expect, hasHorizontalOverflow, signedInAs, test, USERS } from './support/test';

const DOC = `/d/${DOC_IDS.launch}`;
const HISTORY = `${DOC}/history`;
const LIST = new RegExp(`^/api/documents/${DOC_IDS.launch}/history$`);

test.beforeEach(({ api }) => {
  signedInAs(api, USERS.asha);
});

async function openRevision(page: Page, revision: number): Promise<void> {
  await page.locator(`[data-history-row][data-revision="${revision}"]`).click();
  await expect(page.getByTestId('revision-detail')).toContainText(`Revision ${revision}`);
}

test.describe('timeline', () => {
  test('an administrator opens the history from the document header', async ({ page }) => {
    await page.goto(DOC);
    await page.getByTestId('open-history').click();
    await expect(page).toHaveURL(HISTORY);
    await expect(page.getByRole('heading', { level: 1, name: 'Version history' })).toBeVisible();
    await expect(page.getByTestId('history-row')).toHaveCount(12);
    await expect(page.getByText(/shown in UTC/)).toBeVisible();
  });

  test('groups rows by day and editor with second precision', async ({ page }) => {
    await page.goto(HISTORY);
    const days = page.getByRole('heading', { level: 3 });
    await expect(days.filter({ hasText: '10 November 2026' })).toBeVisible();
    await expect(days.filter({ hasText: '9 November 2026' })).toBeVisible();

    const newest = page.locator('[data-history-row][data-revision="12"]');
    await expect(newest).toContainText('11:41:55');
    await expect(newest).toContainText('Typed text');
    await expect(newest).toContainText('+40 characters');
    await expect(newest).toContainText('Naman Jain');
    await expect(newest).toContainText('Interviewer');
    // The full timestamp, with milliseconds, is in the tooltip.
    await expect(newest).toHaveAttribute('title', /2026-11-10T11:41:55\.321Z/);

    const group = page.getByTestId('history-group').first();
    await expect(group.getByTestId('history-group-toggle')).toHaveText(
      'Naman Jain — Interviewer · 3 changes · 11:30:02–11:41:55',
    );
    // Collapsing hides the group's rows.
    await group.getByTestId('history-group-toggle').click();
    await expect(group.getByTestId('history-row')).toHaveCount(0);
    await group.getByTestId('history-group-toggle').click();
    await expect(group.getByTestId('history-row')).toHaveCount(3);
  });

  test('words every kind of row and labels pastes', async ({ page }) => {
    await page.goto(HISTORY);
    const row = (revision: number) =>
      page.locator(`[data-history-row][data-revision="${revision}"]`);
    await expect(row(11)).toContainText('Pasted content');
    await expect(row(11)).toContainText('+128 / −12 characters');
    await expect(row(11).getByTestId('paste-basis')).toHaveText(
      'Announced by the editor as a paste',
    );
    await expect(row(9).getByTestId('paste-basis')).toHaveText(
      'Inferred from the size of the change',
    );
    await expect(row(7)).toContainText('Changed page settings');
    await expect(row(7)).toContainText('margin left 25.4 mm → 30 mm');
    await expect(row(6)).toContainText('Inserted image');
    await expect(row(6)).toContainText('1 image');
    await expect(row(5)).toContainText('Changed formatting');
    await expect(row(1)).toContainText('History starts here');

    const events = page.getByTestId('history-event');
    await expect(events).toHaveCount(3);
    await expect(events.nth(0)).toContainText('Version restored');
    await expect(events.nth(1)).toContainText('Share link created');
    await expect(events.nth(2)).toContainText('widget.exploded');
  });

  test('filters by operation, editor and date and clears the filters', async ({ page, api }) => {
    await page.goto(HISTORY);
    await expect(page.getByTestId('history-row')).toHaveCount(12);

    await page.getByTestId('filter-operation').selectOption('paste');
    await expect(page.getByTestId('history-row')).toHaveCount(2);
    // Administrative events are not filtered by the server, so they are hidden with the filter.
    await expect(page.getByTestId('history-event')).toHaveCount(0);
    expect(api.callsTo('GET', LIST).at(-1)?.search).toContain('operation=paste');

    await page.getByTestId('filter-operation').selectOption('');
    await page.getByTestId('filter-actor').fill('priya');
    await expect(page.getByTestId('history-row')).toHaveCount(6);
    expect(api.callsTo('GET', LIST).at(-1)?.search).toContain('actor=priya');

    await page.getByTestId('filter-clear').click();
    await page.getByTestId('filter-from').fill('2026-11-10');
    await expect(page.getByTestId('history-row')).toHaveCount(8);
    await page.getByTestId('filter-from').fill('2026-11-11');
    await expect(page.getByTestId('history-empty')).toContainText('No changes match these filters');
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page.getByTestId('history-row')).toHaveCount(12);
  });

  test('loads older pages on request and notes the retention period', async ({ page, api }) => {
    api.historyPageSize = 5;
    api.historyRetentionDays = 90;
    await page.goto(HISTORY);
    await expect(page.getByTestId('retention-note')).toContainText('kept for 90 days');
    await expect(page.getByTestId('history-row')).toHaveCount(5);
    // Events older than the oldest loaded row wait for their place.
    await expect(page.getByTestId('history-event')).toHaveCount(1);
    await page.getByTestId('history-load-more').click();
    await expect(page.getByTestId('history-row')).toHaveCount(10);
    await page.getByTestId('history-load-more').click();
    await expect(page.getByTestId('history-row')).toHaveCount(12);
    await expect(page.getByTestId('history-load-more')).toHaveCount(0);
    await expect(page.getByTestId('history-event')).toHaveCount(3);
    expect(api.callsTo('GET', LIST).map((call) => call.search)).toEqual(
      expect.arrayContaining([expect.stringContaining('before=')]),
    );
  });

  test('shows an error with a retry', async ({ page, api }) => {
    api.failNext('GET', LIST, 'internal', { times: 3 });
    await page.goto(HISTORY);
    await expect(page.getByTestId('history-error')).toBeVisible();
    await page.getByTestId('history-error').getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('history-row')).toHaveCount(12);
  });
});

test.describe('revision detail', () => {
  test('shows who, server and client times, the diff and the preview', async ({ page }) => {
    await page.goto(HISTORY);
    await openRevision(page, 10);
    await expect(page).toHaveURL(`${HISTORY}?rev=10`);
    await expect(page.locator('[data-history-row][data-revision="10"]')).toHaveAttribute(
      'aria-current',
      'true',
    );

    const facts = page.getByTestId('revision-facts');
    await expect(facts).toContainText('Naman Jain — Interviewer');
    await expect(facts).toContainText('2026-11-10T11:30:02.987Z');
    await expect(facts).toContainText('2026-11-10T11:29:58.000Z');
    await expect(facts).toContainText('reported by the client, not verified');

    const diff = page.getByTestId('diff');
    await expect(diff.locator('[data-op="insert"]')).toContainText(
      'New sentence from revision 10.',
    );
    await expect(diff.locator('[data-op="insert"] .hist-diff__mark')).toHaveText('+');
    await expect(diff.locator('[data-op="delete"]')).toContainText(
      'Old sentence before revision 10.',
    );
    await expect(diff.locator('[data-op="delete"] .hist-diff__mark')).toHaveText('−');
    await diff.getByRole('button', { name: 'Show 5 unchanged lines' }).click();
    await expect(diff).toContainText('Unchanged paragraph 1');

    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(page.getByTestId('revision-preview')).toContainText(
      'New sentence from revision 10.',
    );
  });

  test('names a version', async ({ page, api }) => {
    await page.goto(`${HISTORY}?rev=12`);
    await page.getByTestId('name-version').click();
    const dialog = page.getByTestId('name-dialog');
    await dialog.getByRole('button', { name: 'Save name' }).click();
    await expect(dialog).toContainText('Give this version a name.');
    await dialog.getByTestId('version-name').fill('  Working solution  ');
    await dialog.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByText('Named revision 12 “Working solution”')).toBeVisible();
    expect(api.callsTo('POST', /\/history\/12\/name$/)[0]?.body).toEqual({
      name: 'Working solution',
    });
  });

  test('restores only after a confirmation and returns to the document', async ({ page, api }) => {
    await page.goto(`${HISTORY}?rev=12`);
    await page.getByTestId('restore-version').click();
    const confirm = page.getByTestId('restore-version-confirm');
    await expect(confirm).toContainText('automatic snapshot');
    await expect(confirm).toContainText('Nothing in the history is deleted');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(api.callsTo('POST', /\/restore$/)).toHaveLength(0);

    await page.getByTestId('restore-version').click();
    await page
      .getByTestId('restore-version-confirm')
      .getByRole('button', { name: 'Restore this version' })
      .click();
    await expect(page).toHaveURL(DOC);
    await expect(page.getByText('Restored revision 12')).toBeVisible();
    expect(api.callsTo('POST', /\/history\/12\/name$/)[0]?.body).toEqual({
      name: 'Restored from revision 12 (2026-11-10 11:41:55)',
    });
    expect(api.callsTo('POST', /\/snapshots\/[^/]+\/restore$/)).toHaveLength(1);
  });

  test('restores as a copy and links to it', async ({ page, api }) => {
    await page.goto(`${HISTORY}?rev=11`);
    await page.getByTestId('restore-copy').click();
    const banner = page.getByTestId('copy-banner');
    await expect(banner).toContainText('Q4 launch plan (revision 11)');
    await banner.getByRole('link', { name: 'Open the copy' }).click();
    await expect(page).toHaveURL(/\/d\/c0ffee00-/);
    expect(api.callsTo('POST', /\/history\/11\/copy$/)).toHaveLength(1);
  });

  test('offers downloads of the revision and of the audit trail', async ({ page }) => {
    await page.goto(`${HISTORY}?rev=12`);
    await page.getByTestId('download-revision').click();
    const markdown = page.getByRole('menuitem', { name: 'Revision as Markdown' });
    await expect(markdown).toHaveAttribute(
      'href',
      `/api/documents/${DOC_IDS.launch}/history/12/export?format=markdown`,
    );
    await expect(markdown).toHaveAttribute('download', '');
    await page.keyboard.press('Escape');

    await page.getByTestId('export-audit').click();
    await expect(page.getByRole('menuitem', { name: 'Audit trail as CSV' })).toHaveAttribute(
      'href',
      `/api/documents/${DOC_IDS.launch}/history/export?format=csv`,
    );
  });
});

test.describe('access', () => {
  test('a member who cannot manage the document sees no entry and a not-allowed screen', async ({
    page,
    api,
  }) => {
    signedInAs(api, USERS.ben);
    await page.goto(DOC);
    await expect(page.getByTestId('document-header')).toBeVisible();
    await expect(page.getByTestId('open-history')).toHaveCount(0);

    await page.goto(HISTORY);
    await expect(page.getByTestId('history-forbidden')).toContainText(
      'Version history is for administrators',
    );
    expect(api.callsTo('GET', LIST)).toHaveLength(0);
  });
});

test.describe('keyboard and small screens', () => {
  test('moves between rows with the arrow keys and opens one with Enter', async ({ page }) => {
    await page.goto(HISTORY);
    const first = page.locator('[data-history-row]').first();
    await first.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-history-row][data-revision="11"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('[data-history-row][data-revision="11"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('revision-detail')).toContainText('Revision 11');
    await expect(page.locator('[data-history-row][data-revision="11"]')).toHaveAttribute(
      'aria-current',
      'true',
    );
    // Opening a row keeps the keyboard on the timeline.
    await expect(page.locator('[data-history-row][data-revision="11"]')).toBeFocused();
    // Exactly one row is in the tab order.
    await expect(page.locator('[data-history-row][tabindex="0"]')).toHaveCount(1);
  });

  test('fits 320 px wide and shows the revision as its own view', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(HISTORY);
    await expect(page.getByTestId('history-row')).toHaveCount(12);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await expect(page.getByTestId('history-no-selection')).toBeHidden();

    await openRevision(page, 7);
    await expect(page.locator('[data-history-row]').first()).toBeHidden();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(page.getByTestId('revision-preview')).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await page.getByTestId('history-back').click();
    await expect(page.getByTestId('history-row')).toHaveCount(12);
    await expect(page.locator('[data-history-row][data-revision="7"]')).toBeFocused();
  });

  test('has no serious accessibility violations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${HISTORY}?rev=10`);
    await expect(page.getByTestId('diff')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(
      blocking.map((violation) => ({
        rule: violation.id,
        targets: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
      })),
    ).toEqual([]);
  });
});
