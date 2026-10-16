// Story-only placeholder blocks for the layout utilities.
import type { ReactNode } from 'react';

const box = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--size-12)',
  padding: '0 var(--space-3)',
  border: 'var(--border-width-1) solid var(--color-border-default)',
  borderRadius: 'var(--radius-inset)',
  backgroundColor: 'var(--color-surface-default)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-size-100)',
  fontVariantNumeric: 'tabular-nums',
} as const;

export function DemoBox({ children, tall = false }: { children?: ReactNode; tall?: boolean }) {
  return <div style={{ ...box, minHeight: tall ? 'var(--size-20)' : box.minHeight }}>{children}</div>;
}
