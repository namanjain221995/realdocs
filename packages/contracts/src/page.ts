/**
 * Page settings of a document: paper size, orientation, margins, display unit
 * and page colour.
 *
 * They live in the document's own Yjs document, in the top-level Y.Map named
 * `Y_PAGE_FIELD`, so every client sees them live and they travel with
 * snapshots, restores and offline merges. Every value in that map is written
 * by some client and is therefore untrusted: nothing reads the map except
 * through `normalizePageSettings`, which returns a valid object whatever the
 * map holds. This file is pure (no DOM, no Yjs) and shared by the editor, the
 * server's JSON export and the print view.
 *
 * Units: lengths are stored in millimetres, rounded to 0.1 mm. `unit` is only
 * the preferred display unit.
 */
import { z } from './zod';

export const PAGE_SIZES = ['a4', 'letter'] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const PAGE_ORIENTATIONS = ['portrait', 'landscape'] as const;
export type PageOrientation = (typeof PAGE_ORIENTATIONS)[number];

export const PAGE_UNITS = ['mm', 'in'] as const;
export type PageUnit = (typeof PAGE_UNITS)[number];

/** Named page colours. Never a raw CSS value: the stylesheet maps each name to colours. */
export const PAGE_BACKGROUNDS = ['default', 'white', 'cream', 'gray'] as const;
export type PageBackground = (typeof PAGE_BACKGROUNDS)[number];

/** Paper dimensions in millimetres, portrait. */
export const PAGE_SIZE_MM: Record<PageSize, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

export const PAGE_MARGIN_MIN_MM = 0;
export const PAGE_MARGIN_MAX_MM = 100;
export const PAGE_SPACING_MAX_MM = 50;
/** The text area is never smaller than this, in either direction. */
export const PAGE_MIN_CONTENT_MM = 50;
export const MM_PER_INCH = 25.4;
export const CSS_PX_PER_INCH = 96;

export const PageSettings = z.object({
  size: z.enum(PAGE_SIZES),
  orientation: z.enum(PAGE_ORIENTATIONS),
  marginTop: z.number(),
  marginRight: z.number(),
  marginBottom: z.number(),
  marginLeft: z.number(),
  unit: z.enum(PAGE_UNITS),
  background: z.enum(PAGE_BACKGROUNDS),
  headerSpacing: z.number(),
  footerSpacing: z.number(),
});
export type PageSettings = z.infer<typeof PageSettings>;

/**
 * Extra field of the JSON export (`GET /api/documents/:id/export?format=json`): the ProseMirror
 * document with the normalised page settings beside it. Optional so that exports from servers
 * that predate page settings, and readers that ignore it, keep working.
 */
export const ExportPageSettingsField = z.object({ pageSettings: PageSettings.optional() });
export type ExportPageSettingsField = z.infer<typeof ExportPageSettingsField>;

export const DEFAULT_PAGE_SETTINGS: Readonly<PageSettings> = Object.freeze({
  size: 'a4',
  orientation: 'portrait',
  marginTop: 25.4,
  marginRight: 25.4,
  marginBottom: 25.4,
  marginLeft: 25.4,
  unit: 'mm',
  background: 'default',
  headerSpacing: 12.7,
  footerSpacing: 12.7,
});

export const PAGE_MARGIN_KEYS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
export type PageMarginKey = (typeof PAGE_MARGIN_KEYS)[number];

const round1 = (value: number): number => Math.round(value * 10) / 10;
const floor1 = (value: number): number => Math.floor(value * 10 + 1e-9) / 10;

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** A finite number within bounds, rounded to 0.1 mm; anything else is the fallback. */
function lengthMm(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return round1(Math.min(max, Math.max(min, value)));
}

/** Shrinks two opposite margins together until at least `PAGE_MIN_CONTENT_MM` remains. */
function fitPair(a: number, b: number, total: number): [number, number] {
  const room = Math.max(0, total - PAGE_MIN_CONTENT_MM);
  const sum = a + b;
  if (sum <= room) return [a, b];
  const first = floor1((a * room) / sum);
  return [first, floor1(room - first)];
}

/** Page width and height in millimetres, orientation applied. */
export function pageDimensionsMm(settings: Pick<PageSettings, 'size' | 'orientation'>): {
  width: number;
  height: number;
} {
  const { width, height } = PAGE_SIZE_MM[settings.size];
  return settings.orientation === 'landscape'
    ? { width: height, height: width }
    : { width, height };
}

/** Width of the text area in millimetres. */
export function contentWidthMm(settings: PageSettings): number {
  return round1(pageDimensionsMm(settings).width - settings.marginLeft - settings.marginRight);
}

/** Height of the text area in millimetres. */
export function contentHeightMm(settings: PageSettings): number {
  return round1(pageDimensionsMm(settings).height - settings.marginTop - settings.marginBottom);
}

