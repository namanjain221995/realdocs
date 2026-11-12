import type { AuditActor } from '../audit';

/** Who performs a service operation: an API key, or a signed-in administrator in the admin UI. */
export type OperationActor =
  { kind: 'service'; keyId: string; name: string } | { kind: 'user'; userId: string; name: string };

export function auditActorOf(actor: OperationActor): AuditActor {
  return actor.kind === 'service'
    ? { kind: 'service', name: actor.name }
    : { kind: 'user', userId: actor.userId, name: actor.name };
}
