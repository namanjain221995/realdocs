import { HISTORY_OPERATIONS, type HistoryEntry, type HistoryEvent } from '@realtimedocs/contracts';
import { describe, expect, it } from 'vitest';
import {
  collapseDiff,
  dayBoundsIso,
  dayKey,
  eventLabel,
  formatClock,
  formatIsoMs,
  formatSizeDelta,
  groupLabel,
  groupTimeline,
  interleave,
  OPERATION_LABELS,
  operationLabel,
  pasteBasis,
  restoredVersionName,
  roleLabel,
  shortId,
  summaryText,
  type TimelineBlock,
  visibleRevisions,
} from '../src/features/history/model';

const UTC = { timeZone: 'UTC', locale: 'en-GB' };

function entry(revision: number, at: string, over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    revision,
    generation: 1,
    kind: 'update',
    operation: 'text_inserted',
    actor: {
      kind: 'user',
      userId: 'u1',
      name: 'Naman Jain',
      role: 'interviewer',
      sessionId: 's1',
      connectionId: 'c1',
    },
    receivedAt: at,
    committedAt: at,
    clientOccurredAt: null,
    transactionId: `t${revision}`,
    contentSizeDelta: 0,
    summary: {},
    attachmentIds: [],
    schemaVersion: 1,
    updateBytes: 10,
    ...over,
  };
}

const other = {
  kind: 'user' as const,
  userId: 'u2',
  name: 'Asha Rao',
  role: 'admin',
  sessionId: null,
  connectionId: null,
};

function event(id: string, at: string, action = 'snapshot.restored'): HistoryEvent {
  return { id, at, action, actorName: 'Asha Rao', actorKind: 'user' };
}

describe('operation labels', () => {
  it('has a plain-words label for every operation the contract lists', () => {
    for (const operation of HISTORY_OPERATIONS) {
      expect(OPERATION_LABELS[operation], operation).toBeTruthy();
      expect(operationLabel(operation)).not.toBe(operation);
    }
    expect(Object.keys(OPERATION_LABELS).sort()).toEqual([...HISTORY_OPERATIONS].sort());
  });

  it('uses the requested wording', () => {
    expect(operationLabel('text_inserted')).toBe('Typed text');
    expect(operationLabel('baseline')).toBe('History starts here');
    expect(operationLabel('paste')).toBe('Pasted content');
  });

  it('shows an unknown operation as the server sent it', () => {
    expect(operationLabel('something_new')).toBe('something_new');
  });
});

describe('roles', () => {
  it('maps known roles, guests and unknown roles', () => {
    expect(roleLabel({ kind: 'user', role: 'candidate' })).toBe('Candidate');
    expect(roleLabel({ kind: 'user', role: 'interviewer' })).toBe('Interviewer');
    expect(roleLabel({ kind: 'user', role: 'admin' })).toBe('Admin');
    expect(roleLabel({ kind: 'user', role: 'editor' })).toBe('Editor');
    expect(roleLabel({ kind: 'guest', role: null })).toBe('Guest');
    expect(roleLabel({ kind: 'user', role: 'auditor' })).toBe('auditor');
  });
});

