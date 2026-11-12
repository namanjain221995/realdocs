/**
 * Version history fixtures: one document (`Q4 launch plan`) with twelve
 * revisions on two days, three editors and a few administrative events.
 * Times are UTC; the suite runs in UTC with the en-GB locale.
 */
import type { HistoryEntry, HistoryEvent } from '@realtimedocs/contracts';
import { DOC_IDS } from './fixtures';

type Actor = HistoryEntry['actor'];

export const HISTORY_ACTORS: Record<'naman' | 'priya' | 'asha', Actor> = {
  naman: {
    kind: 'user',
    userId: 'a1111111-0000-4000-8000-000000000001',
    name: 'Naman Jain',
    role: 'interviewer',
    sessionId: '5e55100a-aaaa-4bbb-8ccc-111111111111',
    connectionId: 'c0000001-aaaa-4bbb-8ccc-111111111111',
  },
  priya: {
    kind: 'guest',
    userId: null,
    name: 'Priya Nair',
    role: 'candidate',
    sessionId: '5e55100b-aaaa-4bbb-8ccc-222222222222',
    connectionId: 'c0000002-aaaa-4bbb-8ccc-222222222222',
  },
  asha: {
    kind: 'user',
    userId: 'a1111111-0000-4000-8000-000000000003',
    name: 'Asha Rao',
    role: 'admin',
    sessionId: '5e55100c-aaaa-4bbb-8ccc-333333333333',
    connectionId: null,
  },
};

const EMPTY_SUMMARY: HistoryEntry['summary'] = {
  insertedChars: 0,
  deletedChars: 0,
  insertedBlocks: {},
  removedBlocks: {},
  formatChanges: 0,
  attributeChanges: 0,
  pageSettings: {},
  attachmentsAdded: [],
  attachmentsRemoved: [],
  clientHint: null,
  transactions: 1,
};

function entry(
  revision: number,
  at: string,
  actor: Actor,
  operation: HistoryEntry['operation'],
  summary: Partial<HistoryEntry['summary']>,
  extra: Partial<HistoryEntry> = {},
): HistoryEntry {
  return {
    revision,
    generation: 1,
    kind: operation === 'checkpoint' ? 'checkpoint' : 'update',
    operation,
    actor,
    receivedAt: at.replace(
      /\d{3}Z$/,
      (ms) => String(Math.max(0, Number(ms.slice(0, 3)) - 40)).padStart(3, '0') + 'Z',
    ),
    committedAt: at,
    clientOccurredAt: null,
    transactionId: `00000000-0000-4000-8000-${String(revision).padStart(12, '0')}`,
    contentSizeDelta: (summary.insertedChars ?? 0) - (summary.deletedChars ?? 0),
    summary: { ...EMPTY_SUMMARY, ...summary },
    attachmentIds: [],
    schemaVersion: 1,
    updateBytes: 64,
    ...extra,
  };
}

const { naman, priya, asha } = HISTORY_ACTORS;

/** Newest first, as the server sends them. */
export function seedHistory(): Record<string, HistoryEntry[]> {
  return {
    [DOC_IDS.launch]: [
      entry(12, '2026-11-10T11:41:55.321Z', naman, 'text_inserted', { insertedChars: 40 }),
      entry(11, '2026-11-10T11:38:10.100Z', naman, 'paste', {
        insertedChars: 128,
        deletedChars: 12,
        clientHint: 'paste',
      }),
      entry(
        10,
        '2026-11-10T11:30:02.987Z',
        naman,
        'text_inserted',
        { insertedChars: 22 },
        {
          clientOccurredAt: '2026-11-10T11:29:58.000Z',
        },
      ),
      entry(9, '2026-11-10T11:20:00.000Z', priya, 'paste', { insertedChars: 900 }),
      entry(8, '2026-11-10T11:05:30.500Z', priya, 'text_replaced', {
        insertedChars: 15,
        deletedChars: 9,
      }),
      entry(7, '2026-11-10T10:59:00.000Z', priya, 'page_settings_changed', {
        pageSettings: { marginLeft: { from: 25.4, to: 30 } },
      }),
      entry(6, '2026-11-10T10:40:12.000Z', asha, 'image_inserted', {
        insertedBlocks: { image: 1 },
      }),
      entry(5, '2026-11-10T10:30:00.000Z', asha, 'formatting_changed', { formatChanges: 3 }),
      entry(4, '2026-11-09T15:00:00.000Z', priya, 'text_deleted', { deletedChars: 31 }),
      entry(3, '2026-11-09T14:55:00.000Z', priya, 'text_inserted', { insertedChars: 77 }),
      entry(2, '2026-11-09T14:50:00.000Z', priya, 'checkpoint', {}),
      entry(1, '2026-11-09T14:00:00.000Z', asha, 'baseline', {}),
    ],
  };
}

export function seedHistoryEvents(): Record<string, HistoryEvent[]> {
  return {
    [DOC_IDS.launch]: [
      {
        id: 'ev3',
        at: '2026-11-10T11:10:00.000Z',
        action: 'snapshot.restored',
        actorName: 'Asha Rao',
        actorKind: 'user',
      },
      {
        id: 'ev2',
        at: '2026-11-09T16:00:00.000Z',
        action: 'share.created',
        actorName: 'Asha Rao',
        actorKind: 'user',
      },
      {
        id: 'ev1',
        at: '2026-11-09T14:30:00.000Z',
        action: 'widget.exploded',
        actorName: null,
        actorKind: 'system',
      },
    ],
  };
}

/** What the revision's diff shows: three unchanged lines of context and one change. */
export function revisionDiff(revision: number) {
  return [
    { op: 'equal' as const, text: 'Summary' },
    ...Array.from({ length: 6 }, (_, i) => ({
      op: 'equal' as const,
      text: `Unchanged paragraph ${i + 1}`,
    })),
    { op: 'delete' as const, text: `Old sentence before revision ${revision}.` },
    { op: 'insert' as const, text: `New sentence from revision ${revision}.` },
    { op: 'equal' as const, text: 'Closing paragraph' },
  ];
}

export function revisionContent(revision: number): unknown {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Summary' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `New sentence from revision ${revision}.` }],
      },
    ],
  };
}
