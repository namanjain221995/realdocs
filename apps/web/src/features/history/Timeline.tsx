/**
 * The timeline: days, runs of one editor's changes, and administrative events.
 *
 * It is a list of buttons. Up and Down move between rows, Enter or Space opens
 * one, and only one row is in the tab order so a long history is one Tab stop.
 */
import type { HistoryEntry } from '@realtimedocs/contracts';
import { Badge, type Tone } from '@realtimedocs/ui';
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';
import {
  eventLabel,
  formatClock,
  formatIsoMs,
  groupLabel,
  operationLabel,
  pasteBasis,
  roleLabel,
  summaryText,
  type TimelineBlock,
  type TimelineDay,
  visibleRevisions,
} from './model';

function roleTone(role: string | null): Tone {
  if (role === 'admin') return 'accent';
  if (role === 'interviewer') return 'info';
  if (role === 'candidate') return 'success';
  return 'neutral';
}

function EntryRow({
  entry,
  selected,
  tabStop,
  onSelect,
  onFocusRow,
}: {
  entry: HistoryEntry;
  selected: boolean;
  tabStop: boolean;
  onSelect: (revision: number) => void;
  onFocusRow: (revision: number) => void;
}) {
  const summary = summaryText(entry);
  const basis = pasteBasis(entry);
  const baseline = entry.operation === 'baseline';
  return (
    <li className="hist-item">
      <button
        type="button"
        className="hist-row"
        data-history-row=""
        data-revision={entry.revision}
        data-operation={entry.operation}
        aria-current={selected ? 'true' : undefined}
        tabIndex={tabStop ? 0 : -1}
        title={`Revision ${entry.revision}, ${formatIsoMs(entry.committedAt)}`}
        onClick={() => onSelect(entry.revision)}
        onFocus={() => onFocusRow(entry.revision)}
        data-testid="history-row"
      >
        <time className="hist-row__time app-tabular" dateTime={entry.committedAt}>
          {formatClock(entry.committedAt)}
        </time>
        <span className="hist-row__main">
          <span className="hist-row__op">{operationLabel(entry.operation)}</span>
          {summary ? <span className="hist-row__summary">{summary}</span> : null}
          {basis ? (
            <span className="hist-row__basis" data-testid="paste-basis">
              {basis}
            </span>
          ) : null}
          {baseline ? null : (
            <span className="hist-row__who">
              <span className="hist-row__name">{entry.actor.name}</span>
              <Badge tone={roleTone(entry.actor.role)}>{roleLabel(entry.actor)}</Badge>
            </span>
          )}
        </span>
        <span className="hist-row__rev app-tabular" aria-hidden="true">
          #{entry.revision}
        </span>
      </button>
    </li>
  );
}

function EditorGroup({
  block,
  selected,
  tabStop,
  onSelect,
  onFocusRow,
}: {
  block: Extract<TimelineBlock, { type: 'editor' }>;
  selected: number | null;
  tabStop: number | null;
  onSelect: (revision: number) => void;
  onFocusRow: (revision: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const rows = (
    <ul className="hist-rows">
      {block.entries.map((entry) => (
        <EntryRow
          key={entry.revision}
          entry={entry}
          selected={selected === entry.revision}
          tabStop={tabStop === entry.revision}
          onSelect={onSelect}
          onFocusRow={onFocusRow}
        />
      ))}
    </ul>
  );
  if (block.entries.length === 1) return <li className="hist-block">{rows}</li>;
  const label = groupLabel(block);
  return (
    <li className="hist-block hist-block--group" data-testid="history-group">
      <button
        type="button"
        className="hist-group__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid="history-group-toggle"
      >
        {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        <span>{label}</span>
      </button>
      {open ? rows : null}
    </li>
  );
}

export interface TimelineProps {
  days: readonly TimelineDay[];
  selected: number | null;
  onSelect: (revision: number) => void;
}

export function Timeline({ days, selected, onSelect }: TimelineProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const visible = visibleRevisions(days);
  const candidate = focused ?? selected;
  const tabStop =
    candidate !== null && visible.includes(candidate) ? candidate : (visible[0] ?? null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const target = event.target as HTMLElement;
    if (!target.hasAttribute('data-history-row')) return;
    const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-history-row]') ?? [])];
    const at = rows.indexOf(target);
    if (at < 0) return;
    event.preventDefault();
    const next =
      event.key === 'ArrowDown'
        ? rows[Math.min(rows.length - 1, at + 1)]
        : event.key === 'ArrowUp'
          ? rows[Math.max(0, at - 1)]
          : event.key === 'Home'
            ? rows[0]
            : rows[rows.length - 1];
    next?.focus();
  };

  return (
    <div ref={rootRef} className="hist-timeline" onKeyDown={onKeyDown}>
      {days.map((day) => (
        <section key={day.key} className="hist-day" aria-labelledby={`hist-day-${day.key}`}>
          <h3 className="hist-day__title" id={`hist-day-${day.key}`}>
            {day.label}
          </h3>
          <ul className="hist-blocks">
            {day.blocks.map((block) =>
              block.type === 'event' ? (
                <li key={block.key} className="hist-block hist-event" data-testid="history-event">
                  <ScrollText aria-hidden="true" />
                  <span className="hist-event__text">
                    <span className="hist-event__label">{eventLabel(block.event.action)}</span>
                    {block.event.actorName ? <span> by {block.event.actorName}</span> : null}
                  </span>
                  <time
                    className="hist-event__time app-tabular"
                    dateTime={block.event.at}
                    title={formatIsoMs(block.event.at)}
                  >
                    {formatClock(block.event.at)}
                  </time>
                </li>
              ) : (
                <EditorGroup
                  key={block.key}
                  block={block}
                  selected={selected}
                  tabStop={tabStop}
                  onSelect={onSelect}
                  onFocusRow={setFocused}
                />
              ),
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
