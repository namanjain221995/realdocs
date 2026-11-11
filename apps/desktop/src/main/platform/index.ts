import type { DesktopPlatform } from '../../shared/shortcuts';
import { darwinAdapter } from './darwin';
import { linuxAdapter } from './linux';
import type { PlatformAdapter } from './types';
import { win32Adapter } from './win32';

export type { PlatformAdapter, PresenceApplication, WorkspaceVisibility } from './types';

export function toDesktopPlatform(platform: NodeJS.Platform): DesktopPlatform {
  if (platform === 'win32' || platform === 'darwin') return platform;
  return 'linux';
}

export function selectPlatformAdapter(platform: NodeJS.Platform): PlatformAdapter {
  switch (toDesktopPlatform(platform)) {
    case 'win32':
      return win32Adapter;
    case 'darwin':
      return darwinAdapter;
    default:
      return linuxAdapter;
  }
}
