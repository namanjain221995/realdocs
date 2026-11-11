/**
 * Structured logging (pino). Request bodies are never logged. Header values
 * that can carry credentials and any field whose name suggests a secret are
 * redacted in case a caller passes such an object by mistake.
 */
import pino, { type Logger, type LoggerOptions } from 'pino';

export type { Logger };

const SECRET_KEYS = [
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'password_hash',
  'secret',
  'sessionSecret',
  'token',
  'ticket',
  'code',
  'cookie',
  'authorization',
  'set-cookie',
  'databaseUrl',
  'DATABASE_URL',
  'SESSION_SECRET',
];

export const REDACT_PATHS: string[] = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-rd-csrf"]',
  'res.headers["set-cookie"]',
  'headers.cookie',
  'headers.authorization',
  'headers["set-cookie"]',
  ...SECRET_KEYS.flatMap((key) => {
    const accessor = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `["${key}"]`;
    const dotted = accessor.startsWith('[') ? accessor : `.${accessor}`;
    return [accessor.startsWith('[') ? accessor : key, `*${dotted}`, `*.*${dotted}`];
  }),
];

const SENSITIVE_QUERY_KEY = /secret|token|code|password|ticket|key/i;

/** Path plus query with the values of sensitive-looking parameters masked. */
export function sanitizeUrl(url: string | undefined): string {
  if (!url) return '';
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  const params = new URLSearchParams(url.slice(queryStart + 1));
  const safe: string[] = [];
  for (const [key, value] of params) {
    safe.push(
      `${encodeURIComponent(key)}=${SENSITIVE_QUERY_KEY.test(key) ? '[redacted]' : encodeURIComponent(value)}`,
    );
  }
  return safe.length > 0
    ? `${url.slice(0, queryStart)}?${safe.join('&')}`
    : url.slice(0, queryStart);
}

interface LoggedRequest {
  id?: unknown;
  method?: string;
  url?: string;
  ip?: string;
  socket?: { remoteAddress?: string };
}

interface LoggedReply {
  statusCode?: number;
}

/** Serialises an error without `cause` chains that might embed foreign objects. */
function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { message: String(err) };
  const withCode = err as Error & { code?: unknown; statusCode?: unknown };
  return {
    type: err.name,
    message: err.message,
    // Not named `code`: that key is redacted everywhere (handoff codes).
    ...(typeof withCode.code === 'string' ? { errorCode: withCode.code } : {}),
    ...(typeof withCode.statusCode === 'number' ? { statusCode: withCode.statusCode } : {}),
    stack: err.stack,
    ...(err.cause instanceof Error
      ? { cause: { type: err.cause.name, message: err.cause.message, stack: err.cause.stack } }
      : {}),
  };
}

export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    base: { service: 'realtimedocs-server' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      err: serializeError,
      error: serializeError,
      req(request: LoggedRequest) {
        return {
          id: request.id,
          method: request.method,
          url: sanitizeUrl(request.url),
          ip: request.ip ?? request.socket?.remoteAddress,
        };
      },
      res(reply: LoggedReply) {
        return { statusCode: reply.statusCode };
      },
    },
  };
}

export function createLogger(level: string, destination?: pino.DestinationStream): Logger {
  return destination ? pino(loggerOptions(level), destination) : pino(loggerOptions(level));
}
