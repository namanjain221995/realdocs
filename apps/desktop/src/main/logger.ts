/**
 * Minimal structured logger for the main process (one JSON line per event on
 * stderr). Callers pass event names and small fields, never links, tokens,
 * share secrets, handoff codes or document content. As a second line of
 * defence, values under sensitive-looking keys and anything that looks like a
 * 43-character capability secret are redacted before printing.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const SENSITIVE_KEY = /token|secret|code|authorization|password|cookie|link|url/i;
const SECRET_SHAPED = /[A-Za-z0-9_-]{43,}/g;

export function redactFields(
  fields: LogFields = {},
): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SENSITIVE_KEY.test(key)) {
      output[key] = '[redacted]';
    } else if (typeof value === 'string') {
      output[key] = value.replace(SECRET_SHAPED, '[redacted]').slice(0, 300);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export function createLogger(
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  minimum: LogLevel = 'info',
): Logger {
  const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const threshold = order.indexOf(minimum);
  const emit = (level: LogLevel, event: string, fields?: LogFields) => {
    if (order.indexOf(level) < threshold) return;
    try {
      write(JSON.stringify({ t: new Date().toISOString(), level, event, ...redactFields(fields) }));
    } catch {
      // Logging must never break the app.
    }
  };
  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
