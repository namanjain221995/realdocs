/**
 * The one way failures are presented. Every dedicated screen (missing
 * document, trash, no permission, ended session, offline, server down, …)
 * goes through `ErrorView`, so the wording is consistent and the server's
 * request id is always shown when there is one.
 */
import { Button, ErrorState } from '@realtimedocs/ui';
import {
  Ban,
  FileQuestion,
  Hourglass,
  KeyRound,
  Link2Off,
  Lock,
  RefreshCw,
  ServerCrash,
  TimerOff,
  Trash2,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  errorMessage,
  errorScreenKind,
  type ErrorScreenKind,
  formatWait,
  isApiError,
  isRetryableScreen,
  requestIdOf,
} from '../lib/errors';
import { useCountdown, useOnlineStatus } from '../lib/hooks';

export interface ErrorCopy {
  title: string;
  description: string;
}

/** What was being opened; picks the nouns in the standard wording. */
export type ErrorSubject = 'document' | 'page';

export function standardErrorCopy(
  kind: ErrorScreenKind,
  subject: ErrorSubject,
  options: { signedIn: boolean; error?: unknown } = { signedIn: true },
): ErrorCopy {
  const thing = subject === 'document' ? 'document' : 'page';
  switch (kind) {
    case 'not_found':
      return {
        title: subject === 'document' ? 'Document not found' : 'Page not found',
        description:
          subject === 'document'
            ? options.signedIn
              ? 'It may have been deleted, or your access to it may have ended. Ask the person who shared it with you.'
              : 'It may have been deleted, or your access may have ended. If you were sent a share link, open that link again. If you have an account, sign in.'
            : 'There is nothing at this address. Check the link, or go back to your documents.',
      };
    case 'document_trashed':
      return {
        title: 'This document is in the trash',
        description:
          'An administrator moved it to the trash, so nobody can open it. It can be restored until it is deleted permanently.',
      };
    case 'forbidden':
      return {
        title: `You do not have access to this ${thing}`,
        description:
          'Your account is not allowed to open it. Ask a workspace administrator if you need access.',
      };
    case 'session_expired':
      return {
        title: 'Sign in to continue',
        description:
          subject === 'document'
            ? 'Your session has ended, or this document needs an account. Sign in to open it. If you were sent a share link, open that link again instead.'
            : 'Your session has ended. Sign in again to pick up where you left off.',
      };
    case 'link_invalid':
      return {
        title: 'This share link is not valid',
        description: 'Check that you opened the complete link, or ask for a new one.',
      };
    case 'link_expired':
      return {
        title: 'This share link has expired',
        description: 'Ask the person who sent it for a new link.',
      };
    case 'link_revoked':
      return {
        title: 'This share link was revoked',
        description:
          'It no longer opens the document. Ask the person who sent it for a new link if you still need access.',
      };
    case 'invite_invalid':
      return {
        title: 'This invitation is not valid',
        description:
          'It may have been revoked or already used. Ask an administrator for a new one.',
      };
    case 'invite_expired':
      return {
        title: 'This invitation has expired',
        description: 'Ask an administrator to send you a new invitation link.',
      };
    case 'rate_limited': {
      const seconds = isApiError(options.error) ? options.error.retryAfterSeconds : undefined;
      return {
        title: 'Too many requests',
        description:
          seconds !== undefined
            ? `The server is limiting requests from this browser. Wait ${formatWait(seconds)}, then try again.`
            : 'The server is limiting requests from this browser. Wait a moment, then try again.',
      };
    }
    case 'update_required':
      return {
        title: 'Reload to update',
        description: `This ${thing} needs a newer version of RealtimeDocs than the one loaded in this tab. Reload to get it.`,
      };
    case 'offline':
      return {
        title: 'You are offline',
        description: `This ${thing} loads again as soon as your connection is back.`,
      };
    case 'server_unavailable':
      return {
        title: 'The server is not responding',
        description:
          'RealtimeDocs could not reach its server, or the server reported a problem. Your own connection may be fine. Try again in a moment.',
      };
    case 'unexpected':
      return {
        title: 'Something went wrong',
        description: errorMessage(options.error, `This ${thing} could not be loaded.`),
      };
  }
}

