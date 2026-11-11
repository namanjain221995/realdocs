/**
 * Expiry choices for share links (absolute instant or never) and for
 * invitations (whole hours). Pure functions so the arithmetic is tested.
 */

const HOUR_MS = 60 * 60 * 1000;

export type ExpiryPreset = '1h' | '1d' | '7d' | '30d' | 'custom' | 'never';

export const EXPIRY_PRESETS: readonly { value: ExpiryPreset; label: string }[] = [
  { value: '1h', label: '1 hour' },
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'custom', label: 'Custom date and time' },
  { value: 'never', label: 'Never' },
];

/** New links expire after a week unless the administrator chooses otherwise. */
export const DEFAULT_EXPIRY_PRESET: ExpiryPreset = '7d';

const PRESET_HOURS: Record<Exclude<ExpiryPreset, 'custom' | 'never'>, number> = {
  '1h': 1,
  '1d': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

/** A custom expiry must leave the recipient at least this long to open the link. */
export const MIN_CUSTOM_LEAD_MS = 60 * 1000;

export type ExpiryResult = { ok: true; expiresAt: string | null } | { ok: false; error: string };

/**
 * Turns the form's choice into the `expiresAt` the API expects (UTC ISO
 * string, or `null` for a link that does not expire by itself).
 * `customLocal` is the value of an `<input type="datetime-local">`, which is
 * in the browser's local time zone.
 */
export function computeExpiry(preset: ExpiryPreset, now: Date, customLocal = ''): ExpiryResult {
  if (preset === 'never') return { ok: true, expiresAt: null };
  if (preset === 'custom') {
    if (customLocal.trim() === '') return { ok: false, error: 'Choose a date and time.' };
    const chosen = parseDatetimeLocal(customLocal);
    if (chosen === null) return { ok: false, error: 'Enter a valid date and time.' };
    if (chosen.getTime() - now.getTime() < MIN_CUSTOM_LEAD_MS) {
      return { ok: false, error: 'Choose a time in the future.' };
    }
    return { ok: true, expiresAt: chosen.toISOString() };
  }
  return {
    ok: true,
    expiresAt: new Date(now.getTime() + PRESET_HOURS[preset] * HOUR_MS).toISOString(),
  };
}

/** Parses `YYYY-MM-DDTHH:mm` (optionally with seconds) as local time. */
export function parseDatetimeLocal(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? 0),
  );
  // `new Date(2026, 1, 31)` silently rolls over to March; reject such input.
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute)
  ) {
    return null;
  }
  return date;
}

/** Formats a date for the `value`/`min` of an `<input type="datetime-local">` (local time, minutes). */
export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export interface InvitationExpiryOption {
  hours: number;
  label: string;
}

/** Invitation lifetimes offered in the form. The API accepts 1 to 720 whole hours. */
export const INVITATION_EXPIRY_OPTIONS: readonly InvitationExpiryOption[] = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
];

export const DEFAULT_INVITATION_EXPIRY_HOURS = 168;
