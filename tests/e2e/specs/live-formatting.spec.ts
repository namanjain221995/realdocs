/**
 * Acceptance scenarios 1 and 2 end to end on the real stack, with formatting: the administrator
 * creates a document and a view-only share link in the interface; an isolated recipient (its own
 * browser profile, no account) opens the link; text and formatting typed afterwards appear on the
 * recipient's screen without a reload: heading, bold, italic, a bullet list and a link.
 *
 * (`apps/web/test-real/sharing.spec.ts` covers the link panel, the secret handling and plain text;
 * the editor's own browser checks cover formatting between two panes on a fixture server. This is
 * the combination: real server, real link, real formatting.)
 */
import {
  admin,
  createDocument,
  createShareLink,
  editorContent,
  expect,
  expectEditorReady,
  expectSaved,
  openDocument,
  signIn,
  test,
  unique,
} from '../support/test';

test('formatting typed by the administrator reaches an isolated link recipient without a reload', async ({
  page,
  openContext,
}) => {
  test.setTimeout(120_000);
  await signIn(page, admin);
  const id = await createDocument(page, unique('Live formatting'));
  const share = await createShareLink(page, id, { role: 'viewer' });
  await openDocument(page, id);

  const guest = await (await openContext()).newPage();
  const loads: string[] = [];
  guest.on('load', () => loads.push(guest.url()));
  await guest.goto(share.path);
  await expectEditorReady(guest);
  const view = editorContent(guest);
  const loadsBefore = loads.length;

  await editorContent(page).click();
  // Markdown shortcuts and keyboard shortcuts, as a person would type them.
  await page.keyboard.type('## Quarterly review');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plain then ');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('bold');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type(' and ');
  await page.keyboard.press('ControlOrMeta+i');
  await page.keyboard.type('italic');
  await page.keyboard.press('ControlOrMeta+i');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- first item');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second item');

  await expect(view.locator('h2', { hasText: 'Quarterly review' })).toBeVisible();
  await expect(view.locator('strong', { hasText: 'bold' })).toBeVisible();
  await expect(view.locator('em', { hasText: 'italic' })).toBeVisible();
  await expect(view.locator('ul li', { hasText: 'second item' })).toBeVisible();
  await expectSaved(page);

  // Nothing was reloaded to get here, and the recipient still cannot edit.
  expect(loads.length).toBe(loadsBefore);
  await expect(view).toHaveAttribute('contenteditable', 'false');
});
