import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { getState, launchApp, launchSecondInstance, waitForState } from '../smoke/helpers';
import {
  createDocument,
  createShare,
  editorContent,
  headerConnection,
  headerSave,
  launchConnected,
  mainProcessToken,
  openSettings,
  openShare,
  shot,
  typeAtEnd,
  waitLive,
} from './real-helpers';
import { SERVER_ORIGIN, adminAccount } from './stack';

// Access that ends (revoked, expired) and access that is remembered (restart).
//
// The test container has no operating-system secret store, so the app keeps
// the session in memory there and says so (first test). To exercise the path
// that stores the session, restores it after a restart and deletes it when the
// server ends it, the other tests start the app with the stand-in key store of
// the test hook (`RD_DESKTOP_TEST_KEYSTORE=1`, development builds only). That
// stand-in is not encryption and is not what a user's machine would use; what
// these tests show is everything around the store.
const KEYSTORE = { RD_DESKTOP_TEST_KEYSTORE: '1' };
const sessionFile = (userData: string) => path.join(userData, 'session.bin');

test('this environment: what secure storage it offers, how the app labels it, and what a restart does', async () => {
  const documentId = await createDocument('Storage label check', ['Kept in memory only here.']);
  const share = await createShare(documentId, 'editor');
  const running = await launchConnected();
  const userData = running.userData;
  try {
    await openShare(running, share);
    const { credentials } = await getState(running.panel);
    // Reported in the test output for the notes: backend offered and the app's label.
    test.info().annotations.push({
      type: 'credential-storage',
      description: JSON.stringify(credentials),
    });
    console.log(`credential storage in this environment: ${JSON.stringify(credentials)}`);
    if (credentials.backend === 'basic_text' || credentials.backend === 'unknown') {
      // Chromium's fallback is not encryption at rest: the app refuses to use it.
      expect(credentials.mode).toBe('memory_only');
      expect(credentials.detail).toContain('memory only');
      expect(fs.existsSync(sessionFile(running.userData))).toBe(false);
    } else {
      expect(credentials.mode).toBe('os_encrypted');
      expect(fs.existsSync(sessionFile(running.userData))).toBe(true);
    }
  } finally {
    await running.close();
  }

  // After a restart the session is there only if it could be stored.
  const again = await launchApp({ userData });
  try {
    const state = await waitForState(
      again.panel,
      (current) => current.connection.server.status === 'ok',
      'the server check after restart',
    );
    const stored = state.credentials.mode === 'os_encrypted';
    expect(state.connection.session !== null).toBe(stored);
    if (!stored) {
      await expect(again.panel.locator('[data-testid="rd-empty-no-document"]')).toBeVisible();
    }
  } finally {
    await again.close();
  }
});

test('restart with a stored session: the document comes back live without asking again', async () => {
  const documentId = await createDocument('Restart check', ['Still here after a restart.']);
  const share = await createShare(documentId, 'editor');
  const first = await launchConnected({ env: KEYSTORE });
  try {
    await openShare(first, share);
    const state = await getState(first.panel);
    expect(state.credentials).toMatchObject({ mode: 'os_encrypted', backend: 'test_keystore' });
    expect(fs.existsSync(sessionFile(first.userData))).toBe(true);
    // What is on disk is not the plain session: neither the server nor the document id is readable.
    const blob = fs.readFileSync(sessionFile(first.userData));
    expect(blob.includes(Buffer.from(documentId))).toBe(false);
    expect(blob.includes(Buffer.from(SERVER_ORIGIN))).toBe(false);
  } finally {
    await first.close();
  }

  const second = await launchApp({ userData: first.userData, env: KEYSTORE });
  try {
    // No link is pasted and no handoff happens: the app restores, asks the server, and connects.
    const state = await waitForState(
      second.panel,
      (current) => current.connection.session !== null,
      'the restored session',
      30_000,
    );
    expect(state.connection.session).toMatchObject({ documentId, restored: true, role: 'editor' });
    await waitLive(second.panel);
    await expect(editorContent(second.panel)).toContainText('Still here after a restart.');
    await expect(second.panel.locator('[data-testid="rd-header-access"]')).toHaveText('Can edit');
    await shot(second.panel, 'restored-after-restart');
  } finally {
    await second.close();
  }
});

