import { useMemo } from 'react';
import {
  EditBase,
  Form,
  ListBase,
  useEditContext,
  useGetList,
  useGetMany,
  useGetOne,
  useListContext,
  useMatch,
  useNavigate,
  useNotify,
  useTranslate,
  useUnselectAll, useRefresh,
  useUpdate,
  useUpdateMany,
  LinkBase,
} from 'ra-core';
import { Button, Card, CardBody, Drawer, DrawerContent, Skeleton, Tab, Tabs, TabsList } from '@demo-ds/react';
import { Check, MessageSquareText, X } from 'lucide-react';
import { ConfirmButton, DataTable, DateFilter, FilterBar, FormToolbar, Page, SearchFilter, SelectFilter, SelectInput, TextareaInput, type Column } from '../../ra-bridge';
import { CustomerCell, MobileRow, Muted, Properties, ReviewStatusBadge, Stars, Thumbnail, fullName } from '../../ui';
import { useFormat } from '../../format';
import type { Customer, Product, Review, ReviewStatus } from '../../types';
import styles from './reviews.module.css';

const STATUSES: ReviewStatus[] = ['pending', 'accepted', 'rejected'];

export function ReviewList() {
  return (
    <ListBase<Review> sort={{ field: 'date', order: 'DESC' }} filterDefaultValues={{ status: 'pending' }} perPage={25}>
      <ReviewListView />
    </ListBase>
  );
}

function ReviewListView() {
  const translate = useTranslate();
  const navigate = useNavigate();
  const match = useMatch({ path: '/reviews/:id' });
  const id = match?.params.id;
  const { total, isPending } = useListContext();
  return (
    <Page title={translate('reviews.title')} subtitle={isPending ? ' ' : translate('reviews.subtitle', { smart_count: total ?? 0 })}>
      <div className={styles.stack}>
        <StatusTabs />
        <FilterBar>
          <SearchFilter placeholder={translate('reviews.search')} />
          <SelectFilter
            source="rating"
            label={translate('reviews.fields.rating')}
            options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: translate('reviews.stars', { smart_count: n }) }))}
          />
          <DateFilter source="date_gte" label={translate('reviews.since')} />
        </FilterBar>
        <ReviewsTable />
      </div>
      <Drawer open={id != null} onOpenChange={(open) => !open && navigate('/reviews')}>
        {id != null && <ReviewDrawer id={id} onDone={() => navigate('/reviews')} />}
      </Drawer>
    </Page>
  );
}

function StatusTabs() {
  const translate = useTranslate();
  const { filterValues, setFilters, displayedFilters, onUnselectItems } = useListContext();
  const status = (filterValues.status as ReviewStatus | undefined) ?? 'all';
  const { status: _s, ...others } = filterValues as Record<string, unknown>;
  const counts = {
    pending: useStatusTotal(others, 'pending'),
    accepted: useStatusTotal(others, 'accepted'),
    rejected: useStatusTotal(others, 'rejected'),
  };
  return (
    <Tabs
      value={status}
      onValueChange={(value) => {
        onUnselectItems();
        const next = { ...others } as Record<string, unknown>;
        if (value !== 'all') next.status = value;
        setFilters(next, displayedFilters);
      }}
    >
      <TabsList aria-label={translate('reviews.tabs_label')}>
        {STATUSES.map((s) => (
          <Tab key={s} value={s} count={counts[s]}>
            {translate(`reviews.tabs.${s}`)}
          </Tab>
        ))}
        <Tab value="all">{translate('reviews.tabs.all')}</Tab>
      </TabsList>
    </Tabs>
  );
}

function useStatusTotal(others: Record<string, unknown>, status: ReviewStatus) {
  const { total } = useGetList('reviews', { filter: { ...others, status }, pagination: { page: 1, perPage: 1 } });
  return total;
}

function ReviewsTable() {
  const translate = useTranslate();
  const fmt = useFormat();
  const { data, filterValues } = useListContext<Review>();
  const status = filterValues.status as ReviewStatus | undefined;
  const customerIds = useMemo(() => Array.from(new Set((data ?? []).map((r) => r.customer_id))), [data]);
  const productIds = useMemo(() => Array.from(new Set((data ?? []).map((r) => r.product_id))), [data]);
  const { data: customers } = useGetMany<Customer>('customers', { ids: customerIds }, { enabled: customerIds.length > 0 });
  const { data: products } = useGetMany<Product>('products', { ids: productIds }, { enabled: productIds.length > 0 });
  const customerById = useMemo(() => new Map((customers ?? []).map((c) => [c.id, c])), [customers]);
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  const columns: Column<Review>[] = [
    { source: 'date', label: translate('reviews.fields.date'), sortable: true, render: (r) => <span className={styles.nowrap}>{fmt.date(r.date)}</span> },
    { source: 'customer_id', label: translate('reviews.fields.customer'), render: (r) => <CustomerCell customer={customerById.get(r.customer_id)} /> },
    {
      source: 'product_id',
      label: translate('reviews.fields.product'),
      hideBelow: 'md',
      render: (r) => {
        const p = productById.get(r.product_id);
        return p ? (
          <span className={styles.product}>
            <Thumbnail src={p.thumbnail} size="sm" />
            {p.reference}
          </span>
        ) : (
          <Muted>…</Muted>
        );
      },
    },
    { source: 'rating', label: translate('reviews.fields.rating'), sortable: true, render: (r) => <Stars value={r.rating} /> },
    { source: 'comment', label: translate('reviews.fields.comment'), link: true, render: (r) => <span className={styles.comment}>{r.comment}</span> },
  ];
  if (!status) columns.push({ source: 'status', label: translate('reviews.fields.status'), render: (r) => <ReviewStatusBadge status={r.status} /> });

  return (
    <DataTable<Review>
      label={translate('reviews.table_label')}
      columns={columns}
      bulkActions={status === 'pending' || !status ? <ReviewBulkActions /> : undefined}
      rowClassName={(r) => (r.status === 'pending' ? undefined : styles.settled)}
      empty={{ icon: MessageSquareText, title: translate(`reviews.empty.${status ?? 'all'}`), description: translate('reviews.empty_hint') }}
      renderMobile={(r) => (
        <>
          <MobileRow title={fullName(customerById.get(r.customer_id)) || '…'} meta={fmt.date(r.date)} end={<Stars value={r.rating} />} />
          <span className={styles.comment}>{r.comment}</span>
        </>
      )}
    />
  );
}

