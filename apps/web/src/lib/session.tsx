/**
 * Who is signed in.
 *
 * `GET /api/auth/session` answers with the account (or `null`) and the CSRF
 * token for this session. The token goes to the API client's memory; the
 * account is shared through this context. Share-link guests have no account:
 * `user` is `null` for them and every screen that supports guests must work
 * that way.
 */
import type { SessionResponse, User } from '@realtimedocs/contracts';
import { type QueryClient, type QueryKey, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, rememberSession, setCsrfToken } from './api';
import { isApiError } from './errors';
import { isWorkspaceAdmin } from './permissions';

export const SESSION_QUERY_KEY = ['session'] as const;

const SIGNED_OUT: SessionResponse = { user: null, csrfToken: null, expiresAt: null };
const SESSION_CHANNEL = 'rd-session';
/** `setTimeout` cannot wait longer than a signed 32-bit number of milliseconds. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export function fetchSession(): Promise<SessionResponse> {
  return api.auth.session().then(rememberSession);
}

export const sessionQueryOptions = {
  queryKey: SESSION_QUERY_KEY,
  queryFn: fetchSession,
  staleTime: 60_000,
  gcTime: Infinity,
} as const;

/** Why there is no account right now, for the sign-in screen's wording. */
export type SessionEndReason = 'expired' | 'signed_out' | null;

export interface SessionContextValue {
  /** `loading` until the server has answered once; `error` if it could not be asked. */
  status: 'loading' | 'ready' | 'error';
  user: User | null;
  isAdmin: boolean;
  expiresAt: string | null;
  /** Set when `status` is `error`. */
  error: unknown;
  endReason: SessionEndReason;
  /** Adopts the session returned by sign-in, invitation accept or a profile update. */
  adopt: (session: SessionResponse) => void;
  /** Asks the server again. */
  refresh: () => Promise<void>;
  /** Forgets the account locally, after the server confirmed the sign-out. */
  clear: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function isSessionQuery(queryKey: QueryKey): boolean {
  return queryKey[0] === SESSION_QUERY_KEY[0];
}

/**
 * Called for every failed request. When a signed-in tab is told its session is
 * gone (or its CSRF token no longer matches, which happens after signing in
 * as someone else in another tab) the session is fetched again; the screens
 * then follow whatever the server says. It never retries the failed request.
 */
export function handleAuthFailure(
  queryClient: QueryClient,
  error: unknown,
  queryKey?: QueryKey,
): void {
  if (!isApiError(error)) return;
  if (queryKey && isSessionQuery(queryKey)) return;
  if (
    error.code !== 'session_expired' &&
    error.code !== 'unauthenticated' &&
    error.code !== 'csrf_failed'
  ) {
    return;
  }
  const session = queryClient.getQueryData<SessionResponse>(SESSION_QUERY_KEY);
  if (!session?.user) return;
  void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
}

/** Drops everything cached for the previous principal; mounted screens load again. */
function resetAccountData(queryClient: QueryClient): void {
  void queryClient.resetQueries({ predicate: (query) => !isSessionQuery(query.queryKey) });
}

export function SessionProvider({ children }: { children?: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery(sessionQueryOptions);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const user = query.data?.user ?? null;
  const userId = user?.id ?? null;
  const expiresAt = query.data?.expiresAt ?? null;
  const { refetch } = query;

  // Why there is no account, decided in the same render in which the account
  // disappears, so that the redirect to sign-in already knows the reason.
  // `adopt` and `clear` announce an explicit change beforehand; an account that
  // vanishes any other way (the server says the session is gone) has expired.
  const [tracked, setTracked] = useState<{
    userId: string | null | undefined;
    endReason: SessionEndReason;
  }>({ userId: undefined, endReason: null });
  const [announced, setAnnounced] = useState<{
    userId: string | null;
    endReason: SessionEndReason;
  } | null>(null);
  let endReason = tracked.endReason;
  if (query.data !== undefined && tracked.userId !== userId) {
    if (announced && announced.userId === userId) {
      endReason = announced.endReason;
      setAnnounced(null);
    } else {
      endReason = userId === null && tracked.userId ? 'expired' : null;
    }
    setTracked({ userId, endReason });
  }

  const announce = useCallback(() => {
    try {
      channelRef.current?.postMessage('changed');
    } catch {
      // Other tabs catch up on focus instead.
    }
  }, []);

  const adopt = useCallback(
    (session: SessionResponse) => {
      rememberSession(session);
      setAnnounced({ userId: session.user?.id ?? null, endReason: null });
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
      announce();
    },
    [queryClient, announce],
  );

  const clear = useCallback(() => {
    setCsrfToken(null);
    setAnnounced({ userId: null, endReason: 'signed_out' });
    queryClient.setQueryData(SESSION_QUERY_KEY, SIGNED_OUT);
    announce();
  }, [queryClient, announce]);

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // Another tab signed in or out: ask the server who this browser is now.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = () => {
      void refetch();
    };
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [refetch]);

  // The account changed (sign-in, sign-out, expiry, another tab): nothing that
  // was loaded for the previous principal may stay on screen or in the cache.
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (query.data === undefined) return;
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (previous === undefined || previous === userId) return;
    resetAccountData(queryClient);
  }, [query.data, userId, queryClient]);

  // Re-check at the announced absolute expiry so the screen does not go stale.
  useEffect(() => {
    if (!expiresAt || userId === null) return undefined;
    const delay = Date.parse(expiresAt) - Date.now() + 1500;
    if (!Number.isFinite(delay) || delay <= 0 || delay > MAX_TIMER_MS) return undefined;
    const handle = window.setTimeout(() => {
      void refetch();
    }, delay);
    return () => window.clearTimeout(handle);
  }, [expiresAt, userId, refetch]);

  const status: SessionContextValue['status'] =
    query.data !== undefined ? 'ready' : query.isError ? 'error' : 'loading';

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      isAdmin: isWorkspaceAdmin(user),
      expiresAt,
      error: query.data === undefined ? query.error : null,
      endReason,
      adopt,
      refresh,
      clear,
    }),
    [status, user, expiresAt, query.data, query.error, endReason, adopt, refresh, clear],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession() must be used inside <SessionProvider>.');
  return value;
}

/** Removes cached data that belonged to the account that just signed out. */
export function forgetAccountData(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => !isSessionQuery(query.queryKey) });
}
