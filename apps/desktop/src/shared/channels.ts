/**
 * IPC channel names. This file has no imports on purpose: it is bundled into
 * the sandboxed preload script, which may only `require('electron')`.
 *
 * There is no generic "invoke anything" channel. Each constant maps to exactly
 * one allow-listed action that the main process validates (sender frame,
 * window kind, input schema) before acting.
 */
export const CH = {
  // main → renderer
  stateChanged: 'rd:state:changed',
  event: 'rd:event',
  /** Handled by the preload itself (isolated world), never by the page: "draw twice, then answer". */
  frameRequest: 'rd:frame:request',

  // renderer → main (invoke)
  stateGet: 'rd:state:get',
  prefsUpdate: 'rd:prefs:update',

  windowAction: 'rd:window:action',
  windowSetBounds: 'rd:window:set-bounds',
  windowPreset: 'rd:window:preset',
  windowNudge: 'rd:window:nudge',
  windowResizeStart: 'rd:window:resize-start',
  windowResizeEnd: 'rd:window:resize-end',
  windowClickThrough: 'rd:window:click-through',
  windowClickThroughHover: 'rd:window:click-through-hover',
  windowWorkspace: 'rd:window:workspace',

  connectionSetServer: 'rd:connection:set-server',
  connectionCheck: 'rd:connection:check',
  connectionSetOptions: 'rd:connection:set-options',
  connectionOpenShareLink: 'rd:connection:open-share-link',
  connectionDisconnect: 'rd:connection:disconnect',
  connectionRevalidate: 'rd:connection:revalidate',
  connectionDismissNotice: 'rd:connection:dismiss-notice',
  sessionReport: 'rd:session:report',

  captureSetEnabled: 'rd:capture:set-enabled',

  // The Privacy Test Center (settings window only). Same strings as `PRIVACY_CH`
  // in shared/privacy/ipc.ts; a unit test keeps them equal (this file imports nothing).
  privacySnapshot: 'rd:privacy:snapshot',
  privacySave: 'rd:privacy:save',
  privacyRemove: 'rd:privacy:remove',
  privacyExport: 'rd:privacy:export',

  shortcutsSet: 'rd:shortcuts:set',
  shortcutsReset: 'rd:shortcuts:reset',
  shortcutsRecording: 'rd:shortcuts:recording',

  updatesCheck: 'rd:updates:check',
  updatesDownload: 'rd:updates:download',
  updatesDefer: 'rd:updates:defer',
  updatesOpen: 'rd:updates:open',

  externalOpen: 'rd:external:open',
  diagnosticsGet: 'rd:diagnostics:get',
  probeOpen: 'rd:probe:open',
  probeClose: 'rd:probe:close',
  probeRecord: 'rd:probe:record',

  // renderer → main (one-way; validated the same way)
  windowResizeMove: 'rd:window:resize-move',
  /** Sent by the preload itself after two animation frames (see `frameRequest`). */
  frameAck: 'rd:frame:ack',
  /** Sent by the preload script itself when the page's Content-Security-Policy refuses something. */
  policyViolation: 'rd:security:policy-violation',
} as const;

export type Channel = (typeof CH)[keyof typeof CH];
