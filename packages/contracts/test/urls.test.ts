import { describe, expect, it } from 'vitest';
import {
  isSafeExternalUrl,
  isSafeLinkHref,
  isStrictHostname,
  normalizeServerOrigin,
  sanitizeLinkHref,
} from '../src/index';

const TAB = String.fromCharCode(9);
const NEWLINE = String.fromCharCode(10);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

describe('sanitizeLinkHref', () => {
  it('keeps ordinary web, mail and phone links', () => {
    expect(sanitizeLinkHref('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
    expect(sanitizeLinkHref('http://example.com')).toBe('http://example.com/');
    expect(sanitizeLinkHref('mailto:someone@example.com')).toBe('mailto:someone@example.com');
    expect(sanitizeLinkHref('tel:+15551234567')).toBe('tel:+15551234567');
  });

  it('upgrades a bare domain to https', () => {
    expect(sanitizeLinkHref('example.com/page')).toBe('https://example.com/page');
    expect(sanitizeLinkHref('docs.example.co.uk')).toBe('https://docs.example.co.uk/');
  });

  it('accepts hosts that exist on the web but are not strict DNS names', () => {
    expect(sanitizeLinkHref('https://my_bucket.example.com/x')).toBe(
      'https://my_bucket.example.com/x',
    );
    expect(sanitizeLinkHref('https://example.com./x')).toBe('https://example.com./x');
    expect(sanitizeLinkHref('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080/');
    expect(sanitizeLinkHref('http://[::1]:8080/')).toBe('http://[::1]:8080/');
  });

  it('rejects script-capable and local schemes', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      `java${TAB}script:alert(1)`,
      `java${NEWLINE}script:alert(1)`,
      `java${ZERO_WIDTH_SPACE}script:alert(1)`,
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'blob:https://example.com/id',
      'realtimedocs://open?server=https://example.com',
      'ms-msdt:/id',
      'about:blank',
    ]) {
      expect([href, sanitizeLinkHref(href)]).toEqual([href, null]);
    }
  });

  it('rejects strings that look like a Windows network path instead of upgrading them', () => {
    expect(sanitizeLinkHref('\\\\server.local\\share')).toBeNull();
    expect(sanitizeLinkHref('\\\\server\\share\\file.txt')).toBeNull();
    expect(sanitizeLinkHref('server.local\\share')).toBeNull();
  });

  it('rejects hosts with characters that could break out of a header, policy or markup', () => {
    for (const href of [
      "https://exa'mple.com/",
      'https://exa"mple.com/',
      'https://exa;mple.com/',
      'https://exa,mple.com/',
      'https://*.example.com/',
      'https://exa(mple).com/',
      'https://exa`mple.com/',
      'https://-example.com/',
    ]) {
      expect([href, sanitizeLinkHref(href)]).toEqual([href, null]);
    }
  });

  it('rejects relative references, empty values, non-strings and oversized input', () => {
    expect(sanitizeLinkHref('/relative/path')).toBeNull();
    expect(sanitizeLinkHref('#fragment')).toBeNull();
    expect(sanitizeLinkHref('')).toBeNull();
    expect(sanitizeLinkHref('   ')).toBeNull();
    expect(sanitizeLinkHref(null)).toBeNull();
    expect(sanitizeLinkHref(42)).toBeNull();
    expect(sanitizeLinkHref({ href: 'https://example.com' })).toBeNull();
    expect(sanitizeLinkHref(`https://example.com/${'a'.repeat(2100)}`)).toBeNull();
  });

  it('agrees with isSafeLinkHref', () => {
    expect(isSafeLinkHref('https://example.com')).toBe(true);
    expect(isSafeLinkHref('javascript:alert(1)')).toBe(false);
  });
});

describe('isSafeExternalUrl', () => {
  it('lets web and mail links leave the desktop app, but not phone links or anything else', () => {
    expect(isSafeExternalUrl('https://example.com/')).toBe(true);
    expect(isSafeExternalUrl('http://example.com/')).toBe(true);
    expect(isSafeExternalUrl('mailto:someone@example.com')).toBe(true);
    expect(isSafeExternalUrl('tel:+15551234567')).toBe(false);
    expect(isSafeExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isSafeExternalUrl('\\\\server.local\\share')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('isStrictHostname', () => {
  it('accepts DNS names, IPv4 and bracketed IPv6', () => {
    for (const host of [
      'example.com',
      'a.b-c.example',
      'localhost',
      '127.0.0.1',
      '[::1]',
      'xn--bcher-kva.example',
    ]) {
      expect([host, isStrictHostname(host)]).toEqual([host, true]);
    }
  });

  it('rejects everything else', () => {
    for (const host of [
      '',
      'exa_mple.com',
      'example.com.',
      '-example.com',
      'example-.com',
      "exa'mple.com",
      'exa;mple.com',
      '*.example.com',
      'exa mple.com',
      `${'a'.repeat(64)}.com`,
    ]) {
      expect([host, isStrictHostname(host)]).toEqual([host, false]);
    }
  });
});

describe('normalizeServerOrigin', () => {
  it('normalises ordinary addresses', () => {
    expect(normalizeServerOrigin('docs.example.com')).toBe('https://docs.example.com');
    expect(normalizeServerOrigin(' https://docs.example.com/some/path?x=1 ')).toBe(
      'https://docs.example.com',
    );
    expect(normalizeServerOrigin('http://127.0.0.1:4310')).toBe('http://127.0.0.1:4310');
    expect(normalizeServerOrigin('http://[::1]:4310')).toBe('http://[::1]:4310');
    expect(normalizeServerOrigin('HTTPS://Docs.Example.COM')).toBe('https://docs.example.com');
  });

  it('rejects hosts with characters that could inject into a header or policy', () => {
    for (const input of [
      "https://docs.example.com;script-src 'unsafe-inline'",
      "https://exa'mple.com",
      'https://exa"mple.com',
      'https://exa,mple.com',
      'https://*.example.com',
      'https://exa;mple.com',
      'https://exa_mple.com',
      '\\\\server.local\\share',
      'https:\\\\docs.example.com',
    ]) {
      expect([input, normalizeServerOrigin(input)]).toEqual([input, null]);
    }
  });

  it('rejects credentials, other schemes and empty input', () => {
    expect(normalizeServerOrigin('https://user:pass@docs.example.com')).toBeNull();
    expect(normalizeServerOrigin('ftp://docs.example.com')).toBeNull();
    expect(normalizeServerOrigin('file:///etc/passwd')).toBeNull();
    expect(normalizeServerOrigin('')).toBeNull();
    expect(normalizeServerOrigin('   ')).toBeNull();
  });
});
