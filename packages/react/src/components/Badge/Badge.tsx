import type { HTMLAttributes } from 'react';
import { cx } from '../../utils/cx';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
export type BadgeAppearance = 'solid' | 'subtle';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** `solid` for high-emphasis status, `subtle` for dense lists and tables. */
  appearance?: BadgeAppearance;
}

/**
 * Short status label. Color is never the only signal: the text itself must carry the meaning.
 */
export function Badge({ tone = 'neutral', appearance = 'solid', className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx(styles.badge, styles[tone], appearance === 'subtle' && styles.subtle, className)} {...rest}>
      {children}
    </span>
  );
}
