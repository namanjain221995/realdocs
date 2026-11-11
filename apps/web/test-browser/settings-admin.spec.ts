import {
  expect,
  INVITATION_IDS,
  PASSWORDS,
  PUBLIC_ORIGIN,
  SECRETS,
  signedInAs,
  storageDump,
  test,
  USERS,
} from './support/test';

test.describe('settings', () => {
  test.beforeEach(({ api }) => {
    signedInAs(api, USERS.ben);
  });

  test('changes the display name and shows it at once', async ({ page, api }) => {
    await page.goto('/settings');
    const form = page.getByTestId('profile-form');
    await expect(form.getByRole('button', { name: 'Save name' })).toBeDisabled();
    await expect(form).toContainText(USERS.ben.email);

    await form.getByLabel('Name').fill('Benjamin Ortiz');
    await form.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByText('Name updated')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Account menu for Benjamin Ortiz' }),
    ).toBeVisible();
    expect(api.callsTo('PATCH', /^\/api\/auth\/profile$/)[0]?.body).toEqual({
      displayName: 'Benjamin Ortiz',
    });
  });

  test('changes the password, checking the current one and the new one', async ({ page, api }) => {
    await page.goto('/settings');
    const form = page.getByTestId('password-form');
    const current = form.getByLabel('Current password');
    const next = form.getByLabel('New password', { exact: true });
    const confirm = form.getByLabel('Confirm new password');

    await form.getByRole('button', { name: 'Change password' }).click();
    await expect(form.getByText('Enter your current password.')).toBeVisible();
    await expect(form.getByText('Choose a password.')).toBeVisible();

    await current.fill('not my password at all');
    await next.fill('a brand new passphrase 77');
    await confirm.fill('a brand new passphrase 77');
    await form.getByRole('button', { name: 'Change password' }).click();
    await expect(form.getByText('That is not your current password.')).toBeVisible();

    await current.fill(PASSWORDS[USERS.ben.email] ?? '');
    await form.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Password changed')).toBeVisible();
    await expect(page.getByText('Every other browser and device was signed out')).toBeVisible();
    await expect(current).toHaveValue('');
    expect(api.callsTo('POST', /^\/api\/auth\/password$/)).toHaveLength(2);
    // Still signed in here.
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  });

  test('switches the theme and remembers it', async ({ page }) => {
    await page.goto('/settings');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    const theme = page.getByRole('radiogroup', { name: 'Theme' });
    await theme.getByRole('radio', { name: 'Light' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(
      page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' }),
    ).toHaveAttribute('aria-checked', 'true');

    // "System" follows the operating system setting.
    await page
      .getByRole('radiogroup', { name: 'Theme' })
      .getByRole('radio', { name: 'System' })
      .click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(html).toHaveAttribute('data-theme', 'light');
  });

  test('lists recovery drafts (none yet) and links straight to that section', async ({ page }) => {
    await page.goto('/settings#recovery-drafts');
    const section = page.locator('#recovery-drafts');
    await expect(
      section.getByRole('heading', { name: 'Recovery drafts', exact: true }),
    ).toBeVisible();
    await expect(section.getByTestId('drafts-empty')).toContainText(
      'No recovery drafts on this device',
    );
    await expect(section).toBeInViewport();
  });

  test('treats a refusal that is not about the current password as a failure, not as a typo', async ({
    page,
    api,
  }) => {
    // The server names the field when the current password is wrong; anything else is not that.
    api.failNext('POST', /^\/api\/auth\/password$/, 'forbidden', { requestId: 'req_pw' });
    await page.goto('/settings');
    const form = page.getByTestId('password-form');
    await form.getByLabel('Current password').fill(PASSWORDS[USERS.ben.email] ?? '');
    await form.getByLabel('New password', { exact: true }).fill('a brand new passphrase 77');
    await form.getByLabel('Confirm new password').fill('a brand new passphrase 77');
    await form.getByRole('button', { name: 'Change password' }).click();
    await expect(form.getByRole('alert')).toContainText('Reference req_pw');
    await expect(form.getByText('That is not your current password.')).toHaveCount(0);
  });

  test('signs out every other session and stays signed in here', async ({ page, api }) => {
    await page.goto('/settings');
    const info = page.getByTestId('session-info');
    await expect(info).toContainText('ends your sessions in other browsers and the desktop apps');
    await info.getByTestId('sign-out-everywhere-else').click();
    await expect(page.getByText('Signed out 2 other sessions')).toBeVisible();
    await expect(page.getByText('have to sign in again')).toBeVisible();
    const calls = api.callsTo('POST', /^\/api\/auth\/sessions\/revoke-others$/);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers['x-rd-csrf']).toBe(`csrf-${USERS.ben.id.slice(0, 8)}`);
    // This browser is still signed in, and nothing local was touched.
    await expect(info).toContainText('Signed in as Ben Ortiz');
    expect(api.callsTo('POST', /^\/api\/auth\/logout$/)).toHaveLength(0);

    // A second press has nothing left to end, and says so.
    await info.getByTestId('sign-out-everywhere-else').click();
    await expect(page.getByText('No other session was signed in')).toBeVisible();
  });

  test('names a single other session in the singular', async ({ page, api }) => {
    api.otherSessions = 1;
    await page.goto('/settings');
    await page.getByTestId('sign-out-everywhere-else').click();
    await expect(page.getByText('Signed out 1 other session', { exact: true })).toBeVisible();
  });

  test('says so when the other sessions could not be signed out', async ({ page, api }) => {
    api.failNext('POST', /^\/api\/auth\/sessions\/revoke-others$/, 'storage_unavailable', {
      requestId: 'req_revoke_others',
    });
    await page.goto('/settings');
    await page.getByTestId('sign-out-everywhere-else').click();
    await expect(page.getByText('Could not sign out the other sessions')).toBeVisible();
    await expect(page.getByText('Reference req_revoke_others')).toBeVisible();
  });

  test('signs out, forgets what was loaded, and shows the sign-in screen', async ({
    page,
    api,
  }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('session-info')).toContainText('Signed in as Ben Ortiz');
    await page.getByTestId('settings-sign-out').click();

    await expect(page).toHaveURL('/login');
    await expect(page.getByText('Signed out', { exact: true })).toBeVisible();
    await expect(page.getByTestId('session-expired-notice')).toHaveCount(0);
    const logout = api.callsTo('POST', /^\/api\/auth\/logout$/);
    expect(logout).toHaveLength(1);
    // The request carried the session's CSRF token.
    expect(logout[0]?.headers['x-rd-csrf']).toBe(`csrf-${USERS.ben.id.slice(0, 8)}`);

    // Signed-in pages are closed again.
    await page.goto('/settings');
    await expect(page).toHaveURL('/login?next=%2Fsettings');
  });

  test('stays signed in and says so when the server cannot be reached', async ({ page, api }) => {
    api.abortNext('POST', /^\/api\/auth\/logout$/);
    await page.goto('/settings');
    await page.getByTestId('settings-sign-out').click();
    await expect(page.getByText('Could not sign out')).toBeVisible();
    await expect(page.getByText('You are still signed in.')).toBeVisible();
    await expect(page).toHaveURL('/settings');
  });

  test('signs out from the account menu too', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Account menu for Ben Ortiz' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('ben.ortiz@northwind.example');
    await expect(menu).toContainText('Member');
    await menu.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/login');
  });
});

