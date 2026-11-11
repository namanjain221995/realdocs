/**
 * Server connection and document session state machine: which server is
 * configured, whether it checks out, which document session is open, and
 * user-facing notices.
 *
 * Electron-free. The network client, credential store, preference store and
 * the question "may this app use another server?" are injected, so the flows
 * that matter for security — a link for another server, an expired or reused
 * code, switching servers only after an explicit yes that no window can give —
 * are unit-tested end to end with a fake server.
 */
import { randomBytes } from 'node:crypto';
import { isLoopbackOrigin } from '@realtimedocs/contracts';
import {
  DEEP_LINK_MESSAGES,
  SHARE_LINK_INVALID_MESSAGE,
  describeLinkForLog,
  evaluateDeepLink,
  evaluateShareLink,
} from '../shared/links';
import type { Preferences } from '../shared/preferences';
import {
  ORIGIN_POLICY_MESSAGES,
  evaluateServerOrigin,
  originHost,
  type LinkOriginContext,
  type ServerTransport,
} from '../shared/server-origin';
import type {
  ConnectionSnapshot,
  DocumentSessionInfo,
  Notice,
  NoticeTone,
  ServerInfo,
  SessionReport,
} from '../shared/state';
import type { ConnectionService } from './connection-service';
import type { CredentialStore, StoredSession } from './credential-store';
import { IpcError } from './ipc-router';
import { silentLogger, type Logger } from './logger';

/** The slice of the preference store this controller reads and writes. */
export interface ConnectionPreferencesPort {
  get(): Preferences;
  update(change: (current: Preferences) => Preferences): Preferences;
}

/** Which window asked. The panel shows other people's content; the settings window never does. */
export type RequestSource = 'panel' | 'settings';

/** "May this app start using another server?" */
export interface ServerChangeRequest {
  kind: 'switch_server' | 'set_server';
  /** Canonical origin of the server the link belongs to. */
  linkOrigin: string;
  /** The server in use now, if any. */
  currentOrigin: string | null;
}

export interface ConnectionControllerOptions {
  service: ConnectionService;
  credentials: CredentialStore;
  preferences: ConnectionPreferencesPort;
  /**
   * Asks the user whether the app may use another server, on a surface that
   * no page can reach or answer (the main process's own dialog). Resolves to
   * true only for an explicit yes. Without it, the server is never changed by
   * a link. `withdrawn` fires when the question is no longer wanted: the
   * dialog should close, and its answer no longer counts.
   */
  confirmServerChange?: (
    request: ServerChangeRequest,
    source: RequestSource,
    withdrawn: AbortSignal,
  ) => Promise<boolean>;
  /** How long a question may stay unanswered before it is withdrawn (the answer is then no). */
  confirmTimeoutMs?: number;
  /** Called whenever the snapshot changed. */
  onChange: () => void;
  /**
   * The app is about to switch to another server (the previous session is
   * already forgotten). Awaited: whatever the previous server left in this
   * profile is removed before the new origin takes effect.
   */
  onServerChanging?: () => Promise<void>;
  /** The server origin changed: the panel must reload to get its new CSP. */
  onServerChanged: () => void;
  /** A document was opened or an important notice was raised: make the panel visible without focusing it. */
  onReveal: () => void;
  /**
   * The document session is over. `clearLocalData`: the user asked, in
   * Settings, to forget the session (or switched servers), so unsent changes
   * and drafts kept on this computer for that account go as well. Otherwise
   * (the document was closed from the panel, or the server ended the session)
   * they stay: they are that account's own work and are sent or shown again
   * when it opens the document the next time.
   */
  onSessionClosed?: (closed: { accountId: string | null; clearLocalData: boolean }) => void;
  logger?: Logger;
  now?: () => number;
}

/** After a "no", the same server is not asked about again for this long. */
const DECLINE_COOLDOWN_MS = 10_000;
/** An unanswered question, and the link it holds, do not stay around longer than this. */
const CONFIRM_TIMEOUT_MS = 3 * 60_000;
const DEEP_LINK_WINDOW_MS = 10_000;
const DEEP_LINK_MAX_PER_WINDOW = 5;

function randomId(): string {
  return randomBytes(9).toString('base64url');
}

