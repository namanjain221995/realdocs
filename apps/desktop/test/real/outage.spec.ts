import { expect, test } from '@playwright/test';
import { getState, waitForState } from '../smoke/helpers';
import {
  createDocument,
  createShare,
  editorContent,
  headerConnection,
  headerSave,
  launchConnected,
  openShare,
  remoteEditor,
  shot,
  typeAtEnd,
  waitLive,
} from './real-helpers';
import { adminAccount, serverControl } from './stack';

// The server goes away and comes back while the panel has a document open for editing.

test.afterEach(async () => {
  // Whatever happened in the test, leave the server running for the next one.
  await serverControl.start();
});

test('server stopped: the header says so and never claims Saved for text that was not sent; server back: live and saved', async () => {
  const documentId = await createDocument('Outage check', ['Written while the server was up.']);
  const share = await createShare(documentId, 'editor');
  const running = await launchConnected();
  try {
    const { panel } = running;
    await openShare(running, share);
    await expect(headerSave(panel)).toHaveAttribute('data-state', 'saved');

    await serverControl.stop();
    await expect(headerConnection(panel)).toHaveAttribute(
      'data-state',
      /^(reconnecting|offline)$/,
      { timeout: 30_000 },
    );
    // The document stays readable and editable; the work is kept on this side.
    await typeAtEnd(panel, ' Typed while the server was down.');
    await expect(editorContent(panel)).toContainText('Typed while the server was down.');
    await expect(headerSave(panel)).toHaveAttribute('data-state', /^(pending|error)$/);
    await expect(headerSave(panel)).not.toHaveText('Saved');
    // For several seconds: never "Saved", never "Live".
    const seen = new Set<string>();
    for (let index = 0; index < 20; index += 1) {
      seen.add(`${await headerConnection(panel).getAttribute('data-state')}`);
      seen.add(`save:${await headerSave(panel).getAttribute('data-state')}`);
      await panel.waitForTimeout(200);
    }
    expect([...seen]).not.toContain('live');
    expect([...seen]).not.toContain('save:saved');
    await shot(panel, 'server-down-changes-pending');

    await serverControl.start();
    // "Reconnect now" skips the waiting time of the automatic retry.
    await panel.locator('[data-testid="rd-retry-button"]').click();
    await waitLive(panel, 60_000);
    await expect(headerSave(panel)).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
    // The text reached the server and other clients.
    const remote = await remoteEditor(documentId);
    try {
      await remote.waitForText('Typed while the server was down.');
    } finally {
      remote.destroy();
    }
    const admin = await adminAccount();
    expect(await admin.api.documents.exportText(documentId, 'txt')).toContain(
      'Typed while the server was down.',
    );
    await shot(panel, 'server-back-live-saved');
  } finally {
    await running.close();
  }
});

test('server stopped and started with nobody clicking: the panel reconnects by itself', async () => {
  const documentId = await createDocument('Automatic reconnect check', ['Before the restart.']);
  const share = await createShare(documentId, 'viewer');
  const running = await launchConnected();
  try {
    const { panel } = running;
    await openShare(running, share);
    await serverControl.stop();
    await expect(headerConnection(panel)).toHaveAttribute(
      'data-state',
      /^(reconnecting|offline)$/,
      { timeout: 30_000 },
    );
    await serverControl.start();
    const remote = await remoteEditor(documentId);
    try {
      remote.appendParagraph('Written after the restart.');
      await remote.saved();
      // No click: the retry loop of the editor session finds the server again.
      await waitLive(panel, 90_000);
      await expect(editorContent(panel)).toContainText('Written after the restart.');
    } finally {
      remote.destroy();
    }
  } finally {
    await running.close();
  }
});

