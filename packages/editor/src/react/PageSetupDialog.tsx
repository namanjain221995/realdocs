/**
 * "Page setup": paper size, orientation, margins, display unit and page
 * colour. It reads and writes the same shared settings as the ruler, so the
 * two follow each other and collaborators see every change as it is made.
 */
import {
  DEFAULT_PAGE_SETTINGS,
  formatMeasurement,
  marginProblem,
  PAGE_BACKGROUNDS,
  PAGE_MARGIN_KEYS,
  parseMeasurement,
  type PageBackground,
  type PageMarginKey,
  type PageOrientation,
  type PageSettings,
  type PageSize,
  type PageUnit,
} from '@realtimedocs/contracts';
import { Button, Dialog, SegmentedControl, Select, TextField } from '@realtimedocs/ui';
import { useState } from 'react';

export interface PageSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: PageSettings;
  /** Only people who can edit the document may change its page. */
  canEdit: boolean;
  onChange: (patch: Partial<PageSettings>) => void;
  onReset: () => void;
}

const MARGIN_LABELS: Record<PageMarginKey, string> = {
  marginTop: 'Top',
  marginRight: 'Right',
  marginBottom: 'Bottom',
  marginLeft: 'Left',
};

const BACKGROUND_LABELS: Record<PageBackground, string> = {
  default: 'Match the theme',
  white: 'White paper',
  cream: 'Cream paper',
  gray: 'Light gray paper',
};

function MarginField({
  field,
  settings,
  disabled,
  onCommit,
}: {
  field: PageMarginKey;
  settings: PageSettings;
  disabled: boolean;
  onCommit: (patch: Partial<PageSettings>) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft === null ? null : parseMeasurement(draft, settings.unit);
  const problem = draft === null ? null : marginProblem(settings, field, parsed);
  const commit = (): void => {
    if (draft === null) return;
    if (parsed !== null && problem === null) {
      if (parsed !== settings[field]) onCommit({ [field]: parsed });
      setDraft(null);
    }
  };
  return (
    <TextField
      label={MARGIN_LABELS[field]}
      value={draft ?? formatMeasurement(settings[field], settings.unit)}
      error={problem ?? undefined}
      disabled={disabled}
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      data-testid={`page-setup-${field}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        commit();
        // An invalid entry is dropped when the field is left; the message stays until then.
        if (draft !== null && (parsed === null || problem !== null)) setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape' && draft !== null) {
          event.stopPropagation();
          setDraft(null);
        }
      }}
    />
  );
}

export function PageSetupDialog({
  open,
  onOpenChange,
  settings,
  canEdit,
  onChange,
  onReset,
}: PageSetupDialogProps) {
  const isDefault = (Object.keys(DEFAULT_PAGE_SETTINGS) as (keyof PageSettings)[]).every(
    (key) => settings[key] === DEFAULT_PAGE_SETTINGS[key],
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Page setup"
      description={
        canEdit
          ? 'Everyone who opens this document sees these settings, and they are used when printing.'
          : 'You can see how this page is set up. Only people who can edit the document can change it.'
      }
      size="md"
      data-testid="page-setup"
      footer={
        <>
          <Button
            variant="ghost"
            disabled={!canEdit || isDefault}
            onClick={onReset}
            data-testid="page-setup-reset"
          >
            Reset to defaults
          </Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </>
      }
    >
      <div className="rd-page-setup">
        <Select
          label="Paper size"
          value={settings.size}
          disabled={!canEdit}
          options={[
            { value: 'a4', label: 'A4 (210 × 297 mm)' },
            { value: 'letter', label: 'Letter (8.5 × 11 in)' },
          ]}
          onValueChange={(value) => onChange({ size: value as PageSize })}
          data-testid="page-setup-size"
        />
        <div className="rd-page-setup__row">
          <div className="rd-page-setup__group">
            <span className="rd-page-setup__label" id="rd-page-orientation">
              Orientation
            </span>
            <SegmentedControl<PageOrientation>
              ariaLabel="Orientation"
              value={settings.orientation}
              disabled={!canEdit}
              options={[
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' },
              ]}
              onValueChange={(value) => onChange({ orientation: value })}
              data-testid="page-setup-orientation"
            />
          </div>
          <div className="rd-page-setup__group">
            <span className="rd-page-setup__label">Units</span>
            <SegmentedControl<PageUnit>
              ariaLabel="Units"
              value={settings.unit}
              disabled={!canEdit}
              options={[
                { value: 'mm', label: 'Millimetres' },
                { value: 'in', label: 'Inches' },
              ]}
              onValueChange={(value) => onChange({ unit: value })}
              data-testid="page-setup-unit"
            />
          </div>
        </div>
        <fieldset className="rd-page-setup__margins">
          <legend>Margins</legend>
          {PAGE_MARGIN_KEYS.map((field) => (
            <MarginField
              key={field}
              field={field}
              settings={settings}
              disabled={!canEdit}
              onCommit={onChange}
            />
          ))}
        </fieldset>
        <Select
          label="Page colour"
          value={settings.background}
          disabled={!canEdit}
          options={PAGE_BACKGROUNDS.map((value) => ({ value, label: BACKGROUND_LABELS[value] }))}
          onValueChange={(value) => onChange({ background: value as PageBackground })}
          data-testid="page-setup-background"
        />
        <p className="rd-page-setup__note">
          The page is one continuous sheet on screen; page breaks appear when you print.
        </p>
      </div>
    </Dialog>
  );
}
