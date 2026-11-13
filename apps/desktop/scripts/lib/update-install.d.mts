// Types for update-install.mjs (used by src/main/update-installer.ts, the unit tests and
// scripts/update-check.mjs).
export type InstallPlatform = 'win32' | 'darwin' | 'linux';
export type InstallArch = 'x64' | 'arm64';

export declare const APP_NAME: string;

export declare class UpdateInstallError extends Error {
  code: string;
  constructor(code: string, message: string);
}

export declare function installationFor(
  platform: string,
  execPath: string,
): { root: string; executable: string } | null;
export declare function executableIn(platform: InstallPlatform, root: string): string;
export declare function installBlocker(input: {
  platform: string;
  execPath: string;
  env?: Record<string, string | undefined>;
  probe?: (directory: string) => boolean;
}): string | null;
export declare function writableProbe(directory: string): boolean;

export interface ArchiveEntry {
  name: string;
  symlink?: boolean;
  directory?: boolean;
}
export declare function readZipEntries(file: string): Required<ArchiveEntry>[];
export declare function validateArchiveEntries(
  entries: ArchiveEntry[],
  target: { platform: InstallPlatform; arch: string },
): { ok: true; buildRelative: string } | { ok: false; reason: string };
export declare function verifyUnpackedTree(directory: string): void;
export declare function readAsarVersion(asarFile: string): string | null;
export declare function executableArch(file: string): 'x64' | 'arm64' | 'universal' | null;

export declare function stageUpdate(input: {
  archive: string;
  platform: InstallPlatform;
  arch: string;
  root: string;
  version: string;
  env?: Record<string, string | undefined>;
  onPhase?: (phase: 'unpacking' | 'checking') => void;
}): Promise<{ stagingDir: string; stagedRoot: string }>;
export declare function removeScratch(directory: string): boolean;
export declare function findScratch(root: string): string[];

export declare function safeRelaunchArgs(args: string[]): string[];
export interface HelperScriptInput {
  platform: InstallPlatform;
  pid: number;
  root: string;
  stagedRoot: string;
  stagingDir: string;
  backupDir: string;
  executable: string;
  readyFile: string;
  resultFile: string;
  relaunchArgs?: string[];
}
export declare function buildHelperScript(input: HelperScriptInput): {
  extension: '.ps1' | '.sh';
  content: string;
};
export declare function startSwapHelper(input: {
  platform: InstallPlatform;
  pid: number;
  root: string;
  stagedRoot: string;
  stagingDir: string;
  resultFile: string;
  relaunchArgs?: string[];
  env?: Record<string, string | undefined>;
  readyTimeoutMs?: number;
}): Promise<{ backupDir: string; scriptDir: string; scriptFile: string }>;
