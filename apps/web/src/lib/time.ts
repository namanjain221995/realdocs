/**
 * Time and size formatting. The interface is English, so relative phrases are
 * written out here (stable across browsers and testable); absolute dates use
 * the browser's own locale conventions.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Beyond this distance a calendar date says more than a count of days. */
const MAX_RELATIVE_DAYS = 30;

export type TimeInput = string | number | Date;

export function toEpochMs(value: TimeInput): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return Date.parse(value);
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/** "12 Oct" in the current year, "12 Oct 2025" otherwise (ordering follows the locale). */
export function formatShortDate(
  value: TimeInput,
  now: number = Date.now(),
  locale?: string,
): string {
  const date = new Date(toEpochMs(value));
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/** Full date and time, for tooltips and `title` attributes. */
export function formatDateTime(value: TimeInput, locale?: string): string {
  const ms = toEpochMs(value);
  if (Number.isNaN(ms)) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(ms),
  );
}

/**
 * "just now", "5 minutes ago", "yesterday", "12 days ago", "12 Oct" and, for
 * the future, "in a moment", "in 5 minutes", "tomorrow", "in 12 days".
 * Written to follow a verb: "Edited 5 minutes ago", "Expires tomorrow".
 */
export function formatRelativeTime(
  value: TimeInput,
  now: number = Date.now(),
  locale?: string,
): string {
  const then = toEpochMs(value);
  if (Number.isNaN(then)) return '';
  const diff = then - now;
  const distance = Math.abs(diff);
  const future = diff > 0;

  if (distance < 45 * SECOND) return future ? 'in a moment' : 'just now';

  let phrase: string;
  if (distance < 45 * MINUTE) {
    phrase = plural(Math.max(1, Math.round(distance / MINUTE)), 'minute');
  } else if (distance < 22 * HOUR) {
    phrase = plural(Math.max(1, Math.round(distance / HOUR)), 'hour');
  } else if (distance < 36 * HOUR) {
    return future ? 'tomorrow' : 'yesterday';
  } else if (distance < (MAX_RELATIVE_DAYS + 0.5) * DAY) {
    phrase = plural(Math.max(2, Math.round(distance / DAY)), 'day');
  } else {
    return formatShortDate(then, now, locale);
  }
  return future ? `in ${phrase}` : `${phrase} ago`;
}

/** "Expires in 6 days", "Expired yesterday", "Never expires". */
export function formatExpiry(
  expiresAt: string | null,
  now: number = Date.now(),
  locale?: string,
): string {
  if (expiresAt === null) return 'Never expires';
  const then = toEpochMs(expiresAt);
  const relative = formatRelativeTime(then, now, locale);
  return then > now ? `Expires ${relative}` : `Expired ${relative}`;
}

/** True once the instant has passed. */
export function isPast(value: TimeInput, now: number = Date.now()): boolean {
  return toEpochMs(value) <= now;
}

/** "0 B", "512 B", "1.2 KB", "3.4 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit] ?? 'KB'}`;
}
