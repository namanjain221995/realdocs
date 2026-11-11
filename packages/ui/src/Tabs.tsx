import {
  type ComponentProps,
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useId,
  useMemo,
  useRef,
} from 'react';
import { focusElement } from './internal/focus';
import { useScrollFade } from './internal/scroll-fade';
import { cx } from './utils';

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  /** A short count or marker after the label. */
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string = string> extends Omit<
  ComponentProps<'div'>,
  'onChange'
> {
  tabs: ReadonlyArray<TabItem<T>>;
  /** Id of the selected tab. */
  value: T;
  onValueChange: (value: T) => void;
  /** Names the tab list for assistive technology. */
  ariaLabel?: string;
  /**
   * `auto` selects a tab as soon as the arrow keys reach it. Use `manual`
   * (Enter or Space selects) when showing a panel is slow.
   */
  activation?: 'auto' | 'manual';
  /** `TabPanel` elements. Rendered below the tab list and wired to their tabs. */
  children?: ReactNode;
}

interface TabsContextValue {
  baseId: string;
  value: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function tabDomId(baseId: string, tabId: string): string {
  return `${baseId}-tab-${tabId}`;
}

function panelDomId(baseId: string, tabId: string): string {
  return `${baseId}-panel-${tabId}`;
}

/**
 * A row of tabs. Left/Right move between tabs, Home/End jump to the ends, and
 * the row scrolls sideways when it does not fit.
 */
export function Tabs<T extends string = string>({
  tabs,
  value,
  onValueChange,
  ariaLabel,
  activation = 'auto',
  id: idProp,
  className,
  children,
  'aria-label': ariaLabelAttribute,
  'aria-labelledby': ariaLabelledBy,
  ...rest
}: TabsProps<T>) {
  const generatedId = useId();
  const baseId = idProp ?? `rd-tabs-${generatedId}`;
  const context = useMemo<TabsContextValue>(() => ({ baseId, value }), [baseId, value]);
  const listRef = useRef<HTMLDivElement>(null);
  const { fade } = useScrollFade(listRef);
  const hasPanels = children !== undefined && children !== null && children !== false;
  const hasSelection = tabs.some((tab) => tab.id === value && !tab.disabled);
  const firstEnabled = tabs.find((tab) => !tab.disabled)?.id;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'tab') return;
    const enabled = tabs.filter((tab) => !tab.disabled);
    const current = enabled.findIndex((tab) => tab.id === target.dataset.tab);
    if (current === -1) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    let next: number;
    if (event.key === forward) next = (current + 1) % enabled.length;
    else if (event.key === backward) next = (current - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    else return;
    event.preventDefault();
    const tab = enabled[next];
    if (!tab) return;
    for (const button of event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')) {
      if (button.dataset.tab === tab.id) {
        focusElement(button);
        button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
    }
    if (activation === 'auto' && tab.id !== value) onValueChange(tab.id);
  };

  return (
    <div {...rest} id={idProp} className={cx('rd-tabs', className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel ?? ariaLabelAttribute}
        aria-labelledby={ariaLabelledBy}
        className="rd-tabs__list"
        data-fade-start={fade.start ? '' : undefined}
        data-fade-end={fade.end ? '' : undefined}
        onKeyDown={handleKeyDown}
      >
        {tabs.map((tab) => {
          const selected = tab.id === value;
          const tabStop = selected || (!hasSelection && tab.id === firstEnabled);
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={tabDomId(baseId, tab.id)}
              aria-selected={selected}
              aria-controls={selected && hasPanels ? panelDomId(baseId, tab.id) : undefined}
              disabled={tab.disabled}
              tabIndex={tabStop ? 0 : -1}
              data-tab={tab.id}
              className="rd-tabs__tab"
              onClick={() => {
                if (!selected) onValueChange(tab.id);
              }}
            >
              {tab.icon ? (
                <span className="rd-tabs__icon" aria-hidden="true">
                  {tab.icon}
                </span>
              ) : null}
              <span className="rd-tabs__label">{tab.label}</span>
              {tab.badge !== undefined && tab.badge !== null && tab.badge !== false ? (
                <span className="rd-tabs__badge">{tab.badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {hasPanels ? <TabsContext value={context}>{children}</TabsContext> : null}
    </div>
  );
}

export interface TabPanelProps extends Omit<ComponentProps<'div'>, 'id'> {
  /** Id of the tab this panel belongs to (the `id` in `tabs`). */
  id: string;
  /**
   * Whether this panel is the selected one. Inside `<Tabs>` this is derived
   * from the selected tab; outside it defaults to true.
   */
  active?: boolean;
  /** `id` of a `<Tabs id="…">` rendered elsewhere, to link panel and tab. */
  tabsId?: string;
  /** Keep the panel in the DOM (hidden) while another tab is selected. */
  keepMounted?: boolean;
}

/**
 * The content of one tab. Render panels as children of `Tabs` to have
 * selection and labelling handled for you.
 */
export function TabPanel({
  id,
  active,
  tabsId,
  keepMounted = false,
  className,
  children,
  ...rest
}: TabPanelProps) {
  const context = useContext(TabsContext);
  const baseId = context?.baseId ?? tabsId;
  const isActive = active ?? (context ? context.value === id : true);
  if (!isActive && !keepMounted) return null;
  return (
    <div
      // Focusable so keyboard users can reach a panel without controls in it.
      tabIndex={0}
      {...rest}
      role="tabpanel"
      id={baseId ? panelDomId(baseId, id) : undefined}
      aria-labelledby={baseId ? tabDomId(baseId, id) : undefined}
      hidden={!isActive}
      className={cx('rd-tabs__panel', className)}
    >
      {children}
    </div>
  );
}
