import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { fromLegacy, fromRelease, type DisplayRelease } from './downloads';

export interface DesktopReleases {
  /** The release the stable channel points at, or null when nothing is published. */
  current: DisplayRelease | null;
  /** Newest first. Empty on a server still using the legacy flat files. */
  history: DisplayRelease[];
}

/**
 * The published desktop builds. Prefers the versioned release store; a server that has not
 * migrated yet (only the four flat files in `DOWNLOAD_DIR`) is read through the legacy listing.
 */
export async function loadDesktopReleases(): Promise<DesktopReleases> {
  try {
    const list = await api.desktopReleases.list('stable');
    const releases = list.releases.map(fromRelease);
    const current = list.releases.find((r) => r.current && r.artifacts.length > 0);
    const chosen = current
      ? fromRelease(current)
      : (releases.find((r) => r.artifacts.length > 0) ?? null);
    if (chosen) return { current: chosen, history: releases };
  } catch {
    // Fall through to the legacy listing; if that fails too, its error is the one shown.
  }
  const legacy = fromLegacy(await api.downloads());
  return { current: legacy, history: [] };
}

export function useDesktopRelease() {
  return useQuery({
    queryKey: queryKeys.desktopRelease,
    queryFn: loadDesktopReleases,
    staleTime: 60_000,
    retry: 1,
  });
}
