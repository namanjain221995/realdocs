/**
 * The shared document surface used by the web app and the desktop panel.
 *
 * Rendering strategy: this component subscribes only to the few session
 * values it needs (can edit, ready), the toolbar subscribes to a narrow,
 * frame-throttled formatting snapshot, and node views re-render when their
 * own node changes. Typing a character therefore re-renders no React
 * component outside the node being edited.
 */
import {
  Y_FRAGMENT_FIELD,
  normalizePageSettings,
  type ApiClient,
  type PageSettings,
} from '@realtimedocs/contracts';
import { Button, IconButton, Skeleton, cx } from '@realtimedocs/ui';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { yUndoPluginKey, ySyncPluginKey } from '@tiptap/y-tiptap';
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
import {
  describeUnsupportedContent,
  emptyUnsupportedContent,
  sameUnsupportedContent,
  scanUnsupportedContent,
  type UnsupportedContent,
} from '../editor/unsupported';
import { pageStyleVars } from '../page/css';
import { pageMap } from '../page/store';
import { usePageSettings } from '../page/usePageSettings';
import { sanitizeLinkHref } from '../schema';
import { currentLimits, loadUploadLimits } from '../uploads/limits';
import { UploadManager } from '../uploads/manager';
import { displayProps, effectiveTheme, resolveDisplay, type DisplayPreferences } from './display';
import { EditorToolbar } from './EditorToolbar';
import { FindBar } from './FindBar';
import { useFollowLatest, useScrollAnchor } from './followLatest';
import { LinkPopover } from './LinkPopover';
import { MessageNotice, PasteReportNotice } from './Notices';
import { resolvePageMode } from '../page/mode';
import { PageRuler } from './PageRuler';
import { PageSetupDialog } from './PageSetupDialog';
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
  /**
   * `page`: the document is drawn as a sheet with the page size, margins and colour stored in the
   * document, with a ruler for editors. `reading`: the per-user reading width, no page chrome.
   * Defaults to `page`, except for `variant="panel"` which is always `reading`.
   */
  layout?: 'page' | 'reading';
  /**
   * `variant="panel"` only: apply the document's left and right margins to the text column and
   * show the ruler to editors, without the sheet, its colour or its height. The panel keeps its
   * own background and appearance. Narrow panels shrink the margins in proportion.
   */
  pageMargins?: boolean;
  /** Controls the "Page setup" dialog from the host (the toolbar button uses it as well). */
  pageSetupOpen?: boolean;
  onPageSetupOpenChange?: (open: boolean) => void;
  /**
   * How this host gets a newer version when the document holds content this
   * build does not know (web: reload; desktop: open the update). Without it
   * the notice asks to reload the page.
   */
  upgrade?: { label: string; hint: string; run: () => void };
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
  layout,
  pageMargins,
  pageSetupOpen,
  onPageSetupOpenChange,
  upgrade,
  className,
  ydoc,
  awareness,
  'data-testid': testId,
}: SurfaceProps) {
  const documentId = session.documentId;
  const canEdit = useSessionSelector(session, selectCanEdit);
  const ready = useSessionSelector(session, selectReady);
  // Content this client cannot represent: named by a scan of the shared document
  // (`unsupported`), or reported by the binding as not fitting the schema (`misfit`).
  // Both stop editing here and both clear by themselves when the content is fine again.
  const [unsupported, setUnsupported] = useState<UnsupportedContent>(emptyUnsupportedContent);
  const [misfit, setMisfit] = useState(false);
  const invalidContent = unsupported.total > 0 || misfit;
  const editable = canEdit && variant !== 'viewer' && !invalidContent;
  const editableRef = useLatest(editable);
  const onOpenLinkRef = useLatest(onOpenLink);

  // Page settings are shared state in the same Y.Doc (map `page`). Writes are tagged with the
  // sync plugin's key so the editor's own undo manager records them (see the effect below).
  const pageControls = usePageSettings(ydoc, { origin: ySyncPluginKey, canEdit: editable });
  const [pagePreview, setPagePreview] = useState<Partial<PageSettings> | null>(null);
  const pageSettings = useMemo(
    () =>
      pagePreview
        ? normalizePageSettings({ ...pageControls.settings, ...pagePreview })
        : pageControls.settings,
    [pageControls.settings, pagePreview],
  );

  const [report, setReport] = useState<PasteReport | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [findOpen, setFindOpen] = useState(false);
  const [link, setLink] = useState<{ open: boolean; anchor: HTMLElement | null }>({
    open: false,
    anchor: null,
  });
  const [followLocal, setFollowLocal] = useState(false);
  const [setupLocal, setSetupLocal] = useState(false);
  const setupOpen = pageSetupOpen ?? setupLocal;
  const setSetupOpen = useCallback(
    (open: boolean): void => {
      setSetupLocal(open);
      onPageSetupOpenChange?.(open);
    },
    [onPageSetupOpenChange],
  );
  const pageMode = resolvePageMode({ variant, layout, pageMargins });
  const pageLayout = pageMode === 'page';
  // The ruler, the margins and the setup dialog; `pageLayout` adds the sheet itself.
  const pageAware = pageMode !== 'none';
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
          onInvalidContent: () => setMisfit(true),
        },
        uploads,
        canEdit: () => editableRef.current,
        limits: () => currentLimits(api),
        onPasteReport: runtime.reportPaste,
        onRejectedFiles: (rejected) =>
          setMessages((previous) => [...previous, ...rejected].slice(-4)),
        openLink: runtime.openLink,
        onLinkActivated: (anchor) => setLink({ open: true, anchor }),
        onPasteStart: () => session.announcePaste(),
      }),
    [api, awareness, documentId, editableRef, runtime, session, uploads, ydoc],
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

  // Re-evaluate after every change of the shared content (at most four times a second).
  useEffect(() => {
    if (!editor) return undefined;
    const fragment = ydoc.getXmlFragment(Y_FRAGMENT_FIELD);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const evaluate = (): void => {
      timer = null;
      if (editor.isDestroyed) return;
      const next = scanUnsupportedContent(fragment, editor.schema);
      setUnsupported((previous) => (sameUnsupportedContent(previous, next) ? previous : next));
      let fits = true;
      try {
        editor.state.doc.check();
      } catch {
        fits = false;
      }
      // Everything this client does not know is skipped by the binding, so a
      // document that still does not fit is damaged, not merely newer.
      const nextMisfit = !fits && next.total === 0;
      // Only when it changed: an unchanged value must not even schedule a render
      // while someone is typing.
      setMisfit((previous) => (previous === nextMisfit ? previous : nextMisfit));
    };
    const schedule = (): void => {
      timer ??= setTimeout(evaluate, 250);
    };
    evaluate();
    fragment.observeDeep(schedule);
    return () => {
      fragment.unobserveDeep(schedule);
      if (timer) clearTimeout(timer);
    };
  }, [editor, ydoc]);

  // Margin changes join the person's own undo history, in order with their typing.
  const undoManager = useCallback(
    () =>
      editor && !editor.isDestroyed ? yUndoPluginKey.getState(editor.state)?.undoManager : null,
    [editor],
  );
  useEffect(() => {
    undoManager()?.addToScope(pageMap(ydoc));
  }, [undoManager, ydoc]);
  const { update: updatePage, reset: resetPage } = pageControls;
  const updatePageSettings = useCallback(
    (patch: Partial<PageSettings>): void => {
      const manager = undoManager();
      // Never merge a page change into the typing around it: one change, one undo step.
      manager?.stopCapturing();
      updatePage(patch);
      manager?.stopCapturing();
    },
    [undoManager, updatePage],
  );
  const resetPageSettings = useCallback((): void => {
    const manager = undoManager();
    manager?.stopCapturing();
    resetPage();
    manager?.stopCapturing();
  }, [undoManager, resetPage]);
  const undoPage = useCallback(() => undoManager()?.undo(), [undoManager]);
  const redoPage = useCallback(() => undoManager()?.redo(), [undoManager]);

  useEffect(() => {
    runtime.editable.set(editable);
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable, runtime]);

  // Colour scheme of the surface, for diagram previews.
  const resolved = useMemo(() => resolveDisplay(display), [display]);
  useEffect(() => {
    // Diagrams are drawn for the colour of the paper they sit on.
    const update = (): void =>
      runtime.theme.set(
        pageLayout && pageSettings.background !== 'default'
          ? 'light'
          : effectiveTheme(rootRef.current, resolved.tone),
      );
    update();
    if (resolved.tone !== 'inherit' || typeof MutationObserver !== 'function') return undefined;
    const observer = new MutationObserver(update);
    for (let node = rootRef.current?.parentElement; node; node = node.parentElement) {
      observer.observe(node, { attributes: true, attributeFilter: ['data-theme'] });
    }
    return () => observer.disconnect();
  }, [resolved.tone, runtime, pageLayout, pageSettings.background]);

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
      data-layout={pageLayout ? 'page' : 'reading'}
      data-margins={pageMode === 'margins' ? 'page' : undefined}
      {...attributes}
      style={pageAware ? { ...attributes.style, ...pageStyleVars(pageSettings) } : attributes.style}
      onKeyDown={onKeyDown}
    >
      {showToolbar ? (
        <EditorToolbar
          editor={editor}
          onFind={openFind}
          onLink={openLinkEditor}
          onPageSetup={pageAware ? () => setSetupOpen(true) : undefined}
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
        <div className="rd-editor__warning" role="alert" data-testid="rd-editor-unsupported">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>
            {unsupported.total > 0 ? (
              <>
                This document uses content that this version of RealtimeDocs does not know:{' '}
                {describeUnsupportedContent(unsupported)}. It is kept in the document and is not
                shown here. Editing is paused in this window so that nothing is lost.{' '}
                {upgrade?.hint ?? 'Reload the page to get the current version.'}
              </>
            ) : (
              <>
                Part of this document does not have the structure RealtimeDocs expects, so it cannot
                be edited safely here. Nothing was removed. An administrator can restore an earlier
                version from the version history.
              </>
            )}
          </span>
          {unsupported.total > 0 && upgrade ? (
            <Button size="sm" variant="secondary" onClick={upgrade.run}>
              {upgrade.label}
            </Button>
          ) : null}
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
        {pageAware && editable ? (
          <PageRuler
            settings={pageSettings}
            canEdit
            onPreview={setPagePreview}
            onCommit={updatePageSettings}
            onUndo={undoPage}
            onRedo={redoPage}
          />
        ) : null}
        <div
          className="rd-editor__page"
          data-page-bg={pageLayout ? pageSettings.background : undefined}
          data-theme={pageLayout && pageSettings.background !== 'default' ? 'light' : undefined}
          onMouseDown={onPageMouseDown}
        >
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
      {pageAware ? (
        <PageSetupDialog
          open={setupOpen}
          onOpenChange={setSetupOpen}
          settings={pageControls.settings}
          canEdit={editable}
          onChange={updatePageSettings}
          onReset={resetPageSettings}
        />
      ) : null}
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
