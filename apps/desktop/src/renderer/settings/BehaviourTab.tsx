import {
  Badge,
  Banner,
  Button,
  Card,
  Kbd,
  SegmentedControl,
  Select,
  Switch,
} from '@realtimedocs/ui';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { windowCommandHints } from '../../shared/window-commands';
import type { PinLevel } from '../../shared/preferences';
import { PRESENCE_SCOPE_NOTE } from '../../shared/presence';
import { RETURN_TO_INTERACTIVE_LABEL } from '../../shared/privacy/status';
import type { DocumentMode } from '../../shared/state';
import {
  ACCELERATOR_ERROR_MESSAGES,
  SHORTCUT_LABELS,
  acceleratorFromKeyEvent,
  acceleratorKeyCaps,
  parseAccelerator,
} from '../../shared/shortcuts';
import type { AppState, ShortcutStatus } from '../../shared/state';
import { attempt, desktop } from '../shared/desktop';
import type { TabProps } from './SettingsApp';

function KeyCaps({ caps }: { caps: string[] }) {
  return (
    <span className="rds-keycaps">
      {caps.map((cap, index) => (
        <Kbd key={`${cap}-${index}`}>{cap}</Kbd>
      ))}
    </span>
  );
}

const REGISTRATION_TEXT: Record<NonNullable<ShortcutStatus['error']>, string> = {
  in_use: 'In use by another application',
  invalid: 'Not a valid combination',
  duplicate: 'Same as another shortcut',
  suspended: 'Paused while recording',
};

function ShortcutRow({ item, state }: { item: ShortcutStatus; state: AppState }) {
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const field = useRef<HTMLButtonElement>(null);
  const platform = state.app.platform;

  const stop = () => {
    setRecording(false);
    void desktop?.shortcuts.setRecording(false);
  };

  // Recording pauses the global shortcuts, so it must always end.
  useEffect(() => () => void desktop?.shortcuts.setRecording(false), []);

  const start = () => {
    setMessage(null);
    setRecording(true);
    void desktop?.shortcuts.setRecording(true);
    field.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      stop();
      return;
    }
    const candidate = acceleratorFromKeyEvent(event.nativeEvent, platform);
    if (!candidate) return;
    const parsed = parseAccelerator(candidate, platform);
    if (!parsed.ok) {
      setMessage(ACCELERATOR_ERROR_MESSAGES[parsed.error]);
      return;
    }
    setRecording(false);
    void attempt(desktop?.shortcuts.set(item.action, parsed.accelerator)).then(setMessage);
  };

  return (
    <div
      className="rds-shortcut"
      data-testid={`rd-shortcut-${item.action}`}
      data-registered={item.registered}
    >
      <div className="rds-shortcut-main">
        <div className="rds-label">{SHORTCUT_LABELS[item.action]}</div>
        <div className="rds-shortcut-status">
          {item.registered ? (
            <Badge tone="success">Registered</Badge>
          ) : (
            <Badge tone={item.error === 'suspended' ? 'neutral' : 'danger'}>
              {item.error ? REGISTRATION_TEXT[item.error] : 'Not registered'}
            </Badge>
          )}
          {!item.isDefault && <span className="rds-muted rds-small">Customised</span>}
        </div>
        {message && (
          <div className="rds-error" role="alert">
            {message}
          </div>
        )}
      </div>
      <button
        ref={field}
        type="button"
        className="rds-recorder"
        data-recording={recording}
        aria-label={`${SHORTCUT_LABELS[item.action]}: ${item.keyCaps.join(' + ')}. Activate to change.`}
        onClick={() => (recording ? stop() : start())}
        onKeyDown={onKeyDown}
        onBlur={() => recording && stop()}
        data-testid={`rd-shortcut-record-${item.action}`}
      >
        {recording ? (
          <span className="rds-recorder-prompt">Press the new combination… (Esc cancels)</span>
        ) : (
          <KeyCaps caps={acceleratorKeyCaps(item.accelerator, platform)} />
        )}
      </button>
      <Button
        size="sm"
        variant="ghost"
        disabled={item.isDefault && item.registered}
        onClick={() => void attempt(desktop?.shortcuts.reset(item.action)).then(setMessage)}
      >
        {item.isDefault ? 'Retry' : 'Reset'}
      </Button>
    </div>
  );
}

