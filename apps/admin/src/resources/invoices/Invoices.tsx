import { useMemo } from 'react';
import { LinkBase, ListBase, ShowBase, useGetMany, useGetOne, useListContext, useShowContext, useTranslate } from 'ra-core';
import { Button, Card, CardBody, Divider, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';
import { FileText, Printer } from 'lucide-react';
import { DataTable, DateFilter, FilterBar, Page, RecordSkeleton, type Column } from '../../ra-bridge';
import { CustomerCell, MobileRow, Mono, Muted, Properties, fullName } from '../../ui';
import { useFormat } from '../../format';
import { usePreferences } from '../../preferences';
import type { Customer, Invoice, Order, Product } from '../../types';
import styles from './invoices.module.css';

export function invoiceNumber(id: number | string) {
  return `INV-${String(id).padStart(5, '0')}`;
}

export function InvoiceList() {
  return (
    <ListBase<Invoice> sort={{ field: 'date', order: 'DESC' }} perPage={25}>
      <InvoiceListView />
    </ListBase>
  );
}

function InvoiceListView() {
  const translate = useTranslate();
  const fmt = useFormat();
  const { data, total, isPending } = useListContext<Invoice>();
  const customerIds = useMemo(() => Array.from(new Set((data ?? []).map((i) => i.customer_id))), [data]);
  const orderIds = useMemo(() => Array.from(new Set((data ?? []).map((i) => i.order_id))), [data]);
  const { data: customers } = useGetMany<Customer>('customers', { ids: customerIds }, { enabled: customerIds.length > 0 });
  const { data: orders } = useGetMany<Order>('orders', { ids: orderIds }, { enabled: orderIds.length > 0 });
  const customer = (id: number) => customers?.find((c) => c.id === id);
  const order = (id: number) => orders?.find((o) => o.id === id);

  const columns: Column<Invoice>[] = [
    { source: 'id', label: translate('invoices.fields.number'), sortable: true, link: true, render: (i) => <Mono>{invoiceNumber(i.id)}</Mono> },
    { source: 'date', label: translate('invoices.fields.date'), sortable: true, render: (i) => fmt.date(i.date) },
    { source: 'customer_id', label: translate('invoices.fields.customer'), render: (i) => <CustomerCell customer={customer(i.customer_id)} /> },
    { source: 'order_id', label: translate('invoices.fields.order'), hideBelow: 'md', render: (i) => <Mono>{order(i.order_id)?.reference ?? ''}</Mono> },
    { source: 'total_ex_taxes', label: translate('invoices.fields.subtotal'), numeric: true, sortable: true, hideBelow: 'lg', render: (i) => <Muted>{fmt.money(i.total_ex_taxes)}</Muted> },
    { source: 'taxes', label: translate('invoices.fields.taxes'), numeric: true, hideBelow: 'lg', render: (i) => <Muted>{fmt.money(i.taxes)}</Muted> },
    { source: 'total', label: translate('invoices.fields.total'), numeric: true, sortable: true, render: (i) => <strong className={styles.amount}>{fmt.money(i.total)}</strong> },
  ];

  return (
    <Page title={translate('invoices.title')} subtitle={isPending ? ' ' : translate('invoices.subtitle', { smart_count: total ?? 0 })}>
      <div className={styles.stack}>
        <FilterBar>
          <DateFilter source="date_gte" label={translate('invoices.since')} />
          <DateFilter source="date_lte" label={translate('invoices.until')} />
        </FilterBar>
        <DataTable<Invoice>
          label={translate('invoices.title')}
          columns={columns}
          rowClick="show"
          empty={{ icon: FileText, title: translate('invoices.empty'), description: translate('invoices.empty_hint') }}
          renderMobile={(i) => (
            <MobileRow title={invoiceNumber(i.id)} meta={`${fullName(customer(i.customer_id))} · ${fmt.date(i.date)}`} end={<strong className={styles.amount}>{fmt.money(i.total)}</strong>} />
          )}
        />
      </div>
    </Page>
  );
}

export function InvoiceShow() {
  return (
    <ShowBase>
      <InvoiceShowView />
    </ShowBase>
  );
}

function InvoiceShowView() {
  const translate = useTranslate();
  const fmt = useFormat();
  const { tenant } = usePreferences();
  const { record: invoice, isPending } = useShowContext<Invoice>();
  const { data: customer } = useGetOne<Customer>('customers', { id: invoice?.customer_id }, { enabled: invoice != null });
  const { data: order } = useGetOne<Order>('orders', { id: invoice?.order_id }, { enabled: invoice != null });
  const productIds = order?.basket.map((b) => b.product_id) ?? [];
  const { data: products } = useGetMany<Product>('products', { ids: productIds }, { enabled: productIds.length > 0 });
  if (isPending || !invoice) return <RecordSkeleton />;
  return (
    <Page
      title={invoiceNumber(invoice.id)}
      subtitle={translate('invoices.issued', { date: fmt.date(invoice.date) })}
      breadcrumb={[{ label: translate('invoices.title'), render: <LinkBase to="/invoices" /> }, { label: translate('invoices.show_crumb') }]}
      actions={
        <Button variant="secondary" iconStart={Printer} onClick={() => window.print()}>
          {translate('invoices.print')}
        </Button>
      }
    >
      <Card className={styles.document}>
        <CardBody>
          <div className={styles.docHead}>
            <div className={styles.docParty}>
              <span className={styles.docLabel}>{translate('invoices.from')}</span>
              <strong>{tenant.name}</strong>
              <Muted>{translate('invoices.demo_address')}</Muted>
            </div>
            <div className={styles.docParty}>
              <span className={styles.docLabel}>{translate('invoices.bill_to')}</span>
              <strong>{fullName(customer)}</strong>
              {customer && (
                <Muted>
                  {customer.address}, {customer.city}, {customer.stateAbbr} {customer.zipcode}
                </Muted>
              )}
            </div>
            <div className={styles.docParty}>
              <Properties
                items={[
                  { label: translate('invoices.fields.number'), value: <Mono>{invoiceNumber(invoice.id)}</Mono> },
                  { label: translate('invoices.fields.date'), value: fmt.date(invoice.date) },
                  {
                    label: translate('invoices.fields.order'),
                    value: order ? (
                      <LinkBase to={`/orders/${order.id}`} className={styles.link}>
                        {order.reference}
                      </LinkBase>
                    ) : (
                      ''
                    ),
                  },
                ]}
              />
            </div>
          </div>
          <Divider spacing="md" />
          <Table aria-label={translate('invoices.lines')}>
            <TableHeader>
              <TableRow>
                <TableHead>{translate('orders.fields.product')}</TableHead>
                <TableHead numeric>{translate('orders.fields.unit_price')}</TableHead>
                <TableHead numeric>{translate('orders.fields.quantity')}</TableHead>
                <TableHead numeric>{translate('orders.fields.line_total')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(order?.basket ?? []).map((item) => {
                const p = products?.find((x) => x.id === item.product_id);
                return (
                  <TableRow key={item.product_id}>
                    <TableCell>{p?.reference ?? '…'}</TableCell>
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
                { label: translate('orders.fields.subtotal'), value: fmt.money(invoice.total_ex_taxes) },
                { label: translate('orders.fields.delivery'), value: fmt.money(invoice.delivery_fees) },
                { label: translate('orders.fields.taxes', { rate: fmt.percent(invoice.tax_rate) }), value: fmt.money(invoice.taxes) },
              ]}
            />
            <Divider spacing="sm" />
            <div className={styles.grandTotal}>
              <span>{translate('invoices.amount_due')}</span>
              <span>{fmt.money(invoice.total)}</span>
            </div>
          </div>
          <p className={styles.footnote}>{translate('invoices.footnote')}</p>
        </CardBody>
      </Card>
    </Page>
  );
}
