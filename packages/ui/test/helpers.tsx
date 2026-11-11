import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

interface Mounted {
  root: Root;
  container: HTMLElement;
}

const mounted: Mounted[] = [];

export interface RenderResult {
  container: HTMLElement;
  rerender: (ui: ReactNode) => void;
  unmount: () => void;
}

/** Renders into a fresh container attached to the document. */
export function render(ui: ReactNode): RenderResult {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const entry: Mounted = { root, container };
  mounted.push(entry);
  act(() => root.render(ui));
  return {
    container,
    rerender: (next) => act(() => root.render(next)),
    unmount: () => {
      const index = mounted.indexOf(entry);
      if (index === -1) return;
      mounted.splice(index, 1);
      act(() => root.unmount());
      container.remove();
    },
  };
}

export function cleanup(): void {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
}

/** Lets promise callbacks (floating-ui positioning, async handlers) settle. */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

export function byTestId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.querySelector<T>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`No element with data-testid="${id}"`);
  return element;
}

export function query<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

export function get<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`No element matches ${selector}`);
  return element;
}

export function getAll<T extends HTMLElement = HTMLElement>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector));
}

/** A mouse click, including the pointerdown that precedes it. */
export function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
}

/** A click made with Enter or Space: no pointer events and `detail` 0. */
export function keyboardClick(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
  });
}

export function pointerDown(element: Element): void {
  act(() => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  });
}

/** Presses a key on the focused element. Returns false when it was prevented. */
export function press(key: string, init: KeyboardEventInit = {}): boolean {
  const target = document.activeElement ?? document.body;
  let allowed = true;
  act(() => {
    allowed = target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
  });
  return allowed;
}

export function focus(element: HTMLElement): void {
  act(() => element.focus());
}

/** Types into a React-controlled input the way the browser would. */
export function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  act(() => {
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
