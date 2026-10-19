import { forwardRef, type HTMLAttributes, type LiHTMLAttributes, type ReactNode } from 'react';
import { Check, TriangleAlert, X } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon, type LucideIcon } from '../Icon';
import { VisuallyHidden } from '../VisuallyHidden';
import styles from './Checklist.module.css';

export type ChecklistStatus = 'done' | 'failed' | 'waiting' | 'warning';

/** The words a screen reader hears before each row's detail, by status. Override per row with `statusLabel`. */
export const CHECKLIST_STATUS_LABEL: Record<ChecklistStatus, string> = {
  done: 'Done',
  failed: 'Failed',
  waiting: 'Waiting',
  warning: 'Needs attention',
};

export const CHECKLIST_STATUS_ICON: Record<ChecklistStatus, LucideIcon | null> = { done: Check, failed: X, waiting: null, warning: TriangleAlert };

export interface ChecklistProps extends HTMLAttributes<HTMLUListElement> {
  /** Accessible name of the list: what the rows add up to, "What it needs to ship". */
  label?: string;
  /** Text and actions under the rows, in the same plate: why something waits, a way to unblock it. */
  footer?: ReactNode;
  /** ChecklistRow elements. */
  children?: ReactNode;
}

/**
 * The steps or conditions something needs, one row each, with a status icon, a title, one line of detail and the
 * action on the row it acts on. Like the merge box of a pull request. Rows line up on shared columns; on narrow
 * screens the detail goes under the title and the action takes the full width.
 */
export const Checklist = forwardRef<HTMLUListElement, ChecklistProps>(function Checklist({ label, footer, className, children, ...rest }, ref) {
  return (
    <ul ref={ref} className={cx(styles.list, className)} aria-label={label} {...rest}>
      {children}
      {footer != null && footer !== false && <li className={styles.footer}>{footer}</li>}
    </ul>
  );
});

export interface ChecklistRowProps extends Omit<LiHTMLAttributes<HTMLLIElement>, 'title'> {
  /** done (check), failed (cross), waiting (empty ring), warning (triangle). The detail says it in words too. */
  status: ChecklistStatus;
  /** What the row is about: "Design approval", "Developer tests". */
  title: ReactNode;
  /** One line: who or what it waits on, or what happened. */
  detail?: ReactNode;
  /** The action for this row, on the same line: a Button at control height. */
  action?: ReactNode;
  /** Words read before the detail for this status. Default from CHECKLIST_STATUS_LABEL ("Done", "Waiting"...). */
  statusLabel?: string;
}

/** One row of a Checklist. */
export const ChecklistRow = forwardRef<HTMLLIElement, ChecklistRowProps>(function ChecklistRow(
  { status, title, detail, action, statusLabel, className, ...rest },
  ref,
) {
  const glyph = CHECKLIST_STATUS_ICON[status];
  return (
    <li ref={ref} className={cx(styles.row, className)} data-status={status} {...rest}>
      <span className={cx(styles.icon, styles[status])} aria-hidden="true">
        {glyph && <Icon icon={glyph} size="sm" />}
      </span>
      <span className={styles.title}>{title}</span>
      <span className={styles.detail}>
        <VisuallyHidden>{`${statusLabel ?? CHECKLIST_STATUS_LABEL[status]}: `}</VisuallyHidden>
        {detail}
      </span>
      {action != null && action !== false && <span className={styles.action}>{action}</span>}
    </li>
  );
});
