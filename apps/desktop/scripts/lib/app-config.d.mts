// Types for app-config.mjs (used by test/unit/packaging.test.ts).
export type PackagePlatform = 'win32' | 'darwin' | 'linux';

export declare const APP_NAME: string;
export declare const APP_ID: string;
export declare const URL_SCHEME: string;
export declare const LINUX_EXECUTABLE: string;
export declare const PLATFORMS: readonly PackagePlatform[];
export declare const PUBLIC_PLATFORM: Readonly<
  Record<PackagePlatform, 'windows' | 'macos' | 'linux'>
>;
export declare function artifactFileName(
  version: string,
  platform: PackagePlatform,
  arch: string,
  ext: string,
): string;
export declare const ARCHS: Readonly<Record<PackagePlatform, readonly string[]>>;

/** Fuse name (as in `FuseV1Options`) to enabled/disabled. */
export declare function fuseSettings(platform: PackagePlatform): Record<string, boolean>;

export type MacSigningPlan =
  | { sign: false; note: string }
  | {
      sign: true;
      /** A keychain identity, or "-" for an ad-hoc signature. */
      identity: string;
      adHoc: boolean;
      /** Options for @electron/notarize, or null when not notarizing. */
      notarize: Record<string, string> | null;
      note: string;
    };

/** What to do about signing a macOS build on this host with this environment. */
export declare function macSigningPlan(input: {
  hostPlatform: string;
  env: Record<string, string | undefined>;
}): MacSigningPlan;
