/**
 * Connects the upload manager to the document.
 *
 * - `insertFiles` inserts placeholder nodes (image or attachment) carrying a
 *   stable `uploadId` and starts the uploads. Placeholders are ordinary
 *   document content: their order is fixed at insertion time and does not
 *   depend on which upload finishes first.
 * - When an upload finishes, the node with that `uploadId` is updated wherever
 *   it now is (the cursor is irrelevant) with `addToHistory: false`.
 * - If no such node exists (undone, deleted, cut), nothing is inserted. If it
 *   reappears later (redo, undo of a delete), it is completed then.
 * - No document change is dispatched while an IME composition is active.
 */
import { Extension } from '@tiptap/core';
import type { Asset } from '@realtimedocs/contracts';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import { uuidv4 } from '../collab/ids';
import { NODE_ATTACHMENT, NODE_IMAGE } from '../schema';
import { FALLBACK_LIMITS, checkFile, type UploadLimits } from './limits';
import type { UploadManager } from './manager';

export interface UploadsOptions {
  manager: UploadManager | null;
  canEdit: () => boolean;
  limits: () => UploadLimits;
  /** Files that failed the client-side checks, with the reason in words. */
  onRejected: (messages: string[]) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    rdUploads: {
      /** Inserts upload placeholders at the selection (or `position`) and starts uploading. */
      insertFiles: (files: readonly File[], position?: number) => ReturnType;
      /** Removes the placeholder(s) of one upload without adding an undo step. */
      removeUploadNode: (uploadId: string) => ReturnType;
    };
  }
}

interface UploadPluginState {
  /** Upload ids of placeholders currently in the document. */
  present: ReadonlySet<string>;
}

export const uploadPluginKey = new PluginKey<UploadPluginState>('rdUploads');

function collect(doc: PMNode, from: number, to: number, into: Set<string>): void {
  const start = Math.max(0, from);
  const end = Math.min(doc.content.size, to);
  if (end <= start) return;
  doc.nodesBetween(start, end, (node) => {
    const id: unknown = node.attrs.uploadId;
    if (typeof id === 'string' && id) into.add(id);
    return true;
  });
}

export function findUploadNodes(doc: PMNode, uploadId: string): { node: PMNode; pos: number }[] {
  const found: { node: PMNode; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.attrs.uploadId === uploadId) found.push({ node, pos });
    return !node.isTextblock;
  });
  return found;
}

function completedAttrs(node: PMNode, asset: Asset): Record<string, unknown> {
  if (node.type.name === NODE_IMAGE) {
    return {
      ...node.attrs,
      assetId: asset.id,
      uploadId: null,
      naturalWidth: asset.width,
      naturalHeight: asset.height,
      name: asset.name || node.attrs.name,
    };
  }
  return {
    ...node.attrs,
    assetId: asset.id,
    uploadId: null,
    name: asset.name || node.attrs.name,
    sizeBytes: asset.sizeBytes,
    mime: asset.mime,
  };
}

/** Delay before retrying a document change that had to wait for an IME composition. */
const COMPOSITION_RETRY_MS = 120;

