import type { AccessInfo, DocumentStatus, User } from '@realtimedocs/contracts';
import { describe, expect, it } from 'vitest';
import {
  accountControls,
  dashboardViews,
  documentActions,
  documentCapabilities,
  documentRoleLabel,
  effectiveRoleLabel,
  isWorkspaceAdmin,
  workspaceRoleLabel,
} from '../src/lib/permissions';

const ADMIN: User = {
  id: '11111111-2222-4333-8444-555555555555',
  email: 'asha@example.test',
  displayName: 'Asha Rao',
  role: 'admin',
  status: 'active',
  createdAt: '2026-10-01T09:00:00.000Z',
};
const MEMBER: User = {
  ...ADMIN,
  id: '22222222-3333-4444-8555-666666666666',
  email: 'ben@example.test',
  displayName: 'Ben Ortiz',
  role: 'member',
};

function doc(status: DocumentStatus, access: Partial<AccessInfo>) {
  return {
    status,
    access: {
      role: 'viewer',
      via: 'membership',
      expiresAt: null,
      accountId: MEMBER.id,
      ...access,
    } satisfies AccessInfo,
  };
}

describe('documentCapabilities', () => {
  it('gives a workspace administrator everything on an active document', () => {
    const caps = documentCapabilities(
      doc('active', { role: 'admin', via: 'workspace_admin', accountId: ADMIN.id }),
      ADMIN,
    );
    expect(caps).toEqual({
      isGuest: false,
      canManage: true,
      canRename: true,
      canEdit: true,
      readOnlyReason: null,
      canLeave: false,
    });
  });

  it('lets an assigned editor edit but not manage', () => {
    const caps = documentCapabilities(doc('active', { role: 'editor' }), MEMBER);
    expect(caps.canEdit).toBe(true);
    expect(caps.canManage).toBe(false);
    expect(caps.canRename).toBe(false);
    expect(caps.readOnlyReason).toBeNull();
  });

  it('keeps a viewer read-only', () => {
    const caps = documentCapabilities(doc('active', { role: 'viewer' }), MEMBER);
    expect(caps.canEdit).toBe(false);
    expect(caps.canManage).toBe(false);
    expect(caps.readOnlyReason).toBe('viewer');
  });

  it('treats a share-link visitor without an account as a guest who can leave', () => {
    const caps = documentCapabilities(
      doc('active', { role: 'viewer', via: 'share_link', accountId: null }),
      null,
    );
    expect(caps).toEqual({
      isGuest: true,
      canManage: false,
      canRename: false,
      canEdit: false,
      readOnlyReason: 'viewer',
      canLeave: true,
    });
  });

  it('lets a guest with an edit link edit, and nothing more', () => {
    const caps = documentCapabilities(
      doc('active', { role: 'editor', via: 'share_link', accountId: null }),
      null,
    );
    expect(caps.canEdit).toBe(true);
    expect(caps.canManage).toBe(false);
    expect(caps.canRename).toBe(false);
  });

  it('makes an archived document read-only for everyone while administrators still manage it', () => {
    // The server caps the role at viewer for archived documents.
    const caps = documentCapabilities(
      doc('archived', { role: 'viewer', via: 'workspace_admin', accountId: ADMIN.id }),
      ADMIN,
    );
    expect(caps.canEdit).toBe(false);
    expect(caps.readOnlyReason).toBe('archived');
    expect(caps.canManage).toBe(true);
    expect(caps.canRename).toBe(false);

    const editor = documentCapabilities(doc('archived', { role: 'editor' }), MEMBER);
    expect(editor.canEdit).toBe(false);
    expect(editor.readOnlyReason).toBe('archived');
  });

  it('never derives management from the session alone', () => {
    // An administrator's session with a non-admin access record (which the
    // server would not send) must not unlock admin controls.
    const caps = documentCapabilities(doc('active', { role: 'viewer', via: 'share_link' }), ADMIN);
    expect(caps.canManage).toBe(false);
  });
});

describe('documentActions', () => {
  it('offers administrators the lifecycle actions that fit the status', () => {
    expect(documentActions('active', ADMIN)).toEqual([
      'open',
      'rename',
      'duplicate',
      'archive',
      'trash',
    ]);
    expect(documentActions('archived', ADMIN)).toEqual(['open', 'duplicate', 'unarchive', 'trash']);
    expect(documentActions('trashed', ADMIN)).toEqual(['restore', 'delete']);
  });

  it('offers members nothing but opening', () => {
    expect(documentActions('active', MEMBER)).toEqual(['open']);
    expect(documentActions('archived', MEMBER)).toEqual(['open']);
    expect(documentActions('trashed', MEMBER)).toEqual([]);
    expect(documentActions('active', null)).toEqual(['open']);
  });

  it('does not treat a disabled administrator as an administrator', () => {
    const disabled: User = { ...ADMIN, status: 'disabled' };
    expect(isWorkspaceAdmin(disabled)).toBe(false);
    expect(documentActions('active', disabled)).toEqual(['open']);
  });
});

describe('dashboardViews', () => {
  it('shows Trash to administrators only', () => {
    expect(dashboardViews(ADMIN)).toEqual(['active', 'recent', 'archived', 'trash']);
    expect(dashboardViews(MEMBER)).toEqual(['active', 'recent', 'archived']);
    expect(dashboardViews(null)).toEqual(['active', 'recent', 'archived']);
  });
});

describe('accountControls', () => {
  it('lets an administrator change other accounts', () => {
    expect(accountControls(MEMBER, ADMIN)).toEqual({
      canChangeRole: true,
      canChangeStatus: true,
      reason: null,
    });
  });

  it('never lets an administrator demote or disable themselves', () => {
    const controls = accountControls(ADMIN, ADMIN);
    expect(controls.canChangeRole).toBe(false);
    expect(controls.canChangeStatus).toBe(false);
    expect(controls.reason).toMatch(/your own/);
  });

  it('gives members no account controls at all', () => {
    expect(accountControls(ADMIN, MEMBER).canChangeRole).toBe(false);
    expect(accountControls(MEMBER, MEMBER).canChangeStatus).toBe(false);
    expect(accountControls(MEMBER, null).canChangeStatus).toBe(false);
  });
});

describe('labels', () => {
  it('names roles the way the interface shows them', () => {
    expect(effectiveRoleLabel('admin')).toBe('Admin');
    expect(effectiveRoleLabel('editor')).toBe('Editor');
    expect(effectiveRoleLabel('viewer')).toBe('Viewer');
    expect(documentRoleLabel('viewer')).toBe('View only');
    expect(documentRoleLabel('editor')).toBe('Can edit');
    expect(workspaceRoleLabel('admin')).toBe('Administrator');
    expect(workspaceRoleLabel('member')).toBe('Member');
  });
});
