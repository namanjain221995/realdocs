/**
 * The document surface: the one place in the web app that runs the
 * collaborative editor of `@realtimedocs/editor`.
 *
 * It owns one collaboration session per open document and principal, renders
 * the editor (or the read-only surface, following the role the server reports
 * live), and puts the session's indicator and participants into the header
 * slots the page hands in. Everything the page needs to know about the
 * session leaves through `onStatusChange`.
 *
 * Local recovery: the session keeps unsent changes on this device only for a
 * signed-in account (`access.accountId`). A share-link guest has no account
 * id, so nothing of the document is written to this browser for them.
 */
import '@realtimedocs/editor/styles.css';
import type {
  AccessInfo,
  ConnectionState,
  EffectiveRole,
  SaveState,
} from '@realtimedocs/contracts';
import {
  type CollabSession,
  createCollabSession,
  DocumentEditor,
  installBeforeUnloadGuard,
  ParticipantStack,
  SessionBanners,
  SessionStatusIndicator,
  type SessionStatus,
  useSessionSelector,
} from '@realtimedocs/editor';
import { Skeleton } from '@realtimedocs/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../lib/api';
import type { DisplayPreferences } from '../../lib/displayPreferences';
import { readFollowLatest, writeFollowLatest } from '../../lib/displayPreferences';

/** What the document screen needs to know about the live session. */
export interface EditorMountStatus {
  connection: ConnectionState;
  save: SaveState;
  /** Role as resolved by the server for this connection. */
  role: EffectiveRole | null;
  canEdit: boolean;
  generation: number | null;
  /** Local changes the server has not durably acknowledged yet. */
  pendingChanges: number;
  /**
   * Recovery drafts this session has set aside so far: unsent work that was
   * kept instead of being published (access removed, snapshot restored).
   */
  draftIds: readonly string[];
}

export interface EditorMountProps {
  documentId: string;
  /** `DocumentSummary.access` as last fetched. The live role comes from the session. */
  access: AccessInfo;
  /** Title for recovery drafts kept by this session. */
  documentTitle?: string;
  /** The viewer's own font scale, reading width and tone. Never written to the document. */
  displayPreferences: DisplayPreferences;
  /** Header element for the connection and save indicator; the mount portals into it. */
  statusSlot: HTMLElement | null;
  /** Header element for the participant avatars; the mount portals into it. */
  participantsSlot: HTMLElement | null;
  /** Reading mode: read-only presentation that always follows the latest changes. */
  reading?: boolean;
  /** Narrow header: ask for the compact indicator. */
  compact?: boolean;
  /** Connection, save state, role, generation or the list of kept drafts changed. */
  onStatusChange?: (status: EditorMountStatus) => void;
  /** "Open draft" was chosen on a recovery-draft notice. */
  onOpenDraft?: (draftId: string) => void;
}

/**
 * One session per document and account. Created in an effect (not during
 * render) so that React's development double-mount destroys the first session
 * and starts a clean second one instead of reusing a destroyed object.
 */
function useCollabSession(
  documentId: string,
  accountId: string | null,
  documentTitle: string | undefined,
): CollabSession | null {
  const [session, setSession] = useState<CollabSession | null>(null);
  const title = useRef(documentTitle);
  useEffect(() => {
    title.current = documentTitle;
  }, [documentTitle]);

  useEffect(() => {
    const created = createCollabSession({
      api,
      documentId,
      // Null for share-link guests: the session then never touches device storage.
      accountId,
      documentTitle: title.current,
    });
    // Asks before the tab closes while changes have not reached the server.
    const removeGuard = installBeforeUnloadGuard(created);
    setSession(created);
    return () => {
      removeGuard();
      created.destroy();
      setSession(null);
    };
  }, [documentId, accountId]);

  return session;
}

type LiveStatus = Omit<EditorMountStatus, 'draftIds'> & { noticeDraftIds: string };

const selectLive = (status: SessionStatus): LiveStatus => ({
  connection: status.connection,
  save: status.save,
  role: status.role,
  canEdit: status.canEdit,
  generation: status.generation,
  pendingChanges: status.pendingChanges,
  noticeDraftIds: status.notices.flatMap((notice) => notice.draftId ?? []).join(' '),
});

