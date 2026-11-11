// @vitest-environment jsdom
/**
 * Attribute values written by another client.
 *
 * A collaborator's client can write any JSON value into any attribute of the
 * shared document without passing this editor's parse rules. These tests feed
 * such a document through Yjs, as a remote update, and check what reaches the
 * page and the clipboard.
 */
import type { JSONContent } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  safeColumnWidth,
  safeId,
  safeImageAlign,
  safeIndent,
  safeInteger,
  safeLineHeight,
  safeText,
} from '../src/editor/attrs';
import { resolveLanguage } from '../src/editor/highlight';
import { getDocumentSchema } from '../src/schema';
import { createTestEditor, settle, type TestEditor } from './editor-helpers';

let current: TestEditor | null = null;

afterEach(() => {
  current?.destroy();
  current = null;
});

const INJECTION =
  '1; position: fixed; inset: 0; background-image: url(https://evil.example/beacon.png)';
const ASSET = '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d';

describe('safe attribute readers', () => {
  it('accepts only lower-case UUIDs as asset and upload ids', () => {
    expect(safeId(ASSET)).toBe(ASSET);
    for (const value of [
      '../../../api/auth/session',
      `${ASSET}/../../x`,
      `${ASSET}?download=1`,
      ASSET.toUpperCase(),
      'javascript:alert(1)',
      '',
      null,
      undefined,
      42,
      { toString: () => ASSET },
      [ASSET],
    ]) {
      expect(safeId(value)).toBeNull();
    }
  });

  it('accepts only finite numbers in range', () => {
    expect(safeInteger(50, 10, 100)).toBe(50);
    expect(safeInteger(49.6, 10, 100)).toBe(50);
    for (const value of [
      9,
      101,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '50',
      '50%; x',
      null,
      [50],
    ]) {
      expect(safeInteger(value, 10, 100)).toBeNull();
    }
    expect(safeColumnWidth(120)).toBe(120);
    expect(safeColumnWidth('120px; position: fixed')).toBeNull();
    expect(safeColumnWidth(1e9)).toBeNull();
  });

  it('accepts only the listed alignments, line heights and indent levels', () => {
    expect(safeImageAlign('left')).toBe('left');
    expect(safeImageAlign('left; position: fixed')).toBe('center');
    expect(safeImageAlign(null)).toBe('center');
    expect(safeLineHeight('1.5')).toBe('1.5');
    expect(safeLineHeight(INJECTION)).toBeNull();
    expect(safeLineHeight(1.5)).toBeNull();
    expect(safeIndent(3)).toBe(3);
    expect(safeIndent(99)).toBe(0);
    expect(safeIndent('3')).toBe(0);
    expect(safeIndent(-1)).toBe(0);
  });

  it('bounds text and ignores non-strings', () => {
    expect(safeText('x'.repeat(50), 10)).toHaveLength(10);
    expect(safeText({ length: 3 }, 10)).toBe('');
  });

  it('accepts only short language names', () => {
    expect(resolveLanguage('TypeScript')).toBe('typescript');
    expect(resolveLanguage('js')).toBe('javascript');
    expect(resolveLanguage('c++')).toBe('cpp');
    expect(resolveLanguage('objective-c')).toBe('objective-c');
    expect(resolveLanguage('"><script>alert(1)</script>')).toBeNull();
    expect(resolveLanguage('x'.repeat(41))).toBeNull();
    expect(resolveLanguage('constructor')).toBe('constructor');
    expect(resolveLanguage('__proto__')).toBeNull();
    expect(resolveLanguage(null)).toBeNull();
  });
});

const HOSTILE_DOC: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: {
        lineHeight: INJECTION,
        indent: '2em; position: fixed',
        textAlign: `center; ${INJECTION}`,
      },
      content: [
        { type: 'text', text: 'styled ' },
        {
          type: 'text',
          text: 'coloured',
          marks: [
            {
              type: 'textStyle',
              attrs: {
                color: 'red; background-image: url(https://evil.example/c.png)',
                fontSize: '12px; position: fixed',
              },
            },
          ],
        },
        {
          type: 'text',
          text: ' marked',
          marks: [
            {
              type: 'highlight',
              attrs: { color: '#ffff00; background-image: url(https://evil.example/h.png)' },
            },
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2, lineHeight: '2', indent: 3 },
      content: [{ type: 'text', text: 'legitimate formatting' }],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              attrs: {
                colspan: 1,
                rowspan: 1,
                colwidth: [
                  '120px; position: fixed; inset: 0; background: url(https://evil.example/t.png)',
                ],
              },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
            },
            {
              type: 'tableHeader',
              attrs: { colspan: 1, rowspan: 1, colwidth: [180] },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }],
            },
          ],
        },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: '"><img src=x onerror=alert(1)>' },
      content: [{ type: 'text', text: 'code' }],
    },
    {
      type: 'image',
      attrs: {
        assetId: '../../../api/auth/session',
        uploadId: null,
        alt: '"><script>alert(1)</script>',
        caption: '<img src=x onerror=alert(1)>',
        width: '50%; position: fixed',
        align: 'left" onmouseover="alert(1)',
        name: 'x',
      },
    },
  ],
};

