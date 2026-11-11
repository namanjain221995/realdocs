import {
  allowConsoleErrors,
  DOC_IDS,
  expect,
  type MockApi,
  PUBLIC_ORIGIN,
  SECRETS,
  signedInAs,
  test,
  USERS,
} from './support/test';

const launch = `/d/${DOC_IDS.launch}`;
const documentRequest = (id: string): RegExp => new RegExp(`^/api/documents/${id}$`);
const ticketRequest = (id: string): RegExp => new RegExp(`^/api/documents/${id}/collab-ticket$`);
/** The editor's ticket requests ask for access; they change nothing on the server. */
const isRead = (call: { method: string; path: string }): boolean =>
  call.method === 'GET' || call.path.endsWith('/collab-ticket');

/*
 * The editor on these pages is the real one. This suite has no collaboration
 * server (see `support/mockApi.ts`), so it stays in its "reconnecting" state
 * and shows no content; the tests are about the app around it. Typing,
 * synchronising and saving are tested against the real server in `test-real/`.
 */

test.describe('document workspace for an administrator', () => {
  test.beforeEach(({ api }) => {
    signedInAs(api, USERS.asha);
  });

  test('shows the document with every administrator control', async ({ page, api }) => {
    await page.goto(launch);
    await expect(page.getByTestId('document-title')).toHaveText('Q4 launch plan');
    await expect(page).toHaveTitle('Q4 launch plan – RealtimeDocs');
    await expect(page.getByTestId('document-role')).toHaveText('Admin');
    for (const control of [
      'back-to-documents',
      'rename-document',
      'open-sharing',
      'open-snapshots',
      'open-export',
      'open-in-desktop',
      'open-display-preferences',
    ]) {
      await expect(page.getByTestId(control)).toBeVisible();
    }
    await expect(page.getByTestId('leave-document')).toHaveCount(0);

    // The editor is mounted for this document and asks for a collaboration ticket for it...
    await expect(page.getByTestId('editor-mount').getByTestId('rd-editor')).toBeAttached();
    await expect
      .poll(() => api.callsTo('POST', ticketRequest(DOC_IDS.launch)).length)
      .toBeGreaterThan(0);
    // ...and puts its connection indicator into the header slot.
    await expect(page.getByTestId('status-slot').getByTestId('rd-status-connection')).toBeVisible();
    // Until the editor has heard from the server it offers nothing to edit with.
    await expect(page.getByTestId('rd-editor')).toHaveAttribute('data-editable', 'false');
    await expect(page.getByTestId('rd-toolbar')).toHaveCount(0);
  });

  test('states the browser capture status in the exact words, with guidance', async ({ page }) => {
    await page.goto(launch);
    const status = page.getByTestId('capture-status');
    await expect(status).toContainText('Browser mode: capture exclusion unavailable');
    await status.getByTestId('capture-guidance-link').click();
    const guidance = page.getByTestId('capture-guidance');
    await expect(guidance).toContainText('cannot ask the operating system');
    await expect(guidance).toContainText('Share one window');
    await expect(guidance).toContainText('second display or another device');
    await expect(guidance).toContainText(
      'On macOS, current capture methods can still include the panel',
    );
    // (The dialog also has a close button in its corner; this is the one in the footer.)
    await guidance.getByRole('button', { name: 'Close' }).last().click();
    await expect(guidance).toHaveCount(0);
    // Focus returns to what opened the dialog.
    await expect(status.getByTestId('capture-guidance-link')).toBeFocused();
  });

  test('renames inline, saving on Enter and cancelling on Escape', async ({ page, api }) => {
    await page.goto(launch);
    await page.getByTestId('rename-document').click();
    const input = page.getByTestId('document-title-input');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Q4 launch plan');

    await input.fill('Something else entirely');
    await input.press('Escape');
    await expect(page.getByTestId('document-title')).toHaveText('Q4 launch plan');
    expect(api.callsTo('PATCH', documentRequest(DOC_IDS.launch))).toHaveLength(0);

    await page.getByTestId('document-title').click();
    await page.getByTestId('document-title-input').fill('Q4 launch plan, final');
    await page.getByTestId('document-title-input').press('Enter');
    await expect(page.getByTestId('document-title')).toHaveText('Q4 launch plan, final');
    await expect(page).toHaveTitle('Q4 launch plan, final – RealtimeDocs');
    expect(api.callsTo('PATCH', documentRequest(DOC_IDS.launch))).toHaveLength(1);
    expect(api.document(DOC_IDS.launch).title).toBe('Q4 launch plan, final');
    // Keyboard users land back on the control they started from.
    await expect(page.getByTestId('rename-document')).toBeFocused();
  });

  test('offers every export as a real link and the print view in a new tab', async ({ page }) => {
    await page.goto(launch);
    await page.getByTestId('open-export').click();
    const base = `/api/documents/${DOC_IDS.launch}/export?format=`;
    await expect(page.getByTestId('export-txt')).toHaveAttribute('href', `${base}txt`);
    await expect(page.getByTestId('export-md')).toHaveAttribute('href', `${base}md`);
    await expect(page.getByTestId('export-md-zip')).toHaveAttribute('href', `${base}md-zip`);
    for (const item of ['export-txt', 'export-md', 'export-md-zip']) {
      await expect(page.getByTestId(item)).toHaveAttribute('download', '');
    }
    const print = page.getByTestId('export-print');
    await expect(print).toHaveAttribute('href', `${launch}/print`);
    await expect(print).toHaveAttribute('target', '_blank');
    await expect(print).toHaveAttribute('rel', /noopener/);
  });

  test('keeps display preferences in this browser and out of the document', async ({
    page,
    api,
  }) => {
    await page.goto(launch);
    // The editor's own root carries the reader's settings.
    const mount = page.getByTestId('rd-editor');
    const fontScale = (): Promise<string> =>
      mount.evaluate((element) =>
        (element as HTMLElement).style.getPropertyValue('--rd-doc-scale'),
      );
    await expect(mount).toHaveAttribute('data-reading-width', 'normal');
    expect(await fontScale()).toBe('1');
    const writes = (): number => api.calls.filter((call) => !isRead(call)).length;
    const before = writes();

    await page.getByTestId('open-display-preferences').click();
    const form = page.getByTestId('display-preferences');
    await form.getByRole('radio', { name: 'Wide' }).click();
    await form.getByRole('radio', { name: 'Light' }).click();
    // Six steps of 5% up from 100%.
    await form.getByLabel('Text size').focus();
    for (let step = 0; step < 6; step += 1) await page.keyboard.press('ArrowRight');

    await expect(mount).toHaveAttribute('data-reading-width', 'wide');
    await expect(mount).toHaveAttribute('data-theme', 'light');
    await expect.poll(fontScale).toBe('1.3');
    // The app theme itself did not change.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(
      await page.evaluate(() => JSON.parse(window.localStorage.getItem('rd.display.v1') ?? 'null')),
    ).toEqual({ fontScale: 1.3, readingWidth: 'wide', tone: 'light' });
    // Nothing was sent to the server: these are the reader's own settings.
    expect(writes()).toBe(before);

    await page.reload();
    await expect(page.getByTestId('rd-editor')).toHaveAttribute('data-reading-width', 'wide');
    await expect(page.getByTestId('rd-editor')).toHaveAttribute('data-theme', 'light');

    await page.getByTestId('open-display-preferences').click();
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    // Back to the app's own colours: no theme of its own on the document.
    await expect(page.getByTestId('rd-editor')).not.toHaveAttribute('data-theme');
    await expect(page.getByTestId('rd-editor')).toHaveAttribute('data-reading-width', 'normal');
    expect(await page.evaluate(() => window.localStorage.getItem('rd.display.v1'))).toBeNull();
  });

  test('hands off to the desktop app without putting the code in the web address', async ({
    page,
    api,
    browserName,
  }) => {
    // Nothing handles realtimedocs:// in the test browsers; each reports that in its own way.
    allowConsoleErrors(page, /realtimedocs|scheme|protocol|Not allowed to launch/i);
    const navigations: string[] = [];
    page.on('request', (request) => navigations.push(request.url()));

    await page.goto(launch);
    await page.getByTestId('open-in-desktop').click();
    const dialog = page.getByTestId('desktop-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('works once and for 60 seconds');
    await expect(dialog).toContainText('Paste share link');
    await expect(dialog.getByTestId('desktop-server-address')).toHaveValue(PUBLIC_ORIGIN);

    if (browserName === 'firefox') {
      // Firefox would replace the page with an error if no app handles the
      // link, so the app explains first and waits for an explicit second click.
      await expect(dialog.getByTestId('desktop-launch')).toHaveText('Open desktop app');
      expect(api.callsTo('POST', /\/desktop-handoff$/)).toHaveLength(0);
    } else {
      await expect(dialog.getByTestId('desktop-launched')).toContainText(
        'asked to open RealtimeDocs Desktop',
      );
      expect(api.callsTo('POST', /\/desktop-handoff$/)).toHaveLength(1);
      // The document is still on screen and its address carries no code.
      await expect(page.getByTestId('document-title')).toHaveText('Q4 launch plan');
    }
    expect(page.url()).not.toContain(SECRETS.handoff);
    expect(
      navigations.filter((url) => url.startsWith('http') && url.includes(SECRETS.handoff)),
    ).toEqual([]);
    // The code is never rendered either.
    await expect(page.locator('body')).not.toContainText(SECRETS.handoff);
  });

  test('reports a failed handoff with the server reference', async ({ page, api, browserName }) => {
    api.failNext('POST', /\/desktop-handoff$/, 'rate_limited', {
      retryAfterSeconds: 20,
      requestId: 'req_handoff',
    });
    await page.goto(launch);
    await page.getByTestId('open-in-desktop').click();
    if (browserName === 'firefox') await page.getByTestId('desktop-launch').click();
    const failed = page.getByTestId('desktop-failed');
    await expect(failed).toContainText('Too many attempts. Try again in 20 seconds.');
    await expect(failed).toContainText('Reference req_handoff');
  });

  test('marks an archived document read-only and can unarchive it', async ({ page, api }) => {
    await page.goto(`/d/${DOC_IDS.retro}`);
    const banner = page.getByTestId('archived-banner');
    await expect(banner).toContainText('archived, so it is read-only for everyone');
    // Archived caps the role at viewer, but the administrator still manages the document.
    await expect(page.getByTestId('document-role')).toHaveText('Viewer');
    await expect(page.getByTestId('open-sharing')).toBeVisible();
    await expect(page.getByTestId('rename-document')).toHaveCount(0);

    await banner.getByRole('button', { name: 'Unarchive' }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId('document-role')).toHaveText('Admin');
    expect(api.document(DOC_IDS.retro).status).toBe('active');
  });

  test('uses one overflow menu on a phone and keeps every action reachable', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(launch);
    await expect(page.getByTestId('open-sharing')).toBeVisible();
    await page.getByTestId('document-more').click();
    for (const item of [
      'open-snapshots',
      'open-in-desktop',
      'open-display-preferences',
      'export-txt',
      'export-md',
      'export-md-zip',
      'export-print',
    ]) {
      await expect(page.getByTestId(item)).toBeVisible();
    }
    await page.getByTestId('open-display-preferences').click();
    await expect(page.getByRole('dialog', { name: 'Display preferences' })).toBeVisible();
    await expect(page.getByTestId('capture-status')).toContainText(
      'Browser mode: capture exclusion unavailable',
    );
  });
});

