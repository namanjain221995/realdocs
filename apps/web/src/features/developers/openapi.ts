/**
 * Reads the service API's OpenAPI document into a flat list of operations and
 * does the small amount of arithmetic the "Try it" form needs. The document
 * comes from the network, so every access is defensive.
 */
import type { JsonSchema } from './schema';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
const METHODS: readonly HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

export interface OperationParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  description: string;
  schema: JsonSchema;
}

export interface OperationResponse {
  status: string;
  description: string;
  schema?: JsonSchema;
  example?: unknown;
}

export interface Operation {
  id: string;
  method: HttpMethod;
  /** `/api/v1/interview-sessions/{id}` */
  path: string;
  tag: string;
  summary: string;
  description: string;
  scope: string | null;
  parameters: OperationParameter[];
  body: { schema: JsonSchema; example?: unknown } | null;
  responses: OperationResponse[];
}

export interface TagGroup {
  tag: string;
  operations: Operation[];
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function jsonContent(content: unknown): { schema?: JsonSchema; example?: unknown } | null {
  if (!isRecord(content)) return null;
  const media = content['application/json'];
  if (!isRecord(media)) return null;
  return {
    ...(isRecord(media.schema) ? { schema: media.schema as JsonSchema } : {}),
    ...(media.example !== undefined ? { example: media.example } : {}),
  };
}

function parseParameters(value: unknown): OperationParameter[] {
  if (!Array.isArray(value)) return [];
  const out: OperationParameter[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const where = entry.in;
    if (
      typeof entry.name !== 'string' ||
      (where !== 'path' && where !== 'query' && where !== 'header')
    ) {
      continue;
    }
    out.push({
      name: entry.name,
      in: where,
      required: entry.required === true || where === 'path',
      description: text(entry.description),
      schema: isRecord(entry.schema) ? (entry.schema as JsonSchema) : {},
    });
  }
  return out;
}

function parseResponses(value: unknown): OperationResponse[] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter((entry): entry is [string, Json] => isRecord(entry[1]))
    .map(([status, response]) => {
      const content = jsonContent(response.content);
      return {
        status,
        description: text(response.description),
        ...(content?.schema ? { schema: content.schema } : {}),
        ...(content?.example !== undefined ? { example: content.example } : {}),
      };
    })
    .sort((a, b) => a.status.localeCompare(b.status));
}

/** All operations of the document, in document order. Unknown shapes are skipped, never thrown on. */
export function parseOperations(spec: unknown): Operation[] {
  if (!isRecord(spec) || !isRecord(spec.paths)) return [];
  const out: Operation[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!isRecord(item)) continue;
    for (const method of METHODS) {
      const operation = item[method];
      if (!isRecord(operation)) continue;
      const tags = Array.isArray(operation.tags) ? operation.tags : [];
      const body = isRecord(operation.requestBody)
        ? jsonContent(operation.requestBody.content)
        : null;
      out.push({
        id: text(operation.operationId) || `${method}:${path}`,
        method,
        path,
        tag: typeof tags[0] === 'string' ? tags[0] : 'Other',
        summary: text(operation.summary),
        description: text(operation.description),
        scope:
          typeof operation['x-required-scope'] === 'string' ? operation['x-required-scope'] : null,
        parameters: parseParameters(operation.parameters),
        body: body?.schema
          ? {
              schema: body.schema,
              ...(body.example !== undefined ? { example: body.example } : {}),
            }
          : null,
        responses: parseResponses(operation.responses),
      });
    }
  }
  return out;
}

/** Order of `spec.tags` first, then tags in order of first use; operations keep document order. */
export function groupByTag(
  operations: readonly Operation[],
  tagOrder: readonly string[] = [],
): TagGroup[] {
  const groups = new Map<string, Operation[]>();
  for (const tag of tagOrder) groups.set(tag, []);
  for (const operation of operations) {
    const list = groups.get(operation.tag);
    if (list) list.push(operation);
    else groups.set(operation.tag, [operation]);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 0)
    .map(([tag, list]) => ({ tag, operations: list }));
}

/** Tag names declared by the document, in order. */
export function specTags(spec: unknown): string[] {
  if (!isRecord(spec) || !Array.isArray(spec.tags)) return [];
  return spec.tags.flatMap((tag) =>
    isRecord(tag) && typeof tag.name === 'string' ? [tag.name] : [],
  );
}

/** Path parameter names in a template: `/a/{id}/b/{x}` gives `['id', 'x']`. */
export function pathParameterNames(template: string): string[] {
  return [...template.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] as string);
}

/**
 * Substitutes `{name}` placeholders with percent-encoded values. Names with no
 * (or a blank) value are listed in `missing` and left as `{name}`.
 */
export function fillPath(
  template: string,
  values: Readonly<Record<string, string | undefined>>,
): { path: string; missing: string[] } {
  const missing: string[] = [];
  const path = template.replace(/\{([^}]+)\}/g, (placeholder, name: string) => {
    const value = values[name]?.trim();
    if (!value) {
      if (!missing.includes(name)) missing.push(name);
      return placeholder;
    }
    return encodeURIComponent(value);
  });
  return { path, missing };
}

/** `?a=1&b=x%20y` from the non-blank entries, or an empty string. */
export function buildQuery(values: Readonly<Record<string, string | undefined>>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    const trimmed = value?.trim();
    if (trimmed) search.set(name, trimmed);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
