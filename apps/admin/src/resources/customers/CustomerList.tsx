import { ListBase, useListContext, useTranslate } from 'ra-core';
import { Avatar, Badge, Inline } from '@demo-ds/react';
import { Mail, Users } from 'lucide-react';
import { DataTable, FilterBar, Page, SearchFilter, SelectFilter, type Column } from '../../ra-bridge';
import { CustomerCell, MobileRow, Muted, fullName } from '../../ui';
import { useFormat } from '../../format';
import type { Customer } from '../../types';
import { SEGMENT_IDS } from '../shared/segments';
import styles from './customers.module.css';

export function CustomerList() {
  return (
    <ListBase<Customer> sort={{ field: 'last_seen', order: 'DESC' }} filterDefaultValues={{ has_ordered: true }} perPage={25}>
      <CustomerListView />
    </ListBase>
  );
}

export function SegmentBadges({ groups, max = 2 }: { groups: string[]; max?: number }) {
  const translate = useTranslate();
  if (!groups?.length) return <Muted>{translate('customers.no_segment')}</Muted>;
  const shown = groups.slice(0, max);
  return (
    <Inline gap="1" wrap>
      {shown.map((g) => (
        <Badge key={g} tone="neutral" size="sm">
          {translate(`segments.names.${g}`)}
        </Badge>
      ))}
      {groups.length > max && <Muted>+{groups.length - max}</Muted>}
    </Inline>
  );
}

function CustomerListView() {
  const translate = useTranslate();
  const fmt = useFormat();
  const { total, isPending } = useListContext();

  const columns: Column<Customer>[] = [
    {
      source: 'last_name',
      label: translate('customers.fields.name'),
      sortable: true,
      link: true,
      render: (c) => <CustomerCell customer={c} secondary={c.email} />,
    },
    { source: 'last_seen', label: translate('customers.fields.last_seen'), sortable: true, hideBelow: 'md', render: (c) => fmt.relative(c.last_seen) },
    { source: 'nb_orders', label: translate('customers.fields.orders'), sortable: true, numeric: true, render: (c) => fmt.number(c.nb_orders) },
    { source: 'total_spent', label: translate('customers.fields.total_spent'), sortable: true, numeric: true, render: (c) => <strong className={styles.amount}>{fmt.money(c.total_spent)}</strong> },
    {
      source: 'latest_purchase',
      label: translate('customers.fields.latest_purchase'),
      sortable: true,
      hideBelow: 'lg',
      render: (c) => (c.latest_purchase ? fmt.date(c.latest_purchase) : <Muted>{translate('customers.never')}</Muted>),
    },
    {
      source: 'has_newsletter',
      label: translate('customers.fields.newsletter'),
      hideBelow: 'lg',
      render: (c) => (c.has_newsletter ? <Badge tone="info" size="sm" icon={Mail}>{translate('customers.subscribed')}</Badge> : <Muted>{translate('customers.not_subscribed')}</Muted>),
    },
    { source: 'groups', label: translate('customers.fields.segments'), hideBelow: 'md', render: (c) => <SegmentBadges groups={c.groups} /> },
  ];

  return (
    <Page title={translate('customers.title')} subtitle={isPending ? ' ' : translate('customers.subtitle', { smart_count: total ?? 0 })}>
      <div className={styles.stack}>
        <FilterBar>
          <SearchFilter placeholder={translate('customers.search')} />
          <SelectFilter source="groups" label={translate('customers.fields.segment')} options={SEGMENT_IDS.map((id) => ({ value: id, label: translate(`segments.names.${id}`) }))} />
          <SelectFilter
            source="has_ordered"
            label={translate('customers.fields.has_ordered')}
            options={[
              { value: 'true', label: translate('customers.has_ordered_yes') },
              { value: 'false', label: translate('customers.has_ordered_no') },
            ]}
          />
          <SelectFilter
            source="has_newsletter"
            label={translate('customers.fields.newsletter')}
            options={[
              { value: 'true', label: translate('customers.subscribed') },
              { value: 'false', label: translate('customers.not_subscribed') },
            ]}
          />
        </FilterBar>
        <DataTable<Customer>
          label={translate('customers.title')}
          columns={columns}
          empty={{ icon: Users, title: translate('customers.empty'), description: translate('customers.empty_hint') }}
          renderMobile={(c) => (
            <MobileRow
              leading={<Avatar name={fullName(c)} src={c.avatar || undefined} size="sm" decorative />}
              title={fullName(c)}
              meta={c.email}
              end={<strong className={styles.amount}>{fmt.money0(c.total_spent)}</strong>}
              endMeta={translate('customers.orders_count', { smart_count: c.nb_orders })}
            />
          )}
        />
      </div>
    </Page>
  );
}
