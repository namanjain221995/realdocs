/**
 * Runtime shared by the editor chrome and the node views of one editor
 * instance. Node views are rendered through portals inside `EditorContent`,
 * so React context reaches them; values that change over time are stores a
 * node view subscribes to individually.
 */
import type { ApiClient } from '@realtimedocs/contracts';
import { createContext, useContext } from 'react';
import type { PasteReport } from '../clipboard/report';
import type { UploadManager } from '../uploads/manager';
import type { DiagramTheme } from './mermaid';
import type { ValueStore } from './store';

export interface EditorRuntime {
  api: ApiClient;
  documentId: string;
  /** Null in static (print / draft) rendering. */
  uploads: UploadManager | null;
  /** The session may edit right now. */
  editable: ValueStore<boolean>;
  /** Effective colour scheme of the document surface (for diagrams). */
  theme: ValueStore<DiagramTheme>;
  /** Opens a sanitized link (host callback first, then a new tab). */
  openLink: (href: string) => void;
  reportPaste: (report: PasteReport) => void;
  /** Short, non-blocking message (upload rejected, …). */
  notify: (message: string) => void;
}

export const RuntimeContext = createContext<EditorRuntime | null>(null);

export function useRuntime(): EditorRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('RealtimeDocs node views must render inside an editor.');
  return runtime;
}
