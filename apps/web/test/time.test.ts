import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDateTime,
  formatExpiry,
  formatRelativeTime,
  formatShortDate,
  isPast,
} from '../src/lib/time';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ago = (ms: number): number => NOW - ms;
const ahead = (ms: number): number => NOW + ms;

describe('formatRelativeTime', () => {
  it.each([
    [0, 'just now'],
    [44 * SECOND, 'just now'],
    [45 * SECOND, '1 minute ago'],
    [90 * SECOND, '2 minutes ago'],
    [5 * MINUTE, '5 minutes ago'],
    [44 * MINUTE, '44 minutes ago'],
    [45 * MINUTE, '1 hour ago'],
    [3 * HOUR, '3 hours ago'],
    [21 * HOUR, '21 hours ago'],
    [22 * HOUR, 'yesterday'],
    [35 * HOUR, 'yesterday'],
    [36 * HOUR, '2 days ago'],
    [6 * DAY, '6 days ago'],
    [30 * DAY, '30 days ago'],
  ])('%d ms in the past reads "%s"', (distance, expected) => {
    expect(formatRelativeTime(ago(distance), NOW)).toBe(expected);
  });

  it.each([
    [10 * SECOND, 'in a moment'],
    [5 * MINUTE, 'in 5 minutes'],
    [HOUR, 'in 1 hour'],
    [23 * HOUR, 'tomorrow'],
    [7 * DAY, 'in 7 days'],
    [30 * DAY, 'in 30 days'],
  ])('%d ms in the future reads "%s"', (distance, expected) => {
    expect(formatRelativeTime(ahead(distance), NOW)).toBe(expected);
  });

  it('switches to a calendar date beyond a month', () => {
    const then = ago(45 * DAY);
    expect(formatRelativeTime(then, NOW, 'en-GB')).toBe(formatShortDate(then, NOW, 'en-GB'));
    // "26 Sept" in en-GB: day, then an abbreviated month, and no year within the same year.
    expect(formatRelativeTime(then, NOW, 'en-GB')).toMatch(/^\d{1,2} \p{L}{3,4}$/u);
  });

  it('accepts ISO strings and Date objects', () => {
    expect(formatRelativeTime('2026-11-10T11:55:00.000Z', NOW)).toBe('5 minutes ago');
    expect(formatRelativeTime(new Date(ago(2 * HOUR)), NOW)).toBe('2 hours ago');
  });

  it('returns an empty string for a value that is not a date', () => {
    expect(formatRelativeTime('not a date', NOW)).toBe('');
  });
});

describe('formatShortDate', () => {
  it('leaves the year out for dates in the current year', () => {
    expect(formatShortDate('2026-03-05T12:00:00.000Z', NOW, 'en-GB')).toBe('5 Mar');
  });

  it('includes the year otherwise', () => {
    expect(formatShortDate('2025-03-05T12:00:00.000Z', NOW, 'en-GB')).toBe('5 Mar 2025');
  });
});

describe('formatExpiry', () => {
  it('describes links that never expire, will expire and have expired', () => {
    expect(formatExpiry(null, NOW)).toBe('Never expires');
    expect(formatExpiry(new Date(ahead(6 * DAY)).toISOString(), NOW)).toBe('Expires in 6 days');
    expect(formatExpiry(new Date(ahead(23 * HOUR)).toISOString(), NOW)).toBe('Expires tomorrow');
    expect(formatExpiry(new Date(ago(2 * DAY)).toISOString(), NOW)).toBe('Expired 2 days ago');
    expect(formatExpiry(new Date(ago(10 * SECOND)).toISOString(), NOW)).toBe('Expired just now');
  });
});

describe('isPast', () => {
  it('compares against the given clock', () => {
    expect(isPast(ago(1), NOW)).toBe(true);
    expect(isPast(NOW, NOW)).toBe(true);
    expect(isPast(ahead(1), NOW)).toBe(false);
  });
});

describe('formatDateTime', () => {
  it('formats a full date and time, and nothing for an invalid value', () => {
    expect(formatDateTime('2026-11-10T12:00:00.000Z', 'en-GB')).toMatch(/2026/);
    expect(formatDateTime('nope')).toBe('');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [150 * 1024, '150 KB'],
    [5 * 1024 * 1024, '5 MB'],
    [2.34 * 1024 * 1024 * 1024, '2.3 GB'],
  ])('%d bytes reads "%s"', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it('returns an empty string for nonsense', () => {
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
  });
});
