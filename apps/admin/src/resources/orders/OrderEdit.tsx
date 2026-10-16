import { useMemo } from 'react';
import { LinkBase, useGetMany, useGetOne, useRecordContext, useTranslate } from 'ra-core';
import { useWatch } from 'react-hook-form';
import { Card, CardBody, CardHeader, Divider, Link, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@demo-ds/react';
import { BooleanInput, EditPage, FormSection, SelectInput } from '../../ra-bridge';
import { CustomerCell, Muted, OrderStatusBadge, Properties, Thumbnail } from '../../ui';
import { useFormat } from '../../format';
import type { Customer, Order, OrderStatus, Product } from '../../types';
import styles from './orders.module.css';

export function OrderEdit() {
  const translate = useTranslate();
  const fmt = useFormat();
  return (
    <EditPage<Order>
      title={(o) => translate('orders.edit_title', { reference: o.reference })}
      subtitle={(o) => translate('orders.edit_subtitle', { date: fmt.dateTime(o.date) })}
      breadcrumb={() => [{ label: translate('orders.title'), render: <LinkBase to="/orders" /> }, { label: translate('orders.edit_crumb') }]}
      actions={(o) => <OrderStatusBadge status={o.status} />}
      deletable={false}
      aside={<CustomerAside />}
    >
      <Card>
        <CardHeader>{translate('orders.basket')}</CardHeader>
        <CardBody>
          <Basket />
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <FormSection title={translate('orders.fulfilment')} description={translate('orders.fulfilment_hint')}>
            <SelectInput
              source="status"
              label={translate('orders.fields.status')}
              choices={(['ordered', 'delivered', 'cancelled'] as OrderStatus[]).map((s) => ({ id: s, name: translate(`orders.status.${s}`) }))}
            />
            <ReturnedInput />
          </FormSection>
        </CardBody>
      </Card>
    </EditPage>
  );
}

function ReturnedInput() {
  const translate = useTranslate();
  const status = useWatch({ name: 'status' }) as OrderStatus;
  return (
    <div className={styles.switchCell}>
      <BooleanInput
        source="returned"
        label={translate('orders.fields.returned')}
        hint={status === 'delivered' ? translate('orders.returned_hint') : translate('orders.returned_disabled')}
        disabled={status !== 'delivered'}
      />
    </div>
  );
}

function Basket() {
  const translate = useTranslate();
  const fmt = useFormat();
  const order = useRecordContext<Order>();
  const ids = useMemo(() => order?.basket.map((b) => b.product_id) ?? [], [order]);
  const { data: products, isPending } = useGetMany<Product>('products', { ids }, { enabled: ids.length > 0 });
  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);
  if (!order) return null;
  return (
    <div className={styles.basket}>
      <Table aria-label={translate('orders.basket')}>
        <TableHeader>
          <TableRow>
            <TableHead>{translate('orders.fields.product')}</TableHead>
            <TableHead numeric>{translate('orders.fields.unit_price')}</TableHead>
            <TableHead numeric>{translate('orders.fields.quantity')}</TableHead>
            <TableHead numeric>{translate('orders.fields.line_total')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {order.basket.map((item) => {
            const p = byId.get(item.product_id);
            return (
              <TableRow key={item.product_id}>
                <TableCell>
                  {isPending || !p ? (
                    <Skeleton width="var(--size-60)" />
                  ) : (
                    <LinkBase to={`/products/${p.id}`} className={styles.product}>
                      <Thumbnail src={p.thumbnail} size="sm" />
                      <span className={styles.productText}>
                        <span className={styles.productName}>{p.reference}</span>
                        <Muted>
                          {p.width} x {p.height} cm
                        </Muted>
                      </span>
                    </LinkBase>
                  )}
                </TableCell>
                <TableCell numeric>{p ? fmt.money(p.price) : ''}</TableCell>
                <TableCell numeric>{item.quantity}</TableCell>
                <TableCell numeric>{p ? fmt.money(p.price * item.quantity) : ''}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className={styles.totals}>
        <Properties
          items={[
            { label: translate('orders.fields.subtotal'), value: fmt.money(order.total_ex_taxes) },
            { label: translate('orders.fields.delivery'), value: fmt.money(order.delivery_fees) },
            { label: translate('orders.fields.taxes', { rate: fmt.percent(order.tax_rate) }), value: fmt.money(order.taxes) },
          ]}
        />
        <Divider spacing="sm" />
        <div className={styles.grandTotal}>
          <span>{translate('orders.fields.total')}</span>
          <span>{fmt.money(order.total)}</span>
        </div>
      </div>
    </div>
  );
}

function CustomerAside() {
  const translate = useTranslate();
  const fmt = useFormat();
  const order = useRecordContext<Order>();
  const { data: customer, isPending } = useGetOne<Customer>('customers', { id: order?.customer_id }, { enabled: order != null });
  return (
    <>
      <Card>
        <CardHeader>{translate('orders.customer')}</CardHeader>
        <CardBody>
          {isPending || !customer ? (
            <Skeleton lines={3} />
          ) : (
            <div className={styles.asideStack}>
              <CustomerCell customer={customer} secondary={customer.email} size="md" link />
              <Properties
                items={[
                  { label: translate('customers.fields.orders'), value: fmt.number(customer.nb_orders) },
                  { label: translate('customers.fields.total_spent'), value: fmt.money(customer.total_spent) },
                  { label: translate('customers.fields.first_seen'), value: fmt.date(customer.first_seen) },
                ]}
              />
              <Link variant="standalone" render={<LinkBase to={`/customers/${customer.id}`} />}>
                {translate('orders.open_customer')}
              </Link>
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>{translate('orders.shipping')}</CardHeader>
        <CardBody>
          {isPending || !customer ? (
            <Skeleton lines={2} />
          ) : (
            <address className={styles.address}>
              {customer.first_name} {customer.last_name}
              <br />
              {customer.address}
              <br />
              {customer.city}, {customer.stateAbbr} {customer.zipcode}
            </address>
          )}
        </CardBody>
      </Card>
    </>
  );
}
