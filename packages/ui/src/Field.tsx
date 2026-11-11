import { ChevronDown } from 'lucide-react';
import {
  type ChangeEvent,
  type ComponentProps,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useId,
} from 'react';
import { cx } from './utils';

export type ControlSize = 'sm' | 'md';

/** Props to spread on a custom control so `Field` can label and describe it. */
export interface FieldControlProps {
  id: string;
  /** Names controls a `<label for>` cannot reach, such as a radio group. */
  'aria-labelledby': string | undefined;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

interface FieldTexts {
  /** Visible label. Without one, give the control an `aria-label`. */
  label?: ReactNode;
  /** Help text under the control. */
  hint?: ReactNode;
  /** Error text; also marks the control invalid. `true` marks it without text. */
  error?: ReactNode;
  /** Keep the label for assistive technology but hide it visually. */
  hideLabel?: boolean;
}

export interface FieldProps extends Omit<ComponentProps<'div'>, 'children'>, FieldTexts {
  /** Adds a required marker to the label. */
  required?: boolean;
  /** Id of the control. Generated when omitted. */
  htmlFor?: string;
  /**
   * The control. Pass a function to receive the id and ARIA attributes for a
   * custom control: `{(control) => <input {...control} />}`.
   */
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
}

function hasText(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== true && node !== '';
}

function joinIds(...ids: Array<string | false | undefined>): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
}

interface FieldWiring {
  id: string;
  labelId: string;
  hintId: string;
  errorId: string;
  invalid: boolean;
  describedBy: string | undefined;
}

