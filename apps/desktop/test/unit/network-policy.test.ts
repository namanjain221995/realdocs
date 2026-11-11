import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fileNameFromContentDisposition,
  matchAssetDownload,
  readBodyLimited,
  safeFileName,
} from '../../src/main/asset-download';
import { classifyRequest, decideAuthorization } from '../../src/main/auth-header';
import {
  decideExternalOpen,
  decideNavigation,
  isAppPageUrl,
} from '../../src/main/navigation-policy';
import { appResponseHeaders, resolveAppRequest } from '../../src/main/protocol-resolve';
import { buildContentSecurityPolicy, websocketOrigin } from '../../src/shared/csp';

const SERVER = 'https://docs.example.com';
const TOKEN = 'desktop-session-token-0123456789abcdef';
const APP = 'app://realtimedocs';
const context = { serverOrigin: SERVER, token: TOKEN };

function request(url: string, overrides: Partial<Parameters<typeof decideAuthorization>[0]> = {}) {
  return {
    url,
    method: 'GET',
    resourceType: 'xhr',
    initiatorOrigin: APP,
    requestHeaders: { Accept: '*/*' },
    ...overrides,
  };
}

describe('bearer header injection', () => {
  it('attaches the token to API requests for the configured origin', () => {
    const decision = decideAuthorization(
      request(`${SERVER}/api/documents/x/collab-ticket`),
      context,
    );
    expect(decision.attach).toBe(true);
    expect(decision.requestHeaders).toEqual({ Accept: '*/*', Authorization: `Bearer ${TOKEN}` });
    // Asset images are API requests too.
    expect(
      classifyRequest(
        request(`${SERVER}/api/documents/x/assets/y`, { resourceType: 'image' }),
        context,
      ),
    ).toBe('attached');
  });

  const neverAttached: [string, string, Partial<Parameters<typeof decideAuthorization>[0]>][] = [
    ['look-alike host (suffix)', 'https://docs.example.com.evil.example/api/x', {}],
    ['look-alike host (prefix)', 'https://evildocs.example.com/api/x', {}],
    ['sub-domain', 'https://api.docs.example.com/api/x', {}],
    ['parent domain', 'https://example.com/api/x', {}],
    ['other port', 'https://docs.example.com:8443/api/x', {}],
    ['http downgrade', 'http://docs.example.com/api/x', {}],
    ['user-info trick', 'https://docs.example.com@evil.example/api/x', {}],
    ['user-info with password', 'https://docs.example.com:pw@evil.example/api/x', {}],
    ['host in path', 'https://evil.example/docs.example.com/api/x', {}],
    ['host in query', 'https://evil.example/api/x?host=docs.example.com', {}],
    ['backslash trick', 'https://evil.example\\@docs.example.com/api/x', {}],
    ['trailing-dot host', 'https://docs.example.com./api/x', {}],
    ['websocket handshake (wss)', 'wss://docs.example.com/collab', { resourceType: 'webSocket' }],
    [
      'websocket resource type on https',
      'https://docs.example.com/api/collab',
      { resourceType: 'webSocket' },
    ],
    ['non-API path on the right origin', 'https://docs.example.com/login', {}],
    ['path that only starts like /api', 'https://docs.example.com/apix/steal', {}],
    ['the app scheme itself', 'app://realtimedocs/api/x', {}],
    ['data URL', 'data:text/plain,hi', {}],
    ['garbage', 'not a url', {}],
    [
      'request from a foreign initiator',
      'https://docs.example.com/api/x',
      { initiatorOrigin: 'https://evil.example' },
    ],
    [
      'browser-initiated request (no initiator)',
      'https://docs.example.com/api/x',
      { initiatorOrigin: undefined },
    ],
    ['opaque initiator', 'https://docs.example.com/api/x', { initiatorOrigin: 'null' }],
    ['a cross-origin preflight', 'https://docs.example.com/api/x', { method: 'OPTIONS' }],
    ['a lower-case options request', 'https://docs.example.com/api/x', { method: 'options' }],
    [
      'the second hop of a redirect, even to an API path of the same server',
      'https://docs.example.com/api/x',
      { redirected: true },
    ],
  ];
  it.each(neverAttached)('does not attach for %s', (_name, url, overrides) => {
    const decision = decideAuthorization(request(url, overrides), context);
    expect(decision.attach).toBe(false);
    expect(JSON.stringify(decision.requestHeaders)).not.toContain(TOKEN);
  });

  it('attaches to every other method the API uses', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(decideAuthorization(request(`${SERVER}/api/x`, { method }), context).attach).toBe(
        true,
      );
    }
  });

  it('strips a page-supplied Authorization header from a preflight as well', () => {
    const decision = decideAuthorization(
      request(`${SERVER}/api/x`, {
        method: 'OPTIONS',
        requestHeaders: { Authorization: 'Bearer anything' },
      }),
      context,
    );
    expect(decision).toMatchObject({ attach: false, reason: 'preflight', changed: true });
    expect(decision.requestHeaders).toEqual({});
  });

  it('removes a token that travelled with a redirect to another origin', () => {
    // After a 307 from the configured server, the listener runs again for the new URL
    // and the request still carries the header added for the first hop.
    const redirected = request('https://evil.example/api/collect', {
      requestHeaders: { Accept: '*/*', Authorization: `Bearer ${TOKEN}` },
    });
    const decision = decideAuthorization(redirected, context);
    expect(decision).toMatchObject({ attach: false, reason: 'foreign_origin', changed: true });
    expect(decision.requestHeaders).toEqual({ Accept: '*/*' });
  });

  it('removes the token from a redirect that stays inside the API of the same server', () => {
    const redirected = request(`${SERVER}/api/elsewhere`, {
      redirected: true,
      requestHeaders: { Accept: '*/*', Authorization: `Bearer ${TOKEN}` },
    });
    const decision = decideAuthorization(redirected, context);
    expect(decision).toMatchObject({ attach: false, reason: 'redirected', changed: true });
    expect(decision.requestHeaders).toEqual({ Accept: '*/*' });
    // The same request, not redirected, is authorised.
    expect(classifyRequest(request(`${SERVER}/api/elsewhere`), context)).toBe('attached');
  });

  it('has no exception for requests without a page behind them', () => {
    // The main process's own attachment download gets its header from the main
    // process (asset-download.ts); this rule never attaches one to it.
    const download = request(`${SERVER}/api/documents/x/assets/y?download=1`, {
      initiatorOrigin: undefined,
      resourceType: 'mainFrame',
    });
    expect(decideAuthorization(download, context)).toMatchObject({
      attach: false,
      reason: 'foreign_initiator',
    });
    expect(Object.keys(download)).not.toContain('approvedDownload');
  });

  it('removes any page-supplied Authorization header, whatever its casing', () => {
    for (const name of ['authorization', 'AUTHORIZATION', 'AuThOrIzAtIoN']) {
      const decision = decideAuthorization(
        request('https://third.example/x', { requestHeaders: { [name]: 'Bearer page-chosen' } }),
        context,
      );
      expect(decision.requestHeaders).toEqual({});
      expect(decision.changed).toBe(true);
    }
  });

  it('replaces rather than duplicates an existing header on a matching request', () => {
    const decision = decideAuthorization(
      request(`${SERVER}/api/x`, { requestHeaders: { authorization: 'Bearer stale' } }),
      context,
    );
    expect(decision.requestHeaders).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it('attaches nothing without a session or without a configured server', () => {
    expect(
      decideAuthorization(request(`${SERVER}/api/x`), { serverOrigin: SERVER, token: null }),
    ).toMatchObject({
      attach: false,
      reason: 'no_session',
      changed: false,
    });
    expect(
      decideAuthorization(request(`${SERVER}/api/x`), { serverOrigin: null, token: TOKEN }).attach,
    ).toBe(false);
  });
});

