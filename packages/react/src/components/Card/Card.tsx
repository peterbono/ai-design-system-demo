import { forwardRef, type HTMLAttributes } from 'react';
import { cx } from '../../utils/cx';
import styles from './Card.module.css';

export type CardPadding = 'none' | 'compact' | 'default';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The whole card is one link or action: it lifts on hover, and the element marked `data-card-primary`
   * (a link or button whose text names the destination, usually the title) covers the card and moves its
   * focus ring to the card. Other buttons inside stay clickable on top.
   */
  interactive?: boolean;
  /** Inner spacing of header, body and footer. `none` for full-bleed tables and media. Default `default`. */
  padding?: CardPadding;
}

/** A flat plate that groups related content. Pass aria-labelledby pointing at the header title when it is a landmark. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive = false, padding = 'default', className, ...rest },
  ref,
) {
  return <div ref={ref} className={cx(styles.card, styles[`padding-${padding}`], interactive && styles.interactive, className)} {...rest} />;
});

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardHeader({ className, ...rest }, ref) {
  return <div ref={ref} className={cx(styles.header, className)} {...rest} />;
});

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardBody({ className, ...rest }, ref) {
  return <div ref={ref} className={cx(styles.body, className)} {...rest} />;
});

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardFooter({ className, ...rest }, ref) {
  return <div ref={ref} className={cx(styles.footer, className)} {...rest} />;
});
