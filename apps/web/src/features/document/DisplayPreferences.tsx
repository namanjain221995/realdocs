import { Button, SegmentedControl, Slider, Switch } from '@realtimedocs/ui';
import {
  type DocumentTone,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  isDefaultDisplayPreferences,
  type ReadingWidth,
  useDisplayPreferences,
} from '../../lib/displayPreferences';
import {
  READING_SCALE_MAX,
  READING_SCALE_MIN,
  READING_SCALE_STEP,
  useReadingMode,
} from '../../lib/readingMode';

const WIDTH_OPTIONS: readonly { value: ReadingWidth; label: string }[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'normal', label: 'Normal' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
];

const TONE_OPTIONS: readonly { value: DocumentTone; label: string }[] = [
  { value: 'inherit', label: 'Match app' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

/**
 * Text size, reading width and document colours for this reader. Used in a
 * popover on wide screens and in a dialog on phones.
 */
export function DisplayPreferencesForm() {
  const { preferences, update, reset } = useDisplayPreferences();
  const { reading, update: updateReading } = useReadingMode();
  return (
    <div className="doc-display" data-testid="display-preferences">
      <div className="doc-display__group doc-display__reading">
        <Switch
          label="Reading mode"
          hint="For a phone or tablet during a meeting: large text that follows the latest changes, almost no controls, dark colours, and the screen kept awake where your browser allows it."
          checked={reading.enabled}
          onCheckedChange={(enabled) => updateReading({ enabled })}
          data-testid="reading-mode-toggle"
        />
        {reading.enabled ? (
          <Slider
            label="Reading text size"
            min={READING_SCALE_MIN}
            max={READING_SCALE_MAX}
            step={READING_SCALE_STEP}
            value={reading.fontScale}
            onValueChange={(fontScale) => updateReading({ fontScale })}
            formatValue={(value) => `${Math.round(value * 100)}%`}
          />
        ) : null}
      </div>
      <Slider
        label="Text size"
        min={FONT_SCALE_MIN}
        max={FONT_SCALE_MAX}
        step={FONT_SCALE_STEP}
        value={preferences.fontScale}
        onValueChange={(fontScale) => update({ fontScale })}
        formatValue={(value) => `${Math.round(value * 100)}%`}
      />
      <div className="doc-display__group">
        <span className="rd-field__label" aria-hidden="true">
          Reading width
        </span>
        <SegmentedControl
          ariaLabel="Reading width"
          size="sm"
          fullWidth
          options={WIDTH_OPTIONS}
          value={preferences.readingWidth}
          onValueChange={(readingWidth) => update({ readingWidth })}
        />
      </div>
      <div className="doc-display__group">
        <span className="rd-field__label" aria-hidden="true">
          Document colours
        </span>
        <SegmentedControl
          ariaLabel="Document colours"
          size="sm"
          fullWidth
          options={TONE_OPTIONS}
          value={preferences.tone}
          onValueChange={(tone) => update({ tone })}
        />
      </div>
      <p className="app-note">
        These settings are yours. They are saved on this device and do not change the document for
        anyone else.
      </p>
      <div>
        <Button
          size="sm"
          variant="ghost"
          disabled={isDefaultDisplayPreferences(preferences)}
          onClick={reset}
        >
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
