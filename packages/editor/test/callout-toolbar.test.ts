// @vitest-environment jsdom
/**
 * Callout toolbar commands and state, against a real collaborative editor.
 * The menu itself (DOM menu, keyboard, viewers) is covered by the browser check
 * `callout-toolbar`.
 */
import type { JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CALLOUT_LABELS,
  insertCallout,
  removeCallout,
  setCalloutVariant,
} from '../src/react/calloutCommands';
import { readToolbarState } from '../src/react/toolbarState';
import { CALLOUT_VARIANTS } from '../src/schema';
import { createTestEditor, settle, type TestEditor } from './editor-helpers';

let current: TestEditor | null = null;

afterEach(() => {
  current?.destroy();
  current = null;
});

const para = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

function open(content: JSONContent): TestEditor {
  current = createTestEditor({ content });
  return current;
}

/** Cursor inside the first text of the block that starts at document position `pos`. */
function cursorIn(t: TestEditor, pos: number): void {
  t.editor.commands.setTextSelection(pos + 1);
}

/** A compact description of the document: `callout[variant](p:text,...)` and `p:text`. */
function shape(t: TestEditor): string[] {
  const lines: string[] = [];
  t.editor.state.doc.forEach((node) => {
    if (node.type.name === 'callout') {
      const inner: string[] = [];
      node.forEach((child) => inner.push(`${child.type.name}:${child.textContent}`));
      lines.push(`callout[${String(node.attrs.variant)}](${inner.join(',')})`);
    } else lines.push(`${node.type.name}:${node.textContent}`);
  });
  return lines;
}

describe('callout toolbar state', () => {
  it('reports no callout and a possible wrap in a plain paragraph', () => {
    const t = open(doc(para('one')));
    cursorIn(t, 0);
    const state = readToolbarState(t.editor);
    expect(state.callout).toBe('');
    expect(state.canCallout).toBe(true);
  });

  it('reports the variant of the callout around the cursor, and no second wrap', () => {
    const t = open(doc({ type: 'callout', attrs: { variant: 'warning' }, content: [para('w')] }));
    t.editor.commands.setTextSelection(2);
    const state = readToolbarState(t.editor);
    expect(state.callout).toBe('warning');
    expect(state.canCallout).toBe(false);
  });

  it('treats a variant written by another client as info', () => {
    const t = open(
      doc({ type: 'callout', attrs: { variant: 'x;position:fixed' }, content: [para('h')] }),
    );
    t.editor.commands.setTextSelection(2);
    expect(readToolbarState(t.editor).callout).toBe('info');
  });

  it('has a short label for every variant', () => {
    for (const variant of CALLOUT_VARIANTS) {
      expect(CALLOUT_LABELS[variant].length).toBeGreaterThan(0);
      expect(CALLOUT_LABELS[variant].length).toBeLessThanOrEqual(8);
    }
  });
});

describe('callout commands', () => {
  it('wraps the current block and leaves the others alone', () => {
    const t = open(doc(para('one'), para('two')));
    cursorIn(t, 0);
    expect(insertCallout(t.editor, 'tip')).toBe(true);
    expect(shape(t)).toEqual(['callout[tip](paragraph:one)', 'paragraph:two']);
  });

  it('wraps every block of a selection', () => {
    const t = open(doc(para('one'), para('two'), para('three')));
    t.editor.commands.setTextSelection({ from: 2, to: 7 });
    expect(insertCallout(t.editor, 'danger')).toBe(true);
    expect(shape(t)).toEqual(['callout[danger](paragraph:one,paragraph:two)', 'paragraph:three']);
  });

  it('wraps a heading and a list', () => {
    const t = open(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [para('item')] }] },
      ),
    );
    t.editor.commands.selectAll();
    expect(insertCallout(t.editor, 'info')).toBe(true);
    expect(shape(t)).toEqual(['callout[info](heading:H,bulletList:item)']);
  });

  it('refuses content a callout cannot hold, and changes nothing', () => {
    const t = open(
      doc({
        type: 'table',
        content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para('cell')] }] }],
      }),
    );
    t.editor.commands.selectAll();
    expect(insertCallout(t.editor, 'info')).toBe(false);
    expect(shape(t)).toEqual(['table:cell']);
  });

  it('changes the variant in place, keeping the content', () => {
    const t = open(
      doc({ type: 'callout', attrs: { variant: 'info' }, content: [para('a'), para('b')] }),
    );
    t.editor.commands.setTextSelection(2);
    expect(setCalloutVariant(t.editor, 'success')).toBe(true);
    expect(shape(t)).toEqual(['callout[success](paragraph:a,paragraph:b)']);
    expect(readToolbarState(t.editor).callout).toBe('success');
  });

  it('removes the callout and keeps its blocks', () => {
    const t = open(
      doc(para('before'), {
        type: 'callout',
        attrs: { variant: 'tip' },
        content: [para('a'), para('b')],
      }),
    );
    t.editor.commands.setTextSelection(t.editor.state.doc.content.size - 2);
    expect(removeCallout(t.editor)).toBe(true);
    expect(shape(t)).toEqual(['paragraph:before', 'paragraph:a', 'paragraph:b']);
    expect(removeCallout(t.editor)).toBe(false);
  });

  it('removes the right callout when the cursor is in a list inside it', () => {
    const t = open(
      doc({
        type: 'callout',
        attrs: { variant: 'warning' },
        content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [para('x')] }] }],
      }),
    );
    t.editor.commands.setTextSelection(4);
    expect(removeCallout(t.editor)).toBe(true);
    expect(shape(t)).toEqual(['bulletList:x']);
  });

  it('is undone and redone as one step each (collaboration-aware history)', async () => {
    const t = open(doc(para('one')));
    cursorIn(t, 0);
    insertCallout(t.editor, 'tip');
    expect(shape(t)).toEqual(['callout[tip](paragraph:one)']);
    expect(t.editor.commands.undo()).toBe(true);
    expect(shape(t)).toEqual(['paragraph:one']);
    expect(t.editor.commands.redo()).toBe(true);
    expect(shape(t)).toEqual(['callout[tip](paragraph:one)']);

    // A later, separate step: the variant change, then the removal, each undone alone.
    await settle(600);
    t.editor.commands.setTextSelection(2);
    setCalloutVariant(t.editor, 'danger');
    await settle(600);
    removeCallout(t.editor);
    expect(shape(t)).toEqual(['paragraph:one']);
    expect(t.editor.commands.undo()).toBe(true);
    expect(shape(t)).toEqual(['callout[danger](paragraph:one)']);
    expect(t.editor.commands.undo()).toBe(true);
    expect(shape(t)).toEqual(['callout[tip](paragraph:one)']);
  });

  it('does nothing in a read-only editor', () => {
    const t = createTestEditor({ content: doc(para('one')), canEdit: false });
    current = t;
    cursorIn(t, 0);
    insertCallout(t.editor, 'info');
    expect(shape(t)).toEqual(['paragraph:one']);
  });
});
