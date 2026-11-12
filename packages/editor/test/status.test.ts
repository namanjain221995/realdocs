// @vitest-environment node
import { ApiError } from '@realtimedocs/contracts';
import { describe, expect, it } from 'vitest';
import { RECONNECT_BACKOFF, backoffDelay } from '../src/collab/backoff';
import {
  deriveStatus,
  initialStatusModel,
  isTerminalState,
  mapAccessChange,
  mapAuthFailure,
  mapCloseEvent,
  mapTicketError,
  sameStatus,
  type StatusModel,
} from '../src/collab/status';

function model(patch: Partial<StatusModel>): StatusModel {
  return { ...initialStatusModel(), ...patch };
}

const editorLive: Partial<StatusModel> = {
  link: 'live',
  everLive: true,
  ready: true,
  role: 'editor',
  generation: 1,
};

describe('status model', () => {
  it('starts as connecting, not ready, not editable', () => {
    const status = deriveStatus(initialStatusModel());
    expect(status).toMatchObject({
      connection: 'connecting',
      save: 'read_only',
      canEdit: false,
      ready: false,
      pendingChanges: 0,
      role: null,
    });
  });

  it('keeps connection and save state independent', () => {
    expect(deriveStatus(model(editorLive))).toMatchObject({ connection: 'live', save: 'saved' });
    expect(deriveStatus(model({ ...editorLive, n: 3, acked: 2 }))).toMatchObject({
      connection: 'live',
      save: 'saving',
      pendingChanges: 1,
    });
    expect(
      deriveStatus(model({ ...editorLive, link: 'waiting', reconnectAttempt: 1, n: 3, acked: 2 })),
    ).toMatchObject({ connection: 'reconnecting', save: 'pending' });
    expect(
      deriveStatus(model({ ...editorLive, link: 'waiting', reconnectAttempt: 1 })),
    ).toMatchObject({
      connection: 'reconnecting',
      save: 'saved',
    });
  });

  it('never derives saved from the socket or sync flags', () => {
    // Live, synced, nothing unsynced — but the latest change is not acknowledged.
    const status = deriveStatus(model({ ...editorLive, n: 1, acked: 0, unsynced: false }));
    expect(status.save).toBe('saving');
    // A refused update is pending, not "saving", even while live.
    expect(deriveStatus(model({ ...editorLive, n: 1, acked: 0, refused: true })).save).toBe(
      'pending',
    );
  });

  it('reports save errors only while changes are pending', () => {
    const error = { code: 'storage_unavailable', retrying: true } as const;
    const failing = deriveStatus(model({ ...editorLive, n: 2, acked: 1, saveError: error }));
    expect(failing.save).toBe('error');
    expect(failing.saveError).toEqual(error);
    const recovered = deriveStatus(model({ ...editorLive, n: 2, acked: 2, saveError: error }));
    expect(recovered.save).toBe('saved');
    expect(recovered.saveError).toBeNull();
  });

  it('shows offline when the browser reports no network', () => {
    expect(deriveStatus(model({ ...editorLive, link: 'waiting', online: false })).connection).toBe(
      'offline',
    );
    // A working connection wins over a wrong offline hint.
    expect(deriveStatus(model({ ...editorLive, online: false })).connection).toBe('live');
  });

  it('reports viewers as read_only and never editable', () => {
    const status = deriveStatus(model({ ...editorLive, role: 'viewer' }));
    expect(status).toMatchObject({ save: 'read_only', canEdit: false });
  });

  it('treats degraded persistence as pending', () => {
    const status = deriveStatus(
      model({ ...editorLive, n: 1, acked: 0, persistenceDegraded: true }),
    );
    expect(status).toMatchObject({ save: 'pending', persistenceDegraded: true, canEdit: true });
  });

  it('is editable offline only with a local replica', () => {
    const offline: Partial<StatusModel> = { role: 'editor', link: 'waiting', reconnectAttempt: 2 };
    expect(deriveStatus(model(offline)).canEdit).toBe(false);
    expect(deriveStatus(model({ ...offline, hasLocalReplica: true })).canEdit).toBe(true);
  });

  it('terminal states stop editing and override the connection state', () => {
    for (const terminal of [
      'access_expired',
      'access_revoked',
      'update_required',
      'document_unavailable',
    ] as const) {
      const status = deriveStatus(model({ ...editorLive, link: 'idle', terminal }));
      expect(status.connection).toBe(terminal);
      expect(status.canEdit).toBe(false);
      expect(isTerminalState(status.connection)).toBe(true);
    }
    const withWork = deriveStatus(
      model({ ...editorLive, link: 'idle', terminal: 'access_revoked', n: 2, acked: 1 }),
    );
    expect(withWork.save).toBe('pending');
    expect(isTerminalState('live')).toBe(false);
  });

  it('sameStatus detects every visible change', () => {
    const base = deriveStatus(model(editorLive));
    expect(sameStatus(base, deriveStatus(model(editorLive)))).toBe(true);
    expect(sameStatus(base, deriveStatus(model({ ...editorLive, n: 1 })))).toBe(false);
    expect(sameStatus(base, deriveStatus(model({ ...editorLive, role: 'admin' })))).toBe(false);
    const participant = {
      id: 'a',
      name: 'A',
      color: '#112233',
      role: 'editor',
      kind: 'user',
    } as const;
    expect(
      sameStatus(base, deriveStatus(model({ ...editorLive, participants: [participant] }))),
    ).toBe(false);
    expect(
      sameStatus(
        deriveStatus(model({ ...editorLive, participants: [participant] })),
        deriveStatus(model({ ...editorLive, participants: [{ ...participant }] })),
      ),
    ).toBe(true);
  });
});

