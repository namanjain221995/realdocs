/**
 * Service API contracts (`/api/v1/*`): API keys, interview sessions and
 * webhooks. The server validates requests with these schemas, builds the
 * OpenAPI document from them (`GET /api/openapi.json`) and the web app (admin
 * pages and developer portal) parses responses with them.
 *
 * Identifiers are bare UUIDs everywhere, like every other id in the product
 * (docs/decisions.md, "Identifiers in the service API").
 */
import { z } from './zod';
import { DEFAULT_LIMITS } from './limits';
import { Id, IsoDate } from './models';

// ── Scopes and API keys ─────────────────────────────────────────────────────

export const SERVICE_SCOPES = [
  'sessions:create',
  'sessions:read',
  'sessions:update',
  'sessions:close',
  'documents:read',
  'documents:history:read',
  'webhooks:manage',
] as const;
export const ServiceScope = z.enum(SERVICE_SCOPES);
export type ServiceScope = z.infer<typeof ServiceScope>;

export const SERVICE_SCOPE_DESCRIPTIONS: Record<ServiceScope, string> = {
  'sessions:create': 'Create interview sessions.',
  'sessions:read': 'List and read interview sessions and their participants.',
  'sessions:update': 'Change a session, add or remove participants, rotate links.',
  'sessions:close': 'Start, complete, cancel and archive sessions.',
  'documents:read': 'Read the document content of a session.',
  'documents:history:read': 'Read the audit trail of a session and its document.',
  'webhooks:manage': 'Create, change and delete webhook endpoints; read and retry deliveries.',
};

export const ApiKeyState = z.enum(['active', 'expired', 'revoked']);
export type ApiKeyState = z.infer<typeof ApiKeyState>;

/** An API key as listed. The secret is never part of this object. */
export const ApiKey = z.object({
  id: Id,
  name: z.string(),
  /** `rdk_` plus eight characters: identifies the key in lists and logs. */
  keyPrefix: z.string(),
  scopes: z.array(ServiceScope),
  allowedCidrs: z.array(z.string()).nullable(),
  state: ApiKeyState,
  expiresAt: IsoDate.nullable(),
  lastUsedAt: IsoDate.nullable(),
  createdAt: IsoDate,
  createdByName: z.string().nullable(),
  revokedAt: IsoDate.nullable(),
  rotatedFrom: Id.nullable(),
});
export type ApiKey = z.infer<typeof ApiKey>;

const Cidr = z.string().trim().min(3).max(64);

export const CreateApiKeyRequest = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(ServiceScope).min(1).max(SERVICE_SCOPES.length),
  expiresAt: IsoDate.nullish(),
  allowedCidrs: z.array(Cidr).min(1).max(20).nullish(),
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequest>;

/** Returned once, at creation and rotation: `secret` is the only time the full key is visible. */
export const ApiKeyWithSecret = z.object({ key: ApiKey, secret: z.string() });
export type ApiKeyWithSecret = z.infer<typeof ApiKeyWithSecret>;

export const ApiKeysResponse = z.object({ keys: z.array(ApiKey) });
export type ApiKeysResponse = z.infer<typeof ApiKeysResponse>;

export const ApiKeyResponse = z.object({ key: ApiKey });
export type ApiKeyResponse = z.infer<typeof ApiKeyResponse>;

// ── Errors of the v1 envelope ───────────────────────────────────────────────

export const V1ErrorCode = z.enum([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_IN_PROGRESS',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'SESSION_CLOSED',
  'SERVICE_UNAVAILABLE',
  'RELEASE_NOT_AVAILABLE',
  'INTERNAL',
]);
export type V1ErrorCode = z.infer<typeof V1ErrorCode>;

