/**
 * Acceptance scenario 4: mixed text and images keep the intended order when uploads finish out
 * of order.
 *
 * Four differently coloured images are pasted between paragraphs in one paste. Each upload is
 * held back inside the page, by file name, before it is sent, so that the real server receives
 * and answers the four uploads in the order 3, 2, 4, 1. The request, the server, the database
 * and the asset endpoint are real; only the moment of sending is shaped. The final document must
 * show text and images in paste order on the editor, on a view-only guest, in a fresh browser and
 * in the server's Markdown export, and each position must hold the image with the bytes that
 * were pasted there (width for the uploader's local preview, SHA-256 of the served bytes elsewhere).
 */
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import {
  admin,
  createDocument,
  createShareLink,
  exportedMarkdown,
  expect,
  expectEditorReady,
  expectSaved,
  openDocument,
  pasteHtml,
  signIn,
  solidPng,
  test,
  unique,
} from '../support/test';

const IMAGES = {
  red: solidPng([220, 30, 30], 40, 24),
  green: solidPng([30, 180, 60], 41, 24),
  blue: solidPng([30, 60, 220], 42, 24),
  yellow: solidPng([230, 200, 20], 43, 24),
};
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const HASH_OF = Object.fromEntries(
  Object.entries(IMAGES).map(([name, bytes]) => [sha(bytes), name]),
) as Record<string, string>;
const dataUri = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`;

const NAME_OF_WIDTH: Record<number, string> = { 40: 'red', 41: 'green', 42: 'blue', 43: 'yellow' };

/**
 * Text and images of the document, top to bottom. An image is named after the picture it shows:
 * by its width, and, when it is served by the asset endpoint, by the hash of the bytes the server
 * returns (the uploader keeps showing its local preview, which cannot be fetched under the CSP).
 */
async function sequence(page: Page): Promise<string[]> {
  return page.evaluate(
    async ({ hashOf, nameOfWidth }) => {
      const root = document.querySelector('[data-testid="rd-editor-content"]') as HTMLElement;
      const out: string[] = [];
      const describe = async (image: HTMLImageElement) => {
        if (!image.complete || image.naturalWidth === 0) return 'image:not-loaded';
        const byWidth = nameOfWidth[image.naturalWidth] ?? `unknown-width-${image.naturalWidth}`;
        const src = image.currentSrc || image.src;
        if (src.startsWith('blob:') || src.startsWith('data:')) return `image:${byWidth}`;
        const bytes = await (await fetch(src)).arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hex = [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const byBytes = hashOf[hex] ?? `unknown-bytes-${hex.slice(0, 8)}`;
        return byBytes === byWidth ? `image:${byBytes}` : `image:${byWidth}!=${byBytes}`;
      };
      for (const block of [...root.children]) {
        if (block.querySelector('[data-testid="rd-upload-placeholder"]')) {
          out.push('placeholder');
          continue;
        }
        const images = [...block.querySelectorAll('img.rd-image__img')];
        if (images.length > 0) {
          for (const image of images) out.push(await describe(image as HTMLImageElement));
        } else {
          const copy = block.cloneNode(true) as HTMLElement;
          copy.querySelectorAll('.rd-caret').forEach((caret) => caret.remove());
          const text = (copy.textContent ?? '').trim();
          if (text) out.push(`text:${text}`);
        }
      }
      return out;
    },
    { hashOf: HASH_OF, nameOfWidth: NAME_OF_WIDTH },
  );
}

const EXPECTED = [
  'text:Intro before the first picture',
  'image:red',
  'text:Between red and green',
  'image:green',
  'text:Between green and blue',
  'image:blue',
  'image:yellow',
  'text:Outro after the last picture',
];

test('images pasted between text keep their place when the uploads finish out of order', async ({
  page,
  openContext,
}) => {
  test.setTimeout(120_000);
  await signIn(page, admin);
  const documentId = await createDocument(page, unique('Image order'));
  const share = await createShareLink(page, documentId, { role: 'viewer' });

  // Hold each upload for a time chosen by its file name.
  const HOLD_MS: Record<string, number> = {
    'pasted-image-1.png': 4500,
    'pasted-image-2.png': 2500,
    'pasted-image-3.png': 300,
    'pasted-image-4.png': 3500,
  };
  // The upload requests are held back inside the page, by file name, before they are sent. (Playwright's
  // request routing re-sends a multipart body without its file in WebKit, which makes the server answer
  // 422, so it cannot be used to shape uploads in all three browsers.) The request itself, the real
  // server, the database and the asset endpoint are untouched.
  await page.addInitScript((holdMs) => {
    const released: string[] = [];
    (window as unknown as { __released: string[] }).__released = released;
    const nameOf = (body: unknown): string | null => {
      if (!(body instanceof FormData)) return null;
      for (const [, value] of body.entries()) if (value instanceof File) return value.name;
      return null;
    };
    const delayFor = (body: unknown): number => {
      const name = nameOf(body);
      return name && name in holdMs ? holdMs[name]! : 0;
    };
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const name = nameOf(body);
      if (name && name in holdMs) {
        window.setTimeout(() => {
          released.push(name);
          originalSend.call(this, body);
        }, holdMs[name]);
        return;
      }
      originalSend.call(this, body);
    };
    const originalFetch = window.fetch;
    window.fetch = (input, init) => {
      const wait = delayFor(init?.body);
      const name = nameOf(init?.body);
      if (!wait || !name) return originalFetch(input, init);
      return new Promise((resolve, reject) => {
        window.setTimeout(() => {
          released.push(name);
          originalFetch(input, init).then(resolve, reject);
        }, wait);
      });
    };
  }, HOLD_MS);

  await openDocument(page, documentId);
  const guest = await (await openContext()).newPage();
  await guest.goto(share.path);
  await expectEditorReady(guest);

  await pasteHtml(
    page,
    `<p>Intro before the first picture</p><img src="${dataUri(IMAGES.red)}" alt="red">` +
      `<p>Between red and green</p><img src="${dataUri(IMAGES.green)}" alt="green">` +
      `<p>Between green and blue</p><img src="${dataUri(IMAGES.blue)}" alt="blue">` +
      `<img src="${dataUri(IMAGES.yellow)}" alt="yellow">` +
      `<p>Outro after the last picture</p>`,
  );

  // While nothing has finished the four placeholders already stand where the images will be.
  await expect(page.getByTestId('rd-upload-placeholder')).toHaveCount(4);
  expect(await sequence(page)).toEqual([
    'text:Intro before the first picture',
    'placeholder',
    'text:Between red and green',
    'placeholder',
    'text:Between green and blue',
    'placeholder',
    'placeholder',
    'text:Outro after the last picture',
  ]);

  // All four uploads end; they did so out of order.
  await expect(page.getByTestId('rd-upload-placeholder')).toHaveCount(0, { timeout: 30_000 });
  const released = await page.evaluate(
    () => (window as unknown as { __released: string[] }).__released,
  );
  expect(released, 'the uploads were sent to the real server in this order').toEqual([
    'pasted-image-3.png',
    'pasted-image-2.png',
    'pasted-image-4.png',
    'pasted-image-1.png',
  ]);

  // Order and content of the editor, the viewer, and the stored document.
  expect(await sequence(page)).toEqual(EXPECTED);
  await expectSaved(page);
  await expect.poll(() => sequence(guest), { timeout: 30_000 }).toEqual(EXPECTED);

  const markdown = await exportedMarkdown(page, documentId);
  const parts = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('![') ? 'image' : `text:${line}`));
  expect(parts).toEqual(EXPECTED.map((entry) => (entry.startsWith('image:') ? 'image' : entry)));

  // A fresh profile loading the stored document sees the same order.
  const late = await (await openContext()).newPage();
  await signIn(late, admin);
  await openDocument(late, documentId);
  await expect.poll(() => sequence(late), { timeout: 30_000 }).toEqual(EXPECTED);
});