function useFieldWiring(
  idProp: string | undefined,
  hint: ReactNode,
  error: ReactNode,
  describedByProp?: string,
): FieldWiring {
  const generatedId = useId();
  const id = idProp ?? `rd-field-${generatedId}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = error !== undefined && error !== null && error !== false && error !== '';
  return {
    id,
    labelId: `${id}-label`,
    hintId,
    errorId,
    invalid,
    describedBy: joinIds(describedByProp, hasText(error) && errorId, hasText(hint) && hintId),
  };
}

interface FieldFrameProps extends FieldTexts {
  wiring: FieldWiring;
  required?: boolean;
  className?: string;
  style?: CSSProperties;
  rootProps?: Omit<ComponentProps<'div'>, 'children' | 'className' | 'style'>;
  children: ReactNode;
}

function FieldFrame({
  wiring,
  label,
  hint,
  error,
  hideLabel,
  required,
  className,
  style,
  rootProps,
  children,
}: FieldFrameProps) {
  return (
    <div
      {...rootProps}
      className={cx('rd-field', className)}
      style={style}
      data-invalid={wiring.invalid ? '' : undefined}
    >
      {hasText(label) ? (
        <label
          id={wiring.labelId}
          htmlFor={wiring.id}
          className={cx('rd-field__label', hideLabel && 'rd-visually-hidden')}
        >
          {label}
          {required ? (
            <span className="rd-field__required" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {hasText(error) ? (
        <p id={wiring.errorId} className="rd-field__error">
          {error}
        </p>
      ) : null}
      {hasText(hint) ? (
        <p id={wiring.hintId} className="rd-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Label, hint and error around any control. */
export function Field({
  label,
  hint,
  error,
  hideLabel,
  required,
  htmlFor,
  className,
  style,
  children,
  ...rest
}: FieldProps) {
  const wiring = useFieldWiring(htmlFor, hint, error);
  const control: FieldControlProps = {
    id: wiring.id,
    'aria-labelledby': hasText(label) ? wiring.labelId : undefined,
    'aria-describedby': wiring.describedBy,
    'aria-invalid': wiring.invalid || undefined,
    'aria-required': required || undefined,
  };
  return (
    <FieldFrame
      wiring={wiring}
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      required={required}
      className={className}
      style={style}
      rootProps={rest}
    >
      {typeof children === 'function' ? children(control) : children}
    </FieldFrame>
  );
}

/** Lets a press on the padding or an affix focus the control inside the box. */
function focusControlOnPress(event: PointerEvent<HTMLDivElement>): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('input, textarea, select, button, a, [tabindex]')) return;
  const control = event.currentTarget.querySelector<HTMLElement>('input, textarea, select');
  if (!control) return;
  event.preventDefault();
  control.focus();
}

export interface TextFieldProps
  extends Omit<ComponentProps<'input'>, 'size' | 'prefix'>, FieldTexts {
  /** Shown inside the box before the text, such as an icon or a unit. */
  prefix?: ReactNode;
  /** Shown inside the box after the text, such as a unit or a button. */
  suffix?: ReactNode;
  /** `md` is 32px tall, `sm` 28px. */
  size?: ControlSize;
  /** Class for the bordered box. `className` and `style` go to the outer wrapper. */
  boxClassName?: string;
}

/**
 * A single-line text input with a label. `className` and `style` apply to the
 * wrapper; every other prop, including `ref` and `data-testid`, reaches the `<input>`.
 */
export function TextField({
  label,
  hint,
  error,
  hideLabel,
  prefix,
  suffix,
  size = 'md',
  className,
  style,
  boxClassName,
  id,
  required,
  disabled,
  type = 'text',
  'aria-describedby': describedBy,
  ...rest
}: TextFieldProps) {
  const wiring = useFieldWiring(id, hint, error, describedBy);
  return (
    <FieldFrame
      wiring={wiring}
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      required={required}
      className={className}
      style={style}
    >
      <div
        className={cx('rd-input', `rd-input--${size}`, boxClassName)}
        data-disabled={disabled ? '' : undefined}
        onPointerDown={focusControlOnPress}
      >
        {hasText(prefix) ? <span className="rd-input__affix">{prefix}</span> : null}
        <input
          {...rest}
          id={wiring.id}
          type={type}
          required={required}
          disabled={disabled}
          aria-invalid={wiring.invalid || undefined}
          aria-describedby={wiring.describedBy}
          className="rd-input__control"
        />
        {hasText(suffix) ? <span className="rd-input__affix">{suffix}</span> : null}
      </div>
    </FieldFrame>
  );
}

export interface TextAreaProps extends ComponentProps<'textarea'>, FieldTexts {
  /** Class for the bordered box. `className` and `style` go to the outer wrapper. */
  boxClassName?: string;
}

/** A multi-line text input with a label. Props are routed as in `TextField`. */
export function TextArea({
  label,
  hint,
  error,
  hideLabel,
  className,
  style,
  boxClassName,
  id,
  required,
  disabled,
  rows = 3,
  'aria-describedby': describedBy,
  ...rest
}: TextAreaProps) {
  const wiring = useFieldWiring(id, hint, error, describedBy);
  return (
    <FieldFrame
      wiring={wiring}
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      required={required}
      className={className}
      style={style}
    >
      <div
        className={cx('rd-input', 'rd-input--area', boxClassName)}
        data-disabled={disabled ? '' : undefined}
      >
        <textarea
          {...rest}
          id={wiring.id}
          rows={rows}
          required={required}
          disabled={disabled}
          aria-invalid={wiring.invalid || undefined}
          aria-describedby={wiring.describedBy}
          className="rd-input__control"
        />
      </div>
    </FieldFrame>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentProps<'select'>, 'size'>, FieldTexts {
  /** The choices. Alternatively pass `<option>` elements as children. */
  options?: readonly SelectOption[];
  /** Shown while the value is the empty string; it cannot be chosen. */
  placeholder?: string;
  /** `md` is 32px tall, `sm` 28px. */
  size?: ControlSize;
  /** Called with the new value, next to the native `onChange`. */
  onValueChange?: (value: string) => void;
  /** Class for the bordered box. `className` and `style` go to the outer wrapper. */
  boxClassName?: string;
}

/**
 * A native `<select>` in the kit's styling, so it keeps the platform picker,
 * type-ahead and mobile behaviour. Props are routed as in `TextField`.
 */
export function Select({
  label,
  hint,
  error,
  hideLabel,
  options,
  placeholder,
  size = 'md',
  onValueChange,
  onChange,
  className,
  style,
  boxClassName,
  id,
  required,
  disabled,
  children,
  'aria-describedby': describedBy,
  ...rest
}: SelectProps) {
  const wiring = useFieldWiring(id, hint, error, describedBy);
  return (
    <FieldFrame
      wiring={wiring}
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      required={required}
      className={className}
      style={style}
    >
      <div
        className={cx('rd-input', 'rd-select', `rd-input--${size}`, boxClassName)}
        data-disabled={disabled ? '' : undefined}
      >
        <select
          {...rest}
          id={wiring.id}
          required={required}
          disabled={disabled}
          aria-invalid={wiring.invalid || undefined}
          aria-describedby={wiring.describedBy}
          className="rd-input__control rd-select__control"
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            onChange?.(event);
            onValueChange?.(event.target.value);
          }}
        >
          {placeholder !== undefined ? (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          ) : null}
          {options?.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
          {children}
        </select>
        <ChevronDown className="rd-select__chevron" aria-hidden="true" />
      </div>
    </FieldFrame>
  );
}
