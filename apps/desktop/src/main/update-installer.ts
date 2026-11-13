/**
 * The part of "Update and restart" that touches the installation, for a packaged build.
 *
 * All the work is in `scripts/lib/update-install.mjs` (plain Node, shared with
 * `scripts/update-check.mjs`, which exercises it on each operating system). This file only
 * supplies what the running app knows: where it is installed, its process id, and how to quit.
 */
import {
  findScratch,
  installBlocker,
  installationFor,
  removeScratch,
  stageUpdate,
  startSwapHelper,
  type InstallPlatform,
} from '../../scripts/lib/update-install.mjs';
import type { UpdateInstaller } from './update-service';

export interface AppInstallerOptions {
  platform: NodeJS.Platform;
  arch: string;
  /** `process.execPath` of the packaged app. */
  execPath: string;
  packaged: boolean;
  pid: number;
  /** The arguments this process was started with (without the executable). */
  argv: string[];
  env: NodeJS.ProcessEnv;
  /** The app's ordinary quit: flushes preferences and closes the windows. */
  quit: () => void;
}

const DEVELOPMENT =
  'This is a development build started from the source tree. Only a packaged app replaces itself.';

export function createAppInstaller(options: AppInstallerOptions): UpdateInstaller {
  const platform = options.platform as InstallPlatform;
  const supported = ['win32', 'darwin', 'linux'].includes(options.platform);
  const installation = supported ? installationFor(platform, options.execPath) : null;
  // Only switches that say where the profile is (and the sandbox switch of test containers) are
  // carried over to the new process.
  const relaunchArgs = options.argv.filter(
    (arg) => arg.startsWith('--user-data-dir=') || arg === '--no-sandbox',
  );

  return {
    blocker() {
      if (!options.packaged) return DEVELOPMENT;
      return installBlocker({
        platform: options.platform,
        execPath: options.execPath,
        env: options.env,
      });
    },

    async stage(file, offer, onPhase) {
      if (!installation) throw new Error('no installation');
      return stageUpdate({
        archive: file,
        platform,
        arch: options.arch,
        root: installation.root,
        version: offer.version,
        env: options.env,
        onPhase,
      });
    },

    discard(staged) {
      removeScratch(staged.stagingDir);
    },

    async handOver(staged, resultFile) {
      if (!installation) throw new Error('no installation');
      await startSwapHelper({
        platform,
        pid: options.pid,
        root: installation.root,
        stagedRoot: staged.stagedRoot,
        stagingDir: staged.stagingDir,
        resultFile,
        relaunchArgs,
        env: options.env,
      });
      // The helper is waiting for this process to end. Quit the ordinary way.
      options.quit();
    },

    cleanup() {
      if (!options.packaged || !installation) return;
      for (const directory of findScratch(installation.root)) removeScratch(directory);
    },
  };
}
