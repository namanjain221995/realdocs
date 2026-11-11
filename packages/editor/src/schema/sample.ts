/**
 * Seeded sample document: realistic mixed content with no confidential data.
 * The caller supplies the id of an already-uploaded demo image asset.
 */
import type { DocJSON } from './extensions';

type Mark = NonNullable<DocJSON['marks']>[number];

const text = (value: string, ...marks: Mark[]): DocJSON =>
  marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const bold: Mark = { type: 'bold' };
const italic: Mark = { type: 'italic' };
const underline: Mark = { type: 'underline' };
const code: Mark = { type: 'code' };
const highlight = (color: string): Mark => ({ type: 'highlight', attrs: { color } });
const link = (href: string): Mark => ({
  type: 'link',
  attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null },
});

const paragraph = (...content: DocJSON[]): DocJSON => ({ type: 'paragraph', content });
const heading = (level: number, value: string): DocJSON => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const cell = (type: 'tableHeader' | 'tableCell', value: string): DocJSON => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: [paragraph(text(value))],
});
const row = (type: 'tableHeader' | 'tableCell', ...values: string[]): DocJSON => ({
  type: 'tableRow',
  content: values.map((value) => cell(type, value)),
});
const task = (checked: boolean, value: string): DocJSON => ({
  type: 'taskItem',
  attrs: { checked },
  content: [paragraph(text(value))],
});
const bullet = (...content: DocJSON[]): DocJSON => ({
  type: 'listItem',
  content: [paragraph(...content)],
});

export const SAMPLE_DOCUMENT_TITLE = 'Welcome to RealtimeDocs — sample launch notes';

export const SAMPLE_MERMAID_SOURCE = `flowchart LR
  A[Editor types] -->|Yjs update| B(Collaboration server)
  B -->|append + commit| C[(PostgreSQL)]
  B -->|broadcast| D[Browser viewers]
  B -->|broadcast| E[Desktop panel]
  C -. durable ack .-> A`;

export const SAMPLE_CODE = `// Durable acknowledgement, simplified
session.on('status', ({ connection, save }) => {
  indicator.textContent = \`\${connection} · \${save}\`;
});`;

export function buildSampleDocument(options: { imageAssetId: string | null }): DocJSON {
  const content: DocJSON[] = [
    heading(1, 'Launch notes: RealtimeDocs demo'),
    paragraph(
      text('This sample shows what a shared document can contain. Edit it, share a '),
      text('view-only link', bold),
      text(', and watch changes arrive in every connected browser and desktop panel.'),
    ),
    paragraph(
      text('Mixed scripts work as expected: '),
      text('नमस्ते, यह एक लाइव दस्तावेज़ है', highlight('#fde68a')),
      text(' — typed alongside English, with emoji 🚀✨ and '),
      text('formatted', italic),
      text(' '),
      text('inline', underline),
      text(' text and '),
      text('code', code),
      text('.'),
    ),
    heading(2, 'Agenda'),
    {
      type: 'orderedList',
      attrs: { start: 1, type: null },
      content: [
        bullet(text('Review the rollout timeline')),
        bullet(text('Confirm owners for each workstream')),
        bullet(
          text('Read the '),
          text('project background', link('https://example.com/realtimedocs/background')),
          text(' before the call'),
        ),
      ],
    },
    heading(2, 'Checklist'),
    {
      type: 'taskList',
      content: [
        task(true, 'Create the document and assign an editor'),
        task(true, 'Generate a view-only share link'),
        task(false, 'Open the floating desktop panel'),
        task(false, 'Verify the receiving participant view before presenting'),
      ],
    },
    heading(2, 'Rollout timeline'),
    {
      type: 'table',
      content: [
        row('tableHeader', 'Phase', 'Owner', 'Status'),
        row('tableCell', 'Pilot with one team', 'Asha', 'Done'),
        row('tableCell', 'Company-wide rollout', 'Miguel', 'In progress'),
        row('tableCell', 'Retrospective', 'Priya', 'Planned'),
      ],
    },
    heading(2, 'How an edit travels'),
    {
      type: 'diagram',
      attrs: { language: 'mermaid' },
      content: [text(SAMPLE_MERMAID_SOURCE)],
    },
  ];

  if (options.imageAssetId) {
    content.push({
      type: 'image',
      attrs: {
        assetId: options.imageAssetId,
        uploadId: null,
        alt: 'Illustration of a document shared between a browser and a floating desktop panel',
        caption: 'Demo illustration bundled with RealtimeDocs (no confidential data).',
        width: 70,
        align: 'center',
        naturalWidth: 960,
        naturalHeight: 540,
        name: 'realtimedocs-demo.png',
      },
    });
  }

  content.push(
    heading(2, 'Status indicator snippet'),
    { type: 'codeBlock', attrs: { language: 'typescript' }, content: [text(SAMPLE_CODE)] },
    {
      type: 'callout',
      attrs: { variant: 'tip' },
      content: [
        paragraph(
          text('Tip: ', bold),
          text('“Saved” appears only after the server confirms the change is in durable storage.'),
        ),
      ],
    },
    {
      type: 'blockquote',
      content: [
        paragraph(text('Live notes are only as private as the screen you choose to share.')),
      ],
    },
    { type: 'horizontalRule' },
    paragraph(
      text('End of sample. Delete anything here — snapshots let an administrator restore it.'),
    ),
  );

  return { type: 'doc', content };
}
