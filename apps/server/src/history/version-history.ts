/**
 * Builds the "version history document" of a document from its recorded history
 * (docs/version-history.md). The history is replayed once, oldest row first, into one Y.Doc per
 * generation; the text is taken only where a version ends.
 */
import type { VersionHistoryGroupingQuery, VersionHistoryResponse } from '@realtimedocs/contracts';
import * as Y from 'yjs';
import { findReadyAssets } from '../assets/service';
import type { AssetRow } from '../db/rows';
import type { Queryable } from '../db/pool';
import { ydocToJson } from '../documents/ydoc';
import { errors } from '../errors';
import {
  actionOfOperation,
  actionOfVersion,
  assembleVersionHistory,
  continuesGroup,
  documentLines,
  imageFileName,
  newAccumulator,
  offerVersion,
  oneLine,
  recordLineTimes,
  sizeOfLines,
  type ImageFacts,
  type LineTimes,
  type NamedAsset,
  type OpenGroup,
  type SnapshotLine,
  type VersionAction,
  type VersionActor,
  type VersionEditor,
} from './version-document';

/** History rows read per query. A checkpoint row holds a whole document state. */
const BATCH_ROWS = 100;
/** More recorded rows than this are not replayed in one request. */
export const VERSION_HISTORY_MAX_ROWS = 200_000;
/** The list of versions is cut after this many, or after this much snapshot text. */
export const VERSION_HISTORY_MAX_VERSIONS = 2_000;
export const VERSION_HISTORY_MAX_CHARACTERS = 32 * 1024 * 1024;
/**
 * Text taken after single changes (for the exact time of each line) before the replay falls back
 * to taking it only where a version ends.
 */
export const VERSION_HISTORY_EXACT_TIME_CHARACTERS = 256 * 1024 * 1024;

interface ReplayRow {
  hseq: string | number;
  generation: number;
  kind: 'update' | 'checkpoint';
  operationType: string;
  actorKind: 'user' | 'guest' | 'service' | 'system';
  actorUserId: string | null;
  actorGrantId: string | null;
  actorName: string;
  participantRole: string | null;
  committedAt: Date;
  update: Buffer;
}

interface SessionFacts {
  id: string;
  companyName: string;
  roundNumber: number;
  roundName: string | null;
  timezone: string;
  completedAt: Date | null;
  cancelledAt: Date | null;
  candidate: string | null;
}

async function sessionOf(
  db: Queryable,
  workspaceId: string,
  documentId: string,
): Promise<SessionFacts | null> {
  const result = await db.query<SessionFacts>(
    `SELECT s.id, s.company_name AS "companyName", s.round_number AS "roundNumber",
            s.round_name AS "roundName", s.timezone, s.completed_at AS "completedAt",
            s.cancelled_at AS "cancelledAt",
            (SELECT p.name FROM interview_participants p
              WHERE p.session_id = s.id AND p.role = 'candidate'
              ORDER BY p.removed_at IS NOT NULL, p.created_at
              LIMIT 1) AS candidate
       FROM interview_sessions s
      WHERE s.document_id = $1 AND s.workspace_id = $2`,
    [documentId, workspaceId],
  );
  return result.rows[0] ?? null;
}

export interface VersionHistoryInput {
  db: Queryable;
  workspaceId: string;
  publicOrigin: string;
  document: { id: string; title: string };
  options: VersionHistoryGroupingQuery;
  /** Path of one image's bytes for this caller, without the id: ends with `/images/`. */
  imageUrlPrefix: string;
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  candidate: 'Candidate',
  interviewer: 'Interviewer',
  admin: 'Admin',
  member: 'Member',
};

/**
 * Who the editors of the versions are: the account (role and address) behind a user id, the
 * interview participant (role and address) behind a link, or an anonymous guest. Looked up once
 * for all versions; a deleted account or link leaves the name the history row recorded.
 */
