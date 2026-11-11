// @vitest-environment jsdom
/** Find for readers and editors, replace for editors. */
import type { JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIND_DEBOUNCE_MS,
  FIND_MAX_MATCHES,
  findMatches,
  findPluginKey,
  getFindSummary,
} from '../src/editor/findReplace';
import { getDocumentSchema } from '../src/schema';
import { createTestEditor, outline, settle, type TestEditor } from './editor-helpers';

let current: TestEditor | null = null;

function setup(content: JSONContent, canEdit = true): TestEditor {
  current = createTestEditor({ content, canEdit });
  return current;
}

afterEach(() => {
  current?.destroy();
  current = null;
});

const text = (value: string): JSONContent => ({ type: 'text', text: value });
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

const node = (content: JSONContent) => getDocumentSchema().nodeFromJSON(content);
const found = (content: JSONContent, query: string, caseSensitive = false): string[] => {
  const root = node(content);
  return findMatches(root, query, caseSensitive).map((match) =>
    root.textBetween(match.from, match.to, '\n', '￼'),
  );
};

const SAMPLE = doc(
  { type: 'heading', attrs: { level: 1 }, content: [text('The plan')] },
  paragraph(
    text('Review the '),
    { ...text('timeline'), marks: [{ type: 'bold' }] },
    text(' and the owners.'),
  ),
  {
    type: 'bulletList',
    content: [
      { type: 'listItem', content: [paragraph(text('Then the retrospective'))] },
      { type: 'listItem', content: [paragraph(text('Nothing here'))] },
    ],
  },
  { type: 'codeBlock', attrs: { language: 'javascript' }, content: [text('const theme = "the";')] },
);

function decorated(t: TestEditor): { all: string[]; current: string[] } {
  const dom = t.editor.view.dom;
  return {
    all: [...dom.querySelectorAll('.rd-find-match')].map((element) => element.textContent ?? ''),
    current: [...dom.querySelectorAll('.rd-find-match--current')].map(
      (element) => element.textContent ?? '',
    ),
  };
}

describe('findMatches', () => {
  it('finds every occurrence in every text block, ignoring case by default', () => {
    expect(found(SAMPLE, 'the')).toEqual(['The', 'the', 'the', 'The', 'the', 'the', 'the']);
    expect(found(SAMPLE, 'the', true)).toEqual(['the', 'the', 'the', 'the', 'the']);
    expect(found(SAMPLE, 'THE', true)).toEqual([]);
  });

  it('matches across differently formatted text of one block, never across blocks', () => {
    // "the timeline" spans plain and bold text.
    expect(found(SAMPLE, 'the timeline and')).toEqual(['the timeline and']);
    const two = doc(paragraph(text('end of one')), paragraph(text('start of two')));
    expect(found(two, 'one start')).toEqual([]);
    expect(found(two, 'onestart')).toEqual([]);
  });

  it('returns positions that select exactly the matched text', () => {
    const root = node(SAMPLE);
    for (const match of findMatches(root, 'retrospective', false)) {
      expect(root.textBetween(match.from, match.to)).toBe('retrospective');
    }
  });

  it('keeps positions aligned after inline nodes that are not text', () => {
    const withBreak = doc(paragraph(text('first'), { type: 'hardBreak' }, text('second word')));
    const root = node(withBreak);
    const matches = findMatches(root, 'second', false);
    expect(matches).toHaveLength(1);
    const match = matches[0];
    expect(match && root.textBetween(match.from, match.to)).toBe('second');
    // A query cannot match "through" the break.
    expect(found(withBreak, 'firstsecond')).toEqual([]);
  });

  it('does not report overlapping matches and never loops on an empty query', () => {
    expect(found(doc(paragraph(text('aaaa'))), 'aa')).toEqual(['aa', 'aa']);
    expect(found(SAMPLE, '')).toEqual([]);
  });

  it('finds Devanagari, emoji and other non-ASCII text', () => {
    const mixed = doc(paragraph(text('नमस्ते दुनिया, नमस्ते 🚀 Straße STRASSE')));
    expect(found(mixed, 'नमस्ते')).toEqual(['नमस्ते', 'नमस्ते']);
    expect(found(mixed, '🚀')).toEqual(['🚀']);
    expect(found(mixed, 'straße')).toEqual(['Straße']);
  });

  it('stays correct when lower-casing changes the length of the text', () => {
    // U+0130 lower-cases to two code units: offsets would drift if the
    // lower-cased text were searched.
    const tricky = doc(paragraph(text('İİİ needle here')));
    const root = node(tricky);
    const matches = findMatches(root, 'needle', false);
    expect(matches).toHaveLength(1);
    const match = matches[0];
    expect(match && root.textBetween(match.from, match.to)).toBe('needle');
  });

  it('stops collecting at the match limit', () => {
    const many = doc(paragraph(text('ab '.repeat(FIND_MAX_MATCHES + 500))));
    expect(findMatches(node(many), 'ab', false)).toHaveLength(FIND_MAX_MATCHES);
  });
});

