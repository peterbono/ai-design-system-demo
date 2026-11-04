import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { cx } from '../../utils/cx';
import { Icon, type LucideIcon } from '../Icon';
import styles from './Tabs.module.css';

export type TabsVariant = 'underline' | 'contained';
export type TabsSize = 'sm' | 'md';
export type TabsValue = string | number | null;

interface TabsContextValue {
  variant: TabsVariant;
  size: TabsSize;
}
const TabsContext = createContext<TabsContextValue>({ variant: 'underline', size: 'md' });

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'defaultValue' | 'onChange'> {
  /** `underline` for page-level sections (signal underline); `contained` for a compact segmented switch. Default `underline`. */
  variant?: TabsVariant;
  /** Tab height follows density tokens. Default `md`. */
  size?: TabsSize;
  /** Value of the tab selected on first render (uncontrolled). */
  defaultValue?: TabsValue;
  /** Value of the selected tab (controlled). */
  value?: TabsValue;
  /** Called with the new value when the user selects a tab. */
  onValueChange?: (value: TabsValue) => void;
  orientation?: 'horizontal' | 'vertical';
  children?: ReactNode;
}

/** Switches between views of the same context. Base UI Tabs: roving focus, arrow keys, ARIA wiring. */
export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  { variant = 'underline', size = 'md', orientation = 'horizontal', defaultValue, value, onValueChange, className, children, ...rest },
  ref,
) {
  return (
    <TabsContext.Provider value={{ variant, size }}>
      <BaseTabs.Root
        ref={ref}
        orientation={orientation}
        defaultValue={defaultValue}
        value={value}
        onValueChange={onValueChange ? (v: TabsValue) => onValueChange(v) : undefined}
        className={cx(styles.root, styles[orientation], className)}
        {...rest}
      >
        {children}
      </BaseTabs.Root>
    </TabsContext.Provider>
  );
});

export interface TabsListProps extends HTMLAttributes<HTMLDivElement> {
  /** Accessible name of the tab list, for example "Token views". Required unless a heading labels it. */
  'aria-label'?: string;
  /** Select a tab as soon as arrow keys move focus to it. Default false: arrows move focus, Enter or Space selects. */
  activateOnFocus?: boolean;
  /** Wrap focus from the last tab to the first. Default true. */
  loopFocus?: boolean;
}

/**
 * Marks the edges of a horizontal list that has more tabs past them (data-overflow-start, data-overflow-end), so the
 * CSS fades that edge: a phone shows that the row scrolls instead of cutting a tab with no hint. Recomputed on scroll
 * and on resize. Returns the cleanup.
 */
export function watchOverflowEdges(el: HTMLElement): () => void {
  const update = () => {
    const max = el.scrollWidth - el.clientWidth;
    const vertical = el.getAttribute('data-orientation') === 'vertical';
    el.toggleAttribute('data-overflow-start', !vertical && max > 1 && el.scrollLeft > 1);
    el.toggleAttribute('data-overflow-end', !vertical && max > 1 && el.scrollLeft < max - 1);
  };
  update();
  el.addEventListener('scroll', update, { passive: true });
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
  ro?.observe(el);
  return () => {
    el.removeEventListener('scroll', update);
    ro?.disconnect();
  };
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/** Holds the tabs and the animated indicator. */
export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(function TabsList(
  { activateOnFocus = false, loopFocus = true, className, children, ...rest },
  ref,
) {
  const { variant, size } = useContext(TabsContext);
  const own = useRef<HTMLDivElement | null>(null);
  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      own.current = el;
      setRef(ref, el);
    },
    [ref],
  );
  useEffect(() => (own.current ? watchOverflowEdges(own.current) : undefined), []);
  return (
    <BaseTabs.List
      ref={setRefs}
      activateOnFocus={activateOnFocus}
      loopFocus={loopFocus}
      className={cx(styles.list, styles[variant], styles[size], className)}
      {...rest}
    >
      {children}
      <BaseTabs.Indicator className={styles.indicator} />
    </BaseTabs.List>
  );
});

export interface TabProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'value'> {
  /** Value that links the tab to its TabsPanel. */
  value: string | number;
  /** Lucide icon before the label. */
  icon?: LucideIcon;
  /** Optional count shown after the label, like the number of open reviews. */
  count?: number;
  disabled?: boolean;
  children?: ReactNode;
}

/** One tab button. */
export const Tab = forwardRef<HTMLButtonElement, TabProps>(function Tab({ value, icon, count, disabled, className, children, ...rest }, ref) {
  return (
    <BaseTabs.Tab ref={ref} value={value} disabled={disabled} className={cx(styles.tab, className)} {...rest}>
      {icon && <Icon icon={icon} size="sm" className={styles.icon} />}
      <span className={styles.label}>{children}</span>
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </BaseTabs.Tab>
  );
});

export interface TabsPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Value of the Tab that shows this panel. */
  value: string | number;
  /** Keep the panel in the DOM while hidden (preserves form state). */
  keepMounted?: boolean;
}

/** Content shown when its tab is selected. Focusable so keyboard users can reach content without a focusable child. */
export const TabsPanel = forwardRef<HTMLDivElement, TabsPanelProps>(function TabsPanel({ value, keepMounted, className, ...rest }, ref) {
  return <BaseTabs.Panel ref={ref} value={value} keepMounted={keepMounted} className={cx(styles.panel, className)} {...rest} />;
});
