import type { DocumentRole, EffectiveRole, WorkspaceRole } from '@realtimedocs/contracts';
import { Badge, type BadgeProps } from '@realtimedocs/ui';
import { documentRoleLabel, effectiveRoleLabel, workspaceRoleLabel } from '../lib/permissions';

type Rest = Omit<BadgeProps, 'tone' | 'children'>;

/** The role the server resolved for the current principal on a document. */
export function RoleBadge({ role, ...rest }: { role: EffectiveRole } & Rest) {
  const tone = role === 'admin' ? 'accent' : role === 'editor' ? 'info' : 'neutral';
  return (
    <Badge tone={tone} data-role={role} {...rest}>
      {effectiveRoleLabel(role)}
    </Badge>
  );
}

/** What a membership or share link grants. Edit access stands out; view-only is the quiet default. */
export function GrantBadge({ role, ...rest }: { role: DocumentRole } & Rest) {
  return (
    <Badge tone={role === 'editor' ? 'warning' : 'neutral'} data-role={role} {...rest}>
      {documentRoleLabel(role)}
    </Badge>
  );
}

export function WorkspaceRoleBadge({ role, ...rest }: { role: WorkspaceRole } & Rest) {
  return (
    <Badge tone={role === 'admin' ? 'accent' : 'neutral'} data-role={role} {...rest}>
      {workspaceRoleLabel(role)}
    </Badge>
  );
}
