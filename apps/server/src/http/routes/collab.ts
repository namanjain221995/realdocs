import {
  COLLAB_PROTOCOL_VERSION,
  CollabTicketRequest,
  DOCUMENT_SCHEMA_VERSION,
  canEdit,
  collabDocumentName,
  type CollabTicketResponse,
  type Participant,
} from '@realtimedocs/contracts';
import type { FastifyInstance } from 'fastify';
import { newId } from '../../auth/tokens';
import { errors } from '../../errors';
import { colorFor } from '../../util/identity';
import type { RouteDeps } from '../app';
import { documentAccess, sessionsFor } from '../auth';
import { param, parseInput } from '../util';

export function registerCollabRoutes(app: FastifyInstance, { ctx, limits }: RouteDeps): void {
  const { db, workspace, config } = ctx;

  /**
   * Exchanges the caller's session for a single-use, 60-second ticket. The
   * ticket only names the principals; role, identity and generation are
   * resolved here and again when the WebSocket authenticates.
   */
  app.post(
    '/api/documents/:documentId/collab-ticket',
    async (request): Promise<CollabTicketResponse> => {
      const access = await documentAccess(ctx, request, param(request, 'documentId'));
      const body = parseInput(CollabTicketRequest, request.body);
      const document = access.document;
      await limits.collabTicket.consume(request, access.actor.sessionId);

      // Old clients must not open documents they could silently damage.
      const requiredSchema = Math.max(document.schemaVersion, config.minClientSchemaVersion);
      if (body.protocolVersion !== COLLAB_PROTOCOL_VERSION || body.schemaVersion < requiredSchema) {
        throw errors.updateRequired();
      }
      // A document is at least as new as the newest editor that may have written to it.
      const editorSchema = Math.min(body.schemaVersion, DOCUMENT_SCHEMA_VERSION);
      if (canEdit(access.role) && editorSchema > document.schemaVersion) {
        await db.query(
          `UPDATE documents SET schema_version = GREATEST(schema_version, $1)
            WHERE id = $2 AND workspace_id = $3`,
          [editorSchema, document.id, workspace.id],
        );
        // Clients of an older schema that are connected right now are sent away before this
        // editor can write anything they would not understand.
        await ctx.collab.reevaluateDocument(document.id);
      }

      // Every principal the request presented is recorded: independent
      // permissions stay independent when one of them is revoked later.
      const sessionIds = (await sessionsFor(ctx, request, document.id)).map(
        (session) => session.id,
      );

      const participant: Participant = {
        id: newId(),
        // For interview participants this is the registered name, taken from the record.
        name: access.actor.name,
        color: colorFor(access.actor.userId ?? access.actor.sessionId),
        role: access.role,
        kind: access.actor.kind,
        ...(access.participant
          ? { roleLabel: access.participant.role === 'candidate' ? 'Candidate' : 'Interviewer' }
          : {}),
      };
      const issued = await Promise.resolve(
        ctx.tickets.issue({
          documentId: document.id,
          generation: document.generation,
          clientId: body.clientId,
          sessionIds,
          participant,
          schemaVersion: body.schemaVersion,
          protocolVersion: body.protocolVersion,
        }),
        // The shared ticket store (Redis) is unreachable: the client retries.
      ).catch(() => null);
      if (!issued) throw errors.serverBusy();

      return {
        ticket: issued.ticket,
        expiresAt: issued.expiresAt.toISOString(),
        documentName: collabDocumentName(document.id, document.generation),
        generation: document.generation,
        role: access.role,
        participant,
        accessExpiresAt: access.expiresAt ? access.expiresAt.toISOString() : null,
      };
    },
  );
}
