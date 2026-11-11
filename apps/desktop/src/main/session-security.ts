/**
 * Session- and webContents-level protections (Electron security checklist
 * items 5, 12, 13, 14, 15):
 *
 * - every permission request and check is denied: the app needs no camera,
 *   microphone, screen capture, location, notifications, USB/HID/serial…;
 * - the bearer token is attached by the main process, only to API requests
 *   for the configured server origin (`auth-header.ts`);
 * - windows cannot navigate away from their packaged page, cannot be
 *   redirected, cannot open popups and cannot attach `<webview>`s;
 * - Chromium never downloads anything. An attachment of the open document is
 *   fetched by the main process itself (see `asset-download.ts`).
 */
import { shell, type Session, type WebContents } from 'electron';
import { decideAuthorization, type AuthContext } from './auth-header';
import type { Logger } from './logger';
import { decideExternalOpen, decideNavigation, isAppPageUrl } from './navigation-policy';

export interface SessionSecurityOptions {
  getAuthContext: () => AuthContext;
  logger: Logger;
}

/** Upper bound for the set of in-flight redirected request ids. */
const MAX_TRACKED_REDIRECTS = 4096;

export function hardenSession(session: Session, options: SessionSecurityOptions): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  // No screen/window/tab capture is ever offered to the page.
  session.setDisplayMediaRequestHandler((_request, callback) => callback(null));

  // A redirected request keeps its id, so these ids mark every later hop. The
  // token is attached to the first hop only (`auth-header.ts`).
  const redirectedRequests = new Set<number>();
  session.webRequest.onBeforeRedirect((details) => {
    if (redirectedRequests.size >= MAX_TRACKED_REDIRECTS) {
      // Entries normally leave when their request ends. Should that ever fail,
      // drop the oldest one rather than grow without limit.
      const oldest = redirectedRequests.values().next();
      if (!oldest.done) redirectedRequests.delete(oldest.value);
    }
    redirectedRequests.add(details.id);
  });
  session.webRequest.onCompleted((details) => void redirectedRequests.delete(details.id));
  session.webRequest.onErrorOccurred((details) => void redirectedRequests.delete(details.id));

  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const decision = decideAuthorization(
      {
        url: details.url,
        method: details.method,
        resourceType: details.resourceType,
        initiatorOrigin: details.initiatorOrigin,
        redirected: redirectedRequests.has(details.id),
        requestHeaders: details.requestHeaders,
      },
      options.getAuthContext(),
    );
    callback(decision.changed ? { requestHeaders: decision.requestHeaders } : {});
  });

  // Nothing a page does can make the app save a file: every download that
  // Chromium wants to start is cancelled. (The one legitimate download, an
  // attachment of the open document, does not come this way.)
  session.on('will-download', (event) => {
    options.logger.warn('download.blocked', {});
    event.preventDefault();
  });
}

/** Denies everything on a session the app does not use for its own windows. */
export function lockDownUnusedSession(session: Session): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
}

export interface WebContentsGuardOptions {
  logger: Logger;
  /**
   * Called for a navigation that is about to be refused. Returns true when
   * the main process took care of it another way (an attachment download).
   * The navigation is cancelled in either case.
   */
  onRefusedNavigation?: (url: string) => boolean;
  /**
   * `window.open` or a `target=_blank` link. No window is ever created; the
   * caller may hand a safe link to the operating system (validated, and
   * rate-limited for the panel).
   */
  onOpenWindow: (url: string) => void;
}

/** Opens a validated http(s)/mailto link with the operating system's handler. */
export async function openExternalSafely(input: unknown, logger: Logger): Promise<boolean> {
  const decision = decideExternalOpen(input);
  if (!decision.open) {
    logger.warn('external.rejected', {});
    return false;
  }
  try {
    await shell.openExternal(decision.url);
    return true;
  } catch {
    logger.warn('external.failed', {});
    return false;
  }
}

export function guardWebContents(contents: WebContents, options: WebContentsGuardOptions): void {
  const block = (event: { preventDefault: () => void }, kind: string) => {
    options.logger.warn('navigation.blocked', { kind });
    event.preventDefault();
  };

  contents.on('will-navigate', (details) => {
    if (decideNavigation(details.url, contents.getURL()) !== 'block') return;
    if (options.onRefusedNavigation?.(details.url)) details.preventDefault();
    else block(details, 'navigate');
  });
  contents.on('will-redirect', (details) => {
    if (!isAppPageUrl(details.url)) block(details, 'redirect');
  });
  contents.on('will-frame-navigate', (details) => {
    // Sub-frames are not used at all (CSP frame-src 'none'); the main frame is covered above.
    if (!details.isMainFrame) block(details, 'frame');
  });
  contents.on('will-attach-webview', (event) => block(event, 'webview'));

  contents.setWindowOpenHandler(({ url }) => {
    // Never a new window. Safe external links go to the default browser/mail app.
    options.onOpenWindow(url);
    return { action: 'deny' };
  });
}