export class ConnectionController {
  private readonly service: ConnectionService;
  private readonly credentials: CredentialStore;
  private readonly preferences: ConnectionPreferencesPort;
  private readonly confirmServerChange: (
    request: ServerChangeRequest,
    source: RequestSource,
    withdrawn: AbortSignal,
  ) => Promise<boolean>;
  private readonly confirmTimeoutMs: number;
  private readonly onChange: () => void;
  private readonly onServerChanging: () => Promise<void>;
  private readonly onServerChanged: () => void;
  private readonly onReveal: () => void;
  private readonly onSessionClosed: (closed: {
    accountId: string | null;
    clearLocalData: boolean;
  }) => void;
  private readonly logger: Logger;
  private readonly now: () => number;

  private server: ServerInfo = emptyServer();
  private sessionRestored = false;
  /** Counts the credentials this process has used; see `DocumentSessionInfo.sequence`. */
  private sessionSequence = 0;
  private report: SessionReport | null = null;
  private busy: ConnectionSnapshot['busy'] = null;
  private notice: Notice | null = null;
  /** True while the user is being asked about a server change. */
  private confirming = false;
  /** Origins the user said no to, with the time of the answer. */
  private readonly declined = new Map<string, number>();
  private revalidation: Promise<void> | null = null;
  private deepLinkTimes: number[] = [];
  private checkGeneration = 0;

  constructor(options: ConnectionControllerOptions) {
    this.service = options.service;
    this.credentials = options.credentials;
    this.preferences = options.preferences;
    this.confirmServerChange = options.confirmServerChange ?? (() => Promise.resolve(false));
    this.confirmTimeoutMs = options.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS;
    this.onChange = options.onChange;
    this.onServerChanging = options.onServerChanging ?? (() => Promise.resolve());
    this.onServerChanged = options.onServerChanged;
    this.onReveal = options.onReveal;
    this.onSessionClosed = options.onSessionClosed ?? (() => undefined);
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? Date.now;
  }

  // ── Read side ────────────────────────────────────────────────────────────

  get serverOrigin(): string | null {
    return this.preferences.get().connection.serverOrigin;
  }

  /** Token and origin for the request-header decision. Main process only. */
  authContext(): { serverOrigin: string | null; token: string | null } {
    const session = this.credentials.getSession();
    const origin = this.serverOrigin;
    // A session for another origin is never used, even if one were somehow present.
    if (!session || !origin || session.serverOrigin !== origin) {
      return { serverOrigin: origin, token: null };
    }
    return { serverOrigin: origin, token: session.token };
  }

  snapshot(): ConnectionSnapshot {
    const connection = this.preferences.get().connection;
    const session = this.currentSession();
    return {
      server: { ...this.server, origin: connection.serverOrigin },
      session: session ? toSessionInfo(session, this.sessionRestored, this.sessionSequence) : null,
      report: this.report,
      busy: this.busy,
      notice: this.notice,
      allowInsecureLan: connection.allowInsecureLan,
      acceptedLinkOrigin: connection.acceptedLinkOrigin,
    };
  }

  // ── Startup ──────────────────────────────────────────────────────────────

  /** Restores the encrypted session reference (if any) and checks the server. */
  async start(): Promise<void> {
    const origin = this.serverOrigin;
    if (!origin) {
      this.server = emptyServer();
      this.onChange();
      return;
    }
    const policy = evaluateServerOrigin(origin, {
      allowInsecureLan: this.preferences.get().connection.allowInsecureLan,
    });
    if (!policy.ok) {
      // The saved address is no longer acceptable (for example the override was turned off).
      this.server = {
        ...emptyServer(),
        origin,
        status: 'unchecked',
        message: ORIGIN_POLICY_MESSAGES[policy.code],
      };
      await this.credentials.clear();
      this.onChange();
      return;
    }
    this.server = { ...emptyServer(), origin, transport: policy.transport, status: 'unchecked' };

    const restored = await this.credentials.restore(origin);
    if (restored.status === 'restored') {
      this.sessionRestored = true;
      this.sessionSequence += 1;
    } else if (restored.status === 'discarded' && restored.reason !== 'other_server') {
      this.setNotice(
        'info',
        'session_not_restored',
        'The previous document session could not be restored. Open the document again from the browser or paste a share link.',
      );
    }
    this.onChange();

    await this.runServerCheck(origin);
    if (this.currentSession()) await this.revalidateSession();
  }

