/**
 * Clipboard, drag-and-drop and link clicks.
 *
 * Paste pipeline (see process.ts): every HTML payload — pasted or dropped —
 * is sanitized and normalized before ProseMirror parses it. Embedded images
 * become upload placeholders; files from the clipboard, a drop or the file
 * picker go through the same upload path. Remote URLs are never fetched.
 */
import { Extension } from '@tiptap/core';
import { DOMSerializer, type Fragment, type Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { uuidv4 } from '../collab/ids';
import { sanitizeLinkHref } from '../schema/links';
import { FALLBACK_LIMITS, type UploadLimits } from '../uploads/limits';
import type { UploadManager } from '../uploads/manager';
import { MAX_PASTE_TEXT_LENGTH, processPastedHtml, type ProcessedPaste } from './process';
import { PasteNotes, buildReport, isReportWorthShowing, type PasteReport } from './report';

export interface ClipboardOptions {
  documentId: string;
  uploads: UploadManager | null;
  canEdit: () => boolean;
  limits: () => UploadLimits;
  onReport: (report: PasteReport) => void;
  /** Opens a link after it passed `sanitizeLinkHref`. */
  openLink: (href: string) => void;
  /** A link was clicked while editing (opens the link editor instead of navigating). */
  onLinkActivated: (anchor: HTMLAnchorElement) => void;
}

/** True when the HTML flavour is nothing but one or more images (no text). */
function isImageOnlyHtml(html: string): boolean {
  if (!/<img\b/i.test(html)) return false;
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ');
  return text.trim() === '';
}

function uploadIdsIn(fragment: Fragment): Set<string> {
  const ids = new Set<string>();
  fragment.descendants((node) => {
    const id: unknown = node.attrs.uploadId;
    if (typeof id === 'string' && id) ids.add(id);
    return true;
  });
  return ids;
}

export const Clipboard = Extension.create<ClipboardOptions>({
  name: 'rdClipboard',

  addOptions() {
    return {
      documentId: '',
      uploads: null,
      canEdit: () => false,
      limits: () => FALLBACK_LIMITS,
      onReport: () => {},
      openLink: () => {},
      onLinkActivated: () => {},
    };
  },

  addProseMirrorPlugins() {
    const { editor, options } = this;
    // Result of `transformPastedHTML` for the paste or drop being handled.
    let pending: ProcessedPaste | null = null;

    /** Starts the uploads whose placeholders made it into the inserted slice. */
    const consume = (slice: Slice): ProcessedPaste | null => {
      const current = pending;
      pending = null;
      if (!current) return null;
      if (current.html !== null && options.uploads && current.images.length > 0) {
        const present = uploadIdsIn(slice.content);
        for (const image of current.images) {
          if (!present.has(image.uploadId)) continue;
          options.uploads.start(
            image.uploadId,
            new Blob([image.bytes], { type: image.mime }),
            image.name,
            'image',
          );
        }
      }
      if (isReportWorthShowing(current.report)) options.onReport(current.report);
      return current;
    };

    const base = DOMSerializer.fromSchema(editor.schema);
    // Marks copied content with its document, so a paste can tell which
    // asset ids are valid here.
    const clipboardSerializer = Object.create(base) as DOMSerializer;
    clipboardSerializer.serializeFragment = (fragment, serializeOptions, target) => {
      const dom = base.serializeFragment(fragment, serializeOptions, target);
      const mark = (element: Element): void =>
        element.setAttribute('data-rd-doc', options.documentId);
      for (const child of [...dom.childNodes]) {
        if (child.nodeType !== 1) continue;
        mark(child as Element);
        for (const asset of (child as Element).querySelectorAll(
          '[data-asset-id], [data-upload-id]',
        )) {
          mark(asset);
        }
      }
      return dom;
    };

    const activateLink = (view: EditorView, event: MouseEvent): boolean => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || !view.dom.contains(anchor) || anchor.hasAttribute('data-rd-download')) {
        return false;
      }
      // Never let the browser (or Electron) navigate on its own.
      event.preventDefault();
      const href = sanitizeLinkHref(anchor.getAttribute('href'));
      if (!href) return true;
      const wantsOpen = !view.editable || event.metaKey || event.ctrlKey || event.button === 1;
      if (wantsOpen) options.openLink(href);
      else options.onLinkActivated(anchor);
      return false;
    };

    return [
      new Plugin({
        key: new PluginKey('rdClipboard'),
        props: {
          clipboardSerializer,

          transformPastedHTML(html) {
            const limits = options.limits();
            const mayUpload = options.uploads !== null && options.canEdit();
            pending = processPastedHtml(html, {
              documentId: options.documentId,
              createUploadId: uuidv4,
              acceptImage: mayUpload
                ? ({ mime, sizeBytes }) =>
                    limits.imageMimeTypes.includes(mime) &&
                    sizeBytes > 0 &&
                    sizeBytes <= limits.maxImageBytes
                : undefined,
            });
            return pending.html ?? '';
          },

          handlePaste(view, event, slice) {
            const data = event.clipboardData;
            const files = data ? [...data.files] : [];
            const html = data?.getData('text/html') ?? '';
            const text = data?.getData('text/plain') ?? '';

            // Screenshots and "copy image": the file is the content.
            if (files.length > 0 && options.uploads && (!html.trim() || isImageOnlyHtml(html))) {
              pending = null;
              event.preventDefault();
              editor.commands.insertFiles(files);
              return true;
            }

            const processed = consume(slice);
            if (processed) {
              if (processed.html !== null) return false;
              // Formatting could not be imported: fall back to the text flavour.
              if (text && text.length <= MAX_PASTE_TEXT_LENGTH) view.pasteText(text);
              return true;
            }

            if (text.length > MAX_PASTE_TEXT_LENGTH) {
              const notes = new PasteNotes();
              notes.add('text-too-large');
              options.onReport(buildReport('plain-text', notes));
              return true;
            }
            return false;
          },

          handleDrop(view, event, slice, moved) {
            if (moved) {
              pending = null;
              return false;
            }
            const files = [...(event.dataTransfer?.files ?? [])];
            if (files.length > 0 && options.uploads) {
              pending = null;
              event.preventDefault();
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              editor.commands.insertFiles(files, at?.pos);
              return true;
            }
            consume(slice);
            return false;
          },

          handleDOMEvents: {
            paste() {
              pending = null;
              return false;
            },
            click: (view, event) => activateLink(view, event),
            auxclick: (view, event) => activateLink(view, event),
          },
        },
      }),
    ];
  },
});
