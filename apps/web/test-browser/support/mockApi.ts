/**
 * An in-memory stand-in for the RealtimeDocs API, driven through
 * `page.route('**\/api/**')`.
 *
 * It is only as real as the contract: every request body is parsed with the
 * request schema and every response body with the response schema from
 * `@realtimedocs/contracts`, and a mismatch on either side is recorded in
 * `violations`, which fails the test. So these tests catch the web app
 * sending something the contract forbids, and catch this mock drifting from
 * the contract. They do not show how the real server behaves: authorization,
 * persistence and collaboration are the server's own tests' business.
 */
import {
  AcceptInvitationRequest,
  AccessListResponse,
  type AccessInfo,
  ApiErrorBody,
  AuditResponse,
  buildDesktopHandoffUrl,
  buildInvitationUrl,
  buildShareUrl,
  ChangePasswordRequest,
  CreateDocumentRequest,
  CreateInvitationRequest,
  CreateInvitationResponse,
  CreateShareRequest,
  CreateSnapshotRequest,
  CopyRevisionRequest,
  CSRF_HEADER,
  DEFAULT_LIMITS,
  HistoryQuery,
  HistoryResponse,
  HistoryRevisionResponse,
  NameRevisionRequest,
  CopyRevisionResponse,
  type HistoryEntry,
  type HistoryEvent,
  DesktopHandoffResponse,
  AdminReleasesResponse,
  DownloadsResponse,
  ReleaseListResponse,
  ReleaseSummary,
  DocumentResponse,
  DocumentsResponse,
  type DocumentSummary,
  type ErrorCode,
  HTTP_STATUS_BY_CODE,
  type Invitation,
  InvitationLookupRequest,
  InvitationLookupResponse,
  InvitationsResponse,
  isCapabilitySecret,
  ListDocumentsQuery,
  LoginRequest,
  type Member,
  MembersResponse,
  MetaResponse,
  type Participant,
  RestoreSnapshotResponse,
  RevokeOtherSessionsResponse,
  SessionResponse,
  SetMemberRequest,
  SignupRequest,
  ShareExchangeRequest,
  ShareExchangeResponse,
  type ShareGrant,
  ShareResponse,
  SharesResponse,
  ShareWithUrlResponse,
  type Snapshot,
  SnapshotResponse,
  SnapshotsResponse,
  UpdateDocumentRequest,
  UpdateProfileRequest,
  UpdateShareRequest,
  UpdateUserRequest,
  type User,
  UsersResponse,
} from '@realtimedocs/contracts';
import type { Page, Route } from '@playwright/test';
import type { z } from 'zod';
import {
  ago,
  ahead,
  days,
  INVITATION_IDS,
  NOW,
  PASSWORDS,
  SECRETS,
  seedAudit,
  seedDocuments,
  seedInvitations,
  seedLive,
  seedMembers,
  seedShares,
  seedSnapshots,
  SHARE_IDS,
  type StoredDocument,
  USERS,
} from './fixtures';

import { revisionContent, revisionDiff, seedHistory, seedHistoryEvents } from './historyFixtures';

export const PUBLIC_ORIGIN = 'https://docs.northwind.example';

/** `view=recent` is a short list. */
const RECENT_LIST_LENGTH = 12;

/** What `export?format=json` returns: a small document in the editor's own JSON. */
function exportedContent(title: string): unknown {
  const text = (value: string, marks?: { type: string }[]) => ({
    type: 'text',
    text: value,
    ...(marks ? { marks } : {}),
  });
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [text('Summary')] },
      {
        type: 'paragraph',
        content: [
          text(`Mock content of “${title}”, with `),
          text('bold', [{ type: 'bold' }]),
          text(' text.'),
        ],
      },
      {
        type: 'bulletList',
        content: ['First point', 'Second point'].map((item) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [text(item)] }],
        })),
      },
    ],
  };
}

for (const [name, secret] of Object.entries(SECRETS)) {
  if (!isCapabilitySecret(secret))
    throw new Error(`Fixture secret "${name}" is not 43 base64url characters.`);
}

export interface RecordedCall {
  method: string;
  /** Path without the query string. */
  path: string;
  search: string;
  /** Parsed JSON body, if any. */
  body: unknown;
  headers: Record<string, string>;
}

interface Override {
  method: string;
  pattern: RegExp;
  remaining: number;
  respond: (route: Route, call: RecordedCall) => Promise<void> | void;
}

export interface ErrorOptions {
  status?: number;
  message?: string;
  requestId?: string;
  retryAfterSeconds?: number;
  /** Field-level issues of a `validation_failed` answer. */
  issues?: { path: string; message: string }[];
  /** How many matching requests fail before the mock behaves normally again. */
  times?: number;
}

type Handler = (context: {
  call: RecordedCall;
  params: string[];
  query: URLSearchParams;
}) => Reply | Promise<Reply>;

type Reply =
  | { kind: 'json'; status: number; schema: z.ZodType; body: unknown }
  | { kind: 'empty' }
  | { kind: 'text'; body: string; contentType: string; filename: string }
  | { kind: 'error'; code: ErrorCode; options?: ErrorOptions };

const ok = (schema: z.ZodType, body: unknown, status = 200): Reply => ({
  kind: 'json',
  status,
  schema,
  body,
});
const empty: Reply = { kind: 'empty' };
const fail = (code: ErrorCode, options?: ErrorOptions): Reply => ({ kind: 'error', code, options });

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const ID_SEGMENT = '([^/]+)';

