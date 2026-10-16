import { useMemo } from 'react';
import { ListBase, useGetList, useGetMany, useListContext, useNotify, useTranslate, useUnselectAll, useRefresh, useUpdateMany } from 'ra-core';
import { Avatar, Button, Tab, Tabs, TabsList } from '@bridge-ds/react';
import { Ban, PackageCheck, ShoppingBag } from 'lucide-react';
import { ConfirmButton, DataTable, DateFilter, FilterBar, Page, SearchFilter, type Column } from '../../ra-bridge';
import { CustomerCell, MobileRow, Mono, Muted, fullName } from '../../ui';
import { useFormat } from '../../format';
import type { Customer, Order, OrderStatus } from '../../types';
import styles from './orders.module.css';

const STATUSES: OrderStatus[] = ['ordered', 'delivered', 'cancelled'];

export function OrderList() {
  return (
    <ListBase<Order> sort={{ field: 'date', order: 'DESC' }} filterDefaultValues={{ status: 'ordered' }} perPage={25}>
      <OrderListView />
    </ListBase>
  );
}

function OrderListView() {
  const translate = useTranslate();
  const { total, isPending } = useListContext();
  return (
    <Page
      title={translate('orders.title')}
      subtitle={isPending ? ' ' : translate('orders.subtitle', { smart_count: total ?? 0 })}
    >
      <div className={styles.listStack}>
        <StatusTabs />
        <FilterBar>
          <SearchFilter placeholder={translate('orders.search')} />
          <DateFilter source="date_gte" label={translate('orders.since')} />
          <DateFilter source="date_lte" label={translate('orders.until')} />
        </FilterBar>
        <OrdersTable />
      </div>
    </Page>
  );
}

function useStatusCount(status: OrderStatus, filterValues: Record<string, unknown>) {
  const { total } = useGetList('orders', { filter: { ...filterValues, status }, pagination: { page: 1, perPage: 1 } });
  return total;
}

function StatusTabs() {
  const translate = useTranslate();
  const { filterValues, setFilters, displayedFilters, onUnselectItems } = useListContext();
  const status: OrderStatus = (filterValues.status as OrderStatus) ?? 'ordered';
  const others = useMemo(() => {
    const { status: _ignored, ...rest } = filterValues as Record<string, unknown>;
    return rest;
  }, [filterValues]);
  const counts = {
    ordered: useStatusCount('ordered', others),
    delivered: useStatusCount('delivered', others),
    cancelled: useStatusCount('cancelled', others),
  };
  return (
    <Tabs
      value={status}
      onValueChange={(value) => {
        onUnselectItems();
        setFilters({ ...filterValues, status: value }, displayedFilters);
      }}
    >
      <TabsList aria-label={translate('orders.tabs_label')}>
        {STATUSES.map((s) => (
          <Tab key={s} value={s} count={counts[s]}>
            {translate(`orders.tabs.${s}`)}
          </Tab>
        ))}
      </TabsList>
    </Tabs>
  );
}

function OrdersTable() {
  const translate = useTranslate();
  const fmt = useFormat();
  const { data, filterValues } = useListContext<Order>();
  const status: OrderStatus = (filterValues.status as OrderStatus) ?? 'ordered';
  const ids = useMemo(() => Array.from(new Set((data ?? []).map((o) => o.customer_id))), [data]);
  const { data: customers } = useGetMany<Customer>('customers', { ids }, { enabled: ids.length > 0 });
  const byId = useMemo(() => new Map((customers ?? []).map((c) => [c.id, c])), [customers]);

  const columns: Column<Order>[] = [
    { source: 'date', label: translate('orders.fields.date'), sortable: true, render: (o) => <span className={styles.nowrap}>{fmt.dateTime(o.date)}</span> },
    { source: 'reference', label: translate('orders.fields.reference'), sortable: true, link: true, render: (o) => <Mono>{o.reference}</Mono> },
    {
      source: 'customer_id',
      label: translate('orders.fields.customer'),
      render: (o) => {
        const c = byId.get(o.customer_id);
        return <CustomerCell customer={c} secondary={c ? `${c.city}, ${c.stateAbbr}` : undefined} />;
      },
    },
    {
      source: 'basket',
      label: translate('orders.fields.items'),
      numeric: true,
      hideBelow: 'md',
      render: (o) => fmt.number(o.basket.reduce((n, b) => n + b.quantity, 0)),
    },
    { source: 'total_ex_taxes', label: translate('orders.fields.subtotal'), numeric: true, sortable: true, hideBelow: 'lg', render: (o) => <Muted>{fmt.money(o.total_ex_taxes)}</Muted> },
    { source: 'total', label: translate('orders.fields.total'), numeric: true, sortable: true, render: (o) => <strong className={styles.amount}>{fmt.money(o.total)}</strong> },
  ];
  if (status === 'delivered') {
    columns.push({
      source: 'returned',
      label: translate('orders.fields.returned'),
      hideBelow: 'md',
      render: (o) => (o.returned ? translate('orders.returned_yes') : <Muted>{translate('orders.returned_no')}</Muted>),
    });
  }

  return (
    <DataTable<Order>
      label={translate('orders.table_label', { status: translate(`orders.tabs.${status}`) })}
      columns={columns}
      bulkActions={status === 'ordered' ? <OrderBulkActions /> : undefined}
      empty={{ icon: ShoppingBag, title: translate(`orders.empty.${status}`), description: translate('orders.empty_hint') }}
      renderMobile={(o) => {
        const c = byId.get(o.customer_id);
        return (
          <MobileRow
            leading={<Avatar name={fullName(c) || o.reference} src={c?.avatar || undefined} size="sm" decorative />}
            title={fullName(c) || '…'}
            meta={`${o.reference} · ${fmt.dateTime(o.date)}`}
            end={<strong className={styles.amount}>{fmt.money(o.total)}</strong>}
            endMeta={translate('orders.items', { smart_count: o.basket.reduce((n, b) => n + b.quantity, 0) })}
          />
        );
      }}
    />
  );
}

function OrderBulkActions() {
  const translate = useTranslate();
  const notify = useNotify();
  const { selectedIds, resource } = useListContext();
  const unselectAll = useUnselectAll(resource);
  const refresh = useRefresh();
  const [updateMany, { isPending }] = useUpdateMany();
  const run = (status: OrderStatus) =>
    updateMany(
      'orders',
      { ids: selectedIds, data: { status } },
      {
        onSuccess: () => {
          notify(`orders.bulk.${status}_done`, { type: 'success', messageArgs: { smart_count: selectedIds.length } });
          unselectAll();
          refresh();
        },
        onError: () => notify('orders.bulk.failed', { type: 'error' }),
      },
    );
  const count = selectedIds.length;
  return (
    <>
      <Button size="sm" variant="primary" iconStart={PackageCheck} loading={isPending} onClick={() => run('delivered')}>
        {translate('orders.bulk.deliver', { smart_count: count })}
      </Button>
      <ConfirmButton
        icon={Ban}
        title={translate('orders.bulk.cancel_title', { smart_count: count })}
        description={translate('orders.bulk.cancel_description')}
        confirmLabel={translate('orders.bulk.cancel_confirm', { smart_count: count })}
        onConfirm={() => run('cancelled')}
      >
        {translate('orders.bulk.cancel')}
      </ConfirmButton>
    </>
  );
}