async function resolveEditors(
  db: Queryable,
  workspaceId: string,
  actors: readonly VersionActor[],
): Promise<(actor: VersionActor) => VersionEditor> {
  const userIds = [...new Set(actors.flatMap((actor) => (actor.userId ? [actor.userId] : [])))];
  const grantIds = [...new Set(actors.flatMap((actor) => (actor.grantId ? [actor.grantId] : [])))];
  const users = new Map<string, { email: string; role: string }>();
  const participants = new Map<string, { email: string; role: string }>();
  if (userIds.length > 0) {
    const result = await db.query<{ id: string; email: string; role: string }>(
      `SELECT id, email::text AS email, role FROM users
        WHERE id = ANY($1::uuid[]) AND workspace_id = $2`,
      [userIds, workspaceId],
    );
    for (const row of result.rows) users.set(row.id, row);
  }
  if (grantIds.length > 0) {
    const result = await db.query<{ grantId: string; email: string; role: string }>(
      `SELECT g.id AS "grantId", p.email::text AS email, p.role
         FROM share_grants g
         JOIN interview_participants p ON p.id = g.participant_id
        WHERE g.id = ANY($1::uuid[]) AND p.workspace_id = $2`,
      [grantIds, workspaceId],
    );
    for (const row of result.rows) participants.set(row.grantId, row);
  }
  return (actor) => {
    const name = oneLine(actor.name) || 'Unknown';
    if (actor.kind === 'system') return { name, role: 'System', email: null, kind: 'system' };
    if (actor.kind === 'service') return { name, role: 'Service', email: null, kind: 'service' };
    const participant = actor.grantId ? participants.get(actor.grantId) : undefined;
    if (participant) {
      return {
        name,
        role: ROLE_LABELS[participant.role] ?? 'Guest',
        email: participant.email,
        kind: actor.kind,
      };
    }
    const user = actor.userId ? users.get(actor.userId) : undefined;
    if (actor.kind === 'user') {
      return {
        name,
        role: ROLE_LABELS[user?.role ?? ''] ?? 'Member',
        email: user?.email ?? null,
        kind: 'user',
      };
    }
    // A share-link guest without a participant record: a name they chose, no address.
    return { name, role: ROLE_LABELS[actor.role ?? ''] ?? 'Guest', email: null, kind: 'guest' };
  };
}

interface ReplayGroup extends OpenGroup {
  actor: VersionActor;
  actions: Set<VersionAction>;
  /** The lines after the newest change of the group, while exact times are being taken. */
  lines: SnapshotLine[] | null;
  addedAt: LineTimes;
  removedAt: LineTimes;
}

/**
 * The version history of a document as data. Every figure in it comes from stored rows (server
 * timestamps, server-set actor names), so the same history always gives the same document.
 *
 * One forward replay. The text is taken after every recorded change, so that each added and
 * removed line gets the time of the very change that made it; once
 * `VERSION_HISTORY_EXACT_TIME_CHARACTERS` of text have been taken that way, the rest of the
 * replay takes the text only where a version ends and its lines carry the version's time.
 */