for (const scenario of ['revoked', 'expired'] as const) {
  test(`a link that is ${scenario} while the panel is connected: the panel says so, the stored session is deleted, a restart does not reconnect`, async () => {
    const admin = await adminAccount();
    const documentId = await createDocument(`Access ${scenario} check`, [
      'Readable only while access lasts.',
    ]);
    const share = await createShare(documentId, 'viewer');
    const running = await launchConnected({ env: KEYSTORE });
    try {
      const { panel } = running;
      await openShare(running, share);
      await expect(editorContent(panel)).toContainText('Readable only while access lasts.');
      expect(fs.existsSync(sessionFile(running.userData))).toBe(true);

      if (scenario === 'revoked') {
        await admin.api.shares.revoke(documentId, share.id);
      } else {
        // An earlier expiry is applied to open connections; this one is a few seconds away.
        await admin.api.shares.update(documentId, share.id, {
          expiresAt: new Date(Date.now() + 4000).toISOString(),
        });
      }

      const ended = scenario === 'revoked' ? 'access_revoked' : 'access_expired';
      // The panel shows the state, in the header and where the document was.
      await expect(panel.locator('[data-testid="rd-empty-access-ended"]')).toHaveAttribute(
        'data-state',
        ended,
        { timeout: 30_000 },
      );
      await expect(headerConnection(panel)).toHaveAttribute('data-state', ended);
      await expect(headerConnection(panel)).toHaveText(
        scenario === 'revoked' ? 'Access revoked' : 'Access expired',
      );
      const state = await getState(panel);
      expect(state.connection.session).toBeNull();
      expect(state.connection.notice?.code).toBe(
        scenario === 'revoked' ? 'share_revoked' : 'share_expired',
      );
      // The document is no longer on screen, and the stored session is gone.
      await expect(panel.locator('[data-testid="rd-editor"]')).toHaveCount(0);
      await expect(panel.getByText('Readable only while access lasts.')).toHaveCount(0);
      await expect.poll(() => fs.existsSync(sessionFile(running.userData))).toBe(false);
      await shot(panel, `access-${scenario}`);
    } finally {
      await running.close();
    }

    // A restart does not reconnect: there is nothing to restore, and the link itself is dead.
    const again = await launchApp({ userData: running.userData, env: KEYSTORE });
    try {
      const state = await waitForState(
        again.panel,
        (current) => current.connection.server.status === 'ok',
        'the server check after restart',
      );
      expect(state.connection.session).toBeNull();
      await expect(again.panel.locator('[data-testid="rd-editor"]')).toHaveCount(0);
      await again.panel.locator('[data-testid="rd-paste-input"]').fill(share.url);
      await again.panel.locator('[data-testid="rd-paste-submit"]').click();
      await expect(again.panel.locator('[data-testid="rd-paste-form"]')).toContainText(
        scenario === 'revoked' ? 'revoked' : 'expired',
      );
      expect((await getState(again.panel)).connection.session).toBeNull();
    } finally {
      await again.close();
    }
  });
}

test('closing in the panel signs out but keeps a signed-in editor\'s local store; "forget session" in Settings removes it', async () => {
  const admin = await adminAccount();
  const documentId = await createDocument('Forget check', ['Opened by a signed-in editor.']);
  const running = await launchConnected({ env: KEYSTORE });
  try {
    const { app, panel } = running;
    // A signed-in editor: opened from the browser session, so the account is known.
    const openFromBrowser = async () => {
      const handoff = await admin.api.desktop.createHandoff(documentId);
      expect(await launchSecondInstance(running.userData, [handoff.url])).toBe(0);
      await waitForState(
        panel,
        (state) => state.connection.session?.documentId === documentId,
        'the redeemed session',
        30_000,
      );
      await waitLive(panel);
      return (await mainProcessToken(app)) ?? 'missing';
    };
    const askServer = async (token: string) =>
      (
        await fetch(`${SERVER_ORIGIN}/api/desktop/session`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status;
    const databases = () =>
      panel.evaluate(async () =>
        (await indexedDB.databases()).map((database) => database.name ?? ''),
      );

    const firstToken = await openFromBrowser();
    await typeAtEnd(panel, ' One saved change.');
    await expect(headerSave(panel)).toHaveAttribute('data-state', 'saved');
    // Signed-in editors keep unsent changes on this device: the account has a local store.
    const stores = await databases();
    expect(stores.length).toBeGreaterThan(0);
    expect(fs.existsSync(sessionFile(running.userData))).toBe(true);
    expect(await askServer(firstToken)).toBe(200);

    // 1. "Close document" in the panel: a sign-out. The server no longer accepts
    //    the token and the stored session is deleted, but the account's local
    //    store stays. (The panel shows other people's content; nothing in it can
    //    delete what the account kept on this computer.)
    await panel.click('[data-testid="rd-more-button"]');
    await panel.click('[data-testid="rd-close-document"]');
    await waitForState(panel, (state) => state.connection.session === null, 'no session');
    await expect(panel.locator('[data-testid="rd-empty-no-document"]')).toBeVisible();
    await expect(panel.locator('[data-testid="rd-editor"]')).toHaveCount(0);
    await expect.poll(() => askServer(firstToken)).toBe(401);
    await expect.poll(() => fs.existsSync(sessionFile(running.userData))).toBe(false);
    await panel.waitForTimeout(500);
    expect(await databases()).toEqual(stores);
    expect((await getState(panel)).connection.notice).toBeNull();

    // 2. "Close document and forget session" in Settings: the same sign-out,
    //    and the local store of that account is removed as well.
    const secondToken = await openFromBrowser();
    expect(secondToken).not.toBe(firstToken);
    expect(await askServer(secondToken)).toBe(200);
    const settings = await openSettings(running);
    await settings.click('[data-testid="rd-disconnect"]');
    await waitForState(panel, (state) => state.connection.session === null, 'no session');
    await expect.poll(() => askServer(secondToken)).toBe(401);
    await expect.poll(() => fs.existsSync(sessionFile(running.userData))).toBe(false);
    await expect.poll(databases).toEqual([]);
    expect((await getState(panel)).connection.notice).toBeNull();
  } finally {
    await running.close();
  }
});
