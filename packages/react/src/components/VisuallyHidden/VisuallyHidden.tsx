import type { HTMLAttributes } from 'react';
import { cx } from '../../utils/cx';
import styles from './VisuallyHidden.module.css';

export type VisuallyHiddenProps = HTMLAttributes<HTMLSpanElement>;

/** Text for assistive technology only: read by screen readers, invisible on screen. */
export function VisuallyHidden({ className, ...rest }: VisuallyHiddenProps) {
  return <span className={cx(styles.hidden, className)} {...rest} />;
}
