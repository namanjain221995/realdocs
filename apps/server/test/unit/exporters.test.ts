import { collectAssetIds, toMarkdown, toPlainText } from '@realtimedocs/editor/export';
import {
  SAMPLE_CODE,
  SAMPLE_MERMAID_SOURCE,
  buildSampleDocument,
  getDocumentSchema,
  type DocJSON,
} from '@realtimedocs/editor/schema';
import { describe, expect, it } from 'vitest';

const ASSET_A = '3f2b8c1e-9a4d-4c7b-8e21-5d6f7a8b9c0d';
const ASSET_B = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

type Mark = NonNullable<DocJSON['marks']>[number];
const text = (value: string, ...marks: Mark[]): DocJSON =>
  marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const p = (...content: DocJSON[]): DocJSON => ({ type: 'paragraph', content });
const doc = (...content: DocJSON[]): DocJSON => ({ type: 'doc', content });
const bold: Mark = { type: 'bold' };
const italic: Mark = { type: 'italic' };
const strike: Mark = { type: 'strike' };
const underline: Mark = { type: 'underline' };
const code: Mark = { type: 'code' };
const link = (href: string): Mark => ({ type: 'link', attrs: { href } });
const item = (...content: DocJSON[]): DocJSON => ({ type: 'listItem', content });
const cell = (type: 'tableHeader' | 'tableCell', ...content: DocJSON[]): DocJSON => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content,
});
const image = (attrs: Record<string, unknown>): DocJSON => ({
  type: 'image',
  attrs: { assetId: null, uploadId: null, alt: '', caption: '', name: '', ...attrs },
});

describe('toMarkdown: inline formatting', () => {
  it('writes headings and basic marks', () => {
    const markdown = toMarkdown(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
        p(
          text('plain '),
          text('bold', bold),
          text(' '),
          text('italic', italic),
          text(' '),
          text('gone', strike),
          text(' '),
          text('code()', code),
        ),
      ),
    );
    expect(markdown).toBe('## Title\n\nplain **bold** *italic* ~~gone~~ `code()`\n');
  });

  it('nests marks without repeating delimiters', () => {
    const markdown = toMarkdown(
      doc(p(text('a '), text('b ', bold), text('c', bold, italic), text(' d', bold), text(' e'))),
    );
    expect(markdown).toBe('a **b *c* d** e\n');
  });

  it('keeps whitespace outside emphasis delimiters', () => {
    expect(toMarkdown(doc(p(text('x'), text(' padded ', bold), text('y'))))).toBe(
      'x **padded** y\n',
    );
    expect(toMarkdown(doc(p(text('one ', italic), text('two', italic), text(' three'))))).toBe(
      '*one two* three\n',
    );
  });

  it('writes underline and highlight as inline HTML and drops colours and sizes', () => {
    const markdown = toMarkdown(
      doc(
        p(
          text('u', underline),
          text(' '),
          text('h', { type: 'highlight', attrs: { color: '#fde68a' } }),
          text(' '),
          text('red', { type: 'textStyle', attrs: { color: '#ff0000', fontSize: '30px' } }),
        ),
      ),
    );
    expect(markdown).toBe('<u>u</u> <mark>h</mark> red\n');
  });

  it('writes safe links and drops unsafe ones', () => {
    const markdown = toMarkdown(
      doc(
        p(
          text('see '),
          text('the docs', link('https://example.com/a?b=1')),
          text(' or '),
          text('bold link', bold, link('https://example.com/a_(b)')),
          text(' not '),
          text('this', link('javascript:alert(1)')),
        ),
      ),
    );
    expect(markdown).toBe(
      'see [the docs](https://example.com/a?b=1) or [**bold link**](<https://example.com/a_(b)>) not this\n',
    );
  });

  it('escapes Markdown syntax in text', () => {
    const markdown = toMarkdown(
      doc(
        p(text('*not emphasis* and [not a link](x) and <b>not html</b> and a|b and back`tick')),
        p(text('# not a heading')),
        p(text('- not a list')),
        p(text('1. not ordered')),
        p(text('---')),
      ),
    );
    expect(markdown).toBe(
      [
        '\\*not emphasis\\* and \\[not a link\\](x) and \\<b\\>not html\\</b\\> and a\\|b and back\\`tick',
        '\\# not a heading',
        '\\- not a list',
        '1\\. not ordered',
        '\\---',
        '',
      ]
        .join('\n\n')
        .replace(/\n\n$/, '\n'),
    );
  });

  it('handles inline code that contains backticks, and hard breaks', () => {
    expect(toMarkdown(doc(p(text('a `b` c', code))))).toBe('``a `b` c``\n');
    expect(toMarkdown(doc(p(text('one'), { type: 'hardBreak' }, text('two'))))).toBe(
      'one\\\ntwo\n',
    );
  });
});