/** Everything that would make a browser run script, fetch a remote URL or leave the document flow. */
const DANGEROUS =
  /position\s*:|inset\s*:|url\s*\(|expression\s*\(|<script|onerror=|onmouseover=|javascript:/i;

function styles(root: Element): string[] {
  return [...root.querySelectorAll('[style]')].map(
    (element) => element.getAttribute('style') ?? '',
  );
}

/** One element's inline style without the trailing semicolon the DOM may add. */
const css = (element: Element | null | undefined): string =>
  (element?.getAttribute('style') ?? '').replace(/;\s*$/, '');

/** Delivers `content` the way another client's edits arrive: as a Yjs update. */
async function receiveRemote(t: TestEditor, content: JSONContent): Promise<void> {
  const remote = prosemirrorJSONToYDoc(getDocumentSchema(), content, 'default');
  Y.applyUpdate(t.ydoc, Y.encodeStateAsUpdate(remote), 'remote-peer');
  remote.destroy();
  await settle(20);
}

describe('a document with hostile attribute values', () => {
  it('arrives through Yjs with the hostile values intact (the test is not vacuous)', async () => {
    current = createTestEditor();
    await receiveRemote(current, HOSTILE_DOC);
    const json = JSON.stringify(current.json());
    expect(json).toContain('position: fixed');
    expect(json).toContain('https://evil.example/beacon.png');
    expect(json).toContain('../../../api/auth/session');
  });

  it('renders no injected declaration, URL or markup into the page', async () => {
    current = createTestEditor();
    await receiveRemote(current, HOSTILE_DOC);
    const { dom } = current.editor.view;

    for (const style of styles(dom)) expect(style).not.toMatch(DANGEROUS);
    // Nothing became an element or an event handler either.
    expect(
      dom.querySelector('script, iframe, object, [onerror], [onmouseover], [onclick]'),
    ).toBeNull();
    expect(dom.querySelectorAll('img[src]')).toHaveLength(0);

    // The text itself is all there.
    expect(dom.textContent).toContain('styled coloured marked');
    expect(dom.textContent).toContain('legitimate formatting');
  });

  it('still renders legitimate formatting', async () => {
    current = createTestEditor();
    await receiveRemote(current, HOSTILE_DOC);
    const heading = current.editor.view.dom.querySelector('h2');
    expect(heading?.getAttribute('data-line-height')).toBe('2');
    expect(heading?.getAttribute('data-indent')).toBe('3');
    expect(heading?.getAttribute('style')).toContain('line-height: 2');
    expect(heading?.getAttribute('style')).toContain('margin-left: 6em');
    // The hostile paragraph falls back to default spacing and no indentation.
    const paragraph = current.editor.view.dom.querySelector('p');
    expect(paragraph?.hasAttribute('data-line-height')).toBe(false);
    expect(paragraph?.hasAttribute('data-indent')).toBe(false);
  });

  it('copies no injected declaration to the clipboard', async () => {
    current = createTestEditor();
    await receiveRemote(current, HOSTILE_DOC);
    const { view } = current.editor;
    const serializer =
      view.someProp('clipboardSerializer') ?? DOMSerializer.fromSchema(view.state.schema);
    const holder = document.createElement('div');
    holder.append(serializer.serializeFragment(view.state.doc.content));

    for (const style of styles(holder)) expect(style).not.toMatch(DANGEROUS);
    // The safe column width survives, the hostile one falls back to the minimum.
    const cols = [...holder.querySelectorAll('col')].map((col) => css(col));
    expect(cols).toEqual(['min-width: 56px', 'width: 180px']);
    expect(css(holder.querySelector('table'))).toBe('min-width: 236px');
    expect(holder.querySelector('script')).toBeNull();
    // Attribute values are data, never markup: the serialized text contains no live tag from them.
    expect(holder.querySelectorAll('img[onerror], [onmouseover]')).toHaveLength(0);
  });

  it('keeps a table with explicit safe widths at its fixed width when copied', async () => {
    current = createTestEditor();
    await receiveRemote(current, {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 2, rowspan: 1, colwidth: [100, 140] },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'wide' }] }],
                },
              ],
            },
          ],
        },
      ],
    });
    const { view } = current.editor;
    const serializer =
      view.someProp('clipboardSerializer') ?? DOMSerializer.fromSchema(view.state.schema);
    const holder = document.createElement('div');
    holder.append(serializer.serializeFragment(view.state.doc.content));
    expect([...holder.querySelectorAll('col')].map((col) => css(col))).toEqual([
      'width: 100px',
      'width: 140px',
    ]);
    expect(css(holder.querySelector('table'))).toBe('width: 240px');
  });
});
