/**
 * Content a client's schema does not know: found, named, never changed.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  describeUnsupportedContent,
  sameUnsupportedContent,
  scanUnsupportedContent,
} from '../src/editor/unsupported';
import { getDocumentSchema } from '../src/schema';

function fragmentWith(build: (fragment: Y.XmlFragment) => void): Y.XmlFragment {
  const fragment = new Y.Doc().getXmlFragment('default');
  build(fragment);
  return fragment;
}

function paragraph(text: string, attributes?: Record<string, unknown>): Y.XmlElement {
  const element = new Y.XmlElement('paragraph');
  const run = new Y.XmlText();
  run.insert(0, text, attributes);
  element.insert(0, [run]);
  return element;
}

describe('unsupported shared content', () => {
  const schema = getDocumentSchema();

  it('finds nothing in a document made of known nodes, marks and attributes', () => {
    const fragment = fragmentWith((root) => {
      const callout = new Y.XmlElement('callout');
      callout.setAttribute('variant', 'tip');
      callout.insert(0, [
        paragraph('inside', { bold: true, 'link--ABCDEFGH': { href: 'https://example.com' } }),
      ]);
      root.insert(0, [paragraph('plain'), callout]);
    });
    const found = scanUnsupportedContent(fragment, schema);
    expect(found.total).toBe(0);
    expect(describeUnsupportedContent(found)).toBe('');
  });

  it('names unknown nodes, marks and attributes without touching the document', () => {
    const fragment = fragmentWith((root) => {
      const future = new Y.XmlElement('kanbanBoard');
      future.insert(0, [paragraph('hidden child', { sparkle: true })]);
      const known = paragraph('text', { sparkle: true, bold: true });
      known.setAttribute('pageBreakBefore', 'always');
      root.insert(0, [future, new Y.XmlElement('kanbanBoard'), known]);
    });
    const before = Y.encodeStateAsUpdate(fragment.doc!);
    const found = scanUnsupportedContent(fragment, schema);

    expect(found.nodes).toEqual({ kanbanBoard: 2 });
    // The child of an unknown node is part of that node, not a finding of its own.
    expect(found.marks).toEqual({ sparkle: 1 });
    expect(found.attributes).toEqual({ 'paragraph.pageBreakBefore': 1 });
    expect(found.total).toBe(4);
    expect(describeUnsupportedContent(found)).toBe(
      '2 blocks (kanbanBoard), 1 piece of formatting (sparkle), 1 setting of existing blocks (paragraph.pageBreakBefore)',
    );
    expect(Y.encodeStateAsUpdate(fragment.doc!)).toEqual(before);
  });

  it('is not fooled by names that exist on Object.prototype', () => {
    const fragment = fragmentWith((root) => {
      root.insert(0, [new Y.XmlElement('constructor'), paragraph('x', { toString: true })]);
    });
    const found = scanUnsupportedContent(fragment, schema);
    expect(found.nodes).toEqual({ constructor: 1 });
    expect(found.marks).toEqual({ toString: 1 });
  });

  it('clears again once the unknown content is gone', () => {
    const fragment = fragmentWith((root) => {
      root.insert(0, [new Y.XmlElement('kanbanBoard'), paragraph('kept')]);
    });
    const first = scanUnsupportedContent(fragment, schema);
    fragment.delete(0, 1);
    const second = scanUnsupportedContent(fragment, schema);
    expect(first.total).toBe(1);
    expect(second.total).toBe(0);
    expect(sameUnsupportedContent(first, second)).toBe(false);
  });
});
