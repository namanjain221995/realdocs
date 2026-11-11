import { Button, useToast } from '@realtimedocs/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AppShell } from '../../components/AppShell';
import { ErrorView } from '../../components/ErrorScreen';
import { RouterLinkButton } from '../../components/links';
import { PublicShell } from '../../components/PublicShell';
import { api } from '../../lib/api';
import { errorMessage, type ErrorScreenKind, requestIdOf } from '../../lib/errors';
import { useDocumentTitle } from '../../lib/hooks';
import { documentPath, loginPathFor } from '../../lib/navigation';
import { queryKeys } from '../../lib/queryKeys';
import { useSession } from '../../lib/session';

/** Failures that mean "you cannot have this document", as opposed to "try again". */
export const ACCESS_ENDED: readonly ErrorScreenKind[] = [
  'not_found',
  'document_trashed',
  'forbidden',
  'session_expired',
  'link_invalid',
  'link_expired',
  'link_revoked',
  'update_required',
];

export interface DocumentErrorProps {
  documentId: string;
  error: unknown;
  kind: ErrorScreenKind;
  onRetry: () => void;
  retrying: boolean;
}

/**
 * The dedicated screen for a document that cannot be opened: not found, in the
 * trash, no permission, session ended, offline or server unavailable. Used by
 * the workspace and by the print view. Signed-in people keep the app frame;
 * visitors without an account get the plain one.
 */
export function DocumentError({ documentId, error, kind, onRetry, retrying }: DocumentErrorProps) {
  const { user, isAdmin } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  useDocumentTitle('Document unavailable');

  const restore = useMutation({
    mutationFn: () => api.documents.restore(documentId),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.document(documentId), response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentLists });
      toast.show({ title: 'Document restored' });
    },
    onError: (failure) => {
      const requestId = requestIdOf(failure);
      toast.show({
        tone: 'danger',
        title: 'Could not restore the document',
        description: requestId
          ? `${errorMessage(failure)} Reference ${requestId}`
          : errorMessage(failure),
      });
    },
  });

  const canRetry = kind === 'offline' || kind === 'server_unavailable' || kind === 'rate_limited';
  let actions: ReactNode = null;
  if (kind === 'session_expired') {
    actions = (
      <RouterLinkButton to={loginPathFor(documentPath(documentId))} variant="primary">
        Sign in
      </RouterLinkButton>
    );
  } else if (kind === 'document_trashed' && isAdmin) {
    actions = (
      <>
        <Button variant="primary" loading={restore.isPending} onClick={() => restore.mutate()}>
          Restore document
        </Button>
        <RouterLinkButton to="/?view=trash">Open trash</RouterLinkButton>
      </>
    );
  } else if (user) {
    // "Try again" (from ErrorView) is the main action on retryable screens.
    actions = (
      <RouterLinkButton to="/" variant={canRetry ? 'secondary' : 'primary'}>
        Go to documents
      </RouterLinkButton>
    );
  } else if (kind === 'not_found' || kind === 'forbidden') {
    actions = (
      <RouterLinkButton to={loginPathFor(documentPath(documentId))} variant="primary">
        Sign in
      </RouterLinkButton>
    );
  }

  const view = (
    <ErrorView
      error={error}
      kind={kind}
      subject="document"
      signedIn={user !== null}
      headingLevel={1}
      onRetry={onRetry}
      retrying={retrying}
      actions={actions}
      data-testid="document-error"
    />
  );
  return user ? <AppShell>{view}</AppShell> : <PublicShell width="wide">{view}</PublicShell>;
}