const ICONS: Record<ErrorScreenKind, ReactNode> = {
  not_found: <FileQuestion />,
  document_trashed: <Trash2 />,
  forbidden: <Lock />,
  session_expired: <KeyRound />,
  link_invalid: <Link2Off />,
  link_expired: <TimerOff />,
  link_revoked: <Ban />,
  invite_invalid: <Link2Off />,
  invite_expired: <TimerOff />,
  rate_limited: <Hourglass />,
  update_required: <RefreshCw />,
  offline: <WifiOff />,
  server_unavailable: <ServerCrash />,
  unexpected: <TriangleAlert />,
};

export interface RetryButtonProps {
  onRetry: () => void;
  /** Seconds the server asked us to wait; the button stays disabled until then. */
  waitSeconds?: number;
  busy?: boolean;
  label?: string;
}

/** "Try again", counting down first when the server asked for a pause. */
export function RetryButton({
  onRetry,
  waitSeconds,
  busy = false,
  label = 'Try again',
}: RetryButtonProps) {
  const [until] = useState<number | null>(() =>
    waitSeconds !== undefined && waitSeconds > 0 ? Date.now() + waitSeconds * 1000 : null,
  );
  const remaining = useCountdown(until);
  return (
    <Button variant="primary" loading={busy} disabled={remaining > 0} onClick={onRetry}>
      {remaining > 0 ? `${label} in ${remaining} s` : label}
    </Button>
  );
}

export interface ErrorViewProps {
  /** The failure. Its code picks the screen unless `kind` is given. */
  error?: unknown;
  kind?: ErrorScreenKind;
  subject?: ErrorSubject;
  signedIn?: boolean;
  /** Replace the standard wording. */
  title?: ReactNode;
  description?: ReactNode;
  /** Shown as "Try again" when the failure is one a retry can fix. */
  onRetry?: () => void;
  retrying?: boolean;
  /** Server request id when there is no `error` object to read it from. */
  requestId?: string;
  /** Seconds to wait before retrying when there is no `error` object to read it from. */
  waitSeconds?: number;
  /** Buttons or links after the retry button. */
  actions?: ReactNode;
  headingLevel?: 1 | 2 | 3;
  compact?: boolean;
  className?: string;
  'data-testid'?: string;
  /** Extra `data-*` attributes for the root element (test hooks). */
  [dataAttribute: `data-${string}`]: string | undefined;
}

export function ErrorView({
  error,
  kind: kindProp,
  subject = 'page',
  signedIn = true,
  title,
  description,
  onRetry,
  retrying = false,
  requestId: requestIdProp,
  waitSeconds: waitSecondsProp,
  actions,
  headingLevel = 2,
  compact = false,
  className,
  'data-testid': testId,
  ...dataAttributes
}: ErrorViewProps) {
  const online = useOnlineStatus();
  const kind = kindProp ?? errorScreenKind(error, { online });
  const copy = standardErrorCopy(kind, subject, { signedIn, error });
  const requestId = requestIdProp ?? requestIdOf(error);
  const retryable = onRetry !== undefined && isRetryableScreen(kind);

  // Coming back online is the retry the offline screen is waiting for.
  // (Once online again the same failure reads as "server unavailable", so the
  // decision uses what was on screen before the change.)
  const before = useRef({ online, kind });
  useEffect(() => {
    const previous = before.current;
    before.current = { online, kind };
    if (online && !previous.online && previous.kind === 'offline') onRetry?.();
  }, [online, kind, onRetry]);

  const waitSeconds =
    waitSecondsProp ??
    (kind === 'rate_limited' && isApiError(error) ? error.retryAfterSeconds : undefined);

  const retry =
    retryable && onRetry ? (
      <RetryButton onRetry={onRetry} busy={retrying} waitSeconds={waitSeconds} />
    ) : null;
  const reload =
    kind === 'update_required' ? (
      <Button variant="primary" onClick={() => window.location.reload()}>
        Reload
      </Button>
    ) : null;
  const hasActions =
    retry !== null ||
    reload !== null ||
    (actions !== undefined && actions !== null && actions !== false);

  return (
    <ErrorState
      {...dataAttributes}
      className={className}
      data-testid={testId ?? 'error-screen'}
      data-error-kind={kind}
      icon={ICONS[kind]}
      title={title ?? copy.title}
      description={description ?? copy.description}
      code={requestId ? `Reference ${requestId}` : undefined}
      headingLevel={headingLevel}
      compact={compact}
      action={
        hasActions ? (
          <>
            {retry}
            {reload}
            {actions}
          </>
        ) : undefined
      }
    />
  );
}
