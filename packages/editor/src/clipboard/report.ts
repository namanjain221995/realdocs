/**
 * Paste report: what the clipboard pipeline simplified or dropped, in words a
 * user can act on. Shown instead of silently losing content.
 */

export type PasteSource =
  | 'google-docs'
  | 'google-sheets'
  | 'word'
  | 'excel'
  | 'code-editor'
  | 'realtimedocs'
  | 'web'
  | 'files'
  | 'plain-text';

export type PasteNoteKind =
  | 'fonts'
  | 'remote-images'
  | 'unreadable-images'
  | 'rejected-images'
  | 'embedded-objects'
  | 'active-content'
  | 'forms'
  | 'comments'
  | 'tracked-changes'
  | 'unsafe-links'
  | 'layout'
  | 'cell-styles'
  | 'formulas'
  | 'code-colors'
  | 'foreign-assets'
  | 'unsupported-files'
  | 'too-large'
  | 'text-too-large'
  | 'no-sanitizer';

export interface PasteNote {
  kind: PasteNoteKind;
  count: number;
  message: string;
}

export interface PasteReport {
  source: PasteSource;
  /** Human-readable name of the source, for the notice title. */
  sourceLabel: string;
  notes: PasteNote[];
  /** Images taken from the clipboard that are being uploaded. */
  uploads: number;
}

export const SOURCE_LABELS: Record<PasteSource, string> = {
  'google-docs': 'Google Docs',
  'google-sheets': 'Google Sheets',
  word: 'Microsoft Word',
  excel: 'Microsoft Excel',
  'code-editor': 'a code editor',
  realtimedocs: 'RealtimeDocs',
  web: 'a web page',
  files: 'files',
  'plain-text': 'plain text',
};

const plural = (count: number, one: string, many: string): string =>
  count === 1 ? one : many.replace('{n}', String(count));

const MESSAGES: Record<PasteNoteKind, (count: number) => string> = {
  fonts: () => 'Fonts were replaced with the document font.',
  'remote-images': (n) =>
    plural(
      n,
      'An image hosted on another site was not downloaded; it was kept as a link.',
      '{n} images hosted on other sites were not downloaded; they were kept as links.',
    ),
  'unreadable-images': (n) =>
    plural(
      n,
      'An image could not be read from the clipboard. Paste or upload it separately.',
      '{n} images could not be read from the clipboard. Paste or upload them separately.',
    ),
  'rejected-images': (n) =>
    plural(
      n,
      'An embedded image was not accepted (type or size).',
      '{n} embedded images were not accepted (type or size).',
    ),
  'embedded-objects': (n) =>
    plural(
      n,
      'An embedded object (frame, media or drawing) was removed.',
      '{n} embedded objects (frames, media or drawings) were removed.',
    ),
  'active-content': () => 'Scripts and other active content were removed.',
  forms: () => 'Form controls were removed.',
  comments: () => 'Comments were not imported.',
  'tracked-changes': () => 'Tracked changes were not imported; deleted text was left out.',
  'unsafe-links': (n) =>
    plural(
      n,
      'A link with an unsupported address was turned into plain text.',
      '{n} links with unsupported addresses were turned into plain text.',
    ),
  layout: () => 'Page layout (breaks, columns, borders, spacing) was simplified.',
  'cell-styles': () => 'Cell colours, borders and sizes were not imported.',
  formulas: () => 'Formulas were pasted as their displayed values.',
  'code-colors': () => "Editor colours were replaced by this document's code highlighting.",
  'foreign-assets': (n) =>
    plural(
      n,
      'An image or file from another document was not copied. Upload it here instead.',
      '{n} images or files from another document were not copied. Upload them here instead.',
    ),
  'unsupported-files': (n) =>
    plural(n, 'A file type is not supported.', '{n} files have unsupported types.'),
  'too-large': () =>
    'The content was too large to import with formatting; it was pasted as plain text.',
  'text-too-large': () =>
    'The text is longer than the limit for one paste (1,000,000 characters) and was not inserted.',
  'no-sanitizer': () =>
    'Formatted paste is unavailable in this browser; the content was pasted as plain text.',
};

/** Collects counts per kind while a paste is processed. */
export class PasteNotes {
  private readonly counts = new Map<PasteNoteKind, number>();

  add(kind: PasteNoteKind, count = 1): void {
    if (count <= 0) return;
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + count);
  }

  has(kind: PasteNoteKind): boolean {
    return this.counts.has(kind);
  }

  toArray(): PasteNote[] {
    return [...this.counts.entries()].map(([kind, count]) => ({
      kind,
      count,
      message: MESSAGES[kind](count),
    }));
  }
}

export function buildReport(source: PasteSource, notes: PasteNotes, uploads = 0): PasteReport {
  return { source, sourceLabel: SOURCE_LABELS[source], notes: notes.toArray(), uploads };
}

/** A report is worth showing only when something was changed or dropped. */
export function isReportWorthShowing(report: PasteReport): boolean {
  return report.notes.length > 0;
}
