import type { HTMLAttributes } from 'react';
import { cx } from '../../utils/cx';
import styles from './Card.module.css';

export type CardProps = HTMLAttributes<HTMLDivElement>;

/** Groups related content. Pass aria-labelledby pointing at the header title when the card is a landmark. */
export function Card({ className, ...rest }: CardProps) {
  return <div className={cx(styles.card, className)} {...rest} />;
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.header, className)} {...rest} />;
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.body, className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.footer, className)} {...rest} />;
}
