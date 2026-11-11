import { Button, Card, SegmentedControl, Slider } from '@realtimedocs/ui';
import { SIZE_PRESETS, SIZE_PRESET_NAMES } from '../../shared/geometry';
import {
  ALPHA_RANGE,
  FONT_SCALE_RANGE,
  type AppearancePreferences,
  type Density,
  type Foreground,
  type ReadabilityMode,
  type ReadingWidth,
} from '../../shared/preferences';
import { desktop } from '../shared/desktop';
import type { TabProps } from './SettingsApp';

export function AppearanceTab({ state, run }: TabProps) {
  const { appearance, panel } = state;
  const update = (patch: Partial<AppearancePreferences>) =>
    void run(desktop?.preferences.update({ appearance: patch }));

  return (
    <div className="rds-stack">
      <Card padding="lg" className="rds-card">
        <h2 className="rds-h2">Panel background</h2>
        <p className="rds-lead">
          Only the panel’s background becomes see-through. Text and images are always drawn fully
          opaque, so lowering this never fades the document itself.
        </p>
        <Slider
          label="Background opacity"
          min={ALPHA_RANGE.min}
          max={ALPHA_RANGE.max}
          step={ALPHA_RANGE.step}
          value={appearance.backgroundAlpha}
          onValueChange={(backgroundAlpha) => update({ backgroundAlpha })}
          formatValue={(value) => `${Math.round(value * 100)}%`}
          data-testid="rd-settings-alpha"
        />
        <div className="rds-field-row">
          <div>
            <div className="rds-label">Text colour</div>
            <div className="rds-hint">
              Light text on a dark panel, or dark text on a light panel.
            </div>
          </div>
          <SegmentedControl<Foreground>
            ariaLabel="Text colour"
            value={appearance.foreground}
            onValueChange={(foreground) => update({ foreground })}
            options={[
              { value: 'light', label: 'Light text' },
              { value: 'dark', label: 'Dark text' },
            ]}
          />
        </div>
        <div className="rds-field-row">
          <div>
            <div className="rds-label">Readability aid</div>
            <div className="rds-hint">
              For low opacity over busy windows: an outline around each letter, or a soft plate
              behind each block of text.
            </div>
          </div>
          <SegmentedControl<ReadabilityMode>
            ariaLabel="Readability aid"
            value={appearance.readability}
            onValueChange={(readability) => update({ readability })}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'outline', label: 'Outline' },
              { value: 'scrim', label: 'Scrim' },
            ]}
          />
        </div>
      </Card>

      <Card padding="lg" className="rds-card">
        <h2 className="rds-h2">Reading</h2>
        <Slider
          label="Text size"
          min={FONT_SCALE_RANGE.min}
          max={FONT_SCALE_RANGE.max}
          step={FONT_SCALE_RANGE.step}
          value={appearance.fontScale}
          onValueChange={(fontScale) => update({ fontScale })}
          formatValue={(value) => `${Math.round(value * 100)}%`}
          data-testid="rd-settings-font"
        />
        <div className="rds-field-row">
          <div>
            <div className="rds-label">Reading width</div>
            <div className="rds-hint">How wide a line of text may get inside the panel.</div>
          </div>
          <SegmentedControl<ReadingWidth>
            ariaLabel="Reading width"
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
        <div className="rds-field-row">
          <div>
            <div className="rds-label">Reading density</div>
            <div className="rds-hint">Line spacing and the space between paragraphs.</div>
          </div>
          <SegmentedControl<Density>
            ariaLabel="Reading density"
            value={appearance.density}
            onValueChange={(density) => update({ density })}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'spacious', label: 'Spacious' },
            ]}
          />
        </div>
        <p className="rds-muted rds-small">
          These are your own display preferences. They never change the shared document.
        </p>
      </Card>

      <Card padding="lg" className="rds-card">
        <h2 className="rds-h2">Panel size</h2>
        <p className="rds-lead">
          Currently {panel.bounds.width} × {panel.bounds.height}
          {panel.collapsed ? ' (collapsed)' : ''}. Drag the panel’s edges or corners, or pick a
          preset.
        </p>
        <div className="rds-button-row">
          {SIZE_PRESET_NAMES.map((preset) => (
            <Button
              key={preset}
              onClick={() => void run(desktop?.window.preset(preset))}
              data-testid={`rd-settings-preset-${preset}`}
            >
              {preset.charAt(0).toUpperCase() + preset.slice(1)} · {SIZE_PRESETS[preset].width} ×{' '}
              {SIZE_PRESETS[preset].height}
            </Button>
          ))}
        </div>
      </Card>
    </div>
  );
}
