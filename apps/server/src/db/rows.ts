/** Typed rows and the column lists that produce them. */
import type { DocumentRole, DocumentStatus, WorkspaceRole } from '@realtimedocs/contracts';

export type SessionKind = 'user' | 'share' | 'desktop';

export interface SessionRow {
  id: string;
  workspaceId: string;
  kind: SessionKind;
  userId: string | null;
  shareGrantId: string | null;
  documentId: string | null;
  parentSessionId: string | null;
  guestName: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export const SESSION_COLUMNS = `
  id, workspace_id AS "workspaceId", kind, user_id AS "userId",
  share_grant_id AS "shareGrantId", document_id AS "documentId",
  parent_session_id AS "parentSessionId", guest_name AS "guestName",
  created_at AS "createdAt", last_seen_at AS "lastSeenAt", expires_at AS "expiresAt",
  revoked_at AS "revokedAt", revoked_reason AS "revokedReason"`;

export interface UserRow {
  id: string;
  workspaceId: string;
  email: string;
  displayName: string;
  role: WorkspaceRole;
  status: 'active' | 'disabled';
  createdAt: Date;
}

export const USER_COLUMNS = `
  id, workspace_id AS "workspaceId", email::text AS email, display_name AS "displayName",
  role, status, created_at AS "createdAt"`;

export interface DocumentRow {
  id: string;
  workspaceId: string;
  title: string;
  status: DocumentStatus;
  generation: number;
  schemaVersion: number;
  headSeq: number;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  contentUpdatedAt: Date;
  archivedAt: Date | null;
  trashedAt: Date | null;
}

/** Expects the documents table aliased as `d`. */
export const DOCUMENT_COLUMNS = `
  d.id, d.workspace_id AS "workspaceId", d.title, d.status, d.generation,
  d.schema_version AS "schemaVersion", d.head_seq AS "headSeq", d.created_by AS "createdBy",
  (SELECT u.display_name FROM users u WHERE u.id = d.created_by) AS "createdByName",
  d.created_at AS "createdAt", d.updated_at AS "updatedAt",
  d.content_updated_at AS "contentUpdatedAt", d.archived_at AS "archivedAt",
  d.trashed_at AS "trashedAt"`;

export interface GrantRow {
  id: string;
  workspaceId: string;
  documentId: string;
  role: DocumentRole;
  secretHash: Buffer;
  label: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  rotatedFrom: string | null;
  lastUsedAt: Date | null;
}

/** Expects the share_grants table aliased as `g`. */
export const GRANT_COLUMNS = `
  g.id, g.workspace_id AS "workspaceId", g.document_id AS "documentId", g.role,
  g.secret_hash AS "secretHash", g.label, g.created_by AS "createdBy",
  (SELECT u.display_name FROM users u WHERE u.id = g.created_by) AS "createdByName",
  g.created_at AS "createdAt", g.expires_at AS "expiresAt", g.revoked_at AS "revokedAt",
  g.rotated_from AS "rotatedFrom", g.last_used_at AS "lastUsedAt"`;

export interface AssetRow {
  id: string;
  workspaceId: string;
  documentId: string;
  kind: 'image' | 'attachment';
  storageKey: string;
  name: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: Buffer;
  status: 'pending' | 'ready';
  createdAt: Date;
}

export const ASSET_COLUMNS = `
  id, workspace_id AS "workspaceId", document_id AS "documentId", kind,
  storage_key AS "storageKey", name, mime, size_bytes AS "sizeBytes", width, height,
  sha256, status, created_at AS "createdAt"`;

export interface SnapshotRow {
  id: string;
  documentId: string;
  name: string;
  kind: 'named' | 'pre_restore';
  generation: number;
  sizeBytes: number;
  createdAt: Date;
  createdByName: string | null;
}

/** Expects the snapshots table aliased as `s`. Never selects the state bytes. */
export const SNAPSHOT_COLUMNS = `
  s.id, s.document_id AS "documentId", s.name, s.kind, s.generation,
  s.size_bytes AS "sizeBytes", s.created_at AS "createdAt",
  (SELECT u.display_name FROM users u WHERE u.id = s.created_by) AS "createdByName"`;
