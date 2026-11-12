/**
 * Several editors pressing Enter at the same instant at the same place, then typing.
 *
 * The shared document was always right (one new paragraph per editor); the defect was the local
 * caret: after the others' empty paragraphs arrived, the binding moved every caret into the first
 * of the identical empty paragraphs, so all the typing landed in one paragraph. `CaretKeeper`
 * (src/editor/collabPlugins.ts) keeps each caret in its own paragraph.
 *
 * Each editor has its own Y.Doc; updates travel through a queue the test flushes, so the
 * interleaving of keystrokes and deliveries is exact and repeatable.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createTestEditor, outline, type TestEditor } from './editor-helpers';

interface Net {
  peers: TestEditor[];
  /** Delivers every queued update (repeats until nothing is left). */
  flush: () => void;
  destroy: () => void;
}

function network(count: number): Net {
  const peers = Array.from({ length: count }, () => createTestEditor());
  const queue: { to: number; update: Uint8Array }[] = [];
  peers.forEach((peer, from) => {
    peer.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'net') return;
      peers.forEach((_, to) => {
        if (to !== from) queue.push({ to, update });
      });
    });
  });
  const flush = (): void => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      Y.applyUpdate(peers[item.to]!.ydoc, item.update, 'net');
    }
  };
  return { peers, flush, destroy: () => peers.forEach((peer) => peer.destroy()) };
}

function caretToEnd(peer: TestEditor): void {
  peer.editor.commands.focus('end');
}

function pressEnter(peer: TestEditor): void {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  const handled = peer.editor.view.someProp('handleKeyDown', (f) => f(peer.editor.view, event));
  if (!handled) throw new Error('Enter was not handled');
}

function type(peer: TestEditor, text: string): void {
  const { view } = peer.editor;
  view.dispatch(view.state.tr.insertText(text));
}

const BASE = ['base-1', 'base-2', 'base-3'];

function seed(net: Net): void {
  net.peers[0]!.editor.commands.setContent({
    type: 'doc',
    content: BASE.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  });
  net.flush();
}

let net: Net | null = null;
afterEach(() => {
  net?.destroy();
  net = null;
});

describe('simultaneous Enter at the same place', () => {
  it.each([2, 3])('%i editors: every typed paragraph exists once and intact', (count) => {
    net = network(count);
    seed(net);
    const prefixes = ['X', 'Y', 'Z'].slice(0, count);
    const typed: string[] = [];
    for (let round = 1; round <= 6; round += 1) {
      for (const peer of net.peers) caretToEnd(peer);
      // Enter on every editor before anyone has seen the others' Enter.
      for (const peer of net.peers) pressEnter(peer);
      net.flush();
      // Then one character each, with deliveries between the keystrokes.
      const words = prefixes.map((prefix) => `${prefix}${round}`);
      typed.push(...words);
      const longest = Math.max(...words.map((word) => word.length));
      for (let index = 0; index < longest; index += 1) {
        net.peers.forEach((peer, who) => {
          const char = words[who]![index];
          if (char) type(peer, char);
        });
        net.flush();
      }
    }
    const first = outline(net.peers[0]!.editor);
    for (const peer of net.peers) expect(outline(peer.editor)).toEqual(first);
    expect([...first].sort()).toEqual([...BASE, ...typed].map((text) => `p:${text}`).sort());
  });

  it('a caret in an empty paragraph stays there when someone adds an empty paragraph above', () => {
    net = network(2);
    seed(net);
    const [a, b] = net.peers as [TestEditor, TestEditor];
    caretToEnd(a);
    pressEnter(a);
    net.flush();
    // B creates an empty paragraph after base-1, above A's empty paragraph.
    b.editor.commands.setTextSelection(7);
    pressEnter(b);
    net.flush();
    type(a, 'mine');
    type(b, 'theirs');
    net.flush();
    const expected = ['p:base-1', 'p:theirs', 'p:base-2', 'p:base-3', 'p:mine'];
    expect(outline(a.editor)).toEqual(expected);
    expect(outline(b.editor)).toEqual(expected);
  });

  it('nothing typed is lost and no text is duplicated in the shared document', () => {
    net = network(3);
    seed(net);
    for (const peer of net.peers) caretToEnd(peer);
    for (const peer of net.peers) pressEnter(peer);
    net.flush();
    net.peers.forEach((peer, who) => type(peer, ['X', 'Y', 'Z'][who]!));
    net.flush();
    const text = outline(net.peers[0]!.editor).join('|');
    for (const char of ['X', 'Y', 'Z']) expect(text.split(char).length - 1).toBe(1);
    expect(outline(net.peers[0]!.editor).filter((line) => line === 'p:')).toEqual([]);
  });
});
