import { z } from './zod';
import { AccessVia, DocumentRole, EffectiveRole, WorkspaceRole } from './roles';

export const Id = z.uuid();
export const IsoDate = z.iso.datetime();

export const User = z.object({
  id: Id,
  email: z.string(),
  displayName: z.string(),
  role: WorkspaceRole,
  status: z.enum(['active', 'disabled']),
  createdAt: IsoDate,
});
export type User = z.infer<typeof User>;

export const DocumentStatus = z.enum(['active', 'archived', 'trashed']);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

/** How the current principal reaches a document. Always computed by the server. */
export const AccessInfo = z.object({
  role: EffectiveRole,
  via: AccessVia,
  /** When this access ends on its own (share expiry / session expiry), if it does. */
  expiresAt: IsoDate.nullable(),
  /** Stable id for local-storage partitioning; null for share-link guests. */
  accountId: Id.nullable(),
});
export type AccessInfo = z.infer<typeof AccessInfo>;

export const DocumentSummary = z.object({
  id: Id,
  title: z.string(),
  status: DocumentStatus,
  /** Incremented by snapshot restore. Part of the collaboration room name. */
  generation: z.number().int().min(1),
  schemaVersion: z.number().int().min(1),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  /** Last time content (not metadata) was durably changed. */
  contentUpdatedAt: IsoDate,
  archivedAt: IsoDate.nullable(),
  trashedAt: IsoDate.nullable(),
  /** When a trashed document will be purged automatically; null otherwise. */
  purgeAfter: IsoDate.nullable(),
  createdByName: z.string().nullable(),
  access: AccessInfo,
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

export const Member = z.object({
  userId: Id,
  email: z.string(),
  displayName: z.string(),
  role: DocumentRole,
  userStatus: z.enum(['active', 'disabled']),
  grantedAt: IsoDate,
});
export type Member = z.infer<typeof Member>;

export const ShareGrantState = z.enum(['active', 'expired', 'revoked']);
export type ShareGrantState = z.infer<typeof ShareGrantState>;

/** A document share link. The secret is never part of this object. */
export const ShareGrant = z.object({
  id: Id,
  documentId: Id,
  role: DocumentRole,
  label: z.string(),
  state: ShareGrantState,
  createdAt: IsoDate,
  createdByName: z.string().nullable(),
  expiresAt: IsoDate.nullable(),
  revokedAt: IsoDate.nullable(),
  lastUsedAt: IsoDate.nullable(),
  /** Sessions currently derived from this grant (browser + desktop). */
  activeSessions: z.number().int().min(0),
  /** Live collaboration connections currently using this grant. */
  liveConnections: z.number().int().min(0),
});
export type ShareGrant = z.infer<typeof ShareGrant>;

export const InvitationState = z.enum(['pending', 'accepted', 'expired', 'revoked']);
export type InvitationState = z.infer<typeof InvitationState>;

/** An account invitation. Separate concept from document share links. */
export const Invitation = z.object({
  id: Id,
  email: z.string().nullable(),
  role: WorkspaceRole,
  state: InvitationState,
  createdAt: IsoDate,
  createdByName: z.string().nullable(),
  expiresAt: IsoDate,
  acceptedAt: IsoDate.nullable(),
  acceptedByName: z.string().nullable(),
});
export type Invitation = z.infer<typeof Invitation>;

export const SnapshotKind = z.enum(['named', 'pre_restore']);
export type SnapshotKind = z.infer<typeof SnapshotKind>;

export const Snapshot = z.object({
  id: Id,
  documentId: Id,
  name: z.string(),
  kind: SnapshotKind,
  /** Generation the snapshot was taken from. */
  generation: z.number().int().min(1),
  sizeBytes: z.number().int().min(0),
  createdAt: IsoDate,
  createdByName: z.string().nullable(),
});
export type Snapshot = z.infer<typeof Snapshot>;

export const AssetKind = z.enum(['image', 'attachment']);
export type AssetKind = z.infer<typeof AssetKind>;

/** Metadata of an uploaded asset. Bytes are only reachable through the authorized asset endpoint. */
export const Asset = z.object({
  id: Id,
  documentId: Id,
  kind: AssetKind,
  /** Sanitised display filename. */
  name: z.string(),
  /** Verified content type (images) or `application/octet-stream` (attachments). */
  mime: z.string(),
  sizeBytes: z.number().int().min(0),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  createdAt: IsoDate,
});
export type Asset = z.infer<typeof Asset>;

/** One live collaboration participant, as attested by the server. */
export const Participant = z.object({
  /** Opaque per-connection id (not the account id). */
  id: z.string(),
  name: z.string(),
  color: z.string(),
  role: EffectiveRole,
  kind: z.enum(['user', 'guest']),
});
export type Participant = z.infer<typeof Participant>;

export const AuditEvent = z.object({
  id: Id,
  at: IsoDate,
  actorName: z.string().nullable(),
  actorKind: z.enum(['user', 'guest', 'system']),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  /** Small, non-sensitive details. Never document content, passwords or secrets. */
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type AuditEvent = z.infer<typeof AuditEvent>;
