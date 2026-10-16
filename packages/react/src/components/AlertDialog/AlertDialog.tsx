import { forwardRef, useRef, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
import { cx } from '../../utils/cx';
import { useScopeAttributes } from '../../theme';
import { Button } from '../Button';
import { ButtonGroup } from '../ButtonGroup';
import dialogStyles from '../Dialog/Dialog.module.css';
import styles from './AlertDialog.module.css';

export interface AlertDialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** AlertDialogTrigger and AlertDialogContent. */
  children?: ReactNode;
}

/**
 * Interrupts the user to confirm a consequential action, usually destructive. Base UI AlertDialog:
 * role alertdialog, focus trapped, no dismissal by clicking outside.
 */
export function AlertDialog({ open, defaultOpen, onOpenChange, children }: AlertDialogProps) {
  return (
    <BaseAlertDialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next: boolean) => onOpenChange(next) : undefined}
    >
      {children}
    </BaseAlertDialog.Root>
  );
}

/** Opens the alert dialog. Compose with our Button: `<AlertDialogTrigger render={<Button variant="danger" />}>`. */
export const AlertDialogTrigger = BaseAlertDialog.Trigger;

export type AlertDialogTone = 'danger' | 'primary';

export interface AlertDialogContentProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** A question that names the action and the object: "Delete 3 tokens?" */
  title: ReactNode;
  /** The consequence, in one or two sentences. Say what cannot be undone. */
  description: ReactNode;
  /** Label of the confirming button, a verb that repeats the action: "Delete tokens". */
  confirmLabel: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /** Called when the user confirms. The dialog closes unless `closeOnConfirm` is false. */
  onConfirm?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Keep the dialog open after confirm (for async work: control `open` and pass `loading`). Default true. */
  closeOnConfirm?: boolean;
  /** Shows the confirm button as loading. */
  loading?: boolean;
  /** `danger` (default) for destructive actions, `primary` for consequential but safe ones. */
  tone?: AlertDialogTone;
  /** Optional extra content between the description and the actions, like a list of affected items. */
  children?: ReactNode;
}

/** Title, consequence and two actions. Focus starts on Cancel, the safe choice. */
export const AlertDialogContent = forwardRef<HTMLDivElement, AlertDialogContentProps>(function AlertDialogContent(
  { title, description, confirmLabel, cancelLabel = 'Cancel', onConfirm, closeOnConfirm = true, loading = false, tone = 'danger', className, children, ...rest },
  ref,
) {
  const scope = useScopeAttributes();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirm = (
    <Button variant={tone} loading={loading} onClick={onConfirm}>
      {confirmLabel}
    </Button>
  );
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop className={dialogStyles.backdrop} {...scope} />
      <BaseAlertDialog.Viewport className={dialogStyles.viewport} {...scope}>
        <BaseAlertDialog.Popup
          ref={ref}
          initialFocus={cancelRef}
          className={cx(dialogStyles.popup, dialogStyles.sm, styles.alert, className)}
          {...rest}
        >
          <div className={cx(dialogStyles.header, styles.header)}>
            <div className={dialogStyles.heading}>
              <BaseAlertDialog.Title className={dialogStyles.title}>{title}</BaseAlertDialog.Title>
              <BaseAlertDialog.Description className={dialogStyles.description}>{description}</BaseAlertDialog.Description>
            </div>
          </div>
          {children != null && <div className={dialogStyles.body}>{children}</div>}
          <div className={styles.actions}>
            <ButtonGroup align="end">
              <BaseAlertDialog.Close ref={cancelRef} render={<Button variant="secondary" />}>
                {cancelLabel}
              </BaseAlertDialog.Close>
              {closeOnConfirm && !loading ? <BaseAlertDialog.Close render={confirm} /> : confirm}
            </ButtonGroup>
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Viewport>
    </BaseAlertDialog.Portal>
  );
});
