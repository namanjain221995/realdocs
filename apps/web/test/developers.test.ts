import { describe, expect, it, vi } from 'vitest';
import { BUNDLED_DOCUMENTS } from '../src/features/guides/documents';
import { GUIDE_SLUGS, legacyGuideLoader, legacyGuideSlug } from '../src/features/guides/legacy';
import {
  buildQuery,
  fillPath,
  groupByTag,
  parseOperations,
  pathParameterNames,
  specTags,
} from '../src/features/developers/openapi';
import { PORTAL_SECTIONS } from '../src/features/developers/sections';
import { schemaRows, typeLabel, type JsonSchema } from '../src/features/developers/schema';
import { formatResponseBody, prepareRequest, sendRequest } from '../src/features/developers/tryit';

const createSchema: JsonSchema = {
  type: 'object',
  required: ['candidate', 'round', 'permissions'],
  properties: {
    candidate: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120, description: 'Full name.' },
        email: { type: 'string', format: 'email' },
      },
    },
    interviewers: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
    round: { type: 'object', properties: { number: { type: 'integer', minimum: 1, maximum: 99 } } },
    status: { type: 'string', enum: ['scheduled', 'completed'] },
    nickname: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Optional.' },
    metadata: { type: 'object', additionalProperties: { type: 'string' } },
    permissions: {
      type: 'object',
      properties: { candidateCanEdit: { type: 'boolean', default: true } },
    },
    either: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
  },
};

describe('schemaRows', () => {
  const rows = schemaRows(createSchema);
  const by = (path: string) => rows.find((row) => row.path === path);

  it('lists parents before their children with depth', () => {
    const paths = rows.map((row) => row.path);
    expect(paths.indexOf('candidate')).toBeLessThan(paths.indexOf('candidate.name'));
    expect(by('candidate')?.depth).toBe(0);
    expect(by('candidate.name')?.depth).toBe(1);
  });

  it('marks required fields and carries descriptions and constraints', () => {
    expect(by('candidate')?.required).toBe(true);
    expect(by('interviewers')?.required).toBe(false);
    expect(by('candidate.name')?.description).toBe('Full name.');
    expect(by('candidate.name')?.details).toEqual(['min length 1', 'max length 120']);
    expect(by('candidate.email')?.details).toEqual(['format: email']);
    expect(by('round.number')?.details).toEqual(['min 1', 'max 99']);
  });

  it('describes arrays and recurses into array items', () => {
    expect(by('interviewers')?.type).toBe('array of object');
    expect(by('interviewers')?.details).toEqual(['min items 1', 'max items 20']);
    expect(by('interviewers[].name')?.depth).toBe(1);
  });

  it('lists enum values and defaults', () => {
    expect(by('status')?.details).toEqual(['values: scheduled, completed']);
    expect(by('permissions.candidateCanEdit')?.details).toEqual(['default: true']);
  });

  it('shows zod nullable (anyOf with null) as `type | null`', () => {
    expect(by('nickname')?.type).toBe('string | null');
    expect(by('nickname')?.nullable).toBe(true);
    expect(by('nickname')?.description).toBe('Optional.');
  });

  it('lists anyOf variants without expanding them', () => {
    expect(by('either')?.type).toBe('one of: string | integer');
  });

  it('describes maps', () => {
    expect(by('metadata')?.type).toBe('map of string to string');
  });

  it('gives a non-object schema a single row and tolerates garbage', () => {
    expect(schemaRows({ type: 'string', format: 'uuid' })).toMatchObject([
      { name: 'value', type: 'string', details: ['format: uuid'] },
    ]);
    expect(schemaRows(undefined)).toEqual([]);
    expect(schemaRows('nope' as unknown as JsonSchema)).toEqual([]);
  });

  it('unwraps a nullable object and still lists its fields', () => {
    const result = schemaRows({
      type: 'object',
      properties: {
        round: {
          anyOf: [{ type: 'object', properties: { name: { type: 'string' } } }, { type: 'null' }],
        },
      },
    });
    expect(result.map((row) => row.path)).toEqual(['round', 'round.name']);
    expect(result[0]?.type).toBe('object | null');
  });

  it('typeLabel names const and nested arrays', () => {
    expect(typeLabel({ const: 'scheduled' })).toBe('"scheduled"');
    expect(typeLabel({ type: 'array', items: { type: 'array', items: { type: 'string' } } })).toBe(
      'array of array of string',
    );
  });
});