export const Uploads = Extension.create<UploadsOptions>({
  name: 'rdUploads',

  addOptions() {
    return {
      manager: null,
      canEdit: () => false,
      limits: () => FALLBACK_LIMITS,
      onRejected: () => {},
    };
  },

  addCommands() {
    return {
      insertFiles:
        (files, position) =>
        ({ state, tr, dispatch }) => {
          const { manager, canEdit, limits, onRejected } = this.options;
          if (!manager || !canEdit() || files.length === 0) return false;
          const imageType = state.schema.nodes[NODE_IMAGE];
          const attachmentType = state.schema.nodes[NODE_ATTACHMENT];
          if (!imageType || !attachmentType) return false;
          const currentLimits = limits();
          const nodes: PMNode[] = [];
          const starts: (() => void)[] = [];
          const rejected: string[] = [];
          for (const file of files) {
            const verdict = checkFile(file, currentLimits);
            if (!verdict.ok) {
              rejected.push(verdict.message);
              continue;
            }
            const uploadId = uuidv4();
            const name = (file.name || (verdict.kind === 'image' ? 'image' : 'file')).slice(0, 255);
            nodes.push(
              verdict.kind === 'image'
                ? imageType.create({ uploadId, name })
                : attachmentType.create({
                    uploadId,
                    name,
                    sizeBytes: file.size,
                    mime: (file.type || 'application/octet-stream').slice(0, 127),
                  }),
            );
            starts.push(() => manager.start(uploadId, file, name, verdict.kind));
          }
          if (rejected.length > 0 && dispatch) onRejected(rejected);
          if (nodes.length === 0) return false;
          if (!dispatch) return true;

          const slice = new Slice(Fragment.from(nodes), 0, 0);
          if (position === undefined) {
            tr.replaceSelection(slice);
          } else {
            const safe = Math.min(Math.max(0, position), tr.doc.content.size);
            tr.insert(dropPoint(tr.doc, safe, slice) ?? safe, slice.content);
          }
          // Keep a place to type after the last inserted block.
          const lastId: unknown = nodes.at(-1)?.attrs.uploadId;
          const last = typeof lastId === 'string' ? findUploadNodes(tr.doc, lastId).at(-1) : null;
          if (last) {
            const after = last.pos + last.node.nodeSize;
            const $after = tr.doc.resolve(after);
            const paragraph = state.schema.nodes.paragraph;
            if (!$after.nodeAfter && $after.depth === 0 && paragraph) {
              tr.insert(after, paragraph.create());
            }
            tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1));
          }
          dispatch(tr.scrollIntoView());
          for (const start of starts) start();
          return true;
        },

      removeUploadNode:
        (uploadId) =>
        ({ state, tr, dispatch }) => {
          const targets = findUploadNodes(state.doc, uploadId);
          if (targets.length === 0 || !this.options.canEdit()) return false;
          if (dispatch) {
            for (const { node, pos } of targets.reverse()) tr.delete(pos, pos + node.nodeSize);
            dispatch(tr.setMeta('addToHistory', false));
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { manager, canEdit } = this.options;
    return [
      new Plugin<UploadPluginState>({
        key: uploadPluginKey,
        state: {
          init(_config, state) {
            const present = new Set<string>();
            collect(state.doc, 0, state.doc.content.size, present);
            return { present };
          },
          apply(tr, value) {
            if (!tr.docChanged) return value;
            const removed = new Set<string>();
            const added = new Set<string>();
            tr.steps.forEach((step, index) => {
              const before = tr.docs[index];
              const after = tr.docs[index + 1] ?? tr.doc;
              if (!before) return;
              step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
                collect(before, oldStart, oldEnd, removed);
                collect(after, newStart, newEnd, added);
              });
            });
            if (removed.size === 0 && added.size === 0) return value;
            const present = new Set(value.present);
            for (const id of removed) present.delete(id);
            for (const id of added) present.add(id);
            return { present };
          },
        },
        view(view: EditorView) {
          if (!manager) return {};
          const waiting = new Set<string>();
          let timer: ReturnType<typeof setTimeout> | null = null;
          let destroyed = false;

          const flush = (): void => {
            timer = null;
            if (destroyed || view.isDestroyed || waiting.size === 0) return;
            // Never change the document under an active IME composition.
            if (view.composing) {
              timer = setTimeout(flush, COMPOSITION_RETRY_MS);
              return;
            }
            if (!canEdit()) {
              waiting.clear();
              return;
            }
            const tr = view.state.tr;
            for (const uploadId of [...waiting]) {
              waiting.delete(uploadId);
              const asset = manager.completedAsset(uploadId);
              if (!asset) continue;
              for (const { node, pos } of findUploadNodes(tr.doc, uploadId)) {
                tr.setNodeMarkup(pos, undefined, completedAttrs(node, asset));
              }
            }
            if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
          };

          const schedule = (uploadId: string): void => {
            waiting.add(uploadId);
            timer ??= setTimeout(flush, 0);
          };

          const stop = manager.onCompleted((uploadId) => schedule(uploadId));

          return {
            update(updated, previous) {
              const present = uploadPluginKey.getState(updated.state)?.present;
              if (!present || present.size === 0) return;
              const before = uploadPluginKey.getState(previous)?.present;
              if (before === present) return;
              // A placeholder that is (again) in the document although its
              // upload already finished: redo, or undo of a deletion.
              for (const uploadId of present) {
                if (!before?.has(uploadId) && manager.completedAsset(uploadId)) schedule(uploadId);
              }
            },
            destroy() {
              destroyed = true;
              stop();
              if (timer !== null) clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});
