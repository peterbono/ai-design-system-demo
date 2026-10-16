import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useListContext, useTranslate } from 'ra-core';
import { Icon, IconButton, Input, Select, type SelectOption } from '@demo-ds/react';
import { Search, X } from 'lucide-react';
import styles from './list.module.css';

/** Row of list filters, wraps on narrow screens. */
export function FilterBar({ children }: { children: ReactNode }) {
  const translate = useTranslate();
  return (
    <div className={styles.filters} role="search" aria-label={translate('bridge.filters.label', { _: 'Filters' })}>
      {children}
    </div>
  );
}

function useFilter(source: string) {
  const { filterValues, setFilters, displayedFilters } = useListContext();
  const value = (filterValues as Record<string, unknown>)[source];
  const set = (next: unknown, debounce = false) => {
    const values = { ...filterValues } as Record<string, unknown>;
    if (next === undefined || next === null || next === '') delete values[source];
    else values[source] = next;
    setFilters(values, displayedFilters, debounce);
  };
  return [value, set] as const;
}

/** Full-text search bound to the `q` filter, debounced. */
export function SearchFilter({ source = 'q', label, placeholder }: { source?: string; label?: string; placeholder?: string }) {
  const translate = useTranslate();
  const [value, set] = useFilter(source);
  const [text, setText] = useState(typeof value === 'string' ? value : '');
  const external = typeof value === 'string' ? value : '';
  const last = useRef(external);
  useEffect(() => {
    // Sync when the filter changes elsewhere (clear filters, back navigation).
    if (external !== last.current) {
      last.current = external;
      setText(external);
    }
  }, [external]);
  const name = label ?? translate('bridge.filters.search', { _: 'Search' });
  return (
    <div className={styles.filterSearch}>
      <Input
        label={name}
        hideLabel
        type="search"
        placeholder={placeholder ?? name}
        value={text}
        prefix={<Icon icon={Search} size="sm" />}
        suffix={
          text ? (
            <IconButton
              icon={X}
              size="sm"
              variant="ghost"
              label={translate('bridge.filters.clear_search', { _: 'Clear search' })}
              onClick={() => {
                setText('');
                last.current = '';
                set('');
              }}
            />
          ) : undefined
        }
        onValueChange={(v) => {
          setText(v);
          last.current = v;
          set(v, true);
        }}
      />
    </div>
  );
}

/** Single-choice filter. The first option clears the filter. */
export function SelectFilter({ source, label, options, allLabel }: { source: string; label: string; options: SelectOption[]; allLabel?: string }) {
  const translate = useTranslate();
  const [value, set] = useFilter(source);
  const all = allLabel ?? translate('bridge.filters.all', { _: 'All' });
  return (
    <div className={styles.filterItem}>
      <Select
        label={label}
        hideLabel
        size="md"
        value={value == null ? '__all' : String(value)}
        options={[{ value: '__all', label: `${label}: ${all.toLowerCase()}` }, ...options.map((o) => ({ ...o, label: `${label}: ${o.label}` }))]}
        onValueChange={(v) => set(v === '__all' ? undefined : coerce(v, options))}
      />
    </div>
  );
}

function coerce(v: string | null, options: SelectOption[]): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return options.find((o) => o.value === v)?.value ?? v;
}

/** Date bound filter (for example `date_gte`). Stores an ISO date string. */
export function DateFilter({ source, label }: { source: string; label: string }) {
  const [value, set] = useFilter(source);
  const current = typeof value === 'string' ? value.slice(0, 10) : '';
  return (
    <div className={styles.filterDate}>
      <Input
        label={label}
        hideLabel
        type="date"
        value={current}
        aria-label={label}
        prefix={<span>{label}</span>}
        onValueChange={(v) => set(v ? v + (source.endsWith('_lte') ? 'T23:59:59' : 'T00:00:00') : '')}
      />
    </div>
  );
}
