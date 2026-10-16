import { useMemo } from 'react';
import { usePreferences } from './preferences';

const LOCALE_TAG = { en: 'en-US', fr: 'fr-FR' } as const;

/** Number, money and date formatters for the active tenant currency and UI language. */
export function useFormat() {
  const { tenant, locale } = usePreferences();
  return useMemo(() => {
    const tag = LOCALE_TAG[locale];
    const money = new Intl.NumberFormat(tag, { style: 'currency', currency: tenant.currency });
    const money0 = new Intl.NumberFormat(tag, { style: 'currency', currency: tenant.currency, maximumFractionDigits: 0 });
    const compactMoney = new Intl.NumberFormat(tag, { style: 'currency', currency: tenant.currency, notation: 'compact', maximumFractionDigits: 1 });
    const number = new Intl.NumberFormat(tag);
    const percent = new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 1 });
    const date = new Intl.DateTimeFormat(tag, { year: 'numeric', month: 'short', day: 'numeric' });
    const dateTime = new Intl.DateTimeFormat(tag, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const day = new Intl.DateTimeFormat(tag, { month: 'short', day: 'numeric' });
    const rel = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
    const toDate = (v: string | number | Date) => (v instanceof Date ? v : new Date(v));
    return {
      tag,
      currency: tenant.currency,
      money: (n: number) => money.format(n),
      money0: (n: number) => money0.format(n),
      compactMoney: (n: number) => compactMoney.format(n),
      number: (n: number) => number.format(n),
      percent: (n: number) => percent.format(n),
      date: (v: string | number | Date) => date.format(toDate(v)),
      dateTime: (v: string | number | Date) => dateTime.format(toDate(v)),
      day: (v: string | number | Date) => day.format(toDate(v)),
      relative: (v: string | number | Date) => {
        const days = Math.round((toDate(v).getTime() - Date.now()) / 86_400_000);
        if (Math.abs(days) < 1) {
          const hours = Math.round((toDate(v).getTime() - Date.now()) / 3_600_000);
          return rel.format(hours, 'hour');
        }
        if (Math.abs(days) < 30) return rel.format(days, 'day');
        return rel.format(Math.round(days / 30), 'month');
      },
    };
  }, [tenant.currency, locale]);
}
