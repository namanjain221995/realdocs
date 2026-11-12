/**
 * Version of the authoritative document schema (packages/editor/src/schema).
 * Bump when a node, mark or attribute is added that older clients would not
 * understand. A client may open a document only if
 * `client.schemaVersion >= document.schemaVersion`; otherwise the server
 * answers `update_required` and the client shows a safe update-required state
 * instead of instantiating an editor that could drop unknown content.
 */
export const DOCUMENT_SCHEMA_VERSION = 2;
// History: 1 = initial schema; 2 = `callout` block node (2026-11-11).

/** Version of the stateless collaboration side-channel protocol (see collab.ts). */
export const COLLAB_PROTOCOL_VERSION = 1;

/** Name of the Y.XmlFragment that holds the ProseMirror document. */
export const Y_FRAGMENT_FIELD = 'default';

/** Name of the top-level Y.Map with the page settings (see page.ts). Absent or empty means defaults. */
export const Y_PAGE_FIELD = 'page';

/** Path of the collaboration WebSocket endpoint. No secrets ever appear in this URL. */
export const COLLAB_WS_PATH = '/collab';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Collaboration room name. It binds a connection to one document generation:
 * restoring a snapshot increments the generation, so clients of an abandoned
 * generation can never sync into the restored one.
 */
export function collabDocumentName(documentId: string, generation: number): string {
  return `${documentId}.g${generation}`;
}

export function parseCollabDocumentName(
  name: string,
): { documentId: string; generation: number } | null {
  const match = /^([0-9a-f-]{36})\.g([1-9][0-9]{0,8})$/.exec(name);
  if (!match || !match[1] || !match[2] || !UUID_RE.test(match[1])) return null;
  return { documentId: match[1], generation: Number(match[2]) };
}
