/**
 * Inline notices of the editor: the paste report (what was simplified or
 * dropped) and short messages such as rejected files. They live inside the
 * editor, are announced politely and never take focus.
 */
import { IconButton } from '@realtimedocs/ui';
import { ClipboardList, Info, X } from 'lucide-react';
import { useEffect } from 'react';
import type { PasteReport } from '../clipboard/report';

/** A paste report disappears on its own after this long. */
export const PASTE_REPORT_VISIBLE_MS = 15_000;

export interface PasteReportNoticeProps {
  report: PasteReport;
  onDismiss: () => void;
}

export function PasteReportNotice({ report, onDismiss }: PasteReportNoticeProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, PASTE_REPORT_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [report, onDismiss]);

  return (
    <div className="rd-notice" role="status" aria-live="polite" data-testid="rd-paste-report">
      <ClipboardList className="rd-notice__icon" size={16} aria-hidden="true" />
      <div className="rd-notice__body">
        <strong className="rd-notice__title">Pasted from {report.sourceLabel} with changes</strong>
        <ul className="rd-notice__list">
          {report.notes.map((note) => (
            <li key={note.kind} data-note={note.kind}>
              {note.message}
            </li>
          ))}
        </ul>
      </div>
      <IconButton size="sm" label="Dismiss" icon={<X size={14} />} onClick={onDismiss} />
    </div>
  );
}

export interface MessageNoticeProps {
  messages: string[];
  onDismiss: () => void;
}

export function MessageNotice({ messages, onDismiss }: MessageNoticeProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, PASTE_REPORT_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [messages, onDismiss]);

  return (
    <div className="rd-notice" role="status" aria-live="polite" data-testid="rd-editor-notice">
      <Info className="rd-notice__icon" size={16} aria-hidden="true" />
      <div className="rd-notice__body">
        <ul className="rd-notice__list">
          {messages.map((message, index) => (
            <li key={`${index}-${message}`}>{message}</li>
          ))}
        </ul>
      </div>
      <IconButton size="sm" label="Dismiss" icon={<X size={14} />} onClick={onDismiss} />
    </div>
  );
}
