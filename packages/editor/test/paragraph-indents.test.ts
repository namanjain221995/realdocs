/**
 * Ruler indents of paragraphs and headings (`indentLeft`, `indentRight`, `indentFirstLine`,
 * millimetres; schema version 3): clamping, untrusted values, markup, commands, inheritance and
 * convergence between two editors.
 */
import {
  DEFAULT_PAGE_SETTINGS,
  DOCUMENT_SCHEMA_VERSION,
  PARAGRAPH_INDENT_MAX_MM,
  contentWidthMm,
  normalizeParagraphIndents,
  paragraphIndentMm,
} from '@realtimedocs/contracts';
import { generateJSON } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { paragraphIndentsOf, selectionParagraphIndents } from '../src/editor/blockFormat';
import { indentMarkerMm, indentRange } from '../src/react/PageRuler';
import {
  createSchemaExtensions,
  getDocumentSchema,
  paragraphIndentMarkup,
  type DocJSON,
} from '../src/schema';
import { createTestEditor, type TestEditor } from './editor-helpers';

const CONTENT = contentWidthMm(DEFAULT_PAGE_SETTINGS); // 159.2 mm

const paragraph = (text: string, attrs?: Record<string, unknown>): DocJSON => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  content: [{ type: 'text', text }],
});

let peers: TestEditor[] = [];
afterEach(() => {
  peers.forEach((peer) => peer.destroy());
  peers = [];
});

function open(content: DocJSON[]): TestEditor {
  const peer = createTestEditor();
  peers.push(peer);
  peer.editor.commands.setContent({ type: 'doc', content });
  return peer;
}

/** Position inside the n-th top-level block (0-based), at its start. */
function startOf(peer: TestEditor, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += peer.editor.state.doc.child(i).nodeSize;
  return pos + 1;
}

const indentsAt = (peer: TestEditor, index: number) =>
  paragraphIndentsOf(peer.editor.state.doc.child(index));

function press(peer: TestEditor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return Boolean(peer.editor.view.someProp('handleKeyDown', (f) => f(peer.editor.view, event)));
}

describe('stored values', () => {
  it('schema version 3 introduces the attributes', () => {
    expect(DOCUMENT_SCHEMA_VERSION).toBe(3);
    const attrs = getDocumentSchema().nodes.paragraph!.spec.attrs!;
    for (const name of ['indentLeft', 'indentRight', 'indentFirstLine']) {
      expect(attrs[name]).toEqual({ default: null });
    }
    expect(getDocumentSchema().nodes.heading!.spec.attrs!.indentLeft).toEqual({ default: null });
  });

  it('reads only numbers in range, in steps of 0.1 mm', () => {
    expect(paragraphIndentMm(12.34, 0, 200)).toBe(12.3);
    expect(paragraphIndentMm('12.5', 0, 200)).toBe(12.5);
    expect(paragraphIndentMm(-5, 0, 200)).toBe(0);
    expect(paragraphIndentMm(1e9, 0, 200)).toBe(200);
    for (const bad of [
      Number.NaN,
      Infinity,
      '1; position: fixed',
      '1e3',
      ' 12',
      null,
      undefined,
      {},
      [],
      true,
    ]) {
      expect(paragraphIndentMm(bad, 0, 200)).toBe(0);
    }
    expect(Object.is(paragraphIndentMm(-0.01, -200, 200), 0)).toBe(true);
  });

  it('keeps the first line inside the text area and room for text', () => {
    expect(normalizeParagraphIndents({ left: 10, firstLine: -30 })).toEqual({
      left: 10,
      right: 0,
      firstLine: -10,
    });
    expect(normalizeParagraphIndents({ left: 9999, right: 9999, firstLine: 9999 })).toEqual({
      left: PARAGRAPH_INDENT_MAX_MM,
      right: PARAGRAPH_INDENT_MAX_MM,
      firstLine: PARAGRAPH_INDENT_MAX_MM,
    });
    // With the page: 25 mm of text always remain; the right indent gives way first.
    const fitted = normalizeParagraphIndents({ left: 100, right: 100, firstLine: 20 }, CONTENT);
    expect(fitted).toEqual({ left: 100, right: 14.2, firstLine: 20 });
    expect(CONTENT - fitted.left - fitted.right - fitted.firstLine).toBeGreaterThanOrEqual(
      25 - 1e-9,
    );
    const extreme = normalizeParagraphIndents({ left: 500, right: 500, firstLine: 500 }, CONTENT);
    expect(extreme).toEqual({ left: 134.2, right: 0, firstLine: 0 });
  });
});

