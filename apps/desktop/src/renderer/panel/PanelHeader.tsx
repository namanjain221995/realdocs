import {
  Badge,
  Button,
  DropdownMenu,
  IconButton,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  SegmentedControl,
  Slider,
  StatusDot,
  Tooltip,
  useToast,
} from '@realtimedocs/ui';
import {
  ArrowDownToLine,
  ChevronDown,
  ChevronUp,
  EllipsisVertical,
  GripVertical,
  MousePointerClick,
  Pin,
  PinOff,
  RotateCw,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { hasUnsavedChanges } from '@realtimedocs/editor';
import { useState } from 'react';
import { captureChip } from '../../shared/capture';
import { SIZE_PRESET_NAMES, type SizePreset } from '../../shared/geometry';
import {
  ALPHA_RANGE,
  FONT_SCALE_RANGE,
  type Density,
  type Foreground,
  type ReadabilityMode,
  type ReadingWidth,
} from '../../shared/preferences';
import { PARKED_STRIP_NOTICE, SAFE_SHARE_GUIDE_TITLE } from '../../shared/share-guide';
import type { AppState } from '../../shared/state';
import { desktop } from '../shared/desktop';
import {
  accessChip,
  connectionChip,
  connectionStateName,
  documentTitle,
  saveLabel,
  saveStateName,
} from '../shared/labels';
import { useAction } from './PanelApp';
import type { LiveDocument } from './useDocumentSession';

const PRESET_LABELS: Record<SizePreset, string> = {
  compact: 'Compact',
  standard: 'Standard',
  wide: 'Wide',
  tall: 'Tall',
  large: 'Large',
};

const CHIP_TONES = {
  neutral: 'neutral',
  info: 'info',
  warning: 'warning',
  danger: 'danger',
} as const;

function AppearancePopover({ state }: { state: AppState }) {
  const [open, setOpen] = useState(false);
  const run = useAction();
  const { appearance } = state;
  const update = (patch: Partial<AppState['appearance']>) =>
    run(desktop?.preferences.update({ appearance: patch }));

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      trigger={
        <IconButton label="Appearance" size="sm" data-testid="rd-appearance-button">
          <SlidersHorizontal />
        </IconButton>
      }
    >
      <div className="rdp-appearance" data-testid="rd-appearance-popover">
        <Slider
          label="Background opacity"
          min={ALPHA_RANGE.min}
          max={ALPHA_RANGE.max}
          step={ALPHA_RANGE.step}
          value={appearance.backgroundAlpha}
          onValueChange={(backgroundAlpha) => update({ backgroundAlpha })}
          formatValue={(value) => `${Math.round(value * 100)}%`}
          data-testid="rd-alpha-slider"
        />
        <Slider
          label="Text size"
          min={FONT_SCALE_RANGE.min}
          max={FONT_SCALE_RANGE.max}
          step={FONT_SCALE_RANGE.step}
          value={appearance.fontScale}
          onValueChange={(fontScale) => update({ fontScale })}
          formatValue={(value) => `${Math.round(value * 100)}%`}
          data-testid="rd-font-slider"
        />
        <div className="rdp-appearance-row rdp-appearance-row--stacked">
          <span className="rdp-appearance-label">Reading density</span>
          <SegmentedControl<Density>
            ariaLabel="Reading density"
            fullWidth
            size="sm"
            value={appearance.density}
            onValueChange={(density) => update({ density })}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'spacious', label: 'Spacious' },
            ]}
            data-testid="rd-density"
          />
        </div>
        <div className="rdp-appearance-row">
          <span className="rdp-appearance-label">Text colour</span>
          <SegmentedControl<Foreground>
            ariaLabel="Text colour"
            size="sm"
            value={appearance.foreground}
            onValueChange={(foreground) => update({ foreground })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <div className="rdp-appearance-row rdp-appearance-row--stacked">
          <span className="rdp-appearance-label">Reading width</span>
          <SegmentedControl<ReadingWidth>
            ariaLabel="Reading width"
            fullWidth
            size="sm"
            value={appearance.readingWidth}
            onValueChange={(readingWidth) => update({ readingWidth })}
            options={[
              { value: 'narrow', label: 'Narrow' },
              { value: 'normal', label: 'Normal' },
              { value: 'wide', label: 'Wide' },
              { value: 'full', label: 'Full' },
            ]}
          />
        </div>
        <div className="rdp-appearance-row">
          <span className="rdp-appearance-label">Readability aid</span>
          <SegmentedControl<ReadabilityMode>
            ariaLabel="Readability aid for low opacity"
            size="sm"
            value={appearance.readability}
            onValueChange={(readability) => update({ readability })}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'outline', label: 'Outline' },
              { value: 'scrim', label: 'Scrim' },
            ]}
          />
        </div>
        <p className="rdp-appearance-hint">
          These change how the document looks on this computer only, never the shared document.
          Opacity changes the panel background only; text and images stay fully opaque.
        </p>
      </div>
    </Popover>
  );
}

