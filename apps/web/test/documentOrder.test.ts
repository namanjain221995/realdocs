import { describe, expect, it } from 'vitest';
import { byLatestChange, latestChange } from '../src/lib/documentOrder';

const at = (minutesAgo: number): string =>
  new Date(Date.parse('2026-11-11T12:00:00.000Z') - minutesAgo * 60_000).toISOString();

const doc = (id: string, editedMinutesAgo: number, detailsMinutesAgo = editedMinutesAgo) => ({
  id,
  contentUpdatedAt: at(editedMinutesAgo),
  updatedAt: at(detailsMinutesAgo),
});

describe('latestChange', () => {
  it('is the edit when the text changed last', () => {
    expect(latestChange(doc('a', 5, 300))).toEqual({ at: at(5), kind: 'content' });
  });

  it('is the title or state change when that came after the last edit', () => {
    expect(latestChange(doc('a', 300, 1))).toEqual({ at: at(1), kind: 'details' });
  });

  it('calls a document that was only created an edit', () => {
    expect(latestChange(doc('a', 7))).toEqual({ at: at(7), kind: 'content' });
  });

  it('compares instants, not strings', () => {
    // The same instant written with and without milliseconds, and in another zone.
    expect(
      latestChange({
        contentUpdatedAt: '2026-11-11T12:00:00Z',
        updatedAt: '2026-11-11T13:00:00.000+01:00',
      }).kind,
    ).toBe('content');
    expect(
      latestChange({
        contentUpdatedAt: '2026-11-11T12:00:00.000Z',
        updatedAt: '2026-11-11T12:00:00.001Z',
      }).kind,
    ).toBe('details');
  });
});

describe('byLatestChange', () => {
  it('puts the document that changed last first, whichever clock moved', () => {
    const renamedYesterday = doc('renamed', 9000, 1440);
    const editedJustNow = doc('edited', 1, 5000);
    const untouched = doc('untouched', 3000);
    // The order the server uses for the active view (by `updatedAt`) differs.
    const fromServer = [renamedYesterday, untouched, editedJustNow];
    expect([...fromServer].sort(byLatestChange).map((each) => each.id)).toEqual([
      'edited',
      'renamed',
      'untouched',
    ]);
  });

  it('keeps a stable order for documents that changed at the same instant', () => {
    const list = [doc('c', 10), doc('a', 10), doc('b', 10)];
    expect([...list].sort(byLatestChange).map((each) => each.id)).toEqual(['a', 'b', 'c']);
    expect(
      [...list]
        .reverse()
        .sort(byLatestChange)
        .map((each) => each.id),
    ).toEqual(['a', 'b', 'c']);
  });
});
