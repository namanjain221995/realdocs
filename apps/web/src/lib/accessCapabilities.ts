/**
 * Server-provided capability flags of a document's `access` payload.
 *
 * Interview participants get a restricted set (no export, no history, no desktop hand-off).
 * The server decides and enforces; this only hides controls that would be refused anyway.
 * An absent `capabilities` object (older servers, ordinary accounts) means "everything the
 * role allows", so each flag is `false` only when the server said so explicitly.
 */
import type { AccessInfo } from '@realtimedocs/contracts';

export interface AccessFlags {
  canExport: boolean;
  canViewHistory: boolean;
  canShare: boolean;
  canUseDesktop: boolean;
}

export function accessFlags(
  access: Pick<AccessInfo, 'capabilities'> | null | undefined,
): AccessFlags {
  const capabilities = access?.capabilities;
  return {
    canExport: capabilities?.canExport !== false,
    canViewHistory: capabilities?.canViewHistory !== false,
    canShare: capabilities?.canShare !== false,
    canUseDesktop: capabilities?.canUseDesktop !== false,
  };
}

/** "Aarav — Candidate" when the server labelled the person's interview role, else the name. */
export function nameWithRole(name: string, roleLabel: string | null | undefined): string {
  return roleLabel ? `${name} — ${roleLabel}` : name;
}
