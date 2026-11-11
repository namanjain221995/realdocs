import { z } from './zod';

/** Workspace-level account role. */
export const WorkspaceRole = z.enum(['admin', 'member']);
export type WorkspaceRole = z.infer<typeof WorkspaceRole>;

/** Role that can be granted on one document (membership or share link). */
export const DocumentRole = z.enum(['viewer', 'editor']);
export type DocumentRole = z.infer<typeof DocumentRole>;

/**
 * Role the server resolved for a principal on a document. `admin` implies
 * editing plus management. Clients never choose this value; it is always
 * derived server-side from the session and current grants.
 */
export const EffectiveRole = z.enum(['viewer', 'editor', 'admin']);
export type EffectiveRole = z.infer<typeof EffectiveRole>;

/** Which independent permission produced the effective role. */
export const AccessVia = z.enum(['workspace_admin', 'membership', 'share_link']);
export type AccessVia = z.infer<typeof AccessVia>;

const RANK: Record<EffectiveRole, number> = { viewer: 1, editor: 2, admin: 3 };

export function roleRank(role: EffectiveRole): number {
  return RANK[role];
}

export function canEdit(role: EffectiveRole): boolean {
  return role === 'editor' || role === 'admin';
}

export function canManage(role: EffectiveRole): boolean {
  return role === 'admin';
}

export function maxRole(a: EffectiveRole, b: EffectiveRole): EffectiveRole {
  return roleRank(a) >= roleRank(b) ? a : b;
}
