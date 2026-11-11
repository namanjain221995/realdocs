import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { Writable } from 'node:stream';
import { ApiErrorBody, HTTP_STATUS_BY_CODE } from '@realtimedocs/contracts';
import { collectAssetIds } from '@realtimedocs/editor/export';
import {
  EMPTY_DOCUMENT,
  buildSampleDocument,
  getDocumentSchema,
  type DocJSON,
} from '@realtimedocs/editor/schema';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { z } from 'zod';
import type { AssetRow } from '../../src/db/rows';
import { isDbUnavailable } from '../../src/db/pool';
import {
  encodeInitialState,
  mergeToState,
  reencodeFresh,
  stateToJson,
} from '../../src/documents/ydoc';
import { errors, type AppError } from '../../src/errors';
import { toAppError } from '../../src/http/app';
import { rewriteAssetIds } from '../../src/http/routes/documents';
import { assignAssetFileNames } from '../../src/http/routes/export';
import { createLogger, sanitizeUrl } from '../../src/logger';
import { TokenBucket, TrailingThrottle, WindowLimiter, mapLimit } from '../../src/util/limits';
import { clientIp } from '../../src/util/net';
import { SERVER_VERSION } from '../../src/version';

const ASSET_A = '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d';
const ASSET_B = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('logging', () => {
  function capture(): { lines: () => Record<string, unknown>[]; stream: Writable } {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString('utf8'));
        callback();
      },
    });
    return {
      stream,
      lines: () =>
        chunks
          .join('')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>),
    };
  }

  it('redacts credentials wherever they appear', () => {
    const { stream, lines } = capture();
    const logger = createLogger('info', stream);
    logger.info(
      {
        password: 'hunter2-hunter2',
        token: 'tok_live_123',
        nested: { secret: 'share-secret', ticket: 'one-time', code: 'handoff-code', ok: 'visible' },
        deep: { deeper: { newPassword: 'another-secret' } },
        headers: { cookie: 'rd_session=abc', authorization: 'Bearer xyz', 'set-cookie': 'a=b' },
        req: {
          method: 'POST',
          url: '/api/share/exchange?secret=leaked&format=md',
          headers: { cookie: 'rd_session=abc', authorization: 'Bearer xyz' },
        },
      },
      'test line',
    );
    const text = JSON.stringify(lines());
    for (const leaked of [
      'hunter2-hunter2',
      'tok_live_123',
      'share-secret',
      'one-time',
      'handoff-code',
      'another-secret',
      'rd_session=abc',
      'Bearer xyz',
      'leaked',
    ]) {
      expect(text, leaked).not.toContain(leaked);
    }
    expect(text).toContain('visible');
    expect(text).toContain('format=md');
    expect(text).toContain('[redacted]');
  });

  it('serialises errors without request data', () => {
    const { stream, lines } = capture();
    const logger = createLogger('info', stream);
    logger.error({ err: Object.assign(new Error('boom'), { code: 'E_TEST' }) }, 'failed');
    const [line] = lines();
    expect(line?.err).toMatchObject({ type: 'Error', message: 'boom', errorCode: 'E_TEST' });
  });

  it('masks sensitive query parameters in URLs', () => {
    expect(sanitizeUrl('/api/documents/x/export?format=md')).toBe(
      '/api/documents/x/export?format=md',
    );
    expect(sanitizeUrl('/s/abc?secret=s3&token=t&code=c&q=hello')).toBe(
      '/s/abc?secret=[redacted]&token=[redacted]&code=[redacted]&q=hello',
    );
    expect(sanitizeUrl(undefined)).toBe('');
  });
});

