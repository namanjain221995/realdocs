/**
 * Where the document lives inside the panel: the shared editor from
 * `@realtimedocs/editor` in its compact `panel` variant, or one of the empty
 * states (no server, no document, access ended).
 *
 * The session is created by `useDocumentSession` in `PanelApp`, above this
 * component, so collapsing the panel does not end it. What happens here:
 *
 * - reader preferences (text size, reading width, light or dark text) are
 *   passed to the editor as display preferences; they never touch the shared
 *   document. The document background is transparent (`--rd-doc-bg`), so the
 *   panel's own surface, with the opacity the user chose, shows through;
 * - Follow Latest is the user's preference, changed from the header button or
 *   the editor's own control;
 * - a clicked link is handed to the main process, which validates it again
 *   and gives it to the operating system. This page never opens anything.
 */
import {
  DocumentEditor,
  SessionBanners,
  StaticDocument,
  deleteRecoveryDraft,
  loadRecoveryDraftJSON,
  type DisplayPreferences,
  type DocJSON,
} from '@realtimedocs/editor';
import { Button, EmptyState, Spinner, TextField } from '@realtimedocs/ui';
import { FileText, FileX2, Link2, Server } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import type { AppState } from '../../shared/state';
import { attempt, desktop } from '../shared/desktop';
import { endedAccess } from '../shared/labels';
import { useAction } from './PanelApp';
import type { LiveDocument } from './useDocumentSession';

function PasteShareLink({ primary }: { primary: boolean }) {
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!link.trim() || busy) return;
    setBusy(true);
    const message = await attempt(desktop?.connection.openShareLink(link.trim()));
    setBusy(false);
    setError(message);
    // The link carries a secret: do not keep it in the field once it was accepted.
    if (!message) setLink('');
  };

  return (
    <form
      className="rdp-paste"
      onSubmit={(event) => void submit(event)}
      data-testid="rd-paste-form"
    >
      <TextField
        label="Share link"
        hideLabel
        placeholder="Paste a share link (https://…/s/…#…)"
        value={link}
        onChange={(event) => {
          setLink(event.target.value);
          setError(null);
        }}
        error={error ?? undefined}
        prefix={<Link2 />}
        autoComplete="off"
        spellCheck={false}
        data-testid="rd-paste-input"
      />
      <Button
        type="submit"
        variant={primary ? 'primary' : 'secondary'}
        loading={busy}
        data-testid="rd-paste-submit"
      >
        Open
      </Button>
    </form>
  );
}

const ENDED_TEXT = {
  access_revoked: {
    title: 'Access revoked',
    description:
      'The link or session that opened it no longer works, and the session stored on this computer was deleted. Ask the owner for a new link, or open the document from your browser again.',
  },
  access_expired: {
    title: 'Access expired',
    description:
      'The link or session that opened it has ended, and the session stored on this computer was deleted. Ask the owner for a new link, or open the document from your browser again.',
  },
  document_unavailable: {
    title: 'This document is no longer available',
    description:
      'It was moved to the trash or deleted. The session stored on this computer was deleted.',
  },
} as const;

/** A recovery draft: unsent work kept on this device, shown read-only and never published. */
function DraftView({
  draftId,
  live,
  display,
  onClose,
}: {
  draftId: string;
  live: LiveDocument;
  display: Partial<DisplayPreferences>;
  onClose: () => void;
}) {
  const [content, setContent] = useState<DocJSON | null | 'missing'>(null);
  useEffect(() => {
    let current = true;
    loadRecoveryDraftJSON(draftId).then(
      (json) => {
        if (current) setContent(json ?? 'missing');
      },
      () => {
        if (current) setContent('missing');
      },
    );
    return () => {
      current = false;
    };
  }, [draftId]);

  return (
    <div className="rdp-draft" data-testid="rd-draft-view">
      <div className="rdp-draft-bar">
        <span className="rdp-draft-title">
          Recovery draft: your unsent changes. They were not published.
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void deleteRecoveryDraft(draftId).finally(onClose);
          }}
        >
          Delete draft
        </Button>
        <Button size="sm" variant="secondary" data-testid="rd-draft-close" onClick={onClose}>
          Back to the document
        </Button>
      </div>
      <div className="rdp-draft-body">
        {content === null ? (
          <Spinner />
        ) : content === 'missing' ? (
          <p className="rdp-draft-missing">This draft is no longer on this computer.</p>
        ) : (
          <StaticDocument
            content={content}
            api={live.api}
            documentId={live.documentId}
            display={display}
          />
        )}
      </div>
    </div>
  );
}

