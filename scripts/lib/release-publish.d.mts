export const CHANNELS: string[];
export const DEFAULT_MINIMUM_OS: Record<string, string>;
export function isVersion(value: unknown): boolean;
export function parseArtifactName(
  fileName: string,
): { version: string; platform: string; arch: string; format: string } | null;
export function signatureFor(
  platform: string,
  flags?: { signedWindows?: boolean; notarizedMacos?: boolean },
): string;
export function buildManifest(input: {
  version: string;
  channel: string;
  notes: string;
  files: { name: string; sizeBytes: number; sha256: string }[];
  signedWindows?: boolean;
  notarizedMacos?: boolean;
  minimumSupportedVersion?: string;
  minimumOs?: Record<string, string>;
  publishedAt?: string;
}): {
  version: string;
  channel: string;
  publishedAt: string;
  notes: string;
  minimumSupportedVersion?: string;
  artifacts: {
    platform: string;
    arch: string;
    format: string;
    fileName: string;
    sizeBytes: number;
    sha256: string;
    minimumOsVersion: string;
    signatureStatus: string;
  }[];
};
export function validateRollout(value: unknown): number;
export function buildPointer(
  version: string,
  rolloutPercent?: number,
): { version: string; rolloutPercent?: number };
export function SHA256SUMS(manifest: { artifacts: { sha256: string; fileName: string }[] }): string;