describe('content security policy', () => {
  it('matches the specified policy for a configured https server', () => {
    expect(buildContentSecurityPolicy({ windowKind: 'panel', serverOrigin: SERVER })).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        `img-src 'self' data: blob: ${SERVER}; font-src 'self'; ` +
        `connect-src ${SERVER} wss://docs.example.com; base-uri 'none'; form-action 'none'; ` +
        "frame-src 'none'; object-src 'none'; frame-ancestors 'none'",
    );
  });

  it('uses ws for an http (loopback) server', () => {
    const policy = buildContentSecurityPolicy({
      windowKind: 'panel',
      serverOrigin: 'http://localhost:4310',
    });
    expect(policy).toContain('connect-src http://localhost:4310 ws://localhost:4310;');
    expect(websocketOrigin('https://a.example:8443')).toBe('wss://a.example:8443');
  });

  it('gives no network access without a server or to non-panel windows', () => {
    for (const policy of [
      buildContentSecurityPolicy({ windowKind: 'panel', serverOrigin: null }),
      buildContentSecurityPolicy({ windowKind: 'settings', serverOrigin: SERVER }),
      buildContentSecurityPolicy({ windowKind: 'probe', serverOrigin: SERVER }),
    ]) {
      expect(policy).toContain("connect-src 'none'");
      expect(policy).toContain("img-src 'self' data: blob:;");
      expect(policy).not.toContain('docs.example.com');
    }
  });

  it('never allows inline or evaluated script, frames, objects or a base URL', () => {
    const policy = buildContentSecurityPolicy({ windowKind: 'panel', serverOrigin: SERVER });
    expect(policy).toContain("script-src 'self';");
    expect(policy).not.toMatch(/script-src[^;]*unsafe/);
    expect(policy).not.toContain('*');
    for (const directive of [
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ]) {
      expect(policy).toContain(directive);
    }
  });

  it.each([
    "https://docs.example.com; script-src 'unsafe-inline' *",
    'https://docs.example.com https://evil.example',
    'https://docs.example.com/path',
    "https://docs.example.com'",
    'https://docs.example.com\nX-Injected: 1',
    'javascript:alert(1)',
    'https://user:pw@docs.example.com',
    '*',
  ])('treats a non-canonical origin (%s) as no server', (origin) => {
    const policy = buildContentSecurityPolicy({ windowKind: 'panel', serverOrigin: origin });
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toContain('evil');
    expect(policy).not.toContain('unsafe-inline *');
    expect(policy).not.toContain('\n');
  });
});

