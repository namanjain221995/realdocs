import './document.css';
import { type DocumentSummary, isUuid } from '@realtimedocs/contracts';
import { Banner, Button, Skeleton, useToast } from '@realtimedocs/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { PublicShell } from '../../components/PublicShell';
import { accessFlags } from '../../lib/accessCapabilities';
import { api } from '../../lib/api';
import { useDisplayPreferences } from '../../lib/displayPreferences';
import { useReadingMode } from '../../lib/readingMode';
import { useWakeLock } from '../../lib/wakeLock';
import { errorMessage, errorScreenKind } from '../../lib/errors';
import { useDocumentTitle, useMediaQuery, useNow, useOnlineStatus } from '../../lib/hooks';
import { documentCapabilities } from '../../lib/permissions';
import { queryKeys } from '../../lib/queryKeys';
import { useSession } from '../../lib/session';
import { formatDateTime, formatRelativeTime, toEpochMs } from '../../lib/time';
import { useDocumentActions } from '../dashboard/useDocumentActions';
import { CaptureStatus } from './CaptureStatus';
import { DraftPreviewDialog } from '../drafts/DraftPreviewDialog';
import { AccessEnded, type AccessEndedInfo } from './AccessEnded';
import { ACCESS_ENDED, DocumentError } from './DocumentError';
import { DocumentHeader, type WorkspacePanel } from './DocumentHeader';
import type { EditorMountStatus } from './EditorMount';
import { OpenInDesktopDialog, useDesktopHandoff } from './OpenInDesktop';
import { ReadingBar } from './ReadingBar';
import {
  accessEndReason,
  shouldRefetchSummary,
  summaryRelevant,
  type SummaryRelevantStatus,
} from './sessionSync';

// The editor (and everything it pulls in) is its own chunk, fetched only once
// the server has confirmed that this visitor may open the document.
const EditorMount = lazy(async () => ({ default: (await import('./EditorMount')).EditorMount }));
const SharingPanel = lazy(async () => ({ default: (await import('./SharingPanel')).SharingPanel }));
const SnapshotsPanel = lazy(async () => ({
  default: (await import('./SnapshotsPanel')).SnapshotsPanel,
}));

function isPanel(value: string | null): value is WorkspacePanel {
  return value === 'share' || value === 'snapshots';
}

/* -------------------------------------------------------------- skeleton */

function WorkspaceSkeleton() {
  return (
    <div className="doc-workspace" data-testid="document-loading">
      <header className="doc-header" aria-hidden="true">
        <div className="doc-header__row">
          <Skeleton width={28} height={28} />
          <Skeleton width="min(320px, 50%)" height={18} />
          <Skeleton width={52} height={20} style={{ marginLeft: 'auto' }} />
          <Skeleton width={72} height={28} />
        </div>
      </header>
      <div className="doc-body">
        <main
          id="main"
          tabIndex={-1}
          className="doc-main"
          aria-busy="true"
          aria-label="Loading document"
        >
          <EditorFallback />
        </main>
      </div>
    </div>
  );
}

function EditorFallback() {
  return (
    <div className="doc-editor" data-testid="editor-loading">
      <div className="doc-editor__loading" aria-hidden="true">
        <Skeleton width="55%" height={26} />
        <Skeleton lines={4} style={{ marginTop: 24 }} />
        <Skeleton lines={3} style={{ marginTop: 24 }} />
      </div>
    </div>
  );
}

