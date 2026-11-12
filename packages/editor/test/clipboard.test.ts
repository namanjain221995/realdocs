// @vitest-environment jsdom
/**
 * Clipboard pipeline: sanitizer + normalizer + paste report.
 *
 * Runs under jsdom because DOMPurify does not sanitize under happy-dom (it
 * reports itself as supported there but leaves active content in place).
 * The same corpus is replayed in real browsers by the demo harness.
 */
import { generateHTML, generateJSON } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import {
  fontSizeToPx,
  isDefaultInk,
  lengthToPx,
  normalizeColor,
  parseStyle,
} from '../src/clipboard/css';
import {
  MAX_PASTE_IMAGES,
  detectSource,
  isSanitizerAvailable,
  processPastedHtml,
  type ProcessOptions,
} from '../src/clipboard/process';
import {
  buildSampleDocument,
  createSchemaExtensions,
  getDocumentSchema,
  isSafeLinkHref,
  type DocJSON,
} from '../src/schema/index';
import {
  CODE_EDITOR_HTML,
  EXCEL_HTML,
  GOOGLE_DOCS_HTML,
  GOOGLE_SHEETS_HTML,
  MALICIOUS_CORPUS,
  WEB_PAGE_HTML,
  WORD_HTML,
} from './fixtures/clipboard';

const DOCUMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_DOCUMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ASSET_ID = '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d';
const extensions = createSchemaExtensions();

let uploadCounter = 0;
function options(patch: Partial<ProcessOptions> = {}): ProcessOptions {
  return {
    documentId: DOCUMENT_ID,
    createUploadId: () => `00000000-0000-4000-8000-${String(++uploadCounter).padStart(12, '0')}`,
    acceptImage: ({ mime, sizeBytes }) =>
      ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime) &&
      sizeBytes <= 1024 * 1024,
    ...patch,
  };
}

function paste(html: string, patch: Partial<ProcessOptions> = {}) {
  const result = processPastedHtml(html, options(patch));
  const json = result.html === null ? null : (generateJSON(result.html, extensions) as DocJSON);
  if (json) getDocumentSchema().nodeFromJSON(json).check();
  return { ...result, json: json as DocJSON, kinds: result.report.notes.map((note) => note.kind) };
}

function text(node: DocJSON | undefined): string {
  if (!node) return '';
  if (node.text !== undefined) return node.text;
  return (node.content ?? []).map(text).join('');
}

function find(node: DocJSON, type: string): DocJSON[] {
  const found: DocJSON[] = [];
  const walk = (current: DocJSON): void => {
    if (current.type === type) found.push(current);
    for (const child of current.content ?? []) walk(child);
  };
  walk(node);
  return found;
}

/** Text runs of the whole document with the names of their marks. */
function runs(node: DocJSON): { text: string; marks: string[]; attrs: Record<string, unknown> }[] {
  const out: { text: string; marks: string[]; attrs: Record<string, unknown> }[] = [];
  const walk = (current: DocJSON): void => {
    if (current.type === 'text') {
      const attrs: Record<string, unknown> = {};
      for (const mark of current.marks ?? []) Object.assign(attrs, { [mark.type]: mark.attrs });
      out.push({
        text: current.text ?? '',
        marks: (current.marks ?? []).map((mark) => mark.type).sort(),
        attrs,
      });
    }
    for (const child of current.content ?? []) walk(child);
  };
  walk(node);
  return out;
}

const run = (json: DocJSON, value: string) => runs(json).find((entry) => entry.text === value);

