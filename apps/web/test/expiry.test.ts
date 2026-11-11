import { CreateInvitationRequest, CreateShareRequest } from '@realtimedocs/contracts';
import { describe, expect, it } from 'vitest';
import {
  computeExpiry,
  DEFAULT_EXPIRY_PRESET,
  DEFAULT_INVITATION_EXPIRY_HOURS,
  EXPIRY_PRESETS,
  INVITATION_EXPIRY_OPTIONS,
  parseDatetimeLocal,
  toDatetimeLocalValue,
} from '../src/lib/expiry';

const NOW = new Date('2026-11-10T12:00:00.000Z');

describe('computeExpiry', () => {
  it.each([
    ['1h', '2026-11-10T13:00:00.000Z'],
    ['1d', '2026-11-11T12:00:00.000Z'],
    ['7d', '2026-11-17T12:00:00.000Z'],
    ['30d', '2026-12-10T12:00:00.000Z'],
  ] as const)('%s adds the right amount to now', (preset, expected) => {
    expect(computeExpiry(preset, NOW)).toEqual({ ok: true, expiresAt: expected });
  });

  it('returns null for a link that never expires', () => {
    expect(computeExpiry('never', NOW)).toEqual({ ok: true, expiresAt: null });
  });

  it('offers every preset the brief asks for, defaulting to a week', () => {
    expect(EXPIRY_PRESETS.map((preset) => preset.value)).toEqual([
      '1h',
      '1d',
      '7d',
      '30d',
      'custom',
      'never',
    ]);
    expect(DEFAULT_EXPIRY_PRESET).toBe('7d');
  });

  it('produces values the share contract accepts', () => {
    for (const { value } of EXPIRY_PRESETS) {
      const result = computeExpiry(
        value,
        NOW,
        toDatetimeLocalValue(new Date(NOW.getTime() + 3_600_000)),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(() => CreateShareRequest.parse({ expiresAt: result.expiresAt })).not.toThrow();
      }
    }
  });

  it('reads a custom value as local time', () => {
    const local = new Date(2026, 10, 20, 9, 30); // 20 Nov 2026, 09:30 local
    const result = computeExpiry('custom', NOW, '2026-11-20T09:30');
    expect(result).toEqual({ ok: true, expiresAt: local.toISOString() });
  });

  it('rejects an empty, malformed or impossible custom value', () => {
    expect(computeExpiry('custom', NOW, '')).toEqual({
      ok: false,
      error: 'Choose a date and time.',
    });
    expect(computeExpiry('custom', NOW, 'next tuesday')).toEqual({
      ok: false,
      error: 'Enter a valid date and time.',
    });
    expect(computeExpiry('custom', NOW, '2026-02-31T10:00')).toEqual({
      ok: false,
      error: 'Enter a valid date and time.',
    });
  });

  it('rejects a custom time that is not in the future', () => {
    const past = toDatetimeLocalValue(new Date(NOW.getTime() - 60_000));
    const tooSoon = toDatetimeLocalValue(new Date(NOW.getTime()));
    expect(computeExpiry('custom', NOW, past)).toEqual({
      ok: false,
      error: 'Choose a time in the future.',
    });
    expect(computeExpiry('custom', NOW, tooSoon)).toEqual({
      ok: false,
      error: 'Choose a time in the future.',
    });
  });
});

describe('datetime-local helpers', () => {
  it('round-trips a local date to the input format and back', () => {
    const date = new Date(2027, 0, 5, 7, 4);
    expect(toDatetimeLocalValue(date)).toBe('2027-01-05T07:04');
    expect(parseDatetimeLocal('2027-01-05T07:04')?.getTime()).toBe(date.getTime());
  });

  it('accepts seconds when the browser includes them', () => {
    expect(parseDatetimeLocal('2027-01-05T07:04:30')?.getSeconds()).toBe(30);
  });

  it('refuses anything else', () => {
    expect(parseDatetimeLocal('2027-01-05')).toBeNull();
    expect(parseDatetimeLocal('2027-13-01T00:00')).toBeNull();
    expect(parseDatetimeLocal('2027-01-05T25:00')).toBeNull();
  });
});

describe('invitation expiry options', () => {
  it('are whole hours the invitation contract accepts', () => {
    for (const option of INVITATION_EXPIRY_OPTIONS) {
      expect(() => CreateInvitationRequest.parse({ expiresInHours: option.hours })).not.toThrow();
    }
  });

  it('default to seven days, like the server', () => {
    expect(DEFAULT_INVITATION_EXPIRY_HOURS).toBe(168);
    expect(INVITATION_EXPIRY_OPTIONS.some((option) => option.hours === 168)).toBe(true);
    expect(CreateInvitationRequest.parse({}).expiresInHours).toBe(168);
  });
});
