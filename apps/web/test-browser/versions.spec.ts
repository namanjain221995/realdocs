import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  DOC_IDS,
  expect,
  hasHorizontalOverflow,
  setSavedTheme,
  signedInAs,
  test,
  type ThemeName,
  USERS,
} from './support/test';

const DOC = DOC_IDS.launch;
const HISTORY = `/d/${DOC}/history`;
const BASE = `/api/documents/${DOC}/version-history`;
const IMAGE_ID = '3f6c9a1e';
// A 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHd0ptgAAAABJRU5ErkJggg==',
  'base64',
);

const BODY = {
  document: { id: DOC, title: 'Q4 launch plan', url: `/d/${DOC}` },
  session: null,
  trackingStartedAt: '2026-11-10T09:00:00.000Z',
  finalizedAt: null,
  timezone: 'UTC',
  versions: [
    {
      version: 1,
      editedAt: '2026-11-10T09:00:00.000Z',
      editedAtText: '2026-11-10 09:00:00 AM UTC',
      editedBy: 'Aarav Sharma',
      added: [
        'First line of the answer',
        `[IMAGE ${IMAGE_ID}] image pasted (images/${IMAGE_ID}.png)`,
      ],
      removed: [],
      snapshot: `First line of the answer\n[IMAGE ${IMAGE_ID}] images/${IMAGE_ID}.png`,
      images: [IMAGE_ID],
    },
    {
      version: 2,
      editedAt: '2026-11-10T09:05:00.000Z',
      editedAtText: '2026-11-10 09:05:00 AM UTC',
      editedBy: 'Meera Iyer',
      added: ['<b>Second</b> line'],
      removed: ['First line of the answer'],
      snapshot: `<b>Second</b> line\n[IMAGE ${IMAGE_ID}] images/${IMAGE_ID}.png`,
      images: [],
    },
  ],
  finalContent: '',
  images: [
    {
      id: IMAGE_ID,
      fileName: `${IMAGE_ID}.png`,
      mime: 'image/png',
      sizeBytes: PNG.length,
      sha256: 'abc',
      firstVersion: 1,
      lastVersion: null,
      url: `${BASE}/images/${IMAGE_ID}`,
    },
  ],
};

async function mockVersions(page: Page, body: unknown = BODY, status = 200): Promise<void> {
  await page.route(`**${BASE}/images/*`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );
  await page.route(`**${BASE}?*`, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  );
}

async function audit(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(
    blocking.map((violation) => ({
      rule: violation.id,
      targets: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
    })),
  ).toEqual([]);
}

