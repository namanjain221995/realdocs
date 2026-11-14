/**
 * The version history document (docs/version-history.md): lines of a document, the line
 * difference of the owner's sample files, where a version ends, times, and the text itself.
 */
import type { DocJSON } from '@realtimedocs/editor/schema';
import { describe, expect, it } from 'vitest';
import {
  actionOfOperation,
  actionOfVersion,
  assembleVersionHistory,
  continuesGroup,
  diffLines,
  documentLines,
  editedByText,
  formatEditedAt,
  formatLineTime,
  formatUtc,
  imageFileName,
  newAccumulator,
  offerVersion,
  recordLineTimes,
  renderLines,
  renderVersionHistoryText,
  versionHistoryManifest,
  zoneAbbreviation,
  type ImageFacts,
  type NamedAsset,
  type RawVersion,
  type SnapshotLine,
  type VersionActor,
  type VersionEditor,
} from '../../src/history/version-document';

const IMAGE = '11111111-1111-4111-8111-111111111111';
const FILE = '22222222-2222-4222-8222-222222222222';
const BUDGET = { maxVersions: 100, maxCharacters: 1_000_000 };

const text = (value: string): SnapshotLine => ({ kind: 'text', text: value });
const paragraph = (value: string): DocJSON => ({
  type: 'paragraph',
  ...(value ? { content: [{ type: 'text', text: value }] } : {}),
});
const doc = (...content: DocJSON[]): DocJSON => ({ type: 'doc', content });

const MEERA: VersionActor = {
  kind: 'guest',
  userId: null,
  grantId: 'g-meera',
  name: 'Meera Iyer',
  role: 'interviewer',
};
const AARAV: VersionActor = {
  kind: 'guest',
  userId: null,
  grantId: 'g-aarav',
  name: 'Aarav Sharma',
  role: 'candidate',
};
const EDITORS: Record<string, VersionEditor> = {
  'g-meera': {
    name: 'Meera Iyer',
    role: 'Interviewer',
    email: 'meera@acme.example',
    kind: 'guest',
  },
  'g-aarav': {
    name: 'Aarav Sharma',
    role: 'Candidate',
    email: 'aarav@example.com',
    kind: 'guest',
  },
};
const editorOf = (actor: VersionActor): VersionEditor =>
  EDITORS[actor.grantId ?? ''] ?? { name: actor.name, role: 'System', email: null, kind: 'system' };

describe('lines of a document', () => {
  it('is one line per block, with images and files as lines of their own', () => {
    const lines = documentLines(
      doc(
        paragraph(''),
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Notes' }] },
        paragraph('first'),
        paragraph(''),
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'two' },
            { type: 'hardBreak' },
            { type: 'text', text: 'lines' },
          ],
        },
        { type: 'image', attrs: { assetId: IMAGE, caption: 'a diagram' } },
        { type: 'image', attrs: { assetId: null } },
        { type: 'attachment', attrs: { assetId: FILE, name: 'cv.pdf' } },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            { type: 'listItem', content: [paragraph('third')] },
            { type: 'listItem', content: [paragraph('fourth'), paragraph('more')] },
          ],
        },
        {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { checked: true }, content: [paragraph('done')] }],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [paragraph('a')] },
                { type: 'tableCell', content: [paragraph('b')] },
              ],
            },
          ],
        },
        { type: 'blockquote', content: [paragraph('quoted')] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'x = 1\ny = 2' }] },
        paragraph(''),
        paragraph('  '),
      ),
    );
    const assets = new Map<string, NamedAsset>([
      [IMAGE, { kind: 'image', fileName: `${IMAGE}.png` }],
    ]);
    expect(renderLines(lines, assets).split('\n')).toEqual([
      'Notes',
      'first',
      '',
      'two',
      'lines',
      `[IMAGE ${IMAGE}] images/${IMAGE}.png`,
      'a diagram',
      `[FILE ${FILE}] cv.pdf`,
      '3. third',
      '4. fourth',
      '   more',
      '[x] done',
      'a\tb',
      '> quoted',
      'x = 1',
      'y = 2',
    ]);
  });

  it('says so when the file of an image is not one of this document', () => {
    expect(renderLines([{ kind: 'image', id: IMAGE }], new Map())).toBe(
      `[IMAGE ${IMAGE}] (file not available)`,
    );
  });

  it('names an image file by its id and the stored content type', () => {
    expect(imageFileName(IMAGE, 'image/jpeg', 'photo.JPEG')).toBe(`${IMAGE}.jpg`);
    expect(imageFileName(IMAGE, 'image/png', 'x')).toBe(`${IMAGE}.png`);
    expect(imageFileName(IMAGE, 'application/x-unknown', 'scan.TIFF')).toBe(`${IMAGE}.tiff`);
    expect(imageFileName(IMAGE, 'application/x-unknown', 'noextension')).toBe(`${IMAGE}.bin`);
  });
});

