/**
 * The shared document surface used by the web app and the desktop panel.
 *
 * Rendering strategy: this component subscribes only to the few session
 * values it needs (can edit, ready), the toolbar subscribes to a narrow,
 * frame-throttled formatting snapshot, and node views re-render when their
 * own node changes. Typing a character therefore re-renders no React
 * component outside the node being edited.
 */
import type { ApiClient } from '@realtimedocs/contracts';
import { Button, IconButton, Skeleton, cx } from '@realtimedocs/ui';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import { ArrowDownToLine, LocateFixed, Search, TriangleAlert } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import type { PasteReport } from '../clipboard/report';
import type { CollabSession } from '../collab/session';
import type { SessionStatus } from '../collab/status';
import { createEditorExtensions } from '../editor/extensions';
import { setDiagramSourceLimit } from '../editor/mermaid';
import { RuntimeContext, type EditorRuntime } from '../editor/runtime';
import { createValueStore } from '../editor/store';
import { sanitizeLinkHref } from '../schema';
import { currentLimits, loadUploadLimits } from '../uploads/limits';
import { UploadManager } from '../uploads/manager';
import { displayProps, effectiveTheme, resolveDisplay, type DisplayPreferences } from './display';
import { EditorToolbar } from './EditorToolbar';
import { FindBar } from './FindBar';
import { useFollowLatest, useScrollAnchor } from './followLatest';
import { LinkPopover } from './LinkPopover';
import { MessageNotice, PasteReportNotice } from './Notices';
import { useSessionSelector } from './sessionHooks';

export interface DocumentEditorProps {
  session: CollabSession;
  api: ApiClient;
  /**
   * `editor`: full toolbar when the role allows editing. `viewer`: reading surface with find.
   * `panel`: compact desktop panel (no toolbar chrome unless editing, small find bar).
   */
  variant: 'editor' | 'viewer' | 'panel';
  display?: Partial<DisplayPreferences>;
  /** Follow Latest: optional auto-scroll to remote changes (off by default). */
  followLatest?: boolean;
  onFollowLatestChange?: (value: boolean) => void;
  /** Element that scrolls the document; defaults to the component's own scroll container. */
  scrollContainer?: HTMLElement | null;
  /** Called for link clicks; return true if handled (desktop opens via the main process). */
  onOpenLink?: (href: string) => boolean;
  className?: string;
  'data-testid'?: string;
}

const selectCanEdit = (status: SessionStatus): boolean => status.canEdit;
const selectReady = (status: SessionStatus): boolean => status.ready;

/** Opens a link through the host first, else in a new tab without an opener. */
export function openExternalLink(
  href: string,
  onOpenLink: ((href: string) => boolean) | undefined,
): void {
  const safe = sanitizeLinkHref(href);
  if (!safe) return;
  if (onOpenLink?.(safe)) return;
  window.open(safe, '_blank', 'noopener,noreferrer');
}

interface SurfaceProps extends DocumentEditorProps {
  ydoc: Y.Doc;
  awareness: Awareness;
}

