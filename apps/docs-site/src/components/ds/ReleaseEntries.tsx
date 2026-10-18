// Changelog rows of one release. A hydrated island (client:visible) for the DS disclosures: the first changes show,
// the rest and the internal ones fold into DS Accordions, and a long package list opens in a DS Popover.
// Row: kind Badge on the left; the title at full width with its one-line description and a small meta line under it.
import { Accordion, AccordionItem, Badge, Button, Popover, PopoverContent, PopoverTrigger, Tag, type BadgeTone } from '@bridge-ds/react';
import { Check, ChevronDown, FileText, Plus, SlidersHorizontal, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
import { packagesLabel } from '../../lib/changelog-model';

// Badge has no accent tone: Improvement reads as neutral, its icon and text carry the meaning.
export const KINDS: { kind: string; tone: BadgeTone; icon: LucideIcon; meaning: string }[] = [
  { kind: 'Breaking', tone: 'danger', icon: TriangleAlert, meaning: 'needs action before you update' },
  { kind: 'New', tone: 'info', icon: Plus, meaning: 'adds an option, nothing breaks' },
  { kind: 'Fix', tone: 'success', icon: Check, meaning: 'matches the spec again' },
  { kind: 'Improvement', tone: 'neutral', icon: SlidersHorizontal, meaning: 'faster or smoother, same API' },
  { kind: 'Docs', tone: 'neutral', icon: FileText, meaning: 'guidance only' },
  { kind: 'Internal', tone: 'neutral', icon: Wrench, meaning: 'changes nothing you see' },
];
export const kindOf = (k: string) => KINDS.find((x) => x.kind === k) ?? KINDS[KINDS.length - 1]!;

export interface EntryRow {
  kind: string;
  /** Title as safe HTML (mdTitleHtml: escaped text and inline code). */
  titleHtml: string;
  /** One-line description as safe HTML, may be empty. */
  descriptionHtml: string;
  /** "minor", "patch", "major", or null. */
  bump: string | null;
  /** Short package names: "react", "core". */
  packages: string[];
}

export interface ReleaseEntriesProps {
  entries: EntryRow[];
  /** Changes shown before "Show N more". */
  visible?: number;
  /** Package lists longer than this show as "N packages". */
  maxTags?: number;
}

function Packages({ packages, max }: { packages: string[]; max: number }) {
  const { tags, count } = packagesLabel(packages, max);
  if (!count)
    return (
      <span className="cl-tags">
        {tags.map((p) => (
          <Tag key={p} size="sm">
            {p}
          </Tag>
        ))}
      </span>
    );
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" iconEnd={ChevronDown} />}>{count}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" arrow={false} title="Packages in this change">
        <span className="cl-tags">
          {tags.map((p) => (
            <Tag key={p} size="sm">
              {p}
            </Tag>
          ))}
        </span>
      </PopoverContent>
    </Popover>
  );
}

function Row({ e, maxTags }: { e: EntryRow; maxTags: number }) {
  const k = kindOf(e.kind);
  return (
    <li className="cl-row">
      <Badge tone={k.tone} icon={k.icon}>
        {e.kind}
      </Badge>
      <div className="cl-main">
        <p className="cl-title" dangerouslySetInnerHTML={{ __html: e.titleHtml }} />
        {e.descriptionHtml && <p className="cl-desc" dangerouslySetInnerHTML={{ __html: e.descriptionHtml }} />}
        {(e.bump || e.packages.length > 0) && (
          <div className="cl-meta">
            {e.bump && <span>{e.bump}</span>}
            {e.packages.length > 0 && <Packages packages={e.packages} max={maxTags} />}
          </div>
        )}
      </div>
    </li>
  );
}

export default function ReleaseEntries({ entries, visible = 5, maxTags = 3 }: ReleaseEntriesProps) {
  const shown = entries.filter((e) => e.kind !== 'Internal');
  const internal = entries.filter((e) => e.kind === 'Internal');
  // Folding one or two rows saves nothing: show them.
  const cut = shown.length - visible <= 2 ? shown.length : visible;
  const first = shown.slice(0, cut);
  const more = shown.slice(cut);
  const list = (rows: EntryRow[]) => (
    <ul className="cl-entries">
      {rows.map((e, i) => (
        <Row key={i} e={e} maxTags={maxTags} />
      ))}
    </ul>
  );
  return (
    <div className="cl-list">
      {first.length > 0 && list(first)}
      {(more.length > 0 || internal.length > 0) && (
        <Accordion appearance="flush" headingLevel={3} multiple className="cl-folds">
          {more.length > 0 && (
            <AccordionItem value="more" title={`Show ${more.length} more ${more.length === 1 ? 'change' : 'changes'}`}>
              {list(more)}
            </AccordionItem>
          )}
          {internal.length > 0 && (
            <AccordionItem value="internal" title={`${internal.length} internal ${internal.length === 1 ? 'change' : 'changes'}`} meta="Nothing you see changes">
              {list(internal)}
            </AccordionItem>
          )}
        </Accordion>
      )}
    </div>
  );
}
