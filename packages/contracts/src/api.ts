/**
 * HTTP API contracts. Every route validates its input with these schemas and
 * the web/desktop clients parse responses with them.
 *
 * Conventions
 * - All routes live under `/api`. JSON in, JSON out, errors as `ApiErrorBody`.
 * - Browser auth: `rd_session` cookie (account) and, for share-link guests, a
 *   per-document cookie scoped to `Path=/api/documents/<documentId>`.
 * - Desktop auth: `Authorization: Bearer <desktop session token>` (document scoped).
 * - Cookie-authenticated mutations must send `X-RD-CSRF: <csrfToken>` (from
 *   `GET /api/auth/session`); all mutations are rejected for foreign origins.
 */
import { z } from './zod';
import { DEFAULT_LIMITS } from './limits';
import {
  Asset,
  AuditEvent,
  DocumentSummary,
  Id,
  Invitation,
  IsoDate,
  Member,
  Participant,
  ShareGrant,
  Snapshot,
  User,
} from './models';
import { DocumentRole, EffectiveRole, WorkspaceRole } from './roles';

export const CSRF_HEADER = 'x-rd-csrf';
export const SESSION_COOKIE = 'rd_session';
/** Share-session cookie name for one document: `rd_share_<documentId>`. */
export function shareCookieName(documentId: string): string {
  return `rd_share_${documentId}`;
}

const L = DEFAULT_LIMITS;
const Email = z.email().max(L.emailMaxLength);
const Password = z.string().min(L.passwordMinLength).max(L.passwordMaxLength);
const DisplayName = z.string().trim().min(1).max(L.displayNameMaxLength);
const Title = z.string().trim().min(1).max(L.titleMaxLength);
const Secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

// ── Meta ────────────────────────────────────────────────────────────────────

/** `GET /api/meta` (public). Lets clients validate a server and read limits. */
export const MetaResponse = z.object({
  name: z.literal('RealtimeDocs'),
  version: z.string(),
  schemaVersion: z.number().int(),
  minClientSchemaVersion: z.number().int(),
  protocolVersion: z.number().int(),
  /** Canonical public origin of this deployment (used in generated links). */
  publicOrigin: z.string(),
  limits: z.record(z.string(), z.number()),
  imageMimeTypes: z.array(z.string()),
  attachmentExtensions: z.array(z.string()),
  /**
   * True when the operator enabled self-service sign-up (`ALLOW_SIGNUP=true`). Off by default:
   * accounts are then created only from invitations. Older servers omit it (read as false).
   */
  signupEnabled: z.boolean().default(false),
  /** Oldest desktop version the stable channel still supports (null: no minimum published). */
  minimumSupportedClientVersion: z.string().nullable().default(null),
  /** Version of the current stable desktop release (null: none published). */
  recommendedClientVersion: z.string().nullable().default(null),
  /** Same value as `schemaVersion`; named for the update flow. */
  documentSchemaVersion: z.number().int().optional(),
  /** Absolute URL of the desktop update check. */
  updateUrl: z.string().nullable().default(null),
});
export type MetaResponse = z.infer<typeof MetaResponse>;

/** `GET /api/health` (public liveness) and `GET /api/ready` (database reachable). */
export const HealthResponse = z.object({ status: z.enum(['ok', 'degraded']), time: IsoDate });
export type HealthResponse = z.infer<typeof HealthResponse>;

// ── Authentication ──────────────────────────────────────────────────────────

/** `POST /api/auth/login` */
export const LoginRequest = z.object({ email: Email, password: z.string().min(1).max(1024) });
export type LoginRequest = z.infer<typeof LoginRequest>;