/**
 * The private-mode chip: the request label and, when the operating system
 * accepted the request, the verification line. A click or Enter opens the
 * explanation (a DOM popover inside the window, never a native tooltip).
 */
function PrivacyChip({ state }: { state: AppState }) {
  const [open, setOpen] = useState(false);
  const run = useAction();
  const chip = captureChip(state.capture.status);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      trigger={
        <button
          type="button"
          className="rdp-chip rdp-privacy-chip"
          data-testid="rd-header-privacy"
          data-request={state.capture.status.request}
          aria-label={`Private mode: ${chip.label}${chip.secondary ? `. ${chip.secondary}` : ''}. Show the explanation.`}
        >
          <ShieldCheck className="rdp-privacy-icon" aria-hidden="true" />
          <span className="rdp-chip-label">{chip.label}</span>
          {chip.secondary ? (
            <span className="rdp-chip-secondary" data-testid="rd-header-privacy-secondary">
              {chip.secondary}
            </span>
          ) : null}
        </button>
      }
    >
      <div className="rdp-privacy-explain" data-testid="rd-privacy-explanation">
        <div className="rdp-privacy-head">
          <Badge tone={CHIP_TONES[chip.tone]}>{chip.label}</Badge>
          {chip.secondary ? <span className="rdp-privacy-secondary">{chip.secondary}</span> : null}
        </div>
        {chip.explanation.map((line) => (
          <p key={line} className="rdp-privacy-line">
            {line}
          </p>
        ))}
        <div className="rdp-privacy-actions">
          <Button
            size="sm"
            variant="secondary"
            data-testid="rd-privacy-open-guide"
            onClick={() => {
              setOpen(false);
              run(desktop?.window.action('show-share-guide'));
            }}
          >
            {SAFE_SHARE_GUIDE_TITLE}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              run(desktop?.window.action('open-settings', { tab: 'privacy-test-center' }));
            }}
          >
            Privacy Test Center
          </Button>
        </div>
      </div>
    </Popover>
  );
}

function shortcutCaps(state: AppState, action: AppState['shortcuts']['items'][number]['action']) {
  const item = state.shortcuts.items.find((entry) => entry.action === action);
  return item?.registered ? item.keyCaps.join('+') : null;
}

