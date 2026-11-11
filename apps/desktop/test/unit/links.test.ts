import { buildDesktopHandoffUrl, buildShareUrl } from '@realtimedocs/contracts';
import { describe, expect, it } from 'vitest';
import {
  describeLinkForLog,
  evaluateDeepLink,
  evaluateShareLink,
  findDeepLinkArg,
} from '../../src/shared/links';
import {
  classifyLinkOrigin,
  evaluateServerOrigin,
  isCanonicalHttpOrigin,
  isPrivateNetworkHost,
  normalizeUserServerInput,
} from '../../src/shared/server-origin';

const DOC = '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d';
const GRANT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SECRET = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
const SERVER = 'https://docs.example.com';
const CONFIGURED = { serverOrigin: SERVER, acceptedLinkOrigin: null };

const handoff = (serverOrigin = SERVER) =>
  buildDesktopHandoffUrl({ serverOrigin, documentId: DOC, code: SECRET });
const share = (origin = SERVER) => buildShareUrl(origin, GRANT, SECRET);

describe('finding the deep link among process arguments', () => {
  it('finds the link wherever Chromium put it', () => {
    const link = handoff();
    expect(findDeepLinkArg(['/opt/app/realtimedocs', '--allow-file-access', link])).toBe(link);
    expect(findDeepLinkArg(['app.exe', '--', link, '--original-process-start-time=1'])).toBe(link);
    expect(findDeepLinkArg(['app.exe', 'REALTIMEDOCS://open?x=1'])).toBe('REALTIMEDOCS://open?x=1');
  });

  it('ignores everything that is not our scheme', () => {
    expect(findDeepLinkArg(['app.exe', '--inspect=9229', 'https://docs.example.com'])).toBeNull();
    expect(
      findDeepLinkArg(['app.exe', 'realtimedocs-evil://open', 'xrealtimedocs://open']),
    ).toBeNull();
    expect(findDeepLinkArg([])).toBeNull();
    expect(findDeepLinkArg(['app.exe', `realtimedocs://open?${'a'.repeat(5000)}`])).toBeNull();
  });
});

