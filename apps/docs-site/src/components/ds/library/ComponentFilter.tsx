// The search and family filter of a Library's Components page (views/ComponentsView.tsx): DS Input and Select over
// the cards already in the page. It hides cards through their data attributes (data-cname, data-cfamily,
// data-csummary) and a family with no card left, and says how many show. A hydrated island on Bridge's own page, a
// plain component on a team's Library.
import { useEffect, useState } from 'react';
import { Button, Input, Select } from '@bridge-ds/react';

/** The family menu's "every family" choice (an empty value reads as no choice in the DS Select). */
const ALL = '__all__';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Whether a card matches a search (name, family, summary) and a family ('' is every family). */
export function cardMatches(card: { name: string; family: string; summary: string }, query: string, family: string): boolean {
  const q = query.trim().toLowerCase();
  return (!family || card.family === family) && (!q || card.name.toLowerCase().includes(q) || card.family.toLowerCase().includes(q) || card.summary.toLowerCase().includes(q));
}

export default function ComponentFilter({ families }: { families: { name: string; n: number }[] }) {
  const total = families.reduce((n, f) => n + f.n, 0);
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState('');
  const [shown, setShown] = useState(total);

  useEffect(() => {
    let n = 0;
    for (const li of document.querySelectorAll<HTMLElement>('[data-ccard]')) {
      const on = cardMatches({ name: li.dataset.cname ?? '', family: li.dataset.cfamily ?? '', summary: li.dataset.csummary ?? '' }, query, family);
      li.hidden = !on;
      if (on) n++;
    }
    for (const fam of document.querySelectorAll<HTMLElement>('[data-cfam]')) fam.hidden = !fam.querySelector('[data-ccard]:not([hidden])');
    setShown(n);
  }, [query, family]);

  return (
    <div className="cp-filter">
      <div className="tcm-tools" role="search">
        <Input label="Search components" hideLabel placeholder="Search by name, family or summary" value={query} onValueChange={setQuery} />
        <Select
          label="Family"
          hideLabel
          value={family || ALL}
          onValueChange={(v) => setFamily(!v || v === ALL ? '' : v)}
          options={[{ value: ALL, label: `All families (${total})` }, ...families.map((f) => ({ value: f.name, label: `${f.name} (${f.n})` }))]}
        />
      </div>
      <p className="cp-filter-status" role="status" aria-live="polite">
        {shown === total ? `Showing all ${plural(total, 'component')}.` : shown === 0 ? 'No component matches. ' : `Showing ${shown} of ${total}.`}
        {shown === 0 && (
          <Button
            variant="link"
            onClick={() => {
              setQuery('');
              setFamily('');
            }}
          >
            Show every component
          </Button>
        )}
      </p>
    </div>
  );
}
