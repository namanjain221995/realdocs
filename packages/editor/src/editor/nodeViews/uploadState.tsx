/**
 * Upload placeholder shared by image and attachment node views.
 *
 * - A placeholder whose `uploadId` belongs to this editor instance shows the
 *   real byte progress with cancel, or the failure with retry / remove.
 * - Any other placeholder was created by another client (or by a page that
 *   has since been closed): "uploading elsewhere", then "upload interrupted",
 *   with a remove action for editors.
 */
import { Button, Spinner } from '@realtimedocs/ui';
import { RotateCw, Trash2, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { formatBytes } from '../../uploads/limits';
import type { UploadManager, UploadSnapshot } from '../../uploads/manager';

/** After this long without completion a remote placeholder is called interrupted. */
export const REMOTE_UPLOAD_STALE_MS = 90_000;

export function useUploadSnapshot(
  manager: UploadManager | null,
  uploadId: string | null,
): UploadSnapshot | undefined {
  const subscribe = useCallback(
    (listener: () => void) =>
      manager && uploadId ? manager.subscribe(uploadId, listener) : () => {},
    [manager, uploadId],
  );
  const read = useCallback(
    () => (manager && uploadId ? manager.get(uploadId) : undefined),
    [manager, uploadId],
  );
  return useSyncExternalStore(subscribe, read, read);
}

function useStale(active: boolean): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => setStale(true), REMOTE_UPLOAD_STALE_MS);
    return () => clearTimeout(timer);
  }, [active]);
  return active && stale;
}

export type PlaceholderState = 'uploading' | 'failed' | 'pending-remote';

export function placeholderState(snapshot: UploadSnapshot | undefined): PlaceholderState {
  if (!snapshot) return 'pending-remote';
  return snapshot.phase === 'failed' || snapshot.phase === 'cancelled' ? 'failed' : 'uploading';
}

export interface UploadPlaceholderProps {
  snapshot: UploadSnapshot | undefined;
  name: string;
  editable: boolean;
  /** Compact single-line layout (attachments). */
  inline?: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
}

export function UploadPlaceholder({
  snapshot,
  name,
  editable,
  inline = false,
  onCancel,
  onRetry,
  onRemove,
}: UploadPlaceholderProps) {
  const state = placeholderState(snapshot);
  const stale = useStale(state === 'pending-remote');
  const percent = snapshot ? Math.round(snapshot.progress * 100) : 0;

  let status: string;
  if (!snapshot) {
    status = stale ? 'Upload interrupted' : 'Uploading on another device…';
  } else if (snapshot.phase === 'queued') {
    status = 'Waiting to upload…';
  } else if (snapshot.phase === 'uploading') {
    status = percent >= 100 ? 'Processing…' : `Uploading… ${percent}%`;
  } else if (snapshot.phase === 'done') {
    status = 'Finishing…';
  } else {
    status = snapshot.error ?? 'The upload failed.';
  }

  return (
    <div
      className="rd-upload"
      data-testid="rd-upload-placeholder"
      data-upload-state={state}
      data-inline={inline ? '' : undefined}
      contentEditable={false}
    >
      <span className="rd-upload__icon" aria-hidden="true">
        {state === 'failed' || stale ? (
          <TriangleAlert size={16} />
        ) : (
          <Spinner size="sm" label={null} />
        )}
      </span>
      <span className="rd-upload__text">
        <span className="rd-upload__name">{name || 'File'}</span>
        <span className="rd-upload__status" role="status">
          {status}
          {snapshot && snapshot.phase !== 'failed' && snapshot.phase !== 'cancelled'
            ? ` · ${formatBytes(snapshot.sizeBytes)}`
            : ''}
        </span>
      </span>
      <span className="rd-upload__actions">
        {snapshot && (snapshot.phase === 'uploading' || snapshot.phase === 'queued') ? (
          <Button size="sm" variant="ghost" iconLeft={<X size={14} />} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {snapshot && state === 'failed' && snapshot.retryable ? (
          <Button size="sm" variant="secondary" iconLeft={<RotateCw size={14} />} onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {editable && (state === 'failed' || state === 'pending-remote') ? (
          <Button size="sm" variant="ghost" iconLeft={<Trash2 size={14} />} onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </span>
      {snapshot && (snapshot.phase === 'uploading' || snapshot.phase === 'queued') ? (
        <span
          className="rd-upload__bar"
          role="progressbar"
          aria-label={`Upload progress of ${name || 'file'}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="rd-upload__bar-fill" style={{ width: `${percent}%` }} />
        </span>
      ) : null}
    </div>
  );
}
