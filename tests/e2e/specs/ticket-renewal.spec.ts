/**
 * Acceptance scenario 16 in browsers: collaboration tickets renew correctly during long sessions
 * and the editor reconnects after renewal.
 *
 * The stack's server is restarted with `COLLAB_TICKET_TTL_SECONDS=1`, so every ticket is dead one
 * second after it was issued. Two browser profiles (administrator and an editing guest) keep
 * the document open and keep typing for many ticket lifetimes: the sessions must stay live, every
 * edit must be acknowledged ("Saved") and reach the other side. The administrator's browser is
 * then taken offline and online again: the reconnect needs a new ticket (the old one is long
 * expired and was single-use), the edit made while offline is kept, and the document ends with
 * every sentence exactly once on both screens and in the server's export.
 * The server-side half (ticket reuse refused, expired ticket refused, downgrade and revocation
 * during a long session) is `long-session.test.ts` and `collab.test.ts`.
 *
 * Runs in the `disruptive-*` projects: it restarts the shared server.
 */
import { COLLAB_PROTOCOL_VERSION, DOCUMENT_SCHEMA_VERSION } from '@realtimedocs/contracts';
import {
  admin,
  callApi,
  configureServer,
  connectionState,
  createDocument,
  createShareLink,
  editorContent,
  exportedText,
  expect,
  expectEditorReady,
  expectSaved,
  occurrences,
  openDocument,
  signIn,
  test,
  unique,
} from '../support/test';

test.afterAll(async () => {
  await configureServer(); // back to the default lifetimes for whatever runs next
});

test('sessions that outlive many tickets keep working and reconnect with a new ticket', async ({
  page,
  openContext,
}) => {
  test.setTimeout(180_000);
  await configureServer({ COLLAB_TICKET_TTL_SECONDS: '1' });
  await signIn(page, admin);
  const id = await createDocument(page, unique('Ticket renewal'));
  const share = await createShareLink(page, id, { role: 'editor' });
  // The setting took effect: a ticket asked for now is valid for about one second.
  const issued = await callApi<{ expiresAt: string }>(
    page,
    'POST',
    `/api/documents/${id}/collab-ticket`,
    {
      clientId: 4_242_424,
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      protocolVersion: COLLAB_PROTOCOL_VERSION,
    },
  );
  expect(issued.status).toBe(200);
  expect(new Date(issued.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(1_500);
  await openDocument(page, id);
  const guest = await (await openContext()).newPage();
  await guest.goto(share.path);
  await expectEditorReady(guest);

  // A long session: ten seconds, ten ticket lifetimes, edits from both sides throughout.
  const startedAt = Date.now();
  for (let round = 1; round <= 5; round += 1) {
    await editorContent(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(`Admin sentence ${round}. `);
    await expect(editorContent(guest)).toContainText(`Admin sentence ${round}.`);
    await editorContent(guest).click();
    await guest.keyboard.press('ControlOrMeta+End');
    await guest.keyboard.type(`Guest sentence ${round}. `);
    await expect(editorContent(page)).toContainText(`Guest sentence ${round}.`);
    await expectSaved(page);
    await expectSaved(guest);
    await page.waitForTimeout(1_500);
  }
  expect(
    Date.now() - startedAt,
    'the session outlived at least ten ticket lifetimes',
  ).toBeGreaterThan(10_000);
  await expect(connectionState(page)).toHaveAttribute('data-state', 'live');
  await expect(connectionState(guest)).toHaveAttribute('data-state', 'live');

  // Drop the administrator's connection, edit offline, come back: a new ticket is needed.
  await page.context().setOffline(true);
  await expect(connectionState(page)).not.toHaveAttribute('data-state', 'live', {
    timeout: 30_000,
  });
  await editorContent(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('Written offline. ');
  await page.waitForTimeout(2_500); // longer than a ticket lives
  await page.context().setOffline(false);
  await expectEditorReady(page);
  await expectSaved(page);
  await expect(editorContent(guest)).toContainText('Written offline.');

  const stored = await exportedText(page, id);
  for (let round = 1; round <= 5; round += 1) {
    expect(occurrences(stored, `Admin sentence ${round}.`), `admin sentence ${round}`).toBe(1);
    expect(occurrences(stored, `Guest sentence ${round}.`), `guest sentence ${round}`).toBe(1);
  }
  expect(occurrences(stored, 'Written offline.')).toBe(1);
});
