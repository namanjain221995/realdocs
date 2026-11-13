import {
  expect,
  INVITATION_IDS,
  PASSWORDS,
  SECRETS,
  signedInAs,
  storageDump,
  test,
  USERS,
} from './support/test';

const LOGIN = /^\/api\/auth\/login$/;

test.describe('sign-in', () => {
  test('sends a signed-out visitor to sign-in and back to the page they wanted', async ({
    page,
    api,
  }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL('/login?next=%2Fsettings');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page).toHaveTitle('Sign in – RealtimeDocs');

    await page.getByLabel('Email').fill(USERS.asha.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORDS[USERS.asha.email] ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    expect(api.callsTo('POST', LOGIN)[0]?.body).toEqual({
      email: USERS.asha.email,
      password: PASSWORDS[USERS.asha.email],
    });
  });

  test('ignores a return address that points outside the app', async ({ page }) => {
    await page.goto('/login?next=https%3A%2F%2Fevil.example%2Fphish');
    await page.getByLabel('Email').fill(USERS.asha.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORDS[USERS.asha.email] ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Not the address in `next`: the administrator's own start page.
    await expect(page).toHaveURL('/admin/users');
  });

  test('gives one message for a wrong password and for an unknown account', async ({ page }) => {
    await page.goto('/login');
    const messages: string[] = [];
    for (const email of [USERS.asha.email, 'nobody@northwind.example']) {
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill('definitely not the password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      const error = page.getByTestId('login-error');
      await expect(error).toContainText('That email and password do not match an account.');
      messages.push((await error.textContent()) ?? '');
    }
    // The screen must not reveal which of the two was wrong.
    expect(messages[0]).toBe(messages[1]);
    await expect(page).toHaveURL('/login');
  });

  test('says how long to wait when sign-in is rate limited', async ({ page, api }) => {
    api.failNext('POST', LOGIN, 'rate_limited', { retryAfterSeconds: 30 });
    await page.goto('/login');
    await page.getByLabel('Email').fill(USERS.asha.email);
    await page.getByLabel('Password', { exact: true }).fill('whatever it is');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByTestId('login-error')).toContainText(
      'Too many sign-in attempts. Wait 30 seconds before trying again.',
    );
    const submit = page.getByRole('button', { name: /Sign in available in \d+ s/ });
    await expect(submit).toBeDisabled();

    // Once the wait is over the form works again.
    await page.clock.setFixedTime(new Date('2026-11-10T12:00:31.000Z'));
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  });

  test('explains an unreachable server and recovers on the next try', async ({ page, api }) => {
    api.abortNext('POST', LOGIN);
    await page.goto('/login');
    await page.getByLabel('Email').fill(USERS.asha.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORDS[USERS.asha.email] ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('login-error')).toContainText('The server could not be reached');

    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/admin/users');
  });

  test('shows the server reference when sign-in fails for an unexpected reason', async ({
    page,
    api,
  }) => {
    api.failNext('POST', LOGIN, 'internal', { requestId: 'req_login_500' });
    await page.goto('/login');
    await page.getByLabel('Email').fill(USERS.asha.email);
    await page.getByLabel('Password', { exact: true }).fill('some password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('login-error')).toContainText('Reference req_login_500');
  });

  test('checks the fields before asking the server', async ({ page, api }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter your email address.')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeFocused();

    await page.getByLabel('Email').fill('asha');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter the whole address')).toBeVisible();

    await page.getByLabel('Email').fill(USERS.asha.email);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter your password.')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
    expect(api.callsTo('POST', LOGIN)).toHaveLength(0);
  });

  test('never stores the password or the CSRF token in the browser', async ({ page, api }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(USERS.asha.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORDS[USERS.asha.email] ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/admin/users');
    await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
    const stored = await storageDump(page);
    expect(stored).not.toContain(PASSWORDS[USERS.asha.email]);
    expect(stored).not.toContain(api.csrfToken ?? 'no-token');
  });

  test('sends an already signed-in visitor straight on', async ({ page, api }) => {
    signedInAs(api, USERS.ben);
    await page.goto('/login?next=%2Fsettings');
    await expect(page).toHaveURL('/settings');
  });

  test('explains an ended session and returns to the same page after signing in again', async ({
    page,
    api,
  }) => {
    signedInAs(api, USERS.asha);
    await page.goto('/documents?view=archived');
    await expect(page.getByTestId('document-row')).toHaveCount(1);

    // The session ends on the server; the next request finds out.
    api.signOut();
    await page.getByRole('tab', { name: 'Recent' }).click();

    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByTestId('session-expired-notice')).toContainText('Your session ended');

    await page.getByLabel('Email').fill(USERS.asha.email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORDS[USERS.asha.email] ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/documents?view=recent');
  });
});

test.describe('invitation', () => {
  const inviteUrl = `/invite/${INVITATION_IDS.pending}#${SECRETS.invite}`;

  test('creates the account, signs in and lands on the dashboard', async ({ page, api }) => {
    const requestUrls: string[] = [];
    page.on('request', (request) => requestUrls.push(request.url()));

    await page.goto(inviteUrl);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeVisible();
    // The secret left the address bar before anything was shown.
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(page.url()).not.toContain(SECRETS.invite);

    const facts = page.getByTestId('invite-facts');
    await expect(facts).toContainText('Northwind Editorial');
    await expect(facts).toContainText('Member');
    await expect(facts).toContainText('priya.nair@northwind.example');
    // The invitation names the address, so the form does not ask for one.
    await expect(page.getByLabel('Email')).toHaveCount(0);

    await page.getByLabel('Name').fill('Priya Nair');
    await page.getByLabel('Password', { exact: true }).fill('violet-harbor-lantern-42');
    await expect(page.getByTestId('password-strength')).toHaveAttribute('data-level', 'strong');
    await page.getByLabel('Confirm password').fill('violet-harbor-lantern-42');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL('/documents');
    await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
    await expect(page.getByText('Account created')).toBeVisible();

    const lookup = api.callsTo('POST', /^\/api\/invitations\/lookup$/);
    const accept = api.callsTo('POST', /^\/api\/invitations\/accept$/);
    expect(lookup[0]?.body).toEqual({
      invitationId: INVITATION_IDS.pending,
      secret: SECRETS.invite,
    });
    expect(accept).toHaveLength(1);
    expect(accept[0]?.body).toEqual({
      invitationId: INVITATION_IDS.pending,
      secret: SECRETS.invite,
      displayName: 'Priya Nair',
      password: 'violet-harbor-lantern-42',
    });
    // The secret travelled in request bodies only.
    expect(requestUrls.filter((url) => url.includes(SECRETS.invite))).toEqual([]);
    expect(await storageDump(page)).not.toContain(SECRETS.invite);
  });

  test('asks for an email address when the invitation has none', async ({ page, api }) => {
    api.inviteSecrets.set(INVITATION_IDS.open, SECRETS.invite);
    await page.goto(`/invite/${INVITATION_IDS.open}#${SECRETS.invite}`);
    await page.getByLabel('Email').fill('lena.fischer@northwind.example');
    await page.getByLabel('Name').fill('Lena Fischer');
    await page.getByLabel('Password', { exact: true }).fill('several unrelated words here');
    await page.getByLabel('Confirm password').fill('several unrelated words here');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL('/documents');
    expect(api.callsTo('POST', /^\/api\/invitations\/accept$/)[0]?.body).toMatchObject({
      email: 'lena.fischer@northwind.example',
      displayName: 'Lena Fischer',
    });
  });

  test('validates the name and the password before asking the server', async ({ page, api }) => {
    await page.goto(inviteUrl);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter the name other people will see.')).toBeVisible();
    await expect(page.getByText('Choose a password.')).toBeVisible();

    await page.getByLabel('Name').fill('Priya Nair');
    await page.getByLabel('Password', { exact: true }).fill('too short');
    await expect(page.getByTestId('password-strength')).toContainText('Add 3 more characters.');
    await page.getByLabel('Confirm password').fill('too short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Use at least 12 characters.')).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill('long enough password 1');
    await page.getByLabel('Confirm password').fill('long enough password 2');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('The two passwords do not match.')).toBeVisible();
    expect(api.callsTo('POST', /^\/api\/invitations\/accept$/)).toHaveLength(0);
  });

  test('says so when the email already has an account', async ({ page, api }) => {
    api.failNext('POST', /^\/api\/invitations\/accept$/, 'conflict', {
      message: 'An account with this email already exists.',
    });
    await page.goto(inviteUrl);
    await page.getByLabel('Name').fill('Priya Nair');
    await page.getByLabel('Password', { exact: true }).fill('violet-harbor-lantern-42');
    await page.getByLabel('Confirm password').fill('violet-harbor-lantern-42');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('invite-form-error')).toContainText(
      'An account with this email address already exists.',
    );
  });

  test('has a screen for an invitation that is not valid', async ({ page }) => {
    await page.goto(`/invite/${INVITATION_IDS.pending}#${SECRETS.shareOther}`);
    const error = page.getByTestId('invite-error');
    await expect(error).toHaveAttribute('data-error-kind', 'invite_invalid');
    await expect(error).toContainText('This invitation is not valid');
    expect(await page.evaluate(() => window.location.hash)).toBe('');
  });

  test('has a screen for an expired invitation', async ({ page, api }) => {
    api.inviteSecrets.set(INVITATION_IDS.expired, SECRETS.invite);
    await page.goto(`/invite/${INVITATION_IDS.expired}#${SECRETS.invite}`);
    const error = page.getByTestId('invite-error');
    await expect(error).toHaveAttribute('data-error-kind', 'invite_expired');
    await expect(error).toContainText('This invitation has expired');
  });

  test('has a screen for a revoked invitation', async ({ page, api }) => {
    api.invitations = api.invitations.map((invitation) =>
      invitation.id === INVITATION_IDS.pending ? { ...invitation, state: 'revoked' } : invitation,
    );
    await page.goto(inviteUrl);
    await expect(page.getByTestId('invite-error')).toContainText('This invitation is not valid');
    await expect(page.getByTestId('invite-error')).toContainText('revoked or already used');
  });

  test('explains a link without its key and never asks the server', async ({ page, api }) => {
    await page.goto(`/invite/${INVITATION_IDS.pending}`);
    await expect(page.getByTestId('invite-error')).toContainText(
      'This invitation link is incomplete',
    );
    expect(api.callsTo('POST', /^\/api\/invitations\/lookup$/)).toHaveLength(0);
  });

  test('offers a retry when the server cannot be reached', async ({ page, api }) => {
    api.abortNext('POST', /^\/api\/invitations\/lookup$/, 3);
    await page.goto(inviteUrl);
    const error = page.getByTestId('invite-error');
    await expect(error).toHaveAttribute('data-error-kind', 'server_unavailable');
    await error.getByRole('button', { name: 'Try again' }).click();
    // The key is still in memory, so the retry needs no reload.
    await expect(
      page.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeVisible();
  });

  test('tells a signed-in visitor that an invitation creates a new account', async ({
    page,
    api,
  }) => {
    signedInAs(api, USERS.ben);
    await page.goto(inviteUrl);
    await expect(page.getByRole('heading', { name: 'You are already signed in' })).toBeVisible();
    expect(api.callsTo('POST', /^\/api\/invitations\/lookup$/)).toHaveLength(0);
  });
});
