import { X } from 'lucide-react';
import {
  createContext,
  isValidElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { type Tone, ToneIcon } from './Feedback';
import { cx } from './utils';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** The outcome in a few words, matching the action: `Link copied`. */
  title: ReactNode;
  /** Optional detail, kept to one sentence. */
  description?: ReactNode;
  /** `neutral` by default. */
  tone?: Tone;
  /**
   * How long the toast stays, in ms. `0` or `Infinity` keeps it until
   * dismissed. Defaults to 5000, or 8000 when there is an action.
   */
  durationMs?: number;
  /** One follow-up such as Undo: `{ label, onClick }` or your own element. */
  action?: ToastAction | ReactNode;
  /** Reuse an id to update a toast in place instead of stacking a new one. */
  id?: string;
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  show: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

export interface ToastProviderProps {
  children?: ReactNode;
  /** Corner the toasts appear in. Defaults to `bottom-end`. */
  placement?: 'top-end' | 'top-center' | 'bottom-end' | 'bottom-center';
  /** Most toasts shown at once; older ones make room. Defaults to 4. */
  max?: number;
  /** Accessible name of the toast region. Defaults to `Notifications`. */
  label?: string;
  /** Accessible name of each dismiss button. Defaults to `Dismiss`. */
  dismissLabel?: string;
}

interface ToastRecord extends ToastOptions {
  id: string;
  /** Bumped when a toast is updated in place, to restart its timer. */
  revision: number;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION_MS = 5000;
const DEFAULT_DURATION_WITH_ACTION_MS = 8000;

function isToastAction(action: ToastOptions['action']): action is ToastAction {
  return (
    typeof action === 'object' &&
    action !== null &&
    !isValidElement(action) &&
    typeof (action as Partial<ToastAction>).label === 'string' &&
    typeof (action as Partial<ToastAction>).onClick === 'function'
  );
}

/**
 * Hosts toasts for everything below it. Toasts are announced through a polite
 * live region and never take keyboard focus.
 */
export function ToastProvider({
  children,
  placement = 'bottom-end',
  max = 4,
  label = 'Notifications',
  dismissLabel = 'Dismiss',
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const [paused, setPaused] = useState(false);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (options: ToastOptions): string => {
      counter.current += 1;
      const id = options.id ?? `rd-toast-${counter.current}`;
      const revision = counter.current;
      setToasts((current) => {
        const existing = current.findIndex((toast) => toast.id === id);
        if (existing !== -1) {
          return current.map((toast, index) =>
            index === existing ? { ...options, id, revision } : toast,
          );
        }
        const next = [...current, { ...options, id, revision }];
        return next.length > max ? next.slice(next.length - max) : next;
      });
      return id;
    },
    [max],
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      {typeof document === 'undefined'
        ? null
        : createPortal(
            <div
              role="region"
              aria-label={label}
              className={cx('rd-toast-region', `rd-toast-region--${placement}`)}
              onPointerEnter={() => setPaused(true)}
              onPointerLeave={() => setPaused(false)}
              onFocus={() => setPaused(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
              }}
            >
              {/* Always in the DOM so additions are announced; removals are not. */}
              <ol
                className="rd-toast-list"
                aria-live="polite"
                aria-relevant="additions text"
                aria-atomic="false"
              >
                {toasts.map((toast) => (
                  <ToastItem
                    key={toast.id}
                    toast={toast}
                    paused={paused}
                    dismissLabel={dismissLabel}
                    onDismiss={dismiss}
                  />
                ))}
              </ol>
            </div>,
            document.body,
          )}
    </ToastContext>
  );
}

interface ToastItemProps {
  toast: ToastRecord;
  paused: boolean;
  dismissLabel: string;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, paused, dismissLabel, onDismiss }: ToastItemProps) {
  const { id, title, description, tone = 'neutral', action, revision } = toast;
  const simpleAction = isToastAction(action) ? action : null;
  const duration =
    toast.durationMs ??
    (action === undefined || action === null
      ? DEFAULT_DURATION_MS
      : DEFAULT_DURATION_WITH_ACTION_MS);

  useEffect(() => {
    if (paused || !Number.isFinite(duration) || duration <= 0) return;
    const timer = setTimeout(() => onDismiss(id), duration);
    return () => clearTimeout(timer);
  }, [paused, duration, id, revision, onDismiss]);

  const showIcon = tone !== 'neutral';
  return (
    <li className={cx('rd-toast', `rd-tone-${tone}`)} data-toast-id={id}>
      {showIcon ? (
        <span className="rd-toast__icon" aria-hidden="true">
          <ToneIcon tone={tone} />
        </span>
      ) : null}
      <div className="rd-toast__content">
        <p className="rd-toast__title">{title}</p>
        {description !== undefined && description !== null && description !== false ? (
          <p className="rd-toast__description">{description}</p>
        ) : null}
      </div>
      {simpleAction ? (
        <button
          type="button"
          className="rd-toast__action"
          onClick={() => {
            simpleAction.onClick();
            onDismiss(id);
          }}
        >
          {simpleAction.label}
        </button>
      ) : action !== undefined && action !== null && action !== false ? (
        <div className="rd-toast__slot">{action as ReactNode}</div>
      ) : null}
      <button
        type="button"
        className="rd-toast__close"
        aria-label={dismissLabel}
        onClick={() => onDismiss(id)}
      >
        <X aria-hidden="true" />
      </button>
    </li>
  );
}

/** Shows and dismisses toasts. Must be called below a `ToastProvider`. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast() must be used inside <ToastProvider>.');
  return api;
}
