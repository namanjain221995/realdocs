/**
 * Diagram node view: editable, collaborative Mermaid source plus a safe
 * preview.
 *
 * The source is ordinary document text (the node's content). The preview is
 * derived locally: rendered after a debounce, cached by source, sanitized and
 * shown as an inert image. A syntax error is shown as text under the last
 * good preview and never affects the rest of the editor.
 */
import { Button, Spinner, copyText, cx } from '@realtimedocs/ui';
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { Check, Code, Copy, EyeOff, TriangleAlert, Workflow } from 'lucide-react';
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { cachedDiagram, renderDiagram, type DiagramResult } from '../mermaid';
import { useRuntime } from '../runtime';
import { useValueStore } from '../store';

/** Wait for a pause in typing before rendering the preview again. */
export const DIAGRAM_DEBOUNCE_MS = 350;

interface PreviewState {
  /** Last successful render (kept while the source is being edited). */
  image: { dataUrl: string; width: number; height: number } | null;
  error: string | null;
  busy: boolean;
}

function useDiagramPreview(source: string, theme: 'dark' | 'light'): PreviewState {
  const [state, setState] = useState<PreviewState>(() => {
    const hit = cachedDiagram(source, theme);
    if (hit?.ok) return { image: hit, error: null, busy: false };
    return { image: null, error: hit && !hit.ok ? hit.message : null, busy: !hit };
  });
  const first = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const apply = (result: DiagramResult): void => {
      if (cancelled) return;
      setState((previous) =>
        result.ok
          ? { image: result, error: null, busy: false }
          : { image: previous.image, error: result.message, busy: false },
      );
    };
    const hit = cachedDiagram(source, theme);
    if (hit) {
      apply(hit);
      return undefined;
    }
    setState((previous) => (previous.busy ? previous : { ...previous, busy: true }));
    // The first render of a node is not typing: start right away.
    const delay = first.current ? 0 : DIAGRAM_DEBOUNCE_MS;
    first.current = false;
    const timer = setTimeout(() => {
      void renderDiagram(source, theme).then(apply);
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, theme]);

  return state;
}

function DiagramViewInner({ node, editor, getPos, selectionInside, selected }: ReactNodeViewProps) {
  const runtime = useRuntime();
  const editable = useValueStore(runtime.editable);
  const theme = useValueStore(runtime.theme);
  const source = node.textContent;
  const preview = useDiagramPreview(source, theme);
  const [pinned, setPinned] = useState(false);
  const [copied, setCopied] = useState(false);

  // The source is shown while the cursor is in it, when pinned open, and for
  // an empty or broken diagram (so an editor can see what to fix).
  const inside = selectionInside === true || selected;
  const showSource = pinned || inside || (editable && (source.trim() === '' || !preview.image));

  const toggleSource = (): void => {
    const opening = !pinned;
    setPinned(opening);
    if (!opening || !editable) return;
    // "Edit source" puts the cursor at the end of the source, ready to type.
    const pos = getPos();
    if (typeof pos === 'number') editor.commands.focus(pos + node.nodeSize - 1);
  };

  const copy = (): void => {
    void copyText(source).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <NodeViewWrapper
      className={cx('rd-diagram', showSource && 'is-open', inside && 'is-active')}
      data-language="mermaid"
    >
      <div className="rd-block-bar" contentEditable={false}>
        <span className="rd-block-bar__title">
          <Workflow size={14} aria-hidden="true" />
          Mermaid diagram
        </span>
        <span className="rd-block-bar__actions">
          <Button
            size="sm"
            variant="ghost"
            iconLeft={showSource && pinned ? <EyeOff size={14} /> : <Code size={14} />}
            aria-pressed={pinned}
            onClick={toggleSource}
          >
            {pinned ? 'Hide source' : editable ? 'Edit source' : 'Show source'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconLeft={copied ? <Check size={14} /> : <Copy size={14} />}
            onClick={copy}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </span>
      </div>
      <div className="rd-diagram__preview" contentEditable={false} data-testid="rd-diagram-preview">
        {preview.image ? (
          <div className="rd-diagram__canvas">
            <img
              className="rd-diagram__image"
              src={preview.image.dataUrl}
              width={preview.image.width}
              height={preview.image.height}
              style={{ '--rd-diagram-width': `${preview.image.width}px` } as CSSProperties}
              alt="Diagram rendered from the Mermaid source below"
              draggable={false}
              data-stale={preview.error || preview.busy ? '' : undefined}
            />
          </div>
        ) : preview.busy ? (
          <span className="rd-diagram__status">
            <Spinner size="sm" label={null} /> Rendering diagram…
          </span>
        ) : null}
        {preview.error ? (
          <div className="rd-diagram__error" role="status" data-testid="rd-diagram-error">
            <TriangleAlert size={16} aria-hidden="true" />
            <div>
              <strong>
                {preview.image
                  ? 'The diagram has an error; showing the last version that worked.'
                  : 'The diagram could not be drawn.'}
              </strong>
              <pre>{preview.error}</pre>
            </div>
          </div>
        ) : null}
      </div>
      <pre className="rd-diagram__source" hidden={!showSource} spellCheck={false}>
        <NodeViewContent<'code'> as="code" style={{ whiteSpace: 'pre' }} />
      </pre>
    </NodeViewWrapper>
  );
}

export const DiagramView = memo(DiagramViewInner);