function LivePanelDocument({ state, live }: { state: AppState; live: LiveDocument }) {
  const run = useAction();
  const { appearance, behaviour } = state;
  const [draftId, setDraftId] = useState<string | null>(null);

  const display = useMemo<Partial<DisplayPreferences>>(
    () => ({
      fontScale: appearance.fontScale,
      readingWidth: appearance.readingWidth,
      // "Light text" is the dark colour scheme of the document, and the other way round.
      tone: appearance.foreground === 'dark' ? 'light' : 'dark',
    }),
    [appearance.fontScale, appearance.readingWidth, appearance.foreground],
  );

  const onOpenLink = useCallback(
    (href: string): boolean => {
      run(desktop?.openExternal(href));
      // Always handled here: the editor must never open a window of its own.
      return true;
    },
    [run],
  );
  const onFollowLatestChange = useCallback(
    (followLatest: boolean) => {
      run(desktop?.preferences.update({ behaviour: { followLatest } }));
    },
    [run],
  );

  return (
    <div
      className="rdp-document"
      data-testid="rd-document"
      data-document-id={live.documentId}
      // The panel surface, with the opacity the user chose, is the background.
      style={{ '--rd-doc-bg': 'transparent' } as CSSProperties}
    >
      <SessionBanners session={live.session} onOpenDraft={setDraftId} />
      {draftId ? (
        <DraftView
          draftId={draftId}
          live={live}
          display={display}
          onClose={() => setDraftId(null)}
        />
      ) : null}
      {/* Kept mounted behind a draft: the live document must not lose its place. */}
      <div className="rdp-document-editor" hidden={draftId !== null}>
        <DocumentEditor
          key={live.key}
          session={live.session}
          api={live.api}
          variant="panel"
          display={display}
          followLatest={behaviour.followLatest}
          onFollowLatestChange={onFollowLatestChange}
          onOpenLink={onOpenLink}
        />
      </div>
    </div>
  );
}

export function DocumentHost({ state, live }: { state: AppState; live: LiveDocument | null }) {
  const { server, session, busy, notice } = state.connection;

  if (busy === 'confirming' && !session) {
    // The question itself is asked by the main process in its own dialog.
    // This page cannot answer it; it only says where to look.
    return (
      <div className="rdp-empty" data-testid="rd-empty-confirming">
        <EmptyState
          compact
          icon={<Server />}
          title="Answer the question in the dialog"
          description="RealtimeDocs is asking whether to use the server this link belongs to. Nothing is sent to that server until you say yes."
        />
      </div>
    );
  }

  if (!server.origin) {
    return (
      <div className="rdp-empty" data-testid="rd-empty-no-server">
        <EmptyState
          compact
          icon={<Server />}
          title="Connect to your RealtimeDocs server"
          description="Set the server address once in Settings, or paste a share link and the app will offer to use that link's server."
          action={
            <Button
              variant="primary"
              data-testid="rd-open-settings-cta"
              onClick={() => void desktop?.window.action('open-settings', { tab: 'connection' })}
            >
              Open Settings
            </Button>
          }
        />
        <PasteShareLink primary={false} />
      </div>
    );
  }

  if (!session) {
    const ended = busy === 'opening' ? null : endedAccess(notice?.code);
    if (ended) {
      return (
        <div className="rdp-empty" data-testid="rd-empty-access-ended" data-state={ended}>
          <EmptyState
            compact
            icon={<FileX2 />}
            title={ENDED_TEXT[ended].title}
            description={ENDED_TEXT[ended].description}
          />
          <PasteShareLink primary />
        </div>
      );
    }
    return (
      <div className="rdp-empty" data-testid="rd-empty-no-document">
        <EmptyState
          compact
          icon={<FileText />}
          title={busy === 'opening' ? 'Opening document…' : 'No document open'}
          description={`Choose "Open in Desktop" on a document in your browser, or paste its share link here. Connected to ${new URL(server.origin).host}.`}
        />
        <PasteShareLink primary />
      </div>
    );
  }

  if (!live) {
    return (
      <div className="rdp-empty" data-testid="rd-document-starting">
        <Spinner />
      </div>
    );
  }

  // Keyed by the session: nothing of one document (an open draft, a notice) carries over to the next.
  return <LivePanelDocument key={live.key} state={state} live={live} />;
}
