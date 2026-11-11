/**
 * Image node view: display through the authorized asset endpoint, upload
 * states, aspect-preserving resize, alignment, alt text and caption.
 *
 * The component reads only its own node and two small stores, so it
 * re-renders when this image changes, not when text elsewhere is typed.
 */
import { Button, IconButton, Popover, TextField, cx } from '@realtimedocs/ui';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import {
  Captions,
  ImageOff,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ImageAlignment } from '../../schema';
import { safeId, safeImageAlign, safeInteger, safeText } from '../attrs';
import { useRuntime } from '../runtime';
import { useValueStore } from '../store';
import { UploadPlaceholder, useUploadSnapshot } from './uploadState';

const MIN_WIDTH = 10;
const MAX_WIDTH = 100;
const clampWidth = (value: number): number =>
  Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));

interface TextPopoverProps {
  label: string;
  hint: string;
  value: string;
  icon: React.ReactNode;
  onSave: (value: string) => void;
}

function TextPopover({ label, hint, value, icon, onSave }: TextPopoverProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onSave(draft.trim().slice(0, 1000));
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom"
      trigger={<IconButton size="sm" label={label} icon={icon} pressed={value !== ''} />}
    >
      <form className="rd-popover-form" onSubmit={submit}>
        <TextField
          label={label}
          hint={hint}
          value={draft}
          maxLength={1000}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="rd-popover-form__actions">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit">
            Save
          </Button>
        </div>
      </form>
    </Popover>
  );
}

const ALIGNMENTS: { value: ImageAlignment; label: string; icon: React.ReactNode }[] = [
  { value: 'left', label: 'Align left', icon: <TextAlignStart size={16} /> },
  { value: 'center', label: 'Align centre', icon: <TextAlignCenter size={16} /> },
  { value: 'right', label: 'Align right', icon: <TextAlignEnd size={16} /> },
];

