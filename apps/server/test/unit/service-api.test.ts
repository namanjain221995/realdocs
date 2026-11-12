import { randomUUID } from 'node:crypto';
import {
  CreateInterviewSessionRequest,
  SERVICE_SCOPES,
  UpdateInterviewSessionRequest,
  V1ErrorBody,
} from '@realtimedocs/contracts';
import { describe, expect, it } from 'vitest';
import { type z } from 'zod';
import { AppError, errors } from '../../src/errors';
import {
  generateApiKey,
  hasScope,
  ipInCidrs,
  keyMatches,
  looksLikeApiKey,
  parseApiKey,
  parseCidr,
} from '../../src/service/api-key-format';
import { decryptSecret, encryptSecret } from '../../src/service/crypto';
import { canonicalJson, parseIdempotencyKey, requestHash } from '../../src/service/idempotency';
import { buildOpenApi, openApiPath } from '../../src/service/openapi';
import { isClosedStatus, isEditableStatus, nextStatus } from '../../src/service/state-machine';
import {
  TITLE_MAX_LENGTH,
  collisionSuffix,
  formatTitleDate,
  generateTitle,
  sanitizeTitlePart,
  uniqueTitle,
} from '../../src/service/title';
import { toV1Body, v1CodeOf, v1RequestId } from '../../src/service/v1-errors';
import { SERVICE_ROUTES } from '../../src/service/v1-routes';
import {
  isNonPublicAddress,
  signWebhook,
  verifyWebhookSignature,
  webhookUrlProblem,
} from '../../src/service/webhook-security';

