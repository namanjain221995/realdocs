/**
 * Safe readers for node attributes.
 *
 * Attribute values come from the shared document, and another collaborator's
 * client is not trusted: it can write any JSON value into any attribute
 * without passing this editor's paste and parse rules. Everything that turns
 * an attribute into a URL, a style or a layout decision reads it through one
 * of these functions first. Text shown as text needs no reader (React and the
 * DOM escape it); only its length is bounded.
 */
import { isUuid } from '../collab/ids';
import { IMAGE_ALIGNMENTS, LINE_HEIGHTS, MAX_INDENT } from '../schema';
import type { ImageAlignment, LineHeight } from '../schema';

/** An asset or upload id is a lower-case UUID; anything else is ignored. */
export function safeId(value: unknown): string | null {
  return isUuid(value) ? value : null;
}

/** A finite number inside `[min, max]`, rounded; null for everything else. */
export function safeInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded < min || rounded > max ? null : rounded;
}

/** Text of bounded length; non-strings become the empty string. */
export function safeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

export function safeImageAlign(value: unknown): ImageAlignment {
  return (IMAGE_ALIGNMENTS as readonly unknown[]).includes(value)
    ? (value as ImageAlignment)
    : 'center';
}

/** One of the line spacings the schema offers, or null. */
export function safeLineHeight(value: unknown): LineHeight | null {
  return (LINE_HEIGHTS as readonly unknown[]).includes(value) ? (value as LineHeight) : null;
}

/** Indentation level 0…MAX_INDENT. */
export function safeIndent(value: unknown): number {
  return safeInteger(value, 0, MAX_INDENT) ?? 0;
}

/** Column width in px as prosemirror-tables stores it, or null. */
export function safeColumnWidth(value: unknown): number | null {
  return safeInteger(value, 1, 10_000);
}