/** `GET /api/auth/session` — also returned by login and invitation accept. */
export const SessionResponse = z.object({
  user: User.nullable(),
  /** Send back in `X-RD-CSRF` on cookie-authenticated mutations. Null when signed out. */
  csrfToken: z.string().nullable(),
  expiresAt: IsoDate.nullable(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

/** `PATCH /api/auth/profile` */
export const UpdateProfileRequest = z.object({ displayName: DisplayName });
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

/**
 * `POST /api/auth/password` → 204; revokes the account's other sessions.
 *
 * A wrong current password answers `validation_failed` with one issue whose
 * `path` is `currentPassword` (never `unauthenticated`: the session is fine).
 */
export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: Password,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

/**
 * `POST /api/auth/sessions/revoke-others` → `RevokeOtherSessionsResponse`.
 *
 * Ends every other session of the signed-in account: other browser sessions
 * and the desktop sessions created from any of them. The calling session
 * stays signed in. Live collaboration connections of the ended sessions close.
 */
export const RevokeOtherSessionsResponse = z.object({
  /** Number of sessions that were ended. */
  revoked: z.number().int().nonnegative(),
});
export type RevokeOtherSessionsResponse = z.infer<typeof RevokeOtherSessionsResponse>;

// ── Users and invitations (administrators) ──────────────────────────────────

/** `GET /api/users` */
export const UsersResponse = z.object({ users: z.array(User) });
export type UsersResponse = z.infer<typeof UsersResponse>;

/** `PATCH /api/users/:userId` */
export const UpdateUserRequest = z
  .object({ role: WorkspaceRole.optional(), status: z.enum(['active', 'disabled']).optional() })
  .refine((v) => v.role !== undefined || v.status !== undefined, 'Nothing to update');
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>;

/** `POST /api/invitations` */
export const CreateInvitationRequest = z.object({
  email: Email.optional(),
  role: WorkspaceRole.default('member'),
  /** Hours until the invitation expires (default 168 = 7 days). */
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(168),
});
export type CreateInvitationRequest = z.input<typeof CreateInvitationRequest>;

/** The `url` contains the secret and is returned exactly once. */
export const CreateInvitationResponse = z.object({ invitation: Invitation, url: z.string() });
export type CreateInvitationResponse = z.infer<typeof CreateInvitationResponse>;

/** `GET /api/invitations` */
export const InvitationsResponse = z.object({ invitations: z.array(Invitation) });
export type InvitationsResponse = z.infer<typeof InvitationsResponse>;

/** `POST /api/invitations/lookup` (public, rate limited) */
export const InvitationLookupRequest = z.object({ invitationId: Id, secret: Secret });
export type InvitationLookupRequest = z.infer<typeof InvitationLookupRequest>;
export const InvitationLookupResponse = z.object({
  email: z.string().nullable(),
  role: WorkspaceRole,
  workspaceName: z.string(),
  expiresAt: IsoDate,
});
export type InvitationLookupResponse = z.infer<typeof InvitationLookupResponse>;

/** `POST /api/invitations/accept` (public, rate limited) → `SessionResponse` + cookie. */
export const AcceptInvitationRequest = z.object({
  invitationId: Id,
  secret: Secret,
  /** Required when the invitation was created without an email address. */
  email: Email.optional(),
  displayName: DisplayName,
  password: Password,
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequest>;

/**
 * `POST /api/auth/signup` (public, rate limited) → `SessionResponse` + session cookie.
 *
 * Only when the operator enabled sign-up (`MetaResponse.signupEnabled`); otherwise `forbidden`.
 * The new account is a workspace `member` with access to no document until an administrator adds
 * it. An address that already has an account answers `conflict` (never a hint about the password).
 */
export const SignupRequest = z.object({
  email: Email,
  displayName: DisplayName,
  password: Password,
});
export type SignupRequest = z.infer<typeof SignupRequest>;

// ── Documents ───────────────────────────────────────────────────────────────

export const DocumentListView = z.enum(['active', 'recent', 'archived', 'trash']);
export type DocumentListView = z.infer<typeof DocumentListView>;

/**
 * `GET /api/documents?view=&q=`
 *
 * - `active` / `archived` / `trash`: documents in that state the caller may open,
 *   most recently updated first (`trash` is for administrators).
 * - `recent`: active documents whose content or metadata changed most recently,
 *   newest first, limited to a short list.
 * - `q`: case-insensitive substring match on the title (document bodies are not searched).
 */
export const ListDocumentsQuery = z.object({
  view: DocumentListView.default('active'),
  q: z.string().trim().max(200).optional(),
});
export type ListDocumentsQuery = z.input<typeof ListDocumentsQuery>;
export const DocumentsResponse = z.object({ documents: z.array(DocumentSummary) });
export type DocumentsResponse = z.infer<typeof DocumentsResponse>;

/** `POST /api/documents` (admin) */
export const CreateDocumentRequest = z.object({ title: Title.optional() });
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequest>;

/** `GET /api/documents/:documentId`, and the result of create/rename/duplicate/status changes. */
export const DocumentResponse = z.object({ document: DocumentSummary });
export type DocumentResponse = z.infer<typeof DocumentResponse>;

/** `PATCH /api/documents/:documentId` (admin) */
export const UpdateDocumentRequest = z.object({ title: Title });
export type UpdateDocumentRequest = z.infer<typeof UpdateDocumentRequest>;

/**
 * Admin lifecycle actions, all `POST` with an empty body and a `DocumentResponse`:
 * `/api/documents/:id/duplicate`, `/archive`, `/unarchive`, `/trash`, `/restore`.
 * `DELETE /api/documents/:id` permanently deletes a trashed document.
 */

// ── Memberships (admin) ─────────────────────────────────────────────────────

/** `GET /api/documents/:documentId/members` */
export const MembersResponse = z.object({ members: z.array(Member) });
export type MembersResponse = z.infer<typeof MembersResponse>;

/** `PUT /api/documents/:documentId/members/:userId` (and `DELETE` to remove) */
export const SetMemberRequest = z.object({ role: DocumentRole });
export type SetMemberRequest = z.infer<typeof SetMemberRequest>;

// ── Share links (admin) ─────────────────────────────────────────────────────

/** `POST /api/documents/:documentId/shares` — view-only unless `role` says otherwise. */
export const CreateShareRequest = z.object({
  role: DocumentRole.default('viewer'),
  label: z.string().trim().max(L.shareLabelMaxLength).default(''),
  /** Absolute expiry, or null for a link that does not expire by itself. */
  expiresAt: IsoDate.nullable().default(null),
});
export type CreateShareRequest = z.input<typeof CreateShareRequest>;

/** Returned by create and rotate. `url` contains the secret and is shown exactly once. */
export const ShareWithUrlResponse = z.object({ share: ShareGrant, url: z.string() });
export type ShareWithUrlResponse = z.infer<typeof ShareWithUrlResponse>;

/** `GET /api/documents/:documentId/shares` */
export const SharesResponse = z.object({ shares: z.array(ShareGrant) });
export type SharesResponse = z.infer<typeof SharesResponse>;

/**
 * `PATCH /api/documents/:documentId/shares/:shareId` — change role/expiry/label.
 * Downgrades and earlier expiries are applied to live connections immediately.
 */
export const UpdateShareRequest = z
  .object({
    role: DocumentRole.optional(),
    label: z.string().trim().max(L.shareLabelMaxLength).optional(),
    expiresAt: IsoDate.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateShareRequest = z.infer<typeof UpdateShareRequest>;
export const ShareResponse = z.object({ share: ShareGrant });
export type ShareResponse = z.infer<typeof ShareResponse>;

/**
 * `POST /api/documents/:documentId/shares/:shareId/revoke` → `ShareResponse`.
 * `POST /api/documents/:documentId/shares/:shareId/rotate` → `ShareWithUrlResponse`
 * (revokes the old grant and everything derived from it, then issues a new grant).
 */

/** `GET /api/documents/:documentId/access` (admin): who can reach the document right now. */
export const AccessListResponse = z.object({
  members: z.array(Member),
  shares: z.array(ShareGrant),
  live: z.array(Participant),
});
export type AccessListResponse = z.infer<typeof AccessListResponse>;

// ── Share-link exchange (public, rate limited) ──────────────────────────────

/**
 * `POST /api/share/exchange`. The secret is sent in the body, never in a URL.
 * `mode: 'cookie'` sets the per-document share cookie (browser).
 * `mode: 'bearer'` returns a desktop session token instead (desktop "Paste share link").
 */
export const ShareExchangeRequest = z.object({
  grantId: Id,
  secret: Secret,
  mode: z.enum(['cookie', 'bearer']).default('cookie'),
});
export type ShareExchangeRequest = z.input<typeof ShareExchangeRequest>;

export const ShareExchangeResponse = z.object({
  documentId: Id,
  title: z.string(),
  role: DocumentRole,
  expiresAt: IsoDate.nullable(),
  /** Only for `mode: 'bearer'`. */
  token: z.string().optional(),
});
export type ShareExchangeResponse = z.infer<typeof ShareExchangeResponse>;

/** `POST /api/documents/:documentId/share-session/end` — guest leaves; clears the share cookie. */

// ── Collaboration ticket ────────────────────────────────────────────────────

/**
 * `POST /api/documents/:documentId/collab-ticket`.
 * Exchanges the caller's session for a single-use, short-lived ticket that is
 * sent inside the WebSocket authentication message (never in a URL). The
 * server derives role, identity and generation; nothing here is trusted.
 */
export const CollabTicketRequest = z.object({
  /** Yjs clientID of the local Y.Doc; the only awareness slot this connection may write. */
  clientId: z.number().int().min(0).max(0xffffffff),
  schemaVersion: z.number().int().min(1),
  protocolVersion: z.number().int().min(1),
  /** Generation the client currently holds, if any (lets the server report a restore). */
  generation: z.number().int().min(1).optional(),
});
export type CollabTicketRequest = z.infer<typeof CollabTicketRequest>;

export const CollabTicketResponse = z.object({
  ticket: z.string(),
  expiresAt: IsoDate,
  /** `collabDocumentName(documentId, generation)` — the provider's document name. */
  documentName: z.string(),
  generation: z.number().int().min(1),
  role: EffectiveRole,
  /** Identity the server will stamp on this connection's presence. */
  participant: Participant,
  /** When the underlying access ends on its own, if it does. */
  accessExpiresAt: IsoDate.nullable(),
});
export type CollabTicketResponse = z.infer<typeof CollabTicketResponse>;

// ── Assets ──────────────────────────────────────────────────────────────────

/**
 * `POST /api/documents/:documentId/assets` — `multipart/form-data` with one
 * part named `file`. Requires edit access. Response: `AssetResponse`.
 * `GET /api/documents/:documentId/assets/:assetId` — bytes (view access).
 * Images are served inline with their verified type; everything else as a download.
 */
export const AssetResponse = z.object({ asset: Asset });
export type AssetResponse = z.infer<typeof AssetResponse>;

export function assetPath(documentId: string, assetId: string): string {
  return `/api/documents/${documentId}/assets/${assetId}`;
}

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * `GET /api/documents/:documentId/export?format=` (view access).
 * - `txt`: plain text.
 * - `md`: Markdown; images are referenced as `assets/<file>`.
 * - `md-zip`: zip with `document.md` and an `assets/` folder holding the images.
 * - `json`: the ProseMirror JSON (used by the print view and for backups).
 */
export const ExportFormat = z.enum(['txt', 'md', 'md-zip', 'json']);
export type ExportFormat = z.infer<typeof ExportFormat>;
export const ExportQuery = z.object({ format: ExportFormat });

// ── Snapshots (admin) ───────────────────────────────────────────────────────

/** `GET /api/documents/:documentId/snapshots` */
export const SnapshotsResponse = z.object({ snapshots: z.array(Snapshot) });
export type SnapshotsResponse = z.infer<typeof SnapshotsResponse>;

/** `POST /api/documents/:documentId/snapshots` */
export const CreateSnapshotRequest = z.object({
  name: z.string().trim().min(1).max(L.snapshotNameMaxLength),
});
export type CreateSnapshotRequest = z.infer<typeof CreateSnapshotRequest>;
export const SnapshotResponse = z.object({ snapshot: Snapshot });
export type SnapshotResponse = z.infer<typeof SnapshotResponse>;

/**
 * `POST /api/documents/:documentId/snapshots/:snapshotId/restore`.
 * Starts a new generation from the snapshot. A `pre_restore` snapshot of the
 * abandoned state is created automatically and returned.
 */
export const RestoreSnapshotResponse = z.object({
  document: DocumentSummary,
  preRestoreSnapshot: Snapshot,
});
export type RestoreSnapshotResponse = z.infer<typeof RestoreSnapshotResponse>;

/** `DELETE /api/documents/:documentId/snapshots/:snapshotId` */

// ── Desktop handoff ─────────────────────────────────────────────────────────

/**
 * `POST /api/documents/:documentId/desktop-handoff` (any principal with access).
 * Creates a single-use code valid for 60 seconds. `url` is the
 * `realtimedocs://open?...` deep link for "Open in Desktop".
 */
export const DesktopHandoffResponse = z.object({
  code: z.string(),
  url: z.string(),
  expiresAt: IsoDate,
});
export type DesktopHandoffResponse = z.infer<typeof DesktopHandoffResponse>;

/** `POST /api/desktop/redeem` (public, rate limited). */
export const DesktopRedeemRequest = z.object({ documentId: Id, code: Secret });
export type DesktopRedeemRequest = z.infer<typeof DesktopRedeemRequest>;

/** Document-scoped desktop session. Derived from the principal that created the handoff. */
export const DesktopSessionResponse = z.object({
  token: z.string().optional(),
  documentId: Id,
  title: z.string(),
  role: EffectiveRole,
  expiresAt: IsoDate.nullable(),
  /** Null for share-link guests. */
  accountId: Id.nullable(),
});
export type DesktopSessionResponse = z.infer<typeof DesktopSessionResponse>;

/**
 * `GET /api/desktop/session` (bearer) → `DesktopSessionResponse` without `token`.
 * `POST /api/desktop/logout` (bearer) → 204; revokes the desktop session.
 */

// ── Audit (admin) ───────────────────────────────────────────────────────────

/** `GET /api/audit?limit=` */
export const AuditResponse = z.object({ events: z.array(AuditEvent) });
export type AuditResponse = z.infer<typeof AuditResponse>;

// ── Desktop downloads ───────────────────────────────────────────────────────────────────────

export const DownloadPlatform = z.enum(['windows', 'macos', 'linux']);
export type DownloadPlatform = z.infer<typeof DownloadPlatform>;
export const DownloadArch = z.enum(['x64', 'arm64', 'universal']);
export type DownloadArch = z.infer<typeof DownloadArch>;

/** One published desktop build, described from the file the server actually holds. */
export const DownloadArtifact = z.object({
  /** One of the fixed names served at `GET /download/<file>`. */
  file: z.string(),
  platform: DownloadPlatform,
  arch: DownloadArch,
  bytes: z.number().int().nonnegative(),
  /** Lower-case hex SHA-256 of the file, computed by the server. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  modifiedAt: IsoDate,
  /** Relative URL to download it from. */
  url: z.string(),
});
export type DownloadArtifact = z.infer<typeof DownloadArtifact>;

/**
 * `GET /api/downloads` (public) — the desktop builds this server publishes.
 *
 * Built from the files present in `DOWNLOAD_DIR`; nothing is listed that cannot be downloaded.
 * `release` comes from an optional `release.json` in the same directory written by the operator
 * (`{ "version": "...", "notes": "...", "signed": false }`). An empty `artifacts` list means
 * "release not published"; the web app then says so instead of offering a link.
 */
export const DownloadsResponse = z.object({
  release: z
    .object({
      version: z.string().max(64).nullable(),
      notes: z.string().max(2000).nullable(),
      /** Whether the operator states the builds are code-signed. Never inferred by the server. */
      signed: z.boolean().nullable(),
    })
    .nullable(),
  artifacts: z.array(DownloadArtifact),
});
export type DownloadsResponse = z.infer<typeof DownloadsResponse>;
