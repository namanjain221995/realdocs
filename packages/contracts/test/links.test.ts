import { describe, expect, it } from 'vitest';
import {
  ClientStateless,
  CreateShareRequest,
  buildDesktopHandoffUrl,
  buildShareUrl,
  collabDocumentName,
  isLoopbackOrigin,
  normalizeServerOrigin,
  parseCollabDocumentName,
  parseDesktopHandoffUrl,
  parseShareUrl,
} from '../src/index';

const DOC = '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d';
const SECRET = 'a'.repeat(43);

describe('share links', () => {
  it('round-trips a share URL with the secret in the fragment', () => {
    const url = buildShareUrl('https://docs.example.com', DOC, SECRET);
    expect(url).toBe(`https://docs.example.com/s/${DOC}#${SECRET}`);
    expect(new URL(url).search).toBe('');
    expect(parseShareUrl(url)).toEqual({
      serverOrigin: 'https://docs.example.com',
      grantId: DOC,
      secret: SECRET,
    });
  });

  it.each([
    ['other scheme', `javascript://docs.example.com/s/${DOC}#${SECRET}`],
    ['secret in query', `https://docs.example.com/s/${DOC}?k=${SECRET}`],
    ['credentials', `https://u:p@docs.example.com/s/${DOC}#${SECRET}`],
    ['short secret', `https://docs.example.com/s/${DOC}#abc`],
    ['wrong path', `https://docs.example.com/d/${DOC}#${SECRET}`],
    ['bad id', `https://docs.example.com/s/not-a-uuid#${SECRET}`],
    ['garbage', 'not a url'],
  ])('rejects %s', (_name, input) => {
    expect(parseShareUrl(input)).toBeNull();
  });
});

describe('desktop handoff deep links', () => {
  const good = buildDesktopHandoffUrl({
    serverOrigin: 'https://docs.example.com',
    documentId: DOC,
    code: SECRET,
  });

  it('round-trips', () => {
    expect(good.startsWith('realtimedocs://open?')).toBe(true);
    expect(parseDesktopHandoffUrl(good)).toEqual({
      serverOrigin: 'https://docs.example.com',
      documentId: DOC,
      code: SECRET,
    });
  });

  it.each([
    ['foreign scheme', good.replace('realtimedocs://', 'file://')],
    ['other action', good.replace('://open?', '://exec?')],
    ['extra parameter', `${good}&cmd=calc.exe`],
    ['duplicate parameter', `${good}&doc=${DOC}`],
    ['server with path', good.replace('docs.example.com', 'docs.example.com%2Fevil')],
    ['server with credentials', good.replace('https%3A%2F%2F', 'https%3A%2F%2Fu%3Ap%40')],
    ['non-http server', good.replace('https%3A', 'ftp%3A')],
    ['bad document id', good.replace(DOC, 'x')],
    ['bad code', good.replace(SECRET, 'short')],
    ['fragment', `${good}#x`],
    ['path after action', good.replace('://open?', '://open/extra?')],
  ])('rejects %s', (_name, input) => {
    expect(parseDesktopHandoffUrl(input)).toBeNull();
  });
});

describe('server origin handling', () => {
  it('normalises user input to an origin', () => {
    expect(normalizeServerOrigin(' docs.example.com/some/path ')).toBe('https://docs.example.com');
    expect(normalizeServerOrigin('http://localhost:4310/')).toBe('http://localhost:4310');
    expect(normalizeServerOrigin('ftp://example.com')).toBeNull();
    expect(normalizeServerOrigin('https://user:pw@example.com')).toBeNull();
    expect(normalizeServerOrigin('')).toBeNull();
  });

  it('recognises loopback only', () => {
    expect(isLoopbackOrigin('http://localhost:4310')).toBe(true);
    expect(isLoopbackOrigin('http://127.0.0.1:4310')).toBe(true);
    expect(isLoopbackOrigin('http://192.168.1.20:4310')).toBe(false);
    expect(isLoopbackOrigin('http://localhost.evil.example')).toBe(false);
  });
});

describe('collaboration names and messages', () => {
  it('binds the room name to a generation', () => {
    expect(collabDocumentName(DOC, 3)).toBe(`${DOC}.g3`);
    expect(parseCollabDocumentName(`${DOC}.g3`)).toEqual({ documentId: DOC, generation: 3 });
    expect(parseCollabDocumentName(`${DOC}.g0`)).toBeNull();
    expect(parseCollabDocumentName(`${DOC}`)).toBeNull();
    expect(parseCollabDocumentName(`x.g1`)).toBeNull();
  });

  it('defaults share links to view-only', () => {
    expect(CreateShareRequest.parse({})).toEqual({ role: 'viewer', label: '', expiresAt: null });
  });

  it('accepts only known client messages', () => {
    expect(ClientStateless.safeParse({ t: 'mark', n: 4 }).success).toBe(true);
    expect(ClientStateless.safeParse({ t: 'mark', n: -1 }).success).toBe(false);
    expect(ClientStateless.safeParse({ t: 'role', role: 'admin' }).success).toBe(false);
  });
});
