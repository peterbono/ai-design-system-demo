import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { X } from 'lucide-react';
import { cx } from '../../utils/cx';
import { useScopeAttributes } from '../../theme';
import { IconButton } from '../IconButton';
import styles from './Popover.module.css';

export type PopoverSide = 'top' | 'bottom' | 'left' | 'right' | 'inline-start' | 'inline-end';
export type PopoverAlign = 'start' | 'center' | 'end';

export interface PopoverProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Trap focus and block the page while open. Default false: popovers are light, non-modal surfaces. */
  modal?: boolean;
  /** PopoverTrigger and PopoverContent. */
  children?: ReactNode;
}

/** Non-modal floating panel anchored to a trigger: details, small forms, previews. Base UI Popover. */
export function Popover({ open, defaultOpen, onOpenChange, modal = false, children }: PopoverProps) {
  return (
    <BasePopover.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next: boolean) => onOpenChange(next) : undefined}
      modal={modal}
    >
      {children}
    </BasePopover.Root>
  );
}

/** Opens the popover. Compose with our Button through render. */
export const PopoverTrigger = BasePopover.Trigger;
/** Closes the popover. Compose with our Button through render. */
export const PopoverClose = BasePopover.Close;

export interface PopoverContentProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional heading. When set it names the popup for assistive tech. */
  title?: ReactNode;
  description?: ReactNode;
  /** Preferred side; flips when there is no room. Default `bottom`. */
  side?: PopoverSide;
  /** Alignment against the trigger. Default `center`. */
  align?: PopoverAlign;
  /** Show the arrow pointing at the trigger. Default true. */
  arrow?: boolean;
  /** Show a close button in the corner. Default false (Escape and outside click close it). */
  showClose?: boolean;
  /** Default "Close". */
  closeLabel?: string;
  children?: ReactNode;
}

/** The floating surface: positioner, popup, arrow, optional title, description and close. */
export const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(function PopoverContent(
  { title, description, side = 'bottom', align = 'center', arrow = true, showClose = false, closeLabel = 'Close', className, children, ...rest },
  ref,
) {
  const scope = useScopeAttributes();
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner className={styles.positioner} side={side} align={align} sideOffset={8} collisionPadding={8} {...scope}>
        <BasePopover.Popup ref={ref} className={cx(styles.popup, className)} {...rest}>
          {arrow && <BasePopover.Arrow className={styles.arrow} />}
          {(title || showClose) && (
            <div className={styles.header}>
              {title && <BasePopover.Title className={styles.title}>{title}</BasePopover.Title>}
              {showClose && <BasePopover.Close render={<IconButton icon={X} label={closeLabel} size="sm" className={styles.close} />} />}
            </div>
          )}
          {description && <BasePopover.Description className={styles.description}>{description}</BasePopover.Description>}
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
});
