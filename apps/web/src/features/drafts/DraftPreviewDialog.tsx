import { Button, Dialog, Skeleton, useToast } from '@realtimedocs/ui';
import { Download } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { loadRecoveryDraftJSON } from './draftsApi';

const DraftPreview = lazy(async () => ({ default: (await import('./DraftPreview')).DraftPreview }));

export interface DraftPreviewTarget {
  draftId: string;
  documentId: string;
  /** Shown in the dialog title and used for the download's file name. */
  documentTitle: string;
}

export function draftFileName(documentTitle: string): string {
  const base = documentTitle.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return `${base || 'document'}-recovery-draft.json`;
}

/** Hands the browser a file to save. The object URL is released right after. */
function saveAsFile(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Saves a draft as a JSON file (the document format's own JSON). Resolves to
 * false when the draft is gone.
 */
export async function downloadDraft(target: DraftPreviewTarget): Promise<boolean> {
  const content = await loadRecoveryDraftJSON(target.draftId);
  if (content === null) return false;
  saveAsFile(draftFileName(target.documentTitle), JSON.stringify(content, null, 2));
  return true;
}

export interface DraftPreviewDialogProps {
  draft: DraftPreviewTarget;
  onClose: () => void;
}

/**
 * Shows unsent work that was set aside as a recovery draft, read-only. Works
 * for share-link guests too: their drafts exist only in this page's memory.
 */
export function DraftPreviewDialog({ draft, onClose }: DraftPreviewDialogProps) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const download = (): void => {
    setSaving(true);
    downloadDraft(draft)
      .then((found) => {
        if (!found)
          toast.show({ tone: 'warning', title: 'That draft is no longer on this device' });
      })
      .catch(() => {
        toast.show({ tone: 'danger', title: 'The draft could not be read from this device' });
      })
      .finally(() => setSaving(false));
  };

  return (
    <Dialog
      open
      size="lg"
      title={`Recovery draft of “${draft.documentTitle || 'Untitled document'}”`}
      description="Unsent changes that were set aside instead of being published. This copy exists on this device only; it is not part of the shared document."
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      data-testid="draft-preview-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button iconLeft={<Download />} loading={saving} onClick={download}>
            Download as JSON
          </Button>
        </>
      }
    >
      <Suspense fallback={<Skeleton lines={6} />}>
        <DraftPreview draftId={draft.draftId} documentId={draft.documentId} />
      </Suspense>
    </Dialog>
  );
}
