/** Declarations of every `/api/v1` route (see registry.ts). */
import {
  AddParticipantRequest,
  AddParticipantResponse,
  CreateInterviewSessionRequest,
  CreateInterviewSessionResponse,
  CreateWebhookRequest,
  InterviewSession,
  InterviewSessionsPage,
  ListDeliveriesQuery,
  ListInterviewSessionsQuery,
  RotateLinksRequest,
  RotateLinksResponse,
  SessionAuditPage,
  SessionAuditQuery,
  SessionDocumentResponse,
  UpdateInterviewSessionRequest,
  UpdateWebhookRequest,
  VersionHistoryGroupingQuery,
  VersionHistoryImagesResponse,
  VersionHistoryQuery,
  VersionHistoryResponse,
  WebhookDeliveriesPage,
  WebhookDeliveryResponse,
  WebhookEndpointResponse,
  WebhookEndpointWithSecret,
  WebhookEndpointsResponse,
} from '@realtimedocs/contracts';
import { z } from 'zod';
import { tryAudit } from '../audit';
import type { AppContext } from '../context';
import {
  versionHistoryArchive,
  versionHistoryDocument,
  versionHistoryImage,
  versionHistoryImages,
  type VersionHistoryTarget,
} from '../history/version-history-responses';
import { auditActorOf, type OperationActor } from './actor';
import { route, type ServiceRoute } from './registry';
import {
  addParticipant,
  createSession,
  getSession,
  listSessions,
  removeParticipant,
  rotateLinks,
  sessionAuditTrail,
  sessionDocument,
  sessionDocumentRef,
  transitionSession,
  updateSession,
  workspaceDocumentRef,
} from './sessions';
import {
  exampleCreateRequest,
  exampleCreateResponse,
  exampleDelivery,
  exampleIds,
  exampleSession,
  exampleVersionHistory,
  exampleWebhookEndpoint,
} from './v1-examples';
import {
  createEndpoint,
  deleteEndpoint,
  getEndpoint,
  listDeliveries,
  listEndpoints,
  retryDelivery,
  updateEndpoint,
} from './webhooks';

const IdParam = z.object({ id: z.string().describe('Identifier (UUID).') });
const ParticipantParams = z.object({
  id: z.string().describe('Session identifier (UUID).'),
  participantId: z.string().describe('Participant identifier (UUID).'),
});
const DeliveryParam = z.object({ deliveryId: z.string().describe('Delivery identifier (UUID).') });

const SESSIONS = 'Interview sessions';
const WEBHOOKS = 'Webhooks';
const HISTORY = 'Version history';

const ImageParams = z.object({
  id: z.string().describe('Identifier (UUID).'),
  imageId: z.string().describe('Image identifier (UUID), as printed in `[IMAGE <id>]`.'),
});

const HISTORY_SCOPE = 'documents:history:read';
const HISTORY_FORMAT =
  'Numbered versions, each with the editor, the time, the lines added and removed and the whole text at that ' +
  'point. A version is one stretch of work by one editor: a new one starts when the editor changes, after a pause ' +
  'longer than `gapSeconds`, or when it would cover more than `maxSpanSeconds`. An image is a line ' +
  '`[IMAGE <id>] images/<file name>`; fetch its bytes from the images endpoint or take the archive.';

/** Where the version history of a document is reached, by its document id or by its session id. */
const HISTORY_OWNERS = [
  {
    key: 'Document',
    base: '/documents/:id',
    what: 'a document',
    resolve: (ctx: AppContext, id: string) => workspaceDocumentRef(ctx, id),
    adminView: undefined,
  },
  {
    key: 'InterviewSession',
    base: '/interview-sessions/:id',
    what: 'the document of an interview session',
    resolve: (ctx: AppContext, id: string) => sessionDocumentRef(ctx, id),
    adminView: 'document' as const,
  },
] as const;