export function PanelHeader({ state, live }: { state: AppState; live: LiveDocument | null }) {
  const run = useAction();
  const toast = useToast();
  const { panel, behaviour, connection } = state;
  const presenter = panel.mode === 'presenter';
  const reported = connection.report?.connection;
  const canRetry = live !== null && (reported === 'reconnecting' || reported === 'offline');

  // Closing from the panel ends the session. Unsent changes of a signed-in
  // editor stay on this computer and are sent when the document is opened
  // again; a share-link guest has no such copy. Either way, say so once.
  const [warnedUnsent, setWarnedUnsent] = useState<string | null>(null);
  const closeDocument = () => {
    if (live && hasUnsavedChanges(live.session) && warnedUnsent !== live.key) {
      setWarnedUnsent(live.key);
      toast.show({
        title: 'Some changes have not reached the server yet',
        description: live.accountId
          ? 'They stay on this computer and are sent when you open this document again. Choose "Close document" again to close now.'
          : 'Closing the document now discards them. Choose "Close document" again to close anyway.',
        tone: 'warning',
        durationMs: 9000,
      });
      return;
    }
    run(desktop?.connection.disconnect());
  };
  const connectionStatus = connectionChip(state);
  const access = accessChip(state);
  const save = saveLabel(state);
  // A panel that could not be hidden after its display went away shows no document content.
  const parkedStrip = panel.parked !== null && panel.collapsed;
  const title = parkedStrip ? PARKED_STRIP_NOTICE : documentTitle(state);
  const hideShortcut = shortcutCaps(state, 'toggleVisibility');

  const titleBlock = (
    <>
      <span className="rdp-title" data-testid="rd-panel-title" data-parked={parkedStrip}>
        {title}
      </span>
      <span className="rdp-status">
        <Tooltip content={connectionStatus.hint} side="bottom">
          <span
            className="rdp-chip"
            data-testid="rd-header-connection"
            data-state={connectionStateName(state)}
          >
            <StatusDot tone={connectionStatus.tone} pulse={connectionStatus.pulse} />
            <span className="rdp-chip-label">{connectionStatus.label}</span>
          </span>
        </Tooltip>
        {save && (
          <span className="rdp-save" data-testid="rd-header-save" data-state={saveStateName(state)}>
            {save}
          </span>
        )}
        {access && (
          <Tooltip content={access.hint} side="bottom">
            <Badge tone={access.tone} data-testid="rd-header-access" className="rdp-access">
              {access.label}
            </Badge>
          </Tooltip>
        )}
        <PrivacyChip state={state} />
      </span>
    </>
  );

  return (
    <header className="rdp-header" data-testid="rd-panel-header" data-mode={panel.mode}>
      {presenter ? (
        // The drag strip: moving the frameless panel happens here and only here.
        <div className="rdp-drag" data-testid="rd-drag-strip">
          <GripVertical className="rdp-drag-grip" aria-hidden="true" />
          {titleBlock}
        </div>
      ) : (
        // The ordinary window is moved by its own title bar.
        <div className="rdp-titlebar" data-testid="rd-title-block">
          {titleBlock}
        </div>
      )}

      <div className="rdp-controls" role="toolbar" aria-label="Panel controls">
        {canRetry && (
          <IconButton
            label="Reconnect now"
            size="sm"
            data-testid="rd-retry-button"
            onClick={() => live?.session.retryNow()}
          >
            <RotateCw />
          </IconButton>
        )}
        <IconButton
          label={
            behaviour.followLatest ? 'Follow latest changes: on' : 'Follow latest changes: off'
          }
          size="sm"
          pressed={behaviour.followLatest}
          data-testid="rd-follow-toggle"
          onClick={() =>
            run(
              desktop?.preferences.update({ behaviour: { followLatest: !behaviour.followLatest } }),
            )
          }
        >
          <ArrowDownToLine />
        </IconButton>
        <AppearancePopover state={state} />
        {presenter && (
          <IconButton
            label={
              panel.canEnterClickThrough
                ? 'Click-through reading mode'
                : (panel.clickThroughBlockedReason ?? 'Click-through is unavailable')
            }
            size="sm"
            disabled={!panel.canEnterClickThrough}
            data-testid="rd-click-through-button"
            onClick={() => run(desktop?.window.setClickThrough(true))}
          >
            <MousePointerClick />
          </IconButton>
        )}
        {presenter && (
          <IconButton
            label={panel.pinned ? 'Unpin from top' : 'Pin on top'}
            size="sm"
            pressed={panel.pinned}
            data-testid="rd-pin-button"
            onClick={() => run(desktop?.window.action('toggle-pin'))}
          >
            {panel.pinned ? <Pin /> : <PinOff />}
          </IconButton>
        )}
        {presenter && (
          <IconButton
            label={panel.collapsed ? 'Expand' : 'Collapse to title strip'}
            size="sm"
            data-testid="rd-collapse-button"
            onClick={() => run(desktop?.window.action('toggle-collapse'))}
          >
            {panel.collapsed ? <ChevronDown /> : <ChevronUp />}
          </IconButton>
        )}
        <DropdownMenu
          placement="bottom-end"
          trigger={
            <IconButton label="More" size="sm" data-testid="rd-more-button">
              <EllipsisVertical />
            </IconButton>
          }
        >
          {presenter && <MenuLabel>Size</MenuLabel>}
          {presenter &&
            SIZE_PRESET_NAMES.map((preset) => (
              <MenuItem
                key={preset}
                data-testid={`rd-preset-${preset}`}
                onSelect={() => run(desktop?.window.preset(preset))}
              >
                {PRESET_LABELS[preset]}
              </MenuItem>
            ))}
          {presenter && <MenuSeparator />}
          <MenuItem onSelect={() => run(desktop?.window.action('reset-position'))}>
            Reset position
          </MenuItem>
          <MenuItem
            data-testid="rd-switch-mode"
            onSelect={() =>
              run(desktop?.window.action(presenter ? 'normal-window' : 'presenter-mode'))
            }
          >
            {presenter ? 'Open in a normal window' : 'Switch to Private Presenter Mode'}
          </MenuItem>
          {connection.session && (
            <MenuItem danger data-testid="rd-close-document" onSelect={closeDocument}>
              Close document
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem
            data-testid="rd-open-share-guide"
            onSelect={() => run(desktop?.window.action('show-share-guide'))}
          >
            {SAFE_SHARE_GUIDE_TITLE}
          </MenuItem>
          <MenuItem
            data-testid="rd-open-settings"
            onSelect={() => run(desktop?.window.action('open-settings'))}
          >
            Settings…
          </MenuItem>
          <MenuItem
            onSelect={() => run(desktop?.window.action('open-settings', { tab: 'privacy' }))}
          >
            Privacy and capture…
          </MenuItem>
        </DropdownMenu>
        <IconButton
          label={
            panel.canHide
              ? `Hide panel${hideShortcut ? ` (${hideShortcut} shows it again)` : ' (stays in the tray)'}`
              : 'Hiding is unavailable: no tray icon or shortcut could bring the panel back'
          }
          size="sm"
          disabled={!panel.canHide}
          data-testid="rd-hide-button"
          onClick={() => run(desktop?.window.action('hide'))}
        >
          <X />
        </IconButton>
      </div>
    </header>
  );
}
