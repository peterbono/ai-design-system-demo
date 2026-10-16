import { forwardRef, type HTMLAttributes, type ReactElement } from 'react';
import { useRender } from '@base-ui/react/use-render';
import { mergeProps } from '@base-ui/react/merge-props';
import { cx } from '../../utils/cx';
import { gapStyle, type FlexAlign, type FlexJustify, type SpaceToken } from '../Stack';
import styles from './Inline.module.css';

export interface InlineProps extends HTMLAttributes<HTMLDivElement> {
  /** Space between children, a key of the space scale. Default `2` (8px). */
  gap?: SpaceToken;
  /** Cross-axis alignment. Default `center`. */
  align?: FlexAlign;
  /** Main-axis distribution. Default `start`. */
  justify?: FlexJustify;
  /** Wrap onto new lines when space runs out. Default true. */
  wrap?: boolean;
  /** Render another element, for example `<ul />`. */
  render?: ReactElement;
}

/** Children in a row (badges, buttons, meta), wrapping when space runs out. */
export const Inline = forwardRef<HTMLDivElement, InlineProps>(function Inline(
  { gap = '2', align = 'center', justify = 'start', wrap = true, render, className, style, ...rest },
  ref,
) {
  return useRender({
    defaultTagName: 'div',
    render,
    ref,
    props: mergeProps<'div'>(
      {
        className: cx(styles.inline, styles[`align-${align}`], styles[`justify-${justify}`], !wrap && styles.nowrap, className),
        style: gapStyle(gap, style),
      },
      rest,
    ),
  });
});