describe('interview title', () => {
  const base = {
    candidateName: 'Aarav Sharma',
    companyName: 'Acme Corp',
    roundNumber: 2,
    scheduledAt: new Date('2030-03-14T10:00:00Z'),
    timezone: 'Asia/Kolkata',
  };

  it('uses the format Name_Company_Round_N_YYYY-MM-DD_HH-mm in the given time zone', () => {
    expect(generateTitle(base)).toBe('Aarav_Sharma_Acme_Corp_Round_2_2030-03-14_15-30');
    expect(generateTitle({ ...base, timezone: 'America/Los_Angeles' })).toBe(
      'Aarav_Sharma_Acme_Corp_Round_2_2030-03-14_03-00',
    );
  });

  it('formats midnight as 00, not 24', () => {
    expect(formatTitleDate(new Date('2030-03-14T18:30:00Z'), 'Asia/Kolkata')).toBe(
      '2030-03-15_00-00',
    );
  });

  it('normalises to NFC and keeps Unicode letters and digits', () => {
    const decomposed = 'José Müller';
    expect(sanitizeTitlePart(decomposed)).toBe('José_Müller');
    expect(sanitizeTitlePart('张伟 李')).toBe('张伟_李');
    expect(sanitizeTitlePart('अर्जुन कुमार')).toContain('_');
  });

  it('removes characters that are unsafe in file names and collapses whitespace', () => {
    expect(sanitizeTitlePart('  A/B\\C:D*E?F"G<H>I|J \t\n K  ')).toBe('A_B_C_D_E_F_G_H_I_J_K');
    expect(sanitizeTitlePart('a\u0000b\u0007c')).toBe('a_b_c');
    expect(sanitizeTitlePart('a​b')).toBe('ab');
    expect(sanitizeTitlePart('x___y')).toBe('x_y');
  });

  it('falls back when a part has nothing left', () => {
    expect(generateTitle({ ...base, candidateName: '///' })).toMatch(/^Candidate_Acme_Corp_/);
    expect(generateTitle({ ...base, companyName: '***' })).toMatch(/^Aarav_Sharma_Company_/);
  });

  it('caps the length by shortening the names, never the round or the date', () => {
    const title = generateTitle({
      ...base,
      candidateName: 'N'.repeat(300),
      companyName: 'C'.repeat(300),
    });
    expect(Array.from(title).length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
    expect(title.endsWith('Round_2_2030-03-14_15-30')).toBe(true);
    expect(generateTitle(base, 60).length).toBeLessThanOrEqual(60);
  });

  it('appends a four character base32 suffix when the title is taken', async () => {
    const plain = generateTitle(base);
    const taken = new Set([plain.toLowerCase()]);
    const title = await uniqueTitle(base, (candidate) => taken.has(candidate.toLowerCase()));
    expect(title).toMatch(new RegExp(`^${plain}_[A-Z2-7]{4}$`));
    expect(collisionSuffix()).toMatch(/^[A-Z2-7]{4}$/);
    expect(Array.from(title).length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
  });

  it('keeps a suffixed title within the cap for very long names', async () => {
    const long = { ...base, candidateName: 'N'.repeat(300), companyName: 'C'.repeat(300) };
    const first = generateTitle(long);
    const title = await uniqueTitle(long, (candidate) => candidate === first);
    expect(Array.from(title).length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
  });
});

describe('idempotency hashing', () => {
  it('is independent of key order and whitespace', () => {
    const a = requestHash('POST', '/api/v1/x', { b: 1, a: { d: [1, 2], c: 'x' } });
    const b = requestHash('POST', '/api/v1/x', { a: { c: 'x', d: [1, 2] }, b: 1 });
    expect(a).toBe(b);
  });

  it('differs when the body, method or path differs', () => {
    const a = requestHash('POST', '/api/v1/x', { a: 1 });
    expect(requestHash('POST', '/api/v1/x', { a: 2 })).not.toBe(a);
    expect(requestHash('POST', '/api/v1/y', { a: 1 })).not.toBe(a);
    expect(requestHash('PATCH', '/api/v1/x', { a: 1 })).not.toBe(a);
  });

  it('canonicalises arrays in order and ignores undefined members', () => {
    expect(canonicalJson({ a: [2, 1], b: undefined })).toBe('{"a":[2,1]}');
  });

  it('accepts 1 to 128 visible ASCII characters only', () => {
    expect(parseIdempotencyKey(undefined)).toBeNull();
    expect(parseIdempotencyKey('abc-123_X')).toBe('abc-123_X');
    expect(parseIdempotencyKey('k'.repeat(128))).toHaveLength(128);
    for (const bad of ['', 'k'.repeat(129), 'has space', 'tab\t', 'café', 'a\u0000']) {
      expect(() => parseIdempotencyKey(bad)).toThrow(AppError);
    }
    expect(() => parseIdempotencyKey(['a', 'b'] as unknown as string)).toThrow(AppError);
  });
});

describe('API keys', () => {
  it('generates rdk_<8>_<43> keys and parses them back', () => {
    const generated = generateApiKey();
    expect(generated.key).toMatch(/^rdk_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(generated.prefix).toBe(generated.key.slice(0, 12));
    const parsed = parseApiKey(generated.key);
    expect(parsed?.prefix).toBe(generated.prefix);
    expect(keyMatches(generated.hash, parsed?.hash ?? Buffer.alloc(0))).toBe(true);
    expect(generateApiKey().key).not.toBe(generated.key);
  });

  it('rejects malformed keys', () => {
    for (const bad of [
      '',
      'rdk_',
      'rdk_abcdefgh',
      'rdk_abcdefgh_short',
      `xdk_abcdefgh_${'a'.repeat(43)}`,
      `rdk_abcdefg!_${'a'.repeat(43)}`,
      `rdk_abcdefgh_${'a'.repeat(44)}`,
    ]) {
      expect(parseApiKey(bad)).toBeNull();
    }
    expect(looksLikeApiKey('rdk_anything')).toBe(true);
    expect(looksLikeApiKey('abc')).toBe(false);
  });

  it('compares hashes and rejects a different key', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(keyMatches(a.hash, parseApiKey(b.key)?.hash ?? Buffer.alloc(0))).toBe(false);
    expect(keyMatches(null, a.hash)).toBe(false);
  });

  it('checks scopes exactly', () => {
    expect(hasScope(['sessions:read'], 'sessions:read')).toBe(true);
    expect(hasScope(['sessions:read'], 'sessions:update')).toBe(false);
    expect(hasScope([], 'sessions:create')).toBe(false);
    expect(SERVICE_SCOPES).toHaveLength(7);
  });

  it('matches IPv4 and IPv6 CIDR blocks', () => {
    expect(ipInCidrs('203.0.113.7', ['203.0.113.0/24'])).toBe(true);
    expect(ipInCidrs('203.0.114.7', ['203.0.113.0/24'])).toBe(false);
    expect(ipInCidrs('10.1.2.3', ['10.0.0.0/8', '192.168.0.0/16'])).toBe(true);
    expect(ipInCidrs('203.0.113.7', ['203.0.113.7'])).toBe(true);
    expect(ipInCidrs('::ffff:203.0.113.7', ['203.0.113.0/24'])).toBe(true);
    expect(ipInCidrs('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(ipInCidrs('2001:db9::1', ['2001:db8::/32'])).toBe(false);
    expect(ipInCidrs('127.0.0.1', ['2001:db8::/32'])).toBe(false);
    expect(ipInCidrs('not-an-ip', ['0.0.0.0/0'])).toBe(false);
    expect(ipInCidrs('1.2.3.4', ['garbage'])).toBe(false);
    expect(ipInCidrs('1.2.3.4', ['0.0.0.0/0'])).toBe(true);
  });

  it('parses CIDR notation strictly', () => {
    expect(parseCidr('10.0.0.0/8')).not.toBeNull();
    expect(parseCidr('10.0.0.0/33')).toBeNull();
    expect(parseCidr('10.0.0.0/8/1')).toBeNull();
    expect(parseCidr('::1/129')).toBeNull();
    expect(parseCidr('')).toBeNull();
  });
});

describe('encryption at rest', () => {
  const secret = 'x'.repeat(40);

  it('round-trips and uses a fresh nonce each time', () => {
    const a = encryptSecret(secret, 'webhook-secret', 'whsec_value');
    const b = encryptSecret(secret, 'webhook-secret', 'whsec_value');
    expect(a).not.toBe(b);
    expect(a).not.toContain('whsec_value');
    expect(decryptSecret(secret, 'webhook-secret', a)).toBe('whsec_value');
  });

  it('refuses another purpose, another key and tampering', () => {
    const encrypted = encryptSecret(secret, 'webhook-secret', 'v');
    expect(() => decryptSecret(secret, 'idempotent-response', encrypted)).toThrow();
    expect(() => decryptSecret('y'.repeat(40), 'webhook-secret', encrypted)).toThrow();
    expect(() => decryptSecret(secret, 'webhook-secret', `${encrypted}A`)).toThrow();
    expect(() => decryptSecret(secret, 'webhook-secret', 'garbage')).toThrow();
  });
});

describe('session state machine', () => {
  it('allows only the documented transitions', () => {
    expect(nextStatus('scheduled', 'start')).toBe('in_progress');
    expect(nextStatus('in_progress', 'complete')).toBe('completed');
    expect(nextStatus('scheduled', 'cancel')).toBe('cancelled');
    expect(nextStatus('in_progress', 'cancel')).toBe('cancelled');
    for (const from of ['scheduled', 'in_progress', 'completed', 'cancelled'] as const) {
      expect(nextStatus(from, 'archive')).toBe('archived');
    }
  });

  it('refuses everything else', () => {
    expect(nextStatus('scheduled', 'complete')).toBeNull();
    expect(nextStatus('in_progress', 'start')).toBeNull();
    expect(nextStatus('completed', 'start')).toBeNull();
    expect(nextStatus('completed', 'cancel')).toBeNull();
    expect(nextStatus('cancelled', 'complete')).toBeNull();
    expect(nextStatus('archived', 'archive')).toBeNull();
    expect(nextStatus('archived', 'start')).toBeNull();
  });

  it('classifies statuses', () => {
    expect(isEditableStatus('scheduled')).toBe(true);
    expect(isEditableStatus('completed')).toBe(false);
    expect(isClosedStatus('completed')).toBe(true);
    expect(isClosedStatus('in_progress')).toBe(false);
  });
});

describe('webhook signing and target checks', () => {
  it('signs "<timestamp>.<body>" with HMAC-SHA256 as v1=<hex>', () => {
    const signature = signWebhook('secret', 1700000000, '{"a":1}');
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(signature).toBe(signWebhook('secret', '1700000000', '{"a":1}'));
    expect(signWebhook('secret', 1700000001, '{"a":1}')).not.toBe(signature);
    expect(signWebhook('other', 1700000000, '{"a":1}')).not.toBe(signature);
  });

  it('verifies a signature within the tolerance only', () => {
    const now = 1_700_000_100_000;
    const signature = signWebhook('s', 1700000000, 'body');
    expect(verifyWebhookSignature('s', '1700000000', 'body', signature, 300, now)).toBe(true);
    expect(verifyWebhookSignature('s', '1700000000', 'body!', signature, 300, now)).toBe(false);
    expect(verifyWebhookSignature('s', '1700000000', 'body', signature, 30, now)).toBe(false);
    expect(verifyWebhookSignature('s', 'abc', 'body', signature, 300, now)).toBe(false);
  });

  it('classifies non-public addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.1.1',
      '172.16.5.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:10.0.0.1',
      '224.0.0.1',
    ]) {
      expect(isNonPublicAddress(address), address).toBe(true);
    }
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isNonPublicAddress(address), address).toBe(false);
    }
  });

  it('accepts https only in production and loopback http elsewhere', () => {
    expect(webhookUrlProblem('https://hooks.example.com/x', true)).toBeNull();
    expect(webhookUrlProblem('http://hooks.example.com/x', true)).not.toBeNull();
    expect(webhookUrlProblem('https://127.0.0.1/x', true)).not.toBeNull();
    expect(webhookUrlProblem('https://169.254.169.254/latest', true)).not.toBeNull();
    expect(webhookUrlProblem('https://localhost/x', true)).not.toBeNull();
    expect(webhookUrlProblem('http://127.0.0.1:9000/x', false)).toBeNull();
    expect(webhookUrlProblem('http://localhost:9000/x', false)).toBeNull();
    expect(webhookUrlProblem('http://example.com/x', false)).not.toBeNull();
    expect(webhookUrlProblem('ftp://example.com/x', false)).not.toBeNull();
    expect(webhookUrlProblem('https://user:pw@example.com/', false)).not.toBeNull();
    expect(webhookUrlProblem('not a url', false)).not.toBeNull();
  });
});