export async function buildVersionHistory(
  input: VersionHistoryInput,
): Promise<VersionHistoryResponse> {
  const { db, workspaceId, document, options } = input;
  const session = await sessionOf(db, workspaceId, document.id);
  const timezone = options.timezone ?? session?.timezone ?? 'UTC';
  const budget = {
    maxVersions: VERSION_HISTORY_MAX_VERSIONS,
    maxCharacters: VERSION_HISTORY_MAX_CHARACTERS,
  };

  const accumulator = newAccumulator();
  let ydoc: Y.Doc | null = null;
  let generation: number | null = null;
  let generations = 0;
  let group: ReplayGroup | null = null;
  let trackingStartedAt: Date | null = null;
  let lastAt: Date | null = null;
  let rows = 0;
  let after = 0;
  let exactCharacters = 0;

  const linesNow = (doc: Y.Doc): SnapshotLine[] => documentLines(ydocToJson(doc));

  const closeGroup = (): void => {
    if (group === null || ydoc === null) return;
    offerVersion(
      accumulator,
      {
        startedAt: new Date(group.firstAt),
        editedAt: new Date(group.lastAt),
        actor: group.actor,
        action: actionOfVersion(group.actions),
        lines: group.lines ?? linesNow(ydoc),
        addedAt: group.addedAt,
        removedAt: group.removedAt,
      },
      budget,
    );
    group = null;
  };

  try {
    for (;;) {
      const page = await db.query<ReplayRow>(
        `SELECT hseq, generation, kind, operation_type AS "operationType",
                actor_kind AS "actorKind", actor_user_id AS "actorUserId",
                actor_grant_id AS "actorGrantId", actor_name AS "actorName",
                participant_role AS "participantRole",
                server_committed_at AS "committedAt", "update"
           FROM doc_history
          WHERE document_id = $1 AND workspace_id = $2 AND hseq > $3
          ORDER BY hseq
          LIMIT $4`,
        [document.id, workspaceId, after, BATCH_ROWS],
      );
      if (page.rows.length === 0) break;
      for (const row of page.rows) {
        rows += 1;
        if (rows > VERSION_HISTORY_MAX_ROWS) {
          throw errors.payloadTooLarge(
            `The history of this document has more than ${VERSION_HISTORY_MAX_ROWS} recorded changes and cannot be exported in one piece.`,
          );
        }
        after = Number(row.hseq);
        trackingStartedAt ??= row.committedAt;
        lastAt = row.committedAt;
        const at = row.committedAt.getTime();
        const actor: VersionActor = {
          kind: row.actorKind,
          userId: row.actorUserId,
          grantId: row.actorGrantId,
          name: row.actorName,
          role: row.participantRole,
        };

        if (ydoc === null || row.generation !== generation) {
          // A restore starts a new generation from a stored state: another document lineage.
          closeGroup();
          ydoc?.destroy();
          ydoc = new Y.Doc();
          generation = row.generation;
          generations += 1;
        }

        if (row.kind === 'checkpoint') {
          if (row.operationType === 'checkpoint') {
            // A periodic copy of the state the rows before it already produced: not a change.
            Y.applyUpdate(ydoc, row.update);
            continue;
          }
          // A baseline: the content at the point where this generation's history begins (the
          // start of recording, or a restored version). A version of its own when it differs.
          closeGroup();
          Y.applyUpdate(ydoc, row.update);
          offerVersion(
            accumulator,
            {
              startedAt: row.committedAt,
              editedAt: row.committedAt,
              actor,
              action: generations > 1 ? 'Restored' : 'Initial',
              lines: linesNow(ydoc),
            },
            budget,
          );
          continue;
        }

        const action = actionOfOperation(row.operationType);
        const paste = action === 'Pasted';
        const actorKey = `${row.actorKind}:${row.actorUserId ?? row.actorGrantId ?? row.actorName}`;
        if (!continuesGroup(group, actorKey, at, paste, options)) {
          closeGroup();
          group = {
            actorKey,
            firstAt: at,
            lastAt: at,
            paste,
            actor,
            actions: new Set(),
            // Exact times need the text before the group's first change too.
            lines:
              exactCharacters < VERSION_HISTORY_EXACT_TIME_CHARACTERS ? accumulator.current : null,
            addedAt: new Map(),
            removedAt: new Map(),
          };
        }
        const open: ReplayGroup = group as ReplayGroup;
        Y.applyUpdate(ydoc, row.update);
        open.lastAt = at;
        open.actions.add(action);
        if (open.lines !== null) {
          const next = linesNow(ydoc);
          exactCharacters += sizeOfLines(next);
          recordLineTimes(open.lines, next, at, open.addedAt, open.removedAt);
          // Past the budget this group finishes at its end, like every later one.
          open.lines = exactCharacters < VERSION_HISTORY_EXACT_TIME_CHARACTERS ? next : null;
        }
      }
      if (page.rows.length < BATCH_ROWS) break;
    }
    closeGroup();
  } finally {
    ydoc?.destroy();
  }

  // Names and facts of every asset the versions mention. Only this document's own files.
  const ids = new Set<string>();
  for (const lines of [...accumulator.versions.map((v) => v.lines), accumulator.current]) {
    for (const line of lines) if (line.kind !== 'text') ids.add(line.id);
  }
  const assetRows = await findReadyAssets(db, workspaceId, document.id, [...ids]);
  const names = new Map<string, NamedAsset>();
  const images = new Map<string, ImageFacts>();
  for (const asset of assetRows) {
    const fileName = imageFileName(asset.id, asset.mime, asset.name);
    names.set(asset.id, { kind: asset.kind, fileName });
    if (asset.kind === 'image') {
      images.set(asset.id, {
        id: asset.id,
        fileName,
        mime: asset.mime,
        sizeBytes: Number(asset.sizeBytes),
        sha256: asset.sha256.toString('hex'),
        url: `${input.imageUrlPrefix}${asset.id}`,
      });
    }
  }
  const editorOf = await resolveEditors(
    db,
    workspaceId,
    accumulator.versions.map((version) => version.actor),
  );

  return assembleVersionHistory(
    {
      document: {
        id: document.id,
        title: document.title,
        url: `${input.publicOrigin}/d/${document.id}`,
      },
      session: session
        ? {
            id: session.id,
            candidate: session.candidate,
            company: session.companyName,
            round: { number: String(session.roundNumber), name: session.roundName },
          }
        : null,
      trackingStartedAt,
      // When the interview ended, if it did; otherwise the last recorded change. Never "now":
      // the same history must give the same document.
      finalizedAt: session?.completedAt ?? session?.cancelledAt ?? lastAt,
      timezone,
    },
    accumulator,
    names,
    images,
    editorOf,
  );
}

/**
 * The stored file of an image that appeared in this document's history, or null. An asset of
 * another document, an attachment, or an image that was never part of the document is null.
 */
export async function findHistoryImage(
  db: Queryable,
  workspaceId: string,
  documentId: string,
  imageId: string,
): Promise<AssetRow | null> {
  const [asset] = await findReadyAssets(db, workspaceId, documentId, [imageId]);
  if (!asset || asset.kind !== 'image') return null;
  const seen = await db.query(
    `SELECT 1 FROM doc_history
      WHERE document_id = $1 AND workspace_id = $2 AND attachment_ids @> ARRAY[$3]::uuid[]
      LIMIT 1`,
    [documentId, workspaceId, imageId],
  );
  return (seen.rowCount ?? 0) > 0 ? asset : null;
}
