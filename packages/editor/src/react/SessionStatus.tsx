/**
 * Session chrome: status indicator, participants, banners.
 *
 * Connection state and save state are always shown as two separate facts
 * ("Live · Saved"); neither is derived from the other.
 */
import type { ConnectionState, SaveState } from '@realtimedocs/contracts';
import { AvatarStack, Banner, Button, StatusDot, Tooltip, cx, type Tone } from '@realtimedocs/ui';
import { Check, CircleAlert, CloudOff, Eye, LoaderCircle, RotateCw } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { CollabSession } from '../collab/session';
import { isTerminalState, type SessionNotice, type SessionStatus } from '../collab/status';
import { useSessionSelector } from './sessionHooks';

const CONNECTION: Record<
  ConnectionState,
  { label: string; tone: Tone; pulse: boolean; help: string }
> = {
  connecting: {
    label: 'Connecting…',
    tone: 'info',
    pulse: true,
    help: 'Opening a secure connection to the server.',
  },
  live: { label: 'Live', tone: 'success', pulse: false, help: 'Changes arrive as they happen.' },
  reconnecting: {
    label: 'Reconnecting…',
    tone: 'warning',
    pulse: true,
    help: 'The connection was lost. Trying again automatically.',
  },
  offline: {
    label: 'Offline',
    tone: 'danger',
    pulse: false,
    help: 'This device has no network connection. Changes are kept here until it returns.',
  },
  access_expired: {
    label: 'Access expired',
    tone: 'danger',
    pulse: false,
    help: 'Your link or session has expired.',
  },
  access_revoked: {
    label: 'Access revoked',
    tone: 'danger',
    pulse: false,
    help: 'Your access to this document was revoked.',
  },
  update_required: {
    label: 'Update required',
    tone: 'warning',
    pulse: false,
    help: 'A newer version of the app is needed to open this document.',
  },
  document_unavailable: {
    label: 'Unavailable',
    tone: 'danger',
    pulse: false,
    help: 'This document was moved to the trash or deleted.',
  },
};

const SAVE: Record<SaveState, { label: string; help: string; icon: ReactNode }> = {
  saved: {
    label: 'Saved',
    help: 'The server confirmed that every change is stored.',
    icon: <Check size={14} aria-hidden="true" />,
  },
  saving: {
    label: 'Saving…',
    help: 'Waiting for the server to confirm that the latest changes are stored.',
    icon: <LoaderCircle size={14} className="rd-spin" aria-hidden="true" />,
  },
  pending: {
    label: 'Changes pending',
    help: 'Some changes are only on this device. They are sent when the server can accept them.',
    icon: <CloudOff size={14} aria-hidden="true" />,
  },
  error: {
    label: 'Not saved',
    help: 'The server could not store the latest changes. They are kept here and retried.',
    icon: <CircleAlert size={14} aria-hidden="true" />,
  },
  read_only: {
    label: 'View only',
    help: 'You can read this document but not change it.',
    icon: <Eye size={14} aria-hidden="true" />,
  },
};

interface IndicatorView {
  connection: ConnectionState;
  save: SaveState;
  roleKnown: boolean;
  retrying: boolean;
}

const selectIndicator = (status: SessionStatus): IndicatorView => ({
  connection: status.connection,
  save: status.save,
  roleKnown: status.role !== null,
  retrying: status.nextRetryAt !== null,
});
const sameIndicator = (a: IndicatorView, b: IndicatorView): boolean =>
  a.connection === b.connection &&
  a.save === b.save &&
  a.roleKnown === b.roleKnown &&
  a.retrying === b.retrying;

/**
 * "Saved" is displayed once it has held for this long. While someone types,
 * the true state alternates between saving and saved several times a second;
 * showing every flip would flicker. The delay only ever shows "Saving…" a
 * little longer, never "Saved" early.
 */
export const SAVED_SETTLE_MS = 400;

interface IndicatorStore {
  get: () => IndicatorView;
  subscribe: (listener: () => void) => () => void;
}