describe('v1 error envelope', () => {
  it('maps codes and keeps the request id and details', () => {
    const body = toV1Body(
      errors.validation('Some fields are not valid.', [
        { path: 'candidate.email', message: 'bad' },
      ]),
      'req_abc',
    );
    expect(V1ErrorBody.safeParse(body).success).toBe(true);
    expect(body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      requestId: 'req_abc',
      details: [{ path: 'candidate.email', message: 'bad' }],
    });
    expect(v1CodeOf(errors.unauthenticated())).toBe('UNAUTHENTICATED');
    expect(v1CodeOf(errors.rateLimited(3))).toBe('RATE_LIMITED');
    expect(v1CodeOf(errors.notFound())).toBe('NOT_FOUND');
    expect(v1CodeOf(errors.conflict('x'))).toBe('CONFLICT');
    expect(v1CodeOf(errors.internal())).toBe('INTERNAL');
    expect(v1CodeOf(new AppError('idempotency_conflict', 'x'))).toBe('IDEMPOTENCY_CONFLICT');
    expect(v1CodeOf(errors.sessionClosed())).toBe('SESSION_CLOSED');
  });

  it('accepts only well-formed inbound request ids', () => {
    const request = (value?: string) =>
      ({ headers: value === undefined ? {} : { 'x-request-id': value } }) as never;
    expect(v1RequestId(request('abc_DEF-12345'))).toBe('abc_DEF-12345');
    expect(v1RequestId(request())).toMatch(/^req_[0-9a-f]{24}$/);
    for (const bad of [
      'short',
      'has space here',
      'x'.repeat(65),
      'a<script>b1234',
      'new\nline1234',
    ]) {
      expect(v1RequestId(request(bad))).toMatch(/^req_[0-9a-f]{24}$/);
    }
  });
});