/**
 * Turns whatever the shared map holds (a plain object from `Y.Map.toJSON()`,
 * hostile JSON, `undefined`) into valid settings: unknown names fall back to
 * the default, numbers are clamped and rounded, and the text area keeps its
 * minimum size.
 */
export function normalizePageSettings(raw: unknown): PageSettings {
  const source =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const d = DEFAULT_PAGE_SETTINGS;
  const size = oneOf(PAGE_SIZES, source.size, d.size);
  const orientation = oneOf(PAGE_ORIENTATIONS, source.orientation, d.orientation);
  const margin = (key: PageMarginKey): number =>
    lengthMm(source[key], PAGE_MARGIN_MIN_MM, PAGE_MARGIN_MAX_MM, d[key]);
  const { width, height } = pageDimensionsMm({ size, orientation });
  const [marginLeft, marginRight] = fitPair(margin('marginLeft'), margin('marginRight'), width);
  const [marginTop, marginBottom] = fitPair(margin('marginTop'), margin('marginBottom'), height);
  return {
    size,
    orientation,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    unit: oneOf(PAGE_UNITS, source.unit, d.unit),
    background: oneOf(PAGE_BACKGROUNDS, source.background, d.background),
    headerSpacing: lengthMm(source.headerSpacing, 0, PAGE_SPACING_MAX_MM, d.headerSpacing),
    footerSpacing: lengthMm(source.footerSpacing, 0, PAGE_SPACING_MAX_MM, d.footerSpacing),
  };
}

export function samePageSettings(a: PageSettings, b: PageSettings): boolean {
  return (Object.keys(DEFAULT_PAGE_SETTINGS) as (keyof PageSettings)[]).every(
    (key) => a[key] === b[key],
  );
}

/** CSS pixels (96 per inch) for a length in millimetres. */
export function mmToPx(mm: number): number {
  return (mm * CSS_PX_PER_INCH) / MM_PER_INCH;
}

export function pxToMm(px: number): number {
  return (px * MM_PER_INCH) / CSS_PX_PER_INCH;
}

const INCH_STEP_MM = MM_PER_INCH / 16;

/** One keyboard / drag step: 1 mm, or 1/16 inch. */
export function snapStepMm(unit: PageUnit): number {
  return unit === 'in' ? INCH_STEP_MM : 1;
}

/** Snaps a length to the grid of `unit`: whole millimetres, or sixteenths of an inch. */
export function snapMm(value: number, unit: PageUnit): number {
  if (!Number.isFinite(value)) return 0;
  const step = snapStepMm(unit);
  return round1(Math.round(value / step) * step);
}

function trimNumber(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.?0+$/, '');
}

/** "25.4 mm" or "1 in". */
export function formatMeasurement(mm: number, unit: PageUnit): string {
  if (!Number.isFinite(mm)) return unit === 'in' ? '0 in' : '0 mm';
  return unit === 'in'
    ? `${trimNumber(mm / MM_PER_INCH, 2)} in`
    : `${trimNumber(round1(mm), 1)} mm`;
}