  // ── Server ───────────────────────────────────────────────────────────────

  async setServer(input: string): Promise<void> {
    const allowInsecureLan = this.preferences.get().connection.allowInsecureLan;
    const policy = evaluateServerOrigin(input, { allowInsecureLan });
    if (!policy.ok) throw new IpcError(policy.code, ORIGIN_POLICY_MESSAGES[policy.code]);
    await this.switchServer(policy.origin, policy.transport);
    await this.runServerCheck(policy.origin);
  }

  async checkServer(): Promise<void> {
    const origin = this.serverOrigin;
    if (!origin) throw new IpcError('no_server', 'Set a server address first.');
    await this.runServerCheck(origin);
  }

  async setOptions(options: {
    allowInsecureLan?: boolean | undefined;
    acceptPublicOrigin?: boolean | undefined;
  }): Promise<void> {
    if (options.allowInsecureLan !== undefined) {
      const allow = options.allowInsecureLan;
      this.preferences.update((current) => ({
        ...current,
        connection: { ...current.connection, allowInsecureLan: allow },
      }));
      const origin = this.serverOrigin;
      // Turning the override off while a plain-HTTP LAN server is configured disconnects it.
      if (!allow && origin && !evaluateServerOrigin(origin, { allowInsecureLan: false }).ok) {
        await this.forgetSession(false);
        this.preferences.update((current) => ({
          ...current,
          connection: { ...current.connection, serverOrigin: null, acceptedLinkOrigin: null },
        }));
        this.server = emptyServer();
        this.onServerChanged();
      }
    }
    if (options.acceptPublicOrigin !== undefined) {
      const origin = this.serverOrigin;
      // The value always comes from the server check, never from the renderer.
      const reported = this.server.publicOrigin;
      const accepted =
        options.acceptPublicOrigin && origin && reported && reported !== origin ? reported : null;
      if (options.acceptPublicOrigin && !accepted) {
        throw new IpcError(
          'no_public_origin',
          'The server has not reported a different public address, so there is nothing to accept.',
        );
      }
      this.preferences.update((current) => ({
        ...current,
        connection: { ...current.connection, acceptedLinkOrigin: accepted },
      }));
    }
    this.onChange();
  }

  // ── Paste share link ─────────────────────────────────────────────────────

