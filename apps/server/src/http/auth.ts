/**
 * Request authentication helpers: who is calling (principals), and the guards
 * routes use. Authorization for documents always goes through `resolveAccess`.
 */
import {
  CSRF_HEADER,
  SESSION_COOKIE,
  canEdit,
  isUuid,
  shareCookieName,
} from '@realtimedocs/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { resolveAccess, type AccessGranted } from '../access/resolve';
import { findSessionByToken, sessionStatus, touchSessions } from '../auth/sessions';
import { csrfTokenFor, safeEqualString } from '../auth/tokens';
import type { AppContext } from '../context';
import { USER_COLUMNS, type SessionRow, type UserRow } from '../db/rows';
import { errors, type AppError } from '../errors';

export interface RequestAuth {
  /** An `Authorization: Bearer` header was sent. Cookies are then ignored entirely. */
  bearerPresented: boolean;
  /** Desktop session behind the bearer token (may be expired or revoked). */
  bearer: SessionRow | null;
  /** False for cross-site requests and for requests from desktop origins. */
  cookiesHonoured: boolean;
  /** Account session behind the `rd_session` cookie (may be expired or revoked). */
  account: SessionRow | null;
  accountStatus: 'none' | 'valid' | 'expired' | 'revoked';
  /** The signed-in account, when the session is valid and the account is active. */
  user: UserRow | null;
}

const cache = new WeakMap<FastifyRequest, Promise<RequestAuth>>();

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? '';
}

function cookiesHonoured(ctx: AppContext, request: FastifyRequest): boolean {
  // Never honour ambient credentials from another site.
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (typeof origin === 'string' && !ctx.config.webOrigins.includes(origin)) return false;
  return true;
}

