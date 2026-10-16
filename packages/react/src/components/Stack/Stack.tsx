import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactElement } from 'react';
import { useRender } from '@base-ui/react/use-render';
import { mergeProps } from '@base-ui/react/merge-props';
import { cx } from '../../utils/cx';
import styles from './Stack.module.css';

/** Keys of the space scale (`--space-*`). */
export type SpaceToken = '0' | '0-5' | '1' | '1-5' | '2' | '3' | '4' | '5' | '6' | '8' | '10' | '12' | '16';
export type FlexAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type FlexJustify = 'start' | 'center' | 'end' | 'between';

/** Inline style that points a layout's gap at a space token. Never a raw number. */
export function gapStyle(gap: SpaceToken | undefined, style?: CSSProperties): CSSProperties | undefined {
  if (gap === undefined) return style;
  return { ...style, ['--_gap' as string]: `var(--space-${gap})` };
}

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /** Space between children, a key of the space scale. Default: the density token `layout.gap` (16 or 12px). */
  gap?: SpaceToken;
  /** Cross-axis alignment. Default `stretch`. */
  align?: FlexAlign;
  /** Main-axis distribution. Default `start`. */
  justify?: FlexJustify;
  /** Render another element, for example `<section />` or `<ul />`. */
  render?: ReactElement;
}

/** Vertical rhythm: children in a column, separated by a token gap. */
export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap, align = 'stretch', justify = 'start', render, className, style, ...rest },
  ref,
) {
  return useRender({
    defaultTagName: 'div',
    render,
    ref,
    props: mergeProps<'div'>(
      { className: cx(styles.stack, styles[`align-${align}`], styles[`justify-${justify}`], className), style: gapStyle(gap, style) },
      rest,
    ),
  });
});
