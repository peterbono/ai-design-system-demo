import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { addDays, format } from 'date-fns';
import { useTranslate } from 'ra-core';
import { useFormat } from '../../format';
import type { Order } from '../../types';
import styles from './Dashboard.module.css';

/**
 * Daily revenue over 30 days. Colors come from semantic tokens through CSS variables: Bridge has no
 * data-visualization tokens yet (DS-GAPS.md), so the series uses the primary action color.
 */
export default function RevenueChart({ orders, since }: { orders: Order[]; since: Date }) {
  const fmt = useFormat();
  const translate = useTranslate();
  const data = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      const key = format(new Date(o.date), 'yyyy-MM-dd');
      byDay.set(key, (byDay.get(key) ?? 0) + o.total);
    }
    return Array.from({ length: 31 }, (_, i) => {
      const day = addDays(since, i);
      const key = format(day, 'yyyy-MM-dd');
      return { day: day.getTime(), revenue: Math.round((byDay.get(key) ?? 0) * 100) / 100 };
    });
  }, [orders, since]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-action-primary-bg)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--color-action-primary-bg)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--color-border-subtle)" />
        <XAxis
          dataKey="day"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(v: number) => fmt.day(v)}
          tick={{ fill: 'var(--color-text-muted)', fontSize: 'var(--font-size-100)' }}
          axisLine={{ stroke: 'var(--color-border-default)' }}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v: number) => fmt.compactMoney(v)}
          tick={{ fill: 'var(--color-text-muted)', fontSize: 'var(--font-size-100)' }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip
          cursor={{ stroke: 'var(--color-border-strong)' }}
          content={(props: TooltipContentProps) => {
            const point = props.payload?.[0];
            if (!props.active || !point) return null;
            return (
              <div className={styles.tooltip}>
                <span className={styles.tooltipLabel}>{fmt.date(Number(props.label))}</span>
                <span className={styles.tooltipValue}>
                  {translate('dashboard.revenue_short')}: {fmt.money(Number(point.value))}
                </span>
              </div>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          name={translate('dashboard.revenue_short')}
          stroke="var(--color-action-primary-bg)"
          strokeWidth={2}
          fill="url(#revenueFill)"
          activeDot={{ r: 4, stroke: 'var(--color-surface-default)', strokeWidth: 2, fill: 'var(--color-action-primary-bg)' }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