describe('app:// request resolution', () => {
  const root = path.resolve('/opt/RealtimeDocs/resources/app.asar/renderer');
  const ok = (url: string) => resolveAppRequest(url, 'GET', root);

  it('serves the entry pages and hashed assets from inside the renderer root', () => {
    expect(ok(`${APP}/panel.html`)).toMatchObject({
      ok: true,
      filePath: path.join(root, 'panel.html'),
      contentType: 'text/html; charset=utf-8',
      windowKind: 'panel',
      immutable: false,
    });
    expect(ok(`${APP}/settings.html?tab=privacy#top`)).toMatchObject({
      ok: true,
      windowKind: 'settings',
    });
    expect(ok(`${APP}/assets/panel-B7xY2.js`)).toMatchObject({
      ok: true,
      filePath: path.join(root, 'assets', 'panel-B7xY2.js'),
      contentType: 'text/javascript; charset=utf-8',
      windowKind: null,
      immutable: true,
    });
    expect(ok(`${APP}/assets/fonts/atkinson.woff2`)).toMatchObject({
      ok: true,
      contentType: 'font/woff2',
    });
    // The pre-bundle boot script is its own file at the root, never cached as immutable.
    expect(ok(`${APP}/boot.js`)).toMatchObject({
      ok: true,
      filePath: path.join(root, 'boot.js'),
      contentType: 'text/javascript; charset=utf-8',
      windowKind: null,
      immutable: false,
    });
  });

  const refused: [string, string][] = [
    ['parent traversal', `${APP}/../main/main.cjs`],
    ['deep traversal', `${APP}/assets/../../../../etc/passwd`],
    ['encoded traversal', `${APP}/assets/%2e%2e/%2e%2e/main/main.cjs`],
    ['mixed encoded traversal', `${APP}/assets/..%2f..%2fmain%2fmain.cjs`],
    ['double-encoded traversal', `${APP}/assets/%252e%252e/secret.js`],
    ['encoded backslash', `${APP}/assets/..%5c..%5cmain.cjs`],
    ['literal backslash', `${APP}/assets/..\\..\\main.cjs`],
    ['NUL byte', `${APP}/assets/a.js%00.png`],
    ['absolute path', `${APP}//etc/passwd`],
    ['windows drive', `${APP}/C:/Windows/win.ini`],
    ['the main bundle', `${APP}/main/main.cjs`],
    ['the preload bundle', `${APP}/preload/preload.cjs`],
    ['package.json', `${APP}/package.json`],
    ['root', `${APP}/`],
    ['directory listing', `${APP}/assets/`],
    ['unknown page', `${APP}/index.html`],
    ['another root script', `${APP}/main.js`],
    ['boot script look-alike', `${APP}/boot.js.map`],
    ['boot script in a sub-path', `${APP}/x/boot.js`],
    ['unlisted type', `${APP}/assets/payload.exe`],
    ['no extension', `${APP}/assets/README`],
    ['source map', `${APP}/assets/panel.js.map`],
    ['other host', 'app://evil/panel.html'],
    ['look-alike host', 'app://realtimedocs.evil/panel.html'],
    ['host with port', 'app://realtimedocs:8080/panel.html'],
    ['host with credentials', 'app://user:pw@realtimedocs/panel.html'],
    ['uppercase host', 'app://REALTIMEDOCS/panel.html'],
    ['other scheme', 'file:///opt/RealtimeDocs/resources/app.asar/renderer/panel.html'],
    ['https', 'https://realtimedocs/panel.html'],
    ['garbage', ':::'],
    ['malformed escape', `${APP}/assets/%E0%A4%A.js`],
  ];
  it.each(refused)('refuses %s', (_name, url) => {
    const result = ok(url);
    expect(result.ok).toBe(false);
  });

  it('never resolves outside the renderer root for any refused or accepted URL', () => {
    for (const [, url] of refused) {
      const result = ok(url);
      if (result.ok) expect(result.filePath.startsWith(`${root}${path.sep}`)).toBe(true);
    }
  });

  it('only answers GET and HEAD', () => {
    expect(resolveAppRequest(`${APP}/panel.html`, 'HEAD', root).ok).toBe(true);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      expect(resolveAppRequest(`${APP}/panel.html`, method, root)).toMatchObject({
        ok: false,
        status: 405,
      });
    }
  });

  it('sends the policy and hardening headers with every response', () => {
    const resolution = ok(`${APP}/panel.html`);
    if (!resolution.ok) throw new Error('expected success');
    const headers = appResponseHeaders(resolution, 'default-src none');
    expect(headers['Content-Security-Policy']).toBe('default-src none');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['Permissions-Policy']).toContain('camera=()');
    expect(headers['Permissions-Policy']).toContain('microphone=()');
    expect(headers['Permissions-Policy']).toContain('display-capture=()');
  });
});

