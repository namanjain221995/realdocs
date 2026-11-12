/** Single-range `Range: bytes=…` parsing (RFC 9110 §14). Multi-range requests are served whole. */

export type RangeResult =
  { kind: 'full' } | { kind: 'partial'; start: number; end: number } | { kind: 'unsatisfiable' };

export function parseRange(header: string | undefined, size: number): RangeResult {
  if (header === undefined) return { kind: 'full' };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  // Unknown unit, several ranges or garbage: ignore the header and send the whole file.
  if (!match) return { kind: 'full' };
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return { kind: 'full' };
  if (first === '') {
    const suffix = Number(last);
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || size === 0)
      return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (!Number.isSafeInteger(start) || start >= size) return { kind: 'unsatisfiable' };
  if (last === '') return { kind: 'partial', start, end: size - 1 };
  const end = Number(last);
  if (!Number.isSafeInteger(end) || end < start) return { kind: 'full' };
  return { kind: 'partial', start, end: Math.min(end, size - 1) };
}
