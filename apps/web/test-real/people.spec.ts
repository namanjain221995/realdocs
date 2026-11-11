/**
 * Real stack, scenarios g and j: accounts. What a member can reach, and what
 * one account leaves behind in a browser for the next one.
 */
import type { Page } from '@playwright/test';
import {
  type Account,
  addMember,
  admin,
  callApi,
  connectionState,
  createDocument,
  editorContent,
  editorRoot,
  expect,
  expectEditorReady,
  expectReconnected,
  expectSaved,
  insertImageFile,
  inviteMember,
  Link,
  loadedImages,
  LOCAL_DATABASE,
  localDatabases,
  openDocument,
  pngFile,
  saveState,
  signIn,
  test,
  typeLine,
  unique,
  webStorage,
} from './support/test';

async function signOut(page: Page, options: { confirm?: RegExp } = {}): Promise<void> {
  await page.getByRole('button', { name: /^Account menu for / }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  if (options.confirm) {
    const confirm = page.getByTestId('sign-out-confirm');
    await expect(confirm).toContainText(options.confirm);
    await confirm.getByRole('button', { name: 'Sign out and delete' }).click();
  }
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
}

test('a member invited by link sees only the documents they were added to', async ({
  page,
  openContext,
}) => {
  await signIn(page, admin);
  const sharedTitle = unique('Shared with the member');
  const hiddenTitle = unique('Not for the member');
  const sharedId = await createDocument(page, sharedTitle);
  const hiddenId = await createDocument(page, hiddenTitle);

  // The document the member must not reach has text, an image and a snapshot.
  await openDocument(page, hiddenId);
  const hiddenText = unique('Confidential paragraph');
  await typeLine(page, hiddenText);
  await insertImageFile(
    page,
    { name: 'plan.png', type: 'image/png', bytes: pngFile() },
    'file chooser',
  );
  await expect.poll(() => loadedImages(editorContent(page), '.rd-image__img')).toBe(1);
  await expectSaved(page);
  // The uploader's own screen may still show its local copy; the stored document names the asset.
  const json = await callApi(page, 'GET', `/api/documents/${hiddenId}/export?format=json`);
  const assetId = /"assetId":"([0-9a-f-]{36})"/.exec(JSON.stringify(json.body))?.[1];
  expect(assetId, 'asset id in the stored document').toBeTruthy();
  const assetPath = `/api/documents/${hiddenId}/assets/${assetId}`;
  expect((await callApi(page, 'GET', assetPath)).status).toBe(200);
  const snapshot = await callApi<{ snapshot: { id: string } }>(
    page,
    'POST',
    `/api/documents/${hiddenId}/snapshots`,
    { name: 'Before review' },
  );
  expect(snapshot.status).toBe(201);

  // The administrator creates the invitation on the People page; the link is shown once.
  const email = `mina.${Math.random().toString(36).slice(2, 10)}@realtimedocs.test`;
  await page.goto('/admin/users?tab=invitations');
  const form = page.getByTestId('create-invitation-form');
  await form.getByTestId('invitation-email').fill(email);
  await form.getByRole('button', { name: 'Create invitation' }).click();
  const callout = page.getByTestId('new-invitation');
  await callout.getByRole('button', { name: 'Show' }).click();
  const invitation = new URL(await callout.getByTestId('new-invitation-url').inputValue());
  await callout.getByTestId('new-invitation-done').click();

  // The invited person accepts in a browser of their own.
  const memberContext = await openContext();
  const member = await memberContext.newPage();
  await member.goto(`${invitation.pathname}${invitation.hash}`);
  await expect(member.getByTestId('invite-facts')).toContainText(email);
  await member.getByLabel('Name').fill('Mina Member');
  const password = `mina-${Math.random().toString(36).slice(2, 12)}-harbor-lantern`;
  await member.getByLabel('Password', { exact: true }).fill(password);
  await member.getByLabel('Confirm password').fill(password);
  await member.getByRole('button', { name: 'Create account' }).click();
  await expect(member.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();

  // A member starts with nothing, cannot create documents and has no People page.
  await expect(member.getByTestId('documents-empty')).toBeVisible();
  await expect(member.getByTestId('new-document')).toHaveCount(0);
  await expect(member.getByRole('link', { name: 'People' })).toHaveCount(0);

  // The administrator adds the member to one document, as an editor.
  await page.goto(`/d/${sharedId}?panel=share`);
  const addForm = page.getByTestId('add-member-form');
  await addForm.getByTestId('add-member-select').selectOption({ label: `Mina Member (${email})` });
  await addForm.getByRole('radio', { name: 'Can edit' }).click();
  await addForm.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('member-row')).toContainText('Mina Member');

  // The member's list has that document and only that one, in every view.
  await member.reload();
  const rows = member.getByTestId('document-row');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(sharedTitle);
  // Trash is an administrator's view; a member is not offered it.
  await expect(member.getByRole('tab')).toHaveText(['Active', 'Recent', 'Archived']);
  for (const tab of ['Recent', 'Archived']) {
    await member.getByRole('tab', { name: tab }).click();
    await expect(member.getByRole('tabpanel')).not.toContainText(hiddenTitle);
    await expect(member.getByRole('tabpanel')).not.toContainText('Welcome to RealtimeDocs');
  }
  await member.getByRole('tab', { name: 'Active' }).click();
  await member.getByTestId('document-search').fill('Not for');
  await expect(member.getByTestId('document-row')).toHaveCount(0);
  // The trash is not a member's to look into: the server answers with an empty list.
  const trash = await callApi<{ documents: unknown[] }>(member, 'GET', '/api/documents?view=trash');
  expect({ status: trash.status, documents: trash.body.documents }).toEqual({
    status: 200,
    documents: [],
  });

  // The member can open and edit the shared document, but not manage it.
  await member.goto(`/d/${sharedId}`);
  await expectEditorReady(member);
  await expect(editorRoot(member)).toHaveAttribute('data-editable', 'true');
  await expect(member.getByTestId('open-sharing')).toHaveCount(0);
  await expect(member.getByTestId('open-snapshots')).toHaveCount(0);
  const fromMember = unique('The member wrote this');
  await typeLine(member, fromMember);
  await expectSaved(member);
  await expect(editorContent(page)).toContainText(fromMember);

  // Every address of the other document answers "not found", on screen and from the API.
  for (const path of [
    `/d/${hiddenId}`,
    `/d/${hiddenId}?panel=snapshots`,
    `/d/${hiddenId}?panel=share`,
  ]) {
    await member.goto(path);
    await expect(member.getByTestId('document-error')).toHaveAttribute(
      'data-error-kind',
      'not_found',
    );
    await expect(editorRoot(member)).toHaveCount(0);
    await expect(member.getByTestId('snapshots-panel')).toHaveCount(0);
    await expect(member.getByTestId('sharing-panel')).toHaveCount(0);
    await expect(member.locator('body')).not.toContainText(hiddenTitle);
  }
  await member.goto(`/d/${hiddenId}/print`);
  await expect(member.getByTestId('document-error')).toHaveAttribute(
    'data-error-kind',
    'not_found',
  );
  await expect(member.getByTestId('print-body')).toHaveCount(0);
  await expect(member.locator('body')).not.toContainText(hiddenText);
  await expect(member.locator('body')).not.toContainText(hiddenTitle);

  const refused = [
    `/api/documents/${hiddenId}`,
    assetPath,
    `/api/documents/${hiddenId}/export?format=txt`,
    `/api/documents/${hiddenId}/export?format=md-zip`,
    `/api/documents/${hiddenId}/snapshots`,
    `/api/documents/${hiddenId}/shares`,
    `/api/documents/${hiddenId}/access`,
  ];
  for (const path of refused) {
    const answer = await callApi<{ error?: { code?: string } }>(member, 'GET', path);
    expect({ path, status: answer.status, code: answer.body.error?.code }).toEqual({
      path,
      status: 404,
      code: 'not_found',
    });
    expect(JSON.stringify(answer.body)).not.toContain(hiddenText);
  }
  const ticket = await callApi(member, 'POST', `/api/documents/${hiddenId}/collab-ticket`, {
    clientId: 1,
    schemaVersion: 1,
  });
  expect(ticket.status).toBe(404);
  // The administrator gets an answer from the same addresses, so the refusals are about access.
  expect((await callApi(page, 'GET', `/api/documents/${hiddenId}/snapshots`)).status).toBe(200);

  // On the shared document the member is an editor, not an administrator: its snapshots are closed too.
  const own = await callApi(member, 'GET', `/api/documents/${sharedId}/snapshots`);
  expect(own.status).toBeGreaterThanOrEqual(400);
});

/**
 * Leaves `page` (signed in as `account`, an editor of the document) with a
 * recovery draft: text typed while cut off, then a snapshot restored by the
 * administrator before the page reconnects.
 */
async function leaveRecoveryDraft(
  page: Page,
  adminPage: Page,
  documentId: string,
): Promise<{ kept: string; unsent: string }> {
  const link = await Link.attach(page);
  await openDocument(page, documentId);
  const kept = unique('Kept on the server');
  await typeLine(page, kept);
  await expectSaved(page);
  const snapshot = await callApi<{ snapshot: { id: string } }>(
    adminPage,
    'POST',
    `/api/documents/${documentId}/snapshots`,
    { name: 'Checkpoint' },
  );
  expect(snapshot.status).toBe(201);

  link.disconnect();
  await expect(connectionState(page)).not.toHaveAttribute('data-state', 'live');
  const unsent = unique('UNSENT-WORK');
  await typeLine(page, unsent);
  await expect(saveState(page)).toHaveAttribute('data-state', 'pending');

  const restored = await callApi(
    adminPage,
    'POST',
    `/api/documents/${documentId}/snapshots/${snapshot.body.snapshot.id}/restore`,
  );
  expect(restored.status).toBe(200);

  link.reconnect();
  await expectReconnected(page);
  const notice = page.locator('[data-testid="rd-banner-notice"][data-kind="restored"]');
  await expect(notice).toContainText('recovery draft');
  // The unsent text was neither merged nor published.
  await expect(editorContent(page)).not.toContainText(unsent);
  await expect(editorContent(page)).toContainText(kept);
  return { kept, unsent };
}

async function expectDraft(page: Page, title: string, unsent: string): Promise<void> {
  await page.goto('/settings');
  const row = page.getByTestId('draft-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(title);
  await expect(row).toContainText('A snapshot was restored while this work was unsaved');
  await row.getByTestId('draft-open').click();
  const dialog = page.getByTestId('draft-preview-dialog');
  await expect(dialog.getByTestId('draft-preview')).toContainText(unsent);
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(dialog).toHaveCount(0);
}

async function prepare(
  adminPage: Page,
  page: Page,
  otherPage: Page,
): Promise<{
  documentId: string;
  title: string;
  first: Account & { id: string };
  second: Account;
}> {
  await signIn(adminPage, admin);
  const title = unique('Shared desk');
  const documentId = await createDocument(adminPage, title);
  const first = await inviteMember(adminPage, page, 'First Person');
  const second = await inviteMember(adminPage, otherPage, 'Second Person');
  await addMember(adminPage, documentId, first.id, 'editor');
  return { documentId, title, first, second };
}

test('signing out deletes the account’s local work, and the next account in the same browser finds nothing', async ({
  page,
  openContext,
}) => {
  const adminPage = await (await openContext()).newPage();
  const spare = await openContext();
  const { documentId, title, first, second } = await prepare(
    adminPage,
    page,
    await spare.newPage(),
  );
  await spare.close();

  const { kept, unsent } = await leaveRecoveryDraft(page, adminPage, documentId);
  expect(await localDatabases(page)).toEqual([`${LOCAL_DATABASE}${first.id}`]);
  await expectDraft(page, title, unsent);

  // Signing out says what will be deleted, and deletes it.
  await signOut(page, { confirm: /including 1 recovery draft/ });
  expect(await localDatabases(page)).toEqual([]);
  expect(await webStorage(page)).not.toContain(unsent);
  expect(await webStorage(page)).not.toContain(kept);

  // The next person signs in in the same browser profile.
  await signIn(page, second);
  await page.goto('/settings');
  await expect(page.getByTestId('drafts-empty')).toBeVisible();
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  // The first account's document is not theirs to open, by address or by going back.
  await page.goto(`/d/${documentId}`);
  await expect(page.getByTestId('document-error')).toHaveAttribute('data-error-kind', 'not_found');
  await expect(page.locator('body')).not.toContainText(kept);
  await expect(page.locator('body')).not.toContainText(title);
  await page.goBack();
  await expect(page.locator('body')).not.toContainText(unsent);
  await expect(page.locator('body')).not.toContainText(title);
  expect(await localDatabases(page)).not.toContain(`${LOCAL_DATABASE}${first.id}`);

  // It is gone for the first account as well: deleted, not hidden.
  await signOut(page);
  await signIn(page, first);
  await page.goto('/settings');
  await expect(page.getByTestId('drafts-empty')).toBeVisible();
});

test('an account whose session was ended elsewhere keeps its local work to itself: another account cannot reach it, the owner finds it again', async ({
  page,
  openContext,
}) => {
  const adminPage = await (await openContext()).newPage();
  const elsewhere = await (await openContext()).newPage();
  const { documentId, title, first, second } = await prepare(adminPage, page, elsewhere);

  const { kept, unsent } = await leaveRecoveryDraft(page, adminPage, documentId);
  await expectDraft(page, title, unsent);

  // The first person has the document open here, signs in on another device
  // and ends every other session there.
  await openDocument(page, documentId);
  const otherDevice = await (await openContext()).newPage();
  await signIn(otherDevice, first);
  await otherDevice.goto('/settings');
  await otherDevice.getByTestId('sign-out-everywhere-else').click();
  await expect(otherDevice.getByText('Signed out 1 other session', { exact: true })).toBeVisible();

  // This browser is told at once, without a reload: the document leaves the screen.
  const ended = page.getByTestId('access-ended');
  await expect(ended).toHaveAttribute('data-reason', 'access_expired');
  await expect(ended.getByRole('heading', { name: 'Your session has ended' })).toBeVisible();
  await expect(ended.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(editorRoot(page)).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(kept);
  // A reload does not bring the document back either: the server no longer knows this browser.
  await page.reload();
  await expect(page.getByTestId('document-error')).toHaveAttribute(
    'data-error-kind',
    'session_expired',
  );
  await expect(page.locator('body')).not.toContainText(kept);
  // It was signed out without having had the chance to clean up: the local work is still there.
  expect(await localDatabases(page)).toEqual([`${LOCAL_DATABASE}${first.id}`]);

  // Another account signs in here. Nothing of the first account is offered to it.
  await signIn(page, second);
  await page.goto('/settings');
  await expect(page.getByTestId('drafts-empty')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(title);
  await page.goto(`/d/${documentId}`);
  await expect(page.getByTestId('document-error')).toHaveAttribute('data-error-kind', 'not_found');
  // Its own sign-out has nothing to delete, asks nothing, and leaves the other account's data alone.
  await signOut(page);
  expect(await localDatabases(page)).toContain(`${LOCAL_DATABASE}${first.id}`);

  // The owner signs in again and the draft is still there.
  await signIn(page, first);
  await expectDraft(page, title, unsent);
});
