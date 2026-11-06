// A listed change as a card, for the grid view of Changes and Being built: the same card as the Home's explorations
// (ExplorationCards, styles sh-card-*), fed by what a row already knows. The screen on top, the title, then the fixed
// footer: its one status tag, then who it belongs to and, when the list does not group by product, the product.
// The grid itself is the Home's grid (ul.sh-cards), so a card is the same size everywhere in Studio.
// The switch between the two views sits in each list's filter bar (ViewSwitch).
import { Badge, Card, Link, SegmentedControl } from '@bridge-ds/react';
import { LayoutGrid, List } from 'lucide-react';
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { Who } from './faces';
import { BranchThumb } from './BranchThumb';
import type { ThumbSpec } from '../../../lib/branch-thumb';
import { SEP, type Person, type PillTone } from '../../../lib/home-model';
import { LIST_VIEW_EVENT, LIST_VIEW_WORDS, readListView, rememberListView, type ListView, type ListViewChange } from '../../../lib/list-view';

/**
 * The view a page is read in: List until this person picks the grid. Read after the first paint (the server renders
 * the rows), then kept in step with every other list on the page, which may be painted in its own React root.
 */
export function useListView(page: string): [ListView, (v: ListView) => void] {
  const [view, setView] = useState<ListView>('list');
  useEffect(() => {
    setView(readListView(page));
    const told = (e: Event) => {
      const d = (e as CustomEvent<ListViewChange>).detail;
      if (d?.page === page) setView(d.view);
    };
    document.addEventListener(LIST_VIEW_EVENT, told);
    return () => document.removeEventListener(LIST_VIEW_EVENT, told);
  }, [page]);
  return [view, (v: ListView) => rememberListView(page, v)];
}

const TONE = { warning: 'warning', danger: 'danger', success: 'success', neutral: 'neutral', info: 'info' } as const;

export interface ListCardProps {
  thumb: ThumbSpec;
  title: string;
  href: string;
  /** Extra attributes on the title link (data-open-pr, data-open-exploration: the review opens in place). */
  linkAttributes?: Record<string, string | number | undefined>;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** Whose it is: the face and the name in the footer. */
  person: Person;
  /** After the name, when the group heading does not already say it: "Account app". */
  product?: string | null;
  pill?: { label: string; tone: PillTone | 'info' } | null;
  /** A chip before the tag ("Exploration", "Sample"). */
  tags?: ReactNode;
}

export function ListCard({ thumb, title, href, linkAttributes, onClick, person, product, pill, tags }: ListCardProps) {
  return (
    <li className="sh-card-item">
      <Card interactive padding="none" className="sh-card">
        <BranchThumb spec={thumb} size="card" />
        <div className="sh-card-body">
          <span className="sh-card-head">
            <Link href={href} variant="subtle" className="t-body sh-card-title" title={title} data-card-primary onClick={onClick} {...linkAttributes}>
              <span className="sh-strong">{title}</span>
            </Link>
          </span>
          <span className="sh-card-foot">
            <span className="sh-card-tagline">
              {tags}
              {pill && (
                <Badge tone={TONE[pill.tone]} size="sm" className="sh-card-tag">
                  {pill.label}
                </Badge>
              )}
            </span>
            <span className="t-ui sh-card-who">
              <Who p={person} size="xs" />
              <span className="sh-card-name">
                {person.name}
                {product ? (
                  <span className="sh-card-product">
                    {SEP}
                    {product}
                  </span>
                ) : null}
              </span>
            </span>
          </span>
        </div>
      </Card>
    </li>
  );
}

/** The switch at the end of a list's filter bar: rows, or cards. */
export function ViewSwitch({ view, onPick }: { view: ListView; onPick: (v: ListView) => void }) {
  return (
    <SegmentedControl
      className="bl-view"
      size="sm"
      label={LIST_VIEW_WORDS.label}
      value={view}
      onValueChange={(v) => onPick(v === 'grid' ? 'grid' : 'list')}
      items={[
        { value: 'list', label: LIST_VIEW_WORDS.list, icon: List },
        { value: 'grid', label: LIST_VIEW_WORDS.grid, icon: LayoutGrid },
      ]}
    />
  );
}