describe('find in the editor', () => {
  it('highlights all matches, marks one as current and never changes the document', () => {
    const t = setup(SAMPLE);
    const before = JSON.stringify(t.json());
    t.editor.commands.setTextSelection(1);
    t.editor.commands.setFindQuery('the');
    expect(getFindSummary(t.editor.state)).toEqual({ query: 'the', total: 7, position: 1 });
    expect(decorated(t).all).toHaveLength(7);
    expect(decorated(t).current).toEqual(['The']);
    expect(JSON.stringify(t.json())).toBe(before);
    // Decorations are not part of the shared document either.
    expect(t.ydoc.getXmlFragment('default').toString()).not.toContain('rd-find-match');
  });

  it('starts at the first match after the reader’s position', () => {
    const t = setup(SAMPLE);
    // Inside the first list item.
    let position = 0;
    t.editor.state.doc.descendants((child, pos) => {
      if (child.isText && child.text === 'Then the retrospective') position = pos;
    });
    t.editor.commands.setTextSelection(position);
    t.editor.commands.setFindQuery('the');
    const summary = getFindSummary(t.editor.state);
    expect(summary.total).toBe(7);
    expect(summary.position).toBe(4);
  });

  it('steps forwards and backwards and wraps around', () => {
    const t = setup(SAMPLE);
    t.editor.commands.setTextSelection(1);
    t.editor.commands.setFindQuery('the');
    const position = (): number => getFindSummary(t.editor.state).position;
    t.editor.commands.findNext();
    expect(position()).toBe(2);
    t.editor.commands.findPrevious();
    t.editor.commands.findPrevious();
    expect(position()).toBe(7);
    t.editor.commands.findNext();
    expect(position()).toBe(1);
    expect(decorated(t).current).toHaveLength(1);
  });

  it('respects case sensitivity and reports no results', () => {
    const t = setup(SAMPLE);
    t.editor.commands.setFindQuery('The', { caseSensitive: true });
    expect(getFindSummary(t.editor.state).total).toBe(2);
    t.editor.commands.setFindQuery('zebra');
    expect(getFindSummary(t.editor.state)).toEqual({ query: 'zebra', total: 0, position: 0 });
    expect(decorated(t).all).toEqual([]);
    // Stepping with nothing to step through is harmless.
    expect(t.editor.commands.findNext()).toBe(true);
  });

  it('clears every highlight', () => {
    const t = setup(SAMPLE);
    t.editor.commands.setFindQuery('the');
    t.editor.commands.clearFind();
    expect(decorated(t).all).toEqual([]);
    expect(getFindSummary(t.editor.state)).toEqual({ query: '', total: 0, position: 0 });
  });

  it('works for a reader: find and step, but no replace', () => {
    const t = setup(SAMPLE, false);
    const before = JSON.stringify(t.json());
    expect(t.editor.isEditable).toBe(false);
    t.editor.commands.setFindQuery('the');
    t.editor.commands.findNext();
    expect(getFindSummary(t.editor.state).total).toBe(7);
    expect(decorated(t).all).toHaveLength(7);
    expect(t.editor.commands.replaceCurrentMatch('X')).toBe(false);
    expect(t.editor.commands.replaceAllMatches('X')).toBe(false);
    expect(JSON.stringify(t.json())).toBe(before);
  });

  it('keeps highlights in place while typing and recomputes them after the debounce', async () => {
    const t = setup(doc(paragraph(text('cat and cat'))));
    t.editor.commands.setFindQuery('cat');
    expect(getFindSummary(t.editor.state).total).toBe(2);

    // Typing a new match: the existing highlights move with the text at once …
    t.editor.commands.insertContentAt(1, 'cat ');
    expect(decorated(t).all).toEqual(['cat', 'cat']);
    expect(findPluginKey.getState(t.editor.state)?.matches).toHaveLength(2);
    // … and the full list is rebuilt shortly after typing stops.
    await settle(FIND_DEBOUNCE_MS + 80);
    expect(getFindSummary(t.editor.state).total).toBe(3);
    expect(decorated(t).all).toEqual(['cat', 'cat', 'cat']);
  });
});

