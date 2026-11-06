// The quieter row under the tabs of a list (Changes, Being built): two small DS Selects, the product (All products,
// then each product) and the person (Everyone, You, then each person by name), then the count of what is listed and
// Clear filters. The rules are lib/branches-page (activeFilters, filterChoices, inFilters), the address ?product= and
// ?people=; each page says what its rows are and keeps the filters with its own tabs.
import { Badge, Button, Select } from '@bridge-ds/react';
import { ALL_PRODUCTS, type filterChoices, type ListFilters } from '../../../lib/branches-page';
import { EVERYONE } from '../../../lib/review-categories';
import '../../../styles/list-filters.css';

/** The empty line when the filters leave nothing, before Clear filters. */
export const NO_FILTER_MATCH = 'Nothing here matches these filters.';

export function ClearFilters({ onPick }: { onPick: (f: ListFilters) => void }) {
  return (
    <Button variant="link" onClick={() => onPick({ product: null, by: null })}>
      Clear filters
    </Button>
  );
}

const count = (n: number) => (
  <Badge tone="neutral" size="sm">
    {n}
  </Badge>
);

export interface ListFiltersBarProps {
  active: ListFilters;
  choices: ReturnType<typeof filterChoices>;
  onPick: (f: ListFilters) => void;
  /** The count of what is listed ("3 changes."). */
  summary: string;
  /** Offer Clear filters after the count; with nothing left, the empty line under the bar offers it instead. */
  clear: boolean;
}

export function ListFiltersBar({ active, choices, onPick, summary, clear }: ListFiltersBarProps) {
  return (
    <div className="bl-bar">
      <span className="bl-narrow">
        <Select
          label="Product"
          hideLabel
          size="sm"
          value={active.product ?? ALL_PRODUCTS}
          onValueChange={(v) => onPick({ ...active, product: !v || v === ALL_PRODUCTS ? null : v })}
          options={choices.products.map((o) => ({ value: o.value, label: o.label, badge: count(o.count) }))}
        />
        <Select
          label="People"
          hideLabel
          size="sm"
          value={active.by ?? EVERYONE}
          onValueChange={(v) => onPick({ ...active, by: !v || v === EVERYONE ? null : v })}
          options={choices.people.map((d) => ({ value: d.value, label: d.label, badge: count(d.count), disabled: d.count === 0 && d.value !== (active.by ?? EVERYONE) }))}
        />
      </span>
      <p className="t-ui t-muted bl-summary" aria-live="polite">
        {summary}
        {clear && (
          <>
            {' '}
            <ClearFilters onPick={onPick} />
          </>
        )}
      </p>
    </div>
  );
}
