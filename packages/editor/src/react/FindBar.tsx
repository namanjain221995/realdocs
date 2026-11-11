/**
 * Find bar. Viewers get find; editors also get replace. The query lives in
 * this component; matches are editor decorations (see editor/findReplace.ts).
 */
import { Button, IconButton, TextField } from '@realtimedocs/ui';
import type { Editor } from '@tiptap/core';
import { CaseSensitive, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getFindSummary, type FindSummary } from '../editor/findReplace';

export interface FindBarProps {
  editor: Editor;
  /** Replace controls are only offered when the session may edit. */
  canReplace: boolean;
  compact?: boolean;
  onClose: () => void;
}

function scrollCurrentIntoView(editor: Editor): void {
  // Scrolls the reader to the match without moving focus or the selection.
  requestAnimationFrame(() => {
    if (editor.isDestroyed) return;
    const current = editor.view.dom.querySelector('.rd-find-match--current');
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    current?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  });
}

export function FindBar({ editor, canReplace, compact = false, onClose }: FindBarProps) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [summary, setSummary] = useState<FindSummary>(() => getFindSummary(editor.state));
  const input = useRef<HTMLInputElement>(null);

  // Prefill with the selected text, like every desktop editor.
  useEffect(() => {
    const { from, to, empty } = editor.state.selection;
    const selected = empty ? '' : editor.state.doc.textBetween(from, to, ' ').slice(0, 200);
    if (selected && !selected.includes('\n')) setQuery(selected);
    input.current?.focus();
    input.current?.select();
  }, [editor]);

  useEffect(() => {
    editor.commands.setFindQuery(query, { caseSensitive });
    scrollCurrentIntoView(editor);
  }, [editor, query, caseSensitive]);

  useEffect(() => {
    let frame: number | null = null;
    const sync = (): void => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (editor.isDestroyed) return;
        const next = getFindSummary(editor.state);
        setSummary((previous) =>
          previous.total === next.total &&
          previous.position === next.position &&
          previous.query === next.query
            ? previous
            : next,
        );
      });
    };
    editor.on('transaction', sync);
    return () => {
      editor.off('transaction', sync);
      if (frame !== null) cancelAnimationFrame(frame);
      if (!editor.isDestroyed) editor.commands.clearFind();
    };
  }, [editor]);

  const step = (direction: 1 | -1): void => {
    if (direction === 1) editor.commands.findNext();
    else editor.commands.findPrevious();
    scrollCurrentIntoView(editor);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (
      event.key === 'Enter' &&
      (event.target as HTMLElement).dataset.findInput !== undefined
    ) {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    }
  };

  const count =
    query === ''
      ? ''
      : summary.total === 0
        ? 'No results'
        : `${summary.position} of ${summary.total}`;

  return (
    <div
      className="rd-find"
      role="search"
      aria-label="Find in document"
      data-compact={compact ? '' : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="rd-find__row">
        <TextField
          ref={input}
          size="sm"
          label="Find"
          hideLabel
          placeholder="Find in document"
          className="rd-find__field"
          value={query}
          data-testid="rd-find-input"
          data-find-input=""
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="rd-find__count" role="status" data-testid="rd-find-count">
          {count}
        </span>
        <IconButton
          size="sm"
          label="Match case"
          icon={<CaseSensitive size={16} />}
          pressed={caseSensitive}
          onClick={() => setCaseSensitive((value) => !value)}
        />
        <IconButton
          size="sm"
          label="Previous match"
          icon={<ChevronUp size={16} />}
          disabled={summary.total === 0}
          onClick={() => step(-1)}
          data-testid="rd-find-prev"
        />
        <IconButton
          size="sm"
          label="Next match"
          icon={<ChevronDown size={16} />}
          disabled={summary.total === 0}
          onClick={() => step(1)}
          data-testid="rd-find-next"
        />
        <IconButton size="sm" label="Close find" icon={<X size={16} />} onClick={onClose} />
      </div>
      {canReplace ? (
        <div className="rd-find__row">
          <TextField
            size="sm"
            label="Replace with"
            hideLabel
            placeholder="Replace with"
            className="rd-find__field"
            value={replacement}
            data-testid="rd-replace-input"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setReplacement(event.target.value)}
          />
          <Button
            size="sm"
            disabled={summary.total === 0}
            data-testid="rd-replace-one"
            onClick={() => {
              editor.commands.replaceCurrentMatch(replacement);
              scrollCurrentIntoView(editor);
            }}
          >
            Replace
          </Button>
          <Button
            size="sm"
            disabled={summary.total === 0}
            data-testid="rd-replace-all"
            onClick={() => editor.commands.replaceAllMatches(replacement)}
          >
            Replace all
          </Button>
        </div>
      ) : null}
    </div>
  );
}