describe('create-session request schema', () => {
  const valid = () => ({
    candidate: { name: 'A', email: 'a@example.com' },
    interviewers: [{ name: 'B', email: 'b@example.com' }],
    companyName: 'Acme',
    round: { number: 1 },
    scheduledAt: '2030-01-01T10:00:00+05:30',
    timezone: 'Asia/Kolkata',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });

  it('applies the documented permission defaults', () => {
    const parsed = CreateInterviewSessionRequest.parse(valid());
    expect(parsed.permissions).toEqual({
      candidateCanEdit: true,
      interviewerCanEdit: true,
      candidateCanExport: false,
      candidateCanShare: false,
      candidateCanViewHistory: false,
    });
  });

  it('rejects bad time zones, past or too distant expiry, and bad lists', () => {
    const fails = (patch: Record<string, unknown>) =>
      CreateInterviewSessionRequest.safeParse({ ...valid(), ...patch }).success === false;
    expect(fails({ timezone: 'Mars/Olympus' })).toBe(true);
    expect(fails({ expiresAt: new Date(Date.now() - 1000).toISOString() })).toBe(true);
    expect(fails({ expiresAt: new Date(Date.now() + 91 * 86_400_000).toISOString() })).toBe(true);
    expect(fails({ scheduledAt: '2030-01-01T10:00:00' })).toBe(true);
    expect(fails({ interviewers: [] })).toBe(true);
    expect(
      fails({
        interviewers: Array.from({ length: 21 }, () => ({ name: 'x', email: 'x@example.com' })),
      }),
    ).toBe(true);
    expect(fails({ round: { number: 0 } })).toBe(true);
    expect(fails({ candidate: { name: 'A', email: 'nope' } })).toBe(true);
    expect(
      fails({ metadata: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v'])) }),
    ).toBe(true);
    expect(fails({ metadata: { k: 'v'.repeat(257) } })).toBe(true);
    expect(fails({})).toBe(false);
    expect(UpdateInterviewSessionRequest.safeParse({}).success).toBe(false);
  });
});

describe('OpenAPI document', () => {
  const spec = buildOpenApi(SERVICE_ROUTES, 'https://docs.example.com') as {
    openapi: string;
    paths: Record<string, Record<string, { operationId: string; 'x-required-scope': string }>>;
  };

  it('is OpenAPI 3.1 and lists every registered route exactly once', () => {
    expect(spec.openapi).toBe('3.1.0');
    const operations = Object.values(spec.paths).flatMap((methods) => Object.values(methods));
    expect(operations).toHaveLength(SERVICE_ROUTES.length);
    for (const route of SERVICE_ROUTES) {
      const operation = spec.paths[openApiPath(route.path)]?.[route.method];
      expect(operation?.operationId, `${route.method} ${route.path}`).toBe(route.id);
      expect(operation?.['x-required-scope']).toBe(route.scope);
    }
    expect(new Set(SERVICE_ROUTES.map((route) => route.id)).size).toBe(SERVICE_ROUTES.length);
  });

  it('uses {param} path syntax', () => {
    expect(openApiPath('/interview-sessions/:id/participants/:participantId')).toBe(
      '/api/v1/interview-sessions/{id}/participants/{participantId}',
    );
  });

  it('only uses declared scopes', () => {
    for (const route of SERVICE_ROUTES) expect(SERVICE_SCOPES).toContain(route.scope);
  });

  it('example requests validate against the runtime request schema', () => {
    for (const route of SERVICE_ROUTES) {
      const example = route.example?.();
      if (example?.request === undefined) continue;
      expect(route.body, `${route.id} has an example request but no body schema`).toBeDefined();
      const result = (route.body as z.ZodType).safeParse(example.request);
      expect(result.success, `${route.id}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('example responses validate against the response schema', () => {
    for (const route of SERVICE_ROUTES) {
      const example = route.example?.();
      if (!route.response) continue;
      expect(example?.response, `${route.id} has no response example`).toBeDefined();
      const result = route.response.safeParse(example?.response);
      expect(result.success, `${route.id}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('includes error responses and the request body for create', () => {
    const create = spec.paths['/api/v1/interview-sessions']?.post as unknown as {
      requestBody: { content: { 'application/json': { example: unknown } } };
      responses: Record<string, unknown>;
    };
    expect(create.requestBody.content['application/json'].example).toBeDefined();
    for (const status of ['201', '400', '401', '403', '404', '409', '429', '500']) {
      expect(create.responses[status], status).toBeDefined();
    }
  });

  it('has unique route ids even for generated routes', () => {
    expect(SERVICE_ROUTES.some((route) => route.id === 'startInterviewSession')).toBe(true);
    expect(randomUUID()).toBeTruthy();
  });
});

describe('findings of the security review', () => {
  it('treats IPv4-mapped IPv6 addresses in every spelling as the IPv4 address they are', () => {
    // How the URL parser writes https://[::ffff:127.0.0.1]/ and the metadata address.
    expect(new URL('https://[::ffff:127.0.0.1]/').hostname).toBe('[::ffff:7f00:1]');
    for (const address of [
      '::ffff:7f00:1',
      '[::ffff:7f00:1]',
      '::ffff:a9fe:a9fe',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.5',
      '::ffff:c0a8:101',
      '2002:7f00:1::1',
    ]) {
      expect(isNonPublicAddress(address), address).toBe(true);
    }
    // A mapped public address is still public.
    expect(isNonPublicAddress('::ffff:0808:0808')).toBe(false);
    expect(isNonPublicAddress('8.8.8.8')).toBe(false);
  });

  it('removes every invisible format character from a generated title', () => {
    const spoofed = 'Ali⁦ce⁩ ؜B­ob᠎‮';
    expect(sanitizeTitlePart(spoofed)).toBe('Alice_Bob');
  });
});