function ReviewBulkActions() {
  const translate = useTranslate();
  const notify = useNotify();
  const { selectedIds, resource } = useListContext();
  const unselectAll = useUnselectAll(resource);
  const refresh = useRefresh();
  const [updateMany, { isPending }] = useUpdateMany();
  const count = selectedIds.length;
  const run = (status: ReviewStatus) =>
    updateMany(
      'reviews',
      { ids: selectedIds, data: { status } },
      {
        onSuccess: () => {
          notify(`reviews.bulk.${status}_done`, { type: 'success', messageArgs: { smart_count: count } });
          unselectAll();
          refresh();
        },
        onError: () => notify('reviews.bulk.failed', { type: 'error' }),
      },
    );
  return (
    <>
      <Button size="sm" variant="primary" iconStart={Check} loading={isPending} onClick={() => run('accepted')}>
        {translate('reviews.bulk.accept', { smart_count: count })}
      </Button>
      <ConfirmButton
        icon={X}
        title={translate('reviews.bulk.reject_title', { smart_count: count })}
        description={translate('reviews.bulk.reject_description')}
        confirmLabel={translate('reviews.bulk.reject_confirm', { smart_count: count })}
        onConfirm={() => run('rejected')}
      >
        {translate('reviews.bulk.reject')}
      </ConfirmButton>
    </>
  );
}

function ReviewDrawer({ id, onDone }: { id: string; onDone: () => void }) {
  const translate = useTranslate();
  return (
    <DrawerContent title={translate('reviews.drawer_title')} size="md" closeLabel={translate('reviews.close')}>
      <EditBase resource="reviews" id={id} mutationMode="pessimistic" redirect={false} mutationOptions={{ onSuccess: onDone }}>
        <ReviewDetail onDone={onDone} />
      </EditBase>
    </DrawerContent>
  );
}

function ReviewDetail({ onDone }: { onDone: () => void }) {
  const translate = useTranslate();
  const fmt = useFormat();
  const notify = useNotify();
  const { record, isPending } = useEditContext<Review>();
  const { data: customer } = useGetOne<Customer>('customers', { id: record?.customer_id }, { enabled: record != null });
  const { data: product } = useGetOne<Product>('products', { id: record?.product_id }, { enabled: record != null });
  const [update, { isPending: updating }] = useUpdate();
  const refresh = useRefresh();
  if (isPending || !record) return <Skeleton lines={6} />;
  const decide = (status: ReviewStatus) =>
    update(
      'reviews',
      { id: record.id, data: { status }, previousData: record },
      {
        onSuccess: () => {
          notify(`reviews.bulk.${status}_done`, { type: 'success', messageArgs: { smart_count: 1 } });
          refresh();
          onDone();
        },
      },
    );
  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <CustomerCell customer={customer} secondary={fmt.dateTime(record.date)} size="md" link />
        <ReviewStatusBadge status={record.status} />
      </div>
      <Card>
        <CardBody>
          <div className={styles.quote}>
            <Stars value={record.rating} size="sm" />
            <p>{record.comment}</p>
          </div>
        </CardBody>
      </Card>
      {product && (
        <LinkBase to={`/products/${product.id}`} className={styles.productLink}>
          <Thumbnail src={product.thumbnail} size="lg" />
          <Properties
            items={[
              { label: translate('reviews.fields.product'), value: product.reference },
              { label: translate('products.fields.price'), value: fmt.money(product.price) },
            ]}
          />
        </LinkBase>
      )}
      {record.status === 'pending' && (
        <div className={styles.decision}>
          <Button variant="primary" iconStart={Check} loading={updating} onClick={() => decide('accepted')}>
            {translate('reviews.accept')}
          </Button>
          <Button variant="secondary" iconStart={X} disabled={updating} onClick={() => decide('rejected')}>
            {translate('reviews.reject')}
          </Button>
        </div>
      )}
      <Form className={styles.form}>
        <SelectInput source="status" label={translate('reviews.fields.status')} choices={STATUSES.map((s) => ({ id: s, name: translate(`reviews.status.${s}`) }))} />
        <TextareaInput source="comment" label={translate('reviews.fields.comment')} hint={translate('reviews.comment_hint')} />
        <FormToolbar deletable={false} sticky={false} />
      </Form>
    </div>
  );
}
