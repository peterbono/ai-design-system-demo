import { forwardRef } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { cx } from '../../utils/cx';
import styles from './Icon.module.css';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg';
export type { LucideIcon };

export interface IconProps extends Omit<LucideProps, 'ref' | 'size'> {
  /** A Lucide icon component, for example `import { GitBranch } from 'lucide-react'`. */
  icon: LucideIcon;
  /** Token size: xs 12, sm 16, md 20, lg 24. Default `sm`, the size used inside controls. */
  size?: IconSize;
  /** Accessible name. Omit for decorative icons next to text (they are hidden from assistive tech). */
  label?: string;
}

/** Draws a Lucide icon at a token size with the system stroke width. Inherits the text color. */
export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { icon: Glyph, size = 'sm', label, className, ...rest },
  ref,
) {
  return (
    <Glyph
      ref={ref}
      className={cx(styles.icon, styles[size], className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    />
  );
});
