import { Spinner } from '@realtimedocs/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ErrorView } from '../../components/ErrorScreen';
import { PublicShell } from '../../components/PublicShell';
import { api } from '../../lib/api';
import { dropCapability } from '../../lib/capability';
import type { ErrorScreenKind } from '../../lib/errors';
import { useDocumentTitle } from '../../lib/hooks';
import { documentPath } from '../../lib/navigation';
import { useCapability } from '../../lib/useCapability';
import {
  exchangeShareLink,
  isFinalShareFailure,
  type ShareExchangeOutcome,
  type ShareFailureKind,
} from './exchange';
import './share.css';

type Failure = Extract<ShareExchangeOutcome, { ok: false }>;

interface FailureScreen {
  kind: ErrorScreenKind;
  title: string;
  description: string;
}

const KEPT_IN_MEMORY =
  'Keep this tab open while you wait: the link’s key is held in memory only and is gone if the page is reloaded.';

const SCREENS: Record<ShareFailureKind, FailureScreen> = {
  incomplete: {
    kind: 'link_invalid',
    title: 'This share link is incomplete',
    description:
      'The part of the link after the # sign is missing or was changed, so the link cannot be checked. Open the complete link exactly as it was sent to you. If you reloaded this page, open the original link again: the key is removed from the address bar as soon as the page loads.',
  },
  invalid: {
    kind: 'link_invalid',
    title: 'This share link is not valid',
    description:
      'The server does not recognise it. Check that you have the complete, most recent link, or ask the person who sent it for a new one.',
  },
  expired: {
    kind: 'link_expired',
    title: 'This share link has expired',
    description:
      'It was set to stop working after a certain time. Ask the person who sent it for a new link.',
  },
  revoked: {
    kind: 'link_revoked',
    title: 'This share link was revoked',
    description:
      'It no longer opens the document. Ask the person who sent it for a new link if you still need access.',
  },
  document_unavailable: {
    kind: 'document_trashed',
    title: 'The shared document is not available',
    description:
      'The document this link points to was moved to the trash or deleted. Ask the person who sent you the link.',
  },
  rate_limited: {
    kind: 'rate_limited',
    title: 'Too many attempts',
    description: `The server is limiting how often share links can be opened from this network. ${KEPT_IN_MEMORY}`,
  },
  offline: {
    kind: 'offline',
    title: 'You are offline',
    description: `The link opens as soon as your connection is back. ${KEPT_IN_MEMORY}`,
  },
  unavailable: {
    kind: 'server_unavailable',
    title: 'The server is not responding',
    description: `The link could not be checked because the server did not answer or reported a problem. ${KEPT_IN_MEMORY}`,
  },
};

/**
 * `/s/:grantId#<secret>`: exchanges a share link for access, then replaces
 * itself with the document. The secret has already left the address bar when
 * this screen renders (see `lib/capability.ts`).
 */
export function ShareExchangePage() {
  const { grantId = '' } = useParams();
  const capability = useCapability('share', grantId);
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [working, setWorking] = useState(true);
  // Forgetting the secret changes `capability`, which re-runs the effect below.
  // `settled` keeps that from undoing the result: after success nothing more
  // happens, and a refusal stays on screen until a new secret is captured (the
  // link opened again) or the visitor retries.
  const settled = useRef<'opened' | 'refused' | null>(null);
  useDocumentTitle(failure ? SCREENS[failure.kind].title : 'Opening shared document');

  useEffect(() => {
    if (settled.current === 'opened') return undefined;
    if (settled.current === 'refused' && capability.kind !== 'ok') return undefined;
    settled.current = null;
    let cancelled = false;
    setWorking(true);
    void exchangeShareLink(grantId, capability, api.shares.exchange).then((outcome) => {
      if (cancelled) return;
      if (outcome.ok) {
        settled.current = 'opened';
        dropCapability('share', grantId);
        void navigate(documentPath(outcome.documentId), { replace: true });
        return;
      }
      if (isFinalShareFailure(outcome.kind)) {
        settled.current = 'refused';
        dropCapability('share', grantId);
      }
      setFailure(outcome);
      setWorking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [grantId, capability, attempt, navigate]);

  if (failure && !working) {
    const screen = SCREENS[failure.kind];
    const retryable = !isFinalShareFailure(failure.kind);
    return (
      <PublicShell width="wide">
        <ErrorView
          key={`${failure.kind}:${attempt}`}
          kind={screen.kind}
          title={screen.title}
          description={screen.description}
          requestId={failure.requestId}
          waitSeconds={failure.retryAfterSeconds}
          headingLevel={1}
          onRetry={retryable ? () => setAttempt((current) => current + 1) : undefined}
          data-testid="share-exchange-error"
          data-share-failure={failure.kind}
        />
      </PublicShell>
    );
  }

  return (
    <PublicShell width="wide">
      <div className="share-working" role="status" data-testid="share-exchange-working">
        <Spinner size="lg" label={null} />
        <h1 className="share-working__title">Opening the shared document</h1>
        <p className="app-muted">Checking the link with the server.</p>
      </div>
    </PublicShell>
  );
}