function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function EditorSurface({
  session,
  api,
  variant,
  display,
  followLatest,
  onFollowLatestChange,
  scrollContainer,
  onOpenLink,
  className,
  ydoc,
  awareness,
  'data-testid': testId,
}: SurfaceProps) {
  const documentId = session.documentId;
  const canEdit = useSessionSelector(session, selectCanEdit);
  const ready = useSessionSelector(session, selectReady);
  const [invalidContent, setInvalidContent] = useState(false);
  const editable = canEdit && variant !== 'viewer' && !invalidContent;
  const editableRef = useLatest(editable);
  const onOpenLinkRef = useLatest(onOpenLink);

  const [report, setReport] = useState<PasteReport | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [findOpen, setFindOpen] = useState(false);
  const [link, setLink] = useState<{ open: boolean; anchor: HTMLElement | null }>({
    open: false,
    anchor: null,
  });
  const [followLocal, setFollowLocal] = useState(false);
  const following = followLatest ?? followLocal;

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // One upload manager and one runtime per surface (per Y.Doc generation).
  const [uploads] = useState(() => new UploadManager({ api, documentId }));
  const [runtime] = useState<EditorRuntime>(() => ({
    api,
    documentId,
    uploads,
    editable: createValueStore(false),
    theme: createValueStore<'dark' | 'light'>('dark'),
    openLink: (href) => openExternalLink(href, onOpenLinkRef.current),
    reportPaste: (next) => setReport(next),
    notify: (message) => setMessages((previous) => [...previous.slice(-3), message]),
  }));

  useEffect(() => {
    uploads.resume();
    return () => uploads.destroy();
  }, [uploads]);

  useEffect(() => {
    void loadUploadLimits(api).then((limits) => {
      setDiagramSourceLimit(limits.maxMermaidSourceLength);
    });
  }, [api]);

  const extensions = useMemo(
    () =>
      createEditorExtensions({
        documentId,
        collaboration: {
          ydoc,
          awareness,
          onInvalidContent: () => setInvalidContent(true),
        },
        uploads,
        canEdit: () => editableRef.current,
        limits: () => currentLimits(api),
        onPasteReport: runtime.reportPaste,
        onRejectedFiles: (rejected) =>
          setMessages((previous) => [...previous, ...rejected].slice(-4)),
        openLink: runtime.openLink,
        onLinkActivated: (anchor) => setLink({ open: true, anchor }),
      }),
    [api, awareness, documentId, editableRef, runtime, uploads, ydoc],
  );

  const editor = useEditor(
    {
      extensions,
      editable: false,
      // The required ProseMirror rules ship in styles.css (no runtime <style>).
      injectCSS: false,
      editorProps: {
        attributes: {
          class: 'rd-doc',
          'data-testid': 'rd-editor-content',
          'aria-label': 'Document',
          'aria-multiline': 'true',
          spellcheck: 'true',
        },
      },
    },
    [extensions],
  );

  useEffect(() => {
    runtime.editable.set(editable);
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable, runtime]);

  // Colour scheme of the surface, for diagram previews.
  const resolved = useMemo(() => resolveDisplay(display), [display]);
  useEffect(() => {
    const update = (): void => runtime.theme.set(effectiveTheme(rootRef.current, resolved.tone));
    update();
    if (resolved.tone !== 'inherit' || typeof MutationObserver !== 'function') return undefined;
    const observer = new MutationObserver(update);
    for (let node = rootRef.current?.parentElement; node; node = node.parentElement) {
      observer.observe(node, { attributes: true, attributeFilter: ['data-theme'] });
    }
    return () => observer.disconnect();
  }, [resolved.tone, runtime]);

  const getScroller = useCallback(() => scrollContainer ?? scrollRef.current, [scrollContainer]);
  const follow = useFollowLatest(editor, getScroller, following);
  useScrollAnchor(editor, getScroller);

  const setFollowing = (value: boolean): void => {
    if (followLatest === undefined) setFollowLocal(value);
    onFollowLatestChange?.(value);
  };

  // Show a skeleton until content exists (first sync or local replica).
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    if (!editor) return undefined;
    const check = (): void => setEmpty(editor.isEmpty);
    check();
    if (ready) return undefined;
    editor.on('update', check);
    return () => {
      editor.off('update', check);
    };
  }, [editor, ready]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setFindOpen(true);
    } else if (mod && !event.altKey && event.key.toLowerCase() === 'k' && editable) {
      event.preventDefault();
      setLink({ open: true, anchor: null });
    } else if (event.altKey && event.key === 'F10') {
      // Tab indents while editing, so the toolbar has its own shortcut.
      const first = rootRef.current?.querySelector<HTMLElement>(
        '[data-testid="rd-toolbar"] [tabindex="0"]',
      );
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  /** A click in the empty area under the document continues writing there. */
  const onPageMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!editor || !editable || event.target !== event.currentTarget) return;
    event.preventDefault();
    const { state, view } = editor;
    const last = state.doc.lastChild;
    const tr = state.tr;
    const paragraph = state.schema.nodes.paragraph;
    if (paragraph && last && !last.isTextblock)
      tr.insert(state.doc.content.size, paragraph.create());
    tr.setSelection(TextSelection.atEnd(tr.doc));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  };

  const limits = currentLimits(api);
  const imageAccept = useMemo(() => limits.imageMimeTypes.join(','), [limits]);
  const attachmentAccept = useMemo(
    () => limits.attachmentExtensions.map((extension) => `.${extension}`).join(','),
    [limits],
  );

  const dismissReport = useCallback(() => setReport(null), []);
  const dismissMessages = useCallback(() => setMessages([]), []);
  const closeFind = useCallback(() => {
    setFindOpen(false);
  }, []);
  const openFind = useCallback(() => setFindOpen(true), []);
  const openLinkEditor = useCallback(() => setLink({ open: true, anchor: null }), []);

  const showToolbar = editable && editor !== null;
  const attributes = displayProps(resolved);

  return (
    <div
      ref={rootRef}
      className={cx('rd-editor', `rd-editor--${variant}`, className)}
      data-testid={testId ?? 'rd-editor'}
      data-editable={editable ? 'true' : 'false'}
      data-ready={ready ? 'true' : 'false'}
      data-external-scroll={scrollContainer ? '' : undefined}
      {...attributes}
      onKeyDown={onKeyDown}
    >
      {showToolbar ? (
        <EditorToolbar
          editor={editor}
          onFind={openFind}
          onLink={openLinkEditor}
          imageAccept={imageAccept}
          attachmentAccept={attachmentAccept}
        />
      ) : null}
      {findOpen && editor ? (
        <FindBar
          editor={editor}
          canReplace={editable}
          compact={variant === 'panel'}
          onClose={closeFind}
        />
      ) : null}
      {invalidContent ? (
        <div className="rd-editor__warning" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>
            This document contains content that this version of the app cannot display. Editing is
            paused here so nothing is lost; update the app to continue.
          </span>
        </div>
      ) : null}
      <div className="rd-editor__scroll" ref={scrollRef}>
        {!showToolbar && !findOpen ? (
          <div className="rd-editor__float">
            <IconButton
              size="sm"
              variant="solid"
              label="Find in document"
              icon={<Search size={16} />}
              onClick={openFind}
              data-testid="rd-find-open"
            />
          </div>
        ) : null}
        <div className="rd-editor__page" onMouseDown={onPageMouseDown}>
          {!ready && empty ? (
            <div
              className="rd-editor__loading"
              role="status"
              aria-busy="true"
              aria-label="Loading document"
            >
              <Skeleton width="55%" height={28} />
              <Skeleton lines={5} />
            </div>
          ) : null}
          <RuntimeContext value={runtime}>
            <EditorContent editor={editor} className="rd-editor__content" />
          </RuntimeContext>
        </div>
        <div className="rd-editor__dock">
          <div className="rd-editor__dock-start">
            {report ? <PasteReportNotice report={report} onDismiss={dismissReport} /> : null}
            {messages.length > 0 ? (
              <MessageNotice messages={messages} onDismiss={dismissMessages} />
            ) : null}
          </div>
          <div className="rd-editor__dock-end">
            {following && follow.paused && follow.hasNew ? (
              <Button
                size="sm"
                variant="primary"
                iconLeft={<ArrowDownToLine size={14} />}
                onClick={follow.jump}
                data-testid="rd-jump-latest"
              >
                Jump to latest
              </Button>
            ) : null}
            {following ? (
              <Button
                size="sm"
                variant="secondary"
                className="rd-follow-toggle"
                iconLeft={<LocateFixed size={14} />}
                aria-pressed
                data-testid="rd-follow-latest"
                data-state={follow.paused ? 'paused' : 'on'}
                onClick={() => {
                  if (follow.paused) follow.jump();
                  else setFollowing(false);
                }}
              >
                {follow.paused ? 'Follow latest (paused)' : 'Following latest'}
              </Button>
            ) : (
              // Off: a small icon that does not cover the text behind it.
              <IconButton
                size="sm"
                variant="solid"
                className="rd-follow-toggle"
                label="Follow latest changes"
                icon={<LocateFixed size={16} />}
                pressed={false}
                data-testid="rd-follow-latest"
                data-state="off"
                onClick={() => setFollowing(true)}
              />
            )}
          </div>
        </div>
      </div>
      {editor ? (
        <LinkPopover
          editor={editor}
          open={link.open && editable}
          anchor={link.anchor}
          onClose={() => setLink({ open: false, anchor: null })}
          openLink={runtime.openLink}
        />
      ) : null}
    </div>
  );
}

/**
 * Collaborative document editor / viewer. Rebinds to a fresh Y.Doc when the
 * session replaces it (snapshot restore, access change with pending work).
 */
export function DocumentEditor(props: DocumentEditorProps) {
  const { session } = props;
  const [binding, setBinding] = useState(() => ({
    session,
    ydoc: session.ydoc,
    awareness: session.awareness,
    key: 0,
  }));

  useEffect(() => {
    const sync = (): void =>
      setBinding((previous) =>
        previous.session === session && previous.ydoc === session.ydoc
          ? previous
          : { session, ydoc: session.ydoc, awareness: session.awareness, key: previous.key + 1 },
      );
    sync();
    return session.onDocumentReplaced(sync);
  }, [session]);

  // A session change is visible one render before the effect above ran.
  if (binding.session !== session) return null;
  return (
    <EditorSurface key={binding.key} {...props} ydoc={binding.ydoc} awareness={binding.awareness} />
  );
}

export type { Editor };
