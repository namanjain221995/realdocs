/**
 * What the panel may ask the main process for, and when.
 *
 * The panel is the window that renders content written by other people. Every
 * request it can make was audited with one question: could hostile content in
 * the panel use it to get something the reader did not ask for? (A server
 * change is not among them: that is asked in a dialog of the main process,
 * which no window can answer.) The answer is enforced in three layers:
 *
 * 1. Sender checks (`ipc-router.ts`): only the panel's own page in the panel
 *    window, only the channels listed for the panel, strict schemas.
 * 2. User activation (`preload.ts`, isolated world): a request that acts —
 *    changes the window, opens something, changes the session — is sent only
 *    while the page has transient user activation, i.e. within a few seconds
 *    of a real click or key press. Page script cannot create activation.
 * 3. The panel's state (this file, applied in the main process whatever the
 *    renderer claims): a request the reader could not have made in the
 *    panel's current state is refused. Nothing in a hidden panel can be
 *    clicked; in click-through mode only the badge that ends it can; while
 *    the panel is collapsed only its title strip is on screen.
 *
 * What stays allowed without activation is passive or cosmetic: reading the
 * state, reporting the editor's status, opacity and text size, the moves of a
 * resize drag that a click started, and the hover that makes the click-through
 * badge clickable.
 *
 * Pure: no Electron imports.
 */
import type { WindowActionName } from './ipc-schemas';

/** A request from the panel, as far as this policy cares. */
export type PanelRequest =
  | { kind: 'window-action'; action: WindowActionName }
  | { kind: 'set-bounds' }
  | { kind: 'preset' }
  | { kind: 'nudge' }
  | { kind: 'resize-start' }
  | { kind: 'click-through'; enabled: boolean }
  | { kind: 'open-share-link' }
  | { kind: 'disconnect' }
  | { kind: 'revalidate' }
  | { kind: 'dismiss-notice' }
  | { kind: 'external-open' };

/** What the reader can see of the panel right now. */
export interface PanelCondition {
  visible: boolean;
  collapsed: boolean;
  clickThrough: boolean;
}

export type PanelDecision = { ok: true } | { ok: false; code: string; message: string };

const ALLOWED: PanelDecision = { ok: true };

/** Requests whose controls live in the document area, which a collapsed panel does not show. */
const NEEDS_DOCUMENT_AREA = new Set<PanelRequest['kind']>([
  'open-share-link',
  'dismiss-notice',
  'external-open',
]);

export function decidePanelRequest(request: PanelRequest, panel: PanelCondition): PanelDecision {
  if (!panel.visible) {
    return {
      ok: false,
      code: 'panel_hidden',
      message: 'The panel is hidden, so this request cannot have come from a click in it.',
    };
  }
  if (panel.clickThrough) {
    // The badge's "Return to interactive mode" is the one thing that can be clicked.
    if (request.kind === 'click-through' && !request.enabled) return ALLOWED;
    return {
      ok: false,
      code: 'click_through',
      message: 'The panel is in click-through mode. Leave click-through first.',
    };
  }
  if (panel.collapsed && NEEDS_DOCUMENT_AREA.has(request.kind)) {
    return {
      ok: false,
      code: 'panel_collapsed',
      message: 'The panel is collapsed to its title strip. Expand it first.',
    };
  }
  return ALLOWED;
}

/**
 * Bridge methods that the preload sends only with transient user activation
 * when the page is the panel. Listed here so that a unit test can hold the
 * preload to it.
 */
export const PANEL_ACTIVATION_REQUIRED = [
  'window.action',
  'window.setBounds',
  'window.preset',
  'window.nudge',
  'window.resizeStart',
  'window.setClickThrough',
  'connection.openShareLink',
  'connection.disconnect',
  'connection.revalidate',
  'connection.dismissNotice',
  'openExternal',
] as const;

/** Error code the preload returns, without sending anything, when activation is missing. */
export const NO_USER_ACTIVATION = 'no_user_activation';

/** How long after a real click or key press the main process accepts a panel-only action. */
export const PANEL_INPUT_WINDOW_MS = 5000;

/**
 * Input that counts as the reader doing something in the panel, for the two
 * paths that never pass through the preload (`window.open` and following a
 * link to an attachment). Pointer moves, wheel and hover do not count.
 */
export const ACTIVATING_INPUT_TYPES: ReadonlySet<string> = new Set([
  'mouseDown',
  'mouseUp',
  'rawKeyDown',
  'keyDown',
  'char',
  'pointerDown',
  'pointerUp',
  'touchEnd',
  'gestureTap',
]);