describe('line difference, as in the sample documents', () => {
  // example/doc (10).txt, versions 2 to 4: three paragraphs are replaced by the beginning of a
  // new one, which is then completed and followed by three more.
  const v2 = [
    'One situation I clearly remember',
    'So our whole plan had to change',
    'It was a bit',
  ];
  const v3 = [
    'Yeah, honestly, there was some impact on timeline. When the requirement changed to focus on low lat',
  ];
  const v4 = [
    'Yeah, honestly, there was some impact on timeline. When the requirement changed to focus on low latency, we could not continue.',
    'I clearly remember we had to communicate this.',
    'Also, internally, we had to manage priorities.',
    'Good thing was, since we communicated early.',
  ];

  it('version 3 adds the partial line and removes the three before it', () => {
    const diff = diffLines(v2.map(text), v3.map(text));
    expect(diff.added).toEqual(v3.map(text));
    expect(diff.removed).toEqual(v2.map(text));
  });

  it('version 4 replaces the partial line by the complete one and adds the rest', () => {
    const diff = diffLines(v3.map(text), v4.map(text));
    expect(diff.added).toEqual(v4.map(text));
    expect(diff.removed).toEqual(v3.map(text));
  });

  it('is a multiset difference, ignores blank lines and surrounding spaces', () => {
    const before = ['a', 'b', '', 'a '].map(text);
    const after = ['a', '  ', 'a', 'a', 'c'].map(text);
    const diff = diffLines(before, after);
    expect(diff.added.map((line) => (line.kind === 'text' ? line.text : ''))).toEqual(['a', 'c']);
    expect(diff.removed).toEqual([text('b')]);
    // Only the order changed: nothing is added or removed.
    expect(diffLines(['x', 'y'].map(text), ['y', 'x'].map(text))).toEqual({
      added: [],
      removed: [],
    });
  });

  it('compares images by id', () => {
    const diff = diffLines([text('a'), { kind: 'image', id: IMAGE }], [text('a')]);
    expect(diff.removed).toEqual([{ kind: 'image', id: IMAGE }]);
  });
});

describe('where a version ends', () => {
  const options = { gapSeconds: 15, maxSpanSeconds: 60 };
  const group = { actorKey: 'guest:a', firstAt: 0, lastAt: 10_000, paste: false };

  it('continues for the same editor within the gap and the span', () => {
    expect(continuesGroup(group, 'guest:a', 25_000, false, options)).toBe(true);
  });
  it('ends when the editor changes', () => {
    expect(continuesGroup(group, 'guest:b', 11_000, false, options)).toBe(false);
  });
  it('ends after a pause longer than the gap', () => {
    expect(continuesGroup(group, 'guest:a', 25_001, false, options)).toBe(false);
  });
  it('ends when it would span more than the maximum', () => {
    const long = { ...group, lastAt: 55_000 };
    expect(continuesGroup(long, 'guest:a', 60_000, false, options)).toBe(true);
    expect(continuesGroup(long, 'guest:a', 60_001, false, options)).toBe(false);
  });
  it('keeps a paste apart: it neither joins a version nor is joined', () => {
    expect(continuesGroup(group, 'guest:a', 11_000, true, options)).toBe(false);
    expect(continuesGroup({ ...group, paste: true }, 'guest:a', 11_000, false, options)).toBe(
      false,
    );
  });
  it('starts when nothing is open', () => {
    expect(continuesGroup(null, 'guest:a', 0, false, options)).toBe(false);
  });

  it('names the action of a change and of a version', () => {
    expect(actionOfOperation('text_inserted')).toBe('Typed');
    expect(actionOfOperation('paste')).toBe('Pasted');
    expect(actionOfOperation('image_inserted')).toBe('Pasted');
    expect(actionOfOperation('text_deleted')).toBe('Deleted');
    expect(actionOfOperation('formatting_changed')).toBe('Formatted');
    expect(actionOfOperation('edit')).toBe('Mixed');
    expect(actionOfVersion(['Typed', 'Formatted', 'Typed'])).toBe('Typed');
    expect(actionOfVersion(['Formatted'])).toBe('Formatted');
    expect(actionOfVersion(['Typed', 'Deleted'])).toBe('Mixed');
  });
});