const MEASUREMENT_RE =
  /^\s*(\d{1,6}(?:[.,]\d{0,6})?|[.,]\d{1,6})\s*(mm|cm|in|"|″|inch|inches)?\s*$/i;

/**
 * Reads a typed length ("25.4", "2.5 cm", `1"`, "0.75in"). A bare number is in
 * `unit`. Returns millimetres rounded to 0.1, or null if the text is not a
 * non-negative length.
 */
export function parseMeasurement(text: string, unit: PageUnit): number | null {
  const match = MEASUREMENT_RE.exec(text);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const suffix = (match[2] ?? '').toLowerCase();
  const inches = suffix === '' ? unit === 'in' : suffix !== 'mm' && suffix !== 'cm';
  const mm = suffix === 'cm' ? value * 10 : inches ? value * MM_PER_INCH : value;
  return round1(mm);
}

const OPPOSITE: Record<PageMarginKey, PageMarginKey> = {
  marginTop: 'marginBottom',
  marginBottom: 'marginTop',
  marginLeft: 'marginRight',
  marginRight: 'marginLeft',
};

/** Why a margin value cannot be used, or null if it is fine (for the settings panel). */
export function marginProblem(
  settings: PageSettings,
  key: PageMarginKey,
  mm: number | null,
): string | null {
  if (mm === null) return 'Enter a length such as 25.4 mm or 1 in.';
  if (mm < PAGE_MARGIN_MIN_MM) return 'The margin cannot be negative.';
  if (mm > PAGE_MARGIN_MAX_MM) return `The margin cannot be more than ${PAGE_MARGIN_MAX_MM} mm.`;
  const { width, height } = pageDimensionsMm(settings);
  const horizontal = key === 'marginLeft' || key === 'marginRight';
  const other = settings[OPPOSITE[key]];
  if (mm + other > (horizontal ? width : height) - PAGE_MIN_CONTENT_MM) {
    return `The text area must stay at least ${PAGE_MIN_CONTENT_MM} mm ${horizontal ? 'wide' : 'high'}.`;
  }
  return null;
}

/** Largest value `key` can take given its opposite margin, for the ruler's slider range. */
export function maxMarginMm(settings: PageSettings, key: PageMarginKey): number {
  const { width, height } = pageDimensionsMm(settings);
  const horizontal = key === 'marginLeft' || key === 'marginRight';
  const room = (horizontal ? width : height) - PAGE_MIN_CONTENT_MM - settings[OPPOSITE[key]];
  return Math.max(PAGE_MARGIN_MIN_MM, Math.min(PAGE_MARGIN_MAX_MM, floor1(room)));
}

// ── Paragraph indents (ruler) ───────────────────────────────────────────────

/**
 * Indents of one paragraph or heading, in millimetres from the text area's edges. They are node
 * attributes of the document schema (`indentLeft`, `indentRight`, `indentFirstLine`), written by
 * any client and therefore untrusted: read them through `normalizeParagraphIndents`.
 *
 * `firstLine` is relative to `left`; a negative value is a hanging indent. The first line never
 * starts left of the text area (`firstLine >= -left`).
 */
export interface ParagraphIndents {
  left: number;
  right: number;
  firstLine: number;
}

/** Largest stored indent, whatever the page. The page in use limits it further. */
export const PARAGRAPH_INDENT_MAX_MM = 200;
/** A paragraph keeps at least this much width for its text. */
export const PARAGRAPH_MIN_TEXT_MM = 25;

export const NO_PARAGRAPH_INDENTS: Readonly<ParagraphIndents> = Object.freeze({
  left: 0,
  right: 0,
  firstLine: 0,
});

/** A stored indent as a number of millimetres (0.1 mm steps) within `[min, max]`; else 0. */
export function paragraphIndentMm(value: unknown, min: number, max: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?\d{1,4}(\.\d{1,3})?$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return 0;
  const clamped = round1(Math.min(max, Math.max(min, parsed)));
  // Never "-0": the value is written into markup.
  return clamped === 0 ? 0 : clamped;
}

/**
 * Valid indents from whatever a node holds. With `contentWidthMm` (the text area of the page in
 * use) the three values are also limited so that `PARAGRAPH_MIN_TEXT_MM` of text width remains:
 * the right indent gives way first, then the first-line indent, then the left indent.
 */
export function normalizeParagraphIndents(
  raw: { left?: unknown; right?: unknown; firstLine?: unknown },
  contentWidthMm?: number,
): ParagraphIndents {
  let left = paragraphIndentMm(raw.left, 0, PARAGRAPH_INDENT_MAX_MM);
  let right = paragraphIndentMm(raw.right, 0, PARAGRAPH_INDENT_MAX_MM);
  let firstLine = paragraphIndentMm(
    raw.firstLine,
    -PARAGRAPH_INDENT_MAX_MM,
    PARAGRAPH_INDENT_MAX_MM,
  );
  if (contentWidthMm !== undefined && Number.isFinite(contentWidthMm)) {
    const room = Math.max(0, floor1(contentWidthMm - PARAGRAPH_MIN_TEXT_MM));
    left = Math.min(left, room);
    firstLine = Math.min(firstLine, floor1(room - left));
    right = Math.min(right, Math.max(0, floor1(room - left - Math.max(0, firstLine))));
  }
  if (firstLine < -left) firstLine = -left;
  return {
    left: left === 0 ? 0 : left,
    right: right === 0 ? 0 : right,
    firstLine: firstLine === 0 ? 0 : firstLine,
  };
}

export function sameParagraphIndents(a: ParagraphIndents, b: ParagraphIndents): boolean {
  return a.left === b.left && a.right === b.right && a.firstLine === b.firstLine;
}

/** CSS `@page` size keyword for the settings, e.g. `A4 landscape`. */
export function cssPageSize(settings: Pick<PageSettings, 'size' | 'orientation'>): string {
  return `${settings.size === 'a4' ? 'A4' : 'letter'} ${settings.orientation}`;
}

/**
 * The text of an `@page` rule for these settings. Contains only keywords and
 * numbers produced here, never a stored string.
 */
export function pageRuleCss(settings: PageSettings): string {
  const m = (value: number): string => `${trimNumber(value, 1)}mm`;
  return `@page { size: ${cssPageSize(settings)}; margin: ${m(settings.marginTop)} ${m(settings.marginRight)} ${m(settings.marginBottom)} ${m(settings.marginLeft)}; }`;
}
