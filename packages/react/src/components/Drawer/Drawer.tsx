import { createContext, forwardRef, useContext, type HTMLAttributes, type ReactNode } from 'react';
import { Drawer as BaseDrawer } from '@base-ui/react/drawer';
import { X } from 'lucide-react';
import { cx } from '../../utils/cx';
import { useScopeAttributes } from '../../theme';
import { IconButton } from '../IconButton';
import styles from './Drawer.module.css';

export type DrawerSide = 'start' | 'end' | 'bottom';
export type DrawerSize = 'sm' | 'md' | 'lg';

const SWIPE = { start: 'left', end: 'right', bottom: 'down' } as const;
const SideContext = createContext<DrawerSide>('end');

export interface DrawerProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Edge the sheet slides from. `end` (default) for details and filters, `start` for navigation, `bottom` on small screens. */
  side?: DrawerSide;
  /** Keep it open when the scrim is clicked. */
  disablePointerDismissal?: boolean;
  /** DrawerTrigger and DrawerContent. */
  children?: ReactNode;
}

/**
 * A modal sheet that slides in from an edge and keeps the page visible behind it. Base UI Drawer:
 * focus trap, Escape, swipe to dismiss on touch.
 */
export function Drawer({ open, defaultOpen, onOpenChange, side = 'end', disablePointerDismissal = false, children }: DrawerProps) {
  return (
    <SideContext.Provider value={side}>
      <BaseDrawer.Root
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange ? (next: boolean) => onOpenChange(next) : undefined}
        swipeDirection={SWIPE[side]}
        disablePointerDismissal={disablePointerDismissal}
      >
        {children}
      </BaseDrawer.Root>
    </SideContext.Provider>
  );
}

/** Opens the drawer. Compose with our Button through render. */
export const DrawerTrigger = BaseDrawer.Trigger;
/** Closes the drawer. Compose with our Button through render. */
export const DrawerClose = BaseDrawer.Close;

export interface DrawerContentProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Heading, also the accessible name. */
  title: ReactNode;
  description?: ReactNode;
  /** Sticky footer actions, usually a ButtonGroup. */
  footer?: ReactNode;
  /** Width for side sheets (sm 320, md 480, lg 640) or max height for bottom sheets. Default `md`. */
  size?: DrawerSize;
  hideClose?: boolean;
  /** Default "Close panel". */
  closeLabel?: string;
  children?: ReactNode;
}

/** The sheet: scrim, panel, header with close, scrolling body, footer. */
export const DrawerContent = forwardRef<HTMLDivElement, DrawerContentProps>(function DrawerContent(
  { title, description, footer, size = 'md', hideClose = false, closeLabel = 'Close panel', className, children, ...rest },
  ref,
) {
  const side = useContext(SideContext);
  const scope = useScopeAttributes();
  return (
    <BaseDrawer.Portal>
      <BaseDrawer.Backdrop className={styles.backdrop} {...scope} />
      <BaseDrawer.Viewport className={cx(styles.viewport, styles[`viewport-${side}`])} {...scope}>
        <BaseDrawer.Popup ref={ref} className={cx(styles.popup, styles[side], styles[size], className)} {...rest}>
          {side === 'bottom' && <div className={styles.handle} aria-hidden="true" />}
          <div className={styles.header}>
            <div className={styles.heading}>
              <BaseDrawer.Title className={styles.title}>{title}</BaseDrawer.Title>
              {description && <BaseDrawer.Description className={styles.description}>{description}</BaseDrawer.Description>}
            </div>
            {!hideClose && <BaseDrawer.Close render={<IconButton icon={X} label={closeLabel} size="sm" className={styles.close} />} />}
          </div>
          <div className={styles.body}>{children}</div>
          {footer && <div className={styles.footer}>{footer}</div>}
        </BaseDrawer.Popup>
      </BaseDrawer.Viewport>
    </BaseDrawer.Portal>
  );
});