async function load(ctx: AppContext, request: FastifyRequest): Promise<RequestAuth> {
  const token = bearerToken(request);
  if (token !== null) {
    const bearer = await findSessionByToken(ctx.db, ctx.workspace.id, token);
    return {
      bearerPresented: true,
      bearer: bearer && bearer.kind === 'desktop' ? bearer : null,
      cookiesHonoured: false,
      account: null,
      accountStatus: 'none',
      user: null,
    };
  }
  const honoured = cookiesHonoured(ctx, request);
  const account = honoured
    ? await findSessionByToken(ctx.db, ctx.workspace.id, request.cookies[SESSION_COOKIE])
    : null;
  if (!account || account.kind !== 'user' || !account.userId) {
    return {
      bearerPresented: false,
      bearer: null,
      cookiesHonoured: honoured,
      account: null,
      accountStatus: 'none',
      user: null,
    };
  }
  const status = sessionStatus(account, ctx.config.sessions);
  let user: UserRow | null = null;
  if (status === 'valid') {
    const result = await ctx.db.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND workspace_id = $2 AND status = 'active'`,
      [account.userId, ctx.workspace.id],
    );
    user = result.rows[0] ?? null;
  }
  return {
    bearerPresented: false,
    bearer: null,
    cookiesHonoured: honoured,
    account,
    accountStatus: status,
    user,
  };
}

/** Principals of the request, resolved once per request. */
export function getAuth(ctx: AppContext, request: FastifyRequest): Promise<RequestAuth> {
  let pending = cache.get(request);
  if (!pending) {
    pending = load(ctx, request);
    cache.set(request, pending);
  }
  return pending;
}

function recordActivity(ctx: AppContext, sessionIds: readonly string[]): void {
  touchSessions(ctx.db, sessionIds).catch((err: unknown) => {
    ctx.logger.debug({ err }, 'could not record session activity');
  });
}

export interface AccountPrincipal {
  user: UserRow;
  session: SessionRow;
}

/** A signed-in account (browser session). Desktop and share sessions do not qualify. */
export async function requireAccount(
  ctx: AppContext,
  request: FastifyRequest,
): Promise<AccountPrincipal> {
  const auth = await getAuth(ctx, request);
  if (auth.user && auth.account) {
    recordActivity(ctx, [auth.account.id]);
    return { user: auth.user, session: auth.account };
  }
  if (auth.accountStatus === 'expired') throw errors.sessionExpired();
  throw errors.unauthenticated();
}

export async function requireAdmin(
  ctx: AppContext,
  request: FastifyRequest,
): Promise<AccountPrincipal> {
  const principal = await requireAccount(ctx, request);
  if (principal.user.role !== 'admin') {
    throw errors.forbidden('Only administrators can do that.');
  }
  return principal;
}

export interface DocumentAccessOptions {
  /** Administrator lifecycle routes may reach trashed documents. */
  allowTrashed?: boolean;
}

type AccessFailure =
  | 'unauthenticated'
  | 'session_expired'
  | 'share_revoked'
  | 'share_expired'
  | 'document_trashed'
  | 'not_found';

function accessError(code: AccessFailure): AppError {
  switch (code) {
    case 'unauthenticated':
      return errors.unauthenticated();
    case 'session_expired':
      return errors.sessionExpired();
    case 'share_revoked':
      return errors.shareRevoked();
    case 'share_expired':
      return errors.shareExpired();
    case 'document_trashed':
      return errors.documentTrashed();
    case 'not_found':
      return errors.notFound();
  }
}

/** Sessions the request presents for one document (bearer, or account + share cookie). */
export async function sessionsFor(
  ctx: AppContext,
  request: FastifyRequest,
  documentId: string,
): Promise<SessionRow[]> {
  const auth = await getAuth(ctx, request);
  if (auth.bearerPresented) return auth.bearer ? [auth.bearer] : [];
  const sessions: SessionRow[] = [];
  if (auth.account) sessions.push(auth.account);
  if (auth.cookiesHonoured) {
    const share = await findSessionByToken(
      ctx.db,
      ctx.workspace.id,
      request.cookies[shareCookieName(documentId)],
    );
    if (share && share.kind === 'share') sessions.push(share);
  }
  return sessions;
}

/**
 * Resolves the caller's access to a document or throws the appropriate error.
 * Unknown and unauthorized documents are indistinguishable (`not_found`).
 */
export async function documentAccess(
  ctx: AppContext,
  request: FastifyRequest,
  documentId: string,
  options: DocumentAccessOptions = {},
): Promise<AccessGranted> {
  // Ids are opaque: a malformed one is just another document that does not exist.
  if (!isUuid(documentId)) {
    const auth = await getAuth(ctx, request);
    if (auth.user || auth.bearer) throw errors.notFound();
    throw auth.accountStatus === 'expired' ? errors.sessionExpired() : errors.unauthenticated();
  }
  const sessions = await sessionsFor(ctx, request, documentId);
  const access = await resolveAccess(ctx.accessDeps, sessions, documentId, {
    allowTrashed: options.allowTrashed,
  });
  if (!access.ok) throw accessError(access.error);
  recordActivity(ctx, access.grantingSessionIds);
  return access;
}

export function requireEdit(access: AccessGranted): void {
  if (canEdit(access.role)) return;
  throw errors.forbidden(
    access.document.status === 'archived'
      ? 'This document is archived and cannot be changed.'
      : 'You have view-only access to this document.',
  );
}

export function requireManage(access: AccessGranted): void {
  if (!access.canManage) throw errors.forbidden('Only administrators can do that.');
}

/**
 * CSRF check for cookie-authenticated mutations: the `X-RD-CSRF` header must
 * be present (a custom header cannot be sent cross-origin without a
 * preflight) and, when an account session is in use, must equal that
 * session's token. Bearer requests carry no ambient credentials and are exempt.
 */
export async function verifyCsrf(ctx: AppContext, request: FastifyRequest): Promise<void> {
  const auth = await getAuth(ctx, request);
  if (auth.bearerPresented) return;
  if (request.headers['sec-fetch-site'] === 'cross-site' && request.headers.cookie) {
    throw errors.csrf();
  }
  const header = request.headers[CSRF_HEADER];
  if (typeof header !== 'string' || header === '') throw errors.csrf();
  if (auth.user && auth.account) {
    const expected = csrfTokenFor(auth.account.id, ctx.config.sessionSecret);
    if (!safeEqualString(header, expected)) throw errors.csrf();
  }
}

export interface CookieOptions {
  path: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  maxAge?: number;
}

export function cookieOptions(ctx: AppContext, path: string, expiresAt?: Date): CookieOptions {
  const options: CookieOptions = {
    path,
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.cookieSecure,
  };
  if (expiresAt) {
    options.maxAge = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  }
  return options;
}

export function setSessionCookie(
  ctx: AppContext,
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
): void {
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(ctx, '/', expiresAt));
}

export function clearSessionCookie(ctx: AppContext, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, cookieOptions(ctx, '/'));
}

export function shareCookiePath(documentId: string): string {
  return `/api/documents/${documentId}`;
}