test('closing the document with changes that never reached the server asks first', async () => {
  const documentId = await createDocument('Unsent work check', ['Saved text.']);
  const share = await createShare(documentId, 'editor');
  const running = await launchConnected();
  try {
    const { panel } = running;
    await openShare(running, share);
    await serverControl.stop();
    await expect(headerConnection(panel)).toHaveAttribute(
      'data-state',
      /^(reconnecting|offline)$/,
      { timeout: 30_000 },
    );
    await typeAtEnd(panel, ' Not sent yet.');
    await expect(headerSave(panel)).toHaveAttribute('data-state', /^(pending|error)$/);

    // First choice: a warning, and the document stays open.
    await panel.click('[data-testid="rd-more-button"]');
    await panel.click('[data-testid="rd-close-document"]');
    await expect(panel.getByText('Some changes have not reached the server yet')).toBeVisible();
    await panel.waitForTimeout(500);
    expect((await getState(panel)).connection.session).not.toBeNull();
    await expect(editorContent(panel)).toContainText('Not sent yet.');
    await shot(panel, 'close-with-unsent-changes');

    // Choosing it again closes anyway.
    await panel.click('[data-testid="rd-more-button"]');
    await panel.click('[data-testid="rd-close-document"]');
    await waitForState(panel, (state) => state.connection.session === null, 'closed');
  } finally {
    await running.close();
  }
});

test('edit access removed while changes were unsent: nothing is published, and the work is kept as a draft that can be read', async () => {
  const admin = await adminAccount();
  const documentId = await createDocument('Draft check', ['Text everybody has.']);
  const share = await createShare(documentId, 'editor');
  const running = await launchConnected();
  try {
    const { app, panel } = running;
    await openShare(running, share);

    // The panel loses the server and its user keeps writing.
    await serverControl.stop();
    await expect(headerConnection(panel)).toHaveAttribute(
      'data-state',
      /^(reconnecting|offline)$/,
      { timeout: 30_000 },
    );
    // Keep the panel away from the network until the owner has acted, so the
    // order of events below does not depend on when its next retry happens.
    const offline = (value: boolean) =>
      app.evaluate(({ session }, off) => {
        const panelSession = session.fromPartition('persist:realtimedocs');
        if (off) panelSession.enableNetworkEmulation({ offline: true });
        else panelSession.disableNetworkEmulation();
      }, value);
    await offline(true);
    await typeAtEnd(panel, ' Written without a connection.');
    await expect(headerSave(panel)).toHaveAttribute('data-state', /^(pending|error)$/);

    // Meanwhile the server is back and the owner makes the link view-only.
    await serverControl.start();
    await admin.api.shares.update(documentId, share.id, { role: 'viewer' });
    await offline(false);
    await panel.locator('[data-testid="rd-retry-button"]').click();
    await waitLive(panel, 60_000);

    // The panel is a reader now, and the unsent text was not published.
    await expect(panel.locator('[data-testid="rd-header-access"]')).toHaveText('View only');
    await expect(panel.locator('[data-testid="rd-editor"]')).toHaveAttribute(
      'data-editable',
      'false',
    );
    await expect(editorContent(panel)).not.toContainText('Written without a connection.');
    const remote = await remoteEditor(documentId);
    try {
      await panel.waitForTimeout(1000);
      expect(remote.text()).toContain('Text everybody has.');
      expect(remote.text()).not.toContain('Written without a connection.');
    } finally {
      remote.destroy();
    }
    expect(await admin.api.documents.exportText(documentId, 'txt')).not.toContain(
      'Written without a connection.',
    );

    // The work is not lost: it is kept apart, and the panel can show it.
    const draftNotice = panel.locator('[data-testid="rd-banner-notice"][data-kind="draft_saved"]');
    await expect(draftNotice).toBeVisible();
    await expect(draftNotice).toContainText('were not published');
    await shot(panel, 'draft-kept-notice');
    await draftNotice.getByRole('button', { name: 'Open draft' }).click();
    const draft = panel.locator('[data-testid="rd-draft-view"]');
    await expect(draft).toBeVisible();
    await expect(draft).toContainText('Written without a connection.');
    await shot(panel, 'draft-view');
    await panel.click('[data-testid="rd-draft-close"]');
    await expect(draft).toHaveCount(0);
    await expect(editorContent(panel)).toBeVisible();
  } finally {
    await running.close();
  }
});
