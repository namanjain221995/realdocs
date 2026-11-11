import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEagerValue } from '../src/lib/hooks';

let root: Root;
let container: HTMLElement;
let seen: string[];
let choose: (next: string) => void;

function Probe({ source }: { source: string }) {
  const [value, set] = useEagerValue(source);
  seen.push(value);
  choose = set;
  return <output>{value}</output>;
}

const shown = (): string => container.textContent ?? '';

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  seen = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useEagerValue', () => {
  it('shows a choice at once, before its source has caught up', () => {
    act(() => root.render(<Probe source="active" />));
    expect(shown()).toBe('active');
    // The person picks "recent"; the address still says "active".
    act(() => choose('recent'));
    expect(shown()).toBe('recent');
    // A second choice in the same moment is judged against the first one, not against the address.
    act(() => choose('active'));
    expect(shown()).toBe('active');
  });

  it('settles on the source when the navigation arrives', () => {
    act(() => root.render(<Probe source="active" />));
    act(() => choose('recent'));
    act(() => root.render(<Probe source="recent" />));
    expect(shown()).toBe('recent');
  });

  it('follows the source when it moves on its own (back, forward, a link)', () => {
    act(() => root.render(<Probe source="active" />));
    act(() => choose('recent'));
    act(() => root.render(<Probe source="recent" />));
    // Back in history: nobody chose anything, the address changed.
    act(() => root.render(<Probe source="archived" />));
    expect(shown()).toBe('archived');
    // It never rendered the stale choice in between.
    expect(seen.at(-1)).toBe('archived');
    expect(seen).not.toContain('trash');
  });
});