/** The page is told about changes of state, not about every acknowledged keystroke. */
const sameLive = (a: LiveStatus, b: LiveStatus): boolean =>
  a.connection === b.connection &&
  a.save === b.save &&
  a.role === b.role &&
  a.canEdit === b.canEdit &&
  a.generation === b.generation &&
  a.pendingChanges > 0 === b.pendingChanges > 0 &&
  a.noticeDraftIds === b.noticeDraftIds;

const selectCanEdit = (status: SessionStatus): boolean => status.canEdit;

/** Forwards the session's state to the page. Renders nothing. */
function StatusReporter({
  session,
  onStatusChange,
}: {
  session: CollabSession;
  onStatusChange: (status: EditorMountStatus) => void;
}) {
  const live = useSessionSelector(session, selectLive, sameLive);
  // A dismissed notice leaves the status, but its draft still exists: remember every id seen.
  const drafts = useRef(new Set<string>());
  useEffect(() => {
    for (const id of live.noticeDraftIds.split(' ')) if (id) drafts.current.add(id);
    const { noticeDraftIds: _ids, ...rest } = live;
    onStatusChange({ ...rest, draftIds: [...drafts.current] });
  }, [live, onStatusChange]);
  return null;
}

/**
 * Address links are handed to the system (a mail or phone app) in place;
 * opening them in a new tab would only leave an empty tab behind. Web links
 * are left to the editor, which opens them in a new tab without an opener or
 * a referrer.
 */
function openLink(href: string): boolean {
  if (!/^(mailto|tel):/i.test(href)) return false;
  window.location.assign(href);
  return true;
}

function Surface({
  session,
  access,
  displayPreferences,
  reading,
  onOpenDraft,
}: {
  session: CollabSession;
  access: AccessInfo;
  displayPreferences: DisplayPreferences;
  reading: boolean;
  onOpenDraft?: (draftId: string) => void;
}) {
  const canEdit = useSessionSelector(session, selectCanEdit);
  // Follow Latest is a reader's preference: remembered in this browser for
  // people who read (viewers), and simply off until chosen for people who write.
  const [follow, setFollow] = useState(() => access.role === 'viewer' && readFollowLatest());
  const changeFollow = useCallback(
    (value: boolean) => {
      setFollow(value);
      if (!session.getStatus().canEdit) writeFollowLatest(value);
    },
    [session],
  );

  return (
    <div className="doc-editor" data-testid="editor-mount">
      <SessionBanners session={session} onOpenDraft={onOpenDraft} />
      <DocumentEditor
        session={session}
        api={api}
        // The toolbar appears and disappears with the role the server reports, live.
        variant={canEdit && !reading ? 'editor' : 'viewer'}
        display={displayPreferences}
        followLatest={follow || reading}
        onFollowLatestChange={changeFollow}
        onOpenLink={openLink}
      />
    </div>
  );
}

export function EditorMount({
  documentId,
  access,
  documentTitle,
  displayPreferences,
  reading = false,
  statusSlot,
  participantsSlot,
  compact = false,
  onStatusChange,
  onOpenDraft,
}: EditorMountProps) {
  const session = useCollabSession(documentId, access.accountId, documentTitle);

  if (!session) {
    return (
      <div className="doc-editor" aria-busy="true">
        <div className="doc-editor__loading" aria-hidden="true">
          <Skeleton width="55%" height={26} />
          <Skeleton lines={4} style={{ marginTop: 24 }} />
        </div>
      </div>
    );
  }

  return (
    <>
      {statusSlot
        ? createPortal(<SessionStatusIndicator session={session} compact={compact} />, statusSlot)
        : null}
      {participantsSlot
        ? createPortal(
            <ParticipantStack session={session} max={compact ? 3 : 5} />,
            participantsSlot,
          )
        : null}
      {onStatusChange ? <StatusReporter session={session} onStatusChange={onStatusChange} /> : null}
      <Surface
        session={session}
        access={access}
        displayPreferences={displayPreferences}
        reading={reading}
        onOpenDraft={onOpenDraft}
      />
    </>
  );
}
