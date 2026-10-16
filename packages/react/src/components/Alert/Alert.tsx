import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Icon, type LucideIcon } from '../Icon';
import { IconButton } from '../IconButton';
import styles from './Alert.module.css';

export type AlertTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_ICON: Record<AlertTone, LucideIcon> = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Meaning of the message. The icon and the text carry it too, never the color alone. Default `info`. */
  tone?: AlertTone;
  /** Short summary in bold. Optional when the description is one short sentence. */
  title?: ReactNode;
  /** Replace the tone icon, or pass `false` to hide it. */
  icon?: LucideIcon | false;
  /** Buttons or links under the text, for example "Review changes". Keep to two. */
  actions?: ReactNode;
  /** Shows a dismiss button and calls this when it is pressed. */
  onDismiss?: () => void;
  /** Accessible name of the dismiss button. Default "Dismiss". */
  dismissLabel?: string;
  /**
   * How assistive tech hears the alert when it appears after page load. `auto` uses role="alert"
   * (interrupts) for danger and warning and role="status" (polite) for the others; `off` renders
   * static content with no live region, right for alerts present when the page loads. Default `auto`.
   */
  announce?: 'auto' | 'off';
}

/** Inline message about the state of the page or a section: a failed sync, a pending review, a success. */
export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { tone = 'info', title, icon, actions, onDismiss, dismissLabel = 'Dismiss', announce = 'auto', className, children, ...rest },
  ref,
) {
  const glyph = icon === false ? null : (icon ?? TONE_ICON[tone]);
  const role = announce === 'off' ? undefined : tone === 'danger' || tone === 'warning' ? 'alert' : 'status';
  return (
    <div ref={ref} role={role} className={cx(styles.alert, styles[tone], className)} {...rest}>
      {glyph && <Icon icon={glyph} size="md" className={styles.icon} />}
      <div className={styles.content}>
        {title && <p className={styles.title}>{title}</p>}
        {children && <div className={styles.description}>{children}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {onDismiss && (
        <IconButton icon={X} label={dismissLabel} size="sm" variant="ghost" className={styles.dismiss} onClick={onDismiss} />
      )}
    </div>
  );
});
