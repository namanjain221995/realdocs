/**
 * Content sniffing. The declared content type and the file extension are not
 * trusted: what a file is, is decided from its bytes.
 */
import type { AttachmentExtension } from '@realtimedocs/contracts';

export type RasterMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface RasterType {
  mime: RasterMime;
  extension: 'png' | 'jpg' | 'gif' | 'webp';
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Recognises PNG, JPEG, GIF and WebP by their magic bytes. */
export function sniffRaster(head: Uint8Array): RasterType | null {
  if (startsWith(head, PNG) && startsWith(head, ascii('IHDR'), 12)) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', extension: 'jpg' };
  if (startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a'))) {
    return { mime: 'image/gif', extension: 'gif' };
  }
  if (startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8)) {
    return { mime: 'image/webp', extension: 'webp' };
  }
  return null;
}

/**
 * True when the text starts like an SVG document: optional byte-order mark,
 * XML declaration, comments and DOCTYPE, then the `<svg` root element.
 * (Whether the SVG is acceptable is decided by the validator, not here.)
 */
export function looksLikeSvg(head: Uint8Array): boolean {
  let text = Buffer.from(head.buffer, head.byteOffset, Math.min(head.byteLength, 8192)).toString(
    'utf8',
  );
  // Byte-order mark, written as a number so no invisible character appears in this file.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>/]/i.test(
    text,
  );
}

export function isPdf(head: Uint8Array): boolean {
  // The header must appear within the first 1024 bytes; in practice it is at offset 0.
  const limit = Math.min(head.length, 1024) - 5;
  const signature = ascii('%PDF-');
  for (let offset = 0; offset <= limit; offset += 1) {
    if (startsWith(head, signature, offset)) return true;
  }
  return false;
}

/** Local file header, empty archive or spanned archive marker of a ZIP container. */
export function isZip(head: Uint8Array): boolean {
  return (
    startsWith(head, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(head, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(head, [0x50, 0x4b, 0x07, 0x08])
  );
}

export function isRtf(head: Uint8Array): boolean {
  return startsWith(head, ascii('{\\rtf'));
}

/** Text formats must not contain NUL bytes (a cheap "this is binary" test). */
export function looksLikeText(head: Uint8Array): boolean {
  return !head.includes(0);
}

const ZIP_CONTAINERS: ReadonlySet<string> = new Set([
  'zip',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
]);
const TEXT_FORMATS: ReadonlySet<string> = new Set(['txt', 'md', 'csv', 'tsv', 'json', 'log']);

/** Does the content plausibly match an allowed attachment extension? */
export function attachmentContentMatches(
  extension: AttachmentExtension,
  head: Uint8Array,
): boolean {
  if (extension === 'pdf') return isPdf(head);
  if (extension === 'rtf') return isRtf(head);
  if (ZIP_CONTAINERS.has(extension)) return isZip(head);
  if (TEXT_FORMATS.has(extension)) return looksLikeText(head);
  return false;
}
