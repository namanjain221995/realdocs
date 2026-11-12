import { describe, expect, it } from 'vitest';
import {
  allowedSessionActions,
  EMPTY_FILTERS,
  localDateToIso,
  parseLines,
  roundLabel,
  toSessionQuery,
} from '../src/features/admin/serviceFormat';

describe('allowedSessionActions', () => {
  it('follows the session state machine', () => {
    expect(allowedSessionActions('scheduled')).toEqual({
      start: true,
      complete: false,
      cancel: true,
      archive: true,
    });
    expect(allowedSessionActions('in_progress')).toEqual({
      start: false,
      complete: true,
      cancel: true,
      archive: true,
    });
    for (const status of ['completed', 'cancelled'] as const) {
      expect(allowedSessionActions(status)).toEqual({
        start: false,
        complete: false,
        cancel: false,
        archive: true,
      });
    }
    expect(Object.values(allowedSessionActions('archived'))).toEqual([false, false, false, false]);
  });
});

describe('parseLines', () => {
  it('splits on lines and commas, trims and removes duplicates', () => {
    expect(parseLines(' 10.0.0.0/8\n\n203.0.113.0/24, 10.0.0.0/8 ')).toEqual([
      '10.0.0.0/8',
      '203.0.113.0/24',
    ]);
    expect(parseLines('')).toEqual([]);
  });
});

describe('localDateToIso', () => {
  it('rejects anything but YYYY-MM-DD', () => {
    expect(localDateToIso('', false)).toBeUndefined();
    expect(localDateToIso('12/11/2026', false)).toBeUndefined();
  });

  it('gives the start and end of the local day', () => {
    const start = new Date(localDateToIso('2026-03-05', false) as string);
    const end = new Date(localDateToIso('2026-03-05', true) as string);
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getDate()).toBe(5);
  });
});

describe('toSessionQuery', () => {
  it('leaves empty fields out', () => {
    expect(toSessionQuery(EMPTY_FILTERS)).toEqual({});
  });

  it('maps the form to the server query', () => {
    const query = toSessionQuery({
      ...EMPTY_FILTERS,
      status: 'in_progress',
      candidate: ' a@example.com ',
      company: 'Acme',
      round: '2',
      q: 'design',
      from: '2026-03-01',
    });
    expect(query).toMatchObject({
      status: 'in_progress',
      candidateEmail: 'a@example.com',
      company: 'Acme',
      round: 2,
      q: 'design',
    });
    expect(typeof query.from).toBe('string');
  });

  it('ignores an unknown status and an out-of-range round', () => {
    expect(toSessionQuery({ ...EMPTY_FILTERS, status: 'bogus', round: '500' })).toEqual({});
  });
});

describe('roundLabel', () => {
  it('includes the name when there is one', () => {
    expect(roundLabel({ number: 2, name: 'System design' })).toBe('Round 2 — System design');
    expect(roundLabel({ number: 1, name: null })).toBe('Round 1');
  });
});