test.describe('document workspace for members', () => {
  test.beforeEach(({ api }) => {
    signedInAs(api, USERS.ben);
  });

  test('gives an editor no administrator controls', async ({ page }) => {
    await page.goto(launch);
    await expect(page.getByTestId('document-role')).toHaveText('Editor');
    await expect(page.getByTestId('editor-mount')).toBeVisible();
    for (const control of ['open-sharing', 'open-snapshots', 'rename-document', 'leave-document']) {
      await expect(page.getByTestId(control)).toHaveCount(0);
    }
    // What every reader gets is still there.
    await expect(page.getByTestId('open-export')).toBeVisible();
    await expect(page.getByTestId('open-in-desktop')).toBeVisible();
    await expect(page.getByTestId('open-display-preferences')).toBeVisible();
    // Clicking the title does not start a rename.
    await page.getByTestId('document-title').click();
    await expect(page.getByTestId('document-title-input')).toHaveCount(0);
  });

  test('shows a viewer as a viewer', async ({ page }) => {
    await page.goto(`/d/${DOC_IDS.board}`);
    await expect(page.getByTestId('document-role')).toHaveText('Viewer');
    await expect(page.getByTestId('open-sharing')).toHaveCount(0);
  });

  test('does not open an administrator panel from the address alone', async ({ page, api }) => {
    await page.goto(`${launch}?panel=share`);
    await expect(page.getByTestId('editor-mount')).toBeVisible();
    await expect(page.getByTestId('sharing-panel')).toHaveCount(0);
    expect(api.callsTo('GET', /\/access$/)).toHaveLength(0);
  });
});

