import { Check, Minus } from 'lucide-react';
import {
  type ChangeEvent,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useId,
  useRef,
} from 'react';
import type { ControlSize } from './Field';
import { focusElement } from './internal/focus';
import { useControllableState, useIsomorphicLayoutEffect, useMergedRefs } from './internal/hooks';
import { ToolbarContext } from './internal/toolbar-context';
import { cx } from './utils';

function hasText(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

function joinIds(...ids: Array<string | false | undefined>): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined || undefined;
}

/* --------------------------------------------------------------- Checkbox */

export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type' | 'size'> {
  /** Text next to the box. Without one, pass `aria-label`. */
  label?: ReactNode;
  /** Secondary text under the label. */
  hint?: ReactNode;
  /** Shows a dash: some, but not all, of a group are selected. */
  indeterminate?: boolean;
  /** Called with the new state, next to the native `onChange`. */
  onCheckedChange?: (checked: boolean) => void;
}

/**
 * A native checkbox. `className` and `style` apply to the wrapping label;
 * every other prop, including `ref` and `data-testid`, reaches the `<input>`.
 */
export function Checkbox({
  label,
  hint,
  indeterminate = false,
  onCheckedChange,
  onChange,
  className,
  style,
  disabled,
  ref,
  'aria-describedby': describedBy,
  ...rest
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mergedRef = useMergedRefs<HTMLInputElement>(ref, inputRef);
  const hintId = useId();

  // `indeterminate` exists only as a DOM property.
  useIsomorphicLayoutEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      className={cx('rd-check', className)}
      style={style}
      data-disabled={disabled ? '' : undefined}
    >
      <span className="rd-check__control">
        <input
          {...rest}
          ref={mergedRef}
          type="checkbox"
          disabled={disabled}
          aria-describedby={joinIds(describedBy, hasText(hint) && hintId)}
          className="rd-check__input"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onChange?.(event);
            onCheckedChange?.(event.target.checked);
          }}
        />
        <span className="rd-check__box" aria-hidden="true">
          <Check className="rd-check__tick" />
          <Minus className="rd-check__dash" />
        </span>
      </span>
      {hasText(label) || hasText(hint) ? (
        <span className="rd-check__text">
          {hasText(label) ? <span className="rd-check__label">{label}</span> : null}
          {hasText(hint) ? (
            <span id={hintId} className="rd-check__hint">
              {hint}
            </span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}

/* ----------------------------------------------------------------- Switch */

export interface SwitchProps extends Omit<
  ComponentProps<'input'>,
  'type' | 'size' | 'checked' | 'role'
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Text next to the switch. Without one, pass `aria-label`. */
  label?: ReactNode;
  /** Secondary text under the label. */
  hint?: ReactNode;
  /** Put the label before the switch, for settings rows. */
  labelPosition?: 'start' | 'end';
}

/**
 * An on/off setting that applies at once. Props are routed as in `Checkbox`.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  hint,
  labelPosition = 'end',
  onChange,
  className,
  style,
  disabled,
  'aria-describedby': describedBy,
  ...rest
}: SwitchProps) {
  const hintId = useId();
  return (
    <label
      className={cx('rd-switch', labelPosition === 'start' && 'rd-switch--label-start', className)}
      style={style}
      data-disabled={disabled ? '' : undefined}
    >
      <span className="rd-switch__control">
        <input
          {...rest}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-describedby={joinIds(describedBy, hasText(hint) && hintId)}
          className="rd-switch__input"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onChange?.(event);
            onCheckedChange(event.target.checked);
          }}
        />
        <span className="rd-switch__track" aria-hidden="true">
          <span className="rd-switch__thumb" />
        </span>
      </span>
      {hasText(label) || hasText(hint) ? (
        <span className="rd-check__text">
          {hasText(label) ? <span className="rd-check__label">{label}</span> : null}
          {hasText(hint) ? (
            <span id={hintId} className="rd-check__hint">
              {hint}
            </span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}

/* ----------------------------------------------------------------- Slider */

export interface SliderProps extends Omit<
  ComponentProps<'input'>,
  'type' | 'size' | 'value' | 'defaultValue' | 'min' | 'max' | 'step'
> {
  /** Defaults to 0. */
  min?: number;
  /** Defaults to 100. */
  max?: number;
  /** Defaults to 1. */
  step?: number;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  /** Text above the track. Without one, pass `aria-label`. */
  label?: ReactNode;
  /** Formats the value shown next to the label and read by screen readers. */
  formatValue?: (value: number) => string;
  /** Hide the value read-out. */
  hideValue?: boolean;
}

/**
 * A native range input. `className` and `style` apply to the wrapper; every
 * other prop, including `ref` and `data-testid`, reaches the `<input>`.
 */
export function Slider({
  min = 0,
  max = 100,
  step = 1,
  value: valueProp,
  defaultValue,
  onValueChange,
  label,
  formatValue,
  hideValue = false,
  onChange,
  className,
  style,
  id: idProp,
  disabled,
  ...rest
}: SliderProps) {
  const generatedId = useId();
  const id = idProp ?? `rd-slider-${generatedId}`;
  const [value, setValue] = useControllableState(valueProp, defaultValue ?? min, onValueChange);
  const text = formatValue ? formatValue(value) : String(value);
  const span = max - min;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0;
  const showHeader = hasText(label) || !hideValue;

  return (
    <div
      className={cx('rd-slider', className)}
      style={style}
      data-disabled={disabled ? '' : undefined}
    >
      {showHeader ? (
        <div className="rd-slider__header">
          {hasText(label) ? (
            <label htmlFor={id} className="rd-field__label">
              {label}
            </label>
          ) : (
            <span />
          )}
          {hideValue ? null : (
            <output htmlFor={id} className="rd-slider__value">
              {text}
            </output>
          )}
        </div>
      ) : null}
      <input
        {...rest}
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={formatValue ? text : undefined}
        className="rd-slider__input"
        style={{ '--rd-slider-fill': `${(fraction * 100).toFixed(2)}%` } as CSSProperties}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange?.(event);
          setValue(Number(event.target.value));
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------- SegmentedControl */

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> extends Omit<
  ComponentProps<'div'>,
  'children' | 'onChange' | 'role'
> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onValueChange: (value: T) => void;
  /** Names the group for assistive technology. */
  ariaLabel: string;
  /** `md` is 32px tall, `sm` 28px. */
  size?: ControlSize;
  /** Options share the full width of the container equally. */
  fullWidth?: boolean;
  /** Show icons only. Labels stay available to assistive technology. */
  iconOnly?: boolean;
  disabled?: boolean;
}

/**
 * A choice between a few options, shown side by side. A radio group: arrow
 * keys move and select, and the group is a single tab stop.
 */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  onValueChange,
  ariaLabel,
  size = 'md',
  fullWidth = false,
  iconOnly = false,
  disabled = false,
  className,
  onKeyDown,
  ...rest
}: SegmentedControlProps<T>) {
  const inToolbar = useContext(ToolbarContext);
  const hasSelection = options.some((option) => option.value === value && !option.disabled);
  const firstEnabled = options.find((option) => !option.disabled)?.value;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    // In a toolbar the arrows walk the whole toolbar; Enter and Space select.
    if (event.defaultPrevented || inToolbar || disabled) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'radio') return;
    const enabled = options.filter((option) => !option.disabled);
    const current = enabled.findIndex((option) => option.value === target.dataset.value);
    if (current === -1 || enabled.length === 0) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    let next: number;
    if (event.key === forward || event.key === 'ArrowDown') next = (current + 1) % enabled.length;
    else if (event.key === backward || event.key === 'ArrowUp') {
      next = (current - 1 + enabled.length) % enabled.length;
    } else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    else return;
    event.preventDefault();
    const option = enabled[next];
    if (!option) return;
    const buttons = event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
    for (const button of buttons) {
      if (button.dataset.value === option.value) focusElement(button);
    }
    if (option.value !== value) onValueChange(option.value);
  };

  return (
    <div
      {...rest}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cx(
        'rd-segmented',
        `rd-segmented--${size}`,
        fullWidth && 'rd-segmented--full',
        iconOnly && 'rd-segmented--icon-only',
        className,
      )}
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const optionDisabled = disabled || option.disabled === true;
        const tabStop = selected || (!hasSelection && option.value === firstEnabled);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={optionDisabled}
            // A toolbar manages the tab stops of everything inside it.
            tabIndex={inToolbar ? undefined : tabStop ? 0 : -1}
            data-value={option.value}
            title={iconOnly && typeof option.label === 'string' ? option.label : undefined}
            className="rd-segmented__option"
            onClick={() => {
              if (!selected) onValueChange(option.value);
            }}
          >
            {option.icon ? (
              <span className="rd-segmented__icon" aria-hidden="true">
                {option.icon}
              </span>
            ) : null}
            <span className={cx('rd-segmented__label', iconOnly && 'rd-visually-hidden')}>
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