  /**
   * Opens a pasted share link.
   *
   * - A link for the configured server is exchanged at once — unless the
   *   request comes from the panel while a document is open there. The panel
   *   only offers its paste field when it is empty; a request at any other
   *   time did not come from that field, and whatever sent it must not be
   *   able to replace the document the reader opened.
   * - A link for another server (or the first server) changes where this app
   *   sends links and credentials. That needs the user's explicit yes, asked
   *   by the main process itself (`confirmServerChange`); no window can give
   *   it. A "no" is remembered for a few seconds, so a page cannot ask again
   *   and again, and a question nobody answers is withdrawn after a few
   *   minutes, together with the link it was holding.
   */
  async openShareLink(link: string, source: RequestSource = 'settings'): Promise<void> {
    const options = { allowInsecureLan: this.preferences.get().connection.allowInsecureLan };
    const decision = evaluateShareLink(link, this.linkContext(), options);
    if (decision.action === 'reject') {
      const message =
        decision.code === 'invalid_link'
          ? SHARE_LINK_INVALID_MESSAGE
          : `This link points to ${decision.linkOrigin ? originHost(decision.linkOrigin) : 'a server'} over a connection this app does not accept. ${ORIGIN_POLICY_MESSAGES[decision.code]}`;
      throw new IpcError(decision.code, message);
    }
    if (source === 'panel' && this.currentSession()) {
      throw new IpcError(
        'document_open',
        'A document is open. Close it first, or paste the link in Settings.',
      );
    }
    if (decision.action === 'exchange') {
      const origin = this.serverOrigin;
      if (!origin) throw new IpcError('no_server', 'Set a server address first.');
      await this.exchange(origin, decision.grantId, decision.secret);
      return;
    }

    // Another server. Ask, once at a time, and not again right after a "no".
    const linkOrigin = decision.linkOrigin;
    if (this.confirming) {
      throw new IpcError(
        'confirmation_open',
        'Answer the question that is already open first, then paste the link again.',
      );
    }
    const now = this.now();
    for (const [origin, at] of this.declined) {
      if (now - at >= DECLINE_COOLDOWN_MS) this.declined.delete(origin);
    }
    if (this.declined.has(linkOrigin)) {
      throw new IpcError(
        'declined',
        `You chose not to use ${originHost(linkOrigin)} a moment ago. Paste the link again in a few seconds if you changed your mind.`,
      );
    }
    this.confirming = true;
    this.busy = 'confirming';
    this.onChange();
    let answer: 'yes' | 'no' | 'unanswered';
    try {
      answer = await this.ask(
        {
          kind: decision.reason === 'no_server_configured' ? 'set_server' : 'switch_server',
          linkOrigin,
          currentOrigin: this.serverOrigin,
        },
        source,
      );
    } finally {
      this.confirming = false;
      if (this.busy === 'confirming') this.busy = null;
      this.onChange();
    }
    if (answer !== 'yes') {
      this.declined.set(linkOrigin, this.now());
      if (answer === 'unanswered') {
        this.setNotice(
          'info',
          'confirmation_expired',
          `The question about using ${originHost(linkOrigin)} was closed because it was not answered. Nothing was changed. Paste the link again if you want to open it.`,
        );
      }
      return;
    }

    // The answer was about this origin. Everything else is checked again now,
    // because the dialog may have been open for a while.
    const policy = evaluateServerOrigin(linkOrigin, options);
    if (!policy.ok) throw new IpcError(policy.code, ORIGIN_POLICY_MESSAGES[policy.code]);
    if (policy.origin !== linkOrigin) {
      throw new IpcError('invalid_link', SHARE_LINK_INVALID_MESSAGE);
    }
    await this.switchServer(policy.origin, policy.transport);
    try {
      const check = await this.runServerCheck(policy.origin);
      // The secret is only sent to a server that answered as RealtimeDocs.
      if (check !== 'ok') {
        throw new IpcError(
          'server_check_failed',
          this.server.message ?? 'The server could not be verified, so the link was not opened.',
        );
      }
      await this.exchange(policy.origin, decision.grantId, decision.secret);
    } catch (error) {
      // The panel was reloaded for the new server, so the page that asked can
      // no longer show why the document did not open. Say it in a notice.
      if (error instanceof IpcError) {
        this.setNotice(
          'danger',
          error.code,
          `Now using ${originHost(policy.origin)}, but the link could not be opened. ${error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Asks the question and waits for the answer, but not for ever: when the
   * time is up the question is withdrawn (the dialog closes) and whatever the
   * dialog reports afterwards no longer counts.
   */
  private async ask(
    request: ServerChangeRequest,
    source: RequestSource,
  ): Promise<'yes' | 'no' | 'unanswered'> {
    const withdrawn = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeUp = new Promise<'unanswered'>((resolve) => {
      timer = setTimeout(() => {
        resolve('unanswered');
        withdrawn.abort();
      }, this.confirmTimeoutMs);
    });
    try {
      return await Promise.race([
        this.confirmServerChange(request, source, withdrawn.signal).then((accepted) =>
          accepted ? ('yes' as const) : ('no' as const),
        ),
        timeUp,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Open in Desktop (deep link) ──────────────────────────────────────────

  /**
   * Handles a `realtimedocs://` link from the operating system. Never throws:
   * the outcome is a notice. A link for another server is rejected without
   * any network request.
   */
  async handleDeepLink(url: unknown): Promise<void> {
    const now = this.now();
    this.deepLinkTimes = this.deepLinkTimes.filter((time) => now - time < DEEP_LINK_WINDOW_MS);
    if (this.deepLinkTimes.length >= DEEP_LINK_MAX_PER_WINDOW || this.busy === 'opening') {
      this.logger.warn('deep_link.throttled', {});
      // Any web page can fire these links, so a burst is dropped without a
      // request. Say so once, rather than failing silently or once per link.
      if (this.notice?.code !== 'too_many_links') {
        this.setNotice(
          'warning',
          'too_many_links',
          'Several "Open in Desktop" links arrived at once, so the extra ones were ignored. Wait a few seconds and try again.',
        );
      }
      return;
    }
    this.deepLinkTimes.push(now);

    const decision = evaluateDeepLink(url, this.linkContext());
    if (decision.action === 'reject') {
      this.logger.warn('deep_link.rejected', {
        reason: decision.code,
        target: describeLinkForLog(url),
      });
      const detail =
        decision.code === 'server_mismatch' && decision.linkHost && this.serverOrigin
          ? ` The link is for ${decision.linkHost}; this app is connected to ${originHost(this.serverOrigin)}.`
          : '';
      this.setNotice('warning', decision.code, `${DEEP_LINK_MESSAGES[decision.code]}${detail}`);
      this.onReveal();
      return;
    }

    const origin = this.serverOrigin;
    if (!origin) return;
    this.busy = 'opening';
    this.onChange();
    const result = await this.service.redeemHandoff(origin, decision.documentId, decision.code);
    this.busy = null;
    if (!result.ok) {
      this.setNotice('danger', result.code, result.message);
      this.onReveal();
      return;
    }
    await this.adoptSession(result.session);
  }

  // ── Session ──────────────────────────────────────────────────────────────

  /**
   * Closes the document: the session ends on the server and the stored
   * credential is deleted. `forget` (Settings only) additionally removes what
   * the account kept on this computer.
   */
  async disconnect(options: { forget: boolean } = { forget: true }): Promise<void> {
    this.busy = 'disconnecting';
    this.onChange();
    await this.forgetSession(true, options.forget);
    this.busy = null;
    this.onChange();
  }

  /**
   * Asks the server whether the session still exists and refreshes title, role
   * and expiry. One check at a time: further calls join the one in flight.
   */
  revalidateSession(): Promise<void> {
    this.revalidation ??= this.revalidateOnce().finally(() => {
      this.revalidation = null;
    });
    return this.revalidation;
  }

  private async revalidateOnce(): Promise<void> {
    const session = this.currentSession();
    if (!session) return;
    const check = await this.service.checkSession(session);
    if (this.currentSession()?.token !== session.token) return;
    if (check.ok) {
      if (
        check.title !== session.title ||
        check.role !== session.role ||
        check.expiresAt !== session.expiresAt
      ) {
        await this.credentials.set({
          ...session,
          title: check.title,
          role: check.role,
          expiresAt: check.expiresAt,
        });
      }
      this.onChange();
      return;
    }
    if (check.ended) {
      await this.credentials.clear();
      this.report = null;
      this.sessionRestored = false;
      this.setNotice('warning', check.code, check.message);
      this.onSessionClosed({ accountId: session.accountId, clearLocalData: false });
    }
    this.onChange();
  }

  /**
   * Live status from the panel's editor session. A state in which the editor
   * has given up (access removed or expired, document gone) is never taken at
   * face value: the server is asked, and only its answer ends the session.
   */
  reportSession(report: Omit<SessionReport, 'at'>): void {
    if (!this.currentSession()) return;
    // A report from an editor session that belonged to an earlier credential.
    if (report.sequence !== this.sessionSequence) return;
    this.report = { ...report, at: new Date(this.now()).toISOString() };
    this.onChange();
    if (
      report.connection === 'access_revoked' ||
      report.connection === 'access_expired' ||
      report.connection === 'document_unavailable'
    ) {
      void this.revalidateSession();
    }
  }

  dismissNotice(id: string): void {
    if (this.notice?.id === id) {
      this.notice = null;
      this.onChange();
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private currentSession(): StoredSession | null {
    const session = this.credentials.getSession();
    return session && session.serverOrigin === this.serverOrigin ? session : null;
  }

  private linkContext(): LinkOriginContext {
    const connection = this.preferences.get().connection;
    return {
      serverOrigin: connection.serverOrigin,
      acceptedLinkOrigin: connection.acceptedLinkOrigin,
    };
  }

  private setNotice(tone: NoticeTone, code: string, message: string): void {
    this.notice = { id: randomId(), tone, code, message, at: new Date(this.now()).toISOString() };
    this.onChange();
  }

  private async switchServer(origin: string, transport: ServerTransport): Promise<void> {
    const previous = this.serverOrigin;
    if (previous !== origin) {
      await this.forgetSession(true);
      await this.onServerChanging().catch(() => undefined);
      this.preferences.update((current) => ({
        ...current,
        connection: { ...current.connection, serverOrigin: origin, acceptedLinkOrigin: null },
      }));
      this.notice = null;
    }
    this.server = { ...emptyServer(), origin, transport, status: 'checking' };
    this.onChange();
    if (previous !== origin) this.onServerChanged();
  }

  private async runServerCheck(origin: string): Promise<ServerInfo['status']> {
    const generation = ++this.checkGeneration;
    this.busy = this.busy ?? 'checking';
    this.server = { ...this.server, origin, status: 'checking', message: null };
    this.onChange();
    const check = await this.service.checkServer(origin);
    // A newer check (or a server change) supersedes this result.
    if (generation !== this.checkGeneration || this.serverOrigin !== origin)
      return this.server.status;
    if (this.busy === 'checking') this.busy = null;
    let message = check.message;
    if (check.status === 'ok' && this.server.transport === 'insecure_lan_http') {
      message =
        'Reachable over plain HTTP (development override). Traffic to this server, including the document and your session, is not encrypted.';
    } else if (check.status === 'ok' && isLoopbackOrigin(origin)) {
      message =
        'Reachable on this computer (localhost). If the server runs elsewhere, this address only works while your tunnel is open.';
    }
    this.server = {
      ...this.server,
      origin,
      status: check.status,
      message,
      serverVersion: check.serverVersion,
      publicOrigin: check.publicOrigin,
      checkedAt: new Date(this.now()).toISOString(),
    };
    // An accepted alias is only valid while the server still reports it.
    const accepted = this.preferences.get().connection.acceptedLinkOrigin;
    if (accepted && check.status === 'ok' && check.publicOrigin !== accepted) {
      this.preferences.update((current) => ({
        ...current,
        connection: { ...current.connection, acceptedLinkOrigin: null },
      }));
    }
    this.onChange();
    return check.status;
  }

  private async exchange(origin: string, grantId: string, secret: string): Promise<void> {
    this.busy = 'opening';
    this.onChange();
    const result = await this.service.exchangeShareLink(origin, grantId, secret);
    this.busy = null;
    if (!result.ok) {
      this.onChange();
      throw new IpcError(result.code, result.message);
    }
    await this.adoptSession(result.session);
  }

  private async adoptSession(session: StoredSession): Promise<void> {
    const previous = this.credentials.getSession();
    if (previous && previous.token !== session.token) {
      // End the superseded session on the server; do not wait for it.
      void this.service.logout(previous);
    }
    await this.credentials.set(session);
    this.sessionRestored = false;
    this.sessionSequence += 1;
    this.report = null;
    this.notice = null;
    this.onChange();
    this.onReveal();
  }

  /**
   * Ends the session here and, if asked, on the server. `clearLocalData`:
   * also remove what that account kept on this computer (unsent changes,
   * recovery drafts).
   */
  private async forgetSession(notifyServer: boolean, clearLocalData = true): Promise<void> {
    const session = this.credentials.getSession();
    if (session && notifyServer) await this.service.logout(session);
    await this.credentials.clear();
    this.report = null;
    this.sessionRestored = false;
    if (session) this.onSessionClosed({ accountId: session.accountId, clearLocalData });
  }
}

function emptyServer(): ServerInfo {
  return {
    origin: null,
    transport: null,
    status: 'unset',
    message: null,
    serverVersion: null,
    publicOrigin: null,
    checkedAt: null,
  };
}

function toSessionInfo(
  session: StoredSession,
  restored: boolean,
  sequence: number,
): DocumentSessionInfo {
  return {
    documentId: session.documentId,
    title: session.title,
    role: session.role,
    expiresAt: session.expiresAt,
    accountId: session.accountId,
    via: session.via,
    restored,
    sequence,
  };
}
