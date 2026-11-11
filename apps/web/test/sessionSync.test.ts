import { describe, expect, it } from 'vitest';
import type { EditorMountStatus } from '../src/features/document/EditorMount';
import {
  accessEndReason,
  shouldRefetchSummary,
  summaryRelevant,
} from '../src/features/document/sessionSync';

const SUMMARY = { generation: 2, access: { role: 'editor' } } as const;

function status(overrides: Partial<EditorMountStatus> = {}): EditorMountStatus {
  return {
    connection: 'live',
    save: 'saved',
    role: 'editor',
    canEdit: true,
    generation: 2,
    pendingChanges: 0,
    draftIds: [],
    ...overrides,
  };
}

describe('shouldRefetchSummary', () => {
  it('leaves the summary alone while the session agrees with it', () => {
    expect(shouldRefetchSummary(null, summaryRelevant(status()), SUMMARY)).toBe(false);
    expect(
      shouldRefetchSummary(null, summaryRelevant(status({ connection: 'reconnecting' })), SUMMARY),
    ).toBe(false);
    // Before the first sync the session knows neither role nor generation.
    expect(
      shouldRefetchSummary(
        null,
        summaryRelevant(status({ connection: 'connecting', role: null, generation: null })),
        SUMMARY,
      ),
    ).toBe(false);
  });

  it('reads the summary again when the document was trashed or deleted', () => {
    expect(
      shouldRefetchSummary(
        null,
        summaryRelevant(status({ connection: 'document_unavailable' })),
        SUMMARY,
      ),
    ).toBe(true);
  });

  it('does not ask the server why access ended: the session already said so', () => {
    for (const connection of ['access_revoked', 'access_expired'] as const) {
      expect(shouldRefetchSummary(null, summaryRelevant(status({ connection })), SUMMARY)).toBe(
        false,
      );
    }
  });

  it('reads the summary again when the role or the generation changed', () => {
    expect(shouldRefetchSummary(null, summaryRelevant(status({ role: 'viewer' })), SUMMARY)).toBe(
      true,
    );
    expect(shouldRefetchSummary(null, summaryRelevant(status({ generation: 3 })), SUMMARY)).toBe(
      true,
    );
  });

  it('asks once per change, not once per status update', () => {
    const downgraded = summaryRelevant(status({ role: 'viewer' }));
    expect(shouldRefetchSummary(null, downgraded, SUMMARY)).toBe(true);
    // The same facts reported again (typing, presence, save state) do nothing.
    expect(shouldRefetchSummary(downgraded, downgraded, SUMMARY)).toBe(false);
    expect(
      shouldRefetchSummary(
        downgraded,
        summaryRelevant(status({ role: 'viewer', save: 'read_only', pendingChanges: 0 })),
        SUMMARY,
      ),
    ).toBe(false);
  });

  it('ignores save state and pending changes', () => {
    const relevant = summaryRelevant(status({ save: 'saving', pendingChanges: 4 }));
    expect(relevant).toEqual({ connection: 'live', role: 'editor', generation: 2 });
  });
});

describe('accessEndReason', () => {
  it('names the two ways access can end', () => {
    expect(accessEndReason(status({ connection: 'access_revoked' }))).toBe('access_revoked');
    expect(accessEndReason(status({ connection: 'access_expired' }))).toBe('access_expired');
  });

  it('is null for every state in which the document is still open', () => {
    for (const connection of [
      'connecting',
      'live',
      'reconnecting',
      'offline',
      'update_required',
      'document_unavailable',
    ] as const) {
      expect(accessEndReason(status({ connection }))).toBeNull();
    }
  });
});
