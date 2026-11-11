/**
 * Read-only rendering of ProseMirror JSON (print view, recovery drafts) with
 * the same node views and styles as the live editor, but without any
 * collaboration, upload or editing machinery.
 */
import type { ApiClient } from '@realtimedocs/contracts';
import { cx } from '@realtimedocs/ui';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createEditorExtensions } from '../editor/extensions';
import { RuntimeContext, type EditorRuntime } from '../editor/runtime';
import { createValueStore } from '../editor/store';
import { getDocumentSchema, type DocJSON } from '../schema';
import { FALLBACK_LIMITS } from '../uploads/limits';
import { displayProps, effectiveTheme, resolveDisplay, type DisplayPreferences } from './display';
import { openExternalLink } from './DocumentEditor';

export interface StaticDocumentProps {
  content: DocJSON;
  api: ApiClient;
  documentId: string;
  display?: Partial<DisplayPreferences>;
  className?: string;
}

/** Returns the content if the document schema accepts it, else null. */
export function validateDocJSON(content: unknown): DocJSON | null {
  try {
    const node = getDocumentSchema().nodeFromJSON(content);
    node.check();
    return node.toJSON() as DocJSON;
  } catch {
    return null;
  }
}

export function StaticDocument({
  content,
  api,
  documentId,
  display,
  className,
}: StaticDocumentProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [runtime] = useState<EditorRuntime>(() => ({
    api,
    documentId,
    uploads: null,
    editable: createValueStore(false),
    theme: createValueStore<'dark' | 'light'>('dark'),
    openLink: (href) => openExternalLink(href, undefined),
    reportPaste: () => {},
    notify: () => {},
  }));
  const extensions = useMemo(
    () =>
      createEditorExtensions({
        documentId,
        uploads: null,
        canEdit: () => false,
        limits: () => FALLBACK_LIMITS,
        onPasteReport: () => {},
        onRejectedFiles: () => {},
        openLink: runtime.openLink,
        onLinkActivated: () => {},
      }),
    [documentId, runtime],
  );
  const valid = useMemo(() => validateDocJSON(content), [content]);
  const editor = useEditor(
    {
      extensions,
      editable: false,
      // The required ProseMirror rules ship in styles.css (no runtime <style>).
      injectCSS: false,
      content: valid ?? { type: 'doc', content: [{ type: 'paragraph' }] },
      editorProps: {
        attributes: {
          class: 'rd-doc',
          'data-testid': 'rd-static-content',
          'aria-label': 'Document',
          'aria-readonly': 'true',
        },
      },
    },
    [extensions, valid],
  );

  const resolved = useMemo(() => resolveDisplay(display), [display]);
  useEffect(() => {
    runtime.theme.set(effectiveTheme(rootRef.current, resolved.tone));
  }, [resolved.tone, runtime]);

  return (
    <div
      ref={rootRef}
      className={cx('rd-editor', 'rd-editor--static', className)}
      data-testid="rd-static-document"
      {...displayProps(resolved)}
    >
      <div className="rd-editor__page">
        {valid ? (
          <RuntimeContext value={runtime}>
            <EditorContent editor={editor} className="rd-editor__content" />
          </RuntimeContext>
        ) : (
          <p className="rd-editor__warning" role="alert">
            This content could not be displayed because it does not match the document format.
          </p>
        )}
      </div>
    </div>
  );
}