describe('time', () => {
  it('formats the clock with second precision in 24-hour form', () => {
    expect(formatClock('2026-11-12T15:30:02.987Z', UTC)).toBe('15:30:02');
    expect(formatClock('2026-11-12T00:05:09.000Z', UTC)).toBe('00:05:09');
    expect(formatClock('2026-11-12T15:30:02.000Z', { timeZone: 'Asia/Kolkata' })).toBe('21:00:02');
    expect(formatClock('nonsense', UTC)).toBe('');
  });

  it('keeps milliseconds in the full timestamp', () => {
    expect(formatIsoMs('2026-11-12T15:30:02.123Z')).toBe('2026-11-12T15:30:02.123Z');
    expect(formatIsoMs('2026-11-12T21:00:02.123+05:30')).toBe('2026-11-12T15:30:02.123Z');
  });

  it('decides the calendar day in the viewer zone', () => {
    expect(dayKey('2026-11-12T23:30:00.000Z', UTC)).toBe('2026-11-12');
    expect(dayKey('2026-11-12T23:30:00.000Z', { timeZone: 'Asia/Kolkata' })).toBe('2026-11-13');
  });

  it('turns a date input into the whole local day', () => {
    const start = dayBoundsIso('2026-11-12', 'start');
    const end = dayBoundsIso('2026-11-12', 'end');
    expect(start && end && Date.parse(end) - Date.parse(start)).toBe(86_400_000 - 1);
    expect(dayBoundsIso('', 'start')).toBeUndefined();
    expect(dayBoundsIso('12/11/2026', 'end')).toBeUndefined();
  });

  it('names an automatic restore version after the revision and its time', () => {
    expect(restoredVersionName(entry(12, '2026-11-12T15:30:02.000Z'), UTC)).toBe(
      'Restored from revision 12 (2026-11-12 15:30:02)',
    );
  });

  it('shortens identifiers and sizes', () => {
    expect(shortId('0123456789abcdef')).toBe('01234567…');
    expect(shortId('abc')).toBe('abc');
    expect(shortId(null)).toBe('—');
    expect(formatSizeDelta(0)).toBe('0 B');
    expect(formatSizeDelta(-2048)).toBe('−2.0 KB');
    expect(formatSizeDelta(300)).toBe('+300 B');
  });
});

describe('summaryText', () => {
  it('shows insertions and deletions of characters', () => {
    expect(
      summaryText({ operation: 'edit', summary: { insertedChars: 128, deletedChars: 12 } }),
    ).toBe('+128 / −12 characters');
    expect(summaryText({ operation: 'edit', summary: { insertedChars: 5, deletedChars: 0 } })).toBe(
      '+5 characters',
    );
    expect(summaryText({ operation: 'edit', summary: { deletedChars: 7 } })).toBe('−7 characters');
  });

  it('describes a page setting change with units and the old value', () => {
    expect(
      summaryText({
        operation: 'page_settings_changed',
        summary: { pageSettings: { marginLeft: { from: 25.4, to: 30 } } },
      }),
    ).toBe('margin left 25.4 mm → 30 mm');
    expect(
      summaryText({
        operation: 'page_settings_changed',
        summary: { pageSettings: { orientation: { from: 'portrait', to: 'landscape' } } },
      }),
    ).toBe('orientation portrait → landscape');
  });

  it('counts images, tables, attachments and other blocks', () => {
    expect(
      summaryText({
        operation: 'image_inserted',
        summary: { insertedBlocks: { image: 1 }, removedBlocks: { table: 2 } },
      }),
    ).toBe('1 image · 2 tables removed');
    expect(
      summaryText({
        operation: 'structure_changed',
        summary: { insertedBlocks: { paragraph: 2, heading: 1 }, formatChanges: 3 },
      }),
    ).toBe('3 blocks added · 3 formatting changes');
  });

  it('never invents text for an empty summary and explains the baseline', () => {
    expect(summaryText({ operation: 'edit', summary: {} })).toBe('');
    expect(summaryText({ operation: 'baseline', summary: {} })).toContain('starts here');
  });
});

describe('paste labelling', () => {
  it('says whether the client announced the paste or the size gave it away', () => {
    expect(pasteBasis({ operation: 'paste', summary: { clientHint: 'paste' } })).toMatch(
      /Announced/,
    );
    expect(pasteBasis({ operation: 'paste', summary: { clientHint: null } })).toMatch(/Inferred/);
    expect(pasteBasis({ operation: 'text_inserted', summary: { clientHint: 'paste' } })).toBeNull();
  });
});

describe('event labels', () => {
  it('words known actions and shows unknown ones raw', () => {
    expect(eventLabel('snapshot.restored')).toBe('Version restored');
    expect(eventLabel('share.created')).toBe('Share link created');
    expect(eventLabel('document.renamed')).toBe('Title changed');
    expect(eventLabel('widget.exploded')).toBe('widget.exploded');
  });
});