function versionHistoryRoutes(): ServiceRoute[] {
  return HISTORY_OWNERS.flatMap((owner) => {
    const target = async (
      ctx: AppContext,
      id: string,
      admin: boolean,
    ): Promise<VersionHistoryTarget> => ({
      document: await owner.resolve(ctx, id),
      imageUrlPrefix: `/api/${admin ? 'admin' : 'v1'}${owner.base.replace(':id', id)}/version-history/images/`,
    });
    const audit = (
      ctx: AppContext,
      actor: OperationActor,
      documentId: string,
      format: string,
      requestId: string,
    ) =>
      tryAudit(ctx.db, ctx.logger, {
        workspaceId: ctx.workspace.id,
        actor: auditActorOf(actor),
        action: 'history.exported',
        targetType: 'document',
        targetId: documentId,
        details: { format },
        requestId,
      });
    const common = {
      method: 'get' as const,
      scope: HISTORY_SCOPE,
      tag: HISTORY,
      status: 200,
      admin: true,
      ...(owner.adminView ? { adminView: owner.adminView } : {}),
    } satisfies Partial<ServiceRoute>;
    return [
      route({
        ...common,
        id: `get${owner.key}VersionHistory`,
        path: `${owner.base}/version-history`,
        summary: `Version history of ${owner.what} (doc.txt or JSON)`,
        description:
          `${HISTORY_FORMAT} \`format=txt\` (the default) answers the text document \`doc.txt\`; ` +
          '`format=json` answers the same content as data.',
        params: IdParam,
        query: VersionHistoryQuery,
        response: VersionHistoryResponse,
        media: [{ type: 'text/plain', description: 'the document `doc.txt` (`format=txt`).' }],
        example: () => ({ response: exampleVersionHistory() }),
        handler: async ({ ctx, actor, params, query, admin, requestId }) => {
          const where = await target(ctx, params.id, admin);
          const result = await versionHistoryDocument(ctx, where, query);
          await audit(ctx, actor, where.document.id, `version-history-${query.format}`, requestId);
          return result;
        },
      }),
      route({
        ...common,
        id: `list${owner.key}VersionHistoryImages`,
        path: `${owner.base}/version-history/images`,
        summary: `Images in the version history of ${owner.what}`,
        description:
          'Every image that appeared in a listed version, with the version in which it first appeared, the last ' +
          'version that still had it (`null` while it is in the document), its size, SHA-256 and the path of its bytes.',
        params: IdParam,
        query: VersionHistoryGroupingQuery,
        response: VersionHistoryImagesResponse,
        example: () => ({ response: { images: exampleVersionHistory().images } }),
        handler: async ({ ctx, params, query, admin }) =>
          versionHistoryImages(ctx, await target(ctx, params.id, admin), query),
      }),
      route({
        ...common,
        id: `get${owner.key}VersionHistoryImage`,
        path: `${owner.base}/version-history/images/:imageId`,
        summary: 'Download one image of the version history',
        description:
          'The image file as it was uploaded. `404` for an id that never was an image of this document.',
        params: ImageParams,
        response: null,
        media: [{ type: 'image/*', description: 'the image file.', binary: true }],
        handler: async ({ ctx, params }) => {
          const document = await owner.resolve(ctx, params.id);
          return versionHistoryImage(ctx, document.id, params.imageId);
        },
      }),
      route({
        ...common,
        id: `get${owner.key}VersionHistoryArchive`,
        path: `${owner.base}/version-history/archive`,
        summary: `Version history of ${owner.what} with its images (zip)`,
        description:
          'A zip with `docs/doc.txt`, `images/<file name>` for every image that ever appeared, and `manifest.json` ' +
          '(the JSON form without the snapshots).',
        params: IdParam,
        query: VersionHistoryGroupingQuery,
        response: null,
        media: [{ type: 'application/zip', description: 'the archive.', binary: true }],
        handler: async ({ ctx, actor, params, query, admin, request, requestId }) => {
          const where = await target(ctx, params.id, admin);
          const archive = await versionHistoryArchive(ctx, where, query, (err) =>
            request.log.error(
              { err, documentId: where.document.id },
              'version history archive failed',
            ),
          );
          await audit(ctx, actor, where.document.id, 'version-history-archive', requestId);
          return archive;
        },
      }),
    ];
  });
}

