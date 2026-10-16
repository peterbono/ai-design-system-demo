import { forwardRef, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { cx } from '../../utils/cx';
import { useScopeAttributes } from '../../theme';
import { IconButton } from '../IconButton';
import styles from './Dialog.module.css';

export type DialogSize = 'sm' | 'md' | 'lg';

export interface DialogProps {
  /** Controlled open state. */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Called when the dialog opens or closes (Escape, scrim click, close button, DialogClose). */
  onOpenChange?: (open: boolean) => void;
  /** Keep the dialog open when the user clicks the scrim. Use for forms with unsaved input. */
  disablePointerDismissal?: boolean;
  /** DialogTrigger and DialogContent. */
  children?: ReactNode;
}

/**
 * Modal dialog for a focused task that must be finished or cancelled before going back to the page.
 * Base UI Dialog: focus is trapped inside, Escape closes, focus returns to the trigger.
 */
export function Dialog({ open, defaultOpen, onOpenChange, disablePointerDismissal = false, children }: DialogProps) {
  return (
    <BaseDialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next: boolean) => onOpenChange(next) : undefined}
      disablePointerDismissal={disablePointerDismissal}
    >
      {children}
    </BaseDialog.Root>
  );
}

/** Opens the dialog. Compose with our Button: `<DialogTrigger render={<Button variant="secondary" />}>Edit</DialogTrigger>`. */
export const DialogTrigger = BaseDialog.Trigger;

/** Closes the dialog. Compose with our Button: `<DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>`. */
export const DialogClose = BaseDialog.Close;

export interface DialogContentProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Heading of the dialog. Becomes its accessible name. */
  title: ReactNode;
  /** One or two sentences under the title. Becomes the accessible description. */
  description?: ReactNode;
  /** Actions, usually a ButtonGroup with align="end": alternatives first, primary last. */
  footer?: ReactNode;
  /** Width: sm 384px, md 560px (default), lg 720px. Never wider than the viewport minus a margin. */
  size?: DialogSize;
  /** Hide the close button in the header. Keep it unless the footer has an explicit Cancel. */
  hideClose?: boolean;
  /** Accessible name of the close button. Default "Close dialog". */
  closeLabel?: string;
  /** Element to focus when the dialog opens. Default: the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** The body. It scrolls when it is taller than the viewport; header and footer stay put. */
  children?: ReactNode;
}

/** The dialog surface: scrim, popup, header (title, description, close), scrolling body and footer. */
export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent(
  { title, description, footer, size = 'md', hideClose = false, closeLabel = 'Close dialog', initialFocus, className, children, ...rest },
  ref,
) {
  const scope = useScopeAttributes();
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={styles.backdrop} {...scope} />
      <BaseDialog.Viewport className={styles.viewport} {...scope}>
        <BaseDialog.Popup
          ref={ref}
          initialFocus={initialFocus}
          className={cx(styles.popup, styles[size], className)}
          {...rest}
        >
          <div className={cx(styles.header, !hideClose && styles.withClose)}>
            <div className={styles.heading}>
              <BaseDialog.Title className={styles.title}>{title}</BaseDialog.Title>
              {description && <BaseDialog.Description className={styles.description}>{description}</BaseDialog.Description>}
            </div>
          </div>
          {children != null && <div className={styles.body}>{children}</div>}
          {footer && <div className={styles.footer}>{footer}</div>}
          {/* Last in DOM order so initial focus lands on the first field or action, not on Close. */}
          {!hideClose && (
            <BaseDialog.Close render={<IconButton icon={X} label={closeLabel} size="sm" className={styles.close} />} />
          )}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  );
});
