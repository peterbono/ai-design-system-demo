import { forwardRef, type HTMLAttributes, type ReactElement } from 'react';
import { useRender } from '@base-ui/react/use-render';
import { mergeProps } from '@base-ui/react/merge-props';
import { cx } from '../../utils/cx';
import styles from './Container.module.css';

export type ContainerSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Max width: sm 640 (forms, reading), md 720, lg 960 (settings), xl 1200 (dashboards, tables), full. Default `xl`. */
  size?: ContainerSize;
  /** Horizontal padding from the space scale: none, sm (16), md (24), lg (32). Default `md`. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Render another element, for example `<main />`. */
  render?: ReactElement;
}

/** Centers page content at a token max width with token side padding. */
export const Container = forwardRef<HTMLDivElement, ContainerProps>(function Container(
  { size = 'xl', padding = 'md', render, className, ...rest },
  ref,
) {
  return useRender({
    defaultTagName: 'div',
    render,
    ref,
    props: mergeProps<'div'>({ className: cx(styles.container, styles[size], styles[`padding-${padding}`], className) }, rest),
  });
});
