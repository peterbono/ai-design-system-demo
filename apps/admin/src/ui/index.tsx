import type { ReactNode } from 'react';
import { LinkBase, useTranslate } from 'ra-core';
import { Avatar, Badge, Card, Icon, type BadgeTone, type LucideIcon } from '@bridge-ds/react';
import { ArrowDownRight, ArrowUpRight, Ban, CircleCheck, Clock, Star } from 'lucide-react';
import type { Customer, OrderStatus, ReviewStatus } from '../types';
import { cx } from '../ra-bridge';
import styles from './ui.module.css';

const ORDER_TONE: Record<OrderStatus, { tone: BadgeTone; icon: LucideIcon }> = {
  ordered: { tone: 'warning', icon: Clock },
  delivered: { tone: 'success', icon: CircleCheck },
  cancelled: { tone: 'neutral', icon: Ban },
};

/** Order status: tone plus icon plus text, so color is never the only signal. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const translate = useTranslate();
  const { tone, icon } = ORDER_TONE[status] ?? ORDER_TONE.ordered;
  return (
    <Badge tone={tone} icon={icon}>
      {translate(`orders.status.${status}`)}
    </Badge>
  );
}

const REVIEW_TONE: Record<ReviewStatus, { tone: BadgeTone; icon: LucideIcon }> = {
  pending: { tone: 'warning', icon: Clock },
  accepted: { tone: 'success', icon: CircleCheck },
  rejected: { tone: 'danger', icon: Ban },
};

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const translate = useTranslate();
  const { tone, icon } = REVIEW_TONE[status] ?? REVIEW_TONE.pending;
  return (
    <Badge tone={tone} icon={icon}>
      {translate(`reviews.status.${status}`)}
    </Badge>
  );
}

/** Read-only star rating. Bridge has no Rating component yet (DS-GAPS.md): Lucide stars in text color. */
export function Stars({ value, size = 'xs' }: { value: number; size?: 'xs' | 'sm' }) {
  const translate = useTranslate();
  return (
    <span className={styles.stars} role="img" aria-label={translate('reviews.rating_label', { smart_count: value })}>
      {Array.from({ length: 5 }, (_, i) => (
        <Icon key={i} icon={Star} size={size} className={i < value ? styles.starOn : styles.starOff} fill={i < value ? 'currentColor' : 'none'} />
      ))}
    </span>
  );
}

export function fullName(c?: Pick<Customer, 'first_name' | 'last_name'> | null): string {
  return c ? `${c.first_name} ${c.last_name}` : '';
}

/** Avatar, name and an optional second line. Links to the customer when `link` is set. */
export function CustomerCell({ customer, secondary, link = false, size = 'sm' }: { customer?: Customer | null; secondary?: ReactNode; link?: boolean; size?: 'xs' | 'sm' | 'md' }) {
  if (!customer) return <span className={styles.muted}>…</span>;
  const name = fullName(customer);
  const body = (
    <span className={styles.person}>
      <Avatar name={name} src={customer.avatar || undefined} size={size} decorative />
      <span className={styles.personText}>
        <span className={styles.personName}>{name}</span>
        {secondary && <span className={styles.personMeta}>{secondary}</span>}
      </span>
    </span>
  );
  return link ? (
    <LinkBase to={`/customers/${customer.id}`} className={styles.personLink}>
      {body}
    </LinkBase>
  ) : (
    body
  );
}

/**
 * KPI tile. Bridge has no Stat component yet (DS-GAPS.md): a Card with type tokens. The delta badge
 * carries an arrow and text, not color alone.
 */
export function StatCard({ label, value, delta, deltaLabel, hint, icon, href }: { label: string; value: ReactNode; delta?: number; deltaLabel?: string; hint?: string; icon: LucideIcon; href?: string }) {
  const up = (delta ?? 0) >= 0;
  const content = (
    <Card className={styles.stat} interactive={Boolean(href)}>
      <div className={styles.statTop}>
        <span className={styles.statLabel}>{label}</span>
        <span className={styles.statIcon}>
          <Icon icon={icon} size="sm" />
        </span>
      </div>
      <span className={styles.statValue}>{value}</span>
      {delta !== undefined && (
        <span className={styles.statDelta}>
          <Badge tone={up ? 'success' : 'danger'} size="sm" icon={up ? ArrowUpRight : ArrowDownRight}>
            {`${up ? '+' : ''}${Math.round(delta * 100)}%`}
          </Badge>
          {deltaLabel && <span className={styles.muted}>{deltaLabel}</span>}
        </span>
      )}
      {delta === undefined && hint && <span className={cx(styles.statDelta, styles.muted)}>{hint}</span>}
    </Card>
  );
  return href ? (
    <LinkBase to={href} className={styles.cardLink}>
      {content}
    </LinkBase>
  ) : (
    content
  );
}

export function Thumbnail({ src, alt = '', size = 'md' }: { src: string; alt?: string; size?: 'sm' | 'md' | 'lg' }) {
  return <img src={src} alt={alt} loading="lazy" className={cx(styles.thumb, styles[`thumb-${size}`])} />;
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className={styles.muted}>{children}</span>;
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className={styles.mono}>{children}</span>;
}

/** Label and value pairs. Bridge has no DescriptionList yet (DS-GAPS.md). */
export function Properties({ items }: { items: Array<{ label: ReactNode; value: ReactNode }> }) {
  return (
    <dl className={styles.properties}>
      {items.map((item, i) => (
        <div key={i} className={styles.property}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One row of a phone list: leading media, title and meta, then end-aligned value. */
export function MobileRow({ leading, title, meta, end, endMeta }: { leading?: ReactNode; title: ReactNode; meta?: ReactNode; end?: ReactNode; endMeta?: ReactNode }) {
  return (
    <span className={styles.mobileRow}>
      {leading}
      <span className={styles.mobileMain}>
        <span className={styles.mobileTitle}>{title}</span>
        {meta && <span className={styles.personMeta}>{meta}</span>}
      </span>
      {(end || endMeta) && (
        <span className={styles.mobileEnd}>
          {end}
          {endMeta && <span className={styles.personMeta}>{endMeta}</span>}
        </span>
      )}
    </span>
  );
}
