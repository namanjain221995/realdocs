/**
 * Preload script: the single, narrow bridge between the sandboxed renderer and
 * the main process. It runs in an isolated world and exposes `window.rdDesktop`.
 *
 * - Sandboxed preloads may only `require('electron')`; this file imports
 *   nothing else at runtime (channel names are inlined by the bundler).
 * - No `ipcRenderer`, event object or Node.js primitive is handed to the page:
 *   every method calls one fixed channel, and listeners receive plain data.
 * - All validation happens in the main process; nothing here is trusted by it.
 * - In the panel, which renders other people's content, requests that act
 *   (window changes, links, the session) go out only with transient user
 *   activation: within a few seconds of a real click or key press. Page
 *   script cannot create activation, and this check runs in the isolated
 *   world, where page script cannot reach it. It is one of three layers; see
 *   `shared/panel-requests.ts`.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { ActionResult, RdDesktopApi } from '../shared/bridge';
import { CH } from '../shared/channels';
import type { AppEvent, AppState } from '../shared/state';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

/** The packaged panel page. Its URL is fixed; the main process checks it again for every message. */
const isPanel = window.location.protocol === 'app:' && window.location.pathname === '/panel.html';

/**
 * Sends `request` only if the reader just clicked or typed in the panel.
 * Otherwise nothing is sent and the caller gets the same kind of answer as
 * for any refused request. Other windows show no foreign content: unchanged.
 * (The code is the `NO_USER_ACTIVATION` constant of `shared/panel-requests.ts`.)
 */
function act(request: () => ActionResult): ActionResult {
  if (isPanel && !navigator.userActivation.isActive) {
    return Promise.resolve({
      ok: false,
      error: {
        code: 'no_user_activation',
        message: 'This needs a click or a key press in the panel.',
      },
    });
  }
  return request();
}

const api: RdDesktopApi = {
  getState: () =>
    ipcRenderer.invoke(CH.stateGet).then((result: { ok: boolean; data?: AppState }) => {
      if (!result.ok || !result.data) throw new Error('State is not available.');
      return result.data;
    }),
  onState: (listener) => subscribe<AppState>(CH.stateChanged, listener),
  onEvent: (listener) => subscribe<AppEvent>(CH.event, listener),

  preferences: {
    update: (patch) => ipcRenderer.invoke(CH.prefsUpdate, patch),
  },

  window: {
    action: (action, options) =>
      act(() => ipcRenderer.invoke(CH.windowAction, { action, ...options })),
    setBounds: (bounds) => act(() => ipcRenderer.invoke(CH.windowSetBounds, bounds)),
    preset: (preset) => act(() => ipcRenderer.invoke(CH.windowPreset, { preset })),
    nudge: (change) => act(() => ipcRenderer.invoke(CH.windowNudge, change)),
    resizeStart: (edge) => act(() => ipcRenderer.invoke(CH.windowResizeStart, { edge })),
    // The moves and the end of a drag that a real pointer press started.
    resizeMove: (dx, dy) => ipcRenderer.send(CH.windowResizeMove, { dx, dy }),
    resizeEnd: () => ipcRenderer.invoke(CH.windowResizeEnd),
    setClickThrough: (enabled) => act(() => ipcRenderer.invoke(CH.windowClickThrough, { enabled })),
    // Hovering the click-through badge only makes it clickable; it changes nothing by itself.
    setClickThroughHover: (hovering) =>
      ipcRenderer.invoke(CH.windowClickThroughHover, { hovering }),
    setWorkspace: (options) => ipcRenderer.invoke(CH.windowWorkspace, options),
  },

  connection: {
    setServer: (origin) => ipcRenderer.invoke(CH.connectionSetServer, { origin }),
    check: () => ipcRenderer.invoke(CH.connectionCheck),
    setOptions: (options) => ipcRenderer.invoke(CH.connectionSetOptions, options),
    openShareLink: (link) => act(() => ipcRenderer.invoke(CH.connectionOpenShareLink, { link })),
    disconnect: () => act(() => ipcRenderer.invoke(CH.connectionDisconnect)),
    revalidate: () => act(() => ipcRenderer.invoke(CH.connectionRevalidate)),
    dismissNotice: (id) => act(() => ipcRenderer.invoke(CH.connectionDismissNotice, { id })),
    reportSession: (report) => ipcRenderer.invoke(CH.sessionReport, report),
  },

  capture: {
    setEnabled: (enabled) => ipcRenderer.invoke(CH.captureSetEnabled, { enabled }),
  },

  privacy: {
    snapshot: () => ipcRenderer.invoke(CH.privacySnapshot),
    save: (record) => ipcRenderer.invoke(CH.privacySave, { record }),
    remove: (id) => ipcRenderer.invoke(CH.privacyRemove, { id }),
    exportRecords: (format) => ipcRenderer.invoke(CH.privacyExport, { format }),
  },

  shortcuts: {
    set: (action, accelerator) => ipcRenderer.invoke(CH.shortcutsSet, { action, accelerator }),
    reset: (action) => ipcRenderer.invoke(CH.shortcutsReset, action ? { action } : {}),
    setRecording: (active) => ipcRenderer.invoke(CH.shortcutsRecording, { active }),
  },

  updates: {
    check: () => ipcRenderer.invoke(CH.updatesCheck),
    download: () => ipcRenderer.invoke(CH.updatesDownload),
    defer: () => ipcRenderer.invoke(CH.updatesDefer),
    open: (action) => ipcRenderer.invoke(CH.updatesOpen, { action }),
  },

  openExternal: (url) => act(() => ipcRenderer.invoke(CH.externalOpen, { url })),

  diagnostics: {
    get: () => ipcRenderer.invoke(CH.diagnosticsGet),
    openProbe: () => ipcRenderer.invoke(CH.probeOpen),
    closeProbe: () => ipcRenderer.invoke(CH.probeClose),
    recordProbe: (result, notes) => ipcRenderer.invoke(CH.probeRecord, { result, notes }),
  },
};

