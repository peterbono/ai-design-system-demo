import { useTranslate } from 'ra-core';
import { Badge } from '@bridge-ds/react';

/** Warning status for an order that has waited too long to ship. The text says it, the tone backs it up. */
export function LateBadge() {
  const translate = useTranslate();
  return (
    <Badge tone="warning" size="sm" data-bridge-change="Late order badge">
      {translate('orders.late')}
    </Badge>
  );
}