describe('css helpers', () => {
  it('parses style attributes', () => {
    const style = parseStyle('Color: RED ; font-weight:700!important; mso-list:l0 level1 lfo1;;');
    expect(style.get('color')).toBe('RED');
    expect(style.get('font-weight')).toBe('700');
    expect(style.get('mso-list')).toBe('l0 level1 lfo1');
    expect(parseStyle(null).size).toBe(0);
  });

  it('normalises colours and rejects everything else', () => {
    expect(normalizeColor('#F00')).toBe('#ff0000');
    expect(normalizeColor('#1155CC')).toBe('#1155cc');
    expect(normalizeColor('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(normalizeColor('rgba(0,128,0,0.5)')).toBe('#008000');
    expect(normalizeColor('rgb(100% 0% 0%)')).toBe('#ff0000');
    expect(normalizeColor('red')).toBe('#ff0000');
    for (const bad of [
      'transparent',
      'rgba(0,0,0,0)',
      '#00000000',
      'url(javascript:alert(1))',
      'expression(alert(1))',
      'var(--x)',
      'red; background: url(x)',
      'windowtext',
      '',
      null,
    ]) {
      expect(normalizeColor(bad)).toBeNull();
    }
  });

  it('recognises default ink and converts lengths', () => {
    expect(isDefaultInk('#000000')).toBe(true);
    expect(isDefaultInk('#1a1a1a')).toBe(true);
    expect(isDefaultInk('#ffffff')).toBe(true);
    expect(isDefaultInk('#ff0000')).toBe(false);
    expect(isDefaultInk('#666666')).toBe(false);
    expect(lengthToPx('36pt')).toBe(48);
    expect(lengthToPx('0.5in')).toBe(48);
    expect(lengthToPx('12px')).toBe(12);
    expect(lengthToPx('calc(1px)')).toBeNull();
    expect(fontSizeToPx('11pt')).toBeCloseTo(14.67, 1);
    expect(fontSizeToPx('large')).toBe(18);
  });
});

describe('source detection', () => {
  it('recognises the supported applications', () => {
    expect(isSanitizerAvailable()).toBe(true);
    expect(detectSource(GOOGLE_DOCS_HTML)).toBe('google-docs');
    expect(detectSource(WORD_HTML)).toBe('word');
    expect(detectSource(GOOGLE_SHEETS_HTML)).toBe('google-sheets');
    expect(detectSource(EXCEL_HTML)).toBe('excel');
    expect(detectSource(WEB_PAGE_HTML)).toBe('web');
    expect(detectSource('<p data-rd-doc="x">a</p>')).toBe('realtimedocs');
  });
});

describe('Google Docs', () => {
  const result = paste(GOOGLE_DOCS_HTML);
  const { json } = result;

  it('keeps structure: heading, paragraphs, alignment, indentation, spacing', () => {
    expect(result.report.source).toBe('google-docs');
    const heading = find(json, 'heading')[0];
    expect(heading?.attrs?.level).toBe(1);
    expect(text(heading)).toBe('Quarterly plan');
    // No bold mark or font size inside the heading.
    expect(runs(heading as DocJSON)[0]?.marks).toEqual([]);
    const paragraphs = json.content?.filter((node) => node.type === 'paragraph') ?? [];
    expect(text(paragraphs[0])).toBe(
      'Plain text, bold, italic, underlined, struck, red, highlighted and a link.',
    );
    // The <br> between paragraphs is an empty line in Docs.
    expect(paragraphs[1]?.content).toBeUndefined();
    expect(paragraphs[2]?.attrs).toMatchObject({ textAlign: 'center' });
    expect(paragraphs[3]?.attrs).toMatchObject({ indent: 1, lineHeight: '2' });
    // Docs' default spacing (1.38) is not turned into an explicit value.
    expect(paragraphs[0]?.attrs).toMatchObject({ lineHeight: null, indent: 0, textAlign: null });
  });

  it('maps inline styles to marks and drops the default ink', () => {
    expect(run(json, 'bold')?.marks).toEqual(['bold']);
    expect(run(json, 'italic')?.marks).toEqual(['italic']);
    expect(run(json, 'underlined')?.marks).toEqual(['underline']);
    expect(run(json, 'struck')?.marks).toEqual(['strike']);
    expect(run(json, 'Plain text, ')?.marks).toEqual([]);
    expect(run(json, 'red')).toMatchObject({
      marks: ['textStyle'],
      attrs: { textStyle: { color: '#ff0000' } },
    });
    expect(run(json, 'highlighted')).toMatchObject({
      marks: ['highlight'],
      attrs: { highlight: { color: '#ffff00' } },
    });
    // The link keeps its address but not Docs' blue + underline.
    const link = run(json, 'link');
    expect(link?.marks).toEqual(['link']);
    expect((link?.attrs.link as { href: string }).href).toBe('https://example.com/plan');
    expect(run(json, 'pnpm install')?.marks).toEqual(['code']);
  });

  it('rebuilds nested, ordered and check lists', () => {
    const bullet = find(json, 'bulletList')[0] as DocJSON;
    expect(bullet.content).toHaveLength(2);
    expect(text(bullet.content?.[0]?.content?.[0])).toBe('First bullet');
    const nested = bullet.content?.[0]?.content?.[1];
    expect(nested?.type).toBe('bulletList');
    expect(text(nested)).toBe('Nested bullet');
    expect(text(bullet.content?.[1])).toBe('Second bullet');
    expect(find(json, 'orderedList')[0]?.content?.map(text)).toEqual(['Step one', 'Step two']);
    const tasks = find(json, 'taskItem');
    expect(tasks.map((task) => [text(task), task.attrs?.checked])).toEqual([
      ['Done item', true],
      ['Open item', false],
    ]);
  });

  it('keeps the table and turns the remote image into a labelled link', () => {
    const table = find(json, 'table')[0] as DocJSON;
    expect(table.content?.map((row) => row.content?.map(text))).toEqual([
      ['Phase', 'Owner'],
      ['Pilot', 'Asha'],
    ]);
    expect(run(json, 'Phase')?.marks).toEqual(['bold']);
    const imageLink = run(json, 'Image: Roadmap chart');
    expect(imageLink?.marks).toEqual(['link']);
    expect((imageLink?.attrs.link as { href: string }).href).toBe(
      'https://lh7-rt.googleusercontent.com/docsz/AD_4nXabc?key=xyz',
    );
    expect(find(json, 'image')).toEqual([]);
    expect(result.images).toEqual([]);
  });

  it('preserves Hindi and emoji and reports what was simplified', () => {
    expect(text(json)).toContain('नमस्ते दुनिया, mixed with English 🚀✨');
    expect(result.kinds).toEqual(expect.arrayContaining(['fonts', 'remote-images']));
    expect(result.report.notes.find((note) => note.kind === 'remote-images')?.count).toBe(1);
    expect(result.report.sourceLabel).toBe('Google Docs');
    // No explicit font size on body text (11pt is the source's default).
    for (const entry of runs(json)) {
      expect((entry.attrs.textStyle as { fontSize?: string } | undefined)?.fontSize ?? '').toBe('');
    }
    // The trailing interchange newline does not become an empty paragraph.
    expect(text(json.content?.at(-1))).toContain('नमस्ते');
  });
});

describe('Microsoft Word', () => {
  const result = paste(WORD_HTML);
  const { json } = result;

  it('keeps headings, inline formatting and empty paragraphs', () => {
    expect(result.report.source).toBe('word');
    expect(text(find(json, 'heading')[0])).toBe('Project brief');
    expect(run(json, 'brief')).toMatchObject({ attrs: { textStyle: { color: '#ff0000' } } });
    expect(run(json, 'bold')?.marks).toEqual(['bold']);
    expect(run(json, 'italic')?.marks).toEqual(['italic']);
    expect(run(json, 'underline')?.marks).toEqual(['underline']);
    expect(run(json, 'strike')?.marks).toEqual(['strike']);
    expect(run(json, 'highlight')).toMatchObject({ attrs: { highlight: { color: '#ffff00' } } });
    const top = json.content ?? [];
    expect(top[1]?.type).toBe('paragraph');
    expect(top[2]).toMatchObject({ type: 'paragraph' });
    expect(top[2]?.content).toBeUndefined();
  });

  it('rebuilds lists from mso-list paragraphs without the marker glyphs', () => {
    const bullet = find(json, 'bulletList')[0] as DocJSON;
    expect(bullet.content).toHaveLength(2);
    expect(text(bullet.content?.[0]?.content?.[0])).toBe('First bullet');
    expect(text(bullet.content?.[0]?.content?.[1])).toBe('Nested bullet');
    expect(bullet.content?.[0]?.content?.[1]?.type).toBe('bulletList');
    expect(text(bullet.content?.[1])).toBe('Second bullet');
    expect(run(json, 'bullet')?.marks).toEqual(['bold']);
    const ordered = find(json, 'orderedList')[0] as DocJSON;
    expect(ordered.content?.map(text)).toEqual(['Step one', 'Step two']);
    expect(text(json)).not.toMatch(/[·§]/);
    expect(text(json)).not.toContain('1.Step');
  });

  it('keeps the table, drops comments, deletions and unreadable images', () => {
    const table = find(json, 'table')[0] as DocJSON;
    expect(table.content?.map((row) => row.content?.map(text))).toEqual([
      ['Name', 'Role'],
      ['Asha', 'Editor'],
    ]);
    const all = text(json);
    expect(all).toContain('Text with a commented word and inserted text.');
    expect(all).not.toContain('removed');
    expect(all).not.toContain('reviewer comment');
    expect(all).not.toContain('[AB1]');
    expect(find(json, 'image')).toEqual([]);
    expect(result.kinds).toEqual(
      expect.arrayContaining([
        'fonts',
        'comments',
        'tracked-changes',
        'unreadable-images',
        'layout',
      ]),
    );
    const centered = (json.content ?? []).find((node) => text(node) === 'Centered double');
    expect(centered?.attrs).toMatchObject({ textAlign: 'center', lineHeight: '2' });
    expect(all).toContain('हिंदी और English with emoji 😀');
  });
});

describe('spreadsheets', () => {
  it('imports a Google Sheets range as a table', () => {
    const result = paste(GOOGLE_SHEETS_HTML);
    expect(result.report.source).toBe('google-sheets');
    expect(result.json.content).toHaveLength(1);
    const table = result.json.content?.[0] as DocJSON;
    expect(table.type).toBe('table');
    expect(table.content?.map((row) => row.content?.map(text))).toEqual([
      ['Item', 'Qty', 'Total'],
      ['Pens', '12', '36'],
      ['Line oneLine two', 'late'],
    ]);
    expect(run(result.json, 'Item')?.marks).toEqual(['bold']);
    expect(table.content?.[2]?.content?.[0]?.attrs).toMatchObject({ colspan: 2 });
    expect(find(table.content?.[2] as DocJSON, 'hardBreak')).toHaveLength(1);
    expect(run(result.json, 'late')).toMatchObject({
      marks: ['italic', 'textStyle'],
      attrs: { textStyle: { color: '#ff0000' } },
    });
    const numberCell = table.content?.[1]?.content?.[1]?.content?.[0];
    expect(numberCell?.attrs).toMatchObject({ textAlign: 'right' });
    expect(result.kinds).toEqual(expect.arrayContaining(['formulas', 'cell-styles']));
  });

  it('imports an Excel range, skipping hidden rows', () => {
    const result = paste(EXCEL_HTML);
    expect(result.report.source).toBe('excel');
    const table = result.json.content?.[0] as DocJSON;
    expect(table.content?.map((row) => row.content?.map(text))).toEqual([
      ['Region', 'Sales'],
      ['North', '800'],
      ['Total', '1200'],
    ]);
    expect(run(result.json, 'Region')?.marks).toEqual(['bold']);
    expect(result.kinds).toEqual(expect.arrayContaining(['formulas', 'cell-styles']));
  });
});

describe('browsers and code editors', () => {
  it('turns editor-coloured code into a code block', () => {
    const result = paste(CODE_EDITOR_HTML);
    expect(result.report.source).toBe('code-editor');
    expect(result.json.content).toHaveLength(1);
    const block = result.json.content?.[0] as DocJSON;
    expect(block.type).toBe('codeBlock');
    expect(text(block)).toBe("const answer = 42;\nif (answer) {\n  console.log('<b>ok</b>');\n}");
    expect(result.kinds).toEqual(['code-colors']);
  });

  it('normalises an ordinary web page fragment', () => {
    const result = paste(WEB_PAGE_HTML);
    const { json } = result;
    const types = (json.content ?? []).map((node) => node.type);
    expect(types).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'blockquote',
      'codeBlock',
      'taskList',
      'paragraph',
      'paragraph',
      'horizontalRule',
      'paragraph',
      'heading',
      'table',
    ]);
    expect(json.content?.[0]?.attrs?.level).toBe(2);
    expect(text(json.content?.[1])).toBe('Version 2 is out — see the changelog or the docs.');
    // A relative link cannot be resolved safely: its text stays, the link goes.
    expect(
      runs(json)
        .filter((entry) => entry.marks.includes('link'))
        .map((e) => e.text),
    ).toEqual(['the docs', 'Image: hero shot.png']);
    expect((run(json, 'the docs')?.attrs.link as { href: string }).href).toBe(
      'https://example.org/docs?a=1&b=2',
    );
    expect(text(json.content?.[2])).toBe('Second line in its own block');
    expect(json.content?.[4]).toMatchObject({ attrs: { language: 'js' } });
    expect(text(json.content?.[4])).toBe('const a = 1;\nconsole.log(a);');
    expect(find(json, 'taskItem').map((item) => [text(item).trim(), item.attrs?.checked])).toEqual([
      ['shipped', true],
      ['pending', false],
    ]);
    expect(text(json.content?.[6])).toBe('Image: hero shot.png');
    expect(text(json.content?.[7])).toBe('Hero shot');
    expect(json.content?.[9]?.attrs).toMatchObject({ textAlign: 'right' });
    expect(run(json, 'marked')?.marks).toEqual(['highlight']);
    expect(run(json, 'Ctrl')?.marks).toEqual(['code']);
    expect(json.content?.[10]?.attrs?.level).toBe(4);
    const table = json.content?.[11] as DocJSON;
    expect(table.content?.[0]?.content?.map((cell) => cell.type)).toEqual([
      'tableHeader',
      'tableHeader',
    ]);
    expect(result.kinds).toEqual(
      expect.arrayContaining(['remote-images', 'unsafe-links', 'fonts']),
    );
  });

  it('keeps separate blocks separate and handles bare text', () => {
    expect(paste('just text').json.content?.map(text)).toEqual(['just text']);
    expect(paste('<div>one</div><div>two</div>three').json.content?.map(text)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(
      paste('<span>a</span><section><p>b</p>c<div><div>d</div></div></section>').json.content?.map(
        text,
      ),
    ).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('images', () => {
  const PNG_1PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('turns embedded images into upload placeholders in document order', () => {
    const result = paste(
      `<p>before <img src="${PNG_1PX}" alt="first"> middle</p><p><img src="${PNG_1PX}"></p><p>after</p>`,
    );
    expect(result.images).toHaveLength(2);
    expect(result.images[0]).toMatchObject({ mime: 'image/png', name: 'pasted-image-1.png' });
    expect(result.images[0]?.bytes.byteLength).toBeGreaterThan(50);
    expect(result.report.uploads).toBe(2);
    const types = (result.json.content ?? []).map((node) => node.type);
    expect(types).toEqual(['paragraph', 'image', 'paragraph', 'image', 'paragraph']);
    expect(result.json.content?.map((node) => text(node).trim())).toEqual([
      'before',
      '',
      'middle',
      '',
      'after',
    ]);
    const images = find(result.json, 'image');
    expect(images.map((image) => image.attrs?.uploadId)).toEqual(
      result.images.map((image) => image.uploadId),
    );
    expect(images[0]?.attrs).toMatchObject({ assetId: null, alt: 'first' });
    // No image bytes ever enter the document.
    expect(JSON.stringify(result.json)).not.toContain('base64');
  });

  it('rejects images by type or size and caps their number', () => {
    const svg =
      'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
    const rejected = paste(`<p>a</p><img src="${svg}"><img src="data:image/png;base64,!!!">`);
    expect(rejected.images).toEqual([]);
    expect(find(rejected.json, 'image')).toEqual([]);
    expect(rejected.kinds).toEqual(
      expect.arrayContaining(['rejected-images', 'unreadable-images']),
    );

    const tooBig = paste(`<img src="${PNG_1PX}">`, { acceptImage: () => false });
    expect(tooBig.images).toEqual([]);
    expect(tooBig.kinds).toContain('rejected-images');

    const viewer = paste(`<img src="${PNG_1PX}">`, { acceptImage: undefined });
    expect(viewer.images).toEqual([]);

    const many = paste(
      Array.from({ length: MAX_PASTE_IMAGES + 3 }, () => `<img src="${PNG_1PX}">`).join(''),
    );
    expect(many.images).toHaveLength(MAX_PASTE_IMAGES);
    expect(many.report.notes.find((note) => note.kind === 'rejected-images')?.count).toBe(3);
  });

  it('never fetches or embeds remote, local or blob images', () => {
    const result = paste(
      '<p><img src="https://example.com/a.png" alt="Chart"><img src="file:///C:/x.png"><img src="blob:https://example.com/1"><img src="cid:part1"><img></p>',
    );
    expect(find(result.json, 'image')).toEqual([]);
    expect(text(result.json)).toBe('Image: Chart');
    expect(result.report.notes.find((note) => note.kind === 'unreadable-images')?.count).toBe(4);
  });
});

describe("the editor's own clipboard format", () => {
  const sample = getDocumentSchema()
    .nodeFromJSON(buildSampleDocument({ imageAssetId: ASSET_ID }))
    .toJSON() as DocJSON;
  const ownHtml = generateHTML(sample, extensions);
  const mark = (html: string, documentId: string): string =>
    html.replace(/data-asset-id=/g, `data-rd-doc="${documentId}" data-asset-id=`);

  it('round-trips a copy within the same document without loss', () => {
    const result = paste(mark(ownHtml, DOCUMENT_ID));
    expect(result.report.source).toBe('realtimedocs');
    expect(result.report.notes).toEqual([]);
    expect(result.json).toEqual(sample);
  });

  it('does not carry assets into another document', () => {
    const result = paste(mark(ownHtml, OTHER_DOCUMENT_ID));
    expect(find(result.json, 'image')).toEqual([]);
    expect(result.kinds).toEqual(['foreign-assets']);
    expect(text(result.json)).toContain('Launch notes: RealtimeDocs demo');
  });

  it('drops upload placeholders that belong to another session', () => {
    const html = `<p data-rd-doc="${DOCUMENT_ID}">x</p><figure data-type="image" data-rd-doc="${DOCUMENT_ID}" data-upload-id="${ASSET_ID}" data-align="center"><img></figure>`;
    const result = paste(html);
    expect(find(result.json, 'image')).toEqual([]);
    expect(text(result.json)).toBe('x');
  });
});

describe('limits', () => {
  it('falls back to plain text for oversized HTML', () => {
    const result = processPastedHtml(`<p>${'a'.repeat(200)}</p>`, options({ maxHtmlLength: 100 }));
    expect(result.html).toBeNull();
    expect(result.report.notes.map((note) => note.kind)).toEqual(['too-large']);
  });
});

describe('malicious clipboard content', () => {
  const FORBIDDEN = [
    /<script/i,
    /javascript:/i,
    /vbscript:/i,
    /data:text\/html/i,
    /\bon[a-z]+\s*=/i,
    /expression\s*\(/i,
    /url\s*\(/i,
    /-moz-binding/i,
    /behavior\s*:/i,
    /srcdoc/i,
    /evil\.example/i,
  ];

  function assertInert(json: DocJSON, html: string): void {
    // 1. The normalised HTML has no executable element, attribute or URL.
    const probe = document.createElement('div');
    probe.innerHTML = html;
    for (const element of [...probe.querySelectorAll('*')]) {
      for (const attribute of [...element.attributes]) {
        expect(attribute.name.startsWith('on')).toBe(false);
        expect(['src', 'srcset', 'action', 'formaction', 'background', 'ping']).not.toContain(
          attribute.name,
        );
        for (const pattern of FORBIDDEN.slice(0, 10)) {
          expect(`${attribute.name}=${attribute.value}`).not.toMatch(pattern);
        }
      }
      expect([
        'script',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'button',
        'style',
        'link',
        'meta',
        'base',
        'svg',
        'math',
        'video',
        'audio',
        'template',
      ]).not.toContain(element.localName);
    }
    // 2. The document JSON holds only schema nodes with safe attributes.
    const schema = getDocumentSchema();
    schema.nodeFromJSON(json).check();
    const walk = (node: DocJSON): void => {
      expect(schema.nodes[node.type] ?? (node.type === 'text' ? true : undefined)).toBeDefined();
      for (const [name, value] of Object.entries(node.attrs ?? {})) {
        if (typeof value !== 'string') continue;
        for (const pattern of FORBIDDEN) expect(`${name}=${value}`).not.toMatch(pattern);
        if (name === 'assetId' || name === 'uploadId') {
          expect(value).toMatch(/^[0-9a-f-]{36}$/);
        }
      }
      for (const mark of node.marks ?? []) {
        expect(schema.marks[mark.type]).toBeDefined();
        for (const value of Object.values(mark.attrs ?? {})) {
          if (typeof value !== 'string') continue;
          for (const pattern of FORBIDDEN.slice(0, 10)) expect(value).not.toMatch(pattern);
        }
        if (mark.type === 'link') {
          expect(isSafeLinkHref((mark.attrs as { href?: unknown }).href)).toBe(true);
        }
      }
      for (const child of node.content ?? []) walk(child);
    };
    walk(json);
  }

  it.each(MALICIOUS_CORPUS)('$name: nothing executable survives', ({ html }) => {
    const result = paste(html);
    expect(result.html).not.toBeNull();
    assertInert(result.json, result.html ?? '');
    // Script bodies are dropped, not kept as visible text.
    expect(text(result.json)).not.toContain('xss-marker');
    expect(text(result.json)).not.toContain('__pwned');
  });

  it('reports removed active content, objects and forms', () => {
    const scripts = paste(MALICIOUS_CORPUS[0]?.html ?? '');
    expect(scripts.kinds).toContain('active-content');
    expect(text(scripts.json)).toBe('beforeafter');
    const frames = paste(
      MALICIOUS_CORPUS.find((entry) => entry.name === 'nested iframes')?.html ?? '',
    );
    expect(frames.kinds).toContain('embedded-objects');
    const forms = paste(
      MALICIOUS_CORPUS.find((entry) => entry.name === 'form with action')?.html ?? '',
    );
    expect(forms.kinds).toContain('forms');
    expect(text(forms.json)).toContain('after');
    const links = paste(
      '<a href="javascript:alert(1)">bad</a> <a href="https://ok.example/">good</a>',
    );
    expect(
      runs(links.json)
        .filter((entry) => entry.marks.includes('link'))
        .map((e) => e.text),
    ).toEqual(['good']);
    expect(text(links.json)).toBe('bad good');
    expect(links.kinds).toContain('active-content');
  });

  it('keeps a crafted diagram as inert source text', () => {
    const entry = MALICIOUS_CORPUS.find((item) => item.name === 'crafted editor nodes');
    const result = paste(entry?.html ?? '');
    const diagram = find(result.json, 'diagram')[0];
    expect(diagram?.attrs).toEqual({ language: 'mermaid' });
    // The text is data for the (strict) Mermaid renderer, not markup.
    expect(text(diagram)).toContain('graph TD');
    expect(find(result.json, 'image')).toEqual([]);
    expect(find(result.json, 'attachment')).toEqual([]);
  });
});

describe('ruler indents', () => {
  it('keeps this editor’s own indents and never turns a foreign style into one', () => {
    const { json } = paste(
      `<meta charset="utf-8"><div data-rd-doc="${DOCUMENT_ID}">` +
        '<p data-indent-left="12.5" data-indent-right="4" data-indent-first-line="-6" ' +
        'style="margin-left: calc(var(--rd-mm, 3.7795px) * 12.5)">indented</p>' +
        '<p data-indent-left="12; position: fixed" data-indent-first-line="-50">hostile</p>' +
        '<p style="margin-right: 80px; text-indent: 40px">foreign</p></div>',
    );
    const blocks = json.content!.filter((node) => node.type === 'paragraph');
    expect(blocks[0]!.attrs).toMatchObject({
      indentLeft: 12.5,
      indentRight: 4,
      indentFirstLine: -6,
    });
    expect(blocks[1]!.attrs).toMatchObject({
      indentLeft: null,
      indentRight: null,
      indentFirstLine: null,
    });
    expect(blocks[2]!.attrs).toMatchObject({
      indentLeft: null,
      indentRight: null,
      indentFirstLine: null,
    });
  });
});
