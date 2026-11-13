import { DOC_IDS, expect, NOW_MS, signedInAs, test, USERS } from './support/test';

const LIST = /^\/api\/documents$/;
const rows = 'document-row';

test.describe('dashboard for an administrator', () => {
  test.beforeEach(({ api }) => {
    signedInAs(api, USERS.asha);
  });

  test('shows a skeleton while loading, then the documents', async ({ page, api }) => {
    const release = api.holdNext('GET', LIST);
    await page.goto('/documents');
    await expect(page.getByTestId('documents-loading')).toBeVisible();
    await expect(page.getByTestId(rows)).toHaveCount(0);
    release();
    await expect(page.getByTestId(rows)).toHaveCount(5);
    await expect(page.getByTestId('documents-loading')).toHaveCount(0);
    await expect(page).toHaveTitle('Documents – RealtimeDocs');
  });

  test('lists each view with its own timestamps', async ({ page, api }) => {
    await page.goto('/documents');
    const first = page.getByTestId(rows).first();
    await expect(first).toContainText('Q4 launch plan');
    await expect(first).toContainText('Edited 5 minutes ago');
    await expect(first.getByText('Admin', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Archived' }).click();
    await expect(page).toHaveURL('/documents?view=archived');
    await expect(page.getByTestId(rows)).toHaveCount(1);
    await expect(page.getByTestId(rows).first()).toContainText('Archived 6 days ago');

    await page.getByRole('tab', { name: 'Trash' }).click();
    await expect(page.getByTestId(rows)).toHaveCount(2);
    await expect(page.getByTestId(rows).nth(0)).toContainText('Deleted permanently in 28 days');
    await expect(page.getByTestId(rows).nth(1)).toContainText('Deleted permanently in 2 days');
    // Nobody can open a trashed document, so its title is not a link.
    await expect(page.getByTestId(rows).first().getByRole('link')).toHaveCount(0);

    // Recent: the active documents again, by their latest change of any kind. The pricing
    // document was renamed a minute ago: that is its latest change, and the row says so.
    api.document(DOC_IDS.pricing).updatedAt = new Date(NOW_MS - 60_000).toISOString();
    await page.getByRole('tab', { name: 'Recent' }).click();
    await expect(page.getByTestId(rows)).toHaveCount(5);
    await expect(page.getByTestId(rows).first()).toContainText('Pricing questions and answers');
    await expect(page.getByTestId(rows).first()).toContainText('Updated 1 minute ago');
    await expect(page.getByTestId(rows).nth(1)).toContainText('Q4 launch plan');
    await expect(page.getByTestId(rows).nth(1)).toContainText('Edited 5 minutes ago');
    // Archived and trashed documents are not recent activity.
    await expect(page.locator(`[data-document-id="${DOC_IDS.retro}"]`)).toHaveCount(0);

    const views = api.callsTo('GET', LIST).map((call) => call.search);
    expect(views).toEqual(['?view=active', '?view=archived', '?view=trash', '?view=recent']);
  });

  test('lists the active documents by their latest change, whatever order the server used', async ({
    page,
    api,
  }) => {
    // The server orders this view by the time of the last title or state change.
    // The board notes were edited a minute ago, which that clock does not show.
    api.document(DOC_IDS.board).contentUpdatedAt = new Date(NOW_MS - 60_000).toISOString();
    await page.goto('/documents');
    await expect(page.getByTestId(rows)).toHaveCount(5);
    await expect(page.getByTestId(rows).first()).toContainText('Board meeting notes, November');
    await expect(page.getByTestId(rows).first()).toContainText('Edited 1 minute ago');
    await expect(page.getByTestId(rows).nth(1)).toContainText('Q4 launch plan');
    // Every row's time is no later than the one above it.
    const times = await page
      .getByTestId(rows)
      .locator('time')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('datetime')));
    expect(times).toEqual([...times].sort().reverse());
  });

  test('searches after a pause, not on every key', async ({ page, api }) => {
    await page.goto('/documents');
    await expect(page.getByTestId(rows)).toHaveCount(5);
    const before = api.callsTo('GET', LIST).length;

    await page.getByTestId('document-search').pressSequentially('pricing', { delay: 20 });
    await expect(page.getByTestId(rows)).toHaveCount(1);
    await expect(page.getByTestId(rows).first()).toContainText('Pricing questions and answers');
    await expect(page).toHaveURL('/documents?q=pricing');
    // Typing seven letters must not mean seven requests.
    const searches = api.callsTo('GET', LIST).slice(before);
    expect(searches.length).toBeLessThanOrEqual(2);
    expect(searches.at(-1)?.search).toBe('?view=active&q=pricing');
    // Focus stays in the field while the list updates.
    await expect(page.getByTestId('document-search')).toBeFocused();
  });

  test('offers a way out when nothing matches', async ({ page }) => {
    await page.goto('/documents?view=archived&q=budget');
    const empty = page.getByTestId('documents-no-results');
    await expect(empty).toContainText('No documents match “budget”');
    await expect(empty).toContainText('titles in Archived only');
    await empty.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByTestId(rows)).toHaveCount(1);
    await expect(page.getByTestId('document-search')).toHaveValue('');
  });

  test('has a useful empty state for every view', async ({ page, api }) => {
    api.documents = [];
    await page.goto('/documents');
    await expect(page.getByTestId('documents-empty')).toContainText('No documents yet');
    await expect(
      page.getByTestId('documents-empty').getByRole('button', { name: 'New document' }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Recent' }).click();
    await expect(page.getByTestId('documents-empty')).toContainText('No recent activity');
    await page.getByRole('tab', { name: 'Archived' }).click();
    await expect(page.getByTestId('documents-empty')).toContainText('No archived documents');
    await page.getByRole('tab', { name: 'Trash' }).click();
    await expect(page.getByTestId('documents-empty')).toContainText('Trash is empty');
  });

  test('shows an error with the server reference and recovers on retry', async ({ page, api }) => {
    // Three failures: the first attempt and both automatic retries.
    api.failNext('GET', LIST, 'internal', { requestId: 'req_dash_1', times: 3 });
    await page.goto('/documents');
    const error = page.getByTestId('documents-error');
    await expect(error).toContainText('The server is not responding');
    await expect(error).toContainText('Reference req_dash_1');
    expect(api.callsTo('GET', LIST)).toHaveLength(3);

    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId(rows)).toHaveCount(5);
  });

  test('does not retry a request the server refused', async ({ page, api }) => {
    api.failNext('GET', LIST, 'forbidden', { times: 5 });
    await page.goto('/documents');
    await expect(page.getByTestId('documents-error')).toHaveAttribute(
      'data-error-kind',
      'forbidden',
    );
    expect(api.callsTo('GET', LIST)).toHaveLength(1);
  });

  test('creates a document and opens it', async ({ page, api }) => {
    await page.goto('/documents');
    await page.getByTestId('new-document').click();
    await expect(page).toHaveURL(/\/d\/c0ffee00-/);
    await expect(page.getByTestId('document-title')).toHaveText('Untitled document');
    expect(api.callsTo('POST', LIST)[0]?.body).toEqual({});
  });

  test('renames a document at once and keeps the name after the server answers', async ({
    page,
    api,
  }) => {
    await page.goto('/documents');
    const release = api.holdNext('PATCH', new RegExp(`^/api/documents/${DOC_IDS.board}$`));
    const row = page.locator(`[data-document-id="${DOC_IDS.board}"]`);
    await row.getByTestId('row-actions').click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();

    const field = page.getByRole('dialog', { name: 'Rename document' }).getByLabel('Title');
    await expect(field).toHaveValue('Board meeting notes, November');
    await field.fill('Board notes, November');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();

    // Shown before the server has answered.
    await expect(row).toContainText('Board notes, November');
    release();
    await expect(row).toContainText('Board notes, November');
    expect(api.callsTo('PATCH', /^\/api\/documents\//)[0]?.body).toEqual({
      title: 'Board notes, November',
    });
  });

  test('puts the old name back when a rename is refused', async ({ page, api }) => {
    await page.goto('/documents');
    api.failNext('PATCH', /^\/api\/documents\//, 'conflict', {
      message: 'Another administrator renamed this document a moment ago.',
      requestId: 'req_rename',
    });
    const row = page.locator(`[data-document-id="${DOC_IDS.board}"]`);
    await row.getByTestId('row-actions').click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByRole('dialog').getByLabel('Title').fill('A name that will not stick');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();

    await expect(page.getByText('Could not rename the document')).toBeVisible();
    await expect(page.getByText('Reference req_rename')).toBeVisible();
    await expect(row).toContainText('Board meeting notes, November');
  });

  test('duplicates, archives with undo, and moves to trash', async ({ page, api }) => {
    await page.goto('/documents');
    const row = page.locator(`[data-document-id="${DOC_IDS.pricing}"]`);

    await row.getByTestId('row-actions').click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(
      page.getByText('Duplicated as “Copy of Pricing questions and answers'),
    ).toBeVisible();
    await expect(page.getByTestId(rows)).toHaveCount(6);

    await row.getByTestId('row-actions').click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(row).toHaveCount(1);
    expect(api.document(DOC_IDS.pricing).status).toBe('active');

    await row.getByTestId('row-actions').click();
    await page.getByRole('menuitem', { name: 'Move to trash' }).click();
    await expect(row).toHaveCount(0);
    expect(api.document(DOC_IDS.pricing).status).toBe('trashed');
    await page.getByRole('tab', { name: 'Trash' }).click();
    await expect(row).toBeVisible();
  });

  test('restores from trash, and deletes permanently only after confirming', async ({
    page,
    api,
  }) => {
    await page.goto('/documents?view=trash');
    const old = page.locator(`[data-document-id="${DOC_IDS.oldPlan}"]`);
    const scratch = page.locator(`[data-document-id="${DOC_IDS.scratch}"]`);

    await old.getByTestId('row-actions').click();
    await page.getByRole('menuitem', { name: 'Restore' }).click();
    await expect(old).toHaveCount(0);
    expect(api.document(DOC_IDS.oldPlan).status).toBe('active');

    await scratch.getByTestId('row-actions').click();
    await page.getByRole('menuitem', { name: 'Delete permanently' }).click();
    const confirm = page.getByTestId('delete-confirm');
    await expect(confirm).toContainText('Delete “Scratch notes” permanently?');
    await expect(confirm).toContainText('cannot be undone');
    // Cancelling changes nothing.
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(scratch).toBeVisible();
    expect(api.callsTo('DELETE', /^\/api\/documents\//)).toHaveLength(0);

    await scratch.getByTestId('row-actions').click();
    await page.getByRole('menuitem', { name: 'Delete permanently' }).click();
    await page
      .getByTestId('delete-confirm')
      .getByRole('button', { name: 'Delete permanently' })
      .click();
    await expect(scratch).toHaveCount(0);
    await expect(page.getByTestId('documents-empty')).toContainText('Trash is empty');
    expect(api.callsTo('DELETE', /^\/api\/documents\//)).toHaveLength(1);
  });

  test('keeps a failed permanent delete inside the dialog', async ({ page, api }) => {
    api.failNext('DELETE', /^\/api\/documents\//, 'internal', { requestId: 'req_del' });
    await page.goto('/documents?view=trash');
    await page
      .locator(`[data-document-id="${DOC_IDS.scratch}"]`)
      .getByTestId('row-actions')
      .click();
    await page.getByRole('menuitem', { name: 'Delete permanently' }).click();
    const confirm = page.getByTestId('delete-confirm');
    await confirm.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(confirm.getByRole('alert')).toContainText('Reference req_del');
    await expect(page.locator(`[data-document-id="${DOC_IDS.scratch}"]`)).toBeVisible();
  });
});

test.describe('dashboard for a member', () => {
  test.beforeEach(({ api }) => {
    signedInAs(api, USERS.ben);
  });

  test('shows only what the server returns, with the role on each document', async ({ page }) => {
    await page.goto('/documents');
    await expect(page.getByTestId(rows)).toHaveCount(2);
    await expect(
      page.locator(`[data-document-id="${DOC_IDS.launch}"]`).getByText('Editor', { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(`[data-document-id="${DOC_IDS.board}"]`).getByText('Viewer', { exact: true }),
    ).toBeVisible();
  });

  test('offers no administrator actions', async ({ page }) => {
    await page.goto('/documents');
    await expect(page.getByTestId(rows)).toHaveCount(2);
    await expect(page.getByTestId('new-document')).toHaveCount(0);
    await expect(page.getByTestId('row-actions')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Trash' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'People' })).toHaveCount(0);
    // Asking for the trash by address falls back to the active view.
    await page.goto('/documents?view=trash');
    await expect(page.getByRole('tab', { name: 'Active' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('explains an empty list without offering to create', async ({ page, api }) => {
    api.members = {};
    await page.goto('/documents');
    const empty = page.getByTestId('documents-empty');
    await expect(empty).toContainText('Nothing has been shared with you yet');
    await expect(empty.getByRole('button')).toHaveCount(0);
  });
});