test.describe('document workspace for a share-link guest', () => {
  test('works without an account: no dashboard chrome, no administrator controls', async ({
    page,
    api,
  }) => {
    api.guestAccess.set(DOC_IDS.launch, { role: 'viewer', expiresAt: '2026-11-13T12:00:00.000Z' });
    await page.goto(launch);
    await expect(page.getByTestId('document-title')).toHaveText('Q4 launch plan');
    await expect(page.getByTestId('document-role')).toHaveText('Viewer');
    await expect(page.getByTestId('via-share-link')).toBeVisible();
    await expect(page.getByTestId('editor-mount')).toBeVisible();
    await expect(page.getByTestId('access-expiry')).toHaveText('Your access ends in 3 days');
    // The guest's browser asks for a ticket like anyone else's, with the placeholder CSRF header.
    await expect
      .poll(() => api.callsTo('POST', ticketRequest(DOC_IDS.launch)).length)
      .toBeGreaterThan(0);
    expect(api.callsTo('POST', ticketRequest(DOC_IDS.launch))[0]?.headers['x-rd-csrf']).toBe('1');

    for (const control of [
      'back-to-documents',
      'open-sharing',
      'open-snapshots',
      'rename-document',
    ]) {
      await expect(page.getByTestId(control)).toHaveCount(0);
    }
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByTestId('open-export')).toBeVisible();
    await expect(page.getByTestId('open-in-desktop')).toBeVisible();
  });

  test('lets a guest with an edit link in as an editor, still without controls', async ({
    page,
    api,
  }) => {
    api.guestAccess.set(DOC_IDS.launch, { role: 'editor', expiresAt: null });
    await page.goto(launch);
    await expect(page.getByTestId('document-role')).toHaveText('Editor');
    await expect(page.getByTestId('open-sharing')).toHaveCount(0);
    await expect(page.getByTestId('access-expiry')).toHaveCount(0);
  });

  test('leaves the document by ending the share session', async ({ page, api }) => {
    api.guestAccess.set(DOC_IDS.launch, { role: 'viewer', expiresAt: null });
    await page.goto(launch);
    await page.getByTestId('leave-document').click();
    await expect(page.getByTestId('left-document')).toContainText('You left the document');
    const end = api.callsTo('POST', /\/share-session\/end$/);
    expect(end).toHaveLength(1);
    expect(end[0]?.path).toBe(`/api/documents/${DOC_IDS.launch}/share-session/end`);
    // Guests have no session token; the placeholder CSRF header is still sent.
    expect(end[0]?.headers['x-rd-csrf']).toBe('1');
    expect(api.guestAccess.has(DOC_IDS.launch)).toBe(false);
  });
});

