/** Database rows → contract models. */
import type {
  Invitation,
  InvitationState,
  Member,
  SessionResponse,
  ShareGrant,
  ShareGrantState,
  Snapshot,
  User,
} from '@realtimedocs/contracts';
import { csrfTokenFor } from '../auth/tokens';
import type { AppContext } from '../context';
import type { GrantRow, SessionRow, SnapshotRow, UserRow } from '../db/rows';

export function toApiUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toSessionResponse(
  ctx: AppContext,
  user: UserRow,
  session: SessionRow,
): SessionResponse {
  return {
    user: toApiUser(user),
    csrfToken: csrfTokenFor(session.id, ctx.config.sessionSecret),
    expiresAt: session.expiresAt.toISOString(),
  };
}

export const SIGNED_OUT: SessionResponse = { user: null, csrfToken: null, expiresAt: null };

export interface MemberRow {
  userId: string;
  email: string;
  displayName: string;
  role: 'viewer' | 'editor';
  userStatus: 'active' | 'disabled';
  grantedAt: Date;
}

export function toApiMember(row: MemberRow): Member {
  return { ...row, grantedAt: row.grantedAt.toISOString() };
}

export function grantState(row: GrantRow, now: number = Date.now()): ShareGrantState {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= now) return 'expired';
  return 'active';
}

export function toApiShare(
  row: GrantRow,
  activeSessions: number,
  liveConnections: number,
): ShareGrant {
  return {
    id: row.id,
    documentId: row.documentId,
    role: row.role,
    label: row.label,
    state: grantState(row),
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    activeSessions,
    liveConnections,
  };
}

export interface InvitationRow {
  id: string;
  email: string | null;
  role: 'admin' | 'member';
  createdAt: Date;
  createdByName: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByName: string | null;
  revokedAt: Date | null;
}

export function invitationState(row: InvitationRow, now: number = Date.now()): InvitationState {
  if (row.acceptedAt) return 'accepted';
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now) return 'expired';
  return 'pending';
}

export function toApiInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    state: invitationState(row),
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    acceptedByName: row.acceptedByName,
  };
}

export function toApiSnapshot(row: SnapshotRow): Snapshot {
  return {
    id: row.id,
    documentId: row.documentId,
    name: row.name,
    kind: row.kind,
    generation: row.generation,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
  };
}