function createIndicatorStore(session: CollabSession): IndicatorStore {
  let published = selectIndicator(session.getStatus());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stop: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: IndicatorView): void => {
    published = next;
    for (const listener of [...listeners]) listener();
  };
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const onChange = (): void => {
    const next = selectIndicator(session.getStatus());
    if (sameIndicator(next, published)) {
      cancel();
      return;
    }
    const settling =
      published.save === 'saving' &&
      next.save === 'saved' &&
      next.connection === published.connection;
    if (settling) {
      timer ??= setTimeout(() => {
        timer = null;
        const latest = selectIndicator(session.getStatus());
        if (!sameIndicator(latest, published)) publish(latest);
      }, SAVED_SETTLE_MS);
      return;
    }
    cancel();
    publish(next);
  };

  return {
    get: () => published,
    subscribe(listener) {
      if (listeners.size === 0) {
        published = selectIndicator(session.getStatus());
        stop = session.subscribe(onChange);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop?.();
          stop = null;
          cancel();
        }
      };
    },
  };
}

/** Details that change often; read only while a tooltip is open. */
function LiveDetails({ session, kind }: { session: CollabSession; kind: 'connection' | 'save' }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const status = session.getStatus();
  if (kind === 'connection') {
    const seconds =
      status.nextRetryAt === null
        ? null
        : Math.max(0, Math.ceil((status.nextRetryAt - Date.now()) / 1000));
    return (
      <>
        {CONNECTION[status.connection].help}
        {seconds !== null
          ? ` Next attempt in ${seconds}s (attempt ${status.reconnectAttempt}).`
          : ''}
      </>
    );
  }
  return (
    <>
      {SAVE[status.save].help}
      {status.pendingChanges > 0
        ? ` ${status.pendingChanges} change${status.pendingChanges === 1 ? '' : 's'} waiting.`
        : ''}
      {status.lastSavedAt !== null
        ? ` Last confirmed at ${new Date(status.lastSavedAt).toLocaleTimeString()}.`
        : ''}
    </>
  );
}

/** "Live · Saved" style indicator with separate connection and save parts, tooltips and retry. */
export function SessionStatusIndicator({
  session,
  compact = false,
}: {
  session: CollabSession;
  compact?: boolean;
}) {
  const store = useMemo(() => createIndicatorStore(session), [session]);
  const view = useSyncExternalStore(store.subscribe, store.get, store.get);
  const connection = CONNECTION[view.connection];
  const save = SAVE[view.save];
  const canRetry = view.connection === 'reconnecting' || view.connection === 'offline';
  // Until the server reported a role there is nothing truthful to say about saving.
  const hideSave = !view.roleKnown && view.save !== 'pending' && view.save !== 'error';

  return (
    <div className={cx('rd-status', compact && 'rd-status--compact')}>
      <Tooltip content={<LiveDetails session={session} kind="connection" />} side="bottom">
        <span
          className="rd-status__part"
          data-testid="rd-status-connection"
          data-state={view.connection}
          role="status"
          aria-live="polite"
          tabIndex={0}
        >
          <StatusDot tone={connection.tone} pulse={connection.pulse} />
          <span className={cx('rd-status__label', compact && 'rd-visually-hidden')}>
            {connection.label}
          </span>
        </span>
      </Tooltip>
      <Tooltip content={<LiveDetails session={session} kind="save" />} side="bottom">
        <span
          className="rd-status__part"
          data-testid="rd-status-save"
          data-state={view.save}
          hidden={hideSave}
          tabIndex={hideSave ? -1 : 0}
        >
          {save.icon}
          <span className={cx('rd-status__label', compact && 'rd-visually-hidden')}>
            {save.label}
          </span>
        </span>
      </Tooltip>
      {canRetry ? (
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<RotateCw size={14} />}
          onClick={() => session.retryNow()}
          data-testid="rd-status-retry"
        >
          {compact ? <span className="rd-visually-hidden">Retry now</span> : 'Retry now'}
        </Button>
      ) : null}
    </div>
  );
}