describe('navigation and popups', () => {
  it('recognises only the packaged entry pages', () => {
    expect(isAppPageUrl(`${APP}/panel.html`)).toBe(true);
    expect(isAppPageUrl(`${APP}/settings.html#privacy`)).toBe(true);
    for (const url of [
      `${APP}/assets/x.js`,
      'app://evil/panel.html',
      'https://docs.example.com/panel.html',
      'file:///panel.html',
      'about:blank',
      'javascript:alert(1)',
      'data:text/html,hi',
      '',
    ]) {
      expect(isAppPageUrl(url)).toBe(false);
    }
  });

  it('allows only same-page navigation', () => {
    const panel = `${APP}/panel.html`;
    expect(decideNavigation(`${panel}#section`, panel)).toBe('allow');
    expect(decideNavigation(`${APP}/settings.html`, panel)).toBe('block');
    for (const target of [
      'https://docs.example.com/',
      'https://evil.example/phish',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'about:blank',
      'app://evil/panel.html',
      'realtimedocs://open?server=x',
      'chrome://settings',
    ]) {
      expect(decideNavigation(target, panel)).toBe('block');
    }
  });

  it('hands only http, https and mailto links to the operating system', () => {
    expect(decideExternalOpen('https://example.com/a?b=1')).toEqual({
      open: true,
      url: 'https://example.com/a?b=1',
    });
    expect(decideExternalOpen('http://example.com')).toEqual({
      open: true,
      url: 'http://example.com/',
    });
    expect(decideExternalOpen('mailto:someone@example.com')).toEqual({
      open: true,
      url: 'mailto:someone@example.com',
    });
    for (const blocked of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>1</script>',
      'vbscript:msgbox(1)',
      'tel:+15551234',
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=x',
      'smb://attacker/share',
      'realtimedocs://open?server=https%3A%2F%2Fevil.example',
      'app://realtimedocs/panel.html',
      'chrome://settings',
      '\\\\attacker\\share\\file.exe',
      'C:\\Windows\\System32\\calc.exe',
      '/usr/bin/open',
      '',
      `https://example.com/${'a'.repeat(3000)}`,
      null,
      { url: 'https://example.com' },
    ]) {
      expect(decideExternalOpen(blocked)).toEqual({ open: false });
    }
  });
});