describe('toMarkdown: blocks', () => {
  it('writes nested bullet, ordered and task lists', () => {
    const markdown = toMarkdown(
      doc(
        {
          type: 'bulletList',
          content: [
            item(p(text('one'))),
            item(p(text('two')), {
              type: 'orderedList',
              attrs: { start: 3 },
              content: [item(p(text('three'))), item(p(text('four')))],
            }),
          ],
        },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [p(text('done'))] },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                p(text('open')),
                {
                  type: 'taskList',
                  content: [
                    { type: 'taskItem', attrs: { checked: false }, content: [p(text('sub'))] },
                  ],
                },
              ],
            },
          ],
        },
      ),
    );
    expect(markdown).toBe(
      [
        '- one',
        '- two',
        '  3. three',
        '  4. four',
        '',
        '- [x] done',
        '- [ ] open',
        '  - [ ] sub',
        '',
      ].join('\n'),
    );
  });

  it('separates multi-paragraph list items with blank lines', () => {
    const markdown = toMarkdown(
      doc({
        type: 'orderedList',
        attrs: { start: 1 },
        content: [item(p(text('first')), p(text('more'))), item(p(text('second')))],
      }),
    );
    expect(markdown).toBe('1. first\n\n   more\n\n2. second\n');
  });

  it('writes block quotes, code blocks with a language and rules', () => {
    const markdown = toMarkdown(
      doc(
        { type: 'blockquote', content: [p(text('quoted')), p(text('twice'))] },
        {
          type: 'codeBlock',
          attrs: { language: 'typescript' },
          content: [text('const a = `x`;\n```')],
        },
        { type: 'codeBlock', attrs: { language: null }, content: [text('plain')] },
        { type: 'horizontalRule' },
      ),
    );
    expect(markdown).toBe(
      [
        '> quoted',
        '>',
        '> twice',
        '',
        '````typescript',
        'const a = `x`;',
        '```',
        '````',
        '',
        '```',
        'plain',
        '```',
        '',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('writes diagrams as mermaid blocks', () => {
    const markdown = toMarkdown(
      doc({
        type: 'diagram',
        attrs: { language: 'mermaid' },
        content: [text('graph TD\n  A-->B')],
      }),
    );
    expect(markdown).toBe('```mermaid\ngraph TD\n  A-->B\n```\n');
  });

  it('writes tables as GitHub-flavoured Markdown and flattens cell blocks', () => {
    const markdown = toMarkdown(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [cell('tableHeader', p(text('Name'))), cell('tableHeader', p(text('Notes')))],
          },
          {
            type: 'tableRow',
            content: [
              cell('tableCell', p(text('a|b', bold))),
              cell('tableCell', p(text('line one')), p(text('line two')), {
                type: 'bulletList',
                content: [item(p(text('point')))],
              }),
            ],
          },
        ],
      }),
    );
    expect(markdown).toBe(
      [
        '| Name | Notes |',
        '| --- | --- |',
        '| **a\\|b** | line one<br>line two<br>point |',
        '',
      ].join('\n'),
    );
  });

  it('adds an empty header row when the table has none and pads merged cells', () => {
    const markdown = toMarkdown(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', attrs: { colspan: 2, rowspan: 1 }, content: [p(text('wide'))] },
            ],
          },
          {
            type: 'tableRow',
            content: [cell('tableCell', p(text('x'))), cell('tableCell', p(text('y')))],
          },
        ],
      }),
    );
    expect(markdown).toBe(['|  |  |', '| --- | --- |', '| wide |  |', '| x | y |', ''].join('\n'));
  });

  it('references images and attachments under assets/', () => {
    const content = doc(
      image({ assetId: ASSET_A, alt: 'A [chart]', caption: 'Figure 1', name: 'chart 1.png' }),
      {
        type: 'attachment',
        attrs: { assetId: ASSET_B, name: 'report (final).pdf', sizeBytes: 10 },
      },
      image({ assetId: null, uploadId: ASSET_B, alt: 'pending', name: 'later.png' }),
    );
    const names = new Map([
      [ASSET_A, 'chart 1.png'],
      [ASSET_B, 'report (final).pdf'],
    ]);
    const markdown = toMarkdown(content, { assetFileName: (id) => names.get(id) ?? null });
    expect(markdown).toBe(
      [
        '![A \\[chart\\]](assets/chart%201.png)',
        '',
        '*Figure 1*',
        '',
        '[report (final).pdf](assets/report%20%28final%29.pdf)',
        '',
        '*\\[image: pending\\]*',
        '',
      ].join('\n'),
    );
    // Unknown assets become placeholders instead of broken links.
    expect(toMarkdown(content, { assetFileName: () => null })).toContain(
      '*\\[attachment: report (final).pdf\\]*',
    );
  });

  it('drops alignment, indentation and line spacing', () => {
    const markdown = toMarkdown(
      doc({
        type: 'paragraph',
        attrs: { textAlign: 'center', indent: 3, lineHeight: '2' },
        content: [text('centred')],
      }),
    );
    expect(markdown).toBe('centred\n');
  });

  it('returns an empty string for an empty document', () => {
    expect(toMarkdown(doc(p()))).toBe('');
    expect(toMarkdown({ type: 'doc' })).toBe('');
  });
});