const selectParticipants = (status: SessionStatus) => status.participants;
const selectSelfId = (status: SessionStatus) => status.self?.id ?? null;

const ROLE_LABEL = { viewer: 'viewing', editor: 'editing', admin: 'editing (admin)' } as const;

/** Avatars of server-attested participants. */
export function ParticipantStack({ session, max = 4 }: { session: CollabSession; max?: number }) {
  const participants = useSessionSelector(session, selectParticipants);
  const selfId = useSessionSelector(session, selectSelfId);
  if (participants.length === 0) return null;
  return (
    <AvatarStack
      className="rd-participants"
      data-testid="rd-participants"
      max={max}
      people={participants.map((participant) => ({
        id: participant.id,
        name: participant.name,
        color: /^#[0-9a-f]{6}$/i.test(participant.color) ? participant.color : undefined,
        title: `${participant.name}${participant.roleLabel ? ` — ${participant.roleLabel}` : ''}${participant.id === selfId ? ' (you)' : ''} · ${ROLE_LABEL[participant.role]}`,
      }))}
    />
  );
}

const TERMINAL: Record<string, { tone: Tone; title: string; text: string }> = {
  access_revoked: {
    tone: 'danger',
    title: 'Access revoked',
    text: 'Your access to this document was revoked. Nothing new will load. Content you already received is not erased from this screen.',
  },
  access_expired: {
    tone: 'warning',
    title: 'Access expired',
    text: 'Your link or session has expired. Sign in again or ask for a new link to continue.',
  },
  update_required: {
    tone: 'warning',
    title: 'Update required',
    text: 'This document uses features of a newer version. Reload the page or update the app; it is not opened here so nothing can be lost.',
  },
  document_unavailable: {
    tone: 'danger',
    title: 'Document unavailable',
    text: 'This document was moved to the trash or deleted.',
  },
};

const NOTICE_TONE: Record<SessionNotice['kind'], Tone> = {
  restored: 'info',
  role_changed: 'info',
  draft_saved: 'warning',
  persistence_degraded: 'warning',
  persistence_restored: 'success',
};

const NOTICE_TITLE: Record<SessionNotice['kind'], string> = {
  restored: 'Document restored',
  role_changed: 'Access changed',
  draft_saved: 'Recovery draft kept',
  persistence_degraded: 'Saving is delayed',
  persistence_restored: 'Saving resumed',
};

const selectNotices = (status: SessionStatus) => status.notices;
const selectConnection = (status: SessionStatus) => status.connection;

/** Banners for notices (restore, role change, drafts, degraded persistence) and terminal states. */
export function SessionBanners({
  session,
  onOpenDraft,
}: {
  session: CollabSession;
  onOpenDraft?: (draftId: string) => void;
}) {
  const notices = useSessionSelector(session, selectNotices);
  const connection = useSessionSelector(session, selectConnection);
  const terminal = isTerminalState(connection) ? TERMINAL[connection] : undefined;
  if (!terminal && notices.length === 0) return null;
  return (
    <div className="rd-banners" data-testid="rd-banners">
      {terminal ? (
        <Banner
          tone={terminal.tone}
          title={terminal.title}
          data-testid="rd-banner-terminal"
          data-state={connection}
        >
          {terminal.text}
        </Banner>
      ) : null}
      {notices.map((notice) => (
        <Banner
          key={notice.id}
          tone={NOTICE_TONE[notice.kind]}
          title={NOTICE_TITLE[notice.kind]}
          data-testid="rd-banner-notice"
          data-kind={notice.kind}
          onDismiss={() => session.dismissNotice(notice.id)}
          action={
            notice.draftId && onOpenDraft ? (
              <Button
                size="sm"
                onClick={() => {
                  if (notice.draftId) onOpenDraft(notice.draftId);
                }}
              >
                Open draft
              </Button>
            ) : undefined
          }
        >
          {notice.message}
        </Banner>
      ))}
    </div>
  );
}