describe('markup', () => {
  it('writes clamped numbers only, with the Tab level added to the left', () => {
    expect(paragraphIndentMarkup({ indent: 0 })).toEqual({});
    expect(paragraphIndentMarkup({ indent: 2 })).toEqual({ style: 'margin-left: 4em' });
    expect(
      paragraphIndentMarkup({ indent: 1, indentLeft: 12.5, indentRight: 3, indentFirstLine: -5 }),
    ).toEqual({
      'data-indent-left': '12.5',
      'data-indent-right': '3',
      'data-indent-first-line': '-5',
      style:
        'margin-left: calc(2em + min(calc(var(--rd-mm, 3.7795px) * 12.5), 40%)); ' +
        'margin-right: min(calc(var(--rd-mm, 3.7795px) * 3), 40%); ' +
        'text-indent: calc(var(--rd-mm, 3.7795px) * -5)',
    });
  });

  it('never lets a stored value reach the style', () => {
    const hostile = [
      '12; position: fixed; inset: 0',
      '1) ; background: url(https://evil.example/x',
      { toString: () => '5' },
      ['5'],
      1e300,
      -1e300,
    ];
    for (const value of hostile) {
      const markup = paragraphIndentMarkup({
        indent: value,
        indentLeft: value,
        indentRight: value,
        indentFirstLine: value,
      });
      const text = JSON.stringify(markup);
      expect(text).not.toMatch(/position|url|evil|inset|background/);
      expect(markup.style ?? '').toMatch(/^[a-z0-9 .,:;()%*+-]*$/);
    }
  });

  it('parses only its own data attributes from HTML, never a style', () => {
    const extensions = createSchemaExtensions();
    const json = generateJSON(
      '<p data-indent-left="12.5" data-indent-right="4" data-indent-first-line="-6" ' +
        'style="margin-left: 900px; text-indent: 77px">a</p>' +
        '<p style="margin-left: 900px; margin-right: 50px; text-indent: 77px">b</p>' +
        '<p data-indent-left="1; position: fixed" data-indent-right="-3" data-indent-first-line="x">c</p>' +
        '<h2 data-indent-left="9999">d</h2>',
      extensions,
    ) as DocJSON;
    const attrs = json.content!.map((node) => node.attrs!);
    expect(attrs[0]).toMatchObject({ indentLeft: 12.5, indentRight: 4, indentFirstLine: -6 });
    expect(attrs[1]).toMatchObject({ indentLeft: null, indentRight: null, indentFirstLine: null });
    expect(attrs[2]).toMatchObject({ indentLeft: null, indentRight: null, indentFirstLine: null });
    expect(attrs[3]).toMatchObject({ indentLeft: PARAGRAPH_INDENT_MAX_MM });
    getDocumentSchema().nodeFromJSON(json).check();
  });
});

