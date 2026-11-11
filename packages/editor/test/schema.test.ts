// @vitest-environment node
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  EMPTY_DOCUMENT,
  buildSampleDocument,
  createSchemaExtensions,
  getDocumentSchema,
  isSafeExternalUrl,
  sanitizeLinkHref,
} from '../src/schema/index';

const FIELD = 'default';
const ASSET = '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d';

describe('document schema (DOM-free)', () => {
  it('builds in Node without a DOM and contains every required node and mark', () => {
    expect(typeof document).toBe('undefined');
    const schema = getDocumentSchema();
    for (const node of [
      'doc',
      'paragraph',
      'heading',
      'text',
      'bulletList',
      'orderedList',
      'listItem',
      'taskList',
      'taskItem',
      'blockquote',
      'horizontalRule',
      'hardBreak',
      'codeBlock',
      'table',
      'tableRow',
      'tableHeader',
      'tableCell',
      'image',
      'attachment',
      'diagram',
    ]) {
      expect(schema.nodes[node], `node ${node}`).toBeDefined();
    }
    for (const mark of [
      'bold',
      'italic',
      'underline',
      'strike',
      'code',
      'link',
      'textStyle',
      'highlight',
    ]) {
      expect(schema.marks[mark], `mark ${mark}`).toBeDefined();
    }
    expect(Object.keys(schema.nodes.paragraph!.spec.attrs ?? {})).toEqual(
      expect.arrayContaining(['textAlign', 'indent', 'lineHeight']),
    );
    expect(Object.keys(schema.marks.textStyle!.spec.attrs ?? {})).toEqual(
      expect.arrayContaining(['color', 'fontSize']),
    );
    expect(schema.nodes.diagram!.spec.code).toBe(true);
    expect(schema.nodes.image!.spec.atom).toBe(true);
  });

  it('validates the empty and the sample document against the schema', () => {
    const schema = getDocumentSchema();
    schema.nodeFromJSON(EMPTY_DOCUMENT).check();
    const sample = buildSampleDocument({ imageAssetId: ASSET });
    const node = schema.nodeFromJSON(sample);
    node.check();
    const types = new Set<string>();
    node.descendants((child) => {
      types.add(child.type.name);
    });
    for (const expected of ['table', 'image', 'codeBlock', 'diagram', 'taskList', 'orderedList']) {
      expect(types.has(expected), expected).toBe(true);
    }
    expect(node.textContent).toContain('नमस्ते');
    expect(node.textContent).toContain('🚀');
  });

  it('round-trips ProseMirror JSON through a Yjs document without loss', () => {
    const schema = getDocumentSchema();
    const sample = schema.nodeFromJSON(buildSampleDocument({ imageAssetId: ASSET })).toJSON();
    const ydoc = prosemirrorJSONToYDoc(schema, sample, FIELD);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(ydoc));
    const json = yDocToProsemirrorJSON(restored, FIELD);
    expect(schema.nodeFromJSON(json).toJSON()).toEqual(sample);
  });

  it('rejects overrides for unknown extension names', () => {
    expect(() => createSchemaExtensions({ overrides: { nope: {} as never } })).toThrow(/Unknown/);
  });
});

describe('link safety', () => {
  it.each([
    ['https://example.com/a?b=1#c', 'https://example.com/a?b=1#c'],
    ['example.com/page', 'https://example.com/page'],
    ['mailto:team@example.com', 'mailto:team@example.com'],
    ['tel:+911234567890', 'tel:+911234567890'],
  ])('accepts %s', (input, expected) => {
    expect(sanitizeLinkHref(input)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    ' java\nscript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'realtimedocs://open?code=x',
    '//evil.example/path',
    'not a link',
    '',
  ])('rejects %j', (input) => {
    expect(sanitizeLinkHref(input)).toBeNull();
  });

  it('only lets web and mail links leave the desktop app', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('mailto:a@example.com')).toBe(true);
    expect(isSafeExternalUrl('tel:+1')).toBe(false);
    expect(isSafeExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
  });
});