test.describe('document screens for things that go wrong', () => {
  test('missing document, signed in', async ({ page, api }) => {
    signedInAs(api, USERS.ben);
    await page.goto(`/d/${DOC_IDS.missing}`);
    const error = page.getByTestId('document-error');
    await expect(error).toHaveAttribute('data-error-kind', 'not_found');
    await expect(error).toContainText('Document not found');
    await expect(error.getByRole('link', { name: 'Go to documents' })).toBeVisible();
    // A document the member was never added to answers the same way.
    await page.goto(`/d/${DOC_IDS.pricing}`);
    await expect(page.getByTestId('document-error')).toHaveAttribute(
      'data-error-kind',
      'not_found',
    );
  });

  test('an address that is not a document id never reaches the server', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    await page.goto('/d/not-an-id');
    await expect(page.getByTestId('document-error')).toHaveAttribute(
      'data-error-kind',
      'not_found',
    );
    expect(api.callsTo('GET', /^\/api\/documents\/not-an-id$/)).toHaveLength(0);
  });

  test('document in the trash: a member is told, an administrator can restore', async ({
    page,
    api,
  }) => {
    api.members[DOC_IDS.oldPlan] = [
      {
        userId: USERS.ben.id,
        email: USERS.ben.email,
        displayName: USERS.ben.displayName,
        role: 'editor',
        userStatus: 'active',
        grantedAt: '2026-10-01T09:00:00.000Z',
      },
    ];
    signedInAs(api, USERS.ben);
    await page.goto(`/d/${DOC_IDS.oldPlan}`);
    const error = page.getByTestId('document-error');
    await expect(error).toHaveAttribute('data-error-kind', 'document_trashed');
    await expect(error).toContainText('This document is in the trash');
    await expect(error.getByRole('button', { name: 'Restore document' })).toHaveCount(0);

    signedInAs(api, USERS.asha);
    await page.goto(`/d/${DOC_IDS.oldPlan}`);
    await page
      .getByTestId('document-error')
      .getByRole('button', { name: 'Restore document' })
      .click();
    await expect(page.getByTestId('document-title')).toHaveText('Launch plan (superseded)');
    expect(api.document(DOC_IDS.oldPlan).status).toBe('active');
  });

  test('no permission', async ({ page, api }) => {
    signedInAs(api, USERS.ben);
    api.failNext('GET', documentRequest(DOC_IDS.launch), 'forbidden', { requestId: 'req_403' });
    await page.goto(launch);
    const error = page.getByTestId('document-error');
    await expect(error).toHaveAttribute('data-error-kind', 'forbidden');
    await expect(error).toContainText('You do not have access to this document');
    await expect(error).toContainText('Reference req_403');
    await expect(error.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('no session: offers sign-in and comes back to the document', async ({ page }) => {
    await page.goto(launch);
    const error = page.getByTestId('document-error');
    await expect(error).toHaveAttribute('data-error-kind', 'session_expired');
    await expect(error).toContainText('Sign in to continue');
    await expect(error).toContainText('open that link again');
    await expect(error.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(launch)}`,
    );
  });

  test('session ends while the document is open', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    await page.goto(launch);
    await expect(page.getByTestId('document-title')).toBeVisible();
    api.signOut();
    // Opening the panel asks the server, which answers that the session is gone.
    // (The editor's own next request may notice first; both lead to an offer to sign in.)
    await page.getByTestId('open-sharing').click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(launch)}`,
    );
    // Nothing of the administrator's view is left on screen.
    await expect(page.getByTestId('document-title')).toHaveCount(0);
    await expect(page.getByTestId('sharing-panel')).toHaveCount(0);
  });

  test('server unavailable: retries on request', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    api.failNext('GET', documentRequest(DOC_IDS.launch), 'storage_unavailable', {
      requestId: 'req_503',
      times: 3,
    });
    await page.goto(launch);
    const error = page.getByTestId('document-error');
    await expect(error).toHaveAttribute('data-error-kind', 'server_unavailable');
    await expect(error).toContainText('The server is not responding');
    await expect(error).toContainText('Reference req_503');
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('document-title')).toHaveText('Q4 launch plan');
  });

  test('offline: says so and loads again when the connection returns', async ({
    page,
    api,
    context,
  }) => {
    signedInAs(api, USERS.asha);
    // Open another document first, so the workspace code is already loaded
    // when the connection drops (an offline browser cannot fetch new code).
    await page.goto(`/d/${DOC_IDS.board}`);
    await expect(page.getByTestId('document-title')).toHaveText('Board meeting notes, November');
    await page.getByTestId('back-to-documents').click();
    await expect(page.getByTestId('document-row')).toHaveCount(5);

    await context.setOffline(true);
    api.offline = true;
    await page.getByRole('link', { name: 'Q4 launch plan' }).click();
    const error = page.getByTestId('document-error');
    await expect(error).toHaveAttribute('data-error-kind', 'offline');
    await expect(error).toContainText('You are offline');

    api.offline = false;
    await context.setOffline(false);
    await expect(page.getByTestId('document-title')).toHaveText('Q4 launch plan');
  });

  test('rate limited: waits before offering the retry', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    api.failNext('GET', documentRequest(DOC_IDS.launch), 'rate_limited', { retryAfterSeconds: 15 });
    await page.goto(launch);
    const error = page.getByTestId('document-error');
    await expect(error).toHaveAttribute('data-error-kind', 'rate_limited');
    await expect(error.getByRole('button', { name: /Try again in \d+ s/ })).toBeDisabled();
    await page.clock.setFixedTime(new Date('2026-11-10T12:00:16.000Z'));
    await error.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByTestId('document-title')).toHaveText('Q4 launch plan');
  });

  test('update required: asks for a reload', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    api.failNext('GET', documentRequest(DOC_IDS.launch), 'update_required');
    await page.goto(launch);
    const error = page.getByTestId('document-error');
    await expect(error).toHaveAttribute('data-error-kind', 'update_required');
    await expect(error.getByRole('button', { name: 'Reload' })).toBeVisible();
  });
});