export const V1ErrorBody = z.object({
  error: z.object({
    code: V1ErrorCode,
    message: z.string(),
    requestId: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type V1ErrorBody = z.infer<typeof V1ErrorBody>;

// ── Interview sessions ──────────────────────────────────────────────────────

export const InterviewStatus = z.enum([
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
  'archived',
]);
export type InterviewStatus = z.infer<typeof InterviewStatus>;

export const ParticipantRole = z.enum(['candidate', 'interviewer']);
export type ParticipantRole = z.infer<typeof ParticipantRole>;

const PersonName = z.string().trim().min(1).max(120);
const PersonEmail = z.email().max(DEFAULT_LIMITS.emailMaxLength);

export const PersonInput = z.object({ name: PersonName, email: PersonEmail });
export type PersonInput = z.infer<typeof PersonInput>;

export function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const Timezone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isIanaTimezone, { message: 'Must be an IANA time zone such as Asia/Kolkata.' });

const OffsetDateTime = z.iso.datetime({ offset: true });

/** Longest lifetime of a session's links. */
export const MAX_SESSION_LIFETIME_DAYS = 90;

const FutureWithinLimit = OffsetDateTime.refine((value) => new Date(value).getTime() > Date.now(), {
  message: 'Must be in the future.',
}).refine(
  (value) => new Date(value).getTime() <= Date.now() + MAX_SESSION_LIFETIME_DAYS * 86_400_000,
  { message: `Must be at most ${MAX_SESSION_LIFETIME_DAYS} days from now.` },
);

export const SessionPermissions = z.object({
  candidateCanEdit: z.boolean().default(true),
  interviewerCanEdit: z.boolean().default(true),
  candidateCanExport: z.boolean().default(false),
  candidateCanShare: z.boolean().default(false),
  candidateCanViewHistory: z.boolean().default(false),
});
export type SessionPermissions = z.infer<typeof SessionPermissions>;

export const DEFAULT_SESSION_PERMISSIONS: SessionPermissions = SessionPermissions.parse({});

export const SessionMetadata = z
  .record(z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), z.string().max(256))
  .refine((value) => Object.keys(value).length <= 20, { message: 'At most 20 keys.' });
export type SessionMetadata = z.infer<typeof SessionMetadata>;

/**
 * A round number as the API takes it: a string of digits ("2"). A JSON number is still accepted
 * for callers written against the first version of the API. Stored as an integer from 1 to 99.
 */
export const RoundNumberInput = z
  .union([
    z
      .string()
      .trim()
      .regex(/^[0-9]{1,2}$/, { message: 'Must be a whole number from 1 to 99, as a string.' }),
    z.number().int(),
  ])
  .transform((value) => Number(value))
  .pipe(z.number().int().min(1).max(99));

export const RoundInput = z.object({
  number: RoundNumberInput,
  name: z.string().trim().min(1).max(120).optional(),
});

export const CreateInterviewSessionRequest = z.object({
  candidate: PersonInput,
  interviewers: z.array(PersonInput).min(1).max(20),
  companyName: z.string().trim().min(1).max(120),
  round: RoundInput,
  scheduledAt: OffsetDateTime,
  timezone: Timezone,
  expiresAt: FutureWithinLimit,
  permissions: SessionPermissions.default(DEFAULT_SESSION_PERMISSIONS),
  metadata: SessionMetadata.optional(),
});
export type CreateInterviewSessionRequest = z.input<typeof CreateInterviewSessionRequest>;

export const AccessLink = z.object({
  /** `https://<origin>/s/<grantId>#<secret>`. Shown once; it cannot be retrieved again. */
  url: z.string(),
  expiresAt: IsoDate,
});
export type AccessLink = z.infer<typeof AccessLink>;

export const SessionParticipant = z.object({
  participantId: Id,
  role: ParticipantRole,
  name: z.string(),
  email: z.string(),
  firstJoinedAt: IsoDate.nullable(),
  lastJoinedAt: IsoDate.nullable(),
  removedAt: IsoDate.nullable(),
  /** Whether the current link is still usable (not revoked, not expired). */
  linkState: z.enum(['active', 'revoked', 'expired', 'none']),
  /** The state of the document room right now: how many of this person's connections are open. */
  liveConnections: z.number().int().min(0),
  /**
   * True for an interviewer whose address is an account of the workspace that was made a member
   * of the document, so it appears in that person's own documents list. Always false for the
   * candidate.
   */
  accountLinked: z.boolean().optional(),
});
export type SessionParticipant = z.infer<typeof SessionParticipant>;

export const ParticipantWithAccess = z.object({
  participantId: Id,
  role: ParticipantRole,
  name: z.string(),
  email: z.string(),
  access: AccessLink,
  /** See `SessionParticipant.accountLinked`. */
  accountLinked: z.boolean().optional(),
});
export type ParticipantWithAccess = z.infer<typeof ParticipantWithAccess>;

export const InterviewSession = z.object({
  sessionId: Id,
  documentId: Id,
  title: z.string(),
  generatedTitle: z.string(),
  status: InterviewStatus,
  companyName: z.string(),
  /** `number` is a string of digits ("2"), like every value the create request takes. */
  round: z.object({ number: z.string(), name: z.string().nullable() }),
  scheduledAt: IsoDate,
  timezone: z.string(),
  expiresAt: IsoDate,
  permissions: SessionPermissions,
  metadata: z.record(z.string(), z.string()),
  participants: z.array(SessionParticipant),
  adminUrl: z.string(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  startedAt: IsoDate.nullable(),
  completedAt: IsoDate.nullable(),
  cancelledAt: IsoDate.nullable(),
  archivedAt: IsoDate.nullable(),
});
export type InterviewSession = z.infer<typeof InterviewSession>;

export const CreateInterviewSessionResponse = z.object({
  sessionId: Id,
  documentId: Id,
  title: z.string(),
  status: z.literal('scheduled'),
  candidateAccess: AccessLink,
  /** The first interviewer's link. Every participant's link is in `participants`. */
  interviewerAccess: AccessLink,
  participants: z.array(ParticipantWithAccess),
  adminUrl: z.string(),
  createdAt: IsoDate,
});
export type CreateInterviewSessionResponse = z.infer<typeof CreateInterviewSessionResponse>;

export const UpdateInterviewSessionRequest = z
  .object({
    scheduledAt: OffsetDateTime,
    timezone: Timezone,
    expiresAt: FutureWithinLimit,
    permissions: SessionPermissions.partial(),
    companyName: z.string().trim().min(1).max(120),
    round: z.object({
      number: RoundNumberInput.optional(),
      name: z.string().trim().min(1).max(120).nullable().optional(),
    }),
    /** Replaces the metadata object as a whole. */
    metadata: SessionMetadata,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to change.' });
export type UpdateInterviewSessionRequest = z.infer<typeof UpdateInterviewSessionRequest>;

export const ListInterviewSessionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: InterviewStatus.optional(),
  candidateEmail: z.string().trim().min(1).max(254).optional(),
  interviewerEmail: z.string().trim().min(1).max(254).optional(),
  company: z.string().trim().min(1).max(120).optional(),
  round: z.coerce.number().int().min(1).max(99).optional(),
  from: OffsetDateTime.optional(),
  to: OffsetDateTime.optional(),
  q: z.string().trim().min(1).max(200).optional(),
});
export type ListInterviewSessionsQuery = z.infer<typeof ListInterviewSessionsQuery>;

export const InterviewSessionsPage = z.object({
  items: z.array(InterviewSession),
  nextCursor: z.string().nullable(),
});
export type InterviewSessionsPage = z.infer<typeof InterviewSessionsPage>;

export const AddParticipantRequest = z.object({
  role: z.literal('interviewer').default('interviewer'),
  name: PersonName,
  email: PersonEmail,
});
export type AddParticipantRequest = z.input<typeof AddParticipantRequest>;

export const AddParticipantResponse = z.object({
  sessionId: Id,
  participant: ParticipantWithAccess,
});
export type AddParticipantResponse = z.infer<typeof AddParticipantResponse>;

export const RotateLinksRequest = z.object({
  participantIds: z.array(Id).min(1).max(21).optional(),
});
export type RotateLinksRequest = z.infer<typeof RotateLinksRequest>;

export const RotateLinksResponse = z.object({
  sessionId: Id,
  participants: z.array(ParticipantWithAccess),
});
export type RotateLinksResponse = z.infer<typeof RotateLinksResponse>;

export const SessionTransitionResponse = z.object({ session: InterviewSession });
export type SessionTransitionResponse = z.infer<typeof SessionTransitionResponse>;

export const SessionAuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

export const SessionAuditEvent = z.object({
  id: Id,
  at: IsoDate,
  actorKind: z.enum(['user', 'guest', 'system', 'service']),
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type SessionAuditEvent = z.infer<typeof SessionAuditEvent>;

export const SessionAuditPage = z.object({
  items: z.array(SessionAuditEvent),
  nextCursor: z.string().nullable(),
});
export type SessionAuditPage = z.infer<typeof SessionAuditPage>;

export const SessionDocumentResponse = z.object({
  documentId: Id,
  title: z.string(),
  status: z.enum(['active', 'archived', 'trashed']),
  updatedAt: IsoDate,
  contentUpdatedAt: IsoDate,
  /** ProseMirror JSON of the document as collaborators see it right now. */
  content: z.record(z.string(), z.unknown()),
});
export type SessionDocumentResponse = z.infer<typeof SessionDocumentResponse>;

// ── Webhooks ────────────────────────────────────────────────────────────────

export const WEBHOOK_EVENTS = [
  'session.created',
  'participant.joined',
  'document.first_edited',
  'session.started',
  'session.completed',
  'session.cancelled',
  'access.revoked',
] as const;
export const WebhookEventType = z.enum(WEBHOOK_EVENTS);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

export const WebhookEndpoint = z.object({
  id: Id,
  url: z.string(),
  events: z.array(WebhookEventType),
  enabled: z.boolean(),
  createdAt: IsoDate,
  disabledAt: IsoDate.nullable(),
});
export type WebhookEndpoint = z.infer<typeof WebhookEndpoint>;

export const CreateWebhookRequest = z.object({
  url: z.string().trim().min(8).max(2048),
  events: z.array(WebhookEventType).min(1).max(WEBHOOK_EVENTS.length),
  enabled: z.boolean().default(true),
});
export type CreateWebhookRequest = z.input<typeof CreateWebhookRequest>;

export const UpdateWebhookRequest = z
  .object({
    url: z.string().trim().min(8).max(2048),
    events: z.array(WebhookEventType).min(1).max(WEBHOOK_EVENTS.length),
    enabled: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to change.' });
export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookRequest>;

/** `secret` is shown once and signs every delivery (`RD-Webhook-Signature`). */
export const WebhookEndpointWithSecret = z.object({
  endpoint: WebhookEndpoint,
  secret: z.string(),
});
export type WebhookEndpointWithSecret = z.infer<typeof WebhookEndpointWithSecret>;

export const WebhookEndpointResponse = z.object({ endpoint: WebhookEndpoint });
export type WebhookEndpointResponse = z.infer<typeof WebhookEndpointResponse>;

export const WebhookEndpointsResponse = z.object({ endpoints: z.array(WebhookEndpoint) });
export type WebhookEndpointsResponse = z.infer<typeof WebhookEndpointsResponse>;

export const WebhookDeliveryStatus = z.enum(['pending', 'delivered', 'failed', 'dead']);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatus>;

export const WebhookDelivery = z.object({
  id: Id,
  endpointId: Id,
  eventId: Id,
  eventType: z.string(),
  status: WebhookDeliveryStatus,
  attempts: z.number().int(),
  nextAttemptAt: IsoDate.nullable(),
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  createdAt: IsoDate,
  deliveredAt: IsoDate.nullable(),
});
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;

export const ListDeliveriesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: WebhookDeliveryStatus.optional(),
});

export const WebhookDeliveriesPage = z.object({
  items: z.array(WebhookDelivery),
  nextCursor: z.string().nullable(),
});
export type WebhookDeliveriesPage = z.infer<typeof WebhookDeliveriesPage>;

export const WebhookDeliveryResponse = z.object({ delivery: WebhookDelivery });
export type WebhookDeliveryResponse = z.infer<typeof WebhookDeliveryResponse>;

/** The JSON body of every webhook delivery. Never contains document content or access secrets. */
export const WebhookEventPayload = z.object({
  id: Id,
  type: WebhookEventType,
  createdAt: IsoDate,
  data: z.record(z.string(), z.unknown()),
});
export type WebhookEventPayload = z.infer<typeof WebhookEventPayload>;