contextBridge.exposeInMainWorld('rdDesktop', api);

/**
 * "Has this window been drawn since?" The main process asks after a window is
 * shown or its capture-exclusion request changes, and reports the request as
 * accepted only after the answer: the operating system applies it with the
 * next desktop composition. Answered here, in the isolated world, after two
 * animation frames; page script can neither see the question nor answer it.
 */
ipcRenderer.on(CH.frameRequest, (_event, nonce: unknown) => {
  if (typeof nonce !== 'string') return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ipcRenderer.send(CH.frameAck, { nonce });
    });
  });
});

/**
 * Report refused Content-Security-Policy actions to the main process. The
 * preload runs before any page script, so this also sees violations that
 * happen while the bundle is being loaded. Only a summary is sent: the
 * directive, the kind or origin of what was refused, and where — never a code
 * sample or page content. Capped, so a misbehaving page cannot flood the log.
 */
const MAX_POLICY_REPORTS = 50;
let policyReports = 0;

function describeBlocked(blockedUri: string): string {
  // Keywords such as "inline" and "eval" are passed through as they are.
  if (/^[a-z-]{1,32}$/.test(blockedUri)) return blockedUri;
  try {
    const url = new URL(blockedUri);
    return url.protocol === 'http:' ||
      url.protocol === 'https:' ||
      url.protocol === 'ws:' ||
      url.protocol === 'wss:'
      ? url.origin
      : url.protocol;
  } catch {
    return 'other';
  }
}

function scriptName(sourceFile: string): string {
  try {
    return (new URL(sourceFile).pathname.split('/').pop() ?? '').slice(0, 160);
  } catch {
    return '';
  }
}

window.addEventListener('securitypolicyviolation', (event) => {
  if (policyReports >= MAX_POLICY_REPORTS) return;
  policyReports += 1;
  ipcRenderer.send(CH.policyViolation, {
    directive: String(event.effectiveDirective).slice(0, 64),
    blocked: describeBlocked(String(event.blockedURI)).slice(0, 200),
    source: scriptName(String(event.sourceFile)),
    line: Number.isInteger(event.lineNumber) && event.lineNumber > 0 ? event.lineNumber : 0,
  });
});