/**
 * A collaborator's client can write any JSON value into any attribute through
 * Yjs. Rendering must never turn such a value into markup, a style or a URL part.
 */
describe('attribute values written by another client', () => {
  const schema = getDocumentSchema();
  const HOSTILE_STYLE =
    '1; position: fixed; inset: 0; z-index: 99999; background-image: url(http://attacker.invalid/x.png)';

  /** Flattens a DOM output spec into the strings it would put into the page. */
  function strings(spec: unknown): string[] {
    if (typeof spec === 'string') return [spec];
    if (Array.isArray(spec)) return spec.flatMap(strings);
    if (spec && typeof spec === 'object') return Object.entries(spec).flat().flatMap(strings);
    return [];
  }

  function render(typeName: string, attrs: Record<string, unknown>): unknown {
    const type = schema.nodes[typeName];
    if (!type?.spec.toDOM) throw new Error(`no toDOM for ${typeName}`);
    return type.spec.toDOM(type.create(attrs));
  }

  it('renders line spacing only from the listed values', () => {
    for (const typeName of ['paragraph', 'heading']) {
      const hostile = strings(render(typeName, { lineHeight: HOSTILE_STYLE }));
      expect(hostile.join('|')).not.toContain('position');
      expect(hostile.join('|')).not.toContain('attacker');
      expect(hostile.some((value) => value.includes('line-height'))).toBe(false);

      const honest = strings(render(typeName, { lineHeight: '1.5' }));
      expect(honest).toContain('line-height: 1.5');
    }
    for (const value of [1.5, ['1.5'], { toString: () => '1.5' }, true, null]) {
      expect(strings(render('paragraph', { lineHeight: value })).join('|')).not.toContain(
        'line-height',
      );
    }
  });

  it('clamps indentation to a small integer before it reaches a style', () => {
    expect(strings(render('paragraph', { indent: 3 }))).toContain('margin-left: 6em');
    expect(strings(render('paragraph', { indent: 1e9 }))).toContain('margin-left: 16em');
    expect(strings(render('paragraph', { indent: -5 })).join('|')).not.toContain('margin-left');
    for (const value of ['2em; position: fixed', '1e9; inset: 0', {}, [], Number.NaN, Infinity]) {
      const rendered = strings(render('paragraph', { indent: value })).join('|');
      expect(rendered).not.toContain('position');
      expect(rendered).not.toContain('inset');
      expect(rendered).not.toMatch(/margin-left: (?!\d{1,2}em$)/);
    }
  });

  it('never renders an image attribute that is not of the expected shape', () => {
    const spec = render('image', {
      assetId: '../../../api/auth/logout',
      uploadId: { toString: () => ASSET },
      alt: ['script', { src: 'http://attacker.invalid/a.js' }],
      caption: ['img', { src: 'x', onerror: 'alert(1)' }],
      width: '100; position: fixed',
      align: 'center" onmouseover="alert(1)',
      naturalWidth: 'NaN',
      naturalHeight: -1,
      name: 42,
    });
    const rendered = strings(spec).join('|');
    for (const fragment of ['logout', 'attacker', 'onerror', 'onmouseover', 'position', 'script']) {
      expect([fragment, rendered.includes(fragment)]).toEqual([fragment, false]);
    }
    // Nothing nested that is not part of the fixed figure/img structure.
    expect(JSON.stringify(spec)).toBe(
      JSON.stringify([
        'figure',
        { 'data-align': 'center', 'data-natural-height': '1', 'data-type': 'image' },
        ['img', { alt: '', draggable: 'false' }],
      ]),
    );
  });

  it('keeps well-formed image attributes', () => {
    const rendered = JSON.stringify(
      render('image', {
        assetId: ASSET,
        alt: 'A chart',
        caption: 'Figure 1',
        width: 60,
        align: 'right',
        naturalWidth: 1200,
        naturalHeight: 800,
        name: 'chart.png',
      }),
    );
    for (const fragment of [
      ASSET,
      'A chart',
      'Figure 1',
      '"data-width":"60"',
      'right',
      '1200',
      '800',
    ]) {
      expect([fragment, rendered.includes(fragment)]).toEqual([fragment, true]);
    }
    expect(rendered).toContain('figcaption');
  });

  it('never renders an attachment or diagram attribute that is not of the expected shape', () => {
    const attachment = JSON.stringify(
      render('attachment', {
        assetId: 'not-a-uuid',
        name: ['a', { href: 'javascript:alert(1)' }, 'click'],
        sizeBytes: '12; x',
        mime: 'text/html" data-x="1',
      }),
    );
    expect(attachment).not.toContain('javascript');
    expect(attachment).not.toContain('not-a-uuid');
    expect(attachment).not.toContain('text/html');
    expect(attachment).toContain('application/octet-stream');

    const diagram = JSON.stringify(render('diagram', { language: 'mermaid" onload="alert(1)' }));
    expect(diagram).not.toContain('onload');
    expect(diagram).toContain('"data-language":"mermaid"');
  });
});

