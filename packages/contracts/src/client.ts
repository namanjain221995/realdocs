/**
 * Typed HTTP client shared by the web app and the desktop renderer.
 *
 * - Web: same-origin requests with cookies; `getCsrfToken` supplies the
 *   per-session token for unsafe methods.
 * - Desktop: `baseUrl` is the configured server origin and
 *   `credentials: 'omit'`; the Electron main process injects the bearer
 *   token, so no long-lived credential is ever visible to this code.
 *
 * Every response is validated against the contract schema. Failures surface
 * as `ApiError` with a machine-readable `code`.
 */
import type { z } from 'zod';
import * as api from './api';
import * as history from './history';
import type { ErrorCode, UploadRejectReason } from './errors';
import { ApiErrorBody } from './errors';
import type { Asset } from './models';
import {
  AdminReleasesResponse,
  LatestReleaseResponse,
  ReleaseListResponse,
  ReleaseSummary,
  type ReleaseChannel,
} from './releases';
import { COLLAB_WS_PATH } from './versions';

export type ClientErrorCode = ErrorCode | 'network_error' | 'invalid_response' | 'aborted';

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly reason?: UploadRejectReason;
  readonly issues?: { path: string; message: string }[];
  readonly retryAfterSeconds?: number;
  readonly requestId?: string;

  constructor(
    code: ClientErrorCode,
    message: string,
    details: {
      status?: number;
      reason?: UploadRejectReason;
      issues?: { path: string; message: string }[];
      retryAfterSeconds?: number;
      requestId?: string;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = details.status ?? 0;
    this.reason = details.reason;
    this.issues = details.issues;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.requestId = details.requestId;
  }

  /** True when retrying later can succeed without user action. */
  get transient(): boolean {
    return (
      this.code === 'network_error' ||
      this.code === 'server_busy' ||
      this.code === 'storage_unavailable' ||
      this.code === 'rate_limited' ||
      this.code === 'internal'
    );
  }
}

export interface ApiClientOptions {
  /** Server origin without trailing slash; empty string for same-origin. */
  baseUrl?: string;
  credentials?: RequestCredentials;
  getCsrfToken?: () => string | null;
  fetch?: typeof fetch;
}

export interface RequestOptions<S extends z.ZodType | undefined> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  schema?: S;
  signal?: AbortSignal;
}

