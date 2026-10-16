import { forwardRef, type HTMLAttributes } from 'react';
import { cx } from '../../utils/cx';
import styles from './Spinner.module.css';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';
export type SpinnerTone = 'current' | 'signal';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  /** Token size: xs 12, sm 16, md 20, lg 24. Default `sm`. */
  size?: SpinnerSize;
  /** `current` inherits the text color (inside buttons); `signal` uses the signal color. Default `current`. */
  tone?: SpinnerTone;
  /**
   * Accessible label announced as a status, for example "Loading tokens". Omit when the spinner sits
   * inside a control that already exposes aria-busy: it is then hidden from assistive tech.
   */
  label?: string;
}

/** Indeterminate activity for short waits (under about 2 seconds) or inside a control. Use Skeleton for content. */
export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { size = 'sm', tone = 'current', label, className, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cx(styles.spinner, styles[size], styles[tone], className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      <svg className={styles.svg} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <circle className={styles.track} cx="12" cy="12" r="9.5" />
        <circle className={styles.arc} cx="12" cy="12" r="9.5" pathLength="100" />
      </svg>
    </span>
  );
});
