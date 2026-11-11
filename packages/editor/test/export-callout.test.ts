// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toMarkdown, toPlainText } from '../src/export/index';
import type { DocJSON } from '../src/schema/extensions';

const doc = (variant: unknown): DocJSON => ({
  type: 'doc',
  content: [
    {
      type: 'callout',
      attrs: { variant },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Check the share mode first.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line.' }] },
      ],
    },
  ],
});

describe('callout export', () => {
  it('writes a GitHub-style alert in Markdown', () => {
    const md = toMarkdown(doc('warning'));
    expect(md).toContain('> [!WARNING]');
    expect(md).toContain('> Check the share mode first.');
    expect(md).toContain('> Second line.');
  });

  it('maps every variant and falls back to NOTE for an unknown one', () => {
    expect(toMarkdown(doc('info'))).toContain('> [!NOTE]');
    expect(toMarkdown(doc('tip'))).toContain('> [!TIP]');
    expect(toMarkdown(doc('success'))).toContain('> [!IMPORTANT]');
    expect(toMarkdown(doc('danger'))).toContain('> [!CAUTION]');
    expect(toMarkdown(doc('<script>'))).toContain('> [!NOTE]');
    expect(toMarkdown(doc('<script>'))).not.toContain('script');
  });

  it('labels the callout in plain text and keeps its content', () => {
    const text = toPlainText(doc('tip'));
    expect(text).toContain('[Tip]');
    expect(text).toContain('Check the share mode first.');
    expect(text).toContain('Second line.');
  });
});
