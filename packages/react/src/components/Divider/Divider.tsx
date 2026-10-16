import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { Separator } from '@base-ui/react/separator';
import { cx } from '../../utils/cx';
import styles from './Divider.module.css';

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  /** Short text centered on a horizontal line, like "Or" or "Older changes". */
  label?: ReactNode;
  /** Space around the line: `none`, `sm` (8px) or `md` (16px). Default `md`. */
  spacing?: 'none' | 'sm' | 'md';
}

/** A hairline that separates groups of content (Base UI Separator, role separator). */
export const Divider = forwardRef<HTMLDivElement, DividerProps>(function Divider(
  { orientation = 'horizontal', label, spacing = 'md', className, ...rest },
  ref,
) {
  if (label != null && orientation === 'horizontal') {
    return (
      <div ref={ref} className={cx(styles.labelled, styles[`spacing-${spacing}`], className)} {...rest}>
        <Separator className={styles.line} />
        <span className={styles.label}>{label}</span>
        <Separator className={styles.line} />
      </div>
    );
  }
  return (
    <Separator
      ref={ref}
      orientation={orientation}
      className={cx(styles.divider, styles[orientation], styles[`spacing-${spacing}`], className)}
      {...rest}
    />
  );
});
