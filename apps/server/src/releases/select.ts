/** Pure release selection: platform detection, artifact choice, rollout and update decisions. */
import { createHash } from 'node:crypto';
import {
  archCandidates,
  pickArtifact,
  type ReleaseArch,
  type ReleasePlatform,
} from '@realtimedocs/contracts';
import { compareVersions } from './version';

export { archCandidates, pickArtifact };

/** Architecture assumed when a caller names a platform but not an architecture. */
export function defaultArch(platform: ReleasePlatform): ReleaseArch {
  // Apple Silicon is the common Mac today; 'universal' is tried next by archCandidates.
  return platform === 'macos' ? 'arm64' : 'x64';
}

export interface DetectedPlatform {
  source: 'sec-ch-ua-platform' | 'user-agent';
  platform: ReleasePlatform;
}

/**
 * Best-effort platform from request headers. Only a fallback when the caller did not say; the
 * result is reported to the client in `detected`. Android, iOS and ChromeOS are not desktop targets.
 */
export function detectPlatform(headers: {
  'sec-ch-ua-platform'?: string | string[];
  'user-agent'?: string | string[];
}): DetectedPlatform | null {
  const hint = String(headers['sec-ch-ua-platform'] ?? '')
    .replace(/"/g, '')
    .trim()
    .toLowerCase();
  if (hint === 'windows') return { source: 'sec-ch-ua-platform', platform: 'windows' };
  if (hint === 'macos') return { source: 'sec-ch-ua-platform', platform: 'macos' };
  if (hint === 'linux') return { source: 'sec-ch-ua-platform', platform: 'linux' };
  if (hint !== '') return null;
  const ua = String(headers['user-agent'] ?? '');
  if (/android|iphone|ipad|ipod|cros/i.test(ua)) return null;
  if (/windows nt/i.test(ua)) return { source: 'user-agent', platform: 'windows' };
  if (/macintosh|mac os x/i.test(ua)) return { source: 'user-agent', platform: 'macos' };
  if (/linux|x11/i.test(ua)) return { source: 'user-agent', platform: 'linux' };
  return null;
}

/** Stable 0–99 bucket of an install for one release: the same install always gets the same answer. */
export function rolloutBucket(installId: string, version: string): number {
  const digest = createHash('sha256').update(`${installId}\u0000${version}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/** Without an install id a client cannot be placed, so it is outside any partial rollout. */
export function inRollout(
  rolloutPercent: number | undefined,
  installId: string | undefined,
  version: string,
): boolean {
  if (rolloutPercent === undefined || rolloutPercent >= 100) return true;
  if (rolloutPercent <= 0 || !installId) return false;
  return rolloutBucket(installId, version) < rolloutPercent;
}

export interface UpdateInput {
  currentVersion: string;
  /** The release the channel points at, if any. */
  releaseVersion: string | null;
  minimumSupportedVersion: string | null;
  hasArtifact: boolean;
  rolloutPercent?: number;
  installId?: string;
  clientSchemaVersion?: number;
  clientProtocolVersion?: number;
  minClientSchemaVersion: number;
  protocolVersion: number;
}

export interface UpdateDecision {
  updateAvailable: boolean;
  required: boolean;
}

export function decideUpdate(input: UpdateInput): UpdateDecision {
  const belowMinimum =
    input.minimumSupportedVersion !== null &&
    compareVersions(input.currentVersion, input.minimumSupportedVersion) < 0;
  const incompatible =
    (input.clientSchemaVersion !== undefined &&
      input.clientSchemaVersion < input.minClientSchemaVersion) ||
    (input.clientProtocolVersion !== undefined &&
      input.clientProtocolVersion !== input.protocolVersion);
  const required = belowMinimum || incompatible;
  const newer =
    input.releaseVersion !== null &&
    compareVersions(input.releaseVersion, input.currentVersion) > 0;
  if (!input.hasArtifact || !newer || input.releaseVersion === null) {
    return { updateAvailable: false, required };
  }
  // A required update is never held back by a staged rollout.
  const eligible =
    required || inRollout(input.rolloutPercent, input.installId, input.releaseVersion);
  return { updateAvailable: eligible, required: required && eligible };
}
