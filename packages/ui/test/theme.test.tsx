import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Theme, ThemeProvider, type ThemeProviderProps, useTheme } from '../src/index';
import { byTestId, click, render } from './helpers';

function Probe() {
  const { theme, resolved, setTheme } = useTheme();
  return (
    <div>
      <output data-testid="theme">{theme}</output>
      <output data-testid="resolved">{resolved}</output>
      {(['dark', 'light', 'system'] as const).map((value) => (
        <button
          key={value}
          type="button"
          data-testid={`set-${value}`}
          onClick={() => setTheme(value)}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

function mount(props: ThemeProviderProps = {}) {
  return render(
    <ThemeProvider {...props}>
      <Probe />
    </ThemeProvider>,
  );
}

function rootTheme(): string | null {
  return document.documentElement.getAttribute('data-theme');
}

/** Replaces matchMedia with a controllable `prefers-color-scheme: dark` query. */
function mockSystemTheme(initiallyDark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initiallyDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.spyOn(window, 'matchMedia').mockImplementation(() => query as unknown as MediaQueryList);
  return {
    set(dark: boolean) {
      query.matches = dark;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
    listenerCount: () => listeners.size,
  };
}

/** Makes every localStorage access throw, as in a blocked or sandboxed context. */
function breakStorage() {
  const failure = (): never => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(failure);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(failure);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ThemeProvider', () => {
  it('defaults to dark and marks the document root', () => {
    mount();
    expect(byTestId('theme').textContent).toBe('dark');
    expect(byTestId('resolved').textContent).toBe('dark');
    expect(rootTheme()).toBe('dark');
  });

  it('persists a change to localStorage under rd.theme and applies it', () => {
    mount();
    click(byTestId('set-light'));
    expect(byTestId('theme').textContent).toBe('light');
    expect(byTestId('resolved').textContent).toBe('light');
    expect(rootTheme()).toBe('light');
    expect(window.localStorage.getItem('rd.theme')).toBe('light');
  });

  it('restores the saved choice on the next mount', () => {
    window.localStorage.setItem('rd.theme', 'light');
    mount();
    expect(byTestId('theme').textContent).toBe('light');
    expect(rootTheme()).toBe('light');
  });

  it('prefers the saved choice over defaultTheme', () => {
    window.localStorage.setItem('rd.theme', 'dark');
    mount({ defaultTheme: 'light' });
    expect(byTestId('theme').textContent).toBe('dark');
  });

  it('uses defaultTheme when nothing is saved, without writing it', () => {
    mount({ defaultTheme: 'light' });
    expect(byTestId('resolved').textContent).toBe('light');
    expect(rootTheme()).toBe('light');
    expect(window.localStorage.getItem('rd.theme')).toBeNull();
  });

  it('ignores a saved value that is not a theme', () => {
    window.localStorage.setItem('rd.theme', 'sepia');
    mount();
    expect(byTestId('theme').textContent).toBe('dark');
    expect(rootTheme()).toBe('dark');
  });

  it('reads and writes a custom storageKey', () => {
    window.localStorage.setItem('panel.theme', 'light');
    mount({ storageKey: 'panel.theme' });
    expect(byTestId('theme').textContent).toBe('light');
    click(byTestId('set-dark'));
    expect(window.localStorage.getItem('panel.theme')).toBe('dark');
    expect(window.localStorage.getItem('rd.theme')).toBeNull();
  });

  it('resolves "system" from the OS setting and follows changes to it', () => {
    const system = mockSystemTheme(false);
    mount({ defaultTheme: 'system' });
    expect(byTestId('theme').textContent).toBe('system');
    expect(byTestId('resolved').textContent).toBe('light');
    expect(rootTheme()).toBe('light');

    system.set(true);
    expect(byTestId('resolved').textContent).toBe('dark');
    expect(rootTheme()).toBe('dark');
    // The choice itself is still "system".
    expect(byTestId('theme').textContent).toBe('system');
  });

  it('stops listening to the OS setting when unmounted', () => {
    const system = mockSystemTheme(true);
    const view = mount({ defaultTheme: 'system' });
    expect(system.listenerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(system.listenerCount()).toBe(0);
  });

  it('saves "system" as the choice, not what it resolved to', () => {
    mockSystemTheme(false);
    mount();
    click(byTestId('set-system'));
    expect(window.localStorage.getItem('rd.theme')).toBe('system');
    expect(rootTheme()).toBe('light');
  });

  it('falls back to dark for "system" when matchMedia is missing', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(() => {
      throw new Error('not supported');
    });
    mount({ defaultTheme: 'system' });
    expect(byTestId('resolved').textContent).toBe('dark');
  });

  it('still works when storage throws on read and on write', () => {
    breakStorage();
    expect(() => mount()).not.toThrow();
    expect(byTestId('theme').textContent).toBe('dark');
    expect(rootTheme()).toBe('dark');

    expect(() => click(byTestId('set-light'))).not.toThrow();
    // The choice applies for the session even though it could not be saved.
    expect(byTestId('theme').textContent).toBe('light');
    expect(rootTheme()).toBe('light');
  });

  it('still works when localStorage itself is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied.', 'SecurityError');
      },
    });
    try {
      expect(() => mount({ defaultTheme: 'light' })).not.toThrow();
      expect(rootTheme()).toBe('light');
      expect(() => click(byTestId('set-dark'))).not.toThrow();
      expect(rootTheme()).toBe('dark');
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    }
  });

  it('follows a change made in another tab', () => {
    mount();
    const announce = (newValue: string | null): void => {
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'rd.theme', newValue }));
      });
    };
    announce('light');
    expect(byTestId('theme').textContent).toBe('light');
    expect(rootTheme()).toBe('light');
    // Cleared elsewhere: back to the default.
    announce(null);
    expect(byTestId('theme').textContent).toBe('dark');
    // Another key is none of our business.
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'light' }));
    });
    expect(byTestId('theme').textContent).toBe('dark');
  });

  it('exposes a stable setTheme', () => {
    const seen = new Set<(theme: Theme) => void>();
    function Collect() {
      seen.add(useTheme().setTheme);
      return null;
    }
    render(
      <ThemeProvider>
        <Collect />
        <Probe />
      </ThemeProvider>,
    );
    click(byTestId('set-light'));
    click(byTestId('set-dark'));
    expect(seen.size).toBe(1);
  });
});

describe('useTheme', () => {
  it('throws a helpful error outside a provider', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('useTheme() must be used inside <ThemeProvider>.');
    errors.mockRestore();
  });
});
