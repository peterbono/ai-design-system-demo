import { forwardRef, useCallback, useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import { Radio as BaseRadio } from '@base-ui/react/radio';
import { cx } from '../../utils/cx';
import { Icon, type LucideIcon } from '../Icon';
import styles from './SegmentedControl.module.css';

export type SegmentedControlSize = 'sm' | 'md';
/** `default`: the selected segment is a raised plate. `strong`: it fills with Deep Harbor, for the one control a view is about. */
export type SegmentedControlAppearance = 'default' | 'strong';

/** Extra attributes for one segment's button: `data-*` hooks a script reads, plus id and title. Behavior stays in the group. */
export interface SegmentAttributes {
  id?: string;
  title?: string;
  [key: `data-${string}`]: string | number | boolean | undefined;
}

export interface SegmentedControlItem {
  /** Value selected when this segment is chosen. */
  value: string;
  /** Visible label. Keep it to one or two words. */
  label: ReactNode;
  /** Lucide icon before the label. */
  icon?: LucideIcon;
  /** Decoration before the label that is not a Lucide icon, for example a color swatch. Hidden from assistive tech. */
  leading?: ReactNode;
  disabled?: boolean;
  /** Spread on the segment's button. */
  attributes?: SegmentAttributes;
}

export interface SegmentedControlProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'defaultValue' | 'onChange' | 'aria-label' | 'dir'> {
  /**
   * The segments, two or more. An array (not children) so the control also renders from Astro and other static
   * templates. When they do not fit (six filters on a phone), the track scrolls sideways inside its container and
   * never widens the page; the selected segment is scrolled into view.
   */
  items: SegmentedControlItem[];
  /** Accessible name of the group. Required unless you pass `aria-labelledby` pointing at a visible label. */
  label?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Default `md`. Use `sm` in toolbars and dense panels. Heights follow the density tokens. */
  size?: SegmentedControlSize;
  /** Default `default`. `strong` fills the selected segment with Deep Harbor: one per view at most. */
  appearance?: SegmentedControlAppearance;
  /** Stretch to the container; segments share the width equally. */
  fullWidth?: boolean;
  disabled?: boolean;
  /** Form field name: the selected value is submitted with the form. */
  name?: string;
}

/** Marks which edges of a scrolling track hide segments (`data-overflow`), so the CSS fades them. */
export function markSegmentOverflow(root: HTMLElement) {
  const max = root.scrollWidth - root.clientWidth;
  const start = root.scrollLeft > 1;
  const end = max - root.scrollLeft > 1;
  const value = start && end ? 'both' : start ? 'start' : end ? 'end' : null;
  if (value) root.setAttribute('data-overflow', value);
  else root.removeAttribute('data-overflow');
}

/** Scrolls the track so the selected segment is fully visible, without moving the page. */
function revealSelected(root: HTMLElement | null) {
  if (!root || root.scrollWidth <= root.clientWidth) return;
  const selected = root.querySelector<HTMLElement>('[data-segment][aria-checked="true"]');
  if (!selected) return;
  // Clear of the faded edge (the track's scroll-padding).
  const pad = parseFloat(getComputedStyle(root).scrollPaddingInlineStart) || 0;
  const start = selected.offsetLeft - pad;
  const end = selected.offsetLeft + selected.offsetWidth + pad;
  if (start < root.scrollLeft) root.scrollLeft = Math.max(0, start);
  else if (end > root.scrollLeft + root.clientWidth) root.scrollLeft = end - root.clientWidth;
}

/**
 * One choice among a few views or modes, shown as a row of attached buttons. A Base UI RadioGroup whose
 * radios render native buttons: arrow keys move the selection, Tab leaves the group.
 *
 * Static contract (no hydration): the root carries `data-segmented-control`, each segment `data-segment` and
 * `data-value`, and the selected one `aria-checked="true"`. Styles read `aria-checked`, so a script that flips it
 * (and `tabindex`) drives a statically rendered control. A scrolling track fades the edges named by `data-overflow`
 * (`start`, `end`, `both`): call `markSegmentOverflow(root)` on scroll and resize.
 */
export const SegmentedControl = forwardRef<HTMLDivElement, SegmentedControlProps>(function SegmentedControl(
  { items, label, value, defaultValue, onValueChange, size = 'md', appearance = 'default', fullWidth = false, disabled, name, className, ...rest },
  ref,
) {
  const local = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      local.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  // After a pick (or a controlled value change), keep the selected segment in view when the track scrolls.
  useEffect(() => {
    const raf = requestAnimationFrame(() => revealSelected(local.current));
    return () => cancelAnimationFrame(raf);
  }, [value]);
  // Fade the edges that hide segments, as the track scrolls or its container resizes.
  useEffect(() => {
    const root = local.current;
    if (!root) return;
    const mark = () => markSegmentOverflow(root);
    mark();
    root.addEventListener('scroll', mark, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(mark);
    observer?.observe(root);
    return () => {
      root.removeEventListener('scroll', mark);
      observer?.disconnect();
    };
  }, []);
  return (
    <BaseRadioGroup
      ref={setRef}
      aria-label={label}
      aria-orientation="horizontal"
      value={value}
      defaultValue={defaultValue}
      onValueChange={(v: unknown) => {
        onValueChange?.(v as string);
        requestAnimationFrame(() => revealSelected(local.current));
      }}
      disabled={disabled}
      name={name}
      className={cx(styles.root, styles[size], appearance === 'strong' && styles.strong, fullWidth && styles.fullWidth, className)}
      data-segmented-control=""
      {...rest}
    >
      {items.map((item) => (
        <BaseRadio.Root
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          nativeButton
          render={<button type="button" />}
          className={styles.segment}
          data-segment=""
          data-value={item.value}
          {...item.attributes}
        >
          {item.leading != null && (
            <span className={styles.leading} aria-hidden="true">
              {item.leading}
            </span>
          )}
          {item.icon && <Icon icon={item.icon} size="sm" className={styles.icon} />}
          <span className={styles.label}>{item.label}</span>
        </BaseRadio.Root>
      ))}
    </BaseRadioGroup>
  );
});
