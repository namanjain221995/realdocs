/**
 * Recovery drafts of the signed-in account on this device.
 *
 * A draft is unsaved work the editor set aside instead of publishing: a
 * snapshot was restored underneath it, or edit access ended. Drafts live in
 * this browser only and are deleted on sign-out. All access goes through
 * `features/drafts/draftsApi.ts`.
 */
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Skeleton,
  useToast,
} from '@realtimedocs/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileClock, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ErrorView } from '../../components/ErrorScreen';
import { RelativeTime } from '../../components/RelativeTime';
import { queryKeys } from '../../lib/queryKeys';
import { downloadDraft, DraftPreviewDialog } from '../drafts/DraftPreviewDialog';
import { deleteRecoveryDraft, listRecoveryDrafts, type RecoveryDraft } from '../drafts/draftsApi';

const REASON: Record<RecoveryDraft['reason'], string> = {
  generation_restored: 'A snapshot was restored while this work was unsaved',
  access_removed: 'Your edit access ended while this work was unsaved',
  manual: 'Kept by you',
};

function titleOf(draft: RecoveryDraft): string {
  return draft.documentTitle || 'Untitled document';
}

export function RecoveryDrafts({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = queryKeys.recoveryDrafts(accountId);
  const drafts = useQuery({
    queryKey: key,
    queryFn: () => listRecoveryDrafts(accountId),
    // Local data: nothing to retry against, and always worth re-reading.
    retry: false,
    staleTime: 0,
  });
  const [deleting, setDeleting] = useState<RecoveryDraft | null>(null);
  const [previewing, setPreviewing] = useState<RecoveryDraft | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = (draft: RecoveryDraft): void => {
    setDownloading(draft.id);
    downloadDraft({
      draftId: draft.id,
      documentId: draft.documentId,
      documentTitle: titleOf(draft),
    })
      .then((found) => {
        if (found) return;
        toast.show({ tone: 'warning', title: 'That draft is no longer on this device' });
        void queryClient.invalidateQueries({ queryKey: key });
      })
      .catch(() => {
        toast.show({ tone: 'danger', title: 'The draft could not be read from this device' });
      })
      .finally(() => setDownloading(null));
  };

  if (drafts.isError) {
    return (
      <ErrorView
        compact
        kind="unexpected"
        headingLevel={3}
        title="Recovery drafts could not be read"
        description="This browser refused access to its local storage, or the storage is damaged."
        onRetry={() => void drafts.refetch()}
        retrying={drafts.isFetching}
      />
    );
  }
  if (!drafts.data) return <Skeleton lines={2} />;

  if (drafts.data.length === 0) {
    return (
      <EmptyState
        compact
        headingLevel={3}
        icon={<FileClock />}
        title="No recovery drafts on this device"
        description="If a snapshot is restored or your edit access changes while you have unsaved work, that work is kept here instead of being lost or published."
        data-testid="drafts-empty"
      />
    );
  }

  return (
    <>
      <ul className="app-rows" aria-label="Recovery drafts" data-testid="drafts-list">
        {drafts.data.map((draft) => (
          <li key={draft.id} className="app-row" data-testid="draft-row">
            <div className="app-row__text">
              <span className="app-row__title">{titleOf(draft)}</span>
              <span className="app-row__meta">
                {REASON[draft.reason]}. <RelativeTime prefix="Kept" value={draft.createdAt} />.
              </span>
            </div>
            <div className="app-row__actions">
              <Button
                size="sm"
                iconLeft={<Eye />}
                onClick={() => setPreviewing(draft)}
                data-testid="draft-open"
              >
                Open
              </Button>
              <IconButton
                size="sm"
                label={`Download the draft of ${titleOf(draft)}`}
                tooltip="Download as JSON"
                disabled={downloading === draft.id}
                onClick={() => download(draft)}
              >
                <Download />
              </IconButton>
              <IconButton
                size="sm"
                variant="danger"
                label={`Delete the draft of ${titleOf(draft)}`}
                tooltip="Delete"
                onClick={() => setDeleting(draft)}
              >
                <Trash2 />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
      {previewing ? (
        <DraftPreviewDialog
          draft={{
            draftId: previewing.id,
            documentId: previewing.documentId,
            documentTitle: titleOf(previewing),
          }}
          onClose={() => setPreviewing(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          danger
          title="Delete this recovery draft?"
          message={`The unsaved work kept from “${titleOf(deleting)}” is removed from this device. It was never uploaded, so it cannot be recovered afterwards.`}
          confirmLabel="Delete draft"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteRecoveryDraft(deleting.id);
            setDeleting(null);
            await queryClient.invalidateQueries({ queryKey: key });
            toast.show({ title: 'Recovery draft deleted' });
          }}
          data-testid="delete-draft-confirm"
        />
      ) : null}
    </>
  );
}