describe('attachment download links', () => {
  const DOCUMENT = '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d';
  const ASSET = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const open = { serverOrigin: SERVER, documentId: DOCUMENT };
  const link = `${SERVER}/api/documents/${DOCUMENT}/assets/${ASSET}?download=1`;

  it('recognises the download link of an attachment of the open document', () => {
    expect(matchAssetDownload(link, open)).toEqual({ url: link, assetId: ASSET });
  });

  const refused: [string, unknown][] = [
    ['another server', link.replace(SERVER, 'https://evil.example')],
    ['a look-alike host', link.replace(SERVER, 'https://docs.example.com.evil.example')],
    ['another port', link.replace(SERVER, 'https://docs.example.com:8443')],
    ['plain http', link.replace('https://', 'http://')],
    ['another document', link.replace(DOCUMENT, 'aaaaaaaa-9a4d-4c7b-8e21-5d6f7a8b9c0d')],
    ['the image itself (no download flag)', link.replace('?download=1', '')],
    ['an extra parameter', `${link}&next=https://evil.example`],
    ['another parameter value', link.replace('download=1', 'download=2')],
    ['a fragment', `${link}#x`],
    ['credentials', link.replace('https://', 'https://user:pw@')],
    ['a path below the asset', link.replace('?download=1', '/../../../users?download=1')],
    ['an encoded traversal', link.replace(ASSET, `${ASSET}%2f..%2f..`)],
    ['an asset id that is not an id', link.replace(ASSET, 'not-an-id')],
    ['an upper-case id', link.replace(ASSET, ASSET.toUpperCase())],
    ['another API route', `${SERVER}/api/documents/${DOCUMENT}/export?format=txt`],
    ['the desktop logout', `${SERVER}/api/desktop/logout`],
    ['a file URL', 'file:///etc/passwd'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['the app itself', 'app://realtimedocs/panel.html'],
    ['not a string', { href: link }],
    ['nothing', ''],
    ['oversized', `${link}&${'x'.repeat(3000)}`],
  ];
  it.each(refused)('refuses %s', (_name, input) => {
    expect(matchAssetDownload(input, open)).toBeNull();
  });

  it('refuses everything when no document is open or no server is set', () => {
    expect(matchAssetDownload(link, { serverOrigin: SERVER, documentId: null })).toBeNull();
    expect(matchAssetDownload(link, { serverOrigin: null, documentId: DOCUMENT })).toBeNull();
    expect(matchAssetDownload(link, { serverOrigin: SERVER, documentId: '../x' })).toBeNull();
  });

  describe('the name proposed in the save dialog', () => {
    it("takes the name from the server's header, preferring the UTF-8 form", () => {
      // Exactly what the server sends (apps/server/src/assets/filename.ts).
      expect(
        fileNameFromContentDisposition(
          `attachment; filename="Besprechung _ Notizen.txt"; filename*=UTF-8''Besprechung%20%E2%80%93%20Notizen.txt`,
        ),
      ).toBe('Besprechung – Notizen.txt');
      expect(fileNameFromContentDisposition('attachment; filename="meeting-notes.txt"')).toBe(
        'meeting-notes.txt',
      );
      expect(fileNameFromContentDisposition('attachment; filename=plain.pdf')).toBe('plain.pdf');
      expect(fileNameFromContentDisposition('attachment; filename="a \\"quoted\\" name.txt"')).toBe(
        'a "quoted" name.txt',
      );
      // A broken UTF-8 form falls back to the plain one.
      expect(
        fileNameFromContentDisposition(`attachment; filename="ok.txt"; filename*=UTF-8''%E0%A4%A`),
      ).toBe('ok.txt');
    });

    it.each([
      null,
      undefined,
      '',
      'attachment',
      'inline; name=x',
      `attachment; ${'x'.repeat(5000)}`,
    ])('finds no name in %j', (header) => {
      expect(fileNameFromContentDisposition(header)).toBeNull();
    });

    const cleaned: [string, string | null, string][] = [
      ['an ordinary name', 'meeting-notes.txt', 'meeting-notes.txt'],
      ['a POSIX path', '../../../etc/passwd', 'passwd'],
      ['a Windows path', 'C:\\Users\\me\\Desktop\\evil.bat', 'evil.bat'],
      ['a mixed path', '..\\../x/..\\notes.txt', 'notes.txt'],
      ['a hidden file', '.bashrc', 'bashrc'],
      ['only dots', '...', 'attachment'],
      ['a trailing dot and space', 'report.pdf. ', 'report.pdf'],
      ['control characters', 'a\u0000b\u001fc\u007f.txt', 'a_b_c_.txt'],
      ['characters Windows refuses', 'a<b>c:d"e|f?g*.txt', 'a_b_c_d_e_f_g_.txt'],
      ['a Windows device name', 'CON', '_CON'],
      ['a device name with an extension', 'nul.txt', '_nul.txt'],
      ['COM and LPT ports', 'lpt1.log', '_lpt1.log'],
      // "invoice‮txt.exe" is displayed as "invoiceexe.txt" by anything that honours the override.
      ['a right-to-left override', 'invoice\u202etxt.exe', 'invoicetxt.exe'],
      ['other direction marks', '\u2066a\u2069\u200fb\ufeff.md', 'ab.md'],
      ['runs of white space', '  a \t\n b  .txt', 'a b .txt'],
      ['nothing', null, 'attachment'],
      ['an empty string', '', 'attachment'],
      ['only separators', '///', 'attachment'],
    ];
    it.each(cleaned)('turns %s into a plain file name', (_name, input, expected) => {
      const result = safeFileName(input);
      expect(result).toBe(expected);
      expect(
        [...result].every(
          (character) =>
            (character.codePointAt(0) ?? 0) >= 0x20 && character !== '/' && character !== '\\',
        ),
      ).toBe(true);
    });

    it('shortens a very long name and keeps its extension', () => {
      const long = `${'ä'.repeat(400)}.docx`;
      const result = safeFileName(long);
      expect([...result]).toHaveLength(150);
      expect(result.endsWith('.docx')).toBe(true);
      // Astral characters are not cut in half.
      const emoji = safeFileName(`${'📄'.repeat(200)}.pdf`);
      expect([...emoji]).toHaveLength(150);
      expect(emoji.endsWith('.pdf')).toBe(true);
      expect(emoji).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    });

    it('never returns a path, whatever it is given', () => {
      for (const input of [
        '/absolute/path',
        '~/.ssh/authorized_keys',
        '..',
        '.',
        'a/../../b',
        'file:///etc/passwd',
        '\\\\server\\share\\x.txt',
        'x\u2028y',
      ]) {
        const result = safeFileName(input);
        expect(result, input).not.toMatch(/[/\\]/);
        expect(result, input).not.toMatch(/^\.+$/);
        expect(result.length, input).toBeGreaterThan(0);
      }
    });
  });

  describe('reading the file', () => {
    const stream = (sizes: number[]) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const size of sizes) controller.enqueue(new Uint8Array(size).fill(7));
          controller.close();
        },
      });

    it('collects the whole body when it fits', async () => {
      const result = await readBodyLimited(stream([10, 20, 5]), 35);
      expect(result).toMatchObject({ ok: true, size: 35 });
      expect(result.ok && result.chunks.map((chunk) => chunk.byteLength)).toEqual([10, 20, 5]);
    });

    it('gives up as soon as the body is larger than allowed, whatever its declared length', async () => {
      let cancelled = false;
      let produced = 0;
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          produced += 1;
          controller.enqueue(new Uint8Array(1024));
        },
        cancel() {
          cancelled = true;
        },
      });
      expect(await readBodyLimited(endless, 10 * 1024)).toEqual({ ok: false, reason: 'too_large' });
      expect(cancelled).toBe(true);
      // It stopped right after the limit, not after reading much more.
      expect(produced).toBeLessThan(20);
    });

    it('accepts an empty file', async () => {
      expect(await readBodyLimited(stream([]), 10)).toEqual({ ok: true, chunks: [], size: 0 });
    });
  });
});
