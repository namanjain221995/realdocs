/**
 * Real stack, scenario a: the first complete path. Sign in, create a document,
 * type and format, see "Saved" only once the server has acknowledged, reload.
 */
import {
  admin,
  clickTool,
  connectionState,
  editorContent,
  editorRoot,
  expect,
  expectEditorFocused,
  expectEditorReady,
  expectSaved,
  exportedText,
  Link,
  occurrences,
  saveState,
  signIn,
  test,
  unique,
} from './support/test';

test('a new document is typed, formatted, saved by the server and intact after a reload', async ({
  page,
}) => {
  const link = await Link.attach(page);
  await signIn(page, admin);

  await page.getByTestId('new-document').click();
  await expect(page).toHaveURL(/\/d\/[0-9a-f-]{36}$/);
  const documentId = page.url().split('/d/')[1] ?? '';
  await expectEditorReady(page);
  await expect(editorRoot(page)).toHaveAttribute('data-editable', 'true');
  await expectSaved(page);
  // The indicator names the two states in the product's words.
  await expect(connectionState(page)).toHaveText('Live');
  await expect(saveState(page)).toHaveText('Saved');

  // "Saved" is the server's word, not the browser's: while what the server
  // sends is held back, typed text stays "Saving" however long we wait.
  const heading = unique('Launch plan');
  link.hold();
  await editorContent(page).click();
  await expectEditorFocused(page);
  await page.keyboard.type(heading);
  await expect(saveState(page)).toHaveAttribute('data-state', 'saving');
  await page.waitForTimeout(2_000);
  await expect(saveState(page)).toHaveAttribute('data-state', 'saving');
  link.release();
  await expectSaved(page);
  // And when it says "Saved", the server can already hand the text out.
  expect(await exportedText(page, documentId)).toContain(heading);

  // Format: a heading, bold and italic inline text, a list.
  await page.getByTestId('rd-tool-block').selectOption('heading1');
  await expectEditorFocused(page);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plain, ');
  await clickTool(page, 'Bold');
  await page.keyboard.type('bold');
  await clickTool(page, 'Bold');
  await page.keyboard.type(' and ');
  await page.keyboard.press('ControlOrMeta+i');
  await page.keyboard.type('italic');
  await page.keyboard.press('ControlOrMeta+i');
  await page.keyboard.type(' text.');
  await page.keyboard.press('Enter');
  await clickTool(page, 'Bulleted list');
  await page.keyboard.type('First item');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second item');

  const content = editorContent(page);
  await expect(content.locator('h1')).toHaveText(heading);
  await expect(content.locator('p strong')).toHaveText('bold');
  await expect(content.locator('p em')).toHaveText('italic');
  await expect(content.locator('ul li')).toHaveText(['First item', 'Second item']);
  await expectSaved(page);

  // The server's own Markdown export shows the same structure.
  const markdown = await page.evaluate(async (id) => {
    const response = await fetch(`/api/documents/${id}/export?format=md`);
    return response.text();
  }, documentId);
  expect(markdown).toContain(`# ${heading}`);
  expect(markdown).toContain('**bold**');
  expect(markdown).toMatch(/[*_]italic[*_]/);
  expect(markdown).toMatch(/[-*] First item\n[-*] Second item/);

  // Reload: the same content, once. Neither the copy kept on this device nor
  // the server's state is applied twice.
  await page.reload();
  await expectEditorReady(page);
  await expect(content.locator('h1')).toHaveText(heading);
  await expect(content.locator('h1')).toHaveCount(1);
  await expect(content.locator('ul li')).toHaveText(['First item', 'Second item']);
  expect(await occurrences(page, heading)).toBe(1);
  expect(await occurrences(page, 'Second item')).toBe(1);
  await expectSaved(page);
  const text = await exportedText(page, documentId);
  expect(text.split(heading).length - 1).toBe(1);
  expect(text.split('Plain, bold and italic text.').length - 1).toBe(1);

  // The dashboard lists the document as just edited.
  await page.getByTestId('back-to-documents').click();
  const row = page.locator(`[data-testid="document-row"][data-document-id="${documentId}"]`);
  await expect(row).toContainText('Untitled document');
  await expect(row).toContainText('Edited just now');
});
