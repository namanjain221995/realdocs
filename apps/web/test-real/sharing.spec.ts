/**
 * Real stack, scenarios b, c, d and f: share links. A second, isolated
 * browser profile plays the guest; nothing is shared between the two but the
 * link itself.
 */
import {
  admin,
  allDatabases,
  callApi,
  createDocument,
  createShareLink,
  editorContent,
  editorRoot,
  expect,
  expectEditorReady,
  expectSaved,
  exportedText,
  insertImageFile,
  loadedImages,
  LOCAL_DATABASE,
  localDatabases,
  openDocument,
  pasteHtml,
  pngFile,
  signIn,
  test,
  typeLine,
  unique,
  webStorage,
} from './support/test';

const CAPTURE_LABEL = 'Browser mode: capture exclusion unavailable';

test('a view-only link shows the administrator’s typing live and lets the guest change nothing', async ({
  page,
  openContext,
}) => {
  await signIn(page, admin);
  const title = unique('View link');
  const documentId = await createDocument(page, title);
  await openDocument(page, documentId);
  await typeLine(page, 'Written before the guest arrived.');
  await expectSaved(page);

  // The administrator creates the link in the sharing panel; view only is the default.
  await page.getByTestId('open-sharing').click();
  await page.getByTestId('new-link').click();
  const form = page.getByTestId('create-link-form');
  await expect(form.getByRole('radio', { name: 'View only' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await form.getByTestId('create-link-submit').click();
  const callout = page.getByTestId('new-share-link');
  await callout.getByRole('button', { name: 'Show' }).click();
  const address = new URL(await callout.getByTestId('new-share-url').inputValue());
  expect(address.pathname).toMatch(/^\/s\/[0-9a-f-]{36}$/);
  expect(address.hash.length).toBeGreaterThan(20);
  await callout.getByTestId('new-share-done').click();

  // A separate browser profile opens the link: no account, no cookies in common.
  const guestContext = await openContext();
  const guest = await guestContext.newPage();
  const requests: string[] = [];
  guest.on('request', (request) => requests.push(request.url()));
  await guest.goto(`${address.pathname}${address.hash}`);
  await expect(guest).toHaveURL(new RegExp(`/d/${documentId}$`));
  await expectEditorReady(guest);
  // The secret left the address bar and never travelled in a URL.
  const secret = address.hash.slice(1);
  expect(requests.filter((url) => url.includes(secret))).toEqual([]);
  expect(guest.url()).not.toContain(secret);

  const guestContent = editorContent(guest);
  await expect(guestContent).toContainText('Written before the guest arrived.');
  await expect(guest.getByTestId('document-title')).toHaveText(title);
  await expect(guest.getByTestId('via-share-link')).toBeVisible();
  await expect(guest.getByTestId('document-role')).toHaveText('Viewer');
  await expect(guest.getByText(CAPTURE_LABEL, { exact: true })).toBeVisible();

  // No editing affordance of any kind.
  await expect(editorRoot(guest)).toHaveAttribute('data-editable', 'false');
  await expect(guestContent).toHaveAttribute('contenteditable', 'false');
  await expect(guest.getByTestId('rd-toolbar')).toHaveCount(0);
  await expect(guest.getByTestId('open-sharing')).toHaveCount(0);
  await expect(guest.getByTestId('open-snapshots')).toHaveCount(0);
  await expect(guest.getByTestId('rename-document')).toHaveCount(0);
  await expect(guest.getByTestId('rd-status-save')).toHaveAttribute('data-state', 'read_only');

  // The administrator's typing arrives without a reload.
  const live = unique('Typed while the guest watches');
  await typeLine(page, live);
  await expect(guestContent).toContainText(live);

  // The guest tries to type, to paste and to delete. Nothing changes anywhere.
  const paragraphs = await guestContent.locator('p').count();
  await guestContent.click();
  await guest.keyboard.type('GUEST-WAS-HERE');
  await guest.keyboard.press('ControlOrMeta+a');
  await guest.keyboard.press('Backspace');
  await guest.evaluate(() => {
    const target = document.querySelector('[data-testid="rd-editor-content"]');
    const data = new DataTransfer();
    data.setData('text/plain', 'GUEST-PASTED');
    target?.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  // One more round trip from the administrator proves the guest's page is still in step.
  const after = unique('Typed after the guest tried');
  await typeLine(page, after);
  await expectSaved(page);
  await expect(guestContent).toContainText(after);
  await expect(guestContent).not.toContainText('GUEST');
  // Exactly the administrator's one new paragraph was added; nothing was deleted.
  await expect(guestContent.locator('p')).toHaveCount(paragraphs + 1);
  await expect(guestContent).toContainText('Written before the guest arrived.');
  await expect(guestContent).toContainText(live);
  const stored = await exportedText(page, documentId);
  expect(stored).toContain(live);
  expect(stored).not.toContain('GUEST');
  await expect(editorContent(page)).not.toContainText('GUEST');

  // The guest's session cannot write through the API either.
  const rename = await callApi(guest, 'PATCH', `/api/documents/${documentId}`, { title: 'Mine' });
  expect(rename.status).toBeGreaterThanOrEqual(400);
  await expect(page.getByTestId('document-title')).toHaveText(title);
});

test('a viewer who follows the latest changes is scrolled to them, and the choice stays in their browser', async ({
  page,
  openContext,
}) => {
  await signIn(page, admin);
  const documentId = await createDocument(page, unique('Follow latest'));
  const link = await createShareLink(page, documentId);
  await openDocument(page, documentId);
  // A document several screens long.
  await pasteHtml(
    page,
    Array.from({ length: 70 }, (_, index) => `<p>Line ${index + 1} of a long document.</p>`).join(
      '',
    ),
  );
  await expect(editorContent(page).locator('p')).toHaveCount(70);
  await expectSaved(page);

  const guest = await (await openContext()).newPage();
  await guest.goto(link.path);
  await expectEditorReady(guest);
  await expect(editorContent(guest)).toContainText('Line 70 of a long document.');

  /** True when the paragraph with this text is inside the visible part of the document. */
  const inView = (text: string): Promise<boolean> =>
    guest.evaluate((needle) => {
      const scroller = document.querySelector('.rd-editor__scroll');
      const paragraph = [...document.querySelectorAll('[data-testid="rd-editor-content"] p')].find(
        (element) => element.textContent?.includes(needle),
      );
      if (!scroller || !paragraph) return false;
      const frame = scroller.getBoundingClientRect();
      const box = paragraph.getBoundingClientRect();
      return box.top >= frame.top && box.bottom <= frame.bottom;
    }, text);

  // Off by default: the reader stays where they are when something changes far below.
  const follow = guest.getByTestId('rd-follow-latest');
  await expect(follow).toHaveAttribute('data-state', 'off');
  const unfollowed = unique('Added while not following');
  await typeLine(page, unfollowed);
  await expect(editorContent(guest)).toContainText(unfollowed);
  expect(await inView(unfollowed)).toBe(false);
  expect(await inView('Line 1 of a long document.')).toBe(true);

  // Following: the next change is brought into view.
  await follow.click();
  await expect(follow).toHaveAttribute('data-state', 'on');
  const followed = unique('Added while following');
  await typeLine(page, followed);
  await expect.poll(() => inView(followed)).toBe(true);

  // The choice is the reader's own and is remembered in their browser.
  expect(await guest.evaluate(() => window.localStorage.getItem('rd.follow-latest.v1'))).toBe(
    'true',
  );
  await guest.reload();
  await expectEditorReady(guest);
  await expect(guest.getByTestId('rd-follow-latest')).toHaveAttribute('data-state', 'on');

  // For someone who writes it is a switch for the moment: it is not stored for next time.
  await page.getByTestId('rd-follow-latest').click();
  await expect(page.getByTestId('rd-follow-latest')).toHaveAttribute('data-state', /^(on|paused)$/);
  expect(await page.evaluate(() => window.localStorage.getItem('rd.follow-latest.v1'))).toBeNull();
});

test('an edit link lets the guest type and the administrator sees it live', async ({
  page,
  openContext,
}) => {
  await signIn(page, admin);
  const documentId = await createDocument(page, unique('Edit link'));
  const link = await createShareLink(page, documentId, { role: 'editor', label: 'Reviewers' });
  await openDocument(page, documentId);

  const guestContext = await openContext();
  const guest = await guestContext.newPage();
  await guest.goto(link.path);
  await expectEditorReady(guest);
  await expect(guest.getByTestId('document-role')).toHaveText('Editor');
  await expect(editorRoot(guest)).toHaveAttribute('data-editable', 'true');
  await expect(guest.getByTestId('rd-toolbar')).toBeVisible();
  await expect(guest.getByText(CAPTURE_LABEL, { exact: true })).toBeVisible();
  // Editing the text is all the link gives: no sharing, no snapshots, no renaming.
  await expect(guest.getByTestId('open-sharing')).toHaveCount(0);
  await expect(guest.getByTestId('open-snapshots')).toHaveCount(0);
  await expect(guest.getByTestId('rename-document')).toHaveCount(0);

  const fromGuest = unique('The guest wrote this');
  await typeLine(guest, fromGuest);
  await expect(editorContent(page)).toContainText(fromGuest);
  await expectSaved(guest);

  const fromAdmin = unique('The administrator answered');
  await typeLine(page, fromAdmin);
  await expect(editorContent(guest)).toContainText(fromAdmin);
  await expectSaved(page);

  // Both see the other one as a participant.
  await expect(page.getByTestId('rd-participants')).toContainText(/\S/);
  const stored = await exportedText(page, documentId);
  expect(stored).toContain(fromGuest);
  expect(stored).toContain(fromAdmin);

  // Local recovery is for accounts only. The administrator's browser keeps a copy
  // under the account's id; the guest's browser keeps nothing of the document, anywhere.
  const session = await callApi<{ user: { id: string } }>(page, 'GET', '/api/auth/session');
  expect(await localDatabases(page)).toEqual([`${LOCAL_DATABASE}${session.body.user.id}`]);
  expect(await allDatabases(guest)).toEqual([]);
  const guestStorage = await webStorage(guest);
  for (const text of [fromGuest, fromAdmin, documentId]) {
    expect(guestStorage).not.toContain(text);
  }

  // The sharing panel lists the guest as connected right now.
  await page.getByTestId('open-sharing').click();
  const row = page.locator(`[data-share-id="${link.id}"]`);
  await expect(row).toContainText('Reviewers');
  await expect(row).toContainText('Can edit');
  await expect(row).toContainText('1 connected now');
});

test('changing a link from edit to view-only takes the guest’s editing away at once, and back', async ({
  page,
  openContext,
}) => {
  await signIn(page, admin);
  const documentId = await createDocument(page, unique('Downgrade'));
  const link = await createShareLink(page, documentId, { role: 'editor', label: 'Contractors' });
  await openDocument(page, documentId);

  const guest = await (await openContext()).newPage();
  await guest.goto(link.path);
  await expectEditorReady(guest);
  await expect(guest.getByTestId('rd-toolbar')).toBeVisible();
  const fromGuest = unique('Written while editing was allowed');
  await typeLine(guest, fromGuest);
  await expectSaved(guest);

  const setAccess = async (choice: 'View only' | 'Can edit'): Promise<void> => {
    await page.locator(`[data-share-id="${link.id}"]`).getByTestId('share-actions').click();
    await page.getByRole('menuitem', { name: 'Edit access and expiry' }).click();
    const dialog = page.getByTestId('edit-link-dialog');
    await dialog.getByRole('radio', { name: choice }).click();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toHaveCount(0);
  };

  // The administrator makes the link view-only while the guest is connected.
  await page.getByTestId('open-sharing').click();
  await setAccess('View only');
  await expect(page.locator(`[data-share-id="${link.id}"]`)).toContainText('View only');

  // Without a reload the guest's toolbar is gone, the page says why, and typing does nothing.
  await expect(guest.getByTestId('rd-toolbar')).toHaveCount(0);
  await expect(editorRoot(guest)).toHaveAttribute('data-editable', 'false');
  await expect(guest.getByTestId('document-role')).toHaveText('Viewer');
  await expect(
    guest.locator('[data-testid="rd-banner-notice"][data-kind="role_changed"]'),
  ).toBeVisible();
  await expect(guest.getByTestId('rd-status-save')).toHaveAttribute('data-state', 'read_only');
  await editorContent(guest).click();
  await guest.keyboard.type('NOT-ALLOWED-ANY-MORE');
  const afterDowngrade = unique('Typed by the administrator after the downgrade');
  await typeLine(page, afterDowngrade);
  await expectSaved(page);
  await expect(editorContent(guest)).toContainText(afterDowngrade);
  await expect(editorContent(guest)).not.toContainText('NOT-ALLOWED');
  // What the guest wrote while it was allowed stays.
  const stored = await exportedText(page, documentId);
  expect(stored).toContain(fromGuest);
  expect(stored).not.toContain('NOT-ALLOWED');

  // Edit access given back: the toolbar returns and the guest's typing counts again.
  await setAccess('Can edit');
  await expect(guest.getByTestId('rd-toolbar')).toBeVisible();
  await expect(guest.getByTestId('document-role')).toHaveText('Editor');
  const again = unique('Written after editing came back');
  await typeLine(guest, again);
  await expectSaved(guest);
  await expect(editorContent(page)).toContainText(again);
});

test('revoking a link ends the connected guest’s access at once and for good', async ({
  page,
  openContext,
}) => {
  await signIn(page, admin);
  const documentId = await createDocument(page, unique('Revoked link'));
  const link = await createShareLink(page, documentId, { label: 'Agency' });
  await openDocument(page, documentId);
  const secretText = unique('Only for people with access');
  await typeLine(page, secretText);
  await expectSaved(page);

  const guestContext = await openContext();
  const guest = await guestContext.newPage();
  await guest.goto(link.path);
  await expectEditorReady(guest);
  await expect(editorContent(guest)).toContainText(secretText);

  // Revoke in the sharing panel while the guest is connected.
  await page.getByTestId('open-sharing').click();
  const row = page.locator(`[data-share-id="${link.id}"]`);
  await row.getByTestId('share-actions').click();
  await page.getByRole('menuitem', { name: 'Revoke link' }).click();
  await page.getByTestId('revoke-confirm').getByRole('button', { name: 'Revoke link' }).click();
  await expect(page.locator(`[data-share-id="${link.id}"]`)).toHaveAttribute(
    'data-share-state',
    'revoked',
  );

  // The guest's screen changes without a reload, and the document is gone from it.
  const ended = guest.getByTestId('access-ended');
  await expect(ended).toHaveAttribute('data-reason', 'access_revoked');
  await expect(
    ended.getByRole('heading', { name: 'Your access to this document was revoked' }),
  ).toBeVisible();
  await expect(ended).toContainText('The share link you used was revoked');
  await expect(guest).toHaveTitle(/^Access revoked/);
  await expect(editorRoot(guest)).toHaveCount(0);
  await expect(guest.locator('body')).not.toContainText(secretText);

  // Neither a reload nor the link itself gets back in.
  await guest.reload();
  await expect(guest.locator('body')).not.toContainText(secretText);
  await expect(editorRoot(guest)).toHaveCount(0);
  const summary = await callApi(guest, 'GET', `/api/documents/${documentId}`);
  expect(summary.status).toBeGreaterThanOrEqual(400);
  const text = await callApi(guest, 'GET', `/api/documents/${documentId}/export?format=txt`);
  expect(text.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(text.body)).not.toContain(secretText);

  await guest.goto(link.path);
  await expect(guest.getByTestId('share-exchange-error')).toContainText(
    'This share link was revoked',
  );
  await expect(editorRoot(guest)).toHaveCount(0);

  // The administrator's own session is untouched.
  await expect(editorContent(page)).toContainText(secretText);
  // A revoked link is final: the panel offers nothing for it and the server changes nothing.
  await page.getByTestId('inactive-links').locator('summary').click();
  await expect(
    page.locator(`[data-share-id="${link.id}"]`).getByTestId('share-actions'),
  ).toHaveCount(0);
  for (const [method, path, body] of [
    ['PATCH', `/api/documents/${documentId}/shares/${link.id}`, { label: 'Again' }],
    ['POST', `/api/documents/${documentId}/shares/${link.id}/rotate`, undefined],
  ] as const) {
    const answer = await callApi<{ error?: { code?: string } }>(page, method, path, body);
    expect({ path, status: answer.status, code: answer.body.error?.code }).toEqual({
      path,
      status: 409,
      code: 'conflict',
    });
  }
});

test('an expiring link ends the connected guest’s access when its time is up', async ({
  page,
  openContext,
}) => {
  await signIn(page, admin);
  const documentId = await createDocument(page, unique('Expiring link'));
  await openDocument(page, documentId);
  const secretText = unique('Readable until the link expires');
  await typeLine(page, secretText);
  await expectSaved(page);

  const lifetimeMs = 12_000;
  const link = await createShareLink(page, documentId, {
    expiresAt: new Date(Date.now() + lifetimeMs).toISOString(),
  });
  const guestContext = await openContext();
  const guest = await guestContext.newPage();
  await guest.goto(link.path);
  await expectEditorReady(guest);
  await expect(editorContent(guest)).toContainText(secretText);
  // The guest is told when access ends.
  await expect(guest.getByTestId('access-expiry')).toBeVisible();

  const ended = guest.getByTestId('access-ended');
  await expect(ended).toHaveAttribute('data-reason', 'access_expired', {
    timeout: lifetimeMs + 20_000,
  });
  await expect(
    ended.getByRole('heading', { name: 'Your access to this document has expired' }),
  ).toBeVisible();
  await expect(guest).toHaveTitle(/^Access expired/);
  await expect(editorRoot(guest)).toHaveCount(0);
  await expect(guest.locator('body')).not.toContainText(secretText);

  await guest.reload();
  await expect(guest.locator('body')).not.toContainText(secretText);
  await expect(editorRoot(guest)).toHaveCount(0);
  await guest.goto(link.path);
  await expect(guest.getByTestId('share-exchange-error')).toContainText(
    'This share link has expired',
  );

  // The administrator sees the link as expired and can extend it; the same link works again.
  await page.getByTestId('open-sharing').click();
  await page.getByTestId('inactive-links').locator('summary').click();
  const row = page.locator(`[data-share-id="${link.id}"]`);
  await expect(row).toHaveAttribute('data-share-state', 'expired');
  // An expired link cannot be rotated (the server refuses, the menu does not offer it)...
  const rotate = await callApi<{ error?: { code?: string } }>(
    page,
    'POST',
    `/api/documents/${documentId}/shares/${link.id}/rotate`,
  );
  expect({ status: rotate.status, code: rotate.body.error?.code }).toEqual({
    status: 409,
    code: 'conflict',
  });
  await row.getByTestId('share-actions').click();
  await expect(page.getByRole('menuitem')).toHaveText(['Extend or edit', 'Revoke link']);
  // ...but it can be extended.
  await page.getByRole('menuitem', { name: 'Extend or edit' }).click();
  const dialog = page.getByTestId('edit-link-dialog');
  await dialog.getByRole('button', { name: 'Extend link' }).click();
  await expect(page.locator(`[data-share-id="${link.id}"]`)).toHaveAttribute(
    'data-share-state',
    'active',
  );
  await guest.goto(link.path);
  await expectEditorReady(guest);
  await expect(editorContent(guest)).toContainText(secretText);
});

test('an image the administrator pastes is uploaded and reaches the guest through the asset endpoint', async ({
  page,
  openContext,
  browserName,
}, testInfo) => {
  await signIn(page, admin);
  const documentId = await createDocument(page, unique('Pasted image'));
  const link = await createShareLink(page, documentId);
  await openDocument(page, documentId);

  const guestContext = await openContext();
  const guest = await guestContext.newPage();
  const assetResponses: { url: string; status: number; type: string }[] = [];
  guest.on('response', (response) => {
    if (/\/api\/documents\/[^/]+\/assets\/[^/?]+/.test(response.url())) {
      assetResponses.push({
        url: response.url(),
        status: response.status(),
        type: response.headers()['content-type'] ?? '',
      });
    }
  });
  await guest.goto(link.path);
  await expectEditorReady(guest);

  // Slow the upload down (the request itself is untouched) so the placeholder can be seen.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/documents\/[^/]+\/assets$/, async (route) => {
    await gate;
    await route.continue();
  });

  const used = await insertImageFile(page, {
    name: 'diagonal.png',
    type: 'image/png',
    bytes: pngFile(),
  });
  // Which path the browser allowed is part of what this run verified: say so in the output.
  testInfo.annotations.push({ type: 'image inserted by', description: used });
  console.log(`[${browserName}] image handed to the editor by: ${used}`);

  const placeholder = page.getByTestId('rd-upload-placeholder');
  await expect(placeholder).toHaveAttribute('data-upload-state', 'uploading');
  // Until the upload is done the guest is shown no image.
  await expect(guest.locator('.rd-image__img')).toHaveCount(0);
  release();

  const content = editorContent(page);
  await expect(placeholder).toHaveCount(0);
  await expect(content.locator('.rd-image__img')).toHaveCount(1);
  await expect.poll(() => loadedImages(content, '.rd-image__img')).toBe(1);
  await expectSaved(page);

  // The guest gets the image, and its bytes come from the document's asset endpoint.
  const guestContent = editorContent(guest);
  await expect(guestContent.locator('.rd-image__img')).toHaveCount(1);
  await expect.poll(() => loadedImages(guestContent, '.rd-image__img')).toBe(1);
  const source = (await guestContent.locator('.rd-image__img').getAttribute('src')) ?? '';
  expect(source).toMatch(new RegExp(`^/api/documents/${documentId}/assets/[0-9a-f-]{36}$`));
  expect(assetResponses.filter((response) => response.status === 200)).toHaveLength(1);
  expect(assetResponses[0]?.type).toBe('image/png');

  // Without the guest's cookie the same address gives nothing away.
  const strangerContext = await openContext();
  const stranger = await strangerContext.newPage();
  await stranger.goto('/login');
  const refused = await callApi(stranger, 'GET', source);
  expect([401, 404]).toContain(refused.status);
});