let counter = 0;
/** A fresh, valid UUID for objects created during a test. */
function newId(): string {
  counter += 1;
  return `c0ffee00-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

export class MockApi {
  /** Every API request the page made, in order. */
  readonly calls: RecordedCall[] = [];
  /** Requests no handler exists for. Always a test failure. */
  readonly unhandled: string[] = [];
  /** Contract mismatches: bad request bodies from the app, bad responses from this mock. */
  readonly violations: string[] = [];

  /** The signed-in account, or null. */
  user: User | null = null;
  csrfToken: string | null = null;
  /** Documents this browser holds a share-link session for, with the granted role. */
  readonly guestAccess = new Map<string, { role: 'viewer' | 'editor'; expiresAt: string | null }>();

  users: User[] = Object.values(USERS).map((user) => ({ ...user }));
  documents: StoredDocument[] = seedDocuments();
  members: Record<string, Member[]> = seedMembers();
  shares: Record<string, ShareGrant[]> = seedShares();
  snapshots: Record<string, Snapshot[]> = seedSnapshots();
  live: Record<string, Participant[]> = seedLive();
  invitations: Invitation[] = seedInvitations();
  audit = seedAudit();
  /** Version history: revisions (newest first) and administrative events per document. */
  history: Record<string, HistoryEntry[]> = seedHistory();
  historyEvents: Record<string, HistoryEvent[]> = seedHistoryEvents();
  /** Rows per history page, at most; a test lowers it to exercise "Load more". */
  historyPageSize = 50;
  /** `retentionDays` of the history answer. */
  historyRetentionDays = 0;

  /** Share links the exchange endpoint accepts: grant id → secret and target. */
  readonly shareSecrets = new Map<string, { secret: string; documentId: string }>();
  /** Invitation links the lookup/accept endpoints accept. */
  readonly inviteSecrets = new Map<string, string>([[INVITATION_IDS.pending, SECRETS.invite]]);

  /**
   * Sessions of the signed-in account in other browsers and desktop apps:
   * what "Sign out everywhere else" ends.
   */
  otherSessions = 2;

  /** Artificial delay for every response, in ms (to observe loading states). */
  latencyMs = 0;
  /**
   * While true every request fails at the network level. Set it together with
   * `context.setOffline(true)`: some browsers stop offline requests before they
   * reach a route handler and some do not, and the mock must not answer either way.
   */
  offline = false;

  /** `MetaResponse.signupEnabled`. Off, as on a default server. */
  signupEnabled = false;
  /** What `GET /api/downloads` answers: nothing published unless a test says so. */
  downloads: z.input<typeof DownloadsResponse> = { release: null, artifacts: [] };

  /** What `GET /api/v1/desktop/releases` answers: nothing published unless a test says so. */
  desktopReleases: z.input<typeof ReleaseListResponse> = { channel: 'stable', releases: [] };
  /** What `GET /api/admin/releases` answers. */
  adminReleases: z.input<typeof AdminReleasesResponse> = {
    configured: true,
    channels: [],
    legacyFiles: [],
  };

  private readonly overrides: Override[] = [];
  private readonly routes: { method: string; pattern: RegExp; handler: Handler }[] = [];

  constructor() {
    this.registerRoutes();
  }

  /* ----------------------------------------------------------- test API */

  async install(page: Page): Promise<void> {
    await page.route('**/api/**', (route) => this.handle(route));
  }

  signIn(user: User): void {
    this.user = { ...user };
    this.csrfToken = `csrf-${user.id.slice(0, 8)}`;
  }

  signOut(): void {
    this.user = null;
    this.csrfToken = null;
  }

  /** Makes the next matching request(s) fail with a contract error body. */
  failNext(method: string, pattern: RegExp, code: ErrorCode, options: ErrorOptions = {}): void {
    this.overrides.push({
      method,
      pattern,
      remaining: options.times ?? 1,
      respond: (route) => this.fulfillError(route, code, options),
    });
  }

  /** Makes the next matching request(s) fail at the network level (server unreachable). */
  abortNext(method: string, pattern: RegExp, times = 1): void {
    this.overrides.push({
      method,
      pattern,
      remaining: times,
      respond: (route) => route.abort('connectionrefused'),
    });
  }

  /** Holds the next matching request until the returned function is called. */
  holdNext(method: string, pattern: RegExp): () => void {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.overrides.push({
      method,
      pattern,
      remaining: 1,
      respond: async (route, call) => {
        await gate;
        await this.dispatch(route, call);
      },
    });
    return release;
  }

  callsTo(method: string, pattern: RegExp): RecordedCall[] {
    return this.calls.filter((call) => call.method === method && pattern.test(call.path));
  }

  document(id: string): StoredDocument {
    const found = this.documents.find((each) => each.id === id);
    if (!found) throw new Error(`No fixture document ${id}`);
    return found;
  }

  /* ------------------------------------------------------------ plumbing */

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    let body: unknown;
    const raw = request.postData();
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const call: RecordedCall = {
      method: request.method(),
      path: url.pathname,
      search: url.search,
      body,
      headers: request.headers(),
    };
    this.calls.push(call);

    if (this.offline) {
      await route.abort('internetdisconnected');
      return;
    }
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));

    const override = this.overrides.find(
      (each) => each.remaining > 0 && each.method === call.method && each.pattern.test(call.path),
    );
    if (override) {
      override.remaining -= 1;
      await override.respond(route, call);
      return;
    }
    await this.dispatch(route, call);
  }

  private async dispatch(route: Route, call: RecordedCall): Promise<void> {
    const url = new URL(route.request().url());
    for (const each of this.routes) {
      if (each.method !== call.method) continue;
      const match = each.pattern.exec(call.path);
      if (!match) continue;
      const reply = await each.handler({
        call,
        params: match.slice(1),
        query: url.searchParams,
      });
      await this.send(route, call, reply);
      return;
    }
    this.unhandled.push(`${call.method} ${call.path}${call.search}`);
    await route.fulfill({ status: 501, contentType: 'text/plain', body: 'Not mocked' });
  }

  private async send(route: Route, call: RecordedCall, reply: Reply): Promise<void> {
    if (reply.kind === 'empty') {
      await route.fulfill({ status: 204 });
      return;
    }
    if (reply.kind === 'error') {
      await this.fulfillError(route, reply.code, reply.options);
      return;
    }
    if (reply.kind === 'text') {
      await route.fulfill({
        status: 200,
        contentType: reply.contentType,
        headers: { 'content-disposition': `attachment; filename="${reply.filename}"` },
        body: reply.body,
      });
      return;
    }
    const parsed = reply.schema.safeParse(reply.body);
    if (!parsed.success) {
      this.violations.push(
        `Mock response for ${call.method} ${call.path} does not match the contract: ${parsed.error.message}`,
      );
    }
    await route.fulfill({
      status: reply.status,
      contentType: 'application/json',
      body: JSON.stringify(reply.body),
    });
  }

  private async fulfillError(
    route: Route,
    code: ErrorCode,
    options: ErrorOptions = {},
  ): Promise<void> {
    const body = {
      error: {
        code,
        message: options.message ?? `Mock error: ${code}`,
        ...(options.requestId ? { requestId: options.requestId } : {}),
        ...(options.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: options.retryAfterSeconds }
          : {}),
        ...(options.issues ? { issues: options.issues } : {}),
      },
    };
    const parsed = ApiErrorBody.safeParse(body);
    if (!parsed.success)
      this.violations.push(`Mock error body is invalid: ${parsed.error.message}`);
    await route.fulfill({
      status: options.status ?? HTTP_STATUS_BY_CODE[code],
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  }

  /** Parses a request body with its contract schema; records a violation when the app sent junk. */
  private input<S extends z.ZodType>(call: RecordedCall, schema: S): z.output<S> | null {
    const parsed = schema.safeParse(call.body ?? {});
    if (parsed.success) return parsed.data;
    this.violations.push(
      `Request ${call.method} ${call.path} does not match the contract: ${parsed.error.message}`,
    );
    return null;
  }

  /** Unsafe requests must carry the CSRF header: the session token, or the placeholder for guests. */
  private csrfOk(call: RecordedCall): boolean {
    const header = call.headers[CSRF_HEADER];
    if (this.user) return header === this.csrfToken;
    return typeof header === 'string' && header.length > 0;
  }

  private route(method: string, path: string, handler: Handler): void {
    const pattern = new RegExp(`^${path.replaceAll(':id', UUID).replaceAll(':any', ID_SEGMENT)}$`);
    const guarded: Handler =
      method === 'GET'
        ? handler
        : (context) => {
            if (!this.csrfOk(context.call)) {
              this.violations.push(
                `${context.call.method} ${context.call.path} was sent without the right ${CSRF_HEADER} header.`,
              );
              return fail('csrf_failed');
            }
            return handler(context);
          };
    this.routes.push({ method, pattern, handler: guarded });
  }

  /* -------------------------------------------------------------- access */

  private sessionBody(): z.output<typeof SessionResponse> {
    return {
      user: this.user,
      csrfToken: this.csrfToken,
      expiresAt: this.user ? ahead(days(7)) : null,
    };
  }

  private accessTo(document: StoredDocument): AccessInfo | null {
    const archived = document.status === 'archived';
    if (this.user?.role === 'admin') {
      return {
        role: archived ? 'viewer' : 'admin',
        via: 'workspace_admin',
        expiresAt: null,
        accountId: this.user.id,
      };
    }
    let best: AccessInfo | null = null;
    if (this.user) {
      const membership = (this.members[document.id] ?? []).find(
        (member) => member.userId === this.user?.id,
      );
      if (membership) {
        best = {
          role: archived ? 'viewer' : membership.role,
          via: 'membership',
          expiresAt: null,
          accountId: this.user.id,
        };
      }
    }
    const guest = this.guestAccess.get(document.id);
    if (guest && (!best || (best.role === 'viewer' && guest.role === 'editor'))) {
      best = {
        role: archived ? 'viewer' : guest.role,
        via: 'share_link',
        expiresAt: guest.expiresAt,
        accountId: this.user?.id ?? null,
      };
    }
    return best;
  }

  private summary(document: StoredDocument, access: AccessInfo): DocumentSummary {
    return { ...document, access };
  }

  /** Resolves a document for the current principal, or the error the server would answer with. */
  private open(id: string): { document: StoredDocument; access: AccessInfo } | Reply {
    const document = this.documents.find((each) => each.id === id);
    const access = document ? this.accessTo(document) : null;
    if (!document || !access) {
      const anyPrincipal = this.user !== null || this.guestAccess.size > 0;
      return fail(anyPrincipal ? 'not_found' : 'unauthenticated');
    }
    if (document.status === 'trashed') return fail('document_trashed');
    return { document, access };
  }

  private adminOnly(): Reply | null {
    if (!this.user) return fail('unauthenticated');
    if (this.user.role !== 'admin') return fail('forbidden');
    return null;
  }

  private adminDocument(id: string): StoredDocument | Reply {
    const denied = this.adminOnly();
    if (denied) return denied;
    const document = this.documents.find((each) => each.id === id);
    return document ?? fail('not_found');
  }

  /* -------------------------------------------------------------- routes */

  private registerRoutes(): void {
    const isReply = (value: unknown): value is Reply =>
      typeof value === 'object' && value !== null && 'kind' in value;

    this.route('GET', '/api/meta', () =>
      ok(MetaResponse, {
        name: 'RealtimeDocs',
        version: '0.1.0',
        schemaVersion: 1,
        minClientSchemaVersion: 1,
        protocolVersion: 1,
        publicOrigin: PUBLIC_ORIGIN,
        limits: { ...DEFAULT_LIMITS },
        imageMimeTypes: ['image/png', 'image/jpeg'],
        attachmentExtensions: ['pdf', 'txt'],
        signupEnabled: this.signupEnabled,
      }),
    );

    this.route('GET', '/api/downloads', () => ok(DownloadsResponse, this.downloads));
    this.route('GET', '/api/v1/desktop/releases', () =>
      ok(ReleaseListResponse, this.desktopReleases),
    );
    this.route('GET', '/api/v1/desktop/releases/:any', ({ params }) => {
      const found = this.desktopReleases.releases.find((r) => r.version === params[0]);
      return found ? ok(ReleaseSummary, found) : fail('not_found');
    });
    this.route('GET', '/api/admin/releases', () => ok(AdminReleasesResponse, this.adminReleases));

    this.route('POST', '/api/auth/signup', ({ call }) => {
      const body = this.input(call, SignupRequest);
      if (!body) return fail('validation_failed');
      if (!this.signupEnabled) return fail('forbidden', { message: 'Sign-up is turned off.' });
      if (this.users.some((user) => user.email === body.email.toLowerCase())) {
        return fail('conflict', { message: 'An account with this email already exists.' });
      }
      const account: User = {
        id: newId(),
        email: body.email.toLowerCase(),
        displayName: body.displayName,
        role: 'member',
        status: 'active',
        createdAt: NOW,
      };
      this.users = [...this.users, account];
      this.signIn(account);
      return ok(SessionResponse, this.sessionBody());
    });

    /* ----- authentication */
    this.route('GET', '/api/auth/session', () => ok(SessionResponse, this.sessionBody()));

    this.route('POST', '/api/auth/login', ({ call }) => {
      const body = this.input(call, LoginRequest);
      if (!body) return fail('validation_failed');
      const account = this.users.find((user) => user.email === body.email.toLowerCase());
      if (!account || PASSWORDS[account.email] !== body.password || account.status !== 'active') {
        return fail('unauthenticated', { message: 'Invalid email or password.' });
      }
      this.signIn(account);
      return ok(SessionResponse, this.sessionBody());
    });

    this.route('POST', '/api/auth/logout', () => {
      this.signOut();
      return empty;
    });

    this.route('PATCH', '/api/auth/profile', ({ call }) => {
      if (!this.user) return fail('unauthenticated');
      const body = this.input(call, UpdateProfileRequest);
      if (!body) return fail('validation_failed');
      this.user = { ...this.user, displayName: body.displayName };
      this.users = this.users.map((user) => (user.id === this.user?.id ? { ...this.user } : user));
      return ok(SessionResponse, this.sessionBody());
    });

    this.route('POST', '/api/auth/password', ({ call }) => {
      if (!this.user) return fail('unauthenticated');
      const body = this.input(call, ChangePasswordRequest);
      if (!body) return fail('validation_failed');
      if (PASSWORDS[this.user.email] !== body.currentPassword) {
        // The server's answer for a wrong current password: the session is fine, the field is not.
        return fail('validation_failed', {
          message: 'The request is not valid.',
          issues: [{ path: 'currentPassword', message: 'The current password is not correct.' }],
        });
      }
      // Changing the password ends the account's other sessions.
      this.otherSessions = 0;
      return empty;
    });

    this.route('POST', '/api/auth/sessions/revoke-others', () => {
      if (!this.user) return fail('unauthenticated');
      const revoked = this.otherSessions;
      this.otherSessions = 0;
      return ok(RevokeOtherSessionsResponse, { revoked });
    });

    /* ----- accounts and invitations */
    this.route(
      'GET',
      '/api/users',
      () => this.adminOnly() ?? ok(UsersResponse, { users: this.users }),
    );

    this.route('PATCH', '/api/users/:id', ({ call, params }) => {
      const denied = this.adminOnly();
      if (denied) return denied;
      const body = this.input(call, UpdateUserRequest);
      if (!body) return fail('validation_failed');
      if (params[0] === this.user?.id) {
        return fail('conflict', { message: 'You cannot change your own role or status.' });
      }
      this.users = this.users.map((user) =>
        user.id === params[0]
          ? { ...user, role: body.role ?? user.role, status: body.status ?? user.status }
          : user,
      );
      return ok(UsersResponse, { users: this.users });
    });

    this.route(
      'GET',
      '/api/invitations',
      () => this.adminOnly() ?? ok(InvitationsResponse, { invitations: this.invitations }),
    );

    this.route('POST', '/api/invitations', ({ call }) => {
      const denied = this.adminOnly();
      if (denied) return denied;
      const body = this.input(call, CreateInvitationRequest);
      if (!body) return fail('validation_failed');
      const invitation: Invitation = {
        id: newId(),
        email: body.email ?? null,
        role: body.role,
        state: 'pending',
        createdAt: NOW,
        createdByName: this.user?.displayName ?? null,
        expiresAt: new Date(Date.parse(NOW) + body.expiresInHours * 3_600_000).toISOString(),
        acceptedAt: null,
        acceptedByName: null,
      };
      this.invitations = [invitation, ...this.invitations];
      this.inviteSecrets.set(invitation.id, SECRETS.invite);
      return ok(CreateInvitationResponse, {
        invitation,
        url: buildInvitationUrl(PUBLIC_ORIGIN, invitation.id, SECRETS.invite),
      });
    });

    this.route('DELETE', '/api/invitations/:id', ({ params }) => {
      const denied = this.adminOnly();
      if (denied) return denied;
      this.invitations = this.invitations.map((invitation) =>
        invitation.id === params[0] ? { ...invitation, state: 'revoked' } : invitation,
      );
      this.inviteSecrets.delete(params[0] ?? '');
      return empty;
    });

    const findInvitation = (id: string, secret: string): Invitation | Reply => {
      const invitation = this.invitations.find((each) => each.id === id);
      if (!invitation || this.inviteSecrets.get(id) !== secret) return fail('invite_invalid');
      if (invitation.state === 'expired') return fail('invite_expired');
      if (invitation.state !== 'pending') return fail('invite_invalid');
      return invitation;
    };

    this.route('POST', '/api/invitations/lookup', ({ call }) => {
      const body = this.input(call, InvitationLookupRequest);
      if (!body) return fail('validation_failed');
      const invitation = findInvitation(body.invitationId, body.secret);
      if (isReply(invitation)) return invitation;
      return ok(InvitationLookupResponse, {
        email: invitation.email,
        role: invitation.role,
        workspaceName: 'Northwind Editorial',
        expiresAt: invitation.expiresAt,
      });
    });

    this.route('POST', '/api/invitations/accept', ({ call }) => {
      const body = this.input(call, AcceptInvitationRequest);
      if (!body) return fail('validation_failed');
      const invitation = findInvitation(body.invitationId, body.secret);
      if (isReply(invitation)) return invitation;
      const email = invitation.email ?? body.email;
      if (!email) return fail('validation_failed', { message: 'An email address is required.' });
      if (this.users.some((user) => user.email === email)) {
        return fail('conflict', { message: 'An account with this email already exists.' });
      }
      const account: User = {
        id: newId(),
        email,
        displayName: body.displayName,
        role: invitation.role,
        status: 'active',
        createdAt: NOW,
      };
      this.users = [...this.users, account];
      this.invitations = this.invitations.map((each) =>
        each.id === invitation.id
          ? { ...each, state: 'accepted', acceptedAt: NOW, acceptedByName: account.displayName }
          : each,
      );
      this.signIn(account);
      return ok(SessionResponse, this.sessionBody());
    });

    /* ----- documents */
    this.route('GET', '/api/documents', ({ query }) => {
      if (!this.user) return fail('unauthenticated');
      const parsed = ListDocumentsQuery.safeParse(Object.fromEntries(query));
      if (!parsed.success) {
        this.violations.push(`GET /api/documents query is invalid: ${parsed.error.message}`);
        return fail('validation_failed');
      }
      const { view, q } = parsed.data;
      const needle = q?.toLowerCase();
      const matchesView = (document: StoredDocument): boolean => {
        if (view === 'archived') return document.status === 'archived';
        if (view === 'trash') return document.status === 'trashed';
        // `active`, and `recent`: the active documents that changed last.
        return document.status === 'active';
      };
      /** Newest change of content or of metadata (title, state). */
      const changed = (document: DocumentSummary): string =>
        document.contentUpdatedAt > document.updatedAt
          ? document.contentUpdatedAt
          : document.updatedAt;
      const listed = this.documents
        .filter(matchesView)
        .filter((document) => !needle || document.title.toLowerCase().includes(needle))
        .flatMap((document) => {
          // The trash is an administrator's view: everyone else gets an empty list.
          const access =
            document.status === 'trashed' && this.user?.role !== 'admin'
              ? null
              : this.accessTo(document);
          return access ? [this.summary(document, access)] : [];
        });
      // The server's orders: recent by the latest change of any kind, trash by when it
      // was trashed, the others by `updatedAt` (which editing the text does not move).
      const documents =
        view === 'recent'
          ? listed.sort((a, b) => changed(b).localeCompare(changed(a))).slice(0, RECENT_LIST_LENGTH)
          : view === 'trash'
            ? listed.sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''))
            : listed.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return ok(DocumentsResponse, { documents });
    });

    this.route('POST', '/api/documents', ({ call }) => {
      const denied = this.adminOnly();
      if (denied) return denied;
      const body = this.input(call, CreateDocumentRequest);
      if (!body) return fail('validation_failed');
      const document: StoredDocument = {
        id: newId(),
        title: body.title ?? 'Untitled document',
        status: 'active',
        generation: 1,
        schemaVersion: 1,
        createdAt: NOW,
        updatedAt: NOW,
        contentUpdatedAt: NOW,
        archivedAt: null,
        trashedAt: null,
        purgeAfter: null,
        createdByName: this.user?.displayName ?? null,
      };
      this.documents = [document, ...this.documents];
      const access = this.accessTo(document);
      return access
        ? ok(DocumentResponse, { document: this.summary(document, access) }, 201)
        : fail('internal');
    });

    this.route('GET', '/api/documents/:id', ({ params }) => {
      const opened = this.open(params[0] ?? '');
      if (isReply(opened)) return opened;
      return ok(DocumentResponse, { document: this.summary(opened.document, opened.access) });
    });

    const mutateDocument = (
      id: string,
      change: (document: StoredDocument) => StoredDocument,
    ): Reply => {
      const found = this.adminDocument(id);
      if (isReply(found)) return found;
      const next = change(found);
      this.documents = this.documents.map((each) => (each.id === id ? next : each));
      const access = this.accessTo(next);
      return access
        ? ok(DocumentResponse, { document: this.summary(next, access) })
        : fail('internal');
    };

    this.route('PATCH', '/api/documents/:id', ({ call, params }) => {
      const body = this.input(call, UpdateDocumentRequest);
      if (!body) return fail('validation_failed');
      return mutateDocument(params[0] ?? '', (document) => ({
        ...document,
        title: body.title,
        updatedAt: NOW,
      }));
    });

    this.route('POST', '/api/documents/:id/duplicate', ({ params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      const copy: StoredDocument = {
        ...found,
        id: newId(),
        title: `Copy of ${found.title}`,
        status: 'active',
        generation: 1,
        createdAt: NOW,
        updatedAt: NOW,
        contentUpdatedAt: NOW,
        archivedAt: null,
        trashedAt: null,
        purgeAfter: null,
      };
      this.documents = [copy, ...this.documents];
      const access = this.accessTo(copy);
      return access
        ? ok(DocumentResponse, { document: this.summary(copy, access) }, 201)
        : fail('internal');
    });

    this.route('POST', '/api/documents/:id/archive', ({ params }) =>
      mutateDocument(params[0] ?? '', (document) => ({
        ...document,
        status: 'archived',
        archivedAt: NOW,
      })),
    );
    this.route('POST', '/api/documents/:id/unarchive', ({ params }) =>
      mutateDocument(params[0] ?? '', (document) => ({
        ...document,
        status: 'active',
        archivedAt: null,
      })),
    );
    this.route('POST', '/api/documents/:id/trash', ({ params }) =>
      mutateDocument(params[0] ?? '', (document) => ({
        ...document,
        status: 'trashed',
        trashedAt: NOW,
        purgeAfter: ahead(days(30)),
      })),
    );
    this.route('POST', '/api/documents/:id/restore', ({ params }) =>
      mutateDocument(params[0] ?? '', (document) => ({
        ...document,
        status: 'active',
        trashedAt: null,
        purgeAfter: null,
      })),
    );

    this.route('DELETE', '/api/documents/:id', ({ params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      if (found.status !== 'trashed') {
        return fail('conflict', {
          message: 'Only documents in the trash can be deleted permanently.',
        });
      }
      this.documents = this.documents.filter((each) => each.id !== found.id);
      return empty;
    });

    this.route('GET', '/api/documents/:id/export', ({ params, query }) => {
      const opened = this.open(params[0] ?? '');
      if (isReply(opened)) return opened;
      const format = query.get('format') ?? 'txt';
      if (format === 'json') {
        // The document format's own JSON, which the print view renders.
        return {
          kind: 'text',
          body: JSON.stringify(exportedContent(opened.document.title)),
          contentType: 'application/json; charset=utf-8',
          filename: 'export.json',
        };
      }
      return {
        kind: 'text',
        body: `${opened.document.title}\n\nMock export (${format}).\n`,
        contentType: format === 'md-zip' ? 'application/zip' : 'text/plain; charset=utf-8',
        filename: `export.${format === 'md-zip' ? 'zip' : format}`,
      };
    });

    /*
     * Collaboration. This mock has no collaboration server: the ticket request
     * is answered the way a server that cannot serve the document right now
     * answers it, so the editor waits and retries and the tests see the app
     * around it. Live editing is the real-stack suite's business
     * (`test-real/`). A test that needs the session to end uses `failNext`
     * with the code the server would give (`share_revoked`, `share_expired`…).
     */
    this.route('POST', '/api/documents/:id/collab-ticket', ({ params }) => {
      const opened = this.open(params[0] ?? '');
      if (isReply(opened)) return opened;
      return fail('server_busy', { message: 'No collaboration server in this test.' });
    });

    /* ----- access, members, share links */
    this.route('GET', '/api/documents/:id/access', ({ params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      return ok(AccessListResponse, {
        members: this.members[found.id] ?? [],
        shares: this.shares[found.id] ?? [],
        live: this.live[found.id] ?? [],
      });
    });

    this.route('GET', '/api/documents/:id/members', ({ params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      return ok(MembersResponse, { members: this.members[found.id] ?? [] });
    });

    this.route('PUT', '/api/documents/:id/members/:id', ({ call, params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      const body = this.input(call, SetMemberRequest);
      if (!body) return fail('validation_failed');
      const account = this.users.find((user) => user.id === params[1]);
      if (!account) return fail('not_found');
      const current = this.members[found.id] ?? [];
      const existing = current.find((member) => member.userId === account.id);
      const next: Member = {
        userId: account.id,
        email: account.email,
        displayName: account.displayName,
        role: body.role,
        userStatus: account.status,
        grantedAt: existing?.grantedAt ?? NOW,
      };
      this.members[found.id] = existing
        ? current.map((member) => (member.userId === account.id ? next : member))
        : [...current, next];
      return ok(MembersResponse, { members: this.members[found.id] ?? [] });
    });

    this.route('DELETE', '/api/documents/:id/members/:id', ({ params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      this.members[found.id] = (this.members[found.id] ?? []).filter(
        (member) => member.userId !== params[1],
      );
      return ok(MembersResponse, { members: this.members[found.id] ?? [] });
    });

    this.route('GET', '/api/documents/:id/shares', ({ params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      return ok(SharesResponse, { shares: this.shares[found.id] ?? [] });
    });

    const issueShare = (
      documentId: string,
      base: Partial<ShareGrant>,
    ): { share: ShareGrant; url: string } => {
      const share: ShareGrant = {
        id: newId(),
        documentId,
        role: 'viewer',
        label: '',
        state: 'active',
        createdAt: NOW,
        createdByName: this.user?.displayName ?? null,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        activeSessions: 0,
        liveConnections: 0,
        ...base,
      };
      this.shares[documentId] = [share, ...(this.shares[documentId] ?? [])];
      this.shareSecrets.set(share.id, { secret: SECRETS.share, documentId });
      return { share, url: buildShareUrl(PUBLIC_ORIGIN, share.id, SECRETS.share) };
    };

    this.route('POST', '/api/documents/:id/shares', ({ call, params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      const body = this.input(call, CreateShareRequest);
      if (!body) return fail('validation_failed');
      return ok(
        ShareWithUrlResponse,
        issueShare(found.id, { role: body.role, label: body.label, expiresAt: body.expiresAt }),
        201,
      );
    });

    const updateShare = (
      documentId: string,
      shareId: string,
      change: (share: ShareGrant) => ShareGrant,
    ): ShareGrant | Reply => {
      const found = this.adminDocument(documentId);
      if (isReply(found)) return found;
      const current = (this.shares[found.id] ?? []).find((share) => share.id === shareId);
      if (!current) return fail('not_found');
      const next = change(current);
      this.shares[found.id] = (this.shares[found.id] ?? []).map((share) =>
        share.id === shareId ? next : share,
      );
      return next;
    };

    const shareState = (documentId: string, shareId: string): ShareGrant['state'] | undefined =>
      (this.shares[documentId] ?? []).find((share) => share.id === shareId)?.state;

    this.route('PATCH', '/api/documents/:id/shares/:id', ({ call, params }) => {
      const body = this.input(call, UpdateShareRequest);
      if (!body) return fail('validation_failed');
      // A revoked link cannot be changed. An expired one can, for example to extend it.
      if (shareState(params[0] ?? '', params[1] ?? '') === 'revoked') {
        return fail('conflict', { message: 'A revoked link cannot be changed.' });
      }
      const next = updateShare(params[0] ?? '', params[1] ?? '', (share) => {
        const expiresAt = body.expiresAt === undefined ? share.expiresAt : body.expiresAt;
        return {
          ...share,
          role: body.role ?? share.role,
          label: body.label ?? share.label,
          expiresAt,
          state: expiresAt !== null && expiresAt <= NOW ? 'expired' : 'active',
        };
      });
      return isReply(next) ? next : ok(ShareResponse, { share: next });
    });

    const revoke = (share: ShareGrant): ShareGrant => ({
      ...share,
      state: 'revoked',
      revokedAt: NOW,
      activeSessions: 0,
      liveConnections: 0,
    });

    this.route('POST', '/api/documents/:id/shares/:id/revoke', ({ params }) => {
      const next = updateShare(params[0] ?? '', params[1] ?? '', revoke);
      if (isReply(next)) return next;
      this.shareSecrets.delete(next.id);
      return ok(ShareResponse, { share: next });
    });

    this.route('POST', '/api/documents/:id/shares/:id/rotate', ({ params }) => {
      const state = shareState(params[0] ?? '', params[1] ?? '');
      if (state !== undefined && state !== 'active') {
        return fail('conflict', { message: 'Only an active link can be rotated.' });
      }
      const old = updateShare(params[0] ?? '', params[1] ?? '', revoke);
      if (isReply(old)) return old;
      this.shareSecrets.delete(old.id);
      return ok(
        ShareWithUrlResponse,
        issueShare(old.documentId, { role: old.role, label: old.label, expiresAt: old.expiresAt }),
        201,
      );
    });

    this.route('POST', '/api/share/exchange', ({ call }) => {
      const body = this.input(call, ShareExchangeRequest);
      if (!body) return fail('validation_failed');
      const known = this.shareSecrets.get(body.grantId);
      const grant = Object.values(this.shares)
        .flat()
        .find((share) => share.id === body.grantId);
      if (!known || !grant || known.secret !== body.secret) return fail('share_invalid');
      if (grant.state === 'expired') return fail('share_expired');
      if (grant.state === 'revoked') return fail('share_revoked');
      const document = this.documents.find((each) => each.id === known.documentId);
      if (!document) return fail('share_invalid');
      if (document.status === 'trashed') return fail('document_trashed');
      this.guestAccess.set(document.id, { role: grant.role, expiresAt: grant.expiresAt });
      return ok(ShareExchangeResponse, {
        documentId: document.id,
        title: document.title,
        role: grant.role,
        expiresAt: grant.expiresAt,
      });
    });

    this.route('POST', '/api/documents/:id/share-session/end', ({ params }) => {
      this.guestAccess.delete(params[0] ?? '');
      return empty;
    });

    /* ----- snapshots */
    this.route('GET', '/api/documents/:id/snapshots', ({ params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      return ok(SnapshotsResponse, { snapshots: this.snapshots[found.id] ?? [] });
    });

    const addSnapshot = (
      document: StoredDocument,
      name: string,
      kind: Snapshot['kind'],
    ): Snapshot => {
      const snapshot: Snapshot = {
        id: newId(),
        documentId: document.id,
        name,
        kind,
        generation: document.generation,
        sizeBytes: 52_480,
        createdAt: NOW,
        createdByName: this.user?.displayName ?? null,
      };
      this.snapshots[document.id] = [snapshot, ...(this.snapshots[document.id] ?? [])];
      return snapshot;
    };

    this.route('POST', '/api/documents/:id/snapshots', ({ call, params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      const body = this.input(call, CreateSnapshotRequest);
      if (!body) return fail('validation_failed');
      return ok(SnapshotResponse, { snapshot: addSnapshot(found, body.name, 'named') }, 201);
    });

    this.route('POST', '/api/documents/:id/snapshots/:id/restore', ({ params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      const target = (this.snapshots[found.id] ?? []).find((snapshot) => snapshot.id === params[1]);
      if (!target) return fail('not_found');
      const preRestoreSnapshot = addSnapshot(
        found,
        `Before restoring “${target.name}”`,
        'pre_restore',
      );
      const next: StoredDocument = {
        ...found,
        generation: found.generation + 1,
        contentUpdatedAt: NOW,
        updatedAt: NOW,
      };
      this.documents = this.documents.map((each) => (each.id === found.id ? next : each));
      const access = this.accessTo(next);
      return access
        ? ok(RestoreSnapshotResponse, { document: this.summary(next, access), preRestoreSnapshot })
        : fail('internal');
    });

    this.route('DELETE', '/api/documents/:id/snapshots/:id', ({ params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      this.snapshots[found.id] = (this.snapshots[found.id] ?? []).filter(
        (snapshot) => snapshot.id !== params[1],
      );
      return empty;
    });

    /* ----- version history */
    this.route('GET', '/api/documents/:id/history', ({ call, params, query }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      const parsed = HistoryQuery.safeParse(Object.fromEntries(query));
      if (!parsed.success) {
        this.violations.push(`History query ${call.search} is invalid: ${parsed.error.message}`);
        return fail('validation_failed');
      }
      const q = parsed.data;
      const matching = (this.history[found.id] ?? []).filter(
        (each) =>
          (q.before === undefined || each.revision < q.before) &&
          (q.actor === undefined ||
            each.actor.name.toLowerCase().includes(q.actor.toLowerCase())) &&
          (q.operation === undefined || each.operation === q.operation) &&
          (q.from === undefined || Date.parse(each.committedAt) >= Date.parse(q.from)) &&
          (q.to === undefined || Date.parse(each.committedAt) <= Date.parse(q.to)),
      );
      const size = Math.min(q.limit, this.historyPageSize);
      const entries = matching.slice(0, size);
      const last = entries.at(-1);
      return ok(HistoryResponse, {
        entries,
        nextBefore: matching.length > size && last ? last.revision : null,
        events: q.before === undefined ? (this.historyEvents[found.id] ?? []) : [],
        retentionDays: this.historyRetentionDays,
      });
    });

    this.route('GET', '/api/documents/:id/history/export', ({ params, query }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      const format = query.get('format') === 'csv' ? 'csv' : 'json';
      return {
        kind: 'text',
        body: format === 'csv' ? 'revision,operation\r\n' : '{"entries":[]}',
        contentType: format === 'csv' ? 'text/csv' : 'application/json',
        filename: `history.${format}`,
      };
    });

    this.route('GET', '/api/documents/:id/history/:any/export', ({ params, query }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      const format = query.get('format') ?? 'json';
      return {
        kind: 'text',
        body: `Revision ${params[1]} (${format})`,
        contentType: 'text/plain',
        filename: `revision-${params[1]}.${format}`,
      };
    });

    this.route('GET', '/api/documents/:id/history/:any', ({ params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      const revision = Number(params[1]);
      const row = (this.history[found.id] ?? []).find((each) => each.revision === revision);
      if (!row) return fail('not_found');
      return ok(HistoryRevisionResponse, {
        entry: row,
        diff: revisionDiff(revision),
        diffTruncated: false,
        content: revisionContent(revision),
        pageSettings: null,
      });
    });

    this.route('POST', '/api/documents/:id/history/:any/name', ({ call, params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      const body = this.input(call, NameRevisionRequest);
      if (!body) return fail('validation_failed');
      if (!(this.history[found.id] ?? []).some((each) => each.revision === Number(params[1]))) {
        return fail('not_found');
      }
      return ok(SnapshotResponse, { snapshot: addSnapshot(found, body.name, 'named') }, 201);
    });

    this.route('POST', '/api/documents/:id/history/:any/copy', ({ call, params }) => {
      const found = this.adminDocument(params[0] ?? '');
      if (isReply(found)) return found;
      const body = this.input(call, CopyRevisionRequest);
      if (!body) return fail('validation_failed');
      const title = body.title ?? `${found.title} (revision ${params[1]})`;
      const copy: StoredDocument = {
        ...found,
        id: newId(),
        title,
        status: 'active',
        generation: 1,
        createdAt: NOW,
        updatedAt: NOW,
        contentUpdatedAt: NOW,
      };
      this.documents = [copy, ...this.documents];
      return ok(CopyRevisionResponse, { documentId: copy.id, title }, 201);
    });

    /* ----- desktop handoff, audit */
    this.route('POST', '/api/documents/:id/desktop-handoff', ({ params }) => {
      const opened = this.open(params[0] ?? '');
      if (isReply(opened)) return opened;
      return ok(
        DesktopHandoffResponse,
        {
          code: SECRETS.handoff,
          url: buildDesktopHandoffUrl({
            serverOrigin: PUBLIC_ORIGIN,
            documentId: opened.document.id,
            code: SECRETS.handoff,
          }),
          expiresAt: new Date(Date.parse(NOW) + 60_000).toISOString(),
        },
        201,
      );
    });

    this.route(
      'GET',
      '/api/audit',
      () => this.adminOnly() ?? ok(AuditResponse, { events: this.audit }),
    );
  }
}

/** Registers a share link the exchange endpoint will accept, for share-exchange tests. */
export function seedShareLink(
  api: MockApi,
  grantId: string,
  documentId: string,
  secret = SECRETS.share,
): void {
  api.shareSecrets.set(grantId, { secret, documentId });
}

export { ago, SHARE_IDS };
