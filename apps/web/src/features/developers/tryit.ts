/**
 * Builds and sends the request of the "Try it" form. The API key lives only in
 * the arguments of these functions (React state upstream): it is never stored,
 * never put in a URL, and the request carries no cookies.
 */
import { buildQuery, fillPath, type Operation } from './openapi';

export interface TryItInput {
  apiKey: string;
  pathValues: Record<string, string>;
  queryValues: Record<string, string>;
  body: string;
  idempotencyKey: string;
}

export type PreparedRequest =
  | { ok: true; url: string; init: RequestInit; displayHeaders: Record<string, string> }
  | { ok: false; error: string };

const VISIBLE_ASCII = /^[\x21-\x7e]{1,128}$/;

/** Validates the form and produces the `fetch` arguments. The URL is always a same-origin `/api/v1/…` path. */
export function prepareRequest(operation: Operation, input: TryItInput): PreparedRequest {
  const key = input.apiKey.trim();
  if (!key) return { ok: false, error: 'Enter an API key first.' };
  if (!/^[\x21-\x7e]+$/.test(key)) {
    return { ok: false, error: 'The API key may only contain visible ASCII characters.' };
  }
  const { path, missing } = fillPath(operation.path, input.pathValues);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Fill in the path parameter${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
    };
  }
  const missingQuery = operation.parameters.filter(
    (parameter) =>
      parameter.in === 'query' && parameter.required && !input.queryValues[parameter.name]?.trim(),
  );
  if (missingQuery.length > 0) {
    return {
      ok: false,
      error: `Fill in the query parameter: ${missingQuery.map((p) => p.name).join(', ')}.`,
    };
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };
  const display: Record<string, string> = { ...headers, Authorization: 'Bearer <your key>' };
  let body: string | undefined;
  if (operation.body) {
    const raw = input.body.trim();
    if (raw === '') return { ok: false, error: 'This endpoint needs a JSON body.' };
    try {
      body = JSON.stringify(JSON.parse(raw));
    } catch {
      return { ok: false, error: 'The body is not valid JSON.' };
    }
    headers['Content-Type'] = 'application/json';
    display['Content-Type'] = 'application/json';
  }
  const idem = input.idempotencyKey.trim();
  if (idem) {
    if (!VISIBLE_ASCII.test(idem)) {
      return { ok: false, error: 'The Idempotency-Key must be 1 to 128 visible ASCII characters.' };
    }
    headers['Idempotency-Key'] = idem;
    display['Idempotency-Key'] = idem;
  }
  const queryEntries = Object.fromEntries(
    operation.parameters
      .filter((parameter) => parameter.in === 'query')
      .map((parameter) => [parameter.name, input.queryValues[parameter.name]]),
  );
  return {
    ok: true,
    url: `${path}${buildQuery(queryEntries)}`,
    init: {
      method: operation.method.toUpperCase(),
      headers,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      ...(body !== undefined ? { body } : {}),
    },
    displayHeaders: display,
  };
}

export const SHOWN_RESPONSE_HEADERS = [
  'x-request-id',
  'idempotency-replayed',
  'retry-after',
] as const;

export interface TryItResult {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
  durationMs: number;
}

/** Pretty JSON when the text parses as JSON, the raw text otherwise. */
export function formatResponseBody(text: string): string {
  if (text === '') return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export async function sendRequest(
  prepared: Extract<PreparedRequest, { ok: true }>,
  fetchImpl: typeof fetch = fetch,
): Promise<TryItResult> {
  const started = Date.now();
  const response = await fetchImpl(prepared.url, prepared.init);
  const text = await response.text();
  const headers: Array<[string, string]> = [];
  for (const name of SHOWN_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) headers.push([name, value]);
  }
  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body: formatResponseBody(text),
    durationMs: Date.now() - started,
  };
}
