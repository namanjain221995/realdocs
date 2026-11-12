/**
 * Admin JSON routes of the interview-session API (`/api/admin/*`): API keys, interview sessions
 * and webhooks. Cookie session plus CSRF header, exactly like the other admin calls; every
 * response is parsed with the contract schema. One-time secrets and links are returned to the
 * caller and are never written to the query cache by these functions.
 */
import {
  AddParticipantResponse,
  ApiKeyResponse,
  ApiKeysResponse,
  ApiKeyWithSecret,
  type CreateApiKeyRequest,
  type CreateInterviewSessionRequest,
  CreateInterviewSessionResponse,
  type CreateWebhookRequest,
  InterviewSession,
  InterviewSessionsPage,
  type AddParticipantRequest,
  type ListInterviewSessionsQuery,
  RotateLinksResponse,
  SessionAuditPage,
  SessionDocumentResponse,
  type UpdateInterviewSessionRequest,
  type UpdateWebhookRequest,
  WebhookDeliveriesPage,
  WebhookDeliveryResponse,
  type WebhookDeliveryStatus,
  WebhookEndpointResponse,
  WebhookEndpointsResponse,
  WebhookEndpointWithSecret,
} from '@realtimedocs/contracts';
import { api } from '../../lib/api';

const KEYS = '/api/admin/api-keys';
const SESSIONS = '/api/admin/interview-sessions';
const HOOKS = '/api/admin/webhooks';

export type SessionAction = 'start' | 'complete' | 'cancel';
export type SessionListFilters = Partial<
  Pick<
    ListInterviewSessionsQuery,
    'status' | 'candidateEmail' | 'interviewerEmail' | 'company' | 'round' | 'from' | 'to' | 'q'
  >
>;

export const serviceApi = {
  apiKeys: {
    list: () => api.request('GET', KEYS, { schema: ApiKeysResponse }),
    create: (body: CreateApiKeyRequest) =>
      api.request('POST', KEYS, { body, schema: ApiKeyWithSecret }),
    rotate: (id: string) =>
      api.request('POST', `${KEYS}/${id}/rotate`, { schema: ApiKeyWithSecret }),
    revoke: (id: string) => api.request('POST', `${KEYS}/${id}/revoke`, { schema: ApiKeyResponse }),
  },
  sessions: {
    list: (filters: SessionListFilters, cursor?: string, limit = 25) =>
      api.request('GET', SESSIONS, {
        query: { ...filters, cursor, limit },
        schema: InterviewSessionsPage,
      }),
    create: (body: CreateInterviewSessionRequest) =>
      api.request('POST', SESSIONS, { body, schema: CreateInterviewSessionResponse }),
    get: (id: string) => api.request('GET', `${SESSIONS}/${id}`, { schema: InterviewSession }),
    update: (id: string, body: UpdateInterviewSessionRequest) =>
      api.request('PATCH', `${SESSIONS}/${id}`, { body, schema: InterviewSession }),
    transition: (id: string, action: SessionAction) =>
      api.request('POST', `${SESSIONS}/${id}/${action}`, { schema: InterviewSession }),
    archive: (id: string) =>
      api.request('DELETE', `${SESSIONS}/${id}`, { schema: InterviewSession }),
    addParticipant: (id: string, body: AddParticipantRequest) =>
      api.request('POST', `${SESSIONS}/${id}/participants`, {
        body,
        schema: AddParticipantResponse,
      }),
    removeParticipant: (id: string, participantId: string) =>
      api.request('DELETE', `${SESSIONS}/${id}/participants/${participantId}`, {
        schema: InterviewSession,
      }),
    rotateLinks: (id: string, participantIds?: string[]) =>
      api.request('POST', `${SESSIONS}/${id}/rotate-links`, {
        body: participantIds ? { participantIds } : {},
        schema: RotateLinksResponse,
      }),
    audit: (id: string, cursor?: string, limit = 50) =>
      api.request('GET', `${SESSIONS}/${id}/audit`, {
        query: { cursor, limit },
        schema: SessionAuditPage,
      }),
    document: (id: string) =>
      api.request('GET', `${SESSIONS}/${id}/document`, { schema: SessionDocumentResponse }),
  },
  webhooks: {
    list: () => api.request('GET', HOOKS, { schema: WebhookEndpointsResponse }),
    create: (body: CreateWebhookRequest) =>
      api.request('POST', HOOKS, { body, schema: WebhookEndpointWithSecret }),
    update: (id: string, body: UpdateWebhookRequest) =>
      api.request('PATCH', `${HOOKS}/${id}`, { body, schema: WebhookEndpointResponse }),
    remove: (id: string) => api.request('DELETE', `${HOOKS}/${id}`),
    deliveries: (id: string, status: WebhookDeliveryStatus | '', cursor?: string, limit = 25) =>
      api.request('GET', `${HOOKS}/${id}/deliveries`, {
        query: { status: status || undefined, cursor, limit },
        schema: WebhookDeliveriesPage,
      }),
    retry: (deliveryId: string) =>
      api.request('POST', `${HOOKS}/deliveries/${deliveryId}/retry`, {
        schema: WebhookDeliveryResponse,
      }),
  },
};
