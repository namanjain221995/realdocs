import { Button, copyText, cx } from '@realtimedocs/ui';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** A code block with a copy button. The text is rendered as text, never as HTML. */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className="dev-code">
      <div className="dev-code__bar">
        <span className="dev-code__label">{label ?? ''}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void copyText(code).then((ok) => {
              setCopied(ok);
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => setCopied(false), 1800);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="dev-code__pre" tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export interface CodeTab {
  id: string;
  label: string;
  code: string;
}

/** Plain buttons that switch between versions of the same example. */
export function CodeTabs({ tabs, label }: { tabs: readonly CodeTab[]; label: string }) {
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const base = useId();
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  if (!current) return null;
  return (
    <div className="dev-tabs">
      <div className="dev-tabs__list" role="group" aria-label={label}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            id={`${base}-${tab.id}`}
            className={cx('dev-tabs__tab', tab.id === current.id && 'dev-tabs__tab--on')}
            aria-pressed={tab.id === current.id}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <CodeBlock code={current.code} label={current.label} />
    </div>
  );
}

/** A table with a horizontal scroll container on narrow screens. */
export function DataTable({
  head,
  rows,
  caption,
}: {
  head: readonly string[];
  rows: readonly (readonly ReactNode[])[];
  caption?: string;
}) {
  return (
    <div className="dev-table" tabIndex={0} role="region" aria-label={caption ?? 'Table'}>
      <table>
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={column}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Callout({
  tone = 'note',
  title,
  children,
}: {
  tone?: 'note' | 'warning';
  title: string;
  children: ReactNode;
}) {
  return (
    <aside className={cx('dev-callout', `dev-callout--${tone}`)}>
      <strong>{title}</strong>
      <div>{children}</div>
    </aside>
  );
}

/** Text with `backtick` spans shown as code. Everything is rendered as text. */
export function InlineText({ text }: { text: string }) {
  const parts = text.split('`');
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? <code key={index}>{part}</code> : <span key={index}>{part}</span>,
      )}
    </>
  );
}
