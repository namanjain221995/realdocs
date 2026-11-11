import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button, TextField, type ToastApi, ToastProvider, useToast } from '../src/index';
import { byTestId, click, focus, get, getAll, query, render } from './helpers';

let api: ToastApi;

function Capture() {
  api = useToast();
  return null;
}

function mount(max?: number) {
  return render(
    <ToastProvider max={max}>
      <Capture />
      <TextField label="Document title" data-testid="title" />
      <Button data-testid="save" onClick={() => api.show({ title: 'Saved', tone: 'success' })}>
        Save
      </Button>
    </ToastProvider>,
  );
}

function show(...args: Parameters<ToastApi['show']>): string {
  let id = '';
  act(() => {
    id = api.show(...args);
  });
  return id;
}

function titles(): string[] {
  return getAll('.rd-toast__title').map((title) => title.textContent ?? '');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastProvider', () => {
  it('keeps a polite live region in the DOM before any toast exists', () => {
    mount();
    const region = get('[role="region"]');
    expect(region.getAttribute('aria-label')).toBe('Notifications');
    const live = get('[aria-live]');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(region.contains(live)).toBe(true);
    expect(live.children).toHaveLength(0);
    // Portalled to the body, outside the app container.
    expect(region.parentElement).toBe(document.body);
  });

  it('adds a toast to the live region and returns its id', () => {
    mount();
    const id = show({ title: 'Link copied', description: 'Paste it anywhere.', tone: 'success' });
    expect(id).toMatch(/^rd-toast-/);
    const toast = get('.rd-toast');
    expect(get('[aria-live="polite"]').contains(toast)).toBe(true);
    expect(toast.dataset.toastId).toBe(id);
    expect(get('.rd-toast__title').textContent).toBe('Link copied');
    expect(get('.rd-toast__description').textContent).toBe('Paste it anywhere.');
    expect(toast.classList.contains('rd-tone-success')).toBe(true);
  });

  it('never moves focus: not on show, not on update, not on dismissal', () => {
    mount();
    const input = byTestId<HTMLInputElement>('title');
    focus(input);
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');

    const id = show({
      title: 'Moved to trash',
      action: { label: 'Undo', onClick: () => undefined },
    });
    expect(document.activeElement).toBe(input);

    show({ id, title: 'Moved 2 documents to trash' });
    expect(document.activeElement).toBe(input);

    show({ title: 'Upload failed', tone: 'danger', durationMs: 0 });
    expect(document.activeElement).toBe(input);

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(titles()).toEqual(['Upload failed']);
    expect(document.activeElement).toBe(input);

    act(() => api.dismiss(getAll('.rd-toast')[0]?.dataset.toastId ?? ''));
    expect(query('.rd-toast')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('leaves focus on the button that triggered the toast', () => {
    mount();
    const save = byTestId('save');
    focus(save);
    click(save);
    expect(titles()).toEqual(['Saved']);
    expect(document.activeElement).toBe(save);
  });

  it('does not make toasts or their container focus targets by default', () => {
    mount();
    show({ title: 'Saved' });
    expect(get('.rd-toast').hasAttribute('tabindex')).toBe(false);
    expect(get('[role="region"]').hasAttribute('tabindex')).toBe(false);
    expect(query('.rd-toast [autofocus]')).toBeNull();
  });

  it('dismisses after the default 5 seconds', () => {
    mount();
    show({ title: 'Saved' });
    act(() => {
      vi.advanceTimersByTime(4_900);
    });
    expect(titles()).toEqual(['Saved']);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(titles()).toEqual([]);
  });

  it('honours durationMs, and keeps a toast with 0 or Infinity until dismissed', () => {
    mount();
    show({ title: 'Quick', durationMs: 1_000 });
    show({ title: 'Sticky', durationMs: 0 });
    show({ title: 'Forever', durationMs: Infinity });
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(titles()).toEqual(['Sticky', 'Forever']);
    act(() => {
      vi.advanceTimersByTime(600_000);
    });
    expect(titles()).toEqual(['Sticky', 'Forever']);
  });

  it('gives a toast with an action more time', () => {
    mount();
    show({ title: 'Moved to trash', action: { label: 'Undo', onClick: () => undefined } });
    act(() => {
      vi.advanceTimersByTime(7_000);
    });
    expect(titles()).toEqual(['Moved to trash']);
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(titles()).toEqual([]);
  });

  it('dismiss(id) removes just that toast, and unknown ids are ignored', () => {
    mount();
    const first = show({ title: 'First', durationMs: 0 });
    show({ title: 'Second', durationMs: 0 });
    act(() => api.dismiss(first));
    expect(titles()).toEqual(['Second']);
    expect(() => act(() => api.dismiss('nope'))).not.toThrow();
    expect(titles()).toEqual(['Second']);
  });

  it('runs the action once and then dismisses the toast', () => {
    mount();
    const undo = vi.fn();
    show({ title: 'Moved to trash', action: { label: 'Undo', onClick: undo } });
    const action = get('.rd-toast__action');
    expect(action.textContent).toBe('Undo');
    click(action);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(query('.rd-toast')).toBeNull();
  });

  it('accepts a custom element as the action', () => {
    mount();
    show({ title: 'Update ready', action: <a href="/reload">Reload</a>, durationMs: 0 });
    expect(get('.rd-toast__slot a').getAttribute('href')).toBe('/reload');
    expect(query('.rd-toast__action')).toBeNull();
  });

  it('has a labelled dismiss button', () => {
    mount();
    show({ title: 'Saved', durationMs: 0 });
    const close = get('.rd-toast__close');
    expect(close.getAttribute('aria-label')).toBe('Dismiss');
    click(close);
    expect(query('.rd-toast')).toBeNull();
  });

  it('pauses the countdown while the pointer or focus is on the toasts', () => {
    mount();
    show({ title: 'Saved' });
    const region = get('[role="region"]');
    // React derives pointerenter/leave from pointerover/out.
    act(() => {
      region.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(titles()).toEqual(['Saved']);
    act(() => {
      region.dispatchEvent(
        new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(5_100);
    });
    expect(titles()).toEqual([]);
  });

  it('shows at most `max` toasts, dropping the oldest', () => {
    mount(2);
    show({ title: 'One', durationMs: 0 });
    show({ title: 'Two', durationMs: 0 });
    show({ title: 'Three', durationMs: 0 });
    expect(titles()).toEqual(['Two', 'Three']);
  });

  it('updates a toast in place when an id is reused, restarting its timer', () => {
    mount();
    const id = show({ id: 'save', title: 'Saving', durationMs: 0 });
    expect(id).toBe('save');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(show({ id: 'save', title: 'Saved', tone: 'success', durationMs: 2_000 })).toBe('save');
    expect(titles()).toEqual(['Saved']);
    act(() => {
      vi.advanceTimersByTime(1_900);
    });
    expect(titles()).toEqual(['Saved']);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(titles()).toEqual([]);
  });

  it('removes its region when the provider unmounts', () => {
    const view = mount();
    show({ title: 'Saved' });
    view.unmount();
    expect(query('[role="region"]')).toBeNull();
    expect(query('.rd-toast')).toBeNull();
  });
});

describe('useToast', () => {
  it('returns a stable api object', () => {
    const seen = new Set<ToastApi>();
    function Collect() {
      seen.add(useToast());
      return null;
    }
    render(
      <ToastProvider>
        <Capture />
        <Collect />
      </ToastProvider>,
    );
    show({ title: 'One' });
    show({ title: 'Two' });
    expect(seen.size).toBe(1);
  });

  it('throws a helpful error outside a provider', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Capture />)).toThrow('useToast() must be used inside <ToastProvider>.');
    errors.mockRestore();
  });
});
