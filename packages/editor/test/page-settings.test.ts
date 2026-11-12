import { DEFAULT_PAGE_SETTINGS, Y_PAGE_FIELD } from '@realtimedocs/contracts';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createPageSettingsStore,
  pageMap,
  readPageSettings,
  resetPageSettings,
  setPageSettings,
} from '../src/page/store';

function connect(a: Y.Doc, b: Y.Doc): () => void {
  const forward = (from: Y.Doc, to: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(to, update, 'remote');
  };
  const ab = forward(a, b);
  const ba = forward(b, a);
  a.on('update', ab);
  b.on('update', ba);
  return () => {
    a.off('update', ab);
    b.off('update', ba);
  };
}

describe('page settings in the Yjs document', () => {
  it('is empty (defaults) for a new document', () => {
    const doc = new Y.Doc();
    expect(pageMap(doc).size).toBe(0);
    expect(readPageSettings(doc)).toEqual(DEFAULT_PAGE_SETTINGS);
    expect(doc.getMap(Y_PAGE_FIELD)).toBe(pageMap(doc));
  });

  it('writes only the changed keys, in one transaction', () => {
    const doc = new Y.Doc();
    const transactions = vi.fn();
    doc.on('afterTransaction', transactions);
    expect(setPageSettings(doc, { marginLeft: 30, marginRight: 30 })).toBe(true);
    expect(transactions).toHaveBeenCalledTimes(1);
    expect(pageMap(doc).toJSON()).toEqual({ marginLeft: 30, marginRight: 30 });
    // The same values again change nothing.
    expect(setPageSettings(doc, { marginLeft: 30 })).toBe(false);
    expect(transactions).toHaveBeenCalledTimes(1);
  });

  it('clamps on write and reads back valid values', () => {
    const doc = new Y.Doc();
    setPageSettings(doc, { marginLeft: 500, size: 'letter' });
    expect(readPageSettings(doc)).toMatchObject({ marginLeft: 100, size: 'letter' });
  });

  it('survives hostile content written by another client', () => {
    const doc = new Y.Doc();
    const map = pageMap(doc);
    map.set('marginLeft', 'DROP TABLE');
    map.set('size', { a: 1 });
    map.set('background', 'url(x)');
    map.set('extra', 1);
    expect(readPageSettings(doc)).toEqual(DEFAULT_PAGE_SETTINGS);
  });

  it('syncs a change between two documents and converges after concurrent edits', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const stop = connect(a, b);
    setPageSettings(a, { marginTop: 10 });
    expect(readPageSettings(b).marginTop).toBe(10);
    stop();
    // Offline: different keys merge, the same key resolves identically on both sides.
    setPageSettings(a, { marginLeft: 12, orientation: 'landscape' });
    setPageSettings(b, { marginRight: 14, orientation: 'portrait' });
    setPageSettings(b, { unit: 'in' });
    connect(a, b);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readPageSettings(a)).toEqual(readPageSettings(b));
    expect(readPageSettings(a)).toMatchObject({ marginLeft: 12, marginRight: 14, unit: 'in' });
  });

  it('notifies subscribers only when the normalised value changes', () => {
    const doc = new Y.Doc();
    const store = createPageSettingsStore(doc);
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    const first = store.get();
    pageMap(doc).set('unknown', 1);
    pageMap(doc).set('marginLeft', 'bad');
    expect(listener).not.toHaveBeenCalled();
    expect(store.get()).toBe(first);
    setPageSettings(doc, { marginLeft: 15 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).not.toBe(first);
    stop();
    setPageSettings(doc, { marginLeft: 16 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('resets to defaults', () => {
    const doc = new Y.Doc();
    expect(resetPageSettings(doc)).toBe(false);
    setPageSettings(doc, { marginLeft: 15, background: 'cream' });
    expect(resetPageSettings(doc)).toBe(true);
    expect(readPageSettings(doc)).toEqual(DEFAULT_PAGE_SETTINGS);
  });

  it('one margin change is one undo step when the manager has the map in scope', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('default');
    const origin = { name: 'sync' };
    const undo = new Y.UndoManager(fragment, { trackedOrigins: new Set([origin]) });
    undo.addToScope(pageMap(doc));
    undo.addToScope(pageMap(doc));
    doc.transact(() => fragment.insert(0, [new Y.XmlText('hello')]), origin);
    undo.stopCapturing();
    setPageSettings(doc, { marginLeft: 30, marginRight: 31 }, origin);
    undo.stopCapturing();
    expect(undo.undoStack.length).toBe(2);
    undo.undo();
    expect(readPageSettings(doc)).toEqual(DEFAULT_PAGE_SETTINGS);
    expect(fragment.length).toBe(1);
    undo.redo();
    expect(readPageSettings(doc)).toMatchObject({ marginLeft: 30, marginRight: 31 });
  });

  it("a person's undo does not revert a collaborator's margin change", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    connect(a, b);
    const origin = { name: 'sync' };
    const undo = new Y.UndoManager(a.getXmlFragment('default'), {
      trackedOrigins: new Set([origin]),
    });
    undo.addToScope(pageMap(a));
    setPageSettings(a, { marginLeft: 30 }, origin);
    setPageSettings(b, { marginRight: 40 }, 'other');
    undo.undo();
    expect(readPageSettings(b)).toMatchObject({ marginLeft: 25.4, marginRight: 40 });
    expect(readPageSettings(a)).toEqual(readPageSettings(b));
  });
});
