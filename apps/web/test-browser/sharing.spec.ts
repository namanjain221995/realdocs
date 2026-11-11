import {
  DOC_IDS,
  expect,
  NOW_MS,
  PUBLIC_ORIGIN,
  SECRETS,
  SHARE_IDS,
  signedInAs,
  storageDump,
  test,
  USERS,
} from './support/test';

const panelUrl = `/d/${DOC_IDS.launch}?panel=share`;
const SHARES = new RegExp(`^/api/documents/${DOC_IDS.launch}/shares$`);
const iso = (offsetMs: number): string => new Date(NOW_MS + offsetMs).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test.beforeEach(({ api }) => {
  signedInAs(api, USERS.asha);
});

test.describe('sharing panel', () => {
  test('opens from the header and keeps people, links and live access apart', async ({
    page,
    api,
  }) => {
    await page.goto(`/d/${DOC_IDS.launch}`);
    await page.getByTestId('open-sharing').click();
    await expect(page).toHaveURL(panelUrl);
    const panel = page.getByTestId('sharing-panel');
    await expect(panel.getByRole('heading', { level: 2, name: 'Share' })).toBeVisible();
    // Focus moved into the panel.
    await expect(panel).toBeFocused();

    const people = panel.getByTestId('members-section');
    const links = panel.getByTestId('shares-section');
    const live = panel.getByTestId('live-section');
    await expect(people.getByRole('heading', { name: 'People' })).toBeVisible();
    await expect(links.getByRole('heading', { name: 'Share links' })).toBeVisible();
    await expect(links).toContainText('independent of the people above');
    await expect(live.getByRole('heading', { name: 'Open right now' })).toBeVisible();

    await expect(people.getByTestId('member-row')).toHaveCount(1);
    await expect(people.getByTestId('member-row')).toContainText('Ben Ortiz');
    await expect(links.locator('[data-share-state="active"]')).toHaveCount(2);
    await expect(live.getByTestId('live-participant')).toHaveCount(4);
    const summary = live.getByTestId('access-summary');
    await expect(summary).toContainText('4 connections');
    await expect(summary).toContainText('1 person added');
    await expect(summary).toContainText('2 active links');
    expect(api.callsTo('GET', /\/access$/).length).toBeGreaterThanOrEqual(1);

    // Escape closes the panel and focus goes back to the button that opened it.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('open-sharing')).toBeFocused();
    await expect(page).toHaveURL(`/d/${DOC_IDS.launch}`);
  });

  test('shows each link with its state, access, expiry, use and connections', async ({ page }) => {
    await page.goto(panelUrl);
    const press = page.locator(`[data-share-id="${SHARE_IDS.press}"]`);
    await expect(press).toContainText('Press preview');
    await expect(press.getByTestId('share-state')).toHaveText('Active');
    await expect(press).toContainText('View only');
    await expect(press).toContainText('Expires in 5 days');
    await expect(press).toContainText('Last used 4 minutes ago');
    await expect(press).toContainText('3 sessions');
    await expect(press).toContainText('2 connected now');

    const reviewers = page.locator(`[data-share-id="${SHARE_IDS.reviewers}"]`);
    await expect(reviewers).toContainText('Can edit');
    await expect(reviewers).toContainText('Never expires');

    // Links that no longer work are listed apart.
    const inactive = page.getByTestId('inactive-links');
    await inactive.locator('summary').click();
    const expired = inactive.locator(`[data-share-id="${SHARE_IDS.expired}"]`);
    await expect(expired.getByTestId('share-state')).toHaveText('Expired');
    await expect(expired).toContainText('Expired 6 days ago');
    const revoked = inactive.locator(`[data-share-id="${SHARE_IDS.revoked}"]`);
    await expect(revoked.getByTestId('share-state')).toHaveText('Revoked');
    await expect(revoked).toContainText('Revoked 9 days ago');
    // A revoked link is final. An expired one can be extended or revoked, but not rotated.
    await expect(revoked.getByTestId('share-actions')).toHaveCount(0);
    await expired.getByTestId('share-actions').click();
    await expect(page.getByRole('menuitem')).toHaveText(['Extend or edit', 'Revoke link']);
  });

  test('extends an expired link so that the same address works again', async ({ page, api }) => {
    await page.goto(panelUrl);
    await page.getByTestId('inactive-links').locator('summary').click();
    const expired = page.locator(`[data-share-id="${SHARE_IDS.expired}"]`);
    await expired.getByTestId('share-actions').click();
    await page.getByRole('menuitem', { name: 'Extend or edit' }).click();

    const dialog = page.getByTestId('edit-link-dialog');
    await expect(dialog.getByRole('heading', { name: 'Extend share link' })).toBeVisible();
    await expect(dialog).toContainText('works again under the same address');
    // A new expiry is preselected; "keep the current one" would keep it expired and is not offered.
    await expect(dialog.getByTestId('share-expiry')).toHaveValue('7d');
    await expect(dialog.getByTestId('share-expiry').locator('option[value="keep"]')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Extend link' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Link extended')).toBeVisible();
    const patch = api.callsTo('PATCH', /\/shares\//);
    expect(patch).toHaveLength(1);
    expect(patch[0]?.path).toBe(`/api/documents/${DOC_IDS.launch}/shares/${SHARE_IDS.expired}`);
    expect(patch[0]?.body).toEqual({ expiresAt: iso(7 * DAY) });
    // It is back among the working links, with the same id.
    const extended = page.locator(`[data-share-id="${SHARE_IDS.expired}"]`);
    await expect(extended).toHaveAttribute('data-share-state', 'active');
    await expect(extended.getByTestId('share-state')).toHaveText('Active');
    await expect(extended).toContainText('Expires in 7 days');
  });

  test('revokes an expired link for good', async ({ page, api }) => {
    await page.goto(panelUrl);
    await page.getByTestId('inactive-links').locator('summary').click();
    await page
      .locator(`[data-share-id="${SHARE_IDS.expired}"]`)
      .getByTestId('share-actions')
      .click();
    await page.getByRole('menuitem', { name: 'Revoke link' }).click();
    const confirm = page.getByTestId('revoke-confirm');
    await expect(confirm).toContainText('can no longer be extended');
    await confirm.getByRole('button', { name: 'Revoke link' }).click();
    await expect(
      page.locator(`[data-share-id="${SHARE_IDS.expired}"]`).getByTestId('share-state'),
    ).toHaveText('Revoked');
    expect(api.callsTo('POST', /\/revoke$/)).toHaveLength(1);
  });

  test('creates a view-only link by default and shows its address exactly once', async ({
    page,
    api,
  }) => {
    await page.goto(panelUrl);
    await page.getByTestId('new-link').click();
    const form = page.getByTestId('create-link-form');
    // View only is preselected; nothing warns about editing.
    await expect(form.getByRole('radio', { name: 'View only' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(form.getByRole('radio', { name: 'Can edit' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(form.getByTestId('edit-link-warning')).toHaveCount(0);
    await expect(form.getByTestId('share-expiry')).toHaveValue('7d');

    await form.getByTestId('create-link-submit').click();

    const created = api.callsTo('POST', SHARES);
    expect(created).toHaveLength(1);
    expect(created[0]?.body).toEqual({ role: 'viewer', label: '', expiresAt: iso(7 * DAY) });

    const callout = page.getByTestId('new-share-link');
    await expect(callout).toContainText('Link created. Copy it now');
    await expect(callout).toContainText('only time the full link is shown');
    await expect(callout).toContainText('rotate the link to get a new one');
    const field = callout.getByTestId('new-share-url');
    // Hidden until asked for, in case the screen is being shared.
    await expect(field).not.toHaveValue(new RegExp(SECRETS.share));
    await callout.getByRole('button', { name: 'Show' }).click();
    await expect(field).toHaveValue(
      new RegExp(`^${PUBLIC_ORIGIN}/s/[0-9a-f-]{36}#${SECRETS.share}$`),
    );

    // The new link is in the list, and the full address is nowhere but in that field.
    await expect(page.locator('[data-share-state="active"]')).toHaveCount(3);
    expect(page.url()).not.toContain(SECRETS.share);
    expect(await storageDump(page)).not.toContain(SECRETS.share);

    await callout.getByTestId('new-share-done').click();
    await expect(callout).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(SECRETS.share);
    expect(await page.content()).not.toContain(SECRETS.share);
  });

  test('copies the new link to the clipboard', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Clipboard permissions can only be granted in Chromium.');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(panelUrl);
    await page.getByTestId('new-link').click();
    await page.getByTestId('create-link-submit').click();
    await page.getByTestId('new-share-link').getByRole('button', { name: 'Copy' }).click();
    await expect(
      page.getByTestId('new-share-link').getByRole('button', { name: 'Copied' }),
    ).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(new RegExp(`^${PUBLIC_ORIGIN}/s/[0-9a-f-]{36}#${SECRETS.share}$`));
  });

  test('makes edit access an explicit, warned choice', async ({ page, api }) => {
    await page.goto(panelUrl);
    await page.getByTestId('new-link').click();
    const form = page.getByTestId('create-link-form');
    await form.getByRole('radio', { name: 'Can edit' }).click();
    await expect(form.getByTestId('edit-link-warning')).toContainText(
      'Anyone who gets this link can change the document',
    );
    await form.getByTestId('share-label').fill('Copy editors');
    await form.getByTestId('share-expiry').selectOption('1h');
    await form.getByTestId('create-link-submit').click();
    await expect(page.getByTestId('new-share-link')).toBeVisible();
    expect(api.callsTo('POST', SHARES)[0]?.body).toEqual({
      role: 'editor',
      label: 'Copy editors',
      expiresAt: iso(HOUR),
    });
  });

  test('offers every expiry preset, including a custom time and never', async ({ page, api }) => {
    await page.goto(panelUrl);
    const options = async (): Promise<string[]> => {
      await page.getByTestId('new-link').click();
      return page.getByTestId('share-expiry').locator('option').allTextContents();
    };
    expect(await options()).toEqual([
      '1 hour',
      '1 day',
      '7 days',
      '30 days',
      'Custom date and time',
      'Never',
    ]);

    const form = page.getByTestId('create-link-form');
    await form.getByTestId('share-expiry').selectOption('never');
    await form.getByTestId('create-link-submit').click();
    await expect(page.getByTestId('new-share-link')).toBeVisible();
    expect(api.callsTo('POST', SHARES).at(-1)?.body).toMatchObject({ expiresAt: null });

    await page.getByTestId('new-share-done').click();
    await page.getByTestId('new-link').click();
    await form.getByTestId('share-expiry').selectOption('custom');
    // A custom expiry has to be chosen, and has to be in the future.
    await form.getByTestId('create-link-submit').click();
    await expect(form.getByText('Choose a date and time.')).toBeVisible();
    await form.getByTestId('share-expiry-custom').fill('2026-11-01T09:00');
    await form.getByTestId('create-link-submit').click();
    await expect(form.getByText('Choose a time in the future.')).toBeVisible();
    expect(api.callsTo('POST', SHARES)).toHaveLength(1);

    // The browser runs in UTC in these tests, so local time is UTC.
    await form.getByTestId('share-expiry-custom').fill('2026-12-24T18:30');
    await form.getByTestId('create-link-submit').click();
    await expect(page.getByTestId('new-share-link')).toBeVisible();
    expect(api.callsTo('POST', SHARES).at(-1)?.body).toMatchObject({
      expiresAt: '2026-12-24T18:30:00.000Z',
    });
  });

  test('revokes a link only after a confirmation that says what revoking does', async ({
    page,
    api,
  }) => {
    await page.goto(panelUrl);
    const press = page.locator(`[data-share-id="${SHARE_IDS.press}"]`);
    await press.getByTestId('share-actions').click();
    await page.getByRole('menuitem', { name: 'Revoke link' }).click();

    const confirm = page.getByTestId('revoke-confirm');
    await expect(confirm).toContainText('Revoke this link?');
    await expect(confirm).toContainText('everyone using it right now is disconnected');
    await expect(confirm).toContainText(
      'cannot take back what people have already seen, copied or downloaded',
    );
    await expect(confirm).toContainText('the people you added keep their access');
    // The safe choice has focus.
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(api.callsTo('POST', /\/revoke$/)).toHaveLength(0);
    await expect(press.getByTestId('share-state')).toHaveText('Active');

    await press.getByTestId('share-actions').click();
    await page.getByRole('menuitem', { name: 'Revoke link' }).click();
    await page.getByTestId('revoke-confirm').getByRole('button', { name: 'Revoke link' }).click();
    await expect(page.getByTestId('revoke-confirm')).toHaveCount(0);
    await expect(page.getByText('Link revoked')).toBeVisible();

    expect(api.callsTo('POST', /\/revoke$/)[0]?.path).toBe(
      `/api/documents/${DOC_IDS.launch}/shares/${SHARE_IDS.press}/revoke`,
    );
    await expect(page.locator('[data-share-state="active"]')).toHaveCount(1);
    await page.getByTestId('inactive-links').locator('summary').click();
    await expect(
      page.locator(`[data-share-id="${SHARE_IDS.press}"]`).getByTestId('share-state'),
    ).toHaveText('Revoked');
    // The member is untouched: links and people are independent.
    await expect(page.getByTestId('member-row')).toHaveCount(1);
  });

  test('keeps a failed revoke in the dialog', async ({ page, api }) => {
    api.failNext('POST', /\/revoke$/, 'server_busy', { requestId: 'req_revoke' });
    await page.goto(panelUrl);
    await page.locator(`[data-share-id="${SHARE_IDS.press}"]`).getByTestId('share-actions').click();
    await page.getByRole('menuitem', { name: 'Revoke link' }).click();
    const confirm = page.getByTestId('revoke-confirm');
    await confirm.getByRole('button', { name: 'Revoke link' }).click();
    await expect(confirm.getByRole('alert')).toContainText('The server is busy');
    await expect(confirm.getByRole('alert')).toContainText('Reference req_revoke');
    await expect(
      page.locator(`[data-share-id="${SHARE_IDS.press}"]`).getByTestId('share-state'),
    ).toHaveText('Active');
  });

  test('rotates a link: the old one stops working and a new address is shown once', async ({
    page,
    api,
  }) => {
    await page.goto(panelUrl);
    await page
      .locator(`[data-share-id="${SHARE_IDS.reviewers}"]`)
      .getByTestId('share-actions')
      .click();
    await page.getByRole('menuitem', { name: 'Rotate link' }).click();
    const confirm = page.getByTestId('rotate-confirm');
    await expect(confirm).toContainText('current link stops working at once');
    await confirm.getByRole('button', { name: 'Rotate link' }).click();

    const callout = page.getByTestId('new-share-link');
    await expect(callout).toContainText('Link rotated. Copy the new link now');
    await callout.getByRole('button', { name: 'Show' }).click();
    await expect(callout.getByTestId('new-share-url')).toHaveValue(
      new RegExp(`#${SECRETS.share}$`),
    );
    expect(api.callsTo('POST', /\/rotate$/)).toHaveLength(1);

    // Same access and label on the replacement; the old grant is revoked.
    const active = page.locator('[data-share-state="active"]');
    await expect(active).toHaveCount(2);
    await expect(active.filter({ hasText: 'External reviewers' })).toContainText('Can edit');
    await page.getByTestId('inactive-links').locator('summary').click();
    await expect(
      page.locator(`[data-share-id="${SHARE_IDS.reviewers}"]`).getByTestId('share-state'),
    ).toHaveText('Revoked');
  });

  test('changes access, label and expiry of an existing link', async ({ page, api }) => {
    await page.goto(panelUrl);
    const reviewers = page.locator(`[data-share-id="${SHARE_IDS.reviewers}"]`);
    await reviewers.getByTestId('share-actions').click();
    await page.getByRole('menuitem', { name: 'Edit access and expiry' }).click();

    const dialog = page.getByTestId('edit-link-dialog');
    await expect(dialog.getByRole('radio', { name: 'Can edit' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(dialog.getByTestId('share-expiry')).toHaveValue('keep');
    await dialog.getByRole('radio', { name: 'View only' }).click();
    await dialog.getByTestId('share-expiry').selectOption('30d');
    await dialog.getByRole('button', { name: 'Save changes' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(reviewers).toContainText('View only');
    await expect(reviewers).toContainText('Expires in 30 days');
    const update = api.callsTo('PATCH', /\/shares\//);
    // Only what changed is sent.
    expect(update[0]?.body).toEqual({ role: 'viewer', expiresAt: iso(30 * DAY) });
  });

  test('adds a person as a viewer unless told otherwise, and changes or removes them', async ({
    page,
    api,
  }) => {
    await page.goto(panelUrl);
    const form = page.getByTestId('add-member-form');
    await expect(form.getByTestId('add-member-select')).toBeVisible();
    // People who are already members, and disabled accounts, are not offered.
    const offered = await form
      .getByTestId('add-member-select')
      .locator('option:not([disabled])')
      .allTextContents();
    expect(offered).toEqual([
      'Asha Rao (asha.rao@northwind.example), administrator',
      'Chen Wei (chen.wei@northwind.example)',
    ]);
    await expect(form.getByRole('radio', { name: 'View only' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Nothing is sent until an account is chosen.
    await form.getByRole('button', { name: 'Add' }).click();
    await expect(form.getByText('Choose an account.')).toBeVisible();

    await form.getByTestId('add-member-select').selectOption(USERS.chen.id);
    await form.getByRole('button', { name: 'Add' }).click();
    const chen = page.locator(`[data-user-id="${USERS.chen.id}"]`);
    await expect(chen).toContainText('Chen Wei');
    const added = api.callsTo('PUT', /\/members\//);
    expect(added[0]?.path).toBe(`/api/documents/${DOC_IDS.launch}/members/${USERS.chen.id}`);
    expect(added[0]?.body).toEqual({ role: 'viewer' });

    await chen.getByLabel('Access for Chen Wei').selectOption('editor');
    await expect(page.getByText('Chen Wei: can edit')).toBeVisible();
    expect(api.callsTo('PUT', /\/members\//)[1]?.body).toEqual({ role: 'editor' });

    await chen.getByRole('button', { name: 'Remove Chen Wei' }).click();
    await expect(chen).toHaveCount(0);
    expect(api.callsTo('DELETE', /\/members\//)).toHaveLength(1);
    // Undo puts them back with the access they had.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(chen).toBeVisible();
    await expect(chen.getByLabel('Access for Chen Wei')).toHaveValue('editor');
  });

  test('refreshes who is connected while the panel is open', async ({ page, api }) => {
    await page.goto(panelUrl);
    const live = page.getByTestId('live-section');
    await expect(live.getByTestId('live-participant')).toHaveCount(4);
    api.live[DOC_IDS.launch] = (api.live[DOC_IDS.launch] ?? []).slice(0, 1);
    await live.getByRole('button', { name: 'Refresh' }).click();
    await expect(live.getByTestId('live-participant')).toHaveCount(1);
    await expect(live.getByTestId('access-summary')).toContainText('1 connection');
  });

  test('explains a failure to load and retries', async ({ page, api }) => {
    api.failNext('GET', /\/access$/, 'internal', { requestId: 'req_access', times: 3 });
    await page.goto(panelUrl);
    const panel = page.getByTestId('sharing-panel');
    await expect(panel).toContainText('Sharing could not be loaded');
    await expect(panel).toContainText('Reference req_access');
    await panel.getByRole('button', { name: 'Try again' }).click();
    await expect(panel.getByTestId('member-row')).toHaveCount(1);
  });

  test('becomes a full-screen sheet on a narrow screen and keeps focus inside', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/d/${DOC_IDS.launch}`);
    await page.getByTestId('open-sharing').click();
    const panel = page.getByTestId('sharing-panel');
    await expect(panel).toHaveAttribute('data-mode', 'sheet');
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    const box = await panel.boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, width: 360, height: 740 });

    // Tabbing backwards from the first control wraps to the last one inside the sheet.
    await panel.getByRole('button', { name: 'Close share' }).focus();
    await page.keyboard.press('Shift+Tab');
    expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('keeps a freshly created link when the window changes size', async ({ page }) => {
    await page.goto(panelUrl);
    await page.getByTestId('new-link').click();
    await page.getByTestId('create-link-submit').click();
    await expect(page.getByTestId('new-share-link')).toBeVisible();
    // Rotating a tablet turns the docked panel into a sheet; the link must survive.
    await page.setViewportSize({ width: 600, height: 900 });
    await expect(page.getByTestId('sharing-panel')).toHaveAttribute('data-mode', 'sheet');
    await expect(page.getByTestId('new-share-link')).toBeVisible();
  });
});
