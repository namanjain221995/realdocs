/**
 * The `hello` proof (packages/contracts/src/collab.ts): does the server
 * document already contain everything a client holds?
 *
 * A state vector only describes inserted structs. A deletion-only edit does
 * not advance it, so the delete set is compared as well: every range the
 * client has deleted must be deleted on the server too.
 */
import * as Y from 'yjs';

interface DeleteRange {
  clock: number;
  len: number;
}

/** Decodes `base64(Y.encodeSnapshot(...))`. Returns null for malformed input. */
export function decodeClientSnapshot(encoded: string): Y.Snapshot | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  try {
    return Y.decodeSnapshot(Buffer.from(encoded, 'base64'));
  } catch {
    return null;
  }
}

/** True when `[clock, clock + len)` lies inside one of the sorted, merged `ranges`. */
function covered(ranges: readonly DeleteRange[], clock: number, len: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle] as DeleteRange;
    if (clock < range.clock) high = middle - 1;
    else if (clock >= range.clock + range.len) low = middle + 1;
    else return clock + len <= range.clock + range.len;
  }
  return false;
}

/**
 * True when `server` contains every struct (state vector) and every deletion
 * (delete set) recorded in the client's snapshot.
 */
export function snapshotContainedIn(server: Y.Doc, client: Y.Snapshot): boolean {
  // Y.snapshot builds the delete set from the struct store: per client, the
  // ranges are sorted and adjacent deleted structs are merged into one range.
  const own = Y.snapshot(server);

  for (const [clientId, clock] of client.sv) {
    if (!Number.isSafeInteger(clock) || clock < 0) return false;
    if ((own.sv.get(clientId) ?? 0) < clock) return false;
  }

  for (const [clientId, ranges] of client.ds.clients) {
    const serverRanges = own.ds.clients.get(clientId) ?? [];
    for (const range of ranges as readonly DeleteRange[]) {
      if (!Number.isSafeInteger(range.clock) || !Number.isSafeInteger(range.len)) return false;
      if (range.clock < 0 || range.len < 0) return false;
      if (range.len === 0) continue;
      if (!covered(serverRanges, range.clock, range.len)) return false;
    }
  }
  return true;
}
