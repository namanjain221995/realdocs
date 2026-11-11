/**
 * Real stack, scenario h: a named snapshot is saved, the text changes, the
 * snapshot is restored, and everyone connected moves to the new generation.
 */
import {
  admin,
  callApi,
  createDocument,
  createShareLink,
  editorContent,
  expect,
  expectEditorReady,
  expectSaved,
  exportedText,
  openDocument,
  signIn,
  test,
  typeLine,
  unique,
} from './support/test';

test('restoring a snapshot moves the administrator and a connected guest to the restored text', async ({
  page,
  openContext,
}) => {
  await signIn(page, admin);
  const documentId = await createDocument(page, unique('Snapshots'));
  const link = await createShareLink(page, documentId, { role: 'editor' });
  await openDocument(page, documentId);
  const workspace = page.getByTestId('document-workspace');
  const generation = Number(await workspace.getAttribute('data-generation'));

  const approved = unique('Approved wording');
  await typeLine(page, approved);
  await expectSaved(page);

  const guestContext = await openContext();
  const guest = await guestContext.newPage();
  await guest.goto(link.path);
  await expectEditorReady(guest);
  await expect(editorContent(guest)).toContainText(approved);

  // Save a named snapshot in the panel.
  await page.getByTestId('open-snapshots').click();
  const panel = page.getByTestId('snapshots-panel');
  await panel.getByTestId('snapshot-name').fill('Approved by legal');
  await panel.getByRole('button', { name: 'Save snapshot' }).click();
  const saved = panel.getByTestId('snapshot-row').filter({ hasText: 'Approved by legal' });
  await expect(saved).toHaveCount(1);
  await expect(saved).toContainText(`Generation ${generation}`);

  // Both keep writing after the snapshot.
  const later = unique('Later rewrite');
  await typeLine(page, later);
  const fromGuest = unique('Guest addition');
  await typeLine(guest, fromGuest);
  await expect(editorContent(page)).toContainText(fromGuest);
  await expect(editorContent(guest)).toContainText(later);
  await expectSaved(page);
  await expectSaved(guest);

  // Restore.
  await saved.getByTestId('snapshot-restore').click();
  const confirm = page.getByTestId('restore-confirm');
  await expect(confirm).toContainText('starts a new generation of the document');
  await confirm.getByRole('button', { name: 'Restore snapshot' }).click();
  await expect(confirm).toHaveCount(0);

  // Without a reload, both screens show the restored text and nothing written after it.
  for (const view of [page, guest]) {
    const content = editorContent(view);
    await expect(content).not.toContainText(later);
    await expect(content).not.toContainText(fromGuest);
    await expect(content).toContainText(approved);
    await expectEditorReady(view);
    // Each is told what happened.
    await expect(
      view.locator('[data-testid="rd-banner-notice"][data-kind="restored"]'),
    ).toBeVisible();
  }
  await expect(workspace).toHaveAttribute('data-generation', String(generation + 1));
  await expect(guest.getByTestId('document-workspace')).toHaveAttribute(
    'data-generation',
    String(generation + 1),
  );
  const summary = await callApi<{ document: { generation: number } }>(
    page,
    'GET',
    `/api/documents/${documentId}`,
  );
  expect(summary.body.document.generation).toBe(generation + 1);

  // What was replaced is kept as an automatic snapshot.
  const automatic = panel.locator('[data-testid="snapshot-row"][data-kind="pre_restore"]');
  await expect(automatic).toHaveCount(1);

  // The new generation is live for both: text typed now reaches the other side and the server.
  const afterRestore = unique('Written after the restore');
  await typeLine(guest, afterRestore);
  await expect(editorContent(page)).toContainText(afterRestore);
  await expectSaved(guest);
  const stored = await exportedText(page, documentId);
  expect(stored).toContain(approved);
  expect(stored).toContain(afterRestore);
  expect(stored).not.toContain(later);
  expect(stored).not.toContain(fromGuest);

  // A reload shows the same.
  await guest.reload();
  await expectEditorReady(guest);
  await expect(editorContent(guest)).toContainText(afterRestore);
  await expect(editorContent(guest)).not.toContainText(later);
});
