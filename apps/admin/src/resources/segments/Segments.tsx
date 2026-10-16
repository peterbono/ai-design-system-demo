import { LinkBase, useGetList, useTranslate } from 'ra-core';
import { Card, Progress, Skeleton } from '@bridge-ds/react';
import { Award, Gem, MessageSquareText, Repeat, RotateCcw, ShoppingCart, type LucideIcon } from 'lucide-react';
import { Icon } from '@bridge-ds/react';
import { Page } from '../../ra-bridge';
import { Muted } from '../../ui';
import { useFormat } from '../../format';
import type { Customer } from '../../types';
import { SEGMENT_IDS, customersFilterLink, type SegmentId } from '../shared/segments';
import styles from './segments.module.css';

const ICONS: Record<SegmentId, LucideIcon> = {
  compulsive: ShoppingCart,
  collector: Gem,
  ordered_once: Award,
  regular: Repeat,
  returns: RotateCcw,
  reviewer: MessageSquareText,
};

/** Customer segments with live counts; each card opens the customer list filtered on it. */
export function Segments() {
  const translate = useTranslate();
  const fmt = useFormat();
  const { data, isPending } = useGetList<Customer>('customers', { filter: { has_ordered: true }, pagination: { page: 1, perPage: 2000 }, sort: { field: 'id', order: 'ASC' } });
  const all = data ?? [];
  const stat = (id: SegmentId) => {
    const members = all.filter((c) => c.groups?.includes(id));
    return { count: members.length, revenue: members.reduce((n, c) => n + c.total_spent, 0) };
  };
  return (
    <Page title={translate('segments.title')} subtitle={translate('segments.subtitle', { smart_count: all.length })}>
      <ul className={styles.grid}>
        {SEGMENT_IDS.map((id) => {
          const s = stat(id);
          const share = all.length ? s.count / all.length : 0;
          return (
            <li key={id}>
              <LinkBase to={customersFilterLink({ groups: id })} className={styles.link}>
                <Card interactive className={styles.card}>
                  <span className={styles.head}>
                    <span className={styles.icon}>
                      <Icon icon={ICONS[id]} size="sm" />
                    </span>
                    <span className={styles.name}>{translate(`segments.names.${id}`)}</span>
                  </span>
                  <p className={styles.description}>{translate(`segments.descriptions.${id}`)}</p>
                  {isPending ? (
                    <Skeleton lines={2} />
                  ) : (
                    <>
                      <span className={styles.numbers}>
                        <span className={styles.count}>{fmt.number(s.count)}</span>
                        <Muted>{translate('segments.revenue', { value: fmt.money0(s.revenue) })}</Muted>
                      </span>
                      <Progress value={Math.round(share * 100)} label={translate('segments.share')} showValue size="sm" />
                    </>
                  )}
                </Card>
              </LinkBase>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
