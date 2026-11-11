import {
  type Ref,
  type RefCallback,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/** `useLayoutEffect` in the browser, `useEffect` where there is no DOM. */
export const useIsomorphicLayoutEffect =
  typeof document === 'undefined' ? useEffect : useLayoutEffect;

/** A ref that always holds the latest value, for use inside effects and listeners. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** State that is controlled when `controlled` is defined and internal otherwise. */
export function useControllableState<T>(
  controlled: T | undefined,
  defaultValue: T,
  onChange?: (value: T) => void,
): [T, (next: T) => void] {
  const [internal, setInternal] = useState(defaultValue);
  const isControlled = controlled !== undefined;
  const value = isControlled ? controlled : internal;
  const onChangeRef = useLatest(onChange);
  const setValue = useCallback(
    (next: T) => {
      if (!isControlled) setInternal(next);
      onChangeRef.current?.(next);
    },
    [isControlled, onChangeRef],
  );
  return [value, setValue];
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): (() => void) | undefined {
  if (typeof ref === 'function') {
    const cleanup = ref(value);
    return typeof cleanup === 'function' ? cleanup : () => void ref(null);
  }
  if (ref) {
    ref.current = value;
    return () => {
      ref.current = null;
    };
  }
  return undefined;
}

/**
 * Merges up to three refs into one stable callback ref. Supports React 19
 * callback refs that return a cleanup function.
 */
export function useMergedRefs<T>(
  first: Ref<T> | undefined,
  second: Ref<T> | undefined,
  third?: Ref<T>,
): RefCallback<T> {
  return useCallback(
    (value: T | null) => {
      const cleanups = [assignRef(first, value), assignRef(second, value), assignRef(third, value)];
      return () => {
        for (const cleanup of cleanups) cleanup?.();
      };
    },
    [first, second, third],
  );
}
