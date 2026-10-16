import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';
import { cx } from '../../utils/cx';
import styles from './Skeleton.module.css';

export type SkeletonVariant = 'text' | 'circle' | 'rect';

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  /** `text` draws lines at the current font size; `circle` an avatar; `rect` a block (thumbnail, chart, card). Default `text`. */
  variant?: SkeletonVariant;
  /** Number of text lines. The last one is shorter, like a real paragraph. Default 1. */
  lines?: number;
  /** CSS width, for example `"12ch"` or `"100%"`. Defaults: text 100%, circle 40px, rect 100%. */
  width?: string;
  /** CSS height for `rect` and `circle`. */
  height?: string;
  /** Stop the shimmer (for example in long lists). Reduced motion stops it everywhere. */
  static?: boolean;
}

/**
 * Placeholder in the shape of content that is loading. Always hidden from assistive tech: wrap the loading
 * region in an element with aria-busy="true" and a visually hidden label ("Loading tokens").
 */
export const Skeleton = forwardRef<HTMLSpanElement, SkeletonProps>(function Skeleton(
  { variant = 'text', lines = 1, width, height, static: isStatic = false, className, style, ...rest },
  ref,
) {
  const size: CSSProperties = { ...(width ? { width } : {}), ...(height ? { height } : {}), ...style };
  const classes = cx(styles.skeleton, styles[variant], isStatic && styles.static, className);
  if (variant === 'text' && lines > 1) {
    return (
      <span ref={ref} aria-hidden="true" className={cx(styles.lines, className)} style={size} {...rest}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className={cx(styles.skeleton, styles.text, isStatic && styles.static, i === lines - 1 && styles.last)} />
        ))}
      </span>
    );
  }
  return <span ref={ref} aria-hidden="true" className={classes} style={size} {...rest} />;
});