describe('interleave', () => {
  const entries = [
    entry(3, '2026-11-12T10:00:30.000Z'),
    entry(2, '2026-11-12T10:00:20.000Z'),
    entry(1, '2026-11-12T10:00:10.000Z'),
  ];

  it('places events between entries by time', () => {
    const rows = interleave(entries, [event('e1', '2026-11-12T10:00:25.000Z')], false);
    expect(rows.map((row) => (row.type === 'entry' ? row.entry.revision : row.event.id))).toEqual([
      3,
      'e1',
      2,
      1,
    ]);
  });

  it('puts newer events first and keeps old ones when nothing more is loadable', () => {
    const rows = interleave(
      entries,
      [event('new', '2026-11-12T11:00:00.000Z'), event('old', '2026-11-01T00:00:00.000Z')],
      false,
    );
    expect(rows[0]?.type).toBe('event');
    expect(rows.at(-1)).toMatchObject({ type: 'event', event: { id: 'old' } });
  });

  it('holds back events older than the oldest loaded entry while more pages exist', () => {
    const rows = interleave(entries, [event('old', '2026-11-01T00:00:00.000Z')], true);
    expect(rows.every((row) => row.type === 'entry')).toBe(true);
  });
});

describe('groupTimeline', () => {
  it('groups by day and by consecutive rows of the same editor', () => {
    const entries = [
      entry(6, '2026-11-12T15:41:55.000Z'),
      entry(5, '2026-11-12T15:35:00.000Z'),
      entry(4, '2026-11-12T15:30:02.000Z'),
      entry(3, '2026-11-12T15:20:00.000Z', { actor: other }),
      entry(2, '2026-11-12T15:10:00.000Z'),
      entry(1, '2026-11-11T23:59:59.000Z'),
    ];
    const days = groupTimeline(interleave(entries, [], false), UTC);
    expect(days.map((day) => day.key)).toEqual(['2026-11-12', '2026-11-11']);
    expect(days[0]?.label).toContain('12 November 2026');
    expect(days[0]?.label).toContain('Thursday');
    const blocks = days[0]?.blocks ?? [];
    expect(blocks.map((block) => (block.type === 'editor' ? block.entries.length : 0))).toEqual([
      3, 1, 1,
    ]);
    expect(visibleRevisions(days)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('breaks a run at an administrative event', () => {
    const entries = [
      entry(3, '2026-11-12T10:00:30.000Z'),
      entry(2, '2026-11-12T10:00:20.000Z'),
      entry(1, '2026-11-12T10:00:10.000Z'),
    ];
    const days = groupTimeline(
      interleave(entries, [event('e', '2026-11-12T10:00:25.000Z')], false),
      UTC,
    );
    expect(days[0]?.blocks.map((block) => block.type)).toEqual(['editor', 'event', 'editor']);
  });

  it('labels a run with editor, role, count and time range', () => {
    const entries = [entry(2, '2026-11-12T15:41:55.000Z'), entry(1, '2026-11-12T15:30:02.000Z')];
    const block = groupTimeline(interleave(entries, [], false), UTC)[0]?.blocks[0] as Extract<
      TimelineBlock,
      { type: 'editor' }
    >;
    expect(groupLabel(block, UTC)).toBe('Naman Jain — Interviewer · 2 changes · 15:30:02–15:41:55');
  });
});

describe('collapseDiff', () => {
  const eq = (text: string) => ({ op: 'equal' as const, text });
  it('keeps context around changes and folds long unchanged runs', () => {
    const diff = [
      ...Array.from({ length: 10 }, (_, i) => eq(`a${i}`)),
      { op: 'insert' as const, text: 'new' },
      { op: 'delete' as const, text: 'old' },
      ...Array.from({ length: 3 }, (_, i) => eq(`b${i}`)),
      ...Array.from({ length: 2 }, (_, i) => eq(`c${i}`)),
    ];
    const items = collapseDiff(diff, 2);
    expect(items.map((item) => item.type)).toEqual([
      'gap',
      'line',
      'line',
      'line',
      'line',
      'line',
      'line',
      'gap',
    ]);
    expect(items[0]).toMatchObject({ type: 'gap', count: 8 });
  });

  it('does not fold a run that is no longer than its fold', () => {
    const items = collapseDiff([{ op: 'insert', text: 'x' }, eq('1'), eq('2')], 0);
    expect(items.map((item) => item.type)).toEqual(['line', 'line', 'line']);
  });
});
