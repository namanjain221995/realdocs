/** Attachment node view: a download chip (never rendered or executed inline). */
import { IconButton, cx } from '@realtimedocs/ui';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { Download, FileText, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { fileExtension, formatBytes } from '../../uploads/limits';
import { safeId, safeInteger, safeText } from '../attrs';
import { useRuntime } from '../runtime';
import { useValueStore } from '../store';
import { UploadPlaceholder, useUploadSnapshot } from './uploadState';

function AttachmentViewInner({ node, selected, deleteNode }: ReactNodeViewProps) {
  const runtime = useRuntime();
  const editable = useValueStore(runtime.editable);
  // Attributes come from the shared document: read them defensively.
  const attrs = {
    assetId: safeId(node.attrs.assetId),
    uploadId: safeId(node.attrs.uploadId),
    sizeBytes: safeInteger(node.attrs.sizeBytes, 0, Number.MAX_SAFE_INTEGER),
  };
  const upload = useUploadSnapshot(runtime.uploads, attrs.uploadId);
  const name = safeText(node.attrs.name, 255) || 'Attachment';

  if (attrs.uploadId && !attrs.assetId) {
    return (
      <NodeViewWrapper
        className={cx('rd-attachment', selected && 'is-selected')}
        data-drag-handle=""
      >
        <UploadPlaceholder
          inline
          snapshot={upload}
          name={name}
          editable={editable}
          onCancel={() => {
            if (attrs.uploadId) runtime.uploads?.cancel(attrs.uploadId);
            deleteNode();
          }}
          onRetry={() => {
            if (attrs.uploadId) runtime.uploads?.retry(attrs.uploadId);
          }}
          onRemove={deleteNode}
        />
      </NodeViewWrapper>
    );
  }

  const extension = fileExtension(name).toUpperCase();
  const details = [extension, attrs.sizeBytes !== null ? formatBytes(attrs.sizeBytes) : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <NodeViewWrapper className={cx('rd-attachment', selected && 'is-selected')} data-drag-handle="">
      <span className="rd-attachment__chip" contentEditable={false}>
        <FileText className="rd-attachment__icon" size={18} aria-hidden="true" />
        <span className="rd-attachment__text">
          <span className="rd-attachment__name">{name}</span>
          {details ? <span className="rd-attachment__details">{details}</span> : null}
        </span>
        {attrs.assetId ? (
          <a
            className="rd-attachment__download"
            href={runtime.api.assetUrl(runtime.documentId, attrs.assetId, true)}
            download={name}
            rel="noopener noreferrer"
            data-rd-download=""
            aria-label={`Download ${name}`}
          >
            <Download size={16} aria-hidden="true" />
            <span>Download</span>
          </a>
        ) : (
          <span className="rd-attachment__details">Unavailable</span>
        )}
        {editable && selected ? (
          <IconButton
            size="sm"
            variant="danger"
            label="Remove attachment"
            icon={<Trash2 size={16} />}
            onClick={deleteNode}
          />
        ) : null}
      </span>
    </NodeViewWrapper>
  );
}

export const AttachmentView = memo(AttachmentViewInner);
