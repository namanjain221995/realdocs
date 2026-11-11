import {
  DOCUMENT_SCHEMA_VERSION,
  buildDesktopHandoffUrl,
  buildInvitationUrl,
  buildShareUrl,
  isCapabilitySecret,
  isUuid,
  parseDesktopHandoffUrl,
  parseShareUrl,
} from '@realtimedocs/contracts';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_PARAMS,
  encodeHash,
  hashPassword,
  needsRehash,
  parseHash,
  verifyPassword,
} from '../../src/auth/password';
import { sessionStatus } from '../../src/auth/sessions';
import { csrfTokenFor, newId, randomToken, safeEqual, sha256 } from '../../src/auth/tokens';
import { TicketStore, type TicketData } from '../../src/collab/tickets';
import type { SessionRow } from '../../src/db/rows';
import { colorFor, guestName, PARTICIPANT_COLORS } from '../../src/util/identity';

/** Small parameters so the suite stays fast; production uses CURRENT_PARAMS. */
const FAST = { memory: 1024, passes: 1, parallelism: 1 };

describe('password hashing (Argon2id via node:crypto)', () => {
  it('uses the documented production parameters', () => {
    expect(CURRENT_PARAMS).toEqual({ memory: 65_536, passes: 3, parallelism: 1 });
  });

  it('hashes with a random salt and verifies in constant time', async () => {
    const first = await hashPassword('correct horse battery staple', FAST);
    const second = await hashPassword('correct horse battery staple', FAST);
    expect(first).toMatch(
      /^\$argon2id\$v=19\$m=1024,t=1,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    expect(first).not.toBe(second);
    expect(await verifyPassword(first, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(first, 'correct horse battery stapl')).toBe(false);
    expect(await verifyPassword(first, '')).toBe(false);
  });

  it('really runs the production parameters', async () => {
    const hash = await hashPassword('a production strength check');
    expect(parseHash(hash)?.params).toEqual(CURRENT_PARAMS);
    expect(await verifyPassword(hash, 'a production strength check')).toBe(true);
    expect(needsRehash(hash)).toBe(false);
  });

  it('treats Unicode-equivalent passwords as equal', async () => {
    const composed = String.fromCodePoint(0xe9); // é
    const decomposed = `e${String.fromCodePoint(0x301)}`; // e + combining acute
    const hash = await hashPassword(`caf${composed}-password-123`, FAST);
    expect(await verifyPassword(hash, `caf${decomposed}-password-123`)).toBe(true);
  });

  it('rejects malformed or hostile stored hashes without throwing', async () => {
    for (const stored of [
      '',
      'plaintext',
      '$argon2i$v=19$m=1024,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
      '$argon2id$v=19$m=4294967295,t=1,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2g',
      '$argon2id$v=19$m=1024,t=99999,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2g',
      '$argon2id$v=19$m=1024,t=1,p=1$$',
    ]) {
      expect(parseHash(stored), stored).toBeNull();
    }
    expect(await verifyPassword('not-a-hash', 'whatever password')).toBe(false);
  });

  it('flags hashes with weaker parameters for rehashing', async () => {
    expect(needsRehash(await hashPassword('some long password', FAST))).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
    const strong = encodeHash(CURRENT_PARAMS, Buffer.alloc(16, 1), Buffer.alloc(32, 2));
    expect(needsRehash(strong)).toBe(false);
  });
});

describe('tokens', () => {
  it('generates 32-byte capability secrets in the contract format', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(isCapabilitySecret(token)).toBe(true);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
    expect(isUuid(newId())).toBe(true);
  });

  it('derives a stable per-session CSRF token that depends on the secret', () => {
    const session = newId();
    const token = csrfTokenFor(session, 'secret-one-secret-one-secret-one-1');
    expect(token).toBe(csrfTokenFor(session, 'secret-one-secret-one-secret-one-1'));
    expect(token).not.toBe(csrfTokenFor(session, 'secret-two-secret-two-secret-two-2'));
    expect(token).not.toBe(csrfTokenFor(newId(), 'secret-one-secret-one-secret-one-1'));
    expect(token).not.toContain(session);
  });

  it('compares byte strings safely', () => {
    expect(safeEqual(sha256('a'), sha256('a'))).toBe(true);
    expect(safeEqual(sha256('a'), sha256('b'))).toBe(false);
    expect(safeEqual(Buffer.from('short'), Buffer.from('longer value'))).toBe(false);
  });
});

describe('share, invitation and handoff links built by the server', () => {
  const origin = 'https://docs.example.com';

  it('round-trips a share link and keeps the secret in the fragment', () => {
    const grantId = newId();
    const secret = randomToken();
    const url = buildShareUrl(origin, grantId, secret);
    expect(parseShareUrl(url)).toEqual({ serverOrigin: origin, grantId, secret });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe(`/s/${grantId}`);
    expect(parsed.search).toBe('');
    expect(parsed.hash).toBe(`#${secret}`);
    expect(`${parsed.origin}${parsed.pathname}${parsed.search}`).not.toContain(secret);
  });

  it('rejects tampered share links', () => {
    const grantId = newId();
    const secret = randomToken();
    for (const bad of [
      `${origin}/s/${grantId}`,
      `${origin}/s/${grantId}#${secret.slice(1)}`,
      `${origin}/s/${grantId}?secret=${secret}`,
      `${origin}/s/not-a-uuid#${secret}`,
      `${origin}/x/${grantId}#${secret}`,
      `javascript:alert(1)//${origin}/s/${grantId}#${secret}`,
      `https://user:pw@docs.example.com/s/${grantId}#${secret}`,
    ]) {
      expect(parseShareUrl(bad), bad).toBeNull();
    }
  });

  it('builds invitation links with the secret in the fragment', () => {
    const id = newId();
    const secret = randomToken();
    const url = new URL(buildInvitationUrl(origin, id, secret));
    expect(url.pathname).toBe(`/invite/${id}`);
    expect(url.hash).toBe(`#${secret}`);
  });

  it('round-trips a desktop handoff link and rejects anything else', () => {
    const handoff = { serverOrigin: origin, documentId: newId(), code: randomToken() };
    const url = buildDesktopHandoffUrl(handoff);
    expect(url.startsWith('realtimedocs://open?')).toBe(true);
    expect(parseDesktopHandoffUrl(url)).toEqual(handoff);

    const params = new URLSearchParams({
      server: handoff.serverOrigin,
      doc: handoff.documentId,
      code: handoff.code,
    });
    for (const bad of [
      url.replace('realtimedocs://', 'https://'),
      url.replace('://open', '://run'),
      `${url}&extra=1`,
      `${url}&doc=${newId()}`,
      url.replace(handoff.code, 'short'),
      url.replace(handoff.documentId, '../../etc/passwd'),
      `realtimedocs://open?${new URLSearchParams({ ...Object.fromEntries(params), server: 'https://docs.example.com/path' })}`,
      `realtimedocs://open?${new URLSearchParams({ ...Object.fromEntries(params), server: 'file:///etc' })}`,
      `realtimedocs://user:pw@open?${params}`,
      `realtimedocs://open/extra?${params}`,
    ]) {
      expect(parseDesktopHandoffUrl(bad), bad).toBeNull();
    }
  });
});

describe('TicketStore', () => {
  const data: TicketData = {
    documentId: newId(),
    generation: 1,
    clientId: 42,
    sessionIds: [newId()],
    participant: { id: newId(), name: 'Asha', color: '#2563eb', role: 'editor', kind: 'user' },
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    protocolVersion: 1,
  };

  it('redeems a ticket exactly once', () => {
    const store = new TicketStore();
    const issued = store.issue(data);
    expect(issued).not.toBeNull();
    expect(isCapabilitySecret(issued?.ticket)).toBe(true);
    expect(store.consume(issued?.ticket ?? '')).toEqual({ ok: true, data });
    expect(store.consume(issued?.ticket ?? '')).toEqual({ ok: false, reason: 'ticket_invalid' });
    store.close();
  });

  it('expires tickets after their lifetime and removes them on the attempt', () => {
    let now = 1_000_000;
    const store = new TicketStore(60_000, 100, () => now);
    const issued = store.issue(data);
    expect(issued?.expiresAt.getTime()).toBe(1_060_000);
    now += 60_000;
    expect(store.consume(issued?.ticket ?? '')).toEqual({ ok: false, reason: 'ticket_expired' });
    expect(store.consume(issued?.ticket ?? '')).toEqual({ ok: false, reason: 'ticket_invalid' });
    expect(store.size).toBe(0);
    store.close();
  });

  it('rejects unknown and malformed tickets', () => {
    const store = new TicketStore();
    expect(store.consume(randomToken())).toEqual({ ok: false, reason: 'ticket_invalid' });
    expect(store.consume('')).toEqual({ ok: false, reason: 'ticket_invalid' });
    expect(store.consume('x'.repeat(5000))).toEqual({ ok: false, reason: 'ticket_invalid' });
    store.close();
  });

  it('drops unused tickets of revoked sessions and bounds its size', () => {
    let now = 0;
    const store = new TicketStore(60_000, 3, () => now);
    const mine = store.issue(data);
    const other = store.issue({ ...data, sessionIds: [newId()] });
    store.revokeForSessions(new Set(data.sessionIds));
    expect(store.consume(mine?.ticket ?? '')).toEqual({ ok: false, reason: 'ticket_invalid' });
    expect(store.consume(other?.ticket ?? '').ok).toBe(true);

    expect(store.issue(data)).not.toBeNull();
    expect(store.issue(data)).not.toBeNull();
    expect(store.issue(data)).not.toBeNull();
    expect(store.issue(data)).toBeNull();
    // Expired entries make room again.
    now += 61_000;
    expect(store.issue(data)).not.toBeNull();
    store.close();
  });
});

describe('sessionStatus', () => {
  const ttl = {
    userTtlSeconds: 1000,
    userIdleSeconds: 100,
    shareTtlSeconds: 1000,
    shareIdleSeconds: 50,
    desktopTtlSeconds: 1000,
    desktopIdleSeconds: 500,
  };
  const now = Date.parse('2026-01-01T00:00:00Z');
  const session = (overrides: Partial<SessionRow>): SessionRow => ({
    id: newId(),
    workspaceId: newId(),
    kind: 'user',
    userId: newId(),
    shareGrantId: null,
    documentId: null,
    parentSessionId: null,
    guestName: null,
    createdAt: new Date(now - 10_000),
    lastSeenAt: new Date(now - 10_000),
    expiresAt: new Date(now + 500_000),
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  });

  it('enforces absolute expiry, idle expiry per kind, and revocation', () => {
    expect(sessionStatus(session({}), ttl, now)).toBe('valid');
    expect(sessionStatus(session({ expiresAt: new Date(now) }), ttl, now)).toBe('expired');
    expect(sessionStatus(session({ lastSeenAt: new Date(now - 100_000) }), ttl, now)).toBe(
      'expired',
    );
    expect(sessionStatus(session({ lastSeenAt: new Date(now - 99_000) }), ttl, now)).toBe('valid');
    expect(
      sessionStatus(session({ kind: 'share', lastSeenAt: new Date(now - 60_000) }), ttl, now),
    ).toBe('expired');
    expect(
      sessionStatus(session({ kind: 'desktop', lastSeenAt: new Date(now - 60_000) }), ttl, now),
    ).toBe('valid');
    expect(sessionStatus(session({ revokedAt: new Date(now - 1) }), ttl, now)).toBe('revoked');
  });
});

describe('presence identities', () => {
  it('generates readable guest names and stable colours', () => {
    for (let i = 0; i < 50; i += 1) expect(guestName()).toMatch(/^Guest [A-Z][a-z]+ [A-Z][a-z]+$/);
    const id = newId();
    expect(colorFor(id)).toBe(colorFor(id));
    expect(PARTICIPANT_COLORS).toContain(colorFor(id));
    expect(colorFor(id)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
