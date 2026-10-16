import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { Progress as BaseProgress } from '@base-ui/react/progress';
import { cx } from '../../utils/cx';
import styles from './Progress.module.css';

export type ProgressVariant = 'linear' | 'circular';
export type ProgressSize = 'sm' | 'md' | 'lg';
export type ProgressTone = 'signal' | 'success' | 'warning' | 'danger';

export interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Current value. `null` means indeterminate (the duration is unknown). */
  value: number | null;
  min?: number;
  max?: number;
  /** Visible label, for example "Publishing tokens". Without it, pass aria-label. */
  label?: ReactNode;
  /** Show the formatted value ("64%") next to the label, or inside a large ring. Default true for linear with a label. */
  showValue?: boolean;
  /** `linear` bar for tasks in a layout; `circular` ring for compact spots. Default `linear`. */
  variant?: ProgressVariant;
  /** Bar thickness or ring diameter. Default `md`. */
  size?: ProgressSize;
  /** Signal color while working; switch to success or danger when the task ends. Default `signal`. */
  tone?: ProgressTone;
  /** Intl number format for the value text. Default: percent of the range. */
  format?: Intl.NumberFormatOptions;
  /** Human-readable value for screen readers, for example "12 of 40 tokens". */
  getAriaValueText?: (formattedValue: string, value: number | null) => string;
}

/** Shows how far a task has gone (Base UI Progress). For waits under about two seconds, use Spinner. */
export const Progress = forwardRef<HTMLDivElement, ProgressProps>(function Progress(
  { value, min = 0, max = 100, label, showValue, variant = 'linear', size = 'md', tone = 'signal', format, getAriaValueText, className, style, ...rest },
  ref,
) {
  const indeterminate = value === null;
  const pct = indeterminate ? 0 : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const withValue = showValue ?? (variant === 'linear' ? label != null : size === 'lg');

  return (
    <BaseProgress.Root
      ref={ref}
      value={value}
      min={min}
      max={max}
      format={format}
      getAriaValueText={getAriaValueText}
      className={cx(styles.progress, styles[variant], styles[size], styles[tone], className)}
      style={{ ...style, '--_pct': pct } as CSSProperties}
      {...rest}
    >
      {variant === 'linear' ? (
        <>
          {(label != null || withValue) && (
            <div className={styles.header}>
              {label != null && <BaseProgress.Label className={styles.label}>{label}</BaseProgress.Label>}
              {withValue && !indeterminate && <BaseProgress.Value className={styles.value} />}
            </div>
          )}
          <BaseProgress.Track className={styles.track}>
            <BaseProgress.Indicator className={styles.indicator} />
          </BaseProgress.Track>
        </>
      ) : (
        <>
          <span className={styles.ring}>
            <svg className={styles.svg} viewBox="0 0 36 36" fill="none" aria-hidden="true" focusable="false">
              <circle className={styles.ringTrack} cx="18" cy="18" r="15" pathLength="100" />
              <circle className={styles.ringFill} cx="18" cy="18" r="15" pathLength="100" />
            </svg>
            {withValue && !indeterminate && <BaseProgress.Value className={styles.ringValue} />}
          </span>
          {label != null && <BaseProgress.Label className={styles.label}>{label}</BaseProgress.Label>}
        </>
      )}
    </BaseProgress.Root>
  );
});