function ImageViewInner({ node, selected, updateAttributes, deleteNode }: ReactNodeViewProps) {
  const runtime = useRuntime();
  const editable = useValueStore(runtime.editable);
  // Attributes come from the shared document: read them defensively.
  const attrs = {
    assetId: safeId(node.attrs.assetId),
    uploadId: safeId(node.attrs.uploadId),
    alt: safeText(node.attrs.alt, 1000),
    caption: safeText(node.attrs.caption, 1000),
    width: safeInteger(node.attrs.width, MIN_WIDTH, MAX_WIDTH),
    align: safeImageAlign(node.attrs.align),
    naturalWidth: safeInteger(node.attrs.naturalWidth, 1, 100_000),
    naturalHeight: safeInteger(node.attrs.naturalHeight, 1, 100_000),
    name: safeText(node.attrs.name, 255),
  };
  const upload = useUploadSnapshot(runtime.uploads, attrs.uploadId);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const wrapperRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const assetId = attrs.assetId;
  useEffect(() => setBroken(false), [assetId]);

  const src = assetId
    ? (runtime.uploads?.previewForAsset(assetId) ??
      runtime.api.assetUrl(runtime.documentId, assetId))
    : (upload?.previewUrl ?? null);

  const width = dragWidth ?? attrs.width;

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>, direction: 1 | -1) => {
      const frame = frameRef.current;
      const column = wrapperRef.current;
      if (!frame || !column) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = frame.getBoundingClientRect().width;
      const columnWidth = column.getBoundingClientRect().width || 1;
      // A centred image grows on both sides of its axis.
      const factor = attrs.align === 'center' ? 2 : 1;
      let latest = clampWidth((startWidth / columnWidth) * 100);
      const move = (moveEvent: PointerEvent): void => {
        const delta = (moveEvent.clientX - startX) * direction * factor;
        latest = clampWidth(((startWidth + delta) / columnWidth) * 100);
        setDragWidth(latest);
      };
      const finish = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        setDragWidth(null);
        // One transaction for the whole drag.
        updateAttributes({ width: latest });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [attrs.align, updateAttributes],
  );

  const nudge = (delta: number): void => {
    const frame = frameRef.current;
    const column = wrapperRef.current;
    const current =
      attrs.width ??
      (frame && column
        ? (frame.getBoundingClientRect().width / (column.getBoundingClientRect().width || 1)) * 100
        : 100);
    updateAttributes({ width: clampWidth(current + delta) });
  };

  const style = (width ? { '--rd-image-width': `${width}%` } : {}) as CSSProperties;
  const showTools = selected && editable && assetId !== null;

  let body: React.ReactNode;
  if (attrs.uploadId && !assetId) {
    body = (
      <>
        {src ? (
          <img
            className="rd-image__img rd-image__img--pending"
            src={src}
            alt=""
            draggable={false}
          />
        ) : null}
        <UploadPlaceholder
          snapshot={upload}
          name={attrs.name}
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
      </>
    );
  } else if (src && !broken) {
    body = (
      <img
        className="rd-image__img"
        src={src}
        alt={attrs.alt}
        width={attrs.naturalWidth ?? undefined}
        height={attrs.naturalHeight ?? undefined}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setBroken(true)}
      />
    );
  } else {
    body = (
      <div className="rd-image__missing" role="img" aria-label={attrs.alt || 'Image unavailable'}>
        <ImageOff size={20} aria-hidden="true" />
        <span>{attrs.name ? `“${attrs.name}” is unavailable` : 'Image unavailable'}</span>
      </div>
    );
  }

  return (
    <NodeViewWrapper
      as="figure"
      ref={wrapperRef}
      className={cx('rd-image', selected && 'is-selected', dragWidth !== null && 'is-resizing')}
      data-align={attrs.align}
      style={style}
    >
      <div className="rd-image__frame" ref={frameRef} data-drag-handle="">
        {body}
        {showTools ? (
          <>
            <span
              className="rd-image__handle rd-image__handle--start"
              onPointerDown={(event) => startResize(event, -1)}
              aria-hidden="true"
            />
            <span
              className="rd-image__handle rd-image__handle--end"
              onPointerDown={(event) => startResize(event, 1)}
              aria-hidden="true"
            />
            {dragWidth !== null ? <span className="rd-image__size">{dragWidth}%</span> : null}
          </>
        ) : null}
      </div>
      {attrs.caption ? (
        <figcaption className="rd-image__caption">{attrs.caption}</figcaption>
      ) : null}
      {showTools ? (
        <div
          className="rd-node-tools"
          contentEditable={false}
          role="group"
          aria-label="Image options"
        >
          {ALIGNMENTS.map((option) => (
            <IconButton
              key={option.value}
              size="sm"
              label={option.label}
              icon={option.icon}
              pressed={attrs.align === option.value}
              onClick={() => updateAttributes({ align: option.value })}
            />
          ))}
          <span className="rd-node-tools__separator" aria-hidden="true" />
          <IconButton
            size="sm"
            label="Smaller"
            icon={<ZoomOut size={16} />}
            onClick={() => nudge(-10)}
          />
          <IconButton
            size="sm"
            label="Larger"
            icon={<ZoomIn size={16} />}
            onClick={() => nudge(10)}
          />
          <span className="rd-node-tools__separator" aria-hidden="true" />
          <TextPopover
            label="Alt text"
            hint="Describes the image for people who cannot see it."
            value={attrs.alt}
            icon={<Type size={16} />}
            onSave={(alt) => updateAttributes({ alt })}
          />
          <TextPopover
            label="Caption"
            hint="Shown under the image."
            value={attrs.caption}
            icon={<Captions size={16} />}
            onSave={(caption) => updateAttributes({ caption })}
          />
          <span className="rd-node-tools__separator" aria-hidden="true" />
          <IconButton
            size="sm"
            variant="danger"
            label="Remove image"
            icon={<Trash2 size={16} />}
            onClick={deleteNode}
          />
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

export const ImageView = memo(ImageViewInner);
