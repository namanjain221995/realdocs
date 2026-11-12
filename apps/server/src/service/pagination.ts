/** Opaque cursors for keyset pagination over `(timestamp, id)`, newest first. */
import { isUuid } from '@realtimedocs/contracts';
import { errors } from '../errors';

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify([at.toISOString(), id]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === 'string' &&
      !Number.isNaN(Date.parse(parsed[0])) &&
      isUuid(parsed[1])
    ) {
      return { at: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through
  }
  throw errors.validation('Some fields are not valid.', [
    { path: 'cursor', message: 'The cursor is not valid. Start again without it.' },
  ]);
}
