import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactElement } from 'react';
import { useRender } from '@base-ui/react/use-render';
import { mergeProps } from '@base-ui/react/merge-props';
import { cx } from '../../utils/cx';
import { gapStyle, type SpaceToken } from '../Stack';
import styles from './Grid.module.css';

/** Keys of the size scale usable as a minimum column width (`--size-*`). */
export type GridItemWidth = '60' | '72' | '80' | '96' | '120';

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /** Fixed number of equal columns (1 to 12). Ignored when minItemWidth is set. Default 1. */
  columns?: number;
  /**
   * Responsive columns: as many as fit, each at least this size token wide (`80` = 320px).
   * Use this instead of breakpoints for card and tile grids.
   */
  minItemWidth?: GridItemWidth;
  /** Space between cells, a key of the space scale. Default: the density token `layout.gap`. */
  gap?: SpaceToken;
  /** Render another element, for example `<ul />`. */
  render?: ReactElement;
}

/** Two-dimensional layout with token gaps: fixed columns or auto-fit tiles. */
export const Grid = forwardRef<HTMLDivElement, GridProps>(function Grid(
  { columns = 1, minItemWidth, gap, render, className, style, ...rest },
  ref,
) {
  const cols: CSSProperties = minItemWidth
    ? { ['--_min' as string]: `var(--size-${minItemWidth})` }
    : { ['--_columns' as string]: String(Math.min(Math.max(Math.round(columns), 1), 12)) };
  return useRender({
    defaultTagName: 'div',
    render,
    ref,
    props: mergeProps<'div'>(
      { className: cx(styles.grid, minItemWidth ? styles.auto : styles.fixed, className), style: gapStyle(gap, { ...cols, ...style }) },
      rest,
    ),
  });
});
