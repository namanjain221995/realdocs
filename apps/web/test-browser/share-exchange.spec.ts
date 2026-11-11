import type { Page } from '@playwright/test';
import {
  DOC_IDS,
  expect,
  SECRETS,
  seedShareLink,
  SHARE_IDS,
  signedInAs,
  storageDump,
  test,
  USERS,
} from './support/test';

const EXCHANGE = /^\/api\/share\/exchange$/;
const shareUrl = (grantId: string, secret: string = SECRETS.share): string =>
  `/s/${grantId}#${secret}`;

/**
 * Wraps `fetch` in the page so that each request records what the address bar
 * showed at the moment the request was started.
 */
async function recordAddressAtEachRequest(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: { url: string; hash: string; href: string }[] = [];
    (window as unknown as { __requests: typeof log }).__requests = log;
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      log.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        hash: window.location.hash,
        href: window.location.href,
      });
      return original(input, init);
    };
  });
}

function recordedRequests(page: Page): Promise<{ url: string; hash: string; href: string }[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __requests: { url: string; hash: string; href: string }[] })
        .__requests,
  );
}

test.describe('opening a share link', () => {
  test('exchanges the secret, cleans the address bar first, and opens the document', async ({
    page,
    api,
  }) => {
    seedShareLink(api, SHARE_IDS.press, DOC_IDS.launch);
    await recordAddressAtEachRequest(page);
    // Everything the page loads after the link itself: scripts, styles, fonts, API calls.
    const subrequests: string[] = [];
    page.on('request', (request) => {
      if (!request.isNavigationRequest()) subrequests.push(request.url());
    });

    await page.goto(shareUrl(SHARE_IDS.press));

    // The route replaces itself with the document; the link is gone from history.
    await expect(page).toHaveURL(`/d/${DOC_IDS.launch}`);
    await expect(page.getByTestId('document-title')).toHaveText('Q4 launch plan');
    await expect(page.getByTestId('via-share-link')).toBeVisible();
    await expect(page.getByTestId('document-role')).toHaveText('Viewer');
    expect(await page.evaluate(() => window.location.hash)).toBe('');

    // The secret went to the server once, in the request body, in cookie mode.
    const exchanges = api.callsTo('POST', EXCHANGE);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.body).toEqual({
      grantId: SHARE_IDS.press,
      secret: SECRETS.share,
      mode: 'cookie',
    });

    // The fragment had left the address bar before the first request was even started.
    const requests = await recordedRequests(page);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.some((request) => request.url.includes('/api/share/exchange'))).toBe(true);
    for (const request of requests) {
      expect(request.hash, `address bar during ${request.url}`).toBe('');
      expect(request.href).not.toContain(SECRETS.share);
      expect(request.url).not.toContain(SECRETS.share);
    }

    // No request the page made carried the secret in its URL. (The navigation to
    // the link itself is left out: a browser never sends a fragment to a server.)
    expect(subrequests.length).toBeGreaterThan(3);
    expect(subrequests.filter((url) => url.includes(SECRETS.share))).toEqual([]);

    // Nothing was written to storage or cookies, and nothing of it is left in the page.
    expect(await storageDump(page)).not.toContain(SECRETS.share);
    expect(await page.content()).not.toContain(SECRETS.share);

    // Back does not return to the link.
    expect(await page.evaluate(() => window.history.length)).toBeLessThanOrEqual(2);
  });

  test('still has the fragment out of the address bar while the exchange is in flight', async ({
    page,
    api,
  }) => {
    seedShareLink(api, SHARE_IDS.press, DOC_IDS.launch);
    const release = api.holdNext('POST', EXCHANGE);
    await page.goto(shareUrl(SHARE_IDS.press));
    await expect(page.getByTestId('share-exchange-working')).toBeVisible();
    await expect.poll(() => api.callsTo('POST', EXCHANGE).length).toBe(1);
    const address = new URL(await page.evaluate(() => window.location.href));
    expect(address.pathname).toBe(`/s/${SHARE_IDS.press}`);
    expect(address.hash).toBe('');
    expect(address.href).not.toContain('#');
    release();
    await expect(page).toHaveURL(`/d/${DOC_IDS.launch}`);
  });

  test('gives an edit link edit access', async ({ page, api }) => {
    seedShareLink(api, SHARE_IDS.reviewers, DOC_IDS.launch);
    await page.goto(shareUrl(SHARE_IDS.reviewers));
    await expect(page.getByTestId('document-role')).toHaveText('Editor');
    await expect(page.getByTestId('open-sharing')).toHaveCount(0);
  });

  test('works for someone who is signed in as well', async ({ page, api }) => {
    signedInAs(api, USERS.chen);
    seedShareLink(api, SHARE_IDS.press, DOC_IDS.launch);
    await page.goto(shareUrl(SHARE_IDS.press));
    await expect(page.getByTestId('document-title')).toHaveText('Q4 launch plan');
    await expect(page.getByTestId('via-share-link')).toBeVisible();
    await expect(page.getByTestId('back-to-documents')).toBeVisible();
  });

  test('link the server does not know', async ({ page, api }) => {
    await page.goto(shareUrl(SHARE_IDS.press, SECRETS.shareOther));
    const error = page.getByTestId('share-exchange-error');
    await expect(error).toHaveAttribute('data-share-failure', 'invalid');
    await expect(error).toContainText('This share link is not valid');
    await expect(error.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(await page.content()).not.toContain(SECRETS.shareOther);
    expect(api.callsTo('POST', EXCHANGE)).toHaveLength(1);
    await expect(page).toHaveTitle('This share link is not valid – RealtimeDocs');
  });

  test('expired link', async ({ page, api }) => {
    seedShareLink(api, SHARE_IDS.expired, DOC_IDS.launch);
    await page.goto(shareUrl(SHARE_IDS.expired));
    const error = page.getByTestId('share-exchange-error');
    await expect(error).toHaveAttribute('data-share-failure', 'expired');
    await expect(error).toHaveAttribute('data-error-kind', 'link_expired');
    await expect(error).toContainText('This share link has expired');
  });

  test('revoked link', async ({ page, api }) => {
    seedShareLink(api, SHARE_IDS.revoked, DOC_IDS.launch);
    await page.goto(shareUrl(SHARE_IDS.revoked));
    const error = page.getByTestId('share-exchange-error');
    await expect(error).toHaveAttribute('data-share-failure', 'revoked');
    await expect(error).toContainText('This share link was revoked');
    await expect(error).toContainText('It no longer opens the document');
  });

  test('link to a document that is in the trash', async ({ page, api }) => {
    seedShareLink(api, SHARE_IDS.press, DOC_IDS.launch);
    api.document(DOC_IDS.launch).status = 'trashed';
    await page.goto(shareUrl(SHARE_IDS.press));
    await expect(page.getByTestId('share-exchange-error')).toHaveAttribute(
      'data-share-failure',
      'document_unavailable',
    );
  });

  test('rate limited: waits, then the same tab retries with the secret it kept in memory', async ({
    page,
    api,
  }) => {
    seedShareLink(api, SHARE_IDS.press, DOC_IDS.launch);
    api.failNext('POST', EXCHANGE, 'rate_limited', { retryAfterSeconds: 25, requestId: 'req_429' });
    await page.goto(shareUrl(SHARE_IDS.press));
    const error = page.getByTestId('share-exchange-error');
    await expect(error).toHaveAttribute('data-share-failure', 'rate_limited');
    await expect(error).toContainText('Too many attempts');
    await expect(error).toContainText('Reference req_429');
    await expect(error.getByRole('button', { name: /Try again in \d+ s/ })).toBeDisabled();
    expect(await page.evaluate(() => window.location.hash)).toBe('');

    await page.clock.setFixedTime(new Date('2026-11-10T12:00:26.000Z'));
    await error.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page).toHaveURL(`/d/${DOC_IDS.launch}`);
    expect(api.callsTo('POST', EXCHANGE)).toHaveLength(2);
    expect(api.callsTo('POST', EXCHANGE)[1]?.body).toMatchObject({ secret: SECRETS.share });
  });

  test('server unavailable: explains, keeps the secret out of sight, and retries', async ({
    page,
    api,
  }) => {
    seedShareLink(api, SHARE_IDS.press, DOC_IDS.launch);
    api.failNext('POST', EXCHANGE, 'internal', { requestId: 'req_500' });
    await page.goto(shareUrl(SHARE_IDS.press));
    const error = page.getByTestId('share-exchange-error');
    await expect(error).toHaveAttribute('data-share-failure', 'unavailable');
    await expect(error).toContainText('The server is not responding');
    await expect(error).toContainText('held in memory only');
    await expect(error).toContainText('Reference req_500');
    expect(await page.content()).not.toContain(SECRETS.share);
    expect(await storageDump(page)).not.toContain(SECRETS.share);

    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(page).toHaveURL(`/d/${DOC_IDS.launch}`);
  });

  test('server unreachable', async ({ page, api }) => {
    seedShareLink(api, SHARE_IDS.press, DOC_IDS.launch);
    api.abortNext('POST', EXCHANGE);
    await page.goto(shareUrl(SHARE_IDS.press));
    await expect(page.getByTestId('share-exchange-error')).toHaveAttribute(
      'data-share-failure',
      'unavailable',
    );
  });

  test('link without its key: nothing is sent', async ({ page, api }) => {
    await page.goto(`/s/${SHARE_IDS.press}`);
    const error = page.getByTestId('share-exchange-error');
    await expect(error).toHaveAttribute('data-share-failure', 'incomplete');
    await expect(error).toContainText('This share link is incomplete');
    expect(api.callsTo('POST', EXCHANGE)).toHaveLength(0);
  });

  test('link with a damaged key: the fragment is removed and nothing is sent', async ({
    page,
    api,
  }) => {
    await page.goto(`/s/${SHARE_IDS.press}#${SECRETS.share.slice(0, 30)}`);
    await expect(page.getByTestId('share-exchange-error')).toHaveAttribute(
      'data-share-failure',
      'incomplete',
    );
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(api.callsTo('POST', EXCHANGE)).toHaveLength(0);
  });

  test('reloading after the fragment was removed asks for the original link', async ({
    page,
    api,
  }) => {
    seedShareLink(api, SHARE_IDS.press, DOC_IDS.launch);
    api.failNext('POST', EXCHANGE, 'internal');
    await page.goto(shareUrl(SHARE_IDS.press));
    await expect(page.getByTestId('share-exchange-error')).toHaveAttribute(
      'data-share-failure',
      'unavailable',
    );
    // The secret was never stored, so a reload cannot recover it. That is intended.
    await page.reload();
    await expect(page.getByTestId('share-exchange-error')).toHaveAttribute(
      'data-share-failure',
      'incomplete',
    );
    expect(api.callsTo('POST', EXCHANGE)).toHaveLength(1);
  });

  test('opening the full link again in the same tab starts over', async ({ page, api }) => {
    seedShareLink(api, SHARE_IDS.press, DOC_IDS.launch);
    await page.goto(`/s/${SHARE_IDS.press}`);
    await expect(page.getByTestId('share-exchange-error')).toHaveAttribute(
      'data-share-failure',
      'incomplete',
    );
    // Pasting the complete link over a page that is already open only changes the fragment.
    await page.evaluate((secret) => {
      window.location.hash = secret;
    }, SECRETS.share);
    await expect(page).toHaveURL(`/d/${DOC_IDS.launch}`);
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(api.callsTo('POST', EXCHANGE)).toHaveLength(1);
  });

  test('an id that is not an id is refused without a request', async ({ page, api }) => {
    await page.goto(`/s/not-a-grant#${SECRETS.share}`);
    await expect(page.getByTestId('share-exchange-error')).toHaveAttribute(
      'data-share-failure',
      'invalid',
    );
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(api.callsTo('POST', EXCHANGE)).toHaveLength(0);
  });
});
