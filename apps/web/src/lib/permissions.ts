/**
 * What the interface offers to whom. These helpers only decide what to show;
 * the server authorizes every request on its own and nothing here is trusted
 * by it. Inputs are always server-resolved values (`access` on a document,
 * the session's user).
 */
import {
  type AccessInfo,
  canEdit as roleCanEdit,
  type DocumentListView,
  type DocumentRole,
  type DocumentStatus,
  type EffectiveRole,
  type User,
  type WorkspaceRole,
} from '@realtimedocs/contracts';

export function isWorkspaceAdmin(user: User | null | undefined): boolean {
  return user?.role === 'admin' && user.status === 'active';
}

export interface DocumentCapabilities {
  /** No account: reached the document through a share link only. */
  isGuest: boolean;
  /** Sharing, snapshots and lifecycle actions. */
  canManage: boolean;
  /** Title changes (administrators, while the document is active). */
  canRename: boolean;
  /** The server lets this principal change content right now. */
  canEdit: boolean;
  /** Why the document is read-only for this principal, if it is. */
  readOnlyReason: 'viewer' | 'archived' | null;
  /** Access comes from a share link, so the share session can be ended from here. */
  canLeave: boolean;
}

export function documentCapabilities(
  document: { status: DocumentStatus; access: AccessInfo },
  user: User | null,
): DocumentCapabilities {
  const { access, status } = document;
  // Archived documents cap everyone's role at viewer, so management is keyed on
  // how access was granted as well as on the resolved role.
  const canManage = access.role === 'admin' || access.via === 'workspace_admin';
  const active = status === 'active';
  let readOnlyReason: DocumentCapabilities['readOnlyReason'] = null;
  if (status === 'archived') readOnlyReason = 'archived';
  else if (!roleCanEdit(access.role)) readOnlyReason = 'viewer';
  return {
    isGuest: user === null,
    canManage,
    canRename: canManage && active,
    canEdit: active && roleCanEdit(access.role),
    readOnlyReason,
    canLeave: access.via === 'share_link',
  };
}

export type DocumentAction =
  'open' | 'rename' | 'duplicate' | 'archive' | 'unarchive' | 'trash' | 'restore' | 'delete';

/** Actions the dashboard offers for one row, in display order. */
export function documentActions(status: DocumentStatus, user: User | null): DocumentAction[] {
  const admin = isWorkspaceAdmin(user);
  switch (status) {
    case 'active':
      return admin ? ['open', 'rename', 'duplicate', 'archive', 'trash'] : ['open'];
    case 'archived':
      return admin ? ['open', 'duplicate', 'unarchive', 'trash'] : ['open'];
    case 'trashed':
      // A trashed document cannot be opened by anyone until it is restored.
      return admin ? ['restore', 'delete'] : [];
  }
}

/** Dashboard views. Trash is an administrator's recovery area. */
export function dashboardViews(user: User | null): DocumentListView[] {
  return isWorkspaceAdmin(user)
    ? ['active', 'recent', 'archived', 'trash']
    : ['active', 'recent', 'archived'];
}

export interface AccountControls {
  canChangeRole: boolean;
  canChangeStatus: boolean;
  /** Shown next to disabled controls. */
  reason: string | null;
}

/** An administrator cannot demote or disable their own account. */
export function accountControls(target: User, self: User | null): AccountControls {
  if (!isWorkspaceAdmin(self)) {
    return {
      canChangeRole: false,
      canChangeStatus: false,
      reason: 'Only administrators manage accounts.',
    };
  }
  if (self && target.id === self.id) {
    return {
      canChangeRole: false,
      canChangeStatus: false,
      reason: 'You cannot change your own role or disable your own account.',
    };
  }
  return { canChangeRole: true, canChangeStatus: true, reason: null };
}

export function effectiveRoleLabel(role: EffectiveRole): string {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'editor':
      return 'Editor';
    case 'viewer':
      return 'Viewer';
  }
}

/** Wording for a grant (membership or share link). */
export function documentRoleLabel(role: DocumentRole): string {
  return role === 'editor' ? 'Can edit' : 'View only';
}

export function workspaceRoleLabel(role: WorkspaceRole): string {
  return role === 'admin' ? 'Administrator' : 'Member';
}
