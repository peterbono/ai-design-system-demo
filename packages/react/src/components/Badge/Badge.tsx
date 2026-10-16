import { forwardRef, type HTMLAttributes } from 'react';
import { cx } from '../../utils/cx';
import { Icon, type LucideIcon } from '../Icon';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
export type BadgeAppearance = 'subtle' | 'solid';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Meaning of the status. The text must say it too: tone only reinforces. */
  tone?: BadgeTone;
  /** `subtle` (tinted, default) for dense lists and tables; `solid` for the one status that must win a glance. */
  appearance?: BadgeAppearance;
  size?: BadgeSize;
  /** Leading dot in the tone color. Ignored when an icon is set. */
  dot?: boolean;
  /** Leading Lucide icon, for example CircleCheck for success. */
  icon?: LucideIcon;
}

/**
 * Short, non-interactive status label. Color is never the only signal: the text itself carries the meaning.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'neutral', appearance = 'subtle', size = 'md', dot = false, icon, className, children, ...rest },
  ref,
) {
  return (
    <span ref={ref} className={cx(styles.badge, styles[appearance], styles[tone], styles[size], className)} {...rest}>
      {icon ? <Icon icon={icon} size="xs" className={styles.icon} /> : dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
});
