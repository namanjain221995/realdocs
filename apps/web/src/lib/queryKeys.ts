import type { DocumentListView } from '@realtimedocs/contracts';

/**
 * Query keys in one place, so invalidation after a change cannot miss a list.
 * Keys never contain secrets (share or invitation secrets, handoff codes).
 *
 * `['documents', …]` are dashboard lists. `['document', id]` is one document's
 * summary and `['document', id, …]` its sub-resources, so invalidating
 * `['document', id]` refreshes everything about that document.
 */
export const queryKeys = {
  meta: ['meta'] as const,
  desktopRelease: ['desktop-release'] as const,
  adminReleases: ['admin-releases'] as const,
  documentLists: ['documents'] as const,
  documentList: (view: DocumentListView, search: string) => ['documents', view, search] as const,
  document: (documentId: string) => ['document', documentId] as const,
  members: (documentId: string) => ['document', documentId, 'members'] as const,
  shares: (documentId: string) => ['document', documentId, 'shares'] as const,
  access: (documentId: string) => ['document', documentId, 'access'] as const,
  snapshots: (documentId: string) => ['document', documentId, 'snapshots'] as const,
  users: ['users'] as const,
  invitations: ['invitations'] as const,
  audit: ['audit'] as const,
  apiKeys: ['api-keys'] as const,
  interviewSessions: (filters: unknown) => ['interview-sessions', 'list', filters] as const,
  interviewSession: (sessionId: string) => ['interview-sessions', 'one', sessionId] as const,
  interviewSessionAudit: (sessionId: string) => ['interview-sessions', 'audit', sessionId] as const,
  webhooks: ['webhooks'] as const,
  webhookDeliveries: (endpointId: string, status: string) =>
    ['webhooks', 'deliveries', endpointId, status] as const,
  recoveryDrafts: (accountId: string) => ['recovery-drafts', accountId] as const,
};
