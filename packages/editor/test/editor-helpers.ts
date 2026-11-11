/**
 * A real Tiptap editor with the browser extension set, for jsdom suites.
 *
 * The React node views are replaced by each node's own `renderHTML` (a core
 * `Editor` has no React renderer to mount them); the schema, commands and
 * plugins are exactly those of the product. Node views are covered by the
 * real-browser checks in `demo/e2e.mjs`.
 */
import { ApiError, type ApiClient, type Asset } from '@realtimedocs/contracts';
import { Editor, type AnyExtension, type JSONContent, type Node } from '@tiptap/core';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { PasteReport } from '../src/clipboard/report';
import { createEditorExtensions } from '../src/editor/extensions';
import { FALLBACK_LIMITS, type UploadLimits } from '../src/uploads/limits';
import { UploadManager } from '../src/uploads/manager';

export const DOCUMENT_ID = '11111111-2222-4333-8444-555555555555';

/** jsdom has no layout: give ProseMirror the geometry calls it makes. */
export function installLayoutStubs(): void {
  const rect = (): DOMRect =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
  const list = (): DOMRectList => [] as unknown as DOMRectList;
  const targets: object[] = [Range.prototype, Element.prototype, Text.prototype];
  for (const target of targets) {
    const stubbed = target as { getClientRects?: unknown; getBoundingClientRect?: unknown };
    if (typeof stubbed.getClientRects !== 'function') stubbed.getClientRects = list;
    if (typeof stubbed.getBoundingClientRect !== 'function') stubbed.getBoundingClientRect = rect;
  }
  const element = Element.prototype as { scrollIntoView?: unknown };
  if (typeof element.scrollIntoView !== 'function') element.scrollIntoView = () => {};
  const doc = document as { elementFromPoint?: unknown };
  if (typeof doc.elementFromPoint !== 'function') doc.elementFromPoint = () => null;
}

/** Nodes whose node view is a React component in the product. */
const REACT_NODE_VIEWS = new Set(['codeBlock', 'image', 'attachment', 'diagram']);

function withoutReactNodeViews(extensions: AnyExtension[]): AnyExtension[] {
  return extensions.map((extension) => {
    if (extension.type !== 'node' || !REACT_NODE_VIEWS.has(extension.name)) return extension;
    const plain = (extension as Node).extend({ addNodeView: () => null });
    // Like `configure()`: keep the original parent, so `this.parent` chains
    // (plugins of the code block) are not run once more for the copy.
    plain.parent = extension.parent;
    return plain;
  });
}

export interface UploadCall {
  name: string;
  size: number;
  signal: AbortSignal | undefined;
  progress: (fraction: number) => void;
  /** Completes the request; `asset` defaults to one derived from the file. */
  succeed: (asset?: Partial<Asset>) => Asset;
  fail: (error: unknown) => void;
  settled: boolean;
}

let assetCounter = 0;

export function nextAssetId(): string {
  assetCounter += 1;
  return `aaaaaaaa-0000-4000-8000-${assetCounter.toString(16).padStart(12, '0')}`;
}

/** The part of the API client the editor uses for uploads, driven by the test. */
export class FakeUploadApi {
  readonly calls: UploadCall[] = [];

  readonly client = {
    uploadAsset: (
      documentId: string,
      file: Blob,
      filename: string,
      options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
    ): Promise<Asset> =>
      new Promise<Asset>((resolve, reject) => {
        const call: UploadCall = {
          name: filename,
          size: file.size,
          signal: options.signal,
          progress: (fraction) => options.onProgress?.(fraction),
          succeed: (override = {}) => {
            const image = /\.(png|jpe?g|gif|webp)$/i.test(filename);
            const asset = {
              id: nextAssetId(),
              documentId,
              kind: image ? 'image' : 'attachment',
              name: filename,
              mime: image ? 'image/png' : 'application/pdf',
              sizeBytes: file.size,
              width: image ? 640 : null,
              height: image ? 480 : null,
              createdAt: '2026-01-01T00:00:00.000Z',
              ...override,
            } as Asset;
            call.settled = true;
            resolve(asset);
            return asset;
          },
          fail: (error) => {
            call.settled = true;
            reject(error);
          },
          settled: false,
        };
        // Same behaviour as the real client: an abort rejects with `aborted`.
        options.signal?.addEventListener(
          'abort',
          () => {
            if (call.settled) return;
            call.settled = true;
            reject(new ApiError('aborted', 'The upload was cancelled.'));
          },
          { once: true },
        );
        this.calls.push(call);
      }),
    assetUrl: (documentId: string, assetId: string, download = false): string =>
      `/api/documents/${documentId}/assets/${assetId}${download ? '?download=1' : ''}`,
  } as unknown as ApiClient;

