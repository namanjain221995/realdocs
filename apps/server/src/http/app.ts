/**
 * Fastify application: security headers, CORS for the desktop renderer,
 * origin and CSRF rules, structured errors, the `/api` routes and the built
 * web application.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { CSRF_HEADER, type ErrorCode } from '@realtimedocs/contracts';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import { z } from 'zod';
import { allowedOrigins } from '../config';
import type { AppContext } from '../context';
import { isDbUnavailable } from '../db/pool';
import { AppError, errors } from '../errors';
import { statusClass } from '../metrics';
import { getAuth, verifyCsrf } from './auth';
import { isV1Url, toV1Body, v1RequestId } from '../service/v1-errors';
import { createLimiters, type Limiters } from './rate-limits';
import { registerApiKeyRoutes } from './routes/api-keys';
import { registerAssetRoutes } from './routes/assets';
import { registerAuditRoutes } from './routes/audit';
import { registerDownloadRoutes } from './routes/download';
import { registerAuthRoutes } from './routes/auth';
import { registerCollabRoutes } from './routes/collab';
import { registerDesktopRoutes } from './routes/desktop';
import { registerDocumentRoutes } from './routes/documents';
import { registerExportRoutes } from './routes/export';
import { registerInvitationRoutes } from './routes/invitations';
import { registerMemberRoutes } from './routes/members';
import { registerMetaRoutes } from './routes/meta';
import { registerReleaseRoutes } from './routes/releases';
import { registerShareRoutes } from './routes/shares';
import { registerHistoryRoutes } from './routes/history';
import { registerVersionHistoryRoutes } from './routes/version-history';
import { registerSnapshotRoutes } from './routes/snapshots';
import { registerUserRoutes } from './routes/users';
import { registerV1Routes } from './routes/v1';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * Public endpoints the desktop main process calls without an `Origin`
     * header (it is not a browser). Only honoured when the request carries no
     * cookies at all.
     */
    originOptional?: boolean;
  }
}

export interface RouteDeps {
  ctx: AppContext;
  limits: Limiters;
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isApiPath(url: string): boolean {
  return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');
}

function contentSecurityPolicy(ctx: AppContext): Record<string, string[]> {
  // 'self' covers same-origin WebSockets in current browsers; the explicit
  // ws(s):// sources keep older engines working without opening it to any host.
  const sockets = ctx.config.webOrigins.map((origin) => origin.replace(/^http/, 'ws'));
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...sockets],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };
  if (ctx.config.publicOrigin.startsWith('https://')) directives['upgrade-insecure-requests'] = [];
  return directives;
}

function statusToCode(status: number): ErrorCode {
  if (status === 400) return 'validation_failed';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 406 || status === 415) return 'unsupported_media_type';
  if (status === 409) return 'conflict';
  if (status === 413) return 'payload_too_large';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'server_busy';
  return 'internal';
}

const CLIENT_MESSAGES: Partial<Record<ErrorCode, string>> = {
  validation_failed: 'The request could not be understood.',
  not_found: 'Not found, or you do not have access.',
  unsupported_media_type: 'This content type is not supported here.',
  payload_too_large: 'The request is too large.',
};

