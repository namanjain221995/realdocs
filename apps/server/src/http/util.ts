import { isUuid } from '@realtimedocs/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { errors } from '../errors';

/** Validates untrusted input against a contract schema. */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  throw errors.validation(
    'Some fields are not valid.',
    result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  );
}

/** Reads a route parameter as a string (ids are validated where they are used). */
export function param(request: FastifyRequest, name: string): string {
  const value = (request.params as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
}

/** A route parameter that must be a UUID; anything else is "not found". */
export function uuidParam(request: FastifyRequest, name: string): string {
  const value = param(request, name);
  if (!isUuid(value)) throw errors.notFound();
  return value;
}

export const iso = (date: Date): string => date.toISOString();
export const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);
