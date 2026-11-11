import { MutationCache, QueryCache, QueryClient, type QueryKey } from '@tanstack/react-query';
import { isApiError, isClientError } from './errors';

const MAX_QUERY_RETRIES = 2;

/**
 * Retry rule for reads.
 * - 4xx (including 429): never. The server answered; asking again cannot help
 *   and a rate limit must not be hammered.
 * - Contract mismatches and cancellations: never.
 * - Network failures and 5xx: twice, with backoff.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isClientError(error)) return false;
  if (isApiError(error) && (error.code === 'invalid_response' || error.code === 'aborted')) {
    return false;
  }
  return failureCount < MAX_QUERY_RETRIES;
}

export function retryDelay(attemptIndex: number): number {
  return Math.min(600 * 2 ** attemptIndex, 5000);
}

export interface QueryClientHooks {
  /**
   * Called for every failed query or mutation, after its own error handling.
   * `queryKey` is present for queries.
   */
  onError?: (error: unknown, queryKey?: QueryKey) => void;
}

export function createQueryClient(hooks: QueryClientHooks = {}): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => hooks.onError?.(error, query.queryKey),
    }),
    mutationCache: new MutationCache({ onError: (error) => hooks.onError?.(error) }),
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        retryDelay,
        staleTime: 15_000,
        // Always attempt the request. With the default mode a query made while
        // offline pauses silently and the page shows a loading state forever;
        // here it fails fast and the page shows its offline screen instead.
        networkMode: 'always',
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
      },
      mutations: {
        // Writes are never repeated automatically, and never queued for later:
        // a revoke or delete that fires minutes after the click is worse than an error.
        retry: false,
        networkMode: 'always',
      },
    },
  });
}
