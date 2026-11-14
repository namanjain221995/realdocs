import { describe, expect, it } from 'vitest';
import { interviewInfo } from '../src/lib/interviewInfo';
import { roundLabel } from '../src/features/admin/serviceFormat';
import {
  editorText,
  imagesFirstIn,
  paginate,
  parseImageLine,
  safeImageUrl,
  shownLines,
  snapshotLines,
  versionsJsonUrl,
  versionsTxtUrl,
  versionsZipUrl,
  type VersionImage,
} from '../src/features/history/versionsModel';

describe('parseImageLine', () => {
  it('reads the id and the rest of an image line', () => {
    expect(parseImageLine('[IMAGE 3f6c9a] image pasted (images/3f6c9a.png)')).toEqual({
      id: '3f6c9a',
      rest: 'image pasted (images/3f6c9a.png)',
    });
    expect(parseImageLine('[IMAGE abc]')).toEqual({ id: 'abc', rest: '' });
  });
  it('ignores other lines, including markup', () => {
    expect(parseImageLine('plain text')).toBeNull();
    expect(parseImageLine('  [IMAGE abc] indented')).toBeNull();
    expect(parseImageLine('[IMAGE ] no id')).toBeNull();
    expect(parseImageLine('<img src=x> [IMAGE abc]')).toBeNull();
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 60 }, (_, index) => index + 1);
  it('slices 25 per page and reports the range', () => {
    const second = paginate(items, 2);
    expect(second.items[0]).toBe(26);
    expect(second.items).toHaveLength(25);
    expect([second.from, second.to, second.pageCount]).toEqual([26, 50, 3]);
    expect(paginate(items, 3).items).toHaveLength(10);
  });
  it('clamps the page and copes with an empty list', () => {
    expect(paginate(items, 99).page).toBe(3);
    expect(paginate(items, -4).page).toBe(1);
    expect(paginate([], 1)).toMatchObject({ items: [], pageCount: 1, from: 0, to: 0 });
  });
});

describe('urls', () => {
  const id = 'd0000001-0000-4000-8000-000000000001';
  it('builds the download links', () => {
    expect(versionsTxtUrl(id, 'Asia/Kolkata')).toBe(
      `/api/documents/${id}/version-history?format=txt&timezone=Asia%2FKolkata`,
    );
    expect(versionsTxtUrl(id, undefined)).toBe(`/api/documents/${id}/version-history?format=txt`);
    expect(versionsZipUrl(id)).toBe(`/api/documents/${id}/version-history/archive`);
    expect(versionsJsonUrl(id, 'UTC')).toContain('format=json&timezone=UTC');
  });
  it('only accepts image paths on this origin', () => {
    expect(safeImageUrl('/api/documents/x/version-history/images/y')).not.toBeNull();
    expect(safeImageUrl('//evil.example/x.png')).toBeNull();
    expect(safeImageUrl('https://evil.example/x.png')).toBeNull();
    expect(safeImageUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('snapshot and images', () => {
  it('drops one trailing empty line only', () => {
    expect(snapshotLines('a\n\nb\n')).toEqual(['a', '', 'b']);
    expect(snapshotLines('')).toEqual(['']);
  });
  it('lists the images that first appeared in a version', () => {
    const image = (id: string, firstVersion: number): VersionImage => ({
      id,
      fileName: `${id}.png`,
      mime: 'image/png',
      sizeBytes: 1,
      sha256: 'x',
      firstVersion,
      lastVersion: null,
      url: `/i/${id}`,
    });
    expect(
      imagesFirstIn([image('a', 1), image('b', 2), image('c', 1)], 1).map((i) => i.id),
    ).toEqual(['a', 'c']);
  });
});

describe('roundLabel with a string or a number', () => {
  it('shows both the same way', () => {
    expect(roundLabel({ number: '2', name: 'System design' })).toBe('Round 2 — System design');
    expect(roundLabel({ number: 3, name: null })).toBe('Round 3');
  });
});

describe('detail fields', () => {
  it('words the editor, with a fallback', () => {
    expect(
      editorText({
        editedBy: 'A',
        editor: { name: 'Aarav', role: 'Candidate', email: 'a@x.io', kind: 'user' },
      }),
    ).toBe('Aarav (Candidate, a@x.io)');
    expect(
      editorText({ editedBy: 'A', editor: { name: 'Aarav', role: '', email: null, kind: 'user' } }),
    ).toBe('Aarav');
    expect(editorText({ editedBy: 'Plain' })).toBe('Plain');
  });
  it('uses the timed lines only when they match the plain ones', () => {
    const detail = [{ text: 'x', at: '2026-01-01T00:00:00Z', atText: '02:21:18 AM' }];
    expect(shownLines(['x'], detail)).toEqual([{ text: 'x', atText: '02:21:18 AM' }]);
    expect(shownLines(['x'], undefined)).toEqual([{ text: 'x', atText: null }]);
    expect(shownLines(['x', 'y'], detail)).toEqual([
      { text: 'x', atText: null },
      { text: 'y', atText: null },
    ]);
  });
});

describe('interviewInfo', () => {
  it('reads the optional field', () => {
    expect(
      interviewInfo({
        interview: {
          company: 'Acme',
          round: { number: '2', name: 'System design' },
          candidate: 'Aarav',
          scheduledAt: '2030-03-14T10:00:00Z',
        },
      }),
    ).toMatchObject({
      company: 'Acme',
      roundText: 'Round 2 — System design',
      candidateName: 'Aarav',
    });
    expect(
      interviewInfo({ interview: { company: 'Acme', round: { number: 3, name: null } } })
        ?.roundText,
    ).toBe('Round 3');
    expect(interviewInfo({})).toBeNull();
    expect(interviewInfo({ interview: 'x' })).toBeNull();
  });
});