export const SERVICE_ROUTES: ServiceRoute[] = [
  route({
    id: 'createInterviewSession',
    method: 'post',
    path: '/interview-sessions',
    scope: 'sessions:create',
    tag: SESSIONS,
    summary: 'Create an interview session',
    description:
      'Creates one collaborative document and a personal access link for the candidate and for each interviewer. ' +
      'The links are returned once. Send an `Idempotency-Key` header to make retries safe.',
    status: 201,
    idempotent: true,
    admin: true,
    body: CreateInterviewSessionRequest,
    response: CreateInterviewSessionResponse,
    example: () => ({ request: exampleCreateRequest(), response: exampleCreateResponse() }),
    handler: ({ ctx, actor, body, requestId, finalize }) =>
      createSession(ctx, actor, body, requestId, finalize),
  }),
  route({
    id: 'listInterviewSessions',
    method: 'get',
    path: '/interview-sessions',
    scope: 'sessions:read',
    tag: SESSIONS,
    summary: 'List interview sessions',
    description:
      'Newest first. Pass `nextCursor` of one page as `cursor` of the next. Filters combine with AND; ' +
      '`candidateEmail` and `interviewerEmail` also match names, and all text filters match anywhere in the value.',
    status: 200,
    admin: true,
    query: ListInterviewSessionsQuery,
    response: InterviewSessionsPage,
    example: () => ({ response: { items: [exampleSession()], nextCursor: null } }),
    handler: ({ ctx, query }) => listSessions(ctx, query),
  }),
  route({
    id: 'getInterviewSession',
    method: 'get',
    path: '/interview-sessions/:id',
    scope: 'sessions:read',
    tag: SESSIONS,
    summary: 'Get an interview session',
    status: 200,
    admin: true,
    adminView: 'session',
    params: IdParam,
    response: InterviewSession,
    example: () => ({ response: exampleSession() }),
    handler: ({ ctx, params }) => getSession(ctx, params.id),
  }),
  route({
    id: 'updateInterviewSession',
    method: 'patch',
    path: '/interview-sessions/:id',
    scope: 'sessions:update',
    tag: SESSIONS,
    summary: 'Change an interview session',
    description:
      'Only `scheduled` and `in_progress` sessions can be changed. A new `expiresAt` also moves the expiry of every ' +
      'active link; changing the edit permissions changes open connections immediately. The document title is kept.',
    status: 200,
    admin: true,
    params: IdParam,
    body: UpdateInterviewSessionRequest,
    response: InterviewSession,
    example: () => ({
      request: {
        permissions: { candidateCanEdit: false },
        metadata: { externalInterviewId: 'int_84721' },
      },
      response: exampleSession(),
    }),
    handler: ({ ctx, actor, params, body, requestId }) =>
      updateSession(ctx, actor, params.id, body, requestId),
  }),
  route({
    id: 'addParticipant',
    method: 'post',
    path: '/interview-sessions/:id/participants',
    scope: 'sessions:update',
    tag: SESSIONS,
    summary: 'Add an interviewer',
    description: 'Adds an interviewer (at most 20 per session) and returns their link once.',
    status: 201,
    admin: true,
    params: IdParam,
    body: AddParticipantRequest,
    response: AddParticipantResponse,
    example: () => ({
      request: { role: 'interviewer', name: 'Dev Patel', email: 'dev@acme.example' },
      response: {
        sessionId: exampleIds.sessionId,
        participant: exampleCreateResponse().participants[1],
      },
    }),
    handler: ({ ctx, actor, params, body, requestId }) =>
      addParticipant(ctx, actor, params.id, body, requestId),
  }),
  route({
    id: 'removeParticipant',
    method: 'delete',
    path: '/interview-sessions/:id/participants/:participantId',
    scope: 'sessions:update',
    tag: SESSIONS,
    summary: 'Remove a participant',
    description:
      "Revokes the participant's link at once and disconnects them if they are connected. Their name stays in the record.",
    status: 200,
    admin: true,
    params: ParticipantParams,
    response: InterviewSession,
    example: () => ({ response: exampleSession() }),
    handler: ({ ctx, actor, params, requestId }) =>
      removeParticipant(ctx, actor, params.id, params.participantId, requestId),
  }),
  route({
    id: 'rotateInterviewLinks',
    method: 'post',
    path: '/interview-sessions/:id/rotate-links',
    scope: 'sessions:update',
    tag: SESSIONS,
    summary: 'Rotate access links',
    description:
      'Replaces the links of all participants, or of the listed `participantIds`. The old links stop working and ' +
      'connected clients that used them are disconnected. The new links are returned once.',
    status: 200,
    admin: true,
    params: IdParam,
    body: RotateLinksRequest,
    response: RotateLinksResponse,
    example: () => ({
      request: { participantIds: [exampleIds.candidateId] },
      response: {
        sessionId: exampleIds.sessionId,
        participants: [exampleCreateResponse().participants[0]],
      },
    }),
    handler: ({ ctx, actor, params, body, requestId }) =>
      rotateLinks(ctx, actor, params.id, body.participantIds, requestId),
  }),
  ...(['start', 'complete', 'cancel'] as const).map((action) =>
    route({
      id: `${action}InterviewSession`,
      method: 'post',
      path: `/interview-sessions/:id/${action}`,
      scope: 'sessions:close',
      tag: SESSIONS,
      summary: {
        start: 'Start an interview',
        complete: 'Complete an interview',
        cancel: 'Cancel an interview',
      }[action],
      description: {
        start: 'Allowed from `scheduled`. Emits `session.started`.',
        complete:
          "Allowed from `in_progress`. The candidate's links are revoked and the candidate is disconnected; " +
          'interviewers keep read-only access until their links expire. Emits `session.completed`.',
        cancel:
          'Allowed from `scheduled` and `in_progress`. Same access effect as completing. Emits `session.cancelled`.',
      }[action],
      status: 200,
      admin: true,
      params: IdParam,
      response: InterviewSession,
      example: () => ({ response: exampleSession() }),
      handler: ({ ctx, actor, params, requestId }) =>
        transitionSession(ctx, actor, params.id, action, requestId),
    }),
  ),
  route({
    id: 'archiveInterviewSession',
    method: 'delete',
    path: '/interview-sessions/:id',
    scope: 'sessions:close',
    tag: SESSIONS,
    summary: 'Archive an interview session',
    description:
      'Marks the session `archived`, revokes every link and archives the document. Nothing is deleted.',
    status: 200,
    admin: true,
    params: IdParam,
    response: InterviewSession,
    example: () => ({ response: exampleSession() }),
    handler: ({ ctx, actor, params, requestId }) =>
      transitionSession(ctx, actor, params.id, 'archive', requestId),
  }),
  route({
    id: 'getInterviewSessionAudit',
    method: 'get',
    path: '/interview-sessions/:id/audit',
    scope: 'documents:history:read',
    tag: SESSIONS,
    summary: 'Read the audit trail of a session',
    description: 'Events about the session and its document, newest first.',
    status: 200,
    admin: true,
    adminView: 'audit',
    params: IdParam,
    query: SessionAuditQuery,
    response: SessionAuditPage,
    example: () => ({
      response: {
        items: [
          {
            id: '5e6f7a8b-0000-4000-8000-00000000a001',
            at: new Date().toISOString(),
            actorKind: 'service',
            actorName: 'HR system (rdk_AbCd1234)',
            action: 'interview_session.created',
            targetType: 'interview_session',
            targetId: exampleIds.sessionId,
            details: { participants: 2 },
          },
        ],
        nextCursor: null,
      },
    }),
    handler: ({ ctx, params, query }) => sessionAuditTrail(ctx, params.id, query),
  }),
  route({
    id: 'getInterviewSessionDocument',
    method: 'get',
    path: '/interview-sessions/:id/document',
    scope: 'documents:read',
    tag: SESSIONS,
    summary: 'Read the document of a session',
    description: 'The document as ProseMirror JSON, as the collaborators see it right now.',
    status: 200,
    admin: true,
    adminView: 'document',
    params: IdParam,
    response: SessionDocumentResponse,
    example: () => ({
      response: {
        documentId: exampleIds.documentId,
        title: 'Aarav_Sharma_Acme_Corp_Round_2_2030-03-14_15-30',
        status: 'active',
        updatedAt: new Date().toISOString(),
        contentUpdatedAt: new Date().toISOString(),
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Design a URL shortener.' }] },
          ],
        },
      },
    }),
    handler: ({ ctx, params }) => sessionDocument(ctx, params.id),
  }),

  // ── Version history document ─────────────────────────────────────────────
  ...versionHistoryRoutes(),

  // ── Webhooks ──────────────────────────────────────────────────────────────
  route({
    id: 'createWebhookEndpoint',
    method: 'post',
    path: '/webhooks',
    scope: 'webhooks:manage',
    tag: WEBHOOKS,
    summary: 'Create a webhook endpoint',
    description:
      'The signing `secret` is returned once. In production the URL must be https and resolve to a public address.',
    status: 201,
    admin: true,
    body: CreateWebhookRequest,
    response: WebhookEndpointWithSecret,
    example: () => ({
      request: {
        url: 'https://hooks.example.com/realtimedocs',
        events: ['session.created', 'session.completed'],
      },
      response: {
        endpoint: exampleWebhookEndpoint(),
        secret: 'whsec_Z0n3q9bQy1uXJ7mYf2m0yq2Zp6l3d1H5aV8cT4rWk9E',
      },
    }),
    handler: ({ ctx, actor, body, requestId }) => createEndpoint(ctx, actor, body, requestId),
  }),
  route({
    id: 'listWebhookEndpoints',
    method: 'get',
    path: '/webhooks',
    scope: 'webhooks:manage',
    tag: WEBHOOKS,
    summary: 'List webhook endpoints',
    status: 200,
    admin: true,
    response: WebhookEndpointsResponse,
    example: () => ({ response: { endpoints: [exampleWebhookEndpoint()] } }),
    handler: async ({ ctx }) => ({ endpoints: await listEndpoints(ctx) }),
  }),
  route({
    id: 'getWebhookEndpoint',
    method: 'get',
    path: '/webhooks/:id',
    scope: 'webhooks:manage',
    tag: WEBHOOKS,
    summary: 'Get a webhook endpoint',
    status: 200,
    admin: true,
    params: IdParam,
    response: WebhookEndpointResponse,
    example: () => ({ response: { endpoint: exampleWebhookEndpoint() } }),
    handler: async ({ ctx, params }) => ({ endpoint: await getEndpoint(ctx, params.id) }),
  }),
  route({
    id: 'updateWebhookEndpoint',
    method: 'patch',
    path: '/webhooks/:id',
    scope: 'webhooks:manage',
    tag: WEBHOOKS,
    summary: 'Change a webhook endpoint',
    description: 'Change the URL, the subscribed events or pause/resume it with `enabled`.',
    status: 200,
    admin: true,
    params: IdParam,
    body: UpdateWebhookRequest,
    response: WebhookEndpointResponse,
    example: () => ({
      request: { enabled: false },
      response: { endpoint: exampleWebhookEndpoint() },
    }),
    handler: async ({ ctx, actor, params, body, requestId }) => ({
      endpoint: await updateEndpoint(ctx, actor, params.id, body, requestId),
    }),
  }),
  route({
    id: 'deleteWebhookEndpoint',
    method: 'delete',
    path: '/webhooks/:id',
    scope: 'webhooks:manage',
    tag: WEBHOOKS,
    summary: 'Delete a webhook endpoint',
    description: 'Deletes the endpoint and its delivery history.',
    status: 204,
    admin: true,
    params: IdParam,
    response: null,
    handler: async ({ ctx, actor, params, requestId }) => {
      await deleteEndpoint(ctx, actor, params.id, requestId);
    },
  }),
  route({
    id: 'listWebhookDeliveries',
    method: 'get',
    path: '/webhooks/:id/deliveries',
    scope: 'webhooks:manage',
    tag: WEBHOOKS,
    summary: 'List deliveries of an endpoint',
    status: 200,
    admin: true,
    params: IdParam,
    query: ListDeliveriesQuery,
    response: WebhookDeliveriesPage,
    example: () => ({ response: { items: [exampleDelivery()], nextCursor: null } }),
    handler: ({ ctx, params, query }) => listDeliveries(ctx, params.id, query),
  }),
  route({
    id: 'retryWebhookDelivery',
    method: 'post',
    path: '/webhooks/deliveries/:deliveryId/retry',
    scope: 'webhooks:manage',
    tag: WEBHOOKS,
    summary: 'Retry a delivery now',
    description:
      'Queues a delivery that is `failed`, `dead` or `delivered` again with a fresh retry schedule.',
    status: 200,
    admin: true,
    params: DeliveryParam,
    response: WebhookDeliveryResponse,
    example: () => ({
      response: { delivery: { ...exampleDelivery(), status: 'pending' as const } },
    }),
    handler: async ({ ctx, actor, params, requestId }) => ({
      delivery: await retryDelivery(ctx, actor, params.deliveryId, requestId),
    }),
  }),
];
