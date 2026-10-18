// The status filter of Changes > In review on a phone: the same choices as the SegmentedControl (lib/change-status
// STATUS_FILTERS) in one DS Select, because six segments do not fit 390 px. It reads and announces the same filter:
// scripts/status-filter.ts listens for STATUS_FILTER_EVENT and sends STATUS_SYNC_EVENT back.
import { useEffect, useState } from 'react';
import { Select } from '@bridge-ds/react';
import { STATUS_FILTER_EVENT, STATUS_FILTERS, STATUS_SYNC_EVENT, statusFilterParam, type StatusFilter } from '../../../lib/change-status';

export default function StatusFilterSelect() {
  // Rendered on the server as Open, then the address decides (no hydration mismatch).
  const [value, setValue] = useState<StatusFilter>('open');
  useEffect(() => {
    setValue(statusFilterParam(location.search));
    const sync = (e: Event) => setValue((e as CustomEvent<StatusFilter>).detail);
    document.addEventListener(STATUS_SYNC_EVENT, sync);
    return () => document.removeEventListener(STATUS_SYNC_EVENT, sync);
  }, []);
  return (
    <Select
      label="Status"
      hideLabel
      options={STATUS_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
      value={value}
      onValueChange={(v) => {
        const next = statusFilterParam(`?status=${v ?? 'open'}`);
        setValue(next);
        document.dispatchEvent(new CustomEvent(STATUS_FILTER_EVENT, { detail: next }));
      }}
    />
  );
}