export function BehaviourTab({ state, run }: TabProps) {
  const { panel, behaviour, shortcuts, tray, app, presence } = state;
  const mac = app.platform === 'darwin';
  const hints = windowCommandHints(app.platform);
  const trayName = mac ? 'menu-bar icon' : 'tray icon';
  const failed = shortcuts.items.filter((item) => !item.registered && item.error !== 'suspended');
  const presenter = panel.mode === 'presenter';

  return (
    <div className="rds-stack">
      <Card padding="lg" className="rds-card" data-testid="rd-settings-mode">
        <h2 className="rds-h2">How documents open</h2>
        <SegmentedControl<DocumentMode>
          ariaLabel="How documents open"
          value={panel.mode}
          onValueChange={(mode) =>
            void run(
              desktop?.window.action(mode === 'presenter' ? 'presenter-mode' : 'normal-window'),
            )
          }
          options={[
            { value: 'presenter', label: 'Private Presenter Mode' },
            { value: 'normal', label: 'Normal window' },
          ]}
        />
        <p className="rds-muted rds-small">
          Private Presenter Mode is the floating, see-through panel: capture exclusion requested
          before it is first shown, always on top when pinned, left out of the taskbar and the Dock,
          click-through reading. A normal window is an ordinary framed window in the taskbar and the
          Dock, never on top, never click-through; private mode applies to it as you set it.
          Switching keeps the open document and its session; each mode remembers where it was.
        </p>
      </Card>

      <Card padding="lg" className="rds-card" data-testid="rd-settings-presence">
        <h2 className="rds-h2">Taskbar and Dock</h2>
        <Switch
          checked={presence.showInTaskbar}
          disabled={!presence.supported}
          onCheckedChange={(showInTaskbar) =>
            void run(desktop?.window.setWorkspace({ showInTaskbar }))
          }
          label={presence.title}
          hint={`${presence.label}. ${presence.detail}`}
          data-testid="rd-settings-show-in-taskbar"
        />
        {presence.blocked === 'no_recovery_path' && (
          <Banner tone="warning" data-testid="rd-presence-blocked">
            {presence.detail}
          </Banner>
        )}
        <p className="rds-muted rds-small">
          {PRESENCE_SCOPE_NOTE} In a normal window RealtimeDocs is always in the taskbar and the
          Dock.
        </p>
      </Card>

      <Card padding="lg" className="rds-card">
        <h2 className="rds-h2">Panel</h2>
        <Switch
          checked={panel.pinned}
          onCheckedChange={(pinned) => void run(desktop?.window.action(pinned ? 'pin' : 'unpin'))}
          label="Keep the panel above other windows"
          hint="Always-on-top is a request to the window manager. It is not a promise to cover every system surface or fullscreen application."
          data-testid="rd-settings-pin"
        />
        <Select
          label="Stay above"
          value={panel.pinLevel}
          onValueChange={(value) =>
            void run(desktop?.window.setWorkspace({ pinLevel: value as PinLevel }))
          }
          options={[
            {
              value: 'floating',
              label: `Ordinary windows (below the ${mac ? 'Dock' : 'taskbar'})`,
            },
            {
              value: 'screen-saver',
              label: `As high as the system allows (above the ${mac ? 'Dock' : 'taskbar'})`,
            },
          ]}
          hint="Applies while the panel is pinned."
          data-testid="rd-settings-pin-level"
        />
        {mac && (
          <Switch
            checked={panel.visibleOnAllWorkspaces && panel.visibleOnFullScreen}
            disabled={!presenter}
            onCheckedChange={(visible) =>
              void run(
                desktop?.window.setWorkspace({
                  visibleOnAllWorkspaces: visible,
                  visibleOnFullScreen: visible,
                }),
              )
            }
            label="Show on every Space and above fullscreen apps"
            hint="Presenter Mode only. The panel follows you between desktops and stays above fullscreen applications. Not every fullscreen application can be covered."
            data-testid="rd-settings-all-spaces"
          />
        )}
        <Switch
          checked={behaviour.followLatest}
          onCheckedChange={(followLatest) =>
            void run(desktop?.preferences.update({ behaviour: { followLatest } }))
          }
          label="Follow latest changes"
          hint="Scrolls to new content as it arrives. It pauses when you scroll back or select text, and never moves the keyboard focus."
          data-testid="rd-settings-follow"
        />
        <div className="rds-button-row">
          <Button onClick={() => void run(desktop?.window.action('toggle-collapse'))}>
            {panel.collapsed ? 'Expand panel' : 'Collapse to title strip'}
          </Button>
          <Button
            onClick={() =>
              void run(
                desktop?.window.action('reset-position'),
                'Panel moved back to its default position.',
              )
            }
            data-testid="rd-settings-reset-position"
          >
            Reset window position
          </Button>
          <Button
            onClick={() => void run(desktop?.window.action(panel.visible ? 'hide' : 'show'))}
            disabled={panel.visible && !panel.canHide}
          >
            {panel.visible ? 'Hide panel' : 'Show panel'}
          </Button>
        </div>
        {panel.lastRecovery && (
          <p className="rds-muted rds-small" data-testid="rd-last-recovery">
            The panel was moved back onto a screen ({panel.lastRecovery.reason.replaceAll('_', ' ')}
            ).
          </p>
        )}
        <p className="rds-muted rds-small">
          Closing the panel hides it; RealtimeDocs keeps running in the{' '}
          {mac ? 'menu bar' : 'notification area'}. Choose Quit from the {trayName}
          {mac ? ' or the application menu' : ''} to exit.
        </p>
      </Card>

      <Card padding="lg" className="rds-card">
        <h2 className="rds-h2">Click-through reading mode</h2>
        <p className="rds-lead">
          The panel stays visible but ignores the mouse: clicks and scrolling go to the window
          underneath. It is separate from transparency, and it is never turned on at startup.
        </p>
        <div className="rds-label">Ways back to interactive mode</div>
        <ul className="rds-checklist" data-testid="rd-recovery-paths">
          <li data-ok={panel.recoveryPaths.shortcut}>
            A global shortcut{' '}
            {panel.recoveryPaths.shortcut ? 'is registered' : 'is NOT registered (see below)'}
          </li>
          <li data-ok={panel.recoveryPaths.tray}>
            The {trayName}{' '}
            {panel.recoveryPaths.tray
              ? 'is available'
              : `is NOT available${tray.error ? `: ${tray.error}` : ''}`}
            {` — “${RETURN_TO_INTERACTIVE_LABEL}”`}
            {!mac && panel.recoveryPaths.tray ? ', or simply click the icon' : ''}
          </li>
          <li data-ok={panel.recoveryPaths.hoverBadge}>
            {panel.recoveryPaths.hoverBadge
              ? `Rest the pointer on the badge at the top of the panel and click “${RETURN_TO_INTERACTIVE_LABEL}”`
              : 'The in-panel badge cannot be clicked on this platform'}
          </li>
          <li data-ok="true">Start RealtimeDocs again{mac ? ' or click its Dock icon' : ''}</li>
        </ul>
        {panel.clickThroughBlockedReason && (
          <Banner tone="danger" data-testid="rd-click-through-blocked">
            {panel.clickThroughBlockedReason}
          </Banner>
        )}
        <div className="rds-button-row">
          <Button
            variant={panel.clickThrough ? 'primary' : 'secondary'}
            disabled={!panel.clickThrough && !panel.canEnterClickThrough}
            onClick={() => void run(desktop?.window.setClickThrough(!panel.clickThrough))}
            data-testid="rd-settings-click-through"
          >
            {panel.clickThrough ? RETURN_TO_INTERACTIVE_LABEL : 'Turn on click-through'}
          </Button>
        </div>
      </Card>

      <Card padding="lg" className="rds-card">
        <h2 className="rds-h2">Global shortcuts</h2>
        <p className="rds-lead">
          These work while another application has the keyboard. If another application already owns
          a combination, the operating system refuses it and it is shown as unavailable here and in
          the {trayName} menu.
        </p>
        {failed.length > 0 && (
          <Banner tone="warning" data-testid="rd-shortcut-warning">
            {failed.length === 1 ? 'One shortcut is' : `${failed.length} shortcuts are`} not
            working. Choose another combination, or close the application that uses it and press
            Retry.
          </Banner>
        )}
        <div className="rds-shortcuts">
          {shortcuts.items.map((item) => (
            <ShortcutRow key={item.action} item={item} state={state} />
          ))}
        </div>
        <div className="rds-button-row">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void run(desktop?.shortcuts.reset(), 'Shortcuts reset to the defaults.')}
          >
            Reset all to defaults
          </Button>
        </div>
      </Card>

      <Card padding="lg" className="rds-card">
        <h2 className="rds-h2">Panel keyboard commands</h2>
        <p className="rds-lead">These work while the panel has the keyboard focus.</p>
        <dl className="rds-facts">
          {hints.items.map((hint) => (
            <div key={hint.keys} className="rds-facts-row">
              <dt>
                <KeyCaps caps={hint.keys.split('+')} />
              </dt>
              <dd>{hint.label}</dd>
            </div>
          ))}
        </dl>
        <p className="rds-muted rds-small">
          Editing uses the standard shortcuts of your system: {mac ? 'Command' : 'Ctrl'}+C, V, X, Z
          and A.
        </p>
      </Card>
    </div>
  );
}