const spec = {
  openapi: '3.1.0',
  tags: [{ name: 'Webhooks' }, { name: 'Interview sessions' }],
  paths: {
    '/api/v1/interview-sessions': {
      post: {
        operationId: 'create',
        tags: ['Interview sessions'],
        summary: 'Create',
        'x-required-scope': 'sessions:create',
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: false, schema: {} }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object' }, example: { a: 1 } } },
        },
        responses: {
          '201': {
            description: 'ok',
            content: { 'application/json': { schema: { type: 'object' }, example: { b: 2 } } },
          },
          '400': { description: 'bad' },
        },
      },
      get: {
        operationId: 'list',
        tags: ['Interview sessions'],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: {},
      },
    },
    '/api/v1/webhooks/{id}': {
      delete: {
        operationId: 'del',
        tags: ['Webhooks'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'gone' } },
      },
      junk: 5,
    },
  },
};

describe('openapi helpers', () => {
  const operations = parseOperations(spec);

  it('parses operations with scope, parameters, body and responses', () => {
    expect(operations.map((o) => o.id)).toEqual(['list', 'create', 'del']);
    const create = operations[1]!;
    expect(create.method).toBe('post');
    expect(create.scope).toBe('sessions:create');
    expect(create.body?.example).toEqual({ a: 1 });
    expect(create.responses.map((r) => r.status)).toEqual(['201', '400']);
    expect(create.responses[0]?.example).toEqual({ b: 2 });
    expect(operations[2]?.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true });
  });

  it('survives a hostile or empty document', () => {
    expect(parseOperations(null)).toEqual([]);
    expect(parseOperations({ paths: 3 })).toEqual([]);
    expect(parseOperations({ paths: { '/x': { get: 'no' } } })).toEqual([]);
  });

  it('groups by tag in the order the document declares them', () => {
    const groups = groupByTag(operations, specTags(spec));
    expect(groups.map((g) => g.tag)).toEqual(['Webhooks', 'Interview sessions']);
    expect(groups[1]?.operations.map((o) => o.id)).toEqual(['list', 'create']);
  });

  it('groups untagged-in-spec tags in order of first use and drops empty declared tags', () => {
    const groups = groupByTag(operations, ['Nothing here']);
    expect(groups.map((g) => g.tag)).toEqual(['Interview sessions', 'Webhooks']);
  });

  it('substitutes and encodes path parameters, reporting missing ones', () => {
    expect(fillPath('/api/v1/x/{id}', { id: 'a/b c' })).toEqual({
      path: '/api/v1/x/a%2Fb%20c',
      missing: [],
    });
    expect(fillPath('/api/v1/x/{id}/y/{pid}', { id: '1' })).toEqual({
      path: '/api/v1/x/1/y/{pid}',
      missing: ['pid'],
    });
    expect(fillPath('/api/v1/x/{id}', { id: '  ' }).missing).toEqual(['id']);
    expect(pathParameterNames('/a/{id}/b/{x}')).toEqual(['id', 'x']);
  });

  it('builds a query string from the non-blank values only', () => {
    expect(buildQuery({ limit: '10', q: 'a b', cursor: '', x: undefined })).toBe('?limit=10&q=a+b');
    expect(buildQuery({})).toBe('');
  });
});

