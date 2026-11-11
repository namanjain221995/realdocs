/**
 * "Last changed" for the document lists.
 *
 * A document has two clocks: `contentUpdatedAt` moves when its text is saved,
 * `updatedAt` when its title or state changes. People think of one: when did
 * anything last happen to it. The active and recent lists are ordered by that,
 * and each row says which of the two it was.
 *
 * The server orders `recent` this way and `active` by `updatedAt` alone, so a
 * document edited a minute ago could sit below one that was renamed yesterday
 * while both rows say "Edited …". Ordering here keeps the list and its labels
 * in step whatever order the response came in. (Lists are short: the server
 * returns at most a few hundred documents.)
 */
import type { DocumentSummary } from '@realtimedocs/contracts';

type Clocks = Pick<DocumentSummary, 'contentUpdatedAt' | 'updatedAt'>;

export interface LatestChange {
  /** ISO time of the change. */
  at: string;
  /** `content`: the text was edited. `details`: the title or the state changed after the last edit. */
  kind: 'content' | 'details';
}

export function latestChange(document: Clocks): LatestChange {
  return Date.parse(document.updatedAt) > Date.parse(document.contentUpdatedAt)
    ? { at: document.updatedAt, kind: 'details' }
    : { at: document.contentUpdatedAt, kind: 'content' };
}

/** Newest change first; documents that changed at the same instant keep a stable order. */
export function byLatestChange(
  a: Clocks & Pick<DocumentSummary, 'id'>,
  b: Clocks & Pick<DocumentSummary, 'id'>,
): number {
  const difference = Date.parse(latestChange(b).at) - Date.parse(latestChange(a).at);
  if (difference !== 0) return difference;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