function PanelFallback() {
  return (
    <aside className="app-panel" aria-busy="true" aria-label="Loading panel">
      <div className="app-panel-section">
        <Skeleton height={16} width="45%" />
        <Skeleton lines={3} style={{ marginTop: 16 }} />
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------- workspace */

function AccessExpiry({ expiresAt }: { expiresAt: string }) {
  const now = useNow();
  const at = toEpochMs(expiresAt);
  return (
    <span className="doc-statusbar__expiry" title={formatDateTime(at)} data-testid="access-expiry">
      {at > now ? `Your access ends ${formatRelativeTime(at, now)}` : 'Your access has ended'}
    </span>
  );
}

function Workspace({
  document,
  onLeft,
  onAccessEnded,
}: {
  document: DocumentSummary;
  onLeft: () => void;
  onAccessEnded: (info: AccessEndedInfo) => void;
}) {
  const { user } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { preferences } = useDisplayPreferences();
  const { reading, update: updateReading } = useReadingMode();
  const readingOn = reading.enabled;
  const wakeLock = useWakeLock(readingOn);
  const { rename, changeStatus } = useDocumentActions();
  const desktop = useDesktopHandoff(document.id);
  const flags = accessFlags(document.access);
  const narrow = useMediaQuery('(max-width: 639px)');
  // Phone and tablet headers have no room for the indicator's words: icons with tooltips.
  const compactStatus = useMediaQuery('(max-width: 959px)');
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null);
  const [participantsSlot, setParticipantsSlot] = useState<HTMLElement | null>(null);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  useDocumentTitle(document.title);

  const capabilities = documentCapabilities(document, user);
  const requestedPanel = searchParams.get('panel');
  const panel =
    !readingOn && capabilities.canManage && isPanel(requestedPanel) ? requestedPanel : null;
  // Reading mode: large text in the reader's chosen colours, nothing else.
  const shownPreferences = readingOn
    ? {
        ...preferences,
        fontScale: reading.fontScale,
        readingWidth: 'normal' as const,
        tone: reading.light ? ('light' as const) : ('dark' as const),
      }
    : preferences;

  const setPanel = useCallback(
    (next: WorkspacePanel | null) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (next) params.set('panel', next);
          else params.delete('panel');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const leave = useMutation({
    mutationFn: () => api.shares.endGuestSession(document.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.document(document.id) });
      if (user) {
        toast.show({ title: 'You left the shared document' });
        void navigate('/', { replace: true });
      } else {
        onLeft();
      }
    },
    onError: (failure) => {
      toast.show({
        tone: 'danger',
        title: 'Could not leave the document',
        description: errorMessage(failure),
      });
    },
  });

  // A recovery draft is opened where the reader is, so it also works for
  // share-link guests (who have no Settings page and whose drafts exist only
  // in this page's memory).
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);

  // The live session reports access, role and generation changes first.
  const lastSynced = useRef<SummaryRelevantStatus | null>(null);
  // Read through a ref so the callback handed to the editor never changes identity.
  const summaryRef = useRef(document);
  useEffect(() => {
    summaryRef.current = document;
  }, [document]);
  const onAccessEndedRef = useRef(onAccessEnded);
  useEffect(() => {
    onAccessEndedRef.current = onAccessEnded;
  }, [onAccessEnded]);
  const onStatusChange = useCallback(
    (status: EditorMountStatus) => {
      const summary = summaryRef.current;
      const ended = accessEndReason(status);
      if (ended) {
        // Only the session knows why: switch to the dedicated screen right away.
        onAccessEndedRef.current({
          reason: ended,
          via: summary.access.via,
          documentId: summary.id,
          documentTitle: summary.title,
          draftIds: status.draftIds,
        });
        return;
      }
      const relevant = summaryRelevant(status);
      if (shouldRefetchSummary(lastSynced.current, relevant, summary)) {
        // Role, generation, or the document went away: the summary says what to show.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.document(summary.id),
          exact: true,
        });
      }
      lastSynced.current = relevant;
    },
    [queryClient],
  );

  return (
    <div
      className={readingOn ? 'doc-workspace doc-workspace--reading' : 'doc-workspace'}
      data-theme={readingOn ? (reading.light ? 'light' : 'dark') : undefined}
      data-reading={readingOn ? 'true' : undefined}
      data-testid="document-workspace"
      data-panel={panel ?? undefined}
      data-role={document.access.role}
      data-generation={document.generation}
    >
      {readingOn ? (
        <ReadingBar
          title={document.title}
          signedIn={user !== null}
          reading={reading}
          onChange={updateReading}
          wakeLock={wakeLock}
          statusSlotRef={setStatusSlot}
        />
      ) : (
        <DocumentHeader
          document={document}
          capabilities={capabilities}
          signedIn={user !== null}
          narrow={narrow}
          panel={panel}
          onPanel={setPanel}
          onRename={(title) => rename.mutate({ document, title })}
          onOpenInDesktop={desktop.start}
          onPageSetup={() => setPageSetupOpen(true)}
          onLeave={() => leave.mutate()}
          leaving={leave.isPending}
          statusSlotRef={setStatusSlot}
          participantsSlotRef={setParticipantsSlot}
        />
      )}

      {document.status === 'archived' ? (
        <Banner
          tone="info"
          className="doc-banner"
          data-testid="archived-banner"
          action={
            capabilities.canManage ? (
              <Button
                size="sm"
                loading={changeStatus.isPending}
                onClick={() => changeStatus.mutate({ document, change: 'unarchive' })}
              >
                Unarchive
              </Button>
            ) : undefined
          }
        >
          This document is archived, so it is read-only for everyone.
        </Banner>
      ) : null}

      <div className="doc-body">
        <main id="main" tabIndex={-1} className="doc-main">
          <Suspense fallback={<EditorFallback />}>
            <EditorMount
              documentId={document.id}
              access={document.access}
              documentTitle={document.title}
              displayPreferences={shownPreferences}
              reading={readingOn}
              pageSetupOpen={pageSetupOpen}
              onPageSetupOpenChange={setPageSetupOpen}
              statusSlot={statusSlot}
              participantsSlot={participantsSlot}
              compact={compactStatus}
              onStatusChange={onStatusChange}
              onOpenDraft={setOpenDraftId}
            />
          </Suspense>
        </main>
        {panel ? (
          <Suspense fallback={<PanelFallback />}>
            {panel === 'share' ? (
              <SharingPanel document={document} onClose={() => setPanel(null)} />
            ) : flags.canViewHistory ? (
              <SnapshotsPanel document={document} onClose={() => setPanel(null)} />
            ) : null}
          </Suspense>
        ) : null}
      </div>

      {readingOn ? null : (
        <footer className="doc-statusbar">
          <CaptureStatus onOpenInDesktop={flags.canUseDesktop ? desktop.start : undefined} />
          {document.access.expiresAt && document.access.via === 'share_link' ? (
            <AccessExpiry expiresAt={document.access.expiresAt} />
          ) : null}
        </footer>
      )}

      {flags.canUseDesktop ? (
        <OpenInDesktopDialog
          controls={desktop}
          isGuest={capabilities.isGuest}
          onOpenSharing={capabilities.canManage ? () => setPanel('share') : undefined}
        />
      ) : null}
      {openDraftId ? (
        <DraftPreviewDialog
          draft={{ draftId: openDraftId, documentId: document.id, documentTitle: document.title }}
          onClose={() => setOpenDraftId(null)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ page */

/**
 * `/d/:documentId`. Works with and without an account: a share-link guest has
 * `user === null`, sees no dashboard chrome and no administrator controls,
 * and can leave.
 */
export function DocumentPage() {
  const { documentId = '' } = useParams();
  // A different document is a fresh screen: no state carries over.
  return <DocumentScreen key={documentId} documentId={documentId} />;
}

function DocumentScreen({ documentId }: { documentId: string }) {
  const { user } = useSession();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const [left, setLeft] = useState(false);
  // Set when the live session was told that this reader's access is over.
  const [ended, setEnded] = useState<AccessEndedInfo | null>(null);
  const valid = isUuid(documentId);

  const query = useQuery({
    queryKey: queryKeys.document(documentId),
    queryFn: () => api.documents.get(documentId),
    enabled: valid && !left && !ended,
  });

  const onAccessEnded = useCallback(
    (info: AccessEndedInfo) => {
      setEnded(info);
      // Nothing of the document stays cached once access is over.
      queryClient.removeQueries({ queryKey: queryKeys.document(documentId) });
    },
    [queryClient, documentId],
  );

  if (ended) return <AccessEnded info={ended} />;

  if (left) {
    return (
      <PublicShell width="wide">
        <div className="doc-left" data-testid="left-document">
          <DoorOpen aria-hidden="true" />
          <h1>You left the document</h1>
          <p className="app-muted">
            This browser no longer has access to it. To open it again, use the share link you were
            sent.
          </p>
        </div>
      </PublicShell>
    );
  }

  if (!valid) {
    return (
      <DocumentError
        documentId={documentId}
        error={null}
        kind="not_found"
        onRetry={() => undefined}
        retrying={false}
      />
    );
  }

  if (query.isError) {
    const kind = errorScreenKind(query.error, { online });
    // A failed refresh keeps the open document unless the failure says access is over.
    if (!query.data || ACCESS_ENDED.includes(kind)) {
      return (
        <DocumentError
          documentId={documentId}
          error={query.error}
          kind={kind}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      );
    }
  }

  if (!query.data) return <WorkspaceSkeleton />;

  // Remount when the principal changes so nothing from the previous one lingers.
  return (
    <Workspace
      key={`${query.data.document.id}:${user?.id ?? 'guest'}`}
      document={query.data.document}
      onLeft={() => setLeft(true)}
      onAccessEnded={onAccessEnded}
    />
  );
}
