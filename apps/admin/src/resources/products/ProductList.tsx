import { useState } from 'react';
import { LinkBase, ListBase, useCreatePath, useGetList, useListContext, useTranslate } from 'ra-core';
import { Badge, Button, Card, EmptyState, Skeleton, Tab, Tabs, TabsList } from '@demo-ds/react';
import { Image, LayoutGrid, List, Plus, SearchX } from 'lucide-react';
import { DataTable, FilterBar, ListPagination, Page, SearchFilter, SelectFilter, type Column } from '../../ra-bridge';
import { MobileRow, Muted, Thumbnail } from '../../ui';
import { useFormat } from '../../format';
import type { Category, Product } from '../../types';
import styles from './products.module.css';

type View = 'grid' | 'list';

export function ProductList() {
  return (
    <ListBase<Product> sort={{ field: 'reference', order: 'ASC' }} perPage={24}>
      <ProductListView />
    </ListBase>
  );
}

export function StockBadge({ stock }: { stock: number }) {
  const translate = useTranslate();
  if (stock === 0) return <Badge tone="danger" size="sm">{translate('products.out_of_stock')}</Badge>;
  if (stock < 10) return <Badge tone="warning" size="sm">{translate('products.low_stock', { smart_count: stock })}</Badge>;
  return <Badge tone="neutral" size="sm">{translate('products.in_stock', { smart_count: stock })}</Badge>;
}

export function useCategoryNames() {
  const { data } = useGetList<Category>('categories', { pagination: { page: 1, perPage: 100 }, sort: { field: 'name', order: 'ASC' } });
  return { categories: data ?? [], name: (id: number) => data?.find((c) => c.id === id)?.name ?? '' };
}

function ProductListView() {
  const translate = useTranslate();
  const [view, setView] = useState<View>(() => {
    try {
      return window.localStorage.getItem('bridge-admin:products-view') === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const { total, isPending } = useListContext();
  const { categories } = useCategoryNames();
  const changeView = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem('bridge-admin:products-view', v);
    } catch {
      // Per-viewer convenience only.
    }
  };
  return (
    <Page
      title={translate('products.title')}
      subtitle={isPending ? ' ' : translate('products.subtitle', { smart_count: total ?? 0 })}
      actions={
        <Button variant="primary" iconStart={Plus} render={<LinkBase to="/products/create" />}>
          {translate('products.create')}
        </Button>
      }
    >
      <div className={styles.stack}>
        <div className={styles.toolbar}>
          <FilterBar>
            <SearchFilter placeholder={translate('products.search')} />
            <SelectFilter source="category_id" label={translate('products.fields.category')} options={categories.map((c) => ({ value: String(c.id), label: c.name }))} />
            <SelectFilter
              source="stock_lte"
              label={translate('products.fields.stock')}
              options={[
                { value: '0', label: translate('products.stock_filter.out') },
                { value: '9', label: translate('products.stock_filter.low') },
              ]}
            />
          </FilterBar>
          <Tabs value={view} onValueChange={(v) => changeView(v === 'list' ? 'list' : 'grid')} variant="contained" size="sm">
            <TabsList aria-label={translate('products.view')}>
              <Tab value="grid" icon={LayoutGrid}>
                {translate('products.grid')}
              </Tab>
              <Tab value="list" icon={List}>
                {translate('products.list')}
              </Tab>
            </TabsList>
          </Tabs>
        </div>
        {view === 'grid' ? <ProductGrid /> : <ProductTable />}
      </div>
    </Page>
  );
}

function ProductGrid() {
  const translate = useTranslate();
  const fmt = useFormat();
  const createPath = useCreatePath();
  const { data, isPending, perPage, total, setFilters } = useListContext<Product>();
  const { name } = useCategoryNames();
  if (isPending) {
    return (
      <div className={styles.grid}>
        {Array.from({ length: Math.min(perPage, 12) }, (_, i) => (
          <Card key={i} padding="none">
            <Skeleton variant="rect" height="var(--size-60)" />
            <div className={styles.cardBody}>
              <Skeleton width="var(--size-20)" />
              <Skeleton width="var(--size-16)" />
            </div>
          </Card>
        ))}
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={SearchX}
          title={translate('bridge.list.no_results', { _: 'No results match these filters' })}
          description={translate('bridge.list.no_results_hint', { _: 'Try another search, or clear the filters to see everything.' })}
          actions={
            <Button variant="secondary" size="sm" onClick={() => setFilters({}, {})}>
              {translate('bridge.list.clear_filters', { _: 'Clear filters' })}
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <>
      <ul className={styles.grid} aria-label={translate('products.title')}>
        {data.map((p) => (
          <li key={p.id}>
            <LinkBase to={createPath({ resource: 'products', id: p.id, type: 'edit' })} className={styles.cardLink}>
              <Card padding="none" interactive className={styles.card}>
                <img src={p.thumbnail} alt="" loading="lazy" className={styles.image} />
                <div className={styles.cardBody}>
                  <span className={styles.cardTitle}>{p.reference}</span>
                  <Muted>
                    {name(p.category_id)} · {fmt.number(p.width)} x {fmt.number(p.height)} cm
                  </Muted>
                  <span className={styles.cardFoot}>
                    <span className={styles.price}>{fmt.money(p.price)}</span>
                    <StockBadge stock={p.stock} />
                  </span>
                </div>
              </Card>
            </LinkBase>
          </li>
        ))}
      </ul>
      {(total ?? 0) > 0 && <ListPagination perPageOptions={[12, 24, 48]} />}
    </>
  );
}

function ProductTable() {
  const translate = useTranslate();
  const fmt = useFormat();
  const { name } = useCategoryNames();
  const columns: Column<Product>[] = [
    {
      source: 'reference',
      label: translate('products.fields.reference'),
      sortable: true,
      link: true,
      render: (p) => (
        <span className={styles.refCell}>
          <Thumbnail src={p.thumbnail} size="sm" />
          {p.reference}
        </span>
      ),
    },
    { source: 'category_id', label: translate('products.fields.category'), hideBelow: 'md', render: (p) => name(p.category_id) },
    { source: 'width', label: translate('products.fields.size'), hideBelow: 'lg', render: (p) => <Muted>{`${fmt.number(p.width)} x ${fmt.number(p.height)} cm`}</Muted> },
    { source: 'price', label: translate('products.fields.price'), sortable: true, numeric: true, render: (p) => fmt.money(p.price) },
    { source: 'sales', label: translate('products.fields.sales'), sortable: true, numeric: true, hideBelow: 'md', render: (p) => fmt.number(p.sales) },
    { source: 'stock', label: translate('products.fields.stock'), sortable: true, numeric: true, render: (p) => <StockBadge stock={p.stock} /> },
  ];
  return (
    <DataTable<Product>
      label={translate('products.title')}
      columns={columns}
      empty={{ icon: Image, title: translate('products.empty') }}
      renderMobile={(p) => (
        <MobileRow leading={<Thumbnail src={p.thumbnail} size="md" />} title={p.reference} meta={name(p.category_id)} end={fmt.money(p.price)} endMeta={<StockBadge stock={p.stock} />} />
      )}
    />
  );
}
