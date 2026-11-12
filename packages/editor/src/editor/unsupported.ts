/**
 * Finds shared content that this client's schema cannot represent.
 *
 * The shared Yjs document can hold nodes, marks and attributes that a client
 * built from an older schema does not know (a newer web app and an older
 * desktop app on the same document). The collaboration binding keeps such
 * content in the shared document and does not render it. This scan says what
 * exactly is unsupported, so the editor can
 *
 *  - explain it ("2 blocks of a type this version does not know: callout"),
 *  - stop writing while it is there: an edit by this client would erase
 *    attributes it does not know, and
 *  - start writing again by itself as soon as the content is gone.
 *
 * Nothing here changes the shared document.
 */
import type { Schema } from '@tiptap/pm/model';
import * as Y from 'yjs';

export interface UnsupportedContent {
  /** Unknown node type → number of occurrences. */
  nodes: Record<string, number>;
  /** Unknown mark type → number of text runs. */
  marks: Record<string, number>;
  /** `node.attribute` this schema does not declare → number of occurrences. */
  attributes: Record<string, number>;
  /** Total number of findings. */
  total: number;
}

/** Attribute the binding adds while a snapshot is shown; never part of a schema. */
const BINDING_ATTRIBUTE = 'ychange';
/** The binding stores overlapping marks as `<name>--<8 character hash>`. */
const HASHED_MARK = /(.*)(--[a-zA-Z0-9+/=]{8})$/;
/** A hostile document must not make the scan itself expensive to report. */
const MAX_DISTINCT = 50;

function bump(counts: Record<string, number>, key: string): void {
  if (Object.hasOwn(counts, key)) counts[key] = (counts[key] ?? 0) + 1;
  else if (Object.keys(counts).length < MAX_DISTINCT) counts[key] = 1;
}

export function emptyUnsupportedContent(): UnsupportedContent {
  return { nodes: {}, marks: {}, attributes: {}, total: 0 };
}

export function scanUnsupportedContent(
  fragment: Y.XmlFragment,
  schema: Schema,
): UnsupportedContent {
  const found = emptyUnsupportedContent();

  const visit = (type: unknown): void => {
    if (type instanceof Y.XmlText) {
      for (const delta of type.toDelta() as { attributes?: Record<string, unknown> }[]) {
        for (const key of Object.keys(delta.attributes ?? {})) {
          if (key === BINDING_ATTRIBUTE) continue;
          const name = HASHED_MARK.exec(key)?.[1] ?? key;
          if (Object.hasOwn(schema.marks, name)) continue;
          bump(found.marks, name.slice(0, 64));
          found.total += 1;
        }
      }
      return;
    }
    if (!(type instanceof Y.XmlElement)) return;
    const nodeType = Object.hasOwn(schema.nodes, type.nodeName)
      ? schema.nodes[type.nodeName]
      : undefined;
    if (!nodeType) {
      // The whole subtree is unrenderable; its children are not reported one by one.
      bump(found.nodes, type.nodeName.slice(0, 64));
      found.total += 1;
      return;
    }
    for (const key of Object.keys(type.getAttributes())) {
      if (key === BINDING_ATTRIBUTE || Object.hasOwn(nodeType.spec.attrs ?? {}, key)) continue;
      bump(found.attributes, `${type.nodeName}.${key.slice(0, 64)}`);
      found.total += 1;
    }
    type.toArray().forEach(visit);
  };

  fragment.toArray().forEach(visit);
  return found;
}

export function sameUnsupportedContent(a: UnsupportedContent, b: UnsupportedContent): boolean {
  return a.total === b.total && JSON.stringify(a) === JSON.stringify(b);
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** One sentence naming what is unsupported, for the notice above the document. */
export function describeUnsupportedContent(found: UnsupportedContent): string {
  const parts: string[] = [];
  const sum = (counts: Record<string, number>): number =>
    Object.values(counts).reduce((total, count) => total + count, 0);
  const names = (counts: Record<string, number>): string => {
    const keys = Object.keys(counts);
    const shown = keys.slice(0, 4).join(', ');
    return keys.length > 4 ? `${shown} and ${keys.length - 4} more` : shown;
  };
  if (found.total === 0) return '';
  if (sum(found.nodes) > 0) {
    parts.push(`${plural(sum(found.nodes), 'block', 'blocks')} (${names(found.nodes)})`);
  }
  if (sum(found.marks) > 0) {
    parts.push(
      `${plural(sum(found.marks), 'piece', 'pieces')} of formatting (${names(found.marks)})`,
    );
  }
  if (sum(found.attributes) > 0) {
    parts.push(
      `${plural(sum(found.attributes), 'setting', 'settings')} of existing blocks (${names(found.attributes)})`,
    );
  }
  return parts.join(', ');
}
