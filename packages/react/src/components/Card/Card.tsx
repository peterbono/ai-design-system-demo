import type { HTMLAttributes } from 'react';
import { cx } from '../../utils/cx';
import styles from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Lifts the card on hover. Use when the whole card is clickable. */
  interactive?: boolean;
}

/** Groups related content. Pass aria-labelledby pointing at the header title when the card is a landmark. */
export function Card({ interactive = false, className, ...rest }: CardProps) {
  return <div className={cx(styles.card, interactive && styles.interactive, className)} {...rest} />;
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
