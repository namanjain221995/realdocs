import { DEFAULT_LIMITS, type Limits } from '@realtimedocs/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { queryKeys } from './queryKeys';

/**
 * Server metadata (`GET /api/meta`, public): effective limits and the
 * deployment's canonical origin. Cached for the life of the page.
 */
export function useServerMeta() {
  return useQuery({
    queryKey: queryKeys.meta,
    queryFn: () => api.meta(),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/**
 * Limits to validate against before sending. The server publishes its
 * effective values; until they arrive (or if they cannot be fetched) the
 * contract defaults apply. The server validates again either way.
 */
export function useLimits(): Limits {
  const meta = useServerMeta();
  const published = meta.data?.limits ?? {};
  const limits: Limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(limits) as (keyof Limits)[]) {
    const value = published[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) limits[key] = value;
  }
  return limits;
}