describe('errors', () => {
  it('maps every helper to a contract code and status', () => {
    const cases: AppError[] = [
      errors.validation('x'),
      errors.unauthenticated(),
      errors.sessionExpired(),
      errors.forbidden(),
      errors.csrf(),
      errors.badOrigin(),
      errors.notFound(),
      errors.conflict('x'),
      errors.rateLimited(12.2),
      errors.payloadTooLarge('x', 'too_large'),
      errors.unsupportedMediaType('x'),
      errors.uploadRejected('active_content', 'x'),
      errors.quotaExceeded('x'),
      errors.shareInvalid(),
      errors.shareExpired(),
      errors.shareRevoked(),
      errors.inviteInvalid(),
      errors.inviteExpired(),
      errors.handoffInvalid(),
      errors.documentTrashed(),
      errors.generationMismatch(),
      errors.updateRequired(),
      errors.serverBusy(),
      errors.storageUnavailable(),
      errors.internal(),
    ];
    for (const error of cases) {
      expect(error.status).toBe(HTTP_STATUS_BY_CODE[error.code]);
      expect(ApiErrorBody.safeParse(error.toBody('req-1')).success).toBe(true);
    }
    expect(errors.rateLimited(12.2).toBody().error.retryAfterSeconds).toBe(13);
    expect(errors.uploadRejected('bad_filename', 'x').toBody().error.reason).toBe('bad_filename');
  });

  it('converts unknown failures without leaking their details', () => {
    const internal = toAppError(new Error('relation "users" does not exist at character 15'));
    expect(internal.code).toBe('internal');
    expect(internal.message).not.toContain('users');

    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    });
    expect(toAppError(refused).code).toBe('storage_unavailable');
    expect(toAppError(new AggregateError([refused], 'all attempts failed')).code).toBe(
      'storage_unavailable',
    );
    expect(
      isDbUnavailable(Object.assign(new Error('canceling statement'), { code: '57014' })),
    ).toBe(true);
    expect(isDbUnavailable(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(
      false,
    );

    const tooLarge = Object.assign(new Error('Request body is too large'), { statusCode: 413 });
    expect(toAppError(tooLarge).code).toBe('payload_too_large');
    const badJson = Object.assign(
      new Error('Unexpected token } in JSON at position 5: {"secret"}'),
      {
        statusCode: 400,
      },
    );
    expect(toAppError(badJson).code).toBe('validation_failed');
    expect(toAppError(badJson).message).not.toContain('secret');

    const parsed = z.object({ title: z.string().min(1) }).safeParse({ title: '' });
    const validation = toAppError(parsed.error);
    expect(validation.code).toBe('validation_failed');
    expect(validation.issues?.[0]?.path).toBe('title');
  });
});