describe('commands', () => {
  it('indents only the paragraph of the caret, and typing stays in it', () => {
    const peer = open([paragraph('one'), paragraph('two'), paragraph('three')]);
    peer.editor.commands.setTextSelection(startOf(peer, 1) + 3);
    expect(peer.editor.commands.setParagraphIndents({ left: 20 }, CONTENT)).toBe(true);
    expect(indentsAt(peer, 0)).toEqual({ left: 0, right: 0, firstLine: 0 });
    expect(indentsAt(peer, 1)).toEqual({ left: 20, right: 0, firstLine: 0 });
    expect(indentsAt(peer, 2)).toEqual({ left: 0, right: 0, firstLine: 0 });
    peer.editor.view.dispatch(peer.editor.state.tr.insertText('!'));
    expect(peer.editor.state.doc.child(1).textContent).toBe('two!');
    expect(selectionParagraphIndents(peer.editor.state)).toEqual({
      left: 20,
      right: 0,
      firstLine: 0,
    });
    // The caret in another paragraph shows that paragraph's values.
    peer.editor.commands.setTextSelection(startOf(peer, 0));
    expect(selectionParagraphIndents(peer.editor.state)).toEqual({
      left: 0,
      right: 0,
      firstLine: 0,
    });
    // The same values again change nothing.
    peer.editor.commands.setTextSelection(startOf(peer, 1));
    expect(peer.editor.commands.setParagraphIndents({ left: 20 }, CONTENT)).toBe(false);
  });

  it('applies to every paragraph and heading of a selection, each keeping its other values', () => {
    const peer = open([
      paragraph('one', { indentRight: 7 }),
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'two' }] },
      paragraph('three'),
      paragraph('four'),
    ]);
    peer.editor.commands.setTextSelection({ from: startOf(peer, 0), to: startOf(peer, 2) + 2 });
    peer.editor.commands.setParagraphIndents({ left: 15, firstLine: 5 }, CONTENT);
    expect(indentsAt(peer, 0)).toEqual({ left: 15, right: 7, firstLine: 5 });
    expect(indentsAt(peer, 1)).toEqual({ left: 15, right: 0, firstLine: 5 });
    expect(indentsAt(peer, 2)).toEqual({ left: 15, right: 0, firstLine: 5 });
    expect(indentsAt(peer, 3)).toEqual({ left: 0, right: 0, firstLine: 0 });
    expect(peer.editor.state.doc.child(1).attrs.level).toBe(2);
    // The ruler shows the first block of a mixed selection.
    expect(selectionParagraphIndents(peer.editor.state)).toEqual({
      left: 15,
      right: 7,
      firstLine: 5,
    });
  });

  it('limits a change to the text area of the page', () => {
    const peer = open([paragraph('one')]);
    peer.editor.commands.setTextSelection(1);
    peer.editor.commands.setParagraphIndents({ left: 500, right: 500 }, CONTENT);
    expect(indentsAt(peer, 0)).toEqual({ left: 134.2, right: 0, firstLine: 0 });
    peer.editor.commands.setParagraphIndents({ left: 10, firstLine: -40 }, CONTENT);
    expect(indentsAt(peer, 0)).toEqual({ left: 10, right: 0, firstLine: -10 });
  });

  it('stores "none" as an absent attribute, exactly like a document from before', () => {
    const peer = open([paragraph('one'), paragraph('two')]);
    peer.editor.commands.setTextSelection(1);
    peer.editor.commands.setParagraphIndents({ left: 12 }, CONTENT);
    const fragment = peer.ydoc.getXmlFragment('default');
    const first = fragment.get(0) as Y.XmlElement;
    const second = fragment.get(1) as Y.XmlElement;
    expect(first.getAttribute('indentLeft')).toBe(12);
    expect(Object.keys(first.getAttributes())).not.toContain('indentRight');
    expect(Object.keys(second.getAttributes()).filter((key) => key.startsWith('indent'))).toEqual([
      'indent',
    ]);
    peer.editor.commands.clearParagraphIndents();
    expect(Object.keys(first.getAttributes())).not.toContain('indentLeft');
  });

  it('a new paragraph made with Enter inherits the indents', () => {
    const peer = open([paragraph('one', { indentLeft: 18, indentRight: 6, indentFirstLine: 4 })]);
    peer.editor.commands.focus('end');
    expect(press(peer, 'Enter')).toBe(true);
    peer.editor.view.dispatch(peer.editor.state.tr.insertText('next'));
    expect(peer.editor.state.doc.childCount).toBe(2);
    expect(peer.editor.state.doc.child(1).textContent).toBe('next');
    expect(indentsAt(peer, 1)).toEqual({ left: 18, right: 6, firstLine: 4 });
  });

  it('Backspace in an empty indented paragraph removes the indents before anything else', () => {
    const peer = open([paragraph('one'), { type: 'paragraph', attrs: { indentLeft: 18 } }]);
    peer.editor.commands.focus('end');
    expect(press(peer, 'Backspace')).toBe(true);
    expect(peer.editor.state.doc.childCount).toBe(2);
    expect(indentsAt(peer, 1)).toEqual({ left: 0, right: 0, firstLine: 0 });
  });

  it('does nothing for a read-only reader', () => {
    const peer = createTestEditor({ canEdit: false });
    peers.push(peer);
    expect(peer.editor.isEditable).toBe(false);
    expect(press(peer, 'Backspace')).toBe(false);
  });
});

