import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { IconButton } from './Button';
import { useMergedRefs } from './internal/hooks';
import { copyText, cx } from './utils';

export interface CopyFieldProps extends Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'size' | 'type' | 'readOnly' | 'onChange'
> {
  /** The text to show and copy, such as a share link. */
  value: string;
  label?: ReactNode;
  /** Help text under the field. */
  hint?: ReactNode;
  /**
   * Hide the value behind dots until the user reveals it. Copying always
   * copies the real value. Use for links that grant access.
   */
  masked?: boolean;
  /** Called after the value reached the clipboard. */
  onCopied?: () => void;
  /** Button text. Defaults to `Copy`. */
  copyLabel?: string;
  /** Button text right after copying. Defaults to `Copied`. */
  copiedLabel?: string;
  /** Shown when the browser refuses clipboard access. */
  failedLabel?: string;
  /** Names of the reveal toggle. Default to `Show` and `Hide`. */
  showLabel?: string;
  hideLabel?: string;
}

type CopyStatus = 'idle' | 'copied' | 'failed';

const STATUS_RESET_MS = 2000;
/** Fixed length, so the mask does not give away how long the secret is. */
const MASK = '•'.repeat(24);

/**
 * A read-only value with a copy button. `className` and `style` apply to the
 * wrapper; every other prop, including `ref` and `data-testid`, reaches the `<input>`.
 */
export function CopyField({
  value,
  label,
  hint,
  masked = false,
  onCopied,
  copyLabel = 'Copy',
  copiedLabel = 'Copied',
  failedLabel = 'Copy failed. Select the text and copy it yourself.',
  showLabel = 'Show',
  hideLabel = 'Hide',
  className,
  style,
  id: idProp,
  ref,
  onClick,
  'aria-describedby': describedBy,
  ...rest
}: CopyFieldProps) {
  const generatedId = useId();
  const id = idProp ?? `rd-copy-${generatedId}`;
  const hintId = `${id}-hint`;
  const [status, setStatus] = useState<CopyStatus>('idle');
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mergedRef = useMergedRefs<HTMLInputElement>(ref, inputRef);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const hidden = masked && !revealed;
  const hasHint = hint !== undefined && hint !== null && hint !== false && hint !== '';

  const clearResetTimer = useCallback(() => {
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearResetTimer();
    };
  }, [clearResetTimer]);

  const copy = (): void => {
    // Started synchronously, so the click still counts as the user gesture.
    void copyText(value).then((copied) => {
      if (!alive.current) return;
      clearResetTimer();
      setStatus(copied ? 'copied' : 'failed');
      if (copied) {
        onCopied?.();
      } else {
        // Leave the real value selected so Ctrl/Cmd+C finishes the job.
        setRevealed(true);
        requestAnimationFrame(() => inputRef.current?.select());
      }
      resetTimer.current = setTimeout(() => setStatus('idle'), STATUS_RESET_MS);
    });
  };

  return (
    <div className={cx('rd-field', className)} style={style}>
      {label !== undefined && label !== null && label !== false && label !== '' ? (
        <label htmlFor={id} className="rd-field__label">
          {label}
        </label>
      ) : null}
      <div className="rd-input rd-input--md rd-copy" data-status={status}>
        <input
          {...rest}
          ref={mergedRef}
          id={id}
          type="text"
          readOnly
          value={hidden ? MASK : value}
          spellCheck={false}
          autoComplete="off"
          aria-describedby={
            [describedBy, hasHint ? hintId : undefined].filter(Boolean).join(' ') || undefined
          }
          className="rd-input__control rd-copy__value"
          // Selecting is left to the user's own actions: a click selects the
          // whole value and the browser does the same for Tab. Focus that
          // arrives from a script (a dialog opening) selects nothing.
          onClick={(event) => {
            onClick?.(event);
            const input = event.currentTarget;
            // A drag or double-click has already selected what the user wants.
            if (!event.defaultPrevented && input.selectionStart === input.selectionEnd) {
              input.select();
            }
          }}
        />
        {masked ? (
          <IconButton
            label={revealed ? hideLabel : showLabel}
            size="sm"
            pressed={revealed}
            className="rd-copy__reveal"
            onClick={() => setRevealed((current) => !current)}
          >
            {revealed ? <EyeOff /> : <Eye />}
          </IconButton>
        ) : null}
        <button type="button" className="rd-copy__button" onClick={copy}>
          {status === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          <span>{status === 'copied' ? copiedLabel : copyLabel}</span>
        </button>
      </div>
      {/* Present from the start so the change is announced. */}
      <span
        role="status"
        className={status === 'failed' ? 'rd-field__error' : 'rd-visually-hidden'}
      >
        {status === 'copied' ? copiedLabel : status === 'failed' ? failedLabel : ''}
      </span>
      {hasHint ? (
        <p id={hintId} className="rd-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