describe('sample document', () => {
  const sample = buildSampleDocument({ imageAssetId: ASSET_A });

  it('is valid under the authoritative schema', () => {
    getDocumentSchema().nodeFromJSON(sample).check();
  });

  it('exports to Markdown with every block type represented', () => {
    const markdown = toMarkdown(sample, { assetFileName: () => 'realtimedocs-demo.png' });
    expect(markdown).toContain('# Launch notes: RealtimeDocs demo');
    expect(markdown).toContain('**view-only link**');
    expect(markdown).toContain('<mark>नमस्ते, यह एक लाइव दस्तावेज़ है</mark>');
    expect(markdown).toContain('🚀✨');
    expect(markdown).toContain('1. Review the rollout timeline');
    expect(markdown).toContain('[project background](https://example.com/realtimedocs/background)');
    expect(markdown).toContain('- [x] Create the document and assign an editor');
    expect(markdown).toContain('- [ ] Open the floating desktop panel');
    expect(markdown).toContain(
      '| Phase | Owner | Status |\n| --- | --- | --- |\n| Pilot with one team | Asha | Done |',
    );
    expect(markdown).toContain(`\`\`\`mermaid\n${SAMPLE_MERMAID_SOURCE}\n\`\`\``);
    expect(markdown).toContain(
      '![Illustration of a document shared between a browser and a floating desktop panel](assets/realtimedocs-demo.png)',
    );
    expect(markdown).toContain(`\`\`\`typescript\n${SAMPLE_CODE}\n\`\`\``);
    expect(markdown).toContain('> **Tip:** “Saved” appears only after');
    expect(markdown).toContain('\n---\n');
  });

  it('exports to plain text', () => {
    const plain = toPlainText(sample);
    expect(plain).toContain('Launch notes: RealtimeDocs demo\n');
    expect(plain).toContain(
      '1. Review the rollout timeline\n2. Confirm owners for each workstream',
    );
    expect(plain).toContain('[x] Create the document and assign an editor');
    expect(plain).toContain('[ ] Open the floating desktop panel');
    expect(plain).toContain('Phase\tOwner\tStatus\nPilot with one team\tAsha\tDone');
    expect(plain).toContain(SAMPLE_MERMAID_SOURCE);
    expect(plain).toContain('[Image: Illustration of a document shared');
    expect(plain).toContain('[Tip]\nTip: “Saved” appears only after');
    expect(plain).toContain('----------');
    expect(plain).not.toMatch(/\*\*|<mark>|```/);
    expect(plain.endsWith('\n')).toBe(true);
  });
});

describe('toPlainText', () => {
  it('keeps text and structure without markup', () => {
    const plain = toPlainText(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [text('Head')] },
        p(text('a '), text('b', bold), text(' '), text('link', link('https://example.com'))),
        {
          type: 'bulletList',
          content: [item(p(text('one')), { type: 'bulletList', content: [item(p(text('deep')))] })],
        },
        { type: 'attachment', attrs: { assetId: ASSET_B, name: 'notes.txt' } },
      ),
    );
    expect(plain).toBe('Head\n\na b link\n\n- one\n  - deep\n\n[Attachment: notes.txt]\n');
  });

  it('returns an empty string for an empty document', () => {
    expect(toPlainText(doc(p()))).toBe('');
  });
});

describe('collectAssetIds', () => {
  it('returns unique ids of images and attachments in document order', () => {
    const content = doc(
      image({ assetId: ASSET_B }),
      {
        type: 'table',
        content: [{ type: 'tableRow', content: [cell('tableCell', image({ assetId: ASSET_A }))] }],
      },
      { type: 'attachment', attrs: { assetId: ASSET_B, name: 'again.pdf' } },
      image({ assetId: null, uploadId: ASSET_A }),
      image({ assetId: 'not-a-uuid' }),
      // An id on an unrelated node type is not an asset reference.
      { type: 'paragraph', attrs: { assetId: '11111111-1111-4111-8111-111111111111' } },
    );
    expect(collectAssetIds(content)).toEqual([ASSET_B, ASSET_A]);
    expect(collectAssetIds(doc(p(text('none'))))).toEqual([]);
  });
});
