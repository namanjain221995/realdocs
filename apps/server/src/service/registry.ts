/**
 * The service API's route registry. Each route is declared once: method,
 * path, scope, the zod schemas that validate its input at runtime and shape
 * its output, and an example. The same declaration registers the Fastify
 * route (`http/routes/v1.ts`) and produces the OpenAPI document
 * (`service/openapi.ts`), so the documentation cannot drift from behaviour.
 */
import type { ServiceScope } from '@realtimedocs/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AppContext } from '../context';
import type { OperationActor } from './actor';
import type { CreateFinalizer } from './sessions';

export type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

export interface RouteInvocation<P, Q, B> {
  ctx: AppContext;
  actor: OperationActor;
  params: P;
  query: Q;
  body: B;
  request: FastifyRequest;
  requestId: string;
  /** True when called from the admin UI (a signed-in administrator) rather than with an API key. */
  admin: boolean;
  /** Set for idempotent routes called with an `Idempotency-Key`: run inside the creating transaction. */
  finalize?: CreateFinalizer;
}

export interface RouteExample {
  request?: unknown;
  response?: unknown;
}

export interface ServiceRoute {
  /** `operationId` in the OpenAPI document. */
  id: string;
  method: HttpMethod;
  /** Relative to `/api/v1`, Fastify syntax (`/interview-sessions/:id`). */
  path: string;
  scope: ServiceScope;
  tag: string;
  summary: string;
  description?: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** Success status. */
  status: number;
  response: z.ZodType | null;
  /** Honours the `Idempotency-Key` header. */
  idempotent?: boolean;
  /** Also served to signed-in administrators under `/api/admin`. */
  admin?: boolean;
  /** Admin reads that must be audited (`admin.session_viewed`). */
  adminView?: 'session' | 'document' | 'audit';
  example?: () => RouteExample;
  handler: (invocation: RouteInvocation<never, never, never>) => Promise<unknown>;
}

/** Declares a route with typed schemas and a handler typed from them. */
export function route<
  P extends z.ZodObject | undefined = undefined,
  Q extends z.ZodObject | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
>(
  definition: Omit<ServiceRoute, 'params' | 'query' | 'body' | 'handler'> & {
    params?: P;
    query?: Q;
    body?: B;
    handler: (
      invocation: RouteInvocation<
        P extends z.ZodObject ? z.output<P> : undefined,
        Q extends z.ZodObject ? z.output<Q> : undefined,
        B extends z.ZodType ? z.output<B> : undefined
      >,
    ) => Promise<unknown>;
  },
): ServiceRoute {
  return definition as unknown as ServiceRoute;
}