describe('"Open in Desktop" deep links', () => {
  it('accepts a link for the configured server', () => {
    expect(evaluateDeepLink(handoff(), CONFIGURED)).toEqual({
      action: 'redeem',
      documentId: DOC,
      code: SECRET,
    });
  });

  it('never accepts a link when no server is configured', () => {
    expect(evaluateDeepLink(handoff(), { serverOrigin: null, acceptedLinkOrigin: null })).toEqual({
      action: 'reject',
      code: 'no_server_configured',
      linkHost: 'docs.example.com',
    });
  });

  const foreign: [string, string][] = [
    ['another host', handoff('https://evil.example')],
    ['look-alike suffix', handoff('https://docs.example.com.evil.example')],
    ['look-alike prefix', handoff('https://evil-docs.example.com')],
    ['other port', handoff('https://docs.example.com:8443')],
    ['http downgrade', handoff('http://docs.example.com')],
    ['subdomain', handoff('https://a.docs.example.com')],
    ['unicode look-alike (punycode)', handoff('https://xn--docs-example-com-abc.example')],
  ];
  it.each(foreign)('rejects a link for %s without offering to switch', (_name, link) => {
    const decision = evaluateDeepLink(link, CONFIGURED);
    expect(decision.action).toBe('reject');
    if (decision.action === 'reject') expect(decision.code).toBe('server_mismatch');
  });

  const malformed: [string, unknown][] = [
    ['other scheme', handoff().replace('realtimedocs://', 'https://')],
    ['file scheme', 'file:///etc/passwd'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['other action', handoff().replace('://open?', '://settings?')],
    ['path after action', handoff().replace('://open?', '://open/../exec?')],
    ['extra parameter', `${handoff()}&next=https://evil.example`],
    ['duplicate server', `${handoff()}&server=https%3A%2F%2Fevil.example`],
    ['duplicate code', `${handoff()}&code=${SECRET}`],
    ['missing code', handoff().replace(/&code=[^&]+/, '')],
    ['short code', handoff().replace(SECRET, 'abc')],
    ['code with path chars', handoff().replace(SECRET, `${SECRET.slice(0, 40)}/..`)],
    ['bad document id', handoff().replace(DOC, '../../etc/passwd')],
    ['uppercase document id', handoff().replace(DOC, DOC.toUpperCase())],
    ['server with credentials', handoff().replace('https%3A%2F%2F', 'https%3A%2F%2Fuser%3Apw%40')],
    ['server with path', handoff().replace('docs.example.com', 'docs.example.com%2Fadmin')],
    ['server with query', handoff().replace('docs.example.com', 'docs.example.com%3Fx%3D1')],
    [
      'server not an origin',
      handoff().replace('https%3A%2F%2Fdocs.example.com', 'docs.example.com'),
    ],
    ['ftp server', handoff().replace('https%3A', 'ftp%3A')],
    // The contracts refuse a trailing-dot host as a server origin, so this is not even a mismatch.
    ['server with a trailing-dot host', handoff('https://docs.example.com.')],
    ['fragment', `${handoff()}#frag`],
    ['credentials in link', handoff().replace('realtimedocs://', 'realtimedocs://user:pw@')],
    ['command-line switch smuggling', `${handoff()}" --inspect=0.0.0.0:9229 "`],
    ['newline injection', `${handoff()}\nrealtimedocs://open?server=x`],
    ['empty', ''],
    ['not a string', 42],
    ['null', null],
    ['object', { url: handoff() }],
    ['oversized', `${handoff()}&${'x'.repeat(4000)}`],
  ];
  it.each(malformed)('rejects %s as invalid', (_name, link) => {
    expect(evaluateDeepLink(link, CONFIGURED)).toEqual({
      action: 'reject',
      code: 'invalid_link',
      linkHost: null,
    });
  });

  it('accepts the explicitly accepted public address of the configured server', () => {
    const tunnel = { serverOrigin: 'http://localhost:4310', acceptedLinkOrigin: SERVER };
    expect(evaluateDeepLink(handoff(), tunnel).action).toBe('redeem');
    // Without that explicit acceptance the same link is a mismatch.
    expect(
      evaluateDeepLink(handoff(), {
        serverOrigin: 'http://localhost:4310',
        acceptedLinkOrigin: null,
      }).action,
    ).toBe('reject');
  });
});

describe('pasted share links', () => {
  const options = { allowInsecureLan: false };

  it('exchanges a link for the configured server', () => {
    expect(evaluateShareLink(`  ${share()}  `, CONFIGURED, options)).toEqual({
      action: 'exchange',
      grantId: GRANT,
      secret: SECRET,
    });
  });

  it('asks for confirmation before switching to another https server', () => {
    const decision = evaluateShareLink(share('https://other.example'), CONFIGURED, options);
    expect(decision).toMatchObject({
      action: 'confirm',
      reason: 'different_server',
      linkOrigin: 'https://other.example',
    });
  });

  it('asks for confirmation when no server is configured yet', () => {
    const decision = evaluateShareLink(
      share(),
      { serverOrigin: null, acceptedLinkOrigin: null },
      options,
    );
    expect(decision).toMatchObject({
      action: 'confirm',
      reason: 'no_server_configured',
      linkOrigin: SERVER,
    });
  });

  it.each([
    ['look-alike host', share('https://docs.example.com.evil.example')],
    ['other port', share('https://docs.example.com:444')],
    ['http downgrade of the configured host', share('http://docs.example.com')],
  ])('never treats %s as the configured server', (_name, link) => {
    const decision = evaluateShareLink(link, CONFIGURED, options);
    expect(decision.action).not.toBe('exchange');
  });

  it('refuses to even offer switching to a plain-HTTP public server', () => {
    expect(evaluateShareLink(share('http://docs.example.org'), CONFIGURED, options)).toEqual({
      action: 'reject',
      code: 'insecure_public_http',
      linkOrigin: 'http://docs.example.org',
    });
  });

  it('refuses a plain-HTTP LAN link unless the development override is on', () => {
    const link = share('http://192.168.1.20:4310');
    expect(evaluateShareLink(link, CONFIGURED, { allowInsecureLan: false })).toMatchObject({
      action: 'reject',
      code: 'insecure_lan_disabled',
    });
    expect(evaluateShareLink(link, CONFIGURED, { allowInsecureLan: true })).toMatchObject({
      action: 'confirm',
      linkOrigin: 'http://192.168.1.20:4310',
    });
  });

  const invalid: [string, unknown][] = [
    ['secret in the query', `${SERVER}/s/${GRANT}?secret=${SECRET}`],
    ['missing secret', `${SERVER}/s/${GRANT}`],
    ['short secret', `${SERVER}/s/${GRANT}#abc`],
    ['secret with junk', `${SERVER}/s/${GRANT}#${SECRET}&x=1`],
    ['credentials', share().replace('https://', 'https://user:pw@')],
    ['wrong path', `${SERVER}/d/${GRANT}#${SECRET}`],
    ['path traversal', `${SERVER}/s/../s/${GRANT}/extra#${SECRET}`],
    ['invitation link', `${SERVER}/invite/${GRANT}#${SECRET}`],
    ['bad grant id', `${SERVER}/s/not-a-uuid#${SECRET}`],
    ['javascript scheme', `javascript://docs.example.com/s/${GRANT}#${SECRET}`],
    ['custom scheme', `realtimedocs://docs.example.com/s/${GRANT}#${SECRET}`],
    ['data url', `data:text/html,${SERVER}/s/${GRANT}#${SECRET}`],
    ['plain text', 'please open my document'],
    ['empty', ''],
    ['number', 7],
    ['oversized', `${share()}${'a'.repeat(3000)}`],
  ];
  it.each(invalid)('rejects %s', (_name, link) => {
    expect(evaluateShareLink(link, CONFIGURED, options)).toEqual({
      action: 'reject',
      code: 'invalid_link',
      linkOrigin: null,
    });
  });
});

describe('server origin policy', () => {
  it('requires https except for loopback', () => {
    expect(evaluateServerOrigin('docs.example.com', { allowInsecureLan: false })).toEqual({
      ok: true,
      origin: 'https://docs.example.com',
      transport: 'https',
    });
    expect(evaluateServerOrigin('http://localhost:4310/', { allowInsecureLan: false })).toEqual({
      ok: true,
      origin: 'http://localhost:4310',
      transport: 'loopback_http',
    });
    expect(
      evaluateServerOrigin('http://127.0.0.1:4310', { allowInsecureLan: false }),
    ).toMatchObject({
      ok: true,
      transport: 'loopback_http',
    });
    expect(
      evaluateServerOrigin('http://docs.example.com', { allowInsecureLan: true }),
    ).toMatchObject({
      ok: false,
      code: 'insecure_public_http',
    });
  });

  it('reads a bare loopback address as http and any other bare host as https', () => {
    expect(normalizeUserServerInput('localhost:4310')).toBe('http://localhost:4310');
    expect(normalizeUserServerInput('127.0.0.1:4310')).toBe('http://127.0.0.1:4310');
    expect(normalizeUserServerInput('docs.example.com:8443/path?q=1')).toBe(
      'https://docs.example.com:8443',
    );
    expect(normalizeUserServerInput('https://localhost:4310')).toBe('https://localhost:4310');
    expect(normalizeUserServerInput('   ')).toBeNull();
  });

  it('keeps the development override off by default and limited to private hosts', () => {
    for (const host of [
      '192.168.1.20:4310',
      '10.0.0.5',
      '172.20.3.4:8080',
      '100.101.102.103',
      'buildbox:4310',
      'server.local',
    ]) {
      expect(evaluateServerOrigin(`http://${host}`, { allowInsecureLan: false })).toMatchObject({
        ok: false,
        code: 'insecure_lan_disabled',
      });
      expect(evaluateServerOrigin(`http://${host}`, { allowInsecureLan: true })).toMatchObject({
        ok: true,
        transport: 'insecure_lan_http',
      });
    }
    for (const host of [
      '8.8.8.8',
      '172.32.0.1',
      '192.169.1.1',
      '100.128.0.1',
      'example.com',
      'localhost.evil.example',
    ]) {
      expect(evaluateServerOrigin(`http://${host}`, { allowInsecureLan: true })).toMatchObject({
        ok: false,
        code: 'insecure_public_http',
      });
    }
  });

  it.each([
    'ftp://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pw@example.com',
    'https://',
    '',
    'http://exa mple.com',
  ])('rejects %s', (input) => {
    expect(evaluateServerOrigin(input, { allowInsecureLan: true })).toMatchObject({
      ok: false,
      code: 'invalid_address',
    });
  });

  it('rejects IPv6 literals, which a CSP host source cannot express', () => {
    expect(evaluateServerOrigin('http://[::1]:4310', { allowInsecureLan: true })).toMatchObject({
      ok: false,
      code: 'ipv6_literal_unsupported',
    });
  });

  it('classifies private-network hosts', () => {
    expect(isPrivateNetworkHost('192.168.0.1')).toBe(true);
    expect(isPrivateNetworkHost('169.254.10.10')).toBe(true);
    expect(isPrivateNetworkHost('nas')).toBe(true);
    expect(isPrivateNetworkHost('printer.lan')).toBe(true);
    expect(isPrivateNetworkHost('1.2.3')).toBe(false);
    expect(isPrivateNetworkHost('999.1.1.1')).toBe(false);
    expect(isPrivateNetworkHost('evil.com')).toBe(false);
    expect(isPrivateNetworkHost('-bad-')).toBe(false);
    expect(isPrivateNetworkHost('')).toBe(false);
  });

  it('compares link origins exactly', () => {
    expect(classifyLinkOrigin(SERVER, CONFIGURED)).toBe('match');
    expect(classifyLinkOrigin('https://docs.example.com:443', CONFIGURED)).toBe('mismatch');
    expect(classifyLinkOrigin('https://DOCS.example.com', CONFIGURED)).toBe('mismatch');
    expect(classifyLinkOrigin(SERVER, { serverOrigin: null, acceptedLinkOrigin: SERVER })).toBe(
      'mismatch',
    );
    expect(
      classifyLinkOrigin('https://public.example', {
        serverOrigin: SERVER,
        acceptedLinkOrigin: 'https://public.example',
      }),
    ).toBe('accepted_alias');
  });

  it('refuses host names that could carry Content-Security-Policy syntax', () => {
    // All of these are valid URLs per the URL standard, with `URL.origin` equal to the input.
    for (const origin of [
      'https://docs.example.com;script-src-elem',
      "https://docs.example.com'",
      'https://docs.example.com"',
      'https://docs.example.com,evil.example',
      'https://*.example.com',
      'https://docs_internal.example.com',
      'https://docs.example.com.',
      'https://-docs.example.com',
    ]) {
      expect(new URL(origin).origin).toBe(origin);
      expect(isCanonicalHttpOrigin(origin)).toBe(false);
      expect(evaluateServerOrigin(origin, { allowInsecureLan: true })).toMatchObject({
        ok: false,
        code: 'invalid_address',
      });
      expect(evaluateShareLink(share(origin), CONFIGURED, { allowInsecureLan: true }).action).toBe(
        'reject',
      );
    }
    for (const origin of [
      'https://xn--bcher-kva.example',
      'https://a.b-c.d0.example:8443',
      'http://10.0.0.5:4310',
    ]) {
      expect(isCanonicalHttpOrigin(origin)).toBe(true);
    }
  });

  it('recognises canonical origins only', () => {
    expect(isCanonicalHttpOrigin('https://docs.example.com')).toBe(true);
    expect(isCanonicalHttpOrigin('http://localhost:4310')).toBe(true);
    for (const value of [
      'https://docs.example.com/',
      'https://docs.example.com/path',
      'https://docs.example.com; script-src *',
      "https://docs.example.com 'unsafe-inline'",
      'HTTPS://docs.example.com',
      'https://docs.example.com:443',
      'wss://docs.example.com',
      'https://u:p@docs.example.com',
      '',
      null,
      5,
    ]) {
      expect(isCanonicalHttpOrigin(value)).toBe(false);
    }
  });
});

describe('describing links for logs', () => {
  it('never includes the secret, code or path', () => {
    expect(describeLinkForLog(handoff())).toBe('realtimedocs://open/…');
    expect(describeLinkForLog(share())).toBe('https://docs.example.com/…');
    expect(describeLinkForLog(handoff())).not.toContain(SECRET);
    expect(describeLinkForLog(share())).not.toContain(SECRET);
    expect(describeLinkForLog('::::')).toBe('(unparseable link)');
    expect(describeLinkForLog(undefined)).toBe('(not a string)');
  });
});
