import { LinkBase, email, required, useGetList, useRecordContext, useTranslate } from 'ra-core';
import { Avatar, Card, CardBody, CardHeader, EmptyState, Skeleton } from '@demo-ds/react';
import { ShoppingBag } from 'lucide-react';
import { BooleanInput, DateInput, EditPage, FormSection, MultiChoiceInput, TextInput } from '../../ra-bridge';
import { Mono, Muted, OrderStatusBadge, Properties, Stars, fullName } from '../../ui';
import { useFormat } from '../../format';
import type { Customer, Order, Review } from '../../types';
import { SEGMENT_IDS } from '../shared/segments';
import styles from './customers.module.css';

export function CustomerEdit() {
  const translate = useTranslate();
  const fmt = useFormat();
  return (
    <EditPage<Customer>
      title={(c) => fullName(c)}
      subtitle={(c) => translate('customers.edit_subtitle', { date: fmt.date(c.first_seen), seen: fmt.relative(c.last_seen) })}
      breadcrumb={() => [{ label: translate('customers.title'), render: <LinkBase to="/customers" /> }, { label: translate('customers.edit_crumb') }]}
      media={(c) => <Avatar name={fullName(c)} src={c.avatar || undefined} size="lg" decorative />}
      aside={<CustomerAside />}
    >
      <Card>
        <CardBody>
          <FormSection title={translate('customers.identity')}>
            <TextInput source="first_name" label={translate('customers.fields.first_name')} validate={required()} autoComplete="off" />
            <TextInput source="last_name" label={translate('customers.fields.last_name')} validate={required()} autoComplete="off" />
            <TextInput source="email" type="email" label={translate('customers.fields.email')} validate={[required(), email()]} autoComplete="off" />
            <DateInput source="birthday" label={translate('customers.fields.birthday')} />
          </FormSection>
          <FormSection title={translate('customers.address')}>
            <div className={styles.span}>
              <TextInput source="address" label={translate('customers.fields.address')} />
            </div>
            <TextInput source="city" label={translate('customers.fields.city')} />
            <div className={styles.pair}>
              <TextInput source="stateAbbr" label={translate('customers.fields.state')} />
              <TextInput source="zipcode" label={translate('customers.fields.zipcode')} />
            </div>
          </FormSection>
          <FormSection title={translate('customers.marketing')} description={translate('customers.marketing_hint')}>
            <MultiChoiceInput
              source="groups"
              label={translate('customers.fields.segments')}
              placeholder={translate('customers.pick_segments')}
              choices={SEGMENT_IDS.map((id) => ({ id, name: translate(`segments.names.${id}`) }))}
            />
            <div className={styles.switchCell}>
              <BooleanInput source="has_newsletter" label={translate('customers.fields.newsletter')} hint={translate('customers.newsletter_hint')} />
            </div>
          </FormSection>
        </CardBody>
      </Card>
    </EditPage>
  );
}

function CustomerAside() {
  const translate = useTranslate();
  const fmt = useFormat();
  const customer = useRecordContext<Customer>();
  const { data: orders, isPending } = useGetList<Order>(
    'orders',
    { filter: { customer_id: customer?.id }, sort: { field: 'date', order: 'DESC' }, pagination: { page: 1, perPage: 5 } },
    { enabled: customer != null },
  );
  const { data: reviews, total: reviewTotal } = useGetList<Review>(
    'reviews',
    { filter: { customer_id: customer?.id }, sort: { field: 'date', order: 'DESC' }, pagination: { page: 1, perPage: 3 } },
    { enabled: customer != null },
  );
  if (!customer) return null;
  return (
    <>
      <Card>
        <CardHeader>{translate('customers.summary')}</CardHeader>
        <CardBody>
          <Properties
            items={[
              { label: translate('customers.fields.orders'), value: fmt.number(customer.nb_orders) },
              { label: translate('customers.fields.total_spent'), value: fmt.money(customer.total_spent) },
              { label: translate('customers.fields.latest_purchase'), value: customer.latest_purchase ? fmt.date(customer.latest_purchase) : translate('customers.never') },
              { label: translate('customers.fields.reviews'), value: fmt.number(reviewTotal ?? 0) },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader>{translate('customers.recent_orders')}</CardHeader>
        <CardBody>
          {isPending ? (
            <Skeleton lines={3} />
          ) : (orders ?? []).length === 0 ? (
            <EmptyState size="sm" icon={ShoppingBag} title={translate('customers.no_orders')} />
          ) : (
            <ul className={styles.timeline}>
              {(orders ?? []).map((o) => (
                <li key={o.id}>
                  <LinkBase to={`/orders/${o.id}`} className={styles.timelineRow}>
                    <span className={styles.timelineMain}>
                      <Mono>{o.reference}</Mono>
                      <Muted>{fmt.date(o.date)}</Muted>
                    </span>
                    <span className={styles.timelineEnd}>
                      <span className={styles.amount}>{fmt.money(o.total)}</span>
                      <OrderStatusBadge status={o.status} />
                    </span>
                  </LinkBase>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {(reviews ?? []).length > 0 && (
        <Card>
          <CardHeader>{translate('customers.recent_reviews')}</CardHeader>
          <CardBody>
            <ul className={styles.timeline}>
              {(reviews ?? []).map((r) => (
                <li key={r.id}>
                  <LinkBase to={`/reviews/${r.id}`} className={styles.review}>
                    <Stars value={r.rating} />
                    <span className={styles.reviewText}>{r.comment}</span>
                  </LinkBase>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}
