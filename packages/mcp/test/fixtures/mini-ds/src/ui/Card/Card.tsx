import type { HTMLAttributes } from 'react';
import './Card.css';

export type CardTone = 'plain' | 'raised';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Surface treatment. */
  tone?: CardTone;
  /** Heading shown at the top. */
  title: string;
}

export function Card({ tone = 'plain', title, ...rest }: CardProps) {
  return <div className={`card card--${tone}`} {...rest}><h3>{title}</h3></div>;
}
