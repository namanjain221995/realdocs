import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../src/index';

type ExecCommand = (command: string) => boolean;

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalSecure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value });
}

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value });
}

/** Installs `document.execCommand` (happy-dom has none) and returns the spy. */
function setExecCommand(implementation: ExecCommand | undefined) {
  const spy = implementation ? vi.fn(implementation) : undefined;
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    writable: true,
    value: spy,
  });
  return spy;
}

function restore(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

afterEach(() => {
  restore(navigator, 'clipboard', originalClipboard);
  restore(window, 'isSecureContext', originalSecure);
  restore(document, 'execCommand', originalExecCommand);
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('uses the async Clipboard API when it is available', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    const execCommand = setExecCommand(() => true);

    await expect(copyText('https://docs.example.test/s/abc')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://docs.example.test/s/abc');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('calls the Clipboard API synchronously, inside the user gesture', () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    void copyText('now');
    // No awaiting: Safari only allows the write while the click is being handled.
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('falls back to execCommand when there is no Clipboard API', async () => {
    setClipboard(undefined);
    let copied: string | null = null;
    let selection: [number | null, number | null] = [null, null];
    let focused = false;
    const execCommand = setExecCommand((command) => {
      const textarea = document.querySelector('textarea');
      copied = textarea?.value ?? null;
      selection = [textarea?.selectionStart ?? null, textarea?.selectionEnd ?? null];
      focused = document.activeElement === textarea;
      return command === 'copy';
    });

    await expect(copyText('मिश्रित text 🎉')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy');
    expect(copied).toBe('मिश्रित text 🎉');
    // The whole value was selected and focused when the command ran.
    expect(selection).toEqual([0, 'मिश्रित text 🎉'.length]);
    expect(focused).toBe(true);
    // The helper textarea is gone again.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('keeps the fallback textarea out of sight, out of the tab order and read-only', async () => {
    setClipboard(undefined);
    let snapshot: Record<string, unknown> = {};
    setExecCommand(() => {
      const textarea = document.querySelector('textarea');
      snapshot = {
        readOnly: textarea?.readOnly,
        tabIndex: textarea?.tabIndex,
        ariaHidden: textarea?.getAttribute('aria-hidden'),
        position: textarea?.style.position,
        opacity: textarea?.style.opacity,
        fontSize: textarea?.style.fontSize,
      };
      return true;
    });
    await copyText('secret');
    expect(snapshot).toEqual({
      readOnly: true,
      tabIndex: -1,
      ariaHidden: 'true',
      position: 'fixed',
      opacity: '0',
      // 16px keeps iOS Safari from zooming the page when the textarea is focused.
      fontSize: '16px',
    });
  });

  it('falls back when the Clipboard API rejects, as Safari does outside a gesture', async () => {
    const writeText = vi.fn(() => Promise.reject(new DOMException('Denied', 'NotAllowedError')));
    setClipboard({ writeText });
    const execCommand = setExecCommand(() => true);

    await expect(copyText('link')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy');
  });

  it('falls back when writeText throws synchronously', async () => {
    setClipboard({
      writeText: () => {
        throw new TypeError('Illegal invocation');
      },
    });
    const execCommand = setExecCommand(() => true);
    await expect(copyText('link')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it('skips the async API in an insecure context', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    setSecureContext(false);
    const execCommand = setExecCommand(() => true);

    await expect(copyText('link')).resolves.toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it('returns false when the browser refuses the legacy command', async () => {
    setClipboard(undefined);
    setExecCommand(() => false);
    await expect(copyText('link')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('returns false instead of throwing when execCommand throws', async () => {
    setClipboard(undefined);
    setExecCommand(() => {
      throw new Error('execCommand is blocked');
    });
    await expect(copyText('link')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('returns false when neither path exists', async () => {
    setClipboard(undefined);
    setExecCommand(undefined);
    await expect(copyText('link')).resolves.toBe(false);
  });

  it('returns false when both paths fail', async () => {
    setClipboard({ writeText: () => Promise.reject(new Error('no')) });
    setExecCommand(() => false);
    await expect(copyText('link')).resolves.toBe(false);
  });

  it('puts focus back where it was after the fallback', async () => {
    setClipboard(undefined);
    setExecCommand(() => true);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    await copyText('link');
    expect(document.activeElement).toBe(button);
  });

  it('copies an empty string', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    await expect(copyText('')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('');
  });
});
