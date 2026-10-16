import { Form, LinkBase, ListBase, required, useGetList, useListContext, useRecordContext, useTranslate } from 'ra-core';
import { Card, CardBody, CardHeader, Skeleton } from '@bridge-ds/react';
import { FolderTree, Image } from 'lucide-react';
import { DataTable, EditPage, FormSection, FormToolbar, Page, TextInput, type Column } from '../../ra-bridge';
import { MobileRow, Muted, Thumbnail } from '../../ui';
import { useFormat } from '../../format';
import type { Category, Product } from '../../types';
import { StockBadge } from '../products/ProductList';
import styles from './categories.module.css';

export function CategoryList() {
  return (
    <ListBase<Category> sort={{ field: 'name', order: 'ASC' }} perPage={50}>
      <CategoryListView />
    </ListBase>
  );
}

function CategoryListView() {
  const translate = useTranslate();
  const fmt = useFormat();
  const { data, isPending, total } = useListContext<Category>();
  const { data: products } = useGetList<Product>('products', { pagination: { page: 1, perPage: 1000 }, sort: { field: 'id', order: 'ASC' } });
  const stats = (id: number) => {
    const list = (products ?? []).filter((p) => p.category_id === id);
    return {
      count: list.length,
      sales: list.reduce((n, p) => n + p.sales, 0),
      cover: list[0]?.thumbnail,
      lowStock: list.filter((p) => p.stock < 10).length,
    };
  };
  return (
    <Page title={translate('categories.title')} subtitle={isPending ? ' ' : translate('categories.subtitle', { smart_count: total ?? 0 })}>
      {isPending ? (
        <div className={styles.grid}>
          {Array.from({ length: 8 }, (_, i) => (
            <Card key={i}>
              <CardBody>
                <Skeleton lines={2} />
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        <ul className={styles.grid} aria-label={translate('categories.title')}>
          {(data ?? []).map((c) => {
            const s = stats(c.id);
            return (
              <li key={c.id}>
                <LinkBase to={`/categories/${c.id}`} className={styles.link}>
                  <Card interactive className={styles.card}>
                    <span className={styles.head}>
                      {s.cover ? <Thumbnail src={s.cover} size="lg" /> : <span className={styles.placeholder} />}
                      <span className={styles.text}>
                        <span className={styles.name}>{c.name}</span>
                        <Muted>{translate('categories.products', { smart_count: s.count })}</Muted>
                      </span>
                    </span>
                    <span className={styles.meta}>
                      <span>{translate('categories.sales', { value: fmt.number(s.sales) })}</span>
                      {s.lowStock > 0 && <Muted>{translate('categories.low_stock', { smart_count: s.lowStock })}</Muted>}
                    </span>
                  </Card>
                </LinkBase>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}

export function CategoryEdit() {
  const translate = useTranslate();
  return (
    <EditPage<Category>
      title={(c) => c.name}
      breadcrumb={() => [{ label: translate('categories.title'), render: <LinkBase to="/categories" /> }, { label: translate('categories.edit_crumb') }]}
      aside={<CategoryHelp />}
      form={false}
    >
      <Form className={styles.form}>
        <Card>
          <CardBody>
            <FormSection title={translate('categories.details')} columns={1}>
              <TextInput source="name" label={translate('categories.fields.name')} hint={translate('categories.name_hint')} validate={required()} />
            </FormSection>
          </CardBody>
        </Card>
        <FormToolbar sticky={false} />
      </Form>
      <CategoryProducts />
    </EditPage>
  );
}

function CategoryHelp() {
  const translate = useTranslate();
  return (
    <Card>
      <CardHeader>{translate('categories.help_title')}</CardHeader>
      <CardBody>
        <p className={styles.help}>{translate('categories.help')}</p>
      </CardBody>
    </Card>
  );
}

function CategoryProducts() {
  const translate = useTranslate();
  const fmt = useFormat();
  const category = useRecordContext<Category>();
  if (!category) return null;
  const columns: Column<Product>[] = [
    {
      source: 'reference',
      label: translate('products.fields.reference'),
      sortable: true,
      link: true,
      render: (p) => (
        <span className={styles.ref}>
          <Thumbnail src={p.thumbnail} size="sm" />
          {p.reference}
        </span>
      ),
    },
    { source: 'price', label: translate('products.fields.price'), numeric: true, sortable: true, render: (p) => fmt.money(p.price) },
    { source: 'sales', label: translate('products.fields.sales'), numeric: true, sortable: true, hideBelow: 'md', render: (p) => fmt.number(p.sales) },
    { source: 'stock', label: translate('products.fields.stock'), numeric: true, sortable: true, render: (p) => <StockBadge stock={p.stock} /> },
  ];
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{translate('categories.products_title')}</h2>
      <ListBase<Product> resource="products" filter={{ category_id: category.id }} sort={{ field: 'sales', order: 'DESC' }} perPage={10} disableSyncWithLocation storeKey={false}>
        <DataTable<Product>
          label={translate('categories.products_title')}
          columns={columns}
          empty={{ icon: Image, title: translate('categories.no_products') }}
          renderMobile={(p) => <MobileRow leading={<Thumbnail src={p.thumbnail} size="md" />} title={p.reference} end={fmt.money(p.price)} endMeta={<StockBadge stock={p.stock} />} />}
        />
      </ListBase>
    </section>
  );
}

export const categoryIcon = FolderTree;