describe('times', () => {
  const at = new Date('2026-06-29T20:51:18.400Z');
  it('prints India time in the 12-hour form of the samples', () => {
    expect(formatEditedAt(at, 'Asia/Kolkata')).toBe('2026-06-30 02:21:18 AM IST');
    expect(formatLineTime(at, 'Asia/Kolkata')).toBe('02:21:18 AM');
  });
  it('prints UTC and other zones', () => {
    expect(formatEditedAt(at, 'UTC')).toBe('2026-06-29 08:51:18 PM UTC');
    expect(formatEditedAt(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(
      '2026-01-15 07:00:00 AM EST',
    );
    expect(zoneAbbreviation(at, 'Etc/UTC')).toBe('UTC');
    expect(zoneAbbreviation(at, 'Asia/Calcutta')).toBe('IST');
  });
  it('prints midnight and noon as 12', () => {
    expect(formatEditedAt(new Date('2026-06-29T00:00:05Z'), 'UTC')).toBe(
      '2026-06-29 12:00:05 AM UTC',
    );
    expect(formatEditedAt(new Date('2026-06-29T12:00:05Z'), 'UTC')).toBe(
      '2026-06-29 12:00:05 PM UTC',
    );
  });
  it('prints the header times in UTC, 24-hour', () => {
    expect(formatUtc(at)).toBe('2026-06-29 20:51:18 UTC');
  });
});

describe('who', () => {
  it('prints the editor with role and address, a guest without one, the system bare', () => {
    expect(editedByText(EDITORS['g-meera'] as VersionEditor)).toBe(
      'Meera Iyer (Interviewer, meera@acme.example)',
    );
    expect(
      editedByText({ name: 'Guest Amber Lynx', role: 'Guest', email: null, kind: 'guest' }),
    ).toBe('Guest Amber Lynx (Guest)');
    expect(editedByText({ name: 'System', role: 'System', email: null, kind: 'system' })).toBe(
      'System',
    );
  });
});

describe('the document', () => {
  const t = (seconds: number): Date => new Date(Date.UTC(2026, 5, 29, 20, 50, seconds));
  const first = 'Design a URL shortener.';
  const partial = 'Start with the API: POST /shor';
  const second = 'Start with the API: POST /shorten and GET /{code}.';

  function history() {
    const accumulator = newAccumulator();
    const offer = (raw: RawVersion): boolean => offerVersion(accumulator, raw, BUDGET);

    // Version 1: Meera types one line over twelve seconds.
    const v1Added = new Map<string, number[]>();
    recordLineTimes([], [text('Design a URL')], t(2).getTime(), v1Added, new Map());
    recordLineTimes([text('Design a URL')], [text(first)], t(14).getTime(), v1Added, new Map());
    expect(
      offer({
        startedAt: t(2),
        editedAt: t(14),
        actor: MEERA,
        action: 'Typed',
        lines: [text(first)],
        addedAt: v1Added,
        removedAt: new Map(),
      }),
    ).toBe(true);
    // Formatting only: not a version.
    expect(
      offer({
        startedAt: t(15),
        editedAt: t(15),
        actor: MEERA,
        action: 'Formatted',
        lines: [text(first), text('')],
      }),
    ).toBe(false);
    // Version 2: Aarav starts a line.
    expect(
      offer({
        startedAt: t(20),
        editedAt: t(20),
        actor: AARAV,
        action: 'Typed',
        lines: [text(first), text(partial)],
      }),
    ).toBe(true);
    // Version 3: Aarav pastes an image and completes the line.
    const v3Added = new Map<string, number[]>([[second, [t(41).getTime()]]]);
    const v3Removed = new Map<string, number[]>([[partial, [t(40).getTime()]]]);
    expect(
      offer({
        startedAt: t(40),
        editedAt: t(41),
        actor: AARAV,
        action: 'Pasted',
        lines: [text(first), text(second), { kind: 'image', id: IMAGE }],
        addedAt: v3Added,
        removedAt: v3Removed,
      }),
    ).toBe(true);
    // Version 4: Meera removes the image.
    expect(
      offer({
        startedAt: t(50),
        editedAt: t(50),
        actor: MEERA,
        action: 'Deleted',
        lines: [text(first), text(second)],
      }),
    ).toBe(true);

    const fileName = `${IMAGE}.png`;
    const names = new Map<string, NamedAsset>([[IMAGE, { kind: 'image', fileName }]]);
    const images = new Map<string, ImageFacts>([
      [
        IMAGE,
        {
          id: IMAGE,
          fileName,
          mime: 'image/png',
          sizeBytes: 68,
          sha256: 'ab'.repeat(32),
          url: `/api/v1/documents/d1/version-history/images/${IMAGE}`,
        },
      ],
    ]);
    return assembleVersionHistory(
      {
        document: {
          id: 'd1',
          title: 'Aarav_Sharma_Acme\nCorp',
          url: 'https://docs.example.com/d/d1',
        },
        session: {
          id: 's1',
          candidate: 'Aarav Sharma',
          company: 'Acme Corp',
          round: { number: '2', name: 'System design' },
        },
        trackingStartedAt: t(0),
        finalizedAt: t(59),
        timezone: 'Asia/Kolkata',
      },
      accumulator,
      names,
      images,
      editorOf,
    );
  }

  it('numbers the versions without gaps and tracks when an image was there', () => {
    const result = history();
    expect(result.versions.map((version) => version.version)).toEqual([1, 2, 3, 4]);
    expect(result.versions[2]?.images).toEqual([IMAGE]);
    expect(result.images).toEqual([
      expect.objectContaining({ id: IMAGE, firstVersion: 3, lastVersion: 3 }),
    ]);
    expect(result.truncated).toBe(false);
    // `added` and `removed` stay plain strings; the times are in the detail arrays.
    expect(result.versions[2]?.added).toEqual([
      second,
      `[IMAGE ${IMAGE}] image pasted (images/${IMAGE}.png)`,
    ]);
    expect(result.versions[2]?.addedDetail[0]).toEqual({
      text: second,
      at: t(41).toISOString(),
      atText: '02:20:41 AM',
    });
    expect(result.versions[2]?.removedDetail[0]?.atText).toBe('02:20:40 AM');
    expect(result.versions[0]?.editor).toEqual(EDITORS['g-meera']);
  });

  it('says null for the last version of an image that is still in the document', () => {
    const accumulator = newAccumulator();
    offerVersion(
      accumulator,
      {
        startedAt: t(1),
        editedAt: t(1),
        actor: AARAV,
        action: 'Pasted',
        lines: [{ kind: 'image', id: IMAGE }],
      },
      BUDGET,
    );
    const result = assembleVersionHistory(
      {
        document: { id: 'd', title: 't', url: 'u' },
        session: null,
        trackingStartedAt: t(1),
        finalizedAt: t(1),
        timezone: 'UTC',
      },
      accumulator,
      new Map([[IMAGE, { kind: 'image', fileName: `${IMAGE}.png` }]]),
      new Map([
        [
          IMAGE,
          {
            id: IMAGE,
            fileName: `${IMAGE}.png`,
            mime: 'image/png',
            sizeBytes: 1,
            sha256: '00',
            url: 'x',
          },
        ],
      ]),
      editorOf,
    );
    expect(result.images[0]).toMatchObject({ firstVersion: 1, lastVersion: null });
  });

  it('is written exactly in the layout of the sample documents', () => {
    const rule = '='.repeat(50);
    expect(renderVersionHistoryText(history())).toBe(
      [
        'DOCUMENT VERSION HISTORY',
        'Document ID: d1',
        'Document URL: https://docs.example.com/d/d1',
        'Title: Aarav_Sharma_Acme Corp',
        'Session ID: s1',
        'Candidate: Aarav Sharma',
        'Company: Acme Corp',
        'Round: 2 System design',
        'Tracking Started: 2026-06-29 20:50:00 UTC',
        '',
        '',
        rule,
        'VERSION 1',
        'Started At: 2026-06-30 02:20:02 AM IST',
        'Edited At: 2026-06-30 02:20:14 AM IST',
        'Edited By: Meera Iyer (Interviewer, meera@acme.example)',
        'Action: Typed',
        '',
        'ADDED:',
        `- [02:20:14 AM] ${first}`,
        '',
        'REMOVED:',
        '- (nothing removed)',
        '',
        'CURRENT SNAPSHOT:',
        first,
        '',
        rule,
        'VERSION 2',
        'Edited At: 2026-06-30 02:20:20 AM IST',
        'Edited By: Aarav Sharma (Candidate, aarav@example.com)',
        'Action: Typed',
        '',
        'ADDED:',
        `- [02:20:20 AM] ${partial}`,
        '',
        'REMOVED:',
        '- (nothing removed)',
        '',
        'CURRENT SNAPSHOT:',
        first,
        partial,
        '',
        rule,
        'VERSION 3',
        'Edited At: 2026-06-30 02:20:41 AM IST',
        'Edited By: Aarav Sharma (Candidate, aarav@example.com)',
        'Action: Pasted',
        '',
        'ADDED:',
        `- [02:20:41 AM] ${second}`,
        `- [02:20:41 AM] [IMAGE ${IMAGE}] image pasted (images/${IMAGE}.png)`,
        '',
        'REMOVED:',
        `- [02:20:40 AM] ${partial}`,
        '',
        'CURRENT SNAPSHOT:',
        first,
        second,
        `[IMAGE ${IMAGE}] images/${IMAGE}.png`,
        '',
        rule,
        'VERSION 4',
        'Edited At: 2026-06-30 02:20:50 AM IST',
        'Edited By: Meera Iyer (Interviewer, meera@acme.example)',
        'Action: Deleted',
        '',
        'ADDED:',
        '- (nothing added)',
        '',
        'REMOVED:',
        `- [02:20:50 AM] [IMAGE ${IMAGE}] image removed`,
        '',
        'CURRENT SNAPSHOT:',
        first,
        second,
        '',
        rule,
        'CURRENT FINAL CONTENT',
        first,
        second,
        '',
        '',
        rule,
        'FINALIZED AT: 2026-06-29 20:50:59 UTC',
        '',
      ].join('\n'),
    );
  });

  it('cuts the list at the size limit and keeps the final content complete', () => {
    const accumulator = newAccumulator();
    for (let index = 1; index <= 4; index += 1) {
      offerVersion(
        accumulator,
        {
          startedAt: t(index),
          editedAt: t(index),
          actor: MEERA,
          action: 'Typed',
          lines: [text(`line ${index}`)],
        },
        { maxVersions: 2, maxCharacters: 1_000 },
      );
    }
    const result = assembleVersionHistory(
      {
        document: { id: 'd', title: 't', url: 'u' },
        session: null,
        trackingStartedAt: t(1),
        finalizedAt: t(4),
        timezone: 'UTC',
      },
      accumulator,
      new Map(),
      new Map(),
      editorOf,
    );
    expect(result.versions).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.finalContent).toBe('line 4');
    expect(renderVersionHistoryText(result)).toContain(
      'NOTE: only the first 2 versions are listed (size limit).',
    );
  });

  it('writes an empty history without versions', () => {
    const result = assembleVersionHistory(
      {
        document: { id: 'd', title: 't', url: 'u' },
        session: null,
        trackingStartedAt: null,
        finalizedAt: null,
        timezone: 'UTC',
      },
      newAccumulator(),
      new Map(),
      new Map(),
      editorOf,
    );
    const rule = '='.repeat(50);
    expect(renderVersionHistoryText(result)).toBe(
      [
        'DOCUMENT VERSION HISTORY',
        'Document ID: d',
        'Document URL: u',
        'Title: t',
        'Tracking Started: (no history recorded)',
        '',
        '',
        rule,
        'CURRENT FINAL CONTENT',
        '',
        '',
        '',
        rule,
        'FINALIZED AT: (no history recorded)',
        '',
      ].join('\n'),
    );
  });

  it('leaves the snapshots out of the manifest', () => {
    const manifest = versionHistoryManifest(history());
    expect(manifest.versions).toHaveLength(4);
    expect(manifest.versions[0]).not.toHaveProperty('snapshot');
    expect(manifest).not.toHaveProperty('finalContent');
    expect(manifest.images).toHaveLength(1);
  });
});
