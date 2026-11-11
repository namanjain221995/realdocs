/**
 * Read-only rendering of one recovery draft. Loaded lazily by
 * `DraftPreviewDialog`, because it brings the editor's renderer with it.
 */
import '@realtimedocs/editor/styles.css';
import { StaticDocument } from '@realtimedocs/editor';
import { Skeleton } from '@realtimedocs/ui';
import { useQuery } from '@tanstack/react-query';
import { ErrorView } from '../../components/ErrorScreen';
import { api } from '../../lib/api';
import { loadRecoveryDraftJSON } from './draftsApi';

export interface DraftPreviewProps {
  draftId: string;
  /** The document the draft was taken from; its images are loaded from there when still allowed. */
  documentId: string;
}

export function DraftPreview({ draftId, documentId }: DraftPreviewProps) {
  const draft = useQuery({
    queryKey: ['recovery-draft', draftId],
    queryFn: () => loadRecoveryDraftJSON(draftId),
    // Device data: nothing to retry against, and never kept after the dialog closes.
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  if (draft.isError) {
    return (
      <ErrorView
        compact
        kind="unexpected"
        headingLevel={3}
        title="The draft could not be read"
        description="This browser refused access to its local storage, or the stored draft is damaged."
      />
    );
  }
  if (draft.data === undefined) return <Skeleton lines={6} />;
  if (draft.data === null) {
    return (
      <p className="app-note" role="status" data-testid="draft-missing">
        This draft is no longer on this device.
      </p>
    );
  }
  return (
    <div className="draft-preview" data-testid="draft-preview">
      <StaticDocument
        content={draft.data}
        api={api}
        documentId={documentId}
        display={{ readingWidth: 'full' }}
      />
    </div>
  );
}
