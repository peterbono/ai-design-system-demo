import { LinkBase, minValue, number, required, useGetList, useGetMany, useRecordContext, useTranslate } from 'ra-core';
import { useWatch } from 'react-hook-form';
import { Card, CardBody, EmptyState, Tab, Tabs, TabsList, TabsPanel } from '@demo-ds/react';
import { MessageSquareText } from 'lucide-react';
import { CreatePage, EditPage, FormSection, NumberInput, SelectInput, TextInput, TextareaInput } from '../../ra-bridge';
import { CustomerCell, ReviewStatusBadge, Stars } from '../../ui';
import { useFormat } from '../../format';
import type { Customer, Product, Review } from '../../types';
import { StockBadge, useCategoryNames } from './ProductList';
import styles from './products.module.css';

export function ProductEdit() {
  const translate = useTranslate();
  const fmt = useFormat();
  const { name } = useCategoryNames();
  return (
    <EditPage<Product>
      title={(p) => p.reference}
      subtitle={(p) => `${name(p.category_id)} · ${fmt.money(p.price)}`}
      breadcrumb={() => [{ label: translate('products.title'), render: <LinkBase to="/products" /> }, { label: translate('products.edit_crumb') }]}
      actions={(p) => <StockBadge stock={p.stock} />}
    >
      <ProductTabs withReviews />
    </EditPage>
  );
}

export function ProductCreate() {
  const translate = useTranslate();
  return (
    <CreatePage
      title={translate('products.create_title')}
      breadcrumb={[{ label: translate('products.title'), render: <LinkBase to="/products" /> }, { label: translate('products.create_crumb') }]}
      defaultValues={{ width: 40, height: 50, price: 25, stock: 20, sales: 0, thumbnail: '', image: '' }}
    >
      <ProductTabs />
    </CreatePage>
  );
}

function ProductTabs({ withReviews = false }: { withReviews?: boolean }) {
  const translate = useTranslate();
  const record = useRecordContext<Product>();
  const { total: reviewCount } = useGetList('reviews', { filter: { product_id: record?.id }, pagination: { page: 1, perPage: 1 } }, { enabled: withReviews && record != null });
  return (
    <Card>
      <Tabs defaultValue="details" className={styles.tabs}>
        <div className={styles.tabBar}>
          <TabsList aria-label={translate('products.sections')}>
            <Tab value="details">{translate('products.tabs.details')}</Tab>
            <Tab value="image">{translate('products.tabs.image')}</Tab>
            <Tab value="description">{translate('products.tabs.description')}</Tab>
            {withReviews && (
              <Tab value="reviews" count={reviewCount}>
                {translate('products.tabs.reviews')}
              </Tab>
            )}
          </TabsList>
        </div>
        <CardBody>
          <TabsPanel value="details" keepMounted>
            <DetailsTab />
          </TabsPanel>
          <TabsPanel value="image" keepMounted>
            <ImageTab />
          </TabsPanel>
          <TabsPanel value="description" keepMounted>
            <TextareaInput source="description" label={translate('products.fields.description')} hint={translate('products.description_hint')} rows={6} validate={required()} />
          </TabsPanel>
          {withReviews && (
            <TabsPanel value="reviews">
              <ProductReviews />
            </TabsPanel>
          )}
        </CardBody>
      </Tabs>
    </Card>
  );
}

function DetailsTab() {
  const translate = useTranslate();
  const fmt = useFormat();
  const { categories } = useCategoryNames();
  return (
    <>
      <FormSection>
        <TextInput source="reference" label={translate('products.fields.reference')} validate={required()} />
        <SelectInput source="category_id" label={translate('products.fields.category')} choices={categories.map((c) => ({ id: c.id, name: c.name }))} validate={required()} />
      </FormSection>
      <FormSection title={translate('products.size_price')}>
        <NumberInput source="width" label={translate('products.fields.width')} suffix="cm" min={1} step={0.5} validate={[required(), number(), minValue(1)]} />
        <NumberInput source="height" label={translate('products.fields.height')} suffix="cm" min={1} step={0.5} validate={[required(), number(), minValue(1)]} />
        <NumberInput
          source="price"
          label={translate('products.fields.price')}
          min={0}
          step={0.5}
          format={{ style: 'currency', currency: fmt.currency }}
          validate={[required(), minValue(0)]}
        />
      </FormSection>
      <FormSection title={translate('products.inventory')}>
        <NumberInput source="stock" label={translate('products.fields.stock')} hint={translate('products.stock_hint')} min={0} step={1} validate={[required(), minValue(0)]} />
        <NumberInput source="sales" label={translate('products.fields.sales')} min={0} step={1} readOnly />
      </FormSection>
    </>
  );
}

function ImageTab() {
  const translate = useTranslate();
  const image = useWatch({ name: 'image' }) as string | undefined;
  return (
    <div className={styles.imageTab}>
      <div className={styles.preview}>
        {image ? <img src={image} alt={translate('products.preview_alt')} /> : <EmptyState size="sm" title={translate('products.no_image')} />}
      </div>
      <div className={styles.imageFields}>
        <TextInput source="image" type="url" label={translate('products.fields.image')} hint={translate('products.image_hint')} validate={required()} />
        <TextInput source="thumbnail" type="url" label={translate('products.fields.thumbnail')} validate={required()} />
      </div>
    </div>
  );
}

function ProductReviews() {
  const translate = useTranslate();
  const fmt = useFormat();
  const record = useRecordContext<Product>();
  const { data: reviews, isPending } = useGetList<Review>('reviews', {
    filter: { product_id: record?.id },
    sort: { field: 'date', order: 'DESC' },
    pagination: { page: 1, perPage: 10 },
  });
  const ids = (reviews ?? []).map((r) => r.customer_id);
  const { data: customers } = useGetMany<Customer>('customers', { ids }, { enabled: ids.length > 0 });
  if (isPending) return null;
  if (!reviews?.length) return <EmptyState size="sm" icon={MessageSquareText} title={translate('products.no_reviews')} />;
  return (
    <ul className={styles.reviews}>
      {reviews.map((r) => (
        <li key={r.id}>
          <LinkBase to={`/reviews/${r.id}`} className={styles.review}>
            <span className={styles.reviewHead}>
              <CustomerCell customer={customers?.find((c) => c.id === r.customer_id)} secondary={fmt.date(r.date)} />
              <span className={styles.reviewMeta}>
                <Stars value={r.rating} />
                <ReviewStatusBadge status={r.status} />
              </span>
            </span>
            <span className={styles.reviewText}>{r.comment}</span>
          </LinkBase>
        </li>
      ))}
    </ul>
  );
}
