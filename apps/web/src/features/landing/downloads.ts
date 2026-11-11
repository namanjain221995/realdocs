import type { DownloadArtifact } from '@realtimedocs/contracts';

/** `84.3 MB`, `512 KB`, `900 B`: decimal units, as download pages and file managers show them. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

/** The name a person knows their computer by. */
export function buildLabel(artifact: Pick<DownloadArtifact, 'platform' | 'arch'>): string {
  if (artifact.platform === 'windows') {
    return artifact.arch === 'x64' ? 'Windows x64' : 'Windows arm64';
  }
  return artifact.arch === 'arm64' ? 'macOS Apple Silicon (arm64)' : 'macOS Intel (x64)';
}

const ORDER = ['windows-x64', 'windows-arm64', 'macos-arm64', 'macos-x64'];

/** Published builds in a stable order. A build the server did not list is never added. */
export function orderBuilds(artifacts: readonly DownloadArtifact[]): DownloadArtifact[] {
  const rank = (artifact: DownloadArtifact): number => {
    const at = ORDER.indexOf(`${artifact.platform}-${artifact.arch}`);
    return at === -1 ? ORDER.length : at;
  };
  return [...artifacts].sort((a, b) => rank(a) - rank(b));
}

/** Only same-origin download paths become links; anything else the server sent is not offered. */
export function isDownloadPath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}
