import { useEffect, useRef, useState } from 'react';
import { useCreatePath, useDataProvider, useNavigate, useTranslate } from 'ra-core';
import { Combobox, Icon, type ComboboxOption } from '@demo-ds/react';
import { Search } from 'lucide-react';
import type { Customer, Order, Product } from '../types';
import styles from './AppShell.module.css';

/** Searches customers, orders and products as you type, and opens the picked record. */
export function GlobalSearch() {
  const translate = useTranslate();
  const dataProvider = useDataProvider();
  const navigate = useNavigate();
  const createPath = useCreatePath();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const [loading, setLoading] = useState(false);
  const narrow = useNarrow();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const page = { page: 1, perPage: 4 };
      const sort = { field: 'id', order: 'ASC' as const };
      const [customers, orders, products] = await Promise.all([
        dataProvider.getList<Customer>('customers', { filter: { q }, pagination: page, sort }),
        dataProvider.getList<Order>('orders', { filter: { q }, pagination: page, sort }),
        dataProvider.getList<Product>('products', { filter: { q }, pagination: page, sort }),
      ]);
      if (cancelled) return;
      const group = (key: string) => translate(key);
      setOptions([
        ...customers.data.map((c) => ({ value: `customers:${c.id}`, label: `${c.first_name} ${c.last_name}`, description: c.email, group: group('nav.customers') })),
        ...orders.data.map((o) => ({ value: `orders:${o.id}`, label: o.reference, description: new Date(o.date).toLocaleDateString(), group: group('nav.orders') })),
        ...products.data.map((p) => ({ value: `products:${p.id}`, label: p.reference, description: `${p.width} x ${p.height} cm`, group: group('nav.products') })),
      ]);
      setLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, dataProvider, translate]);

  return (
    <Combobox
      ref={inputRef}
      label={translate('shell.search')}
      hideLabel
      size="sm"
      placeholder={translate(narrow ? 'shell.search' : 'shell.search_placeholder')}
      prefix={<Icon icon={Search} size="sm" />}
      options={options}
      filter={null}
      loading={loading}
      emptyMessage={query.trim().length < 2 ? translate('shell.search_hint') : translate('shell.search_empty')}
      inputValue={query}
      onInputValueChange={setQuery}
      value={null}
      onValueChange={(v) => {
        const one = Array.isArray(v) ? v[0] : v;
        if (!one) return;
        const [resource, id] = one.split(':');
        if (!resource || !id) return;
        setQuery('');
        navigate(createPath({ resource, id, type: 'edit' }));
      }}
      className={styles.searchBox}
      aria-keyshortcuts="Meta+K Control+K"
    />
  );
}

function useNarrow() {
  const query = '(max-width: 640px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}
