/**
 * Shared helpers for the collaboration tests (Node environment, real
 * Hocuspocus fixture server, `ws` client sockets, fake IndexedDB).
 */
import { Y_FRAGMENT_FIELD, type EffectiveRole } from '@realtimedocs/contracts';
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import {
  createCollabSession,
  type CollabSession,
  type CollabSessionOptions,
  type SessionTiming,
} from '../src/collab/session';
import type { SessionStatus } from '../src/collab/status';
import type { DocJSON } from '../src/schema/index';
import type { FixtureServer, Principal } from './fixture-server';

/** Short timers so reconnect and retry paths run in milliseconds. */
export const FAST_TIMING: Partial<SessionTiming> = {
  backoff: { baseMs: 20, maxMs: 160, factor: 2, jitter: 0.5 },
  markCoalesceMs: 2,
  ackWatchdogMs: 250,
  connectTimeoutMs: 4_000,
  resyncBackoff: { baseMs: 10, maxMs: 40, factor: 2, jitter: 0.5 },
  presenceIntervalMs: 5,
};

export function openSession(
  fixture: FixtureServer,
  principal: Principal,
  documentId: string,
  overrides: Partial<CollabSessionOptions> = {},
): CollabSession {
  return createCollabSession({
    api: fixture.client(principal),
    documentId,
    accountId: principal.accountId,
    WebSocketPolyfill: WebSocket,
    timing: FAST_TIMING,
    ...overrides,
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until `predicate` is truthy; fails with `label` after `timeoutMs`. */
export async function waitFor<T>(
  predicate: () => T | false | null | undefined,
  label: string,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${label}`);
    await sleep(5);
  }
}

/** Like `waitFor` for asynchronous lookups. */
export async function waitForAsync<T>(
  lookup: () => Promise<T | false | null | undefined>,
  label: string,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await lookup();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${label}`);
    await sleep(5);
  }
}

export function waitForStatus(
  session: CollabSession,
  predicate: (status: SessionStatus) => boolean,
  label: string,
  timeoutMs = 5_000,
): Promise<SessionStatus> {
  return waitFor(
    () => (predicate(session.getStatus()) ? session.getStatus() : null),
    `${label} (last: ${JSON.stringify(summarise(session.getStatus()))})`,
    timeoutMs,
  );
}

export function summarise(status: SessionStatus): Record<string, unknown> {
  return {
    connection: status.connection,
    save: status.save,
    role: status.role,
    canEdit: status.canEdit,
    generation: status.generation,
    pending: status.pendingChanges,
    ready: status.ready,
  };
}

/** Records every status the session publishes (to assert what never happened). */
export function recordStatuses(session: CollabSession): {
  seen: SessionStatus[];
  stop: () => void;
} {
  const seen: SessionStatus[] = [session.getStatus()];
  const stop = session.subscribe(() => {
    seen.push(session.getStatus());
  });
  return { seen, stop };
}

function fragment(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment(Y_FRAGMENT_FIELD);
}

/** Appends a paragraph the way the editor binding would (one local transaction). */
export function appendParagraph(doc: Y.Doc, text: string): void {
  doc.transact(() => {
    const paragraph = new Y.XmlElement('paragraph');
    const content = new Y.XmlText();
    content.insert(0, text);
    paragraph.insert(0, [content]);
    fragment(doc).push([paragraph]);
  });
}

/** Deletion-only transaction: removes the block at `index`. */
export function deleteBlock(doc: Y.Doc, index: number): void {
  doc.transact(() => {
    fragment(doc).delete(index, 1);
  });
}

/** Deletion-only transaction inside a text node. */
export function deleteText(doc: Y.Doc, blockIndex: number, from: number, length: number): void {
  doc.transact(() => {
    const block = fragment(doc).get(blockIndex) as Y.XmlElement;
    (block.get(0) as Y.XmlText).delete(from, length);
  });
}

export function paragraphs(doc: Y.Doc): string[] {
  return jsonParagraphs(yDocToProsemirrorJSON(doc, Y_FRAGMENT_FIELD) as DocJSON);
}

export function jsonParagraphs(json: DocJSON): string[] {
  return (json.content ?? []).map((node) =>
    (node.content ?? []).map((child) => child.text ?? '').join(''),
  );
}

export function paragraphDoc(...texts: string[]): DocJSON {
  return {
    type: 'doc',
    content: texts.map((text) =>
      text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' },
    ),
  };
}

export interface Scenario {
  fixture: FixtureServer;
  documentId: string;
  editor: Principal;
  viewer: Principal;
  sessions: CollabSession[];
  open: (
    principal: Principal,
    overrides?: Partial<CollabSessionOptions>,
    documentId?: string,
  ) => CollabSession;
}

export function scenario(
  fixture: FixtureServer,
  content?: DocJSON,
  indexedDB?: IDBFactory,
): Scenario {
  const documentId = fixture.createDocument({ title: 'Launch notes', content });
  const editor = fixture.addPrincipal({ name: 'Asha (editor)' });
  const viewer = fixture.addPrincipal({ name: 'Guest reader', accountId: null });
  fixture.grant(editor, documentId, 'editor');
  fixture.grant(viewer, documentId, 'viewer');
  const sessions: CollabSession[] = [];
  return {
    fixture,
    documentId,
    editor,
    viewer,
    sessions,
    open(principal, overrides = {}, id = documentId) {
      const session = openSession(fixture, principal, id, { indexedDB, ...overrides });
      sessions.push(session);
      return session;
    },
  };
}

export function addEditor(
  scene: Scenario,
  name: string,
  role: EffectiveRole = 'editor',
): Principal {
  const principal = scene.fixture.addPrincipal({ name });
  scene.fixture.grant(principal, scene.documentId, role);
  return principal;
}

export const live = (status: SessionStatus): boolean => status.connection === 'live';
export const liveAndSaved = (status: SessionStatus): boolean =>
  status.connection === 'live' && status.save === 'saved';