/** Converts anything thrown inside a request into a contract error. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) {
    return errors.validation(
      'Some fields are not valid.',
      error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  if (isDbUnavailable(error)) return errors.storageUnavailable(error);
  const status = (error as FastifyError | undefined)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const code = statusToCode(status);
    // Framework messages can echo request details; use our own wording.
    return new AppError(code, CLIENT_MESSAGES[code] ?? 'The request was rejected.', {
      cause: error,
    });
  }
  return errors.internal(error);
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({
    loggerInstance: ctx.logger as FastifyBaseLogger,
    // A number means "this many proxy hops in front of the server are trusted".
    trustProxy:
      typeof config.trustProxy === 'number'
        ? (_address: string, hop: number) => hop < (config.trustProxy as number)
        : config.trustProxy,
    bodyLimit: config.limits.maxJsonBodyBytes,
    // Inbound request ids are not trusted; every request gets a fresh one. The service API
    // (`/api/v1`) alone accepts a well-formed `X-Request-Id` so integrators can correlate.
    requestIdHeader: false,
    genReqId: (request) => (isV1Url(request.url) ? v1RequestId(request) : randomUUID()),
    // Collaboration sockets are handled on the raw server, outside Fastify.
    forceCloseConnections: true,
  });
  const origins = allowedOrigins(config);

  app.decorateRequest('rdRateKey', '');

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: { useDefaults: false, directives: contentSecurityPolicy(ctx) },
    referrerPolicy: { policy: 'no-referrer' },
    // HSTS only makes sense (and is only honoured) when the public origin is HTTPS.
    hsts: config.publicOrigin.startsWith('https://')
      ? { maxAge: 15_552_000, includeSubDomains: false }
      : false,
    frameguard: { action: 'deny' },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
  });

  // The packaged desktop renderer (app://realtimedocs) is the only
  // cross-origin caller. It never uses cookies; its bearer token is injected
  // by the Electron main process.
  await app.register(fastifyCors, {
    origin: config.desktopOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', CSRF_HEADER, 'accept'],
    exposedHeaders: ['x-request-id', 'retry-after'],
    maxAge: 600,
  });

  await app.register(fastifyCookie);
  // One instance: counters in memory. Several instances: counters in Redis, so a
  // limit is the same whichever instance a request reaches.
  await app.register(fastifyRateLimit, {
    global: false,
    ...(ctx.cluster ? { redis: ctx.cluster.redis, nameSpace: 'rd:rl:' } : {}),
  });
  await app.register(fastifyMultipart, {
    throwFileSizeLimit: false,
    limits: { files: 1, fields: 4, parts: 6, headerPairs: 64, fieldSize: 1024 },
  });
  const limits = createLimiters(app, config.rateLimits);

  // A visitor who reached a TLS-terminating proxy over plain HTTP: the proxy
  // says so in X-Forwarded-Proto. Without this, the page would load in clear
  // text and then break, because the policy upgrades every sub-request to
  // HTTPS. Pages are redirected to the public HTTPS origin and API calls are
  // refused, so nothing is answered in clear text. Requests without the header
  // (the container health check, a direct loopback call) are left alone, and
  // the header is only believed from a trusted proxy (`request.protocol`).
  if (config.publicOrigin.startsWith('https://') && config.trustProxy !== false) {
    app.addHook('onRequest', async (request, reply) => {
      if (request.headers['x-forwarded-proto'] === undefined) return;
      if (request.protocol !== 'http') return;
      if (isApiPath(request.url) || (request.method !== 'GET' && request.method !== 'HEAD')) {
        throw errors.forbidden(`This server only answers over HTTPS. Use ${config.publicOrigin}.`);
      }
      // The target is always this deployment's own origin, whatever the request line says.
      const target = request.url.startsWith('/') ? request.url : '/';
      return reply.redirect(`${config.publicOrigin}${target}`, 308);
    });
  }

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    if (!isApiPath(request.url)) return;
    reply.header('cache-control', 'no-store');
    await limits.api.consume(request, request.ip);

    if (!UNSAFE_METHODS.has(request.method)) return;
    // Origin rule for every state-changing request.
    const origin = request.headers.origin;
    if (typeof origin === 'string') {
      if (!origins.has(origin)) throw errors.badOrigin();
      return;
    }
    if (typeof request.headers.authorization === 'string') return;
    const optional = request.routeOptions.config?.originOptional === true;
    if (!optional || request.headers.cookie !== undefined) throw errors.badOrigin();
  });

  app.addHook('preHandler', async (request) => {
    if (!isApiPath(request.url) || !UNSAFE_METHODS.has(request.method)) return;
    await verifyCsrf(ctx, request);
  });

  app.setErrorHandler(async (error, request, reply) => {
    const appError = toAppError(error);
    if (appError.status >= 500) {
      request.log.error({ err: error, errorCode: appError.code }, 'request failed');
    } else {
      request.log.info({ errorCode: appError.code, reason: appError.reason }, 'request rejected');
    }
    if (appError.retryAfterSeconds !== undefined) {
      reply.header('retry-after', String(appError.retryAfterSeconds));
    }
    // A failed session must not keep being presented by the browser.
    if (appError.code === 'session_expired') {
      const auth = await getAuth(ctx, request).catch(() => null);
      if (auth?.account && !auth.user) reply.clearCookie('rd_session', { path: '/' });
    }
    return reply
      .code(appError.status)
      .type('application/json; charset=utf-8')
      .send(isV1Url(request.url) ? toV1Body(appError, request.id) : appError.toBody(request.id));
  });

  const deps: RouteDeps = { ctx, limits };
  // Request counts and durations by route pattern (never by concrete URL: ids
  // would make an unbounded number of series and would name documents).
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? 'unmatched';
    const labels = {
      method: request.method,
      route: isApiPath(route) || route === '/metrics' ? route : 'static',
      status: statusClass(reply.statusCode),
    };
    ctx.metrics.httpRequests.inc(labels);
    ctx.metrics.httpDuration.observe(reply.elapsedTime / 1000, {
      method: labels.method,
      route: labels.route,
    });
  });

  // Prometheus scrape endpoint. Off unless METRICS_TOKEN is set; then it needs
  // that token. It is not under /api: no cookie, no session, no rate limit.
  const redisLatency = ctx.metrics.settable(
    'rd_redis_ping_seconds',
    'Round trip of a Redis PING at scrape time (0 without Redis).',
  );
  const redisUp = ctx.metrics.settable(
    'rd_redis_up',
    '1 when Redis answered the last scrape-time PING, 0 when not, 1 without Redis.',
  );
  redisUp.set(1);
  app.get('/metrics', async (request, reply) => {
    const expected = config.metricsToken;
    const given = request.headers.authorization ?? '';
    // Digests have one length whatever was sent, so the comparison can neither
    // throw nor tell how long the token is.
    const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
    if (!expected || !timingSafeEqual(digest(given), digest(`Bearer ${expected}`))) {
      throw errors.notFound();
    }
    if (ctx.cluster) {
      const ping = await ctx.cluster.ping(1_000);
      redisLatency.set(ping.latencyMs / 1000);
      redisUp.set(ping.ok ? 1 : 0);
      if (!ping.ok) ctx.metrics.redisErrors.inc();
    }
    return reply
      .header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(ctx.metrics.render());
  });

  registerMetaRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerUserRoutes(app, deps);
  registerInvitationRoutes(app, deps);
  registerDocumentRoutes(app, deps);
  registerMemberRoutes(app, deps);
  registerShareRoutes(app, deps);
  registerCollabRoutes(app, deps);
  registerAssetRoutes(app, deps);
  registerExportRoutes(app, deps);
  registerSnapshotRoutes(app, deps);
  registerHistoryRoutes(app, deps);
  registerVersionHistoryRoutes(app, deps);
  registerDesktopRoutes(app, deps);
  registerAuditRoutes(app, deps);
  registerDownloadRoutes(app, deps);
  registerApiKeyRoutes(app, deps);
  registerV1Routes(app, deps);
  registerReleaseRoutes(app, deps);

  const webDist = config.webDistDir;
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      index: 'index.html',
      wildcard: true,
      dotfiles: 'deny',
      cacheControl: false,
      setHeaders(reply, file) {
        const relative = path.relative(webDist, file);
        // Vite emits content-hashed files under assets/: safe to cache forever.
        reply.header(
          'cache-control',
          relative.startsWith(`assets${path.sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    });
  }

  app.setNotFoundHandler(async (request: FastifyRequest, reply) => {
    const pathname = request.url.split('?')[0] ?? '';
    // Client-side routes: every GET outside /api and /collab gets the app
    // shell. A missing file under /assets/ (content-hashed build output) is a
    // real 404 and never the shell.
    const wantsPage =
      webDist !== null &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      !isApiPath(pathname) &&
      pathname !== '/collab' &&
      !pathname.startsWith('/collab/') &&
      !pathname.startsWith('/assets/');
    if (wantsPage) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    const notFound = errors.notFound('Not found.');
    return reply
      .code(404)
      .type('application/json; charset=utf-8')
      .send(isV1Url(request.url) ? toV1Body(notFound, request.id) : notFound.toBody(request.id));
  });

  return app;
}
