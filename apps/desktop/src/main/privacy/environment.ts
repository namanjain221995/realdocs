/**
 * Environment detection for the Privacy Test Center. Only RealtimeDocs' own runtime is read:
 * nothing inspects other applications or processes, and the meeting-app and browser versions are
 * typed in by the user. The sources are injected so tests need no Electron.
 */
import type { DetectedEnvironment } from '../../shared/privacy/test-center';

export interface EnvironmentSource {
  appVersion(): string;
  electronVersion(): string;
  platform(): string;
  systemVersion(): string;
  displayCount(): number;
}

const PLATFORMS = ['win32', 'darwin', 'linux'] as const;

export function detectEnvironment(source: EnvironmentSource): DetectedEnvironment {
  const platform = source.platform();
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    throw new RangeError(`unsupported platform for the Privacy Test Center: ${platform}`);
  }
  const clean = (value: string, fallback: string): string => value.trim().slice(0, 120) || fallback;
  return {
    appVersion: clean(source.appVersion(), 'unknown'),
    electronVersion: clean(source.electronVersion(), 'unknown'),
    platform: platform as DetectedEnvironment['platform'],
    osVersion: clean(source.systemVersion(), 'unknown'),
    displayCount: Math.max(1, Math.floor(source.displayCount()) || 1),
  };
}

/** The Electron modules this needs, as a minimal structural type so callers pass `{ app, screen }`. */
export interface ElectronLike {
  app: { getVersion(): string };
  screen: { getAllDisplays(): readonly unknown[] };
}

export interface ProcessLike {
  versions: { electron?: string };
  platform: string;
  getSystemVersion(): string;
}

/** Wire-up: `electronEnvironmentSource({ app, screen }, process)`. Call after `app.whenReady()`. */
export function electronEnvironmentSource(
  electron: ElectronLike,
  proc: ProcessLike,
): EnvironmentSource {
  return {
    appVersion: () => electron.app.getVersion(),
    electronVersion: () => proc.versions.electron ?? '',
    platform: () => proc.platform,
    systemVersion: () => proc.getSystemVersion(),
    displayCount: () => electron.screen.getAllDisplays().length,
  };
}