export interface UploadOptions {
  /** Called with the fraction (0–1) of bytes sent so far. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parseErrorPayload(status: number, payload: unknown): ApiError {
  const parsed = ApiErrorBody.safeParse(payload);
  if (parsed.success) {
    const { code, message, reason, issues, retryAfterSeconds, requestId } = parsed.data.error;
    return new ApiError(code, message, { status, reason, issues, retryAfterSeconds, requestId });
  }
  return new ApiError('invalid_response', `Unexpected response from the server (HTTP ${status}).`, {
    status,
  });
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const credentials = options.credentials ?? 'same-origin';
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));

  function url(path: string, query?: RequestOptions<undefined>['query']): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return `${baseUrl}${path}${suffix}`;
  }

  function csrfHeaders(method: string): Record<string, string> {
    if (!UNSAFE.has(method)) return {};
    return { [api.CSRF_HEADER]: options.getCsrfToken?.() ?? '1' };
  }

  async function request<S extends z.ZodType | undefined = undefined>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    opts: RequestOptions<S> = {},
  ): Promise<S extends z.ZodType ? z.output<S> : void> {
    type Result = S extends z.ZodType ? z.output<S> : void;
    const headers: Record<string, string> = { accept: 'application/json', ...csrfHeaders(method) };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    let response: Response;
    try {
      response = await doFetch(url(path, opts.query), {
        method,
        headers,
        body,
        credentials,
        signal: opts.signal,
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
    } catch (error) {
      if (opts.signal?.aborted) throw new ApiError('aborted', 'The request was cancelled.');
      throw new ApiError(
        'network_error',
        error instanceof Error ? error.message : 'The server could not be reached.',
      );
    }

    if (response.status === 204) return undefined as Result;

    let payload: unknown = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) throw parseErrorPayload(response.status, payload);
    if (!opts.schema) return undefined as Result;

    const parsed = opts.schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError('invalid_response', 'The server response did not match the contract.', {
        status: response.status,
      });
    }
    return parsed.data as Result;
  }

  /** Uploads one file with real byte-level progress (XMLHttpRequest). */
  function uploadAsset(
    documentId: string,
    file: Blob,
    filename: string,
    opts: UploadOptions = {},
  ): Promise<Asset> {
    return new Promise<Asset>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url(`/api/documents/${documentId}/assets`));
      xhr.withCredentials = credentials === 'include' || credentials === 'same-origin';
      xhr.responseType = 'text';
      xhr.setRequestHeader('accept', 'application/json');
      for (const [key, value] of Object.entries(csrfHeaders('POST'))) {
        xhr.setRequestHeader(key, value);
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0)
          opts.onProgress?.(event.loaded / event.total);
      };
      xhr.onerror = () => reject(new ApiError('network_error', 'The upload could not be sent.'));
      xhr.onabort = () => reject(new ApiError('aborted', 'The upload was cancelled.'));
      xhr.onload = () => {
        let payload: unknown;
        try {
          payload = JSON.parse(xhr.responseText);
        } catch {
          payload = null;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(parseErrorPayload(xhr.status, payload));
          return;
        }
        const parsed = api.AssetResponse.safeParse(payload);
        if (!parsed.success) {
          reject(
            new ApiError('invalid_response', 'The upload response did not match the contract.'),
          );
          return;
        }
        opts.onProgress?.(1);
        resolve(parsed.data.asset);
      };
      if (opts.signal) {
        if (opts.signal.aborted) {
          reject(new ApiError('aborted', 'The upload was cancelled.'));
          return;
        }
        opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }
      const form = new FormData();
      form.append('file', file, filename);
      xhr.send(form);
    });
  }

  function assetUrl(documentId: string, assetId: string, download = false): string {
    return url(api.assetPath(documentId, assetId), download ? { download: 1 } : undefined);
  }

  function exportUrl(documentId: string, format: api.ExportFormat): string {
    return url(`/api/documents/${documentId}/export`, { format });
  }

  /** `ws(s)://…/collab` derived from the base URL (or the page origin when same-origin). */
  function collabUrl(): string {
    const origin = baseUrl || (typeof location !== 'undefined' ? location.origin : '');
    return `${origin.replace(/^http/i, 'ws')}${COLLAB_WS_PATH}`;
  }

  const doc = (id: string) => `/api/documents/${id}`;

  return {
    baseUrl,
    request,
    uploadAsset,
    assetUrl,
    exportUrl,
    collabUrl,

    meta: () => request('GET', '/api/meta', { schema: api.MetaResponse }),

    downloads: () => request('GET', '/api/downloads', { schema: api.DownloadsResponse }),

    desktopReleases: {
      list: (channel: ReleaseChannel = 'stable') =>
        request('GET', '/api/v1/desktop/releases', {
          query: { channel },
          schema: ReleaseListResponse,
        }),
      get: (version: string, channel?: ReleaseChannel) =>
        request('GET', `/api/v1/desktop/releases/${encodeURIComponent(version)}`, {
          query: { channel },
          schema: ReleaseSummary,
        }),
      latest: (query: { platform?: string; arch?: string; channel?: string } = {}) =>
        request('GET', '/api/v1/desktop/releases/latest', {
          query,
          schema: LatestReleaseResponse,
        }),
      admin: () => request('GET', '/api/admin/releases', { schema: AdminReleasesResponse }),
    },

    auth: {
      session: () => request('GET', '/api/auth/session', { schema: api.SessionResponse }),
      login: (body: api.LoginRequest) =>
        request('POST', '/api/auth/login', { body, schema: api.SessionResponse }),
      logout: () => request('POST', '/api/auth/logout'),
      updateProfile: (body: api.UpdateProfileRequest) =>
        request('PATCH', '/api/auth/profile', { body, schema: api.SessionResponse }),
      changePassword: (body: api.ChangePasswordRequest) =>
        request('POST', '/api/auth/password', { body }),
      signup: (body: api.SignupRequest) =>
        request('POST', '/api/auth/signup', { body, schema: api.SessionResponse }),
      revokeOtherSessions: () =>
        request('POST', '/api/auth/sessions/revoke-others', {
          schema: api.RevokeOtherSessionsResponse,
        }),
    },

    users: {
      list: () => request('GET', '/api/users', { schema: api.UsersResponse }),
      update: (userId: string, body: api.UpdateUserRequest) =>
        request('PATCH', `/api/users/${userId}`, { body, schema: api.UsersResponse }),
    },

    invitations: {
      list: () => request('GET', '/api/invitations', { schema: api.InvitationsResponse }),
      create: (body: api.CreateInvitationRequest) =>
        request('POST', '/api/invitations', { body, schema: api.CreateInvitationResponse }),
      revoke: (invitationId: string) => request('DELETE', `/api/invitations/${invitationId}`),
      lookup: (body: api.InvitationLookupRequest) =>
        request('POST', '/api/invitations/lookup', { body, schema: api.InvitationLookupResponse }),
      accept: (body: api.AcceptInvitationRequest) =>
        request('POST', '/api/invitations/accept', { body, schema: api.SessionResponse }),
    },

    documents: {
      list: (query: api.ListDocumentsQuery = {}, signal?: AbortSignal) =>
        request('GET', '/api/documents', { query, schema: api.DocumentsResponse, signal }),
      create: (body: api.CreateDocumentRequest = {}) =>
        request('POST', '/api/documents', { body, schema: api.DocumentResponse }),
      get: (id: string, signal?: AbortSignal) =>
        request('GET', doc(id), { schema: api.DocumentResponse, signal }),
      rename: (id: string, body: api.UpdateDocumentRequest) =>
        request('PATCH', doc(id), { body, schema: api.DocumentResponse }),
      duplicate: (id: string) =>
        request('POST', `${doc(id)}/duplicate`, { schema: api.DocumentResponse }),
      archive: (id: string) =>
        request('POST', `${doc(id)}/archive`, { schema: api.DocumentResponse }),
      unarchive: (id: string) =>
        request('POST', `${doc(id)}/unarchive`, { schema: api.DocumentResponse }),
      trash: (id: string) => request('POST', `${doc(id)}/trash`, { schema: api.DocumentResponse }),
      restore: (id: string) =>
        request('POST', `${doc(id)}/restore`, { schema: api.DocumentResponse }),
      deletePermanently: (id: string) => request('DELETE', doc(id)),
      accessList: (id: string) =>
        request('GET', `${doc(id)}/access`, { schema: api.AccessListResponse }),
      exportText: async (id: string, format: 'txt' | 'md' | 'json'): Promise<string> => {
        const response = await doFetch(exportUrl(id, format), { credentials, cache: 'no-store' });
        if (!response.ok) {
          throw parseErrorPayload(response.status, await response.json().catch(() => null));
        }
        return response.text();
      },
    },

    members: {
      list: (id: string) => request('GET', `${doc(id)}/members`, { schema: api.MembersResponse }),
      set: (id: string, userId: string, body: api.SetMemberRequest) =>
        request('PUT', `${doc(id)}/members/${userId}`, { body, schema: api.MembersResponse }),
      remove: (id: string, userId: string) =>
        request('DELETE', `${doc(id)}/members/${userId}`, { schema: api.MembersResponse }),
    },

    shares: {
      list: (id: string) => request('GET', `${doc(id)}/shares`, { schema: api.SharesResponse }),
      create: (id: string, body: api.CreateShareRequest = {}) =>
        request('POST', `${doc(id)}/shares`, { body, schema: api.ShareWithUrlResponse }),
      update: (id: string, shareId: string, body: api.UpdateShareRequest) =>
        request('PATCH', `${doc(id)}/shares/${shareId}`, { body, schema: api.ShareResponse }),
      revoke: (id: string, shareId: string) =>
        request('POST', `${doc(id)}/shares/${shareId}/revoke`, { schema: api.ShareResponse }),
      rotate: (id: string, shareId: string) =>
        request('POST', `${doc(id)}/shares/${shareId}/rotate`, {
          schema: api.ShareWithUrlResponse,
        }),
      exchange: (body: api.ShareExchangeRequest) =>
        request('POST', '/api/share/exchange', { body, schema: api.ShareExchangeResponse }),
      endGuestSession: (id: string) => request('POST', `${doc(id)}/share-session/end`),
    },

    collab: {
      ticket: (id: string, body: api.CollabTicketRequest, signal?: AbortSignal) =>
        request('POST', `${doc(id)}/collab-ticket`, {
          body,
          schema: api.CollabTicketResponse,
          signal,
        }),
    },

    snapshots: {
      list: (id: string) =>
        request('GET', `${doc(id)}/snapshots`, { schema: api.SnapshotsResponse }),
      create: (id: string, body: api.CreateSnapshotRequest) =>
        request('POST', `${doc(id)}/snapshots`, { body, schema: api.SnapshotResponse }),
      restore: (id: string, snapshotId: string) =>
        request('POST', `${doc(id)}/snapshots/${snapshotId}/restore`, {
          schema: api.RestoreSnapshotResponse,
        }),
      remove: (id: string, snapshotId: string) =>
        request('DELETE', `${doc(id)}/snapshots/${snapshotId}`),
    },

    desktop: {
      createHandoff: (id: string) =>
        request('POST', `${doc(id)}/desktop-handoff`, { schema: api.DesktopHandoffResponse }),
      redeem: (body: api.DesktopRedeemRequest) =>
        request('POST', '/api/desktop/redeem', { body, schema: api.DesktopSessionResponse }),
      session: () => request('GET', '/api/desktop/session', { schema: api.DesktopSessionResponse }),
      logout: () => request('POST', '/api/desktop/logout'),
    },

    history: {
      list: (id: string, query: Partial<history.HistoryQuery> = {}) =>
        request('GET', `${doc(id)}/history`, { query, schema: history.HistoryResponse }),
      revision: (id: string, revision: number) =>
        request('GET', `${doc(id)}/history/${revision}`, {
          schema: history.HistoryRevisionResponse,
        }),
      name: (id: string, revision: number, body: history.NameRevisionRequest) =>
        request('POST', `${doc(id)}/history/${revision}/name`, {
          body,
          schema: api.SnapshotResponse,
        }),
      copy: (id: string, revision: number, body: history.CopyRevisionRequest = {}) =>
        request('POST', `${doc(id)}/history/${revision}/copy`, {
          body,
          schema: history.CopyRevisionResponse,
        }),
      /** Download URLs (same origin, cookie-authenticated). */
      exportUrl: (id: string, format: 'json' | 'csv') =>
        `${doc(id)}/history/export?format=${format}`,
      revisionExportUrl: (id: string, revision: number, format: 'json' | 'markdown' | 'text') =>
        `${doc(id)}/history/${revision}/export?format=${format}`,
    },

    audit: {
      list: (limit = 100) =>
        request('GET', '/api/audit', { query: { limit }, schema: api.AuditResponse }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