  call(name: string): UploadCall {
    const found = this.calls.filter((entry) => entry.name === name).at(-1);
    if (!found) throw new Error(`no upload request for ${name}`);
    return found;
  }

  get active(): UploadCall[] {
    return this.calls.filter((entry) => !entry.settled);
  }
}

export interface TestEditorOptions {
  content?: JSONContent;
  /** Bind to a Y.Doc (collaboration-aware undo and redo). Default true. */
  collaborative?: boolean;
  canEdit?: boolean;
  limits?: UploadLimits;
  concurrency?: number;
}

export interface TestEditor {
  editor: Editor;
  api: FakeUploadApi;
  manager: UploadManager;
  ydoc: Y.Doc;
  reports: PasteReport[];
  rejected: string[][];
  opened: string[];
  activated: HTMLAnchorElement[];
  setCanEdit: (value: boolean) => void;
  json: () => JSONContent;
  destroy: () => void;
}

export function createTestEditor(options: TestEditorOptions = {}): TestEditor {
  installLayoutStubs();
  const api = new FakeUploadApi();
  const manager = new UploadManager({
    api: api.client,
    documentId: DOCUMENT_ID,
    concurrency: options.concurrency,
  });
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  // Editable while the initial content is written; the requested mode follows.
  let canEdit = true;
  const reports: PasteReport[] = [];
  const rejected: string[][] = [];
  const opened: string[] = [];
  const activated: HTMLAnchorElement[] = [];
  const collaborative = options.collaborative ?? true;

  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({
    element,
    editable: canEdit,
    injectCSS: false,
    extensions: withoutReactNodeViews(
      createEditorExtensions({
        documentId: DOCUMENT_ID,
        collaboration: collaborative
          ? {
              ydoc,
              awareness,
              onInvalidContent: (error) => {
                throw error;
              },
            }
          : undefined,
        uploads: manager,
        canEdit: () => canEdit,
        limits: () => options.limits ?? FALLBACK_LIMITS,
        onPasteReport: (report) => reports.push(report),
        onRejectedFiles: (messages) => rejected.push(messages),
        openLink: (href) => opened.push(href),
        onLinkActivated: (anchor) => activated.push(anchor),
      }),
    ),
    ...(collaborative ? {} : { content: options.content ?? { type: 'doc', content: [] } }),
  });
  if (collaborative && options.content) {
    // Initial content that is not an undo step of the test.
    editor.chain().setContent(options.content).setMeta('addToHistory', false).run();
  }
  if (options.canEdit === false) {
    canEdit = false;
    editor.setEditable(false);
  }

  return {
    editor,
    api,
    manager,
    ydoc,
    reports,
    rejected,
    opened,
    activated,
    setCanEdit: (value) => {
      canEdit = value;
      editor.setEditable(value);
    },
    json: () => editor.getJSON(),
    destroy: () => {
      editor.destroy();
      manager.destroy();
      awareness.destroy();
      ydoc.destroy();
      element.remove();
    },
  };
}

/** Top-level blocks as short strings: `p:text`, `image:<assetId|uploading|empty>`, … */
export function outline(editor: Editor): string[] {
  const lines: string[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name === 'image' || node.type.name === 'attachment') {
      const { assetId, uploadId, name } = node.attrs as {
        assetId: string | null;
        uploadId: string | null;
        name: string;
      };
      const state = assetId ? 'done' : uploadId ? 'uploading' : 'empty';
      lines.push(`${node.type.name}:${name}:${state}`);
    } else {
      lines.push(`${node.type.name === 'paragraph' ? 'p' : node.type.name}:${node.textContent}`);
    }
  });
  return lines;
}

export function file(name: string, type: string, size = 64): File {
  return new File([new Uint8Array(size).fill(7)], name, { type });
}

/** Lets promise callbacks and zero-delay timers of the code under test run. */
export async function settle(ms = 5): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
