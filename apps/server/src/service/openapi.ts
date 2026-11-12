/**
 * OpenAPI 3.1 document of the service API, generated from the route registry
 * and therefore from the very schemas that validate requests at runtime.
 */
import { SERVICE_SCOPE_DESCRIPTIONS, SERVICE_SCOPES, V1ErrorBody } from '@realtimedocs/contracts';
import { z } from 'zod';
import type { ServiceRoute } from './registry';

export const API_VERSION = '1.0.0';

type Json = Record<string, unknown>;

function schemaOf(schema: z.ZodType, io: 'input' | 'output'): Json {
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    unrepresentable: 'any',
  }) as Json;
  delete json.$schema;
  return json;
}

/** `/interview-sessions/:id` → `/interview-sessions/{id}` */
export function openApiPath(path: string): string {
  return `/api/v1${path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`;
}

function parametersOf(route: ServiceRoute): Json[] {
  const parameters: Json[] = [];
  const add = (shape: z.ZodObject | undefined, where: 'path' | 'query') => {
    if (!shape) return;
    const json = schemaOf(shape, 'input');
    const properties = (json.properties ?? {}) as Record<string, Json>;
    const required = new Set((json.required ?? []) as string[]);
    for (const [name, property] of Object.entries(properties)) {
      const { description, ...rest } = property as Json & { description?: string };
      parameters.push({
        name,
        in: where,
        required: where === 'path' ? true : required.has(name),
        ...(description ? { description } : {}),
        schema: rest,
      });
    }
  };
  add(route.params, 'path');
  add(route.query, 'query');
  if (route.idempotent) {
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      description:
        'Makes retries safe: 1 to 128 visible ASCII characters. The same key with the same body returns the first ' +
        'response (header `Idempotency-Replayed: true`); the same key with another body is `IDEMPOTENCY_CONFLICT`. Keys are kept for 24 hours.',
      schema: { type: 'string', minLength: 1, maxLength: 128 },
    });
  }
  parameters.push({
    name: 'X-Request-Id',
    in: 'header',
    required: false,
    description:
      'Optional correlation id (8 to 64 of A-Z a-z 0-9 _ -). Echoed in the response and in `error.requestId`.',
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,64}$' },
  });
  return parameters;
}

const ERROR_RESPONSES: Record<string, string> = {
  '400': 'The request is not valid (`VALIDATION_ERROR`).',
  '401': 'The API key is missing, not valid, revoked or expired (`UNAUTHENTICATED`).',
  '403': 'The key lacks the scope or may not be used from this address (`FORBIDDEN`).',
  '404': 'The resource does not exist (`NOT_FOUND`).',
  '409':
    'The request conflicts with the current state (`CONFLICT`, `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS`).',
  '429': 'Too many requests (`RATE_LIMITED`); see the `Retry-After` header.',
  '500': 'Unexpected server error (`INTERNAL`).',
};

export function buildOpenApi(routes: readonly ServiceRoute[], origin: string): Json {
  const errorSchema = schemaOf(V1ErrorBody, 'output');
  const paths: Record<string, Record<string, Json>> = {};
  for (const route of routes) {
    const example = route.example?.();
    const responses: Record<string, Json> = {};
    if (route.response) {
      responses[String(route.status)] = {
        description: 'Success.',
        content: {
          'application/json': {
            schema: schemaOf(route.response, 'output'),
            ...(example?.response !== undefined ? { example: example.response } : {}),
          },
        },
      };
    } else {
      responses[String(route.status)] = { description: 'Success. No content.' };
    }
    for (const [status, description] of Object.entries(ERROR_RESPONSES)) {
      responses[status] = {
        description,
        content: { 'application/json': { schema: errorSchema } },
      };
    }
    const operation: Json = {
      operationId: route.id,
      tags: [route.tag],
      summary: route.summary,
      ...(route.description ? { description: route.description } : {}),
      security: [{ ApiKey: [route.scope] }],
      'x-required-scope': route.scope,
      parameters: parametersOf(route),
      ...(route.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: schemaOf(route.body, 'input'),
                  ...(example?.request !== undefined ? { example: example.request } : {}),
                },
              },
            },
          }
        : {}),
      responses,
    };
    const key = openApiPath(route.path);
    paths[key] = { ...(paths[key] ?? {}), [route.method]: operation };
  }

  const tags = [...new Set(routes.map((route) => route.tag))].map((name) => ({ name }));
  return {
    openapi: '3.1.0',
    info: {
      title: 'RealtimeDocs service API',
      version: API_VERSION,
      description:
        'Create and manage interview sessions with collaborative documents, and receive webhooks. ' +
        'Authenticate with an API key: `Authorization: Bearer rdk_…`. Identifiers are UUIDs.',
    },
    servers: [{ url: origin }],
    tags,
    paths,
    components: {
      securitySchemes: {
        ApiKey: {
          type: 'http',
          scheme: 'bearer',
          description:
            'An API key created by an administrator (`/admin/api-keys`). Scopes: ' +
            SERVICE_SCOPES.map(
              (scope) => `\`${scope}\` (${SERVICE_SCOPE_DESCRIPTIONS[scope]})`,
            ).join(' '),
        },
      },
    },
    security: [{ ApiKey: [] }],
  };
}
