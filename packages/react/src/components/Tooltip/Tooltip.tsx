import { forwardRef, type ReactElement, type ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { cx } from '../../utils/cx';
import { useScopeAttributes } from '../../theme';
import styles from './Tooltip.module.css';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  /** The tooltip text. Short, plain, no interactive content. */
  content: ReactNode;
  /** The trigger: a focusable element that forwards its ref and spreads props (Button, IconButton, Link). */
  children: ReactElement;
  /** Preferred side. Default `top`. */
  side?: TooltipSide;
  align?: 'start' | 'center' | 'end';
  /** Hover delay in ms for this tooltip; otherwise the TooltipProvider delay applies. */
  delay?: number;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Turn the tooltip off without unwrapping the trigger. */
  disabled?: boolean;
  className?: string;
}

/**
 * A short label that appears on hover and keyboard focus, for icon buttons and truncated text.
 * Base UI Tooltip: role tooltip, linked with aria-describedby, Escape dismisses.
 */
export const Tooltip = forwardRef<HTMLDivElement, TooltipProps>(function Tooltip(
  { content, children, side = 'top', align = 'center', delay, open, defaultOpen, onOpenChange, disabled = false, className },
  ref,
) {
  const scope = useScopeAttributes();
  return (
    <BaseTooltip.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next: boolean) => onOpenChange(next) : undefined}
      disabled={disabled}
    >
      <BaseTooltip.Trigger render={children} {...(delay !== undefined ? { delay } : {})} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner className={styles.positioner} side={side} align={align} sideOffset={6} collisionPadding={8} {...scope}>
          <BaseTooltip.Popup ref={ref} className={cx(styles.tooltip, className)}>
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
});

export interface TooltipProviderProps {
  /** Hover delay before the first tooltip opens, in ms. Default 500. */
  delay?: number;
  /** Delay before closing, in ms. Default 0. */
  closeDelay?: number;
  children?: ReactNode;
}

/** Shares hover delays across tooltips: after one opens, neighbours open instantly. Put it once near the app root. */
export function TooltipProvider({ delay = 500, closeDelay = 0, children }: TooltipProviderProps) {
  return (
    <BaseTooltip.Provider delay={delay} closeDelay={closeDelay}>
      {children}
    </BaseTooltip.Provider>
  );
}
