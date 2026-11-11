import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { decodeClientSnapshot, snapshotContainedIn } from '../../src/collab/containment';

function pair(): { server: Y.Doc; client: Y.Doc } {
  const server = new Y.Doc();
  server.getText('t').insert(0, 'The quick brown fox jumps over the lazy dog');
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  return { server, client };
}

const sync = (from: Y.Doc, to: Y.Doc) =>
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));

const encoded = (doc: Y.Doc) => Buffer.from(Y.encodeSnapshot(Y.snapshot(doc))).toString('base64');

function contained(server: Y.Doc, client: Y.Doc): boolean {
  const snapshot = decodeClientSnapshot(encoded(client));
  if (!snapshot) throw new Error('snapshot did not decode');
  return snapshotContainedIn(server, snapshot);
}

describe('snapshotContainedIn', () => {
  it('is true when both sides are identical', () => {
    const { server, client } = pair();
    expect(contained(server, client)).toBe(true);
  });

  it('is true when the server is ahead of the client', () => {
    const { server, client } = pair();
    server.getText('t').insert(0, 'server-only ');
    server.getText('t').delete(20, 5);
    expect(contained(server, client)).toBe(true);
  });

  it('is false while the client holds an insert the server lacks', () => {
    const { server, client } = pair();
    client.getText('t').insert(4, 'very ');
    expect(contained(server, client)).toBe(false);
    sync(client, server);
    expect(contained(server, client)).toBe(true);
  });

  it('is false for a deletion-only edit that the state vector cannot show', () => {
    const { server, client } = pair();
    client.getText('t').delete(4, 6);
    // Same state vectors: comparing them alone would wrongly report "in sync".
    expect(Y.encodeStateVector(client)).toEqual(Y.encodeStateVector(server));
    expect(server.getText('t').toString()).toContain('quick');
    expect(contained(server, client)).toBe(false);

    sync(client, server);
    expect(server.getText('t').toString()).not.toContain('quick');
    expect(contained(server, client)).toBe(true);
  });

  it('is false when the server deleted only part of what the client deleted', () => {
    const { server, client } = pair();
    server.getText('t').delete(4, 3);
    sync(server, client);
    client.getText('t').delete(4, 6);
    expect(contained(server, client)).toBe(false);
    sync(client, server);
    expect(contained(server, client)).toBe(true);
  });

  it('handles deletions spread over several clients and garbage-collected content', () => {
    const server = new Y.Doc({ gc: true });
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText('t').insert(0, 'aaaaaaaaaa');
    sync(a, server);
    sync(server, b);
    b.getText('t').insert(5, 'bbbbbbbbbb');
    sync(b, server);
    sync(server, a);
    // Each client deletes text written by both.
    a.getText('t').delete(3, 9);
    b.getText('t').delete(0, 2);
    expect(contained(server, a)).toBe(false);
    expect(contained(server, b)).toBe(false);
    sync(a, server);
    expect(contained(server, a)).toBe(true);
    expect(contained(server, b)).toBe(false);
    sync(b, server);
    expect(contained(server, b)).toBe(true);
    // After a full exchange everyone agrees.
    sync(server, a);
    sync(server, b);
    expect(contained(server, a)).toBe(true);
    expect(a.getText('t').toString()).toBe(b.getText('t').toString());
  });

  it('is true for an empty client', () => {
    const { server } = pair();
    expect(contained(server, new Y.Doc())).toBe(true);
  });

  it('rejects ranges for clients the server has never seen', () => {
    const { server } = pair();
    const stranger = new Y.Doc();
    stranger.getText('t').insert(0, 'unknown');
    stranger.getText('t').delete(0, 3);
    expect(contained(server, stranger)).toBe(false);
  });
});

describe('decodeClientSnapshot', () => {
  it('decodes a base64 snapshot', () => {
    const { client } = pair();
    const snapshot = decodeClientSnapshot(encoded(client));
    expect(snapshot?.sv.size).toBe(1);
  });

  it('returns null for input that is not a snapshot', () => {
    expect(decodeClientSnapshot('not base64 at all!')).toBeNull();
    expect(decodeClientSnapshot('%%%')).toBeNull();
    // Valid base64, but the bytes are not a snapshot.
    expect(
      decodeClientSnapshot(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]).toString('base64')),
    ).toBeNull();
  });
});
