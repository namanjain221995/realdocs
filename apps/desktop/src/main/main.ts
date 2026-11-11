/**
 * Main-process entry point.
 *
 * Bundled to CommonJS (`dist/main/main.cjs`) on purpose: everything in this
 * file up to `app.whenReady()` must run synchronously before Electron's
 * `ready` event — the privileged scheme registration, the single-instance
 * lock and the macOS `open-url` listener — and a CommonJS bundle guarantees
 * that ordering without top-level-await bookkeeping.
 */
import path from 'node:path';
import { app } from 'electron';
import { findDeepLinkArg } from '../shared/links';
import { registerAppScheme } from './app-protocol';
import { AppController, type TestSwitches } from './controller';
import { createLogger } from './logger';
import { selectPlatformAdapter } from './platform';
import type { EncryptionAdapter } from './credential-store';
import { createTestKeystore, installTestHook } from './test-hook';

/** Replaced at build time. `false` in production bundles, which removes the test hook entirely. */
declare const __RD_TEST_HOOK__: boolean;

const logger = createLogger(undefined, app.isPackaged ? 'info' : 'debug');

app.setName('RealtimeDocs');

// Development and automated tests can use a separate profile directory. A
// packaged build always uses the operating system's standard location.
if (!app.isPackaged && process.env.RD_DESKTOP_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.RD_DESKTOP_USER_DATA));
}

if (app.isPackaged) {
  // A packaged build never exposes remote debugging, whatever the command line says.
  for (const name of [
    'remote-debugging-port',
    'remote-debugging-pipe',
    'remote-debugging-address',
    'remote-allow-origins',
    'inspect',
    'inspect-brk',
    'inspect-port',
  ]) {
    app.commandLine.removeSwitch(name);
  }
}

// Every renderer is sandboxed, regardless of per-window options.
app.enableSandbox();
registerAppScheme();

const QUIT_DEADLINE_MS = 4000;
const pendingDeepLinks: string[] = [];
let controller: AppController | null = null;

function deliverDeepLink(url: string): void {
  if (controller) controller.handleDeepLink(url);
  else pendingDeepLinks.push(url);
}

// macOS delivers links through this event, possibly before `ready` on a cold start.
app.on('open-url', (event, url) => {
  event.preventDefault();
  deliverDeepLink(url);
  controller?.handleReactivation({ focus: false });
});

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  // Another instance is running and has just received our arguments.
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const link = findDeepLinkArg(argv);
    if (link) deliverDeepLink(link);
    // Launching the app again is always a way back to a visible, interactive panel.
    controller?.handleReactivation({ focus: !link });
  });

  // macOS: clicking the Dock icon.
  app.on('activate', () => controller?.handleReactivation({ focus: true }));

  // The app lives in the tray / menu bar: closing windows never quits it.
  app.on('window-all-closed', () => undefined);

  app.on('before-quit', () => controller?.beginQuit());
  app.on('will-quit', (event) => {
    if (!controller || controller.isShutDown()) return;
    event.preventDefault();
    // Quit is explicit and must always complete: if anything (a request in
    // flight, a stuck window) keeps the orderly shutdown from finishing, the
    // process still exits after a short deadline.
    setTimeout(() => app.exit(0), QUIT_DEADLINE_MS);
    // The second quit must start in a later tick. If the shutdown has nothing
    // to wait for, its promise settles while Electron is still dispatching
    // this prevented `will-quit`, and a quit requested at that moment is ignored.
    void controller.shutdown().finally(() => setImmediate(() => app.quit()));
  });

  // Windows/Linux cold start: the link is one of our own arguments.
  const coldStartLink = findDeepLinkArg(process.argv.slice(1));
  if (coldStartLink) pendingDeepLinks.push(coldStartLink);

  void app.whenReady().then(async () => {
    const root = path.resolve(__dirname, '..');
    let testSwitches: TestSwitches | undefined;
    let testEncryption: EncryptionAdapter | undefined;
    // Written as a literal `if (__RD_TEST_HOOK__)` so a production build, where
    // the constant is `false`, drops the whole block and the hook module with it.
    if (__RD_TEST_HOOK__) {
      if (!app.isPackaged && process.env.RD_DESKTOP_TEST_HOOK === '1') {
        testSwitches = {
          disableTray: process.env.RD_DESKTOP_TEST_NO_TRAY === '1',
          failShortcuts: process.env.RD_DESKTOP_TEST_FAIL_SHORTCUTS === '1',
        };
        if (process.env.RD_DESKTOP_TEST_KEYSTORE === '1') testEncryption = createTestKeystore();
      }
    }

    controller = new AppController({
      platform: selectPlatformAdapter(process.platform),
      logger,
      paths: {
        userData: app.getPath('userData'),
        rendererRoot: path.join(root, 'renderer'),
        preload: path.join(root, 'preload', 'preload.cjs'),
        assets: path.join(root, 'assets'),
        // Development only (`scripts/build-native.mjs`); packaged builds read `resources/native`.
        devNativeDir: path.resolve(root, '..', 'native', 'dist'),
      },
      ...(testSwitches ? { testSwitches } : {}),
      ...(testEncryption ? { encryption: testEncryption } : {}),
    });
    if (__RD_TEST_HOOK__) {
      if (testSwitches) installTestHook(controller);
    }

    try {
      await controller.start();
    } catch (error) {
      logger.error('startup.failed', { reason: error instanceof Error ? error.name : 'unknown' });
      app.exit(1);
      return;
    }
    logger.info('app.started', { version: app.getVersion(), packaged: app.isPackaged });
    for (const link of pendingDeepLinks.splice(0)) controller.handleDeepLink(link);
  });
}