describe('failure mapping', () => {
  const api = (code: ConstructorParameters<typeof ApiError>[0], extra = {}) =>
    new ApiError(code, 'x', extra);

  it('maps ticket errors to terminal states', () => {
    for (const code of ['share_revoked', 'forbidden', 'not_found'] as const) {
      expect(mapTicketError(api(code))).toEqual({ kind: 'terminal', state: 'access_revoked' });
    }
    for (const code of ['share_expired', 'session_expired', 'unauthenticated'] as const) {
      expect(mapTicketError(api(code))).toEqual({ kind: 'terminal', state: 'access_expired' });
    }
    expect(mapTicketError(api('update_required'))).toEqual({
      kind: 'terminal',
      state: 'update_required',
    });
    expect(mapTicketError(api('document_trashed'))).toEqual({
      kind: 'terminal',
      state: 'document_unavailable',
    });
    expect(mapTicketError(api('generation_mismatch'))).toEqual({ kind: 'generation' });
  });

  it('keeps retrying transient ticket errors', () => {
    for (const code of [
      'network_error',
      'server_busy',
      'storage_unavailable',
      'internal',
    ] as const) {
      expect(mapTicketError(api(code))).toEqual({ kind: 'retry' });
    }
    expect(mapTicketError(api('rate_limited', { retryAfterSeconds: 7 }))).toEqual({
      kind: 'retry',
      retryAfterMs: 7000,
    });
    expect(mapTicketError(new Error('boom'))).toEqual({ kind: 'retry' });
  });

  it('maps authentication failures', () => {
    expect(mapAuthFailure('update_required')).toEqual({
      kind: 'terminal',
      state: 'update_required',
    });
    expect(mapAuthFailure('document_unavailable')).toEqual({
      kind: 'terminal',
      state: 'document_unavailable',
    });
    expect(mapAuthFailure('generation_mismatch')).toEqual({ kind: 'generation' });
    // Not precise enough: the next ticket request decides.
    for (const reason of [
      'access_denied',
      'ticket_invalid',
      'ticket_expired',
      'server_busy',
      '?',
    ]) {
      expect(mapAuthFailure(reason)).toEqual({ kind: 'retry' });
    }
  });

  it('maps access messages and close events', () => {
    expect(mapAccessChange('revoked')).toBe('access_revoked');
    expect(mapAccessChange('expired')).toBe('access_expired');
    expect(mapAccessChange('session_ended')).toBe('access_expired');
    expect(mapAccessChange('document_unavailable')).toBe('document_unavailable');
    expect(mapAccessChange('role_changed')).toBeNull();

    expect(mapCloseEvent({ code: 4403, reason: 'access_revoked' })).toEqual({
      kind: 'terminal',
      state: 'access_revoked',
    });
    expect(mapCloseEvent({ code: 1000, reason: 'access_expired' })).toEqual({
      kind: 'terminal',
      state: 'access_expired',
    });
    expect(mapCloseEvent({ code: 4409, reason: '' })).toEqual({ kind: 'generation' });
    // Hocuspocus uses 4401 for malformed frames and 4403 as a generic code:
    // without the contract's reason they only lead to a ticket request.
    expect(mapCloseEvent({ code: 4401, reason: 'Unauthorized' })).toEqual({ kind: 'retry' });
    expect(mapCloseEvent({ code: 4403, reason: 'Forbidden' })).toEqual({ kind: 'retry' });
    expect(mapCloseEvent({ code: 1006 })).toEqual({ kind: 'retry' });
    expect(mapCloseEvent(undefined)).toEqual({ kind: 'retry' });
  });
});

describe('backoff', () => {
  it('grows exponentially, is capped and jittered', () => {
    const low = () => 0;
    const high = () => 1;
    expect(backoffDelay(1, RECONNECT_BACKOFF, low)).toBe(200);
    expect(backoffDelay(1, RECONNECT_BACKOFF, high)).toBe(400);
    expect(backoffDelay(2, RECONNECT_BACKOFF, high)).toBe(640);
    expect(backoffDelay(4, RECONNECT_BACKOFF, high)).toBe(1638);
    expect(backoffDelay(50, RECONNECT_BACKOFF, high)).toBe(30_000);
    expect(backoffDelay(50, RECONNECT_BACKOFF, low)).toBe(15_000);
    const samples = new Set(Array.from({ length: 50 }, () => backoffDelay(3, RECONNECT_BACKOFF)));
    expect(samples.size).toBeGreaterThan(5);
    for (const sample of samples) {
      expect(sample).toBeGreaterThanOrEqual(512);
      expect(sample).toBeLessThanOrEqual(1024);
    }
  });
});
