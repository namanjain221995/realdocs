import { DOC_IDS, expect, signedInAs, test, USERS } from './support/test';

const panelUrl = `/d/${DOC_IDS.launch}?panel=snapshots`;
const SNAPSHOTS = new RegExp(`^/api/documents/${DOC_IDS.launch}/snapshots$`);

test.beforeEach(({ api }) => {
  signedInAs(api, USERS.asha);
});

test.describe('snapshots panel', () => {
  test('lists named and automatic snapshots', async ({ page }) => {
    await page.goto(`/d/${DOC_IDS.launch}`);
    await page.getByTestId('open-snapshots').click();
    await expect(page).toHaveURL(panelUrl);
    const panel = page.getByTestId('snapshots-panel');
    await expect(panel.getByRole('heading', { level: 2, name: 'Snapshots' })).toBeVisible();

    const rows = panel.getByTestId('snapshot-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Before the pricing rewrite');
    await expect(rows.nth(0)).toContainText('Saved 5 hours ago by Asha Rao');
    await expect(rows.nth(0)).toContainText('47.1 KB');
    await expect(rows.nth(0)).toContainText('Generation 2');
    await expect(rows.nth(0).getByText('Automatic')).toHaveCount(0);

    await expect(rows.nth(1)).toHaveAttribute('data-kind', 'pre_restore');
    await expect(rows.nth(1).getByText('Automatic')).toBeVisible();
    await expect(rows.nth(1)).toContainText('Generation 1');
  });

  test('saves a named snapshot', async ({ page, api }) => {
    await page.goto(panelUrl);
    const form = page.getByTestId('create-snapshot-form');

    // A snapshot needs a name; nothing is sent without one.
    await form.getByRole('button', { name: 'Save snapshot' }).click();
    await expect(form.getByText('Give the snapshot a name.')).toBeVisible();
    expect(api.callsTo('POST', SNAPSHOTS)).toHaveLength(0);

    await form.getByTestId('snapshot-name').fill('  Approved by legal  ');
    await form.getByRole('button', { name: 'Save snapshot' }).click();

    await expect(page.getByText('Saved snapshot “Approved by legal”')).toBeVisible();
    expect(api.callsTo('POST', SNAPSHOTS)[0]?.body).toEqual({ name: 'Approved by legal' });
    const rows = page.getByTestId('snapshot-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toContainText('Approved by legal');
    await expect(form.getByTestId('snapshot-name')).toHaveValue('');
  });

  test('restores only after explaining generations, reconnection and recovery drafts', async ({
    page,
    api,
  }) => {
    await page.goto(panelUrl);
    const target = page.getByTestId('snapshot-row').filter({ hasText: 'First full draft' }).last();
    await target.getByTestId('snapshot-restore').click();

    const confirm = page.getByTestId('restore-confirm');
    await expect(confirm).toContainText('Restore “First full draft”?');
    await expect(confirm).toContainText('starts a new generation of the document');
    await expect(confirm).toContainText('saved first as an automatic snapshot');
    await expect(confirm).toContainText('Everyone who has the document open is reconnected');
    await expect(confirm).toContainText('not merged in and are not discarded');
    await expect(confirm).toContainText('recovery draft');
    // Cancel is the default action.
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(api.callsTo('POST', /\/restore$/)).toHaveLength(0);

    await target.getByTestId('snapshot-restore').click();
    await page
      .getByTestId('restore-confirm')
      .getByRole('button', { name: 'Restore snapshot' })
      .click();
    await expect(page.getByTestId('restore-confirm')).toHaveCount(0);
    await expect(page.getByText('Restored “First full draft”')).toBeVisible();
    await expect(page.getByText('The previous content was kept as')).toBeVisible();

    expect(api.callsTo('POST', /\/restore$/)).toHaveLength(1);
    expect(api.document(DOC_IDS.launch).generation).toBe(3);
    // The state before the restore is now a snapshot of its own, at the top.
    const rows = page.getByTestId('snapshot-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toHaveAttribute('data-kind', 'pre_restore');
    await expect(rows.first()).toContainText('Before restoring “First full draft”');
  });

  test('keeps a failed restore in the dialog and changes nothing', async ({ page, api }) => {
    api.failNext('POST', /\/restore$/, 'storage_unavailable', { requestId: 'req_restore' });
    await page.goto(panelUrl);
    await page.getByTestId('snapshot-restore').first().click();
    const confirm = page.getByTestId('restore-confirm');
    await confirm.getByRole('button', { name: 'Restore snapshot' }).click();
    await expect(confirm.getByRole('alert')).toContainText('cannot reach its storage');
    await expect(confirm.getByRole('alert')).toContainText('Reference req_restore');
    expect(api.document(DOC_IDS.launch).generation).toBe(2);
    await expect(page.getByTestId('snapshot-row')).toHaveCount(3);
  });

  test('deletes a snapshot after confirming', async ({ page, api }) => {
    await page.goto(panelUrl);
    const first = page.getByTestId('snapshot-row').first();
    await first.getByTestId('snapshot-delete').click();
    const confirm = page.getByTestId('delete-snapshot-confirm');
    await expect(confirm).toContainText('Delete snapshot “Before the pricing rewrite”?');
    await expect(confirm).toContainText('The document itself does not change');
    await confirm.getByRole('button', { name: 'Delete snapshot' }).click();
    await expect(page.getByTestId('snapshot-row')).toHaveCount(2);
    expect(api.callsTo('DELETE', /\/snapshots\//)).toHaveLength(1);
  });

  test('has an empty state and an error state', async ({ page, api }) => {
    api.snapshots[DOC_IDS.launch] = [];
    await page.goto(panelUrl);
    await expect(page.getByTestId('snapshots-empty')).toContainText('No snapshots yet');

    api.failNext('GET', SNAPSHOTS, 'internal', { requestId: 'req_snap', times: 3 });
    await page.reload();
    const panel = page.getByTestId('snapshots-panel');
    await expect(panel).toContainText('Snapshots could not be loaded');
    await expect(panel).toContainText('Reference req_snap');
  });

  test('does not offer saving or restoring on an archived document', async ({ page }) => {
    await page.goto(`/d/${DOC_IDS.retro}?panel=snapshots`);
    const panel = page.getByTestId('snapshots-panel');
    await expect(panel).toContainText('This document is archived');
    await expect(panel.getByRole('button', { name: 'Save snapshot' })).toBeDisabled();
  });
});