describe('two editors', () => {
  it('converge on the indents each of them set, and a remote change shows under the caret', () => {
    const a = createTestEditor();
    const b = createTestEditor();
    peers.push(a, b);
    const queue: { to: TestEditor; update: Uint8Array }[] = [];
    a.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'net') queue.push({ to: b, update });
    });
    b.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'net') queue.push({ to: a, update });
    });
    const flush = (): void => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        Y.applyUpdate(item.to.ydoc, item.update, 'net');
      }
    };
    a.editor.commands.setContent({
      type: 'doc',
      content: [paragraph('one'), paragraph('two'), paragraph('three')],
    });
    flush();
    // At the same time: A indents paragraph 1, B indents paragraph 3 and the right of paragraph 1.
    a.editor.commands.setTextSelection(startOf(a, 0));
    a.editor.commands.setParagraphIndents({ left: 10 }, CONTENT);
    b.editor.commands.setTextSelection(startOf(b, 2));
    b.editor.commands.setParagraphIndents({ left: 30, firstLine: -8 }, CONTENT);
    b.editor.commands.setTextSelection(startOf(b, 0));
    b.editor.commands.setParagraphIndents({ right: 12 }, CONTENT);
    flush();
    for (const peer of [a, b]) {
      expect(indentsAt(peer, 0)).toEqual({ left: 10, right: 12, firstLine: 0 });
      expect(indentsAt(peer, 1)).toEqual({ left: 0, right: 0, firstLine: 0 });
      expect(indentsAt(peer, 2)).toEqual({ left: 30, right: 0, firstLine: -8 });
    }
    expect(a.editor.getJSON()).toEqual(b.editor.getJSON());
    // A's caret is still in paragraph 1: the ruler would now show B's right indent too.
    expect(selectionParagraphIndents(a.editor.state)).toEqual({
      left: 10,
      right: 12,
      firstLine: 0,
    });
  });
});

describe('ruler geometry', () => {
  const settings = DEFAULT_PAGE_SETTINGS; // A4, 25.4 mm margins

  it('places the markers from the edges of the text area', () => {
    const indents = { left: 10, right: 20, firstLine: -4 };
    expect(indentMarkerMm('left', indents, settings)).toBeCloseTo(35.4);
    expect(indentMarkerMm('firstLine', indents, settings)).toBeCloseTo(31.4);
    expect(indentMarkerMm('right', indents, settings)).toBeCloseTo(210 - 25.4 - 20);
  });

  it('limits each marker by the other two and the minimum text width', () => {
    const indents = { left: 10, right: 20, firstLine: 5 };
    expect(indentRange('left', indents, CONTENT)).toEqual({ min: 0, max: 109.2 });
    expect(indentRange('right', indents, CONTENT)).toEqual({ min: 0, max: 119.2 });
    expect(indentRange('firstLine', indents, CONTENT)).toEqual({ min: -10, max: 104.2 });
    // A hanging indent does not take room from the left indent.
    expect(indentRange('left', { left: 10, right: 0, firstLine: -10 }, CONTENT).max).toBe(134.2);
  });
});
