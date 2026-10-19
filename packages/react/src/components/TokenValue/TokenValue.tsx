import { forwardRef, type HTMLAttributes } from 'react';
import { cx } from '../../utils/cx';
import { swatchColor } from '../../utils/color';
import styles from './TokenValue.module.css';

export type TokenValueSize = 'sm' | 'md';

export interface TokenValueProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The token name, `color.action.primary.bg`. Omit it where the row already names the token. */
  name?: string;
  /** The value as written: a literal (`#0B4A8B`, `16px`) or an alias (`{color.harbor.700}`). */
  value: string;
  /** The resolved value when `value` is an alias, shown muted after it: `#0B4A8B`. */
  resolved?: string;
  /**
   * The color of the swatch. By default the swatch shows when `resolved` or `value` is a color literal (hex, rgb,
   * hsl, oklch, oklab, lab, lch, color()). Pass a color to force it, `false` to hide it.
   */
  swatch?: string | false;
  /** The value before a change: muted and struck through, read as a deletion. Pair it with the new value. */
  previous?: boolean;
  /** Default `md` (ui text). `sm` uses caption text, for dense tables. */
  size?: TokenValueSize;
}

/**
 * A token name and its value in IBM Plex Mono, with a color swatch when the value is a color. For token tables,
 * before and after values, and conflict choices. Static: no interaction.
 */
export const TokenValue = forwardRef<HTMLSpanElement, TokenValueProps>(function TokenValue(
  { name, value, resolved, swatch, previous = false, size = 'md', className, ...rest },
  ref,
) {
  const color = swatchColor(swatch, resolved, value);
  const body = (
    <>
      <span className={styles.value}>{value}</span>
      {resolved != null && resolved !== value && <span className={styles.resolved}>{resolved}</span>}
    </>
  );
  return (
    <span ref={ref} className={cx(styles.root, styles[size], previous && styles.previous, className)} {...rest}>
      {color && <span className={styles.swatch} style={{ backgroundColor: color }} aria-hidden="true" />}
      {name && <span className={styles.name}>{name}</span>}
      {previous ? <del className={styles.text}>{body}</del> : <span className={styles.text}>{body}</span>}
    </span>
  );
});