describe('callout node (schema version 2)', () => {
  const schema = getDocumentSchema();

  it('exists, defaults to the info variant and renders as a labelled note', () => {
    const callout = schema.nodes.callout;
    expect(callout).toBeDefined();
    const node = callout!.create(null, schema.nodes.paragraph!.create(null, schema.text('Hello')));
    expect(node.attrs.variant).toBe('info');
    const spec = JSON.stringify(callout!.spec.toDOM?.(node));
    expect(spec).toContain('"data-type":"callout"');
    expect(spec).toContain('"role":"note"');
    expect(spec).toContain('"data-variant":"info"');
  });

  it('renders only listed variants, whatever another client wrote into the attribute', () => {
    const callout = schema.nodes.callout!;
    const para = schema.nodes.paragraph!.create(null, schema.text('x'));
    for (const variant of ['warning', 'tip', 'success', 'danger']) {
      expect(JSON.stringify(callout.spec.toDOM?.(callout.create({ variant }, para)))).toContain(
        `"data-variant":"${variant}"`,
      );
    }
    for (const hostile of [
      'info" onclick="alert(1)',
      'red; position: fixed',
      42,
      ['warning'],
      null,
    ]) {
      const rendered = JSON.stringify(
        callout.spec.toDOM?.(callout.create({ variant: hostile }, para)),
      );
      expect(rendered).toContain('"data-variant":"info"');
      expect(rendered).not.toContain('onclick');
      expect(rendered).not.toContain('position');
    }
  });

  it('accepts text blocks and refuses tables, images and diagrams inside', () => {
    const callout = schema.nodes.callout!;
    const para = schema.nodes.paragraph!.create(null, schema.text('ok'));
    expect(() => callout.createChecked(null, [para])).not.toThrow();
    const image = schema.nodes.image!.create({ assetId: ASSET });
    expect(() => callout.createChecked(null, [image])).toThrow();
    const diagram = schema.nodes.diagram!.create(null, schema.text('graph TD; A-->B'));
    expect(() => callout.createChecked(null, [diagram])).toThrow();
  });

  it('is part of the sample document, which still validates and round-trips through Yjs', () => {
    const sample = buildSampleDocument({ imageAssetId: ASSET });
    expect(JSON.stringify(sample)).toContain('"type":"callout"');
    const node = schema.nodeFromJSON(sample);
    expect(() => node.check()).not.toThrow();
    const ydoc = prosemirrorJSONToYDoc(schema, sample, FIELD);
    expect(schema.nodeFromJSON(yDocToProsemirrorJSON(ydoc, FIELD)).toJSON()).toEqual(node.toJSON());
  });
});