describe('collaboration limiters', () => {
  it('token bucket allows a burst and then the sustained rate', () => {
    let now = 0;
    const bucket = new TokenBucket(5, 10, () => now);
    for (let i = 0; i < 5; i += 1) expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    now += 100; // one token at 10 per second
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    now += 10_000;
    expect(bucket.take(5)).toBe(true);
    expect(bucket.take(1)).toBe(false);
    expect(bucket.take(100)).toBe(false);
  });

  it('window limiter counts per key and resets after the window', () => {
    let now = 0;
    const limiter = new WindowLimiter(3, 1_000, 10, () => now);
    expect([1, 2, 3, 4].map(() => limiter.take('a'))).toEqual([true, true, true, false]);
    expect(limiter.take('b')).toBe(true);
    now += 1_000;
    expect(limiter.take('a')).toBe(true);
    // Never tracks more keys than configured.
    for (let i = 0; i < 100; i += 1) limiter.take(`key-${i}`);
    expect(limiter.take('fresh')).toBe(true);
  });

  it('mapLimit bounds concurrency', async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(value);
      running -= 1;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('TrailingThrottle (used for `hello` proofs)', () => {
  it('runs the first item at once and defers, never drops, an early second one', () => {
    vi.useFakeTimers();
    try {
      const ran: string[] = [];
      let now = 10_000;
      const throttle = new TrailingThrottle<string>(
        (item) => ran.push(item),
        200,
        () => now,
      );

      expect(throttle.offer('first')).toBe(true);
      now += 5;
      expect(throttle.offer('second')).toBe(false);
      expect(throttle.pending).toBe(true);
      expect(ran).toEqual(['first']);

      // Not before the interval has elapsed …
      now += 190;
      vi.advanceTimersByTime(190);
      expect(ran).toEqual(['first']);
      // … and exactly once when it has.
      now += 5;
      vi.advanceTimersByTime(5);
      expect(ran).toEqual(['first', 'second']);
      expect(throttle.pending).toBe(false);
      vi.advanceTimersByTime(1_000);
      expect(ran).toEqual(['first', 'second']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps only the latest waiting item and runs at most once per interval', () => {
    vi.useFakeTimers();
    try {
      const ran: number[] = [];
      let now = 0;
      const throttle = new TrailingThrottle<number>(
        (item) => ran.push(item),
        200,
        () => now,
      );
      // One item per 10 ms for two seconds.
      for (let i = 0; i < 200; i += 1) {
        throttle.offer(i);
        now += 10;
        vi.advanceTimersByTime(10);
      }
      expect(ran.length).toBeGreaterThanOrEqual(10);
      expect(ran.length).toBeLessThanOrEqual(11);
      // Whatever ran was the newest item at that moment: strictly increasing.
      expect(ran).toEqual([...ran].sort((a, b) => a - b));
      // The very last item is not lost either.
      now += 200;
      vi.advanceTimersByTime(200);
      expect(ran.at(-1)).toBe(199);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs immediately again after a quiet interval and forgets on dispose', () => {
    vi.useFakeTimers();
    try {
      const ran: string[] = [];
      let now = 0;
      const throttle = new TrailingThrottle<string>(
        (item) => ran.push(item),
        200,
        () => now,
      );
      expect(throttle.offer('a')).toBe(true);
      now += 200;
      expect(throttle.offer('b')).toBe(true);
      now += 1;
      expect(throttle.offer('c')).toBe(false);
      throttle.dispose();
      now += 1_000;
      vi.advanceTimersByTime(1_000);
      expect(ran).toEqual(['a', 'b']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('clientIp', () => {
  const request = (remoteAddress: string, forwarded?: string) =>
    ({
      socket: { remoteAddress },
      headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
    }) as unknown as IncomingMessage;

  it('ignores forwarding headers unless a proxy is trusted', () => {
    expect(clientIp(request('203.0.113.9', '10.0.0.1'), false)).toBe('203.0.113.9');
    expect(clientIp(request('::ffff:127.0.0.1'), false)).toBe('127.0.0.1');
  });

  it('follows the configured number of trusted hops', () => {
    const chain = request('10.0.0.2', '198.51.100.7, 10.0.0.1');
    expect(clientIp(chain, 1)).toBe('10.0.0.1');
    expect(clientIp(chain, 2)).toBe('198.51.100.7');
    expect(clientIp(chain, 5)).toBe('198.51.100.7');
    expect(clientIp(chain, true)).toBe('198.51.100.7');
    expect(clientIp(request('10.0.0.2'), true)).toBe('10.0.0.2');
  });
});

describe('document state helpers', () => {
  it('creates the initial state from the schema and reads it back', () => {
    const schema = getDocumentSchema();
    const normalise = (json: DocJSON) => schema.nodeFromJSON(json).toJSON() as DocJSON;
    expect(normalise(stateToJson(encodeInitialState()))).toEqual(normalise(EMPTY_DOCUMENT));
    const sample = buildSampleDocument({ imageAssetId: ASSET_A });
    const json = stateToJson(encodeInitialState(sample));
    expect(collectAssetIds(json)).toEqual([ASSET_A]);
    expect(JSON.stringify(json)).toContain('नमस्ते');
  });

  it('rejects content that is not valid under the schema', () => {
    expect(() =>
      encodeInitialState({ type: 'doc', content: [{ type: 'no-such-node' }] } as DocJSON),
    ).toThrow();
  });

  it('folds a compacted state and later updates into one state', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, encodeInitialState());
    const base = Y.encodeStateAsUpdate(doc);
    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array) => updates.push(update));
    doc.getText('scratch').insert(0, 'hello');
    doc.getText('scratch').delete(0, 2);
    const merged = new Y.Doc();
    Y.applyUpdate(merged, mergeToState(base, updates));
    expect(merged.getText('scratch').toString()).toBe('llo');
  });

  it('re-encodes content as a new Yjs history that shares no client ids', () => {
    const original = encodeInitialState(buildSampleDocument({ imageAssetId: ASSET_A }));
    const fresh = reencodeFresh(stateToJson(original), original);
    expect(stateToJson(fresh)).toEqual(stateToJson(original));
    const clientsOf = (state: Uint8Array) => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, state);
      return [...Y.decodeStateVector(Y.encodeStateVector(doc)).keys()];
    };
    const before = clientsOf(original);
    const after = clientsOf(fresh);
    expect(after).toHaveLength(1);
    expect(before).not.toContain(after[0]);
  });
});

describe('duplicating content', () => {
  it('rewrites asset ids without touching the source and clears pending uploads', () => {
    const source = buildSampleDocument({ imageAssetId: ASSET_A });
    source.content?.push({
      type: 'attachment',
      attrs: { assetId: ASSET_B, uploadId: null, name: 'kept.pdf' },
    });
    source.content?.push({
      type: 'image',
      attrs: { assetId: null, uploadId: ASSET_B, alt: 'still uploading' },
    });
    const snapshot = JSON.stringify(source);
    const copy = rewriteAssetIds(
      source,
      new Map([[ASSET_A, '11111111-1111-4111-8111-111111111111']]),
    );

    expect(JSON.stringify(source)).toBe(snapshot);
    // Mapped ids change; ids without a copy stay as they were.
    expect(collectAssetIds(copy)).toEqual(['11111111-1111-4111-8111-111111111111', ASSET_B]);
    expect(JSON.stringify(copy)).not.toContain(ASSET_A);
    const pending = copy.content?.at(-1);
    expect(pending?.attrs).toMatchObject({ assetId: null, uploadId: null });
  });
});

describe('export file names', () => {
  const asset = (id: string, name: string) => ({ id, name }) as unknown as AssetRow;

  it('assigns unique, safe names', () => {
    const names = assignAssetFileNames([
      asset('a', 'chart.png'),
      asset('b', 'chart.png'),
      asset('c', 'Chart.PNG'),
      asset('d', 'notes'),
      asset('e', 'notes'),
      asset('f0000000-rest', '../../'),
    ]);
    expect([...names.values()]).toEqual([
      'chart.png',
      'chart-2.png',
      'Chart-3.PNG',
      'notes',
      'notes-2',
      'file-f0000000',
    ]);
  });
});

describe('version', () => {
  it('matches package.json', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(SERVER_VERSION).toBe(manifest.version);
  });
});