describe('try it', () => {
  const all = parseOperations(spec);
  const create = all.find((o) => o.id === 'create')!;
  const list = all.find((o) => o.id === 'list')!;
  const del = all.find((o) => o.id === 'del')!;
  const base = {
    apiKey: 'rdk_secret',
    pathValues: {},
    queryValues: {},
    body: '{"a":1}',
    idempotencyKey: '',
  };

  it('requires a key, path values and a valid JSON body', () => {
    expect(prepareRequest(create, { ...base, apiKey: ' ' })).toMatchObject({ ok: false });
    expect(prepareRequest(del, base)).toMatchObject({ ok: false });
    expect(prepareRequest(create, { ...base, body: '{nope' })).toMatchObject({ ok: false });
    expect(prepareRequest(create, { ...base, idempotencyKey: 'has space' })).toMatchObject({
      ok: false,
    });
  });

  it('builds a same-origin request without cookies and never puts the key in the URL', () => {
    const request = prepareRequest(create, { ...base, idempotencyKey: 'k-1' });
    if (!request.ok) throw new Error('expected ok');
    expect(request.url).toBe('/api/v1/interview-sessions');
    expect(request.init.credentials).toBe('omit');
    expect(request.init.method).toBe('POST');
    expect(request.init.headers).toMatchObject({
      Authorization: 'Bearer rdk_secret',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'k-1',
    });
    expect(request.url).not.toContain('rdk_secret');
    expect(JSON.stringify(request.displayHeaders)).not.toContain('rdk_secret');
    const getRequest = prepareRequest(list, { ...base, queryValues: { limit: '5' } });
    if (!getRequest.ok) throw new Error('expected ok');
    expect(getRequest.url).toBe('/api/v1/interview-sessions?limit=5');
    expect(getRequest.init.body).toBeUndefined();
  });

  it('shows only the chosen response headers and pretty prints JSON', async () => {
    const request = prepareRequest(list, base);
    if (!request.ok) throw new Error('expected ok');
    const fetchImpl = vi.fn(
      async () =>
        new Response('{"a":1}', {
          status: 429,
          headers: { 'x-request-id': 'req_12345678', 'retry-after': '7', 'set-cookie-ish': 'no' },
        }),
    ) as unknown as typeof fetch;
    const result = await sendRequest(request, fetchImpl);
    expect(result.status).toBe(429);
    expect(result.headers).toEqual([
      ['x-request-id', 'req_12345678'],
      ['retry-after', '7'],
    ]);
    expect(result.body).toBe('{\n  "a": 1\n}');
    expect(formatResponseBody('plain')).toBe('plain');
    expect(formatResponseBody('')).toBe('');
  });
});

describe('legacy /docs links', () => {
  const request = (path: string) => new Request(`https://x.test${path}`);

  it('recognises every guide slug, however spelled', () => {
    expect(legacyGuideSlug('README')).toBe('readme');
    expect(legacyGuideSlug('Windows-Client.MD')).toBe('windows-client');
    expect(legacyGuideSlug('authentication')).toBeNull();
    expect(legacyGuideSlug(undefined)).toBeNull();
  });

  it('redirects a guide to /guides and leaves portal sections alone', () => {
    const response = legacyGuideLoader({
      params: { section: 'security' },
      request: request('/docs/security'),
    });
    expect(response?.status).toBe(302);
    expect(response?.headers.get('Location')).toBe('/guides/security');
    expect(
      legacyGuideLoader({ params: { section: 'webhooks' }, request: request('/docs/webhooks') }),
    ).toBeNull();
    expect(legacyGuideLoader({ params: {}, request: request('/docs') })).toBeNull();
  });

  it('keeps portal section ids apart from guide slugs', () => {
    for (const section of [...PORTAL_SECTIONS.map((s) => s.id), 'api-reference']) {
      expect(legacyGuideSlug(section)).toBeNull();
    }
    expect([...GUIDE_SLUGS]).toEqual(BUNDLED_DOCUMENTS.map((d) => d.slug));
  });
});