test.describe('version history document', () => {
  test('an administrator sees the three actions with the right links', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    await mockVersions(page);
    await page.goto(HISTORY);
    const group = page.getByRole('group', { name: 'Version history document' });
    await expect(group).toBeVisible();
    const txt = page.getByTestId('history-versions-txt');
    await expect(txt).toHaveText('Download doc.txt');
    await expect(txt).toHaveAttribute('download', /.*/);
    const href = (await txt.getAttribute('href')) ?? '';
    expect(href).toMatch(new RegExp(`^${BASE}\\?format=txt&timezone=[^&]+$`));
    const zip = page.getByTestId('history-versions-zip');
    await expect(zip).toHaveText('Download with images (.zip)');
    await expect(zip).toHaveAttribute('href', `${BASE}/archive`);
    await expect(zip).toHaveAttribute('download', /.*/);
    await expect(page.getByTestId('history-versions-view')).toHaveText('View versions');
    // Existing actions stay.
    await expect(page.getByTestId('export-audit')).toBeVisible();
  });

  test('a person who may not manage the document does not get the actions', async ({
    page,
    api,
  }) => {
    signedInAs(api, USERS.ben);
    await page.goto(HISTORY);
    await expect(page.getByTestId('history-forbidden')).toBeVisible();
    await expect(page.getByTestId('history-versions')).toHaveCount(0);
    await expect(page.getByTestId('history-versions-txt')).toHaveCount(0);
  });

  test('shows the versions, their lines, the image and the snapshot', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    await mockVersions(page);
    await page.goto(HISTORY);
    const view = page.getByTestId('history-versions-view');
    await expect(view).toHaveAttribute('aria-expanded', 'false');
    await view.click();
    await expect(view).toHaveAttribute('aria-expanded', 'true');

    const versions = page.getByTestId('version');
    await expect(versions).toHaveCount(2);
    const first = versions.nth(0);
    await expect(first.getByRole('heading', { name: 'Version 1' })).toBeVisible();
    await expect(first).toContainText('2026-11-10 09:00:00 AM UTC');
    await expect(first).toContainText('Aarav Sharma');
    await expect(first.getByTestId('version-added').first()).toContainText('+');
    await expect(first.getByTestId('version-added').first()).toContainText(
      'First line of the answer',
    );
    await expect(first).toContainText('(nothing removed)');
    // The id is shown as text and the thumbnail loads.
    await expect(first.getByTestId('version-added').nth(1)).toContainText(`[IMAGE ${IMAGE_ID}]`);
    const thumb = first.getByTestId('version-image').getByTestId('version-thumb');
    await expect(thumb).toBeVisible();
    await expect
      .poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(first.getByTestId('version-image')).toContainText(`${IMAGE_ID}.png`);
    await expect(first.getByTestId('version-image-download')).toHaveAttribute(
      'href',
      `${BASE}/images/${IMAGE_ID}`,
    );

    const second = versions.nth(1);
    await expect(second.getByTestId('version-removed')).toContainText('−');
    await expect(second.getByTestId('version-removed')).toContainText('First line of the answer');
    // Markup from the document is shown as text.
    await expect(second.getByTestId('version-added')).toHaveText(/\+.*<b>Second<\/b> line/);
    await expect(second.getByTestId('version-images')).toHaveCount(0);

    const toggle = first.getByTestId('version-snapshot-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(first.getByTestId('version-snapshot')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(first.getByTestId('version-snapshot')).toContainText('First line of the answer');
    await toggle.click();
    await expect(first.getByTestId('version-snapshot')).toHaveCount(0);
  });

  test('shows action, editor details, start time and timed lines when present', async ({
    page,
    api,
  }) => {
    signedInAs(api, USERS.asha);
    const rich = {
      ...BODY,
      versions: [
        {
          ...BODY.versions[0],
          action: 'Pasted',
          startedAtText: '2026-11-10 08:59:50 AM UTC',
          editor: {
            name: 'Aarav Sharma',
            role: 'Candidate',
            email: 'aarav@example.com',
            kind: 'user',
          },
          addedDetail: (BODY.versions[0]?.added ?? []).map((text) => ({
            text,
            at: '2026-11-10T09:00:00.000Z',
            atText: '09:00:00 AM',
          })),
          removedDetail: [],
        },
        BODY.versions[1],
      ],
    };
    await mockVersions(page, rich);
    await page.goto(HISTORY);
    await page.getByTestId('history-versions-view').click();
    const first = page.getByTestId('version').nth(0);
    await expect(first.getByTestId('version-action')).toHaveText('Pasted');
    await expect(first.getByTestId('version-editor')).toHaveText(
      'Aarav Sharma (Candidate, aarav@example.com)',
    );
    await expect(first.getByTestId('version-started')).toContainText('08:59:50 AM');
    await expect(first.getByTestId('version-line-at').first()).toContainText('[09:00:00 AM]');
    // Without the new fields the plain form is shown.
    const second = page.getByTestId('version').nth(1);
    await expect(second.getByTestId('version-action')).toHaveCount(0);
    await expect(second.getByTestId('version-editor')).toHaveText('Meera Iyer');
    await expect(second.getByTestId('version-line-at')).toHaveCount(0);
    await audit(page);
  });

  test('pages long histories 25 at a time', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    const many = {
      ...BODY,
      images: [],
      versions: Array.from({ length: 60 }, (_, index) => ({
        ...BODY.versions[1],
        version: index + 1,
        images: [],
      })),
    };
    await mockVersions(page, many);
    await page.goto(HISTORY);
    await page.getByTestId('history-versions-view').click();
    await expect(page.getByTestId('version')).toHaveCount(25);
    await expect(page.getByTestId('versions-range')).toHaveText('Versions 1–25 of 60');
    await page.getByTestId('versions-next').click();
    await page.getByTestId('versions-next').click();
    await expect(page.getByTestId('version')).toHaveCount(10);
    await expect(page.getByTestId('versions-next')).toBeDisabled();
  });

  test('says when nothing is recorded', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    await mockVersions(page, { ...BODY, versions: [], images: [] });
    await page.goto(HISTORY);
    await page.getByTestId('history-versions-view').click();
    await expect(page.getByTestId('versions-empty')).toContainText('No versions recorded yet');
  });

  test('shows an error with a retry, and a refusal without one', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    await mockVersions(page, { error: 'internal' }, 500);
    await page.goto(HISTORY);
    await page.getByTestId('history-versions-view').click();
    await expect(page.getByTestId('versions-error')).toBeVisible();
    await expect(page.getByTestId('versions-error').getByRole('button')).toBeVisible();

    await page.unroute(`**${BASE}?*`);
    await mockVersions(page, { error: 'forbidden' }, 403);
    await page.getByTestId('versions-error').getByRole('button').click();
    await expect(page.getByTestId('versions-error')).toContainText(
      'You cannot view the version history document',
    );
    await expect(page.getByTestId('versions-error').getByRole('button')).toHaveCount(0);
  });

  test('fits 320 px wide', async ({ page, api }) => {
    signedInAs(api, USERS.asha);
    await mockVersions(page);
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(HISTORY);
    await page.getByTestId('history-versions-view').click();
    await page.getByTestId('version-snapshot-toggle').first().click();
    await expect(page.getByTestId('version-snapshot')).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  for (const theme of ['dark', 'light'] as const satisfies readonly ThemeName[]) {
    test(`has no serious accessibility violations (${theme})`, async ({ page, api }) => {
      signedInAs(api, USERS.asha);
      await setSavedTheme(page, theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await mockVersions(page);
      await page.goto(HISTORY);
      await page.getByTestId('history-versions-view').click();
      await page.getByTestId('version-snapshot-toggle').first().click();
      await expect(page.getByTestId('version-thumb').first()).toBeVisible();
      await audit(page);
    });
  }
});

test('the documents list marks interview documents', async ({ page, api }) => {
  signedInAs(api, USERS.asha);
  const first = api.documents.find((document) => document.status === 'active');
  if (!first) throw new Error('the mock has no active document');
  Object.assign(first, {
    interview: {
      sessionId: '0b0f5c0e-7a54-4c58-9b1e-2f6a3f1d9c10',
      company: 'Acme Corp',
      round: { number: '2', name: 'System design' },
      candidate: 'Aarav Sharma',
      scheduledAt: '2030-03-14T10:00:00.000Z',
      timezone: 'Asia/Kolkata',
      status: 'scheduled',
    },
  });
  await page.goto('/documents');
  const badge = page.getByTestId('interview-badge');
  await expect(badge).toHaveCount(1);
  await expect(badge).toContainText('Interview · Acme Corp · Round 2 — System design');
  await expect(page.getByTestId('interview-detail')).toContainText('Aarav Sharma');
});
