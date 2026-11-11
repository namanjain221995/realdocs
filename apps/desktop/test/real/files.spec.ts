import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { controlSaveDialog, waitForState } from '../smoke/helpers';
import {
  connectionStateOf,
  createDocument,
  createShare,
  editorContent,
  headerSave,
  launchConnected,
  openShare,
  policyViolations,
  remoteEditor,
  shot,
  waitLive,
} from './real-helpers';
import { SERVER_ORIGIN, adminAccount } from './stack';

// Files in a document opened for editing: uploads from the panel, and the
// download of an attachment, which the main process does on the panel's behalf.

test('edit link: an image and an attachment are uploaded from the panel, and the attachment is downloaded through the main process', async () => {
  const documentId = await createDocument('Files check', ['Files go below this line.']);
  const share = await createShare(documentId, 'editor');
  const remote = await remoteEditor(documentId);
  const running = await launchConnected();
  const target = path.join(os.tmpdir(), `rd-attachment-${Date.now()}.txt`);
  try {
    const { app, panel } = running;
    await openShare(running, share);
    const content = editorContent(panel);
    // The caret goes to the end of the text paragraph before each upload. (A
    // click somewhere in the document could select the picture instead, and
    // an insertion replaces what is selected.)
    const caretAfterText = async () => {
      await content.locator('p', { hasText: 'Files go below this line.' }).click();
      await panel.keyboard.press('End');
    };
    await caretAfterText();

    // An image: any real PNG will do, so a screenshot of the panel itself.
    const png = await panel.screenshot();
    await panel
      .locator('[data-testid="rd-image-input"]')
      .setInputFiles({ name: 'panel.png', mimeType: 'image/png', buffer: png });
    // Uploaded through the API (the token is added on the way out). The client
    // that uploaded keeps showing its own copy of the picture, so the check of
    // the upload is the shared document: the other client sees an image with
    // an asset of this document, and the server serves that asset to a
    // signed-in member and to nobody else.
    const image = content.locator('img.rd-image__img:not(.rd-image__img--pending)');
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(100);
    await expect.poll(() => remote.assetIds('image')).toHaveLength(1);
    const imageUrl = `${SERVER_ORIGIN}/api/documents/${documentId}/assets/${remote.assetIds('image')[0]}`;
    const admin = await adminAccount();
    const served = await admin.fetch(imageUrl);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toContain('image/png');
    const servedBytes = Buffer.from(await served.arrayBuffer());
    // A PNG of a plausible size. (Not compared byte for byte: the server may store its own encoding.)
    expect(servedBytes.subarray(0, 8).toString('latin1')).toBe('\u0089PNG\r\n\u001a\n');
    expect(servedBytes.length).toBeGreaterThan(1000);
    expect((await fetch(imageUrl)).status).toBe(401);

    // An attachment.
    const bytes = Buffer.from('RealtimeDocs desktop attachment check.\n'.repeat(64), 'utf8');
    await caretAfterText();
    await panel
      .locator('[data-testid="rd-attachment-input"]')
      .setInputFiles({ name: 'meeting-notes.txt', mimeType: 'text/plain', buffer: bytes });
    const chip = content.locator('a.rd-attachment__download');
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(content.locator('.rd-attachment__name')).toHaveText('meeting-notes.txt');
    await expect(headerSave(panel)).toHaveAttribute('data-state', 'saved');
    // Both are part of the shared document: the other client has them too.
    await remote.waitForText('Files go below this line.');
    await expect
      .poll(() => remote.blockNames().sort())
      .toEqual(expect.arrayContaining(['attachment', 'image']));
    await shot(panel, 'uploaded-image-and-attachment');

    // A fresh view of the same document shows the uploaded picture from the
    // asset endpoint, authorised by the session the main process holds.
    await panel.reload();
    await waitLive(panel);
    const reloaded = content.locator('img.rd-image__img');
    await expect(reloaded).toHaveAttribute('src', imageUrl, { timeout: 30_000 });
    await reloaded.scrollIntoViewIfNeeded();
    await expect
      .poll(() => reloaded.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(100);
    await shot(panel, 'uploaded-image-from-asset-endpoint');

    // Download. The chip is a plain link to the server; the panel must not go
    // there. The main process recognises it and downloads the file itself.
    // (Position and address are read now: once the app has refused a
    // navigation, Playwright's locators wait for it for ever.)
    await chip.scrollIntoViewIfNeeded();
    const box = await chip.boundingBox();
    if (!box) throw new Error('the download chip has no position');
    const href = (await chip.getAttribute('href')) ?? '';
    expect(href).toBe(
      `${SERVER_ORIGIN}/api/documents/${documentId}/assets/${href.split('/assets/')[1]?.split('?')[0]}?download=1`,
    );
    // In place of the person at the save dialog, which nothing here can click.
    const saveDialog = await controlSaveDialog(app);
    await saveDialog.answerWith(target);
    const logged = (event: string) =>
      running.stderr.join('').split(`"event":"${event}"`).length - 1;

    // While nobody could be clicking in the document, the same link starts nothing.
    await panel.evaluate(() => window.rdDesktop?.window.setClickThrough(true));
    await waitForState(panel, (state) => state.panel.clickThrough, 'click-through on');
    await panel.evaluate((url) => {
      window.location.href = url;
    }, href);
    await expect.poll(() => logged('attachment.refused_not_interactive')).toBe(1);
    expect(logged('attachment.download_started')).toBe(0);
    await panel.evaluate(() => window.rdDesktop?.window.setClickThrough(false));
    await waitForState(panel, (state) => !state.panel.clickThrough, 'click-through off');

    // A real click on the chip. (Raw mouse input: Playwright's own `click`
    // would wait for the navigation that the app is about to refuse.)
    await panel.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => logged('attachment.download_saved')).toBe(1);
    expect(fs.readFileSync(target).equals(bytes)).toBe(true);
    // Private mode is on (the default): the save dialog is drawn by the
    // operating system outside the protected window, so it proposes a neutral
    // name that keeps only the extension of the uploaded file.
    expect(await saveDialog.calls()).toMatchObject([
      { parent: 'panel', defaultName: 'attachment.txt' },
    ]);

    // The panel stayed on its page and stayed connected.
    expect(panel.url()).toBe('app://realtimedocs/panel.html');
    expect(app.windows()).toHaveLength(1);
    expect(await connectionStateOf(panel)).toBe('live');
    // The address alone is worth nothing: without the session the server refuses it.
    expect((await fetch(href)).status).toBe(401);
    // The click was handled, not merely blocked, and nothing violated the policy.
    expect(logged('attachment.download_started')).toBe(1);
    // Exactly one refusal: the attempt made while the panel was click-through.
    expect(logged('navigation.blocked')).toBe(1);
    expect(logged('download.blocked')).toBe(0);
    expect(await policyViolations(app)).toEqual([]);
    // Neither the token nor the file's name is in the app's log.
    expect(running.stderr.join('')).not.toContain('meeting-notes');
  } finally {
    remote.destroy();
    await running.close();
    fs.rmSync(target, { force: true });
  }
});

