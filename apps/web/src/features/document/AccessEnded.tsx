import type { AccessVia } from '@realtimedocs/contracts';
import { Banner, Button } from '@realtimedocs/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { ErrorView } from '../../components/ErrorScreen';
import { RouterLinkButton } from '../../components/links';
import { PublicShell } from '../../components/PublicShell';
import { Splash } from '../../components/Splash';
import type { ErrorScreenKind } from '../../lib/errors';
import { useDocumentTitle } from '../../lib/hooks';
import { documentPath, loginPathFor } from '../../lib/navigation';
import { useSession } from '../../lib/session';
import { DraftPreviewDialog } from '../drafts/DraftPreviewDialog';
import type { AccessEndReason } from './sessionSync';

export interface AccessEndedInfo {
  reason: AccessEndReason;
  /** How the reader had reached the document. */
  via: AccessVia;
  documentId: string;
  documentTitle: string;
  /** Unsent work the editor set aside instead of publishing it. */
  draftIds: readonly string[];
}

interface Copy {
  kind: ErrorScreenKind;
  title: string;
  description: string;
}

function copyFor(info: AccessEndedInfo, signedIn: boolean): Copy {
  const byLink = info.via === 'share_link';
  if (info.reason === 'access_revoked') {
    return {
      kind: 'link_revoked',
      title: 'Your access to this document was revoked',
      description: byLink
        ? 'The share link you used was revoked. Ask the person who sent it for a new link if you still need the document.'
        : 'An administrator revoked your access. Ask them if you still need the document.',
    };
  }
  if (byLink) {
    // Either the link reached its expiry time or this browser's use of it did; only the first is final.
    return {
      kind: 'link_expired',
      title: 'Your access to this document has expired',
      description:
        'Open the share link again. If it no longer works, it has reached its expiry time: ask the person who sent it for a new one.',
    };
  }
  if (!signedIn) {
    return {
      kind: 'session_expired',
      title: 'Your session has ended',
      description: 'You were signed out while this document was open. Sign in again to open it.',
    };
  }
  return {
    kind: 'link_expired',
    title: 'Your access to this document has expired',
    description: 'Reload the page to check whether you can still open the document.',
  };
}

/**
 * Shown, without a reload, the moment the server ends this reader's access
 * while the document is open. The document itself is taken off the screen.
 * If the reader had changes that never reached the server, they were kept as
 * a recovery draft and can be opened from here.
 */
export function AccessEnded({ info }: { info: AccessEndedInfo }) {
  const session = useSession();
  const { user, refresh } = session;
  const [openDraft, setOpenDraft] = useState<string | null>(null);
  // The same two names the status indicator uses for these states.
  useDocumentTitle(info.reason === 'access_revoked' ? 'Access revoked' : 'Access expired');

  // For an account, "expired" nearly always means the session itself is over,
  // and with it the app's own sign-in. Find out before saying which it was.
  const sessionInDoubt = info.reason === 'access_expired' && info.via !== 'share_link';
  const [sessionChecked, setSessionChecked] = useState(!sessionInDoubt);
  useEffect(() => {
    if (!sessionInDoubt) return undefined;
    let current = true;
    void refresh()
      .catch(() => undefined)
      .then(() => {
        if (current) setSessionChecked(true);
      });
    return () => {
      current = false;
    };
  }, [sessionInDoubt, refresh]);

  if (!sessionChecked) return <Splash label="Checking your session" />;

  const copy = copyFor(info, user !== null);
  const guest = user === null;

  let actions: ReactNode = null;
  if (user) {
    actions = (
      <RouterLinkButton to="/" variant="primary">
        Go to documents
      </RouterLinkButton>
    );
  } else if (info.via !== 'share_link') {
    actions = (
      <RouterLinkButton to={loginPathFor(documentPath(info.documentId))} variant="primary">
        Sign in
      </RouterLinkButton>
    );
  }

  const view = (
    <div data-testid="access-ended" data-reason={info.reason}>
      <ErrorView
        kind={copy.kind}
        title={copy.title}
        description={copy.description}
        headingLevel={1}
        actions={actions}
        data-testid="access-ended-message"
      />
      {info.draftIds.length > 0 ? (
        <Banner
          tone="warning"
          title="Your unsent changes were kept"
          data-testid="access-ended-drafts"
          action={
            <>
              {info.draftIds.map((draftId, index) => (
                <Button key={draftId} size="sm" onClick={() => setOpenDraft(draftId)}>
                  {info.draftIds.length > 1 ? `Open draft ${index + 1}` : 'Open draft'}
                </Button>
              ))}
            </>
          }
        >
          Changes you had made but that had not reached the server were not published. They were set
          aside as a recovery draft
          {guest
            ? ', which exists only until you close or reload this page: open it and copy or download what you need.'
            : ' on this device. You can open it here or later from Settings.'}
        </Banner>
      ) : null}
      {openDraft ? (
        <DraftPreviewDialog
          draft={{
            draftId: openDraft,
            documentId: info.documentId,
            documentTitle: info.documentTitle,
          }}
          onClose={() => setOpenDraft(null)}
        />
      ) : null}
    </div>
  );
  return user ? <AppShell>{view}</AppShell> : <PublicShell width="wide">{view}</PublicShell>;
}