test.describe('people (administrators)', () => {
  test.beforeEach(({ api }) => {
    signedInAs(api, USERS.asha);
  });

  test('lists accounts and protects the administrator from locking themselves out', async ({
    page,
  }) => {
    await page.goto('/admin/users');
    await expect(page.getByTestId('account-row')).toHaveCount(4);
    const self = page.locator(`[data-user-id="${USERS.asha.id}"]`);
    await expect(self).toContainText('You');
    await expect(self.getByTestId('account-role')).toBeDisabled();
    await expect(self.getByTestId('account-status')).toBeDisabled();
    await expect(self).toContainText('You cannot change your own role or disable your own account');

    const ben = page.locator(`[data-user-id="${USERS.ben.id}"]`);
    await expect(ben.getByTestId('account-role')).toBeEnabled();
    await expect(ben.getByTestId('account-role')).toHaveValue('member');
    await expect(ben.getByTestId('account-status')).toBeChecked();
    await expect(
      page.locator(`[data-user-id="${USERS.dana.id}"]`).getByTestId('account-status'),
    ).not.toBeChecked();
  });

  test('promotes after a confirmation and demotes directly', async ({ page, api }) => {
    await page.goto('/admin/users');
    const ben = page.locator(`[data-user-id="${USERS.ben.id}"]`);
    await ben.getByTestId('account-role').selectOption('admin');
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Make Ben Ortiz an administrator?');
    await expect(confirm).toContainText('open and manage every document');
    await confirm.getByRole('button', { name: 'Make administrator' }).click();
    await expect(ben.getByTestId('account-role')).toHaveValue('admin');
    expect(api.callsTo('PATCH', /^\/api\/users\//)[0]?.body).toEqual({ role: 'admin' });

    await ben.getByTestId('account-role').selectOption('member');
    await expect(page.getByText('Ben Ortiz is now a member')).toBeVisible();
    expect(api.callsTo('PATCH', /^\/api\/users\//)[1]?.body).toEqual({ role: 'member' });
  });

  test('disables an account after a confirmation and enables it directly', async ({
    page,
    api,
  }) => {
    await page.goto('/admin/users');
    const chen = page.locator(`[data-user-id="${USERS.chen.id}"]`);
    // Once with the pointer...
    await chen.getByTestId('account-status').click();
    const confirm = page.getByTestId('disable-confirm');
    await expect(confirm).toContainText('Disable Chen Wei’s account?');
    await expect(confirm).toContainText('signed out everywhere');
    await confirm.getByRole('button', { name: 'Disable account' }).click();
    await expect(chen.getByTestId('account-status')).not.toBeChecked();
    await expect(chen).toContainText('Disabled');
    expect(api.callsTo('PATCH', /^\/api\/users\//)[0]?.body).toEqual({ status: 'disabled' });

    // ...and once from the keyboard, the way a switch is also meant to work.
    const dana = page.locator(`[data-user-id="${USERS.dana.id}"]`);
    await dana.getByTestId('account-status').focus();
    await page.keyboard.press('Space');
    await expect(dana.getByTestId('account-status')).toBeChecked();
    expect(api.callsTo('PATCH', /^\/api\/users\//)[1]?.body).toEqual({ status: 'active' });
  });

  test('presents invitations as account invitations, not as document access', async ({ page }) => {
    await page.goto('/admin/users?tab=invitations');
    await expect(page.getByRole('tabpanel')).toContainText('It gives no access to any document');
    await expect(page.getByRole('tabpanel')).toContainText('does not send email');
    const rows = page.getByTestId('invitation-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('priya.nair@northwind.example');
    await expect(rows.nth(0).getByTestId('invitation-state')).toHaveText('Pending');
    await expect(rows.nth(0)).toContainText('Expires in 6 days');
    await expect(rows.nth(1)).toContainText('Anyone with the link');
    await expect(rows.nth(2).getByTestId('invitation-state')).toHaveText('Accepted');
    await expect(rows.nth(2)).toContainText('Accepted 20 days ago by Chen Wei');
    await expect(rows.nth(3).getByTestId('invitation-state')).toHaveText('Expired');
    // Only invitations that can still be used can be revoked.
    await expect(page.getByTestId('revoke-invitation')).toHaveCount(2);
  });

  test('creates an invitation and shows its link exactly once', async ({ page, api }) => {
    await page.goto('/admin/users?tab=invitations');
    const form = page.getByTestId('create-invitation-form');
    // Member, valid for seven days, no address: the defaults.
    await expect(form.getByTestId('invitation-role')).toHaveValue('member');
    await expect(form.getByTestId('invitation-expiry')).toHaveValue('168');

    await form.getByTestId('invitation-email').fill('not an address');
    await form.getByRole('button', { name: 'Create invitation' }).click();
    await expect(form.getByText('Enter a complete email address')).toBeVisible();
    expect(api.callsTo('POST', /^\/api\/invitations$/)).toHaveLength(0);

    await form.getByTestId('invitation-email').fill('lena.fischer@northwind.example');
    await form.getByTestId('invitation-expiry').selectOption('24');
    await form.getByRole('button', { name: 'Create invitation' }).click();

    expect(api.callsTo('POST', /^\/api\/invitations$/)[0]?.body).toEqual({
      email: 'lena.fischer@northwind.example',
      role: 'member',
      expiresInHours: 24,
    });
    const callout = page.getByTestId('new-invitation');
    await expect(callout).toContainText('Invitation created for lena.fischer@northwind.example');
    await expect(callout).toContainText('only time the full link is shown');
    await callout.getByRole('button', { name: 'Show' }).click();
    await expect(callout.getByTestId('new-invitation-url')).toHaveValue(
      new RegExp(`^${PUBLIC_ORIGIN}/invite/[0-9a-f-]{36}#${SECRETS.invite}$`),
    );
    await expect(page.getByTestId('invitation-row')).toHaveCount(5);
    expect(await storageDump(page)).not.toContain(SECRETS.invite);

    await callout.getByTestId('new-invitation-done').click();
    await expect(callout).toHaveCount(0);
    expect(await page.content()).not.toContain(SECRETS.invite);
  });

  test('warns before creating an administrator invitation without an address', async ({
    page,
    api,
  }) => {
    await page.goto('/admin/users?tab=invitations');
    const form = page.getByTestId('create-invitation-form');
    await form.getByTestId('invitation-role').selectOption('admin');
    await expect(form).toContainText('becomes an administrator');
    await form.getByRole('button', { name: 'Create invitation' }).click();
    await expect(page.getByTestId('new-invitation')).toBeVisible();
    // No email key at all when the field is empty.
    expect(api.callsTo('POST', /^\/api\/invitations$/)[0]?.body).toEqual({
      role: 'admin',
      expiresInHours: 168,
    });
  });

  test('revokes a pending invitation after confirming', async ({ page, api }) => {
    await page.goto('/admin/users?tab=invitations');
    const first = page.getByTestId('invitation-row').first();
    await first.getByTestId('revoke-invitation').click();
    const confirm = page.getByTestId('revoke-invitation-confirm');
    await expect(confirm).toContainText('no document access is affected');
    await confirm.getByRole('button', { name: 'Revoke invitation' }).click();
    await expect(first.getByTestId('invitation-state')).toHaveText('Revoked');
    await expect(first.getByTestId('revoke-invitation')).toHaveCount(0);
    expect(api.callsTo('DELETE', /^\/api\/invitations\//)[0]?.path).toBe(
      `/api/invitations/${INVITATION_IDS.pending}`,
    );
  });

  test('shows the audit log', async ({ page }) => {
    await page.goto('/admin/users');
    await page.getByRole('tab', { name: 'Audit log' }).click();
    await expect(page).toHaveURL('/admin/users?tab=audit');
    const table = page.getByTestId('audit-table');
    await expect(table.getByRole('row')).toHaveCount(5);
    await expect(table).toContainText('share.create');
    await expect(table).toContainText('Asha Rao');
    await expect(table).toContainText('System');
    await expect(table).toContainText('role: viewer');
  });

  test('shows errors with a retry on each tab', async ({ page, api }) => {
    api.failNext('GET', /^\/api\/users$/, 'internal', { requestId: 'req_users', times: 3 });
    await page.goto('/admin/users');
    const error = page.getByTestId('error-screen');
    await expect(error).toContainText('Reference req_users');
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('account-row')).toHaveCount(4);
  });
});

test('a member cannot use the people page', async ({ page, api }) => {
  signedInAs(api, USERS.ben);
  await page.goto('/admin/users');
  await expect(page.getByTestId('error-screen')).toContainText('This page is for administrators');
  await expect(page.getByRole('tab')).toHaveCount(0);
  expect(api.callsTo('GET', /^\/api\/(users|invitations|audit)$/)).toHaveLength(0);
});