test('view link: a link to anything else on the server is still refused, with or without a session', async () => {
  const documentId = await createDocument('Navigation check', ['Nothing to download here.']);
  const share = await createShare(documentId, 'viewer');
  const running = await launchConnected();
  try {
    const { app, panel } = running;
    await openShare(running, share);
    const saveDialog = await controlSaveDialog(app);
    await saveDialog.answerWith(null);
    // What a hostile document could try: send the panel to other addresses of the same server.
    for (const address of [
      `${SERVER_ORIGIN}/api/documents/${documentId}/export?format=txt`,
      `${SERVER_ORIGIN}/api/documents/${documentId}/assets/${documentId}`,
      `${SERVER_ORIGIN}/api/desktop/session`,
      `${SERVER_ORIGIN}/`,
    ]) {
      await panel.evaluate((url) => {
        window.location.href = url;
      }, address);
      await panel.waitForTimeout(300);
      expect(panel.url()).toBe('app://realtimedocs/panel.html');
    }
    // No save dialog, no fetch by the main process, no download by Chromium.
    expect(await saveDialog.calls()).toEqual([]);
    expect(running.stderr.join('')).not.toContain('"event":"attachment.download_started"');
    expect(running.stderr.join('')).not.toContain('"event":"download.blocked"');
    expect(await connectionStateOf(panel)).toBe('live');
    expect(running.stderr.join('').split('"event":"navigation.blocked"').length - 1).toBe(4);
  } finally {
    await running.close();
  }
});