test.describe('access that ends while the document is open', () => {
  // The editor's session is told first; here its ticket request gets the server's answer.
  const endWith = (
    api: MockApi,
    code: 'share_revoked' | 'share_expired' | 'not_found' | 'unauthenticated',
  ) => api.failNext('POST', ticketRequest(DOC_IDS.launch), code, { times: 50 });

  test('a guest whose link was revoked', async ({ page, api }) => {
    api.guestAccess.set(DOC_IDS.launch, { role: 'viewer', expiresAt: null });
    endWith(api, 'share_revoked');
    await page.goto(launch);
    const ended = page.getByTestId('access-ended');
    await expect(ended).toHaveAttribute('data-reason', 'access_revoked');
    await expect(
      ended.getByRole('heading', { level: 1, name: 'Your access to this document was revoked' }),
    ).toBeVisible();
    await expect(ended).toContainText('The share link you used was revoked');
    await expect(page).toHaveTitle('Access revoked – RealtimeDocs');
    // The document is off the screen, and a guest is offered neither a dashboard nor a sign-in.
    await expect(page.getByTestId('document-title')).toHaveCount(0);
    await expect(page.getByTestId('editor-mount')).toHaveCount(0);
    await expect(ended.getByRole('link')).toHaveCount(0);
    await expect(page.getByTestId('access-ended-drafts')).toHaveCount(0);
  });

  test('a guest whose link or share session expired', async ({ page, api }) => {
    api.guestAccess.set(DOC_IDS.launch, { role: 'editor', expiresAt: null });
    endWith(api, 'share_expired');
    await page.goto(launch);
    const ended = page.getByTestId('access-ended');
    await expect(ended).toHaveAttribute('data-reason', 'access_expired');
    await expect(
      ended.getByRole('heading', { level: 1, name: 'Your access to this document has expired' }),
    ).toBeVisible();
    await expect(ended).toContainText('Open the share link again');
    await expect(page).toHaveTitle('Access expired – RealtimeDocs');
    await expect(page.getByTestId('editor-mount')).toHaveCount(0);
  });

  test('a member who was removed from the document', async ({ page, api }) => {
    signedInAs(api, USERS.ben);
    endWith(api, 'not_found');
    await page.goto(launch);
    const ended = page.getByTestId('access-ended');
    await expect(ended).toHaveAttribute('data-reason', 'access_revoked');
    await expect(ended).toContainText('An administrator revoked your access');
    // Still signed in: the way on is the dashboard.
    await expect(ended.getByRole('link', { name: 'Go to documents' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('button', { name: /^Account menu for Ben/ })).toBeVisible();
    await expect(page.getByTestId('editor-mount')).toHaveCount(0);
  });

  test('an account whose session ended', async ({ page, api }) => {
    signedInAs(api, USERS.ben);
    await page.goto(launch);
    await expect(page.getByTestId('editor-mount')).toBeVisible();
    // The session is ended elsewhere; the editor's next request is told so. It asks again
    // on its own after a pause that grows; "Retry now", while it is offered, skips the pause.
    api.signOut();
    endWith(api, 'unauthenticated');
    await page
      .getByTestId('rd-status-retry')
      .click({ timeout: 1_000 })
      .catch(() => undefined);
    const ended = page.getByTestId('access-ended');
    await expect(ended).toHaveAttribute('data-reason', 'access_expired', { timeout: 20_000 });
    await expect(
      ended.getByRole('heading', { level: 1, name: 'Your session has ended' }),
    ).toBeVisible();
    await expect(ended.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(launch)}`,
    );
    await expect(page.getByTestId('document-title')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Account menu for/ })).toHaveCount(0);
  });
});

test.describe('print view', () => {
  test('shows a toolbar and instructions on screen and only the document on paper', async ({
    page,
    api,
  }) => {
    signedInAs(api, USERS.asha);
    await page.goto(`${launch}/print`);
    await expect(page).toHaveTitle('Q4 launch plan (print view) – RealtimeDocs');
    await expect(page.getByRole('heading', { level: 1, name: 'Q4 launch plan' })).toBeVisible();
    // The body is the server's JSON export, drawn by the editor's static renderer.
    const body = page.getByTestId('print-body');
    await expect(body.getByRole('heading', { level: 2, name: 'Summary' })).toBeVisible();
    await expect(body).toContainText('Mock content of “Q4 launch plan”, with bold text.');
    await expect(body.locator('strong')).toHaveText('bold');
    await expect(body.locator('ul li')).toHaveText(['First point', 'Second point']);
    expect(api.callsTo('GET', /\/export$/).map((call) => call.search)).toEqual(['?format=json']);
    // Nothing on a printed page can be edited or is live.
    await expect(body.locator('[contenteditable="true"]')).toHaveCount(0);
    expect(api.callsTo('POST', /collab-ticket$/)).toHaveLength(0);
    await expect(page.getByTestId('print-toolbar')).toBeVisible();
    await expect(page.getByTestId('print-help')).toContainText('Save as PDF');
    await expect(page.getByTestId('print-button')).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Back to document' })).toHaveAttribute(
      'href',
      launch,
    );

    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('print-toolbar')).toBeHidden();
    await expect(page.getByTestId('print-help')).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Q4 launch plan' })).toBeVisible();
    await expect(body).toContainText('Mock content of “Q4 launch plan”');
    // Paper is white whatever the app theme is.
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(255, 255, 255)',
    );
  });

  test('says so when the content cannot be loaded, and loads it on request', async ({
    page,
    api,
  }) => {
    signedInAs(api, USERS.asha);
    api.failNext('GET', /\/export$/, 'storage_unavailable', { requestId: 'req_print', times: 3 });
    await page.goto(`${launch}/print`);
    const error = page.getByTestId('print-error');
    await expect(error).toContainText('The document could not be loaded for printing');
    await expect(error).toContainText('Reference req_print');
    // Printing an empty sheet is not offered.
    await expect(page.getByTestId('print-button')).toBeDisabled();
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('print-body')).toContainText('Mock content');
    await expect(page.getByTestId('print-button')).toBeEnabled();
  });

  test('calls the browser print dialog from the Print button', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    await page.addInitScript(() => {
      window.print = () => {
        document.documentElement.setAttribute('data-print-called', 'yes');
      };
    });
    await page.goto(`${launch}/print`);
    await page.getByTestId('print-button').click();
    await expect(page.locator('html')).toHaveAttribute('data-print-called', 'yes');
  });

  test('works for a share-link guest and uses the same error screens', async ({ page, api }) => {
    api.guestAccess.set(DOC_IDS.launch, { role: 'viewer', expiresAt: null });
    await page.goto(`${launch}/print`);
    await expect(page.getByTestId('print-body')).toContainText('Mock content of “Q4 launch plan”');

    await page.goto(`/d/${DOC_IDS.missing}/print`);
    await expect(page.getByTestId('document-error')).toHaveAttribute(
      'data-error-kind',
      'not_found',
    );
  });
});
