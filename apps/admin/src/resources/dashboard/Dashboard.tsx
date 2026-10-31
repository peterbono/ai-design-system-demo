import { lazy, Suspense, useMemo } from 'react';
import { LinkBase, useGetList, useGetMany, useTranslate } from 'ra-core';
import { Badge, Card, CardBody, CardHeader, EmptyState, Link, Skeleton } from '@bridge-ds/react';
import { DollarSign, MessageSquareText, ShoppingBag, UserPlus } from 'lucide-react';
import { startOfDay, subDays } from 'date-fns';
import { Page } from '../../ra-bridge';
import { CustomerCell, StatCard, Stars, Muted, fullName } from '../../ui';
import { useFormat } from '../../format';
import { usePreferences } from '../../preferences';
import type { Customer, Order, Review } from '../../types';
import styles from './Dashboard.module.css';

const RevenueChart = lazy(() => import('./RevenueChart'));

/** An order still waiting to ship after this many days is flagged as late. */
const LATE_AFTER_DAYS = 3;

export function Dashboard() {
  const translate = useTranslate();
  const fmt = useFormat();
  const { tenant } = usePreferences();
  const { since30, since60, lateBefore } = useMemo(() => {
    const today = startOfDay(new Date());
    return { since30: subDays(today, 30), since60: subDays(today, 60), lateBefore: subDays(today, LATE_AFTER_DAYS) };
  }, []);

  const { data: orders, isPending } = useGetList<Order>('orders', {
    filter: { date_gte: since60.toISOString() },
    sort: { field: 'date', order: 'DESC' },
    pagination: { page: 1, perPage: 1000 },
  });
  const { data: newCustomers, total: newCustomerCount, isPending: customersPending } = useGetList<Customer>('customers', {
    filter: { has_ordered: true, first_seen_gte: since30.toISOString() },
    sort: { field: 'first_seen', order: 'DESC' },
    pagination: { page: 1, perPage: 6 },
  });
  const { data: reviews, total: pendingReviewCount, isPending: reviewsPending } = useGetList<Review>('reviews', {
    filter: { status: 'pending' },
    sort: { field: 'date', order: 'DESC' },
    pagination: { page: 1, perPage: 4 },
  });

  const stats = useMemo(() => {
    const current = (orders ?? []).filter((o) => new Date(o.date) >= since30);
    const previous = (orders ?? []).filter((o) => new Date(o.date) < since30);
    const paid = (list: Order[]) => list.filter((o) => o.status !== 'cancelled');
    const sum = (list: Order[]) => paid(list).reduce((acc, o) => acc + o.total, 0);
    const revenue = sum(current);
    const prevRevenue = sum(previous);
    const count = paid(current).length;
    const prevCount = paid(previous).length;
    const pending = current.filter((o) => o.status === 'ordered');
    return {
      current,
      revenue,
      revenueDelta: prevRevenue ? revenue / prevRevenue - 1 : undefined,
      count,
      countDelta: prevCount ? count / prevCount - 1 : undefined,
      pending,
      averageBasket: count ? revenue / count : 0,
    };
  }, [orders, since30]);

  const pendingShown = stats.pending.slice(0, 6);
  const customerIds = useMemo(
    () => Array.from(new Set([...pendingShown.map((o) => o.customer_id), ...(reviews ?? []).map((r) => r.customer_id)])),
    [pendingShown, reviews],
  );
  const { data: people } = useGetMany<Customer>('customers', { ids: customerIds }, { enabled: customerIds.length > 0 });
  const personById = useMemo(() => new Map((people ?? []).map((c) => [c.id, c])), [people]);

  const vsLabel = translate('dashboard.vs_previous');

  return (
    <Page title={translate('dashboard.title')} subtitle={translate('dashboard.subtitle', { shop: tenant.name })}>
      <div className={styles.kpis}>
        {isPending ? (
          Array.from({ length: 4 }, (_, i) => (
            <Card key={i} className={styles.kpiSkeleton}>
              <Skeleton width="var(--size-20)" />
              <Skeleton width="var(--size-20)" height="var(--size-8)" />
            </Card>
          ))
        ) : (
          <>
            <StatCard icon={DollarSign} label={translate('dashboard.revenue')} value={fmt.money0(stats.revenue)} delta={stats.revenueDelta} deltaLabel={vsLabel} />
            <StatCard icon={ShoppingBag} label={translate('dashboard.orders')} value={fmt.number(stats.count)} delta={stats.countDelta} deltaLabel={vsLabel} href="/orders" />
            <StatCard icon={UserPlus} label={translate('dashboard.new_customers')} value={fmt.number(newCustomerCount ?? 0)} hint={translate('dashboard.new_customers_hint')} href="/customers" />
            <StatCard icon={MessageSquareText} label={translate('dashboard.pending_reviews')} value={fmt.number(pendingReviewCount ?? 0)} hint={translate('dashboard.pending_reviews_hint')} href="/reviews" />
          </>
        )}
      </div>

      <div className={styles.grid}>
        <div className={styles.mainCol}>
          <Card>
            <CardHeader>
              <span className={styles.cardTitle}>
                {translate('dashboard.revenue_history')}
                <Muted>{translate('dashboard.average_basket', { value: fmt.money(stats.averageBasket) })}</Muted>
              </span>
            </CardHeader>
            <CardBody>
              <div className={styles.chart}>
                {isPending ? (
                  <Skeleton variant="rect" height="100%" />
                ) : (
                  <Suspense fallback={<Skeleton variant="rect" height="100%" />}>
                    <RevenueChart orders={stats.current} since={since30} />
                  </Suspense>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <span className={styles.cardTitle}>
                {translate('dashboard.pending_orders')}
                <Muted>{translate('dashboard.pending_orders_hint', { smart_count: stats.pending.length })}</Muted>
              </span>
              <Link variant="standalone" className={styles.headerLink} render={<LinkBase to="/orders" />}>
                {translate('dashboard.see_all')}
              </Link>
            </CardHeader>
            <CardBody>
              {isPending ? (
                <Skeleton lines={4} />
              ) : pendingShown.length === 0 ? (
                <EmptyState size="sm" icon={ShoppingBag} title={translate('dashboard.no_pending')} description={translate('dashboard.no_pending_hint')} />
              ) : (
                <ul className={styles.list}>
                  {pendingShown.map((order) => {
                    const customer = personById.get(order.customer_id);
                    const items = order.basket.reduce((n, b) => n + b.quantity, 0);
                    const isLate = new Date(order.date) < lateBefore;
                    return (
                      <li key={order.id}>
                        <LinkBase to={`/orders/${order.id}`} className={styles.row}>
                          <CustomerCell customer={customer} secondary={`${order.reference} · ${translate('orders.items', { smart_count: items })}`} />
                          <span className={styles.rowEnd}>
                            <span className={styles.amount}>{fmt.money(order.total)}</span>
                            <span className={styles.age}>
                              {isLate && (
                                <Badge tone="warning" size="sm" data-bridge-change="Late order badge">
                                  {translate('dashboard.late')}
                                </Badge>
                              )}
                              <Muted>{fmt.relative(order.date)}</Muted>
                            </span>
                          </span>
                        </LinkBase>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className={styles.sideCol}>
          <Card>
            <CardHeader>
              <span className={styles.cardTitle}>
                {translate('dashboard.new_customers')}
                <Muted>{translate('dashboard.last_30_days')}</Muted>
              </span>
            </CardHeader>
            <CardBody>
              {customersPending ? (
                <Skeleton lines={4} />
              ) : (newCustomers ?? []).length === 0 ? (
                <EmptyState size="sm" icon={UserPlus} title={translate('dashboard.no_customers')} />
              ) : (
                <ul className={styles.list}>
                  {(newCustomers ?? []).map((c) => (
                    <li key={c.id}>
                      <LinkBase to={`/customers/${c.id}`} className={styles.row}>
                        <CustomerCell customer={c} secondary={c.email} />
                        <span className={styles.rowEnd}>
                          <span className={styles.amount}>{fmt.money0(c.total_spent)}</span>
                        </span>
                      </LinkBase>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <span className={styles.cardTitle}>
                {translate('dashboard.pending_reviews')}
                <Muted>{translate('dashboard.reviews_hint', { smart_count: pendingReviewCount ?? 0 })}</Muted>
              </span>
              <Link variant="standalone" className={styles.headerLink} render={<LinkBase to="/reviews" />}>
                {translate('dashboard.moderate')}
              </Link>
            </CardHeader>
            <CardBody>
              {reviewsPending ? (
                <Skeleton lines={4} />
              ) : (reviews ?? []).length === 0 ? (
                <EmptyState size="sm" icon={MessageSquareText} title={translate('dashboard.no_reviews')} />
              ) : (
                <ul className={styles.list}>
                  {(reviews ?? []).map((r) => (
                    <li key={r.id}>
                      <LinkBase to={`/reviews/${r.id}`} className={styles.review}>
                        <span className={styles.reviewTop}>
                          <span className={styles.reviewer}>{fullName(personById.get(r.customer_id)) || '…'}</span>
                          <Stars value={r.rating} />
                        </span>
                        <span className={styles.comment}>{r.comment}</span>
                      </LinkBase>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </Page>
  );
}