describe('replace', () => {
  it('replaces the current match and moves on to the next one', () => {
    const t = setup(doc(paragraph(text('one two one two one'))));
    t.editor.commands.setTextSelection(1);
    t.editor.commands.setFindQuery('one');
    expect(t.editor.commands.replaceCurrentMatch('1')).toBe(true);
    expect(outline(t.editor)).toEqual(['p:1 two one two one']);
    expect(getFindSummary(t.editor.state)).toEqual({ query: 'one', total: 2, position: 1 });
    t.editor.commands.findNext();
    t.editor.commands.replaceCurrentMatch('1');
    expect(outline(t.editor)).toEqual(['p:1 two one two 1']);
    expect(getFindSummary(t.editor.state).total).toBe(1);
  });

  it('keeps the formatting of the replaced text', () => {
    const t = setup(
      doc(paragraph(text('a '), { ...text('bold'), marks: [{ type: 'bold' }] }, text(' word'))),
    );
    t.editor.commands.setFindQuery('bold');
    t.editor.commands.replaceCurrentMatch('strong');
    const html = t.editor.getHTML();
    expect(html).toContain('<strong>strong</strong>');
  });

  it('replaces every match in one step that one undo takes back', async () => {
    const t = setup(SAMPLE);
    const before = JSON.stringify(t.json());
    t.editor.commands.setFindQuery('the');
    expect(t.editor.commands.replaceAllMatches('A')).toBe(true);
    const after = JSON.stringify(t.json());
    expect(after).not.toMatch(/\bthe\b/i);
    expect(t.editor.state.doc.textContent).toContain('A plan');
    expect(t.editor.state.doc.textContent).toContain('const Ame = "A";');
    expect(getFindSummary(t.editor.state).total).toBe(0);

    expect(t.editor.commands.undo()).toBe(true);
    expect(JSON.stringify(t.json())).toBe(before);
    // The query is still active and finds the restored text again.
    await settle(FIND_DEBOUNCE_MS + 80);
    expect(getFindSummary(t.editor.state).total).toBe(7);
  });

  it('can delete matches by replacing them with nothing', () => {
    const t = setup(doc(paragraph(text('a--b--c'))));
    t.editor.commands.setFindQuery('--');
    t.editor.commands.replaceAllMatches('');
    expect(outline(t.editor)).toEqual(['p:abc']);
  });

  it('inserts the replacement as plain text, never as markup', () => {
    const t = setup(doc(paragraph(text('swap me'))));
    t.editor.commands.setFindQuery('me');
    t.editor.commands.replaceAllMatches('<img src=x onerror=alert(1)>');
    expect(t.editor.state.doc.textContent).toBe('swap <img src=x onerror=alert(1)>');
    expect(t.editor.view.dom.querySelector('img')).toBeNull();
  });

  it('does not find its own replacement again when it contains the query', () => {
    const t = setup(doc(paragraph(text('cat cat'))));
    t.editor.commands.setFindQuery('cat');
    t.editor.commands.replaceAllMatches('catalog');
    expect(outline(t.editor)).toEqual(['p:catalog catalog']);
  });

  it('does nothing without a match', () => {
    const t = setup(doc(paragraph(text('nothing to see'))));
    t.editor.commands.setFindQuery('zebra');
    expect(t.editor.commands.replaceCurrentMatch('x')).toBe(false);
    expect(t.editor.commands.replaceAllMatches('x')).toBe(false);
    expect(outline(t.editor)).toEqual(['p:nothing to see']);
  });
});
