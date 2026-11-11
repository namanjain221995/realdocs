import { Kbd } from '@realtimedocs/ui';
import { MousePointerClick } from 'lucide-react';
import { RETURN_TO_INTERACTIVE_LABEL } from '../../shared/privacy/status';
import type { AppState } from '../../shared/state';
import { desktop } from '../shared/desktop';

/**
 * The always-visible indicator while the panel ignores the mouse.
 *
 * It names the ways back (the emergency shortcut, the tray / menu-bar item's
 * "Return to interactive mode"). On Windows
 * and macOS the window still receives forwarded mouse *moves*, so resting the
 * pointer on this badge makes just the badge clickable: a third way back that
 * needs neither the keyboard nor the tray.
 */
export function ClickThroughBadge({ state }: { state: AppState }) {
  const { recoveryPaths } = state.panel;
  const shortcut = state.shortcuts.items.find(
    (item) => item.action === 'returnToInteractive' && item.registered,
  );
  const tray = state.app.platform === 'darwin' ? 'menu-bar icon' : 'tray icon';

  const setHover = (hovering: boolean) => {
    if (recoveryPaths.hoverBadge) void desktop?.window.setClickThroughHover(hovering);
  };

  return (
    <div
      className="rdp-click-through"
      role="status"
      data-testid="rd-click-through-badge"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <MousePointerClick className="rdp-click-through-icon" aria-hidden="true" />
      <span className="rdp-click-through-text">
        <strong>Click-through is on.</strong> Clicks pass to the window underneath.{' '}
        {shortcut ? (
          <>
            Press{' '}
            {shortcut.keyCaps.map((cap) => (
              <Kbd key={cap}>{cap}</Kbd>
            ))}{' '}
            {recoveryPaths.tray ? `or use the ${tray} to return.` : 'to return.'}
          </>
        ) : (
          <>Use the {tray} to return.</>
        )}
      </span>
      {recoveryPaths.hoverBadge && (
        <button
          type="button"
          className="rdp-click-through-exit"
          data-testid="rd-click-through-exit"
          onClick={() => void desktop?.window.setClickThrough(false)}
        >
          {RETURN_TO_INTERACTIVE_LABEL}
        </button>
      )}
    </div>
  );
}
