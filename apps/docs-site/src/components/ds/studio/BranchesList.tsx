// Branches (/studio/changes/): all the work, not a second triage page (triage lives on Home and the review queue).
//   - DS Tabs (underline) say where the work stands: All (the default), Waiting on me, then each state in the words
//     of its tag (Not started, Exploring, Draft, In review, Waiting for code), Shipped, and Archived last, each with its count
//     (lib/branches-page STATE_TABS, stateOf; ?state=). All and Waiting on me always show, the other tabs only while
//     they hold something. On a phone the control scrolls sideways inside its row, never the page.
//   - Two DS Selects narrow every tab: the kind of change (?kind=) and whose it is (?people=: Everyone, You, then each
//     designer by display name). Old ?who=mine, ?view=mine, ?who=waiting, ?by=, ?archived=1 and ?status= links keep
//     working (lib/branches-page changesFiltersParam).
//   - The open branches, explorations included, grouped by the product they belong to (lib/branches-page productOf,
//     bridge.config.json products), each group a heading with its count. Rows are the home row (BranchRow), the
//     person always by display name (lib/branches-page knownNames), the login only when no name is known.
//   - Token branches carry a checkbox to preview them together; the floating bar (CombineChanges SelectionBar) acts.
//   - Shipped (?state=shipped; the old ?status=merged and History addresses land there) is the history of the work:
//     every change and exploration that shipped, newest first, grouped by month ("October 2026"), each row with its
//     preview capture when there is one, the product, the person and "Shipped Oct 30" (lib/branches-page groupByMonth).
//     The library's token changelog is in the Library (Changelog), the next release on Being built.
//   - Waiting on me (what "Review all" opens on the demo) is the lead's review list: one summary sentence, every change
//     that waits (branches, suggestions, usage guidance drafts) under three kinds (lib/review-categories: In a product,
//     Library components and tokens, Documentation). The designer is who asked for the change (the requester line),
//     Claude AI's work included.
// Mounted and repainted by scripts/reviews.ts (loadList), which reads GitHub; this file only enriches what is shown
// (display names, before/after thumbnails and changed files, with a working token only: anonymous visitors have 60
// GitHub reads an hour, kept for the statuses). The exception is the visitor in the demo lead's seat: the demo's
// activity snapshot answers the before/after and the files, so a change looks the same here as on the demo home.
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Checkbox, Link, Select, Skeleton, Tab, Tabs, TabsList, Tooltip, VisuallyHidden } from '@bridge-ds/react';
import { BranchRow } from './BranchRow';
import { Who } from './faces';
import { SelectionBar, type ListedBranch } from './CombineChanges';
import { ARCHIVED_NOTE, boxDisabled, changesFiltersParam, emptyTabLine, FULL_TIP, groupByMonth, groupByProduct, isYours, knownNames, peopleOptions, productOf, selectable, shippedCapLine, shippedOn, shippedRows, stateOf, visibleTabs, withChangesFilters, YOU, type ChangesFilters, type StateTab } from '../../../lib/branches-page';
import { onlyTokens, toggleChange } from '../../../lib/combine-changes';
import { childLine, nestLinked } from '../../../lib/product-branch';
import { CLAUDE, displayName, person, requesterPerson, SEP, type Person, type PillTone } from '../../../lib/home-model';
import {
  categoryOf,
  designerKey,
  designerOptions,
  groupByCategory,
  kindOptions,
  passes,
  queueSummary,
  reachLine,
  type KindFilter,
  EVERYONE,
  type WaitingExtra,
} from '../../../lib/review-categories';
import { DEFAULT_PRODUCTS } from '@bridge-ds/core';
import type { ThumbSpec } from '../../../lib/branch-thumb';
import type { FileSignals } from '../../../lib/work-nature';
import type { Lifecycle } from '../../../lib/change-status';
import { VOCAB } from '../../../lib/vocabulary';
import type { ProductConfig } from '@bridge-ds/core';
import { studioHref } from '../../../lib/team-path';

export interface ListRow {
  number: number;
  /** The human title, without its Jira key. */
  title: string;
  jira: string | null;
  author: string;
  /** Claude made it: Claude's identity on the row. */
  agent: boolean;
  /** `pr`: the branch review in place (?pr=N); `exploration`: the exploration in place (?exploration=N). */
  opens: 'pr' | 'exploration';
  /** An exploration: when it last moved ("2 h ago"), after who on line 2. */
  ago?: string | null;
  pill: { label: string; tone: PillTone | 'info' } | null;
  lifecycle: Lifecycle | 'exploration';
  yourTurn: boolean;
  /** The viewer made it, when the author does not say so (an email contributor's own: lib/branches-page ownedBy). */
  mine?: boolean;
  behindBy: number | null;
  /** What the status read says about the changed files (anonymous fallback for the checkbox). */
  signals: FileSignals | null;
  guidance: boolean;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string } | null;
  merged_at?: string | null;
  /** Pull request labels: a `product: <key>` label puts the branch in that product's group. */
  labels?: { name: string }[] | null;
  /** The product branch this library branch is needed by (its "Needed by" block): listed under it. */
  neededBy?: number | null;
  /** The product key of that product branch when it lives in the product's own repository ("Needed by" owner/name#12). */
  neededByProduct?: string | null;
  /**
   * Set for an exploration in a product's own repository (bridge.config.json products[].repo): the product key. The
   * row sits in that product's group and opens ?exploration=N&product=<key>; its number is the product's own.
   */
  product?: string | null;
  /** Who asked for it, as Bridge records it in the body ("Requested by Ann Leroy."): the designer of the change. */
  requester?: { name: string | null; login: string | null } | null;
}

export interface BranchesListProps {
  /** Open branches and running explorations, most urgent first. */
  rows: ListRow[];
  /** The most recently closed branches (merged or not), null until read: the merged ones fill the Shipped tab. */
  closed: ListRow[] | null;
  /** Archived explorations (open pull requests, previews alive): listed only under the Archived tab (?state=archived). */
  archived?: ListRow[];
  closedLimit: number;
  loading: boolean;
  viewer: string | null;
  /** The viewer's profile name, when they set one: their rows read with it even where only the login is recorded. */
  viewerName?: string | null;
  /** A working GitHub token: names, thumbnails and files are read. */
  connected: boolean;
  admin: string | null;
  tokensRoot: string;
  /** bridge.config.json products, in group order (lib/config). Absent: the default products. */
  products?: ProductConfig[];
  /** ?tier= keeps working: the one kind of change shown, in words, or null. */
  tierLabel: string | null;
  failure: (err: unknown) => string;
  /** Asks scripts/reviews.ts for the closed list (when Shipped opens before it was read). */
  readClosed: () => void;
  /**
   * The demo persona whose seat a visitor without an account takes ("Dana", lib/demo.ts): Waiting on me then lists
   * what waits on them. Null everywhere else.
   */
  seat?: string | null;
  /** What waits on the viewer besides branches: suggestions and usage guidance drafts (Waiting on me only). */
  waiting?: WaitingExtra[];
}

const avatarOf = (login: string) => `https://github.com/${encodeURIComponent(login)}.png?size=64`;

/** Enrichment read once per branch version, shared by every paint. */
interface Extra {
  thumb?: ThumbSpec;
  files?: string[] | null;
}

/**
 * `read`: 'all' with a working token; 'seat' for the visitor in the demo lead's seat, whose reads the demo's activity
 * snapshot answers (the before/after and the files, as on the demo home; no profile reads); 'none' otherwise. The
 * profiles (display names) are read once per login, the author's and the requester's, products' own rows included.
 */
function useExtras(rows: ListRow[], read: 'all' | 'seat' | 'none'): { extras: Map<number, Extra>; people: Map<string, Person> } {
  const [extras, setExtras] = useState<Map<number, Extra>>(new Map());
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const key = rows.map((r) => `${r.number}@${r.head.sha}`).join(',');
  useEffect(() => {
    if (read === 'none' || !rows.length) return;
    let live = true;
    const put = (n: number, e: Extra) => live && setExtras((m) => new Map(m).set(n, { ...m.get(n), ...e }));
    const putPerson = (p: Person) => live && setPeople((m) => new Map(m).set(p.login.toLowerCase(), p));
    void import('../../../scripts/home-data').then(({ personOf, thumbOf, filesOf }) => {
      const logins = new Set<string>();
      for (const r of rows) {
        if (read === 'all') {
          if (!r.agent) logins.add(r.author);
          if (r.requester?.login) logins.add(r.requester.login);
        }
        // An exploration in a product's own repository: its files and screens are not in this repository.
        if (r.product) continue;
        void filesOf(r.number, r.head.sha).then((files) => put(r.number, { files }));
        if (r.base) void thumbOf({ number: r.number, head: r.head, base: r.base }, r.guidance).then((thumb) => put(r.number, { thumb }));
      }
      for (const l of logins) if (!l.includes('[bot]') && !l.includes('@')) void personOf(l, avatarOf(l)).then(putPerson);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, read]);
  return { extras, people };
}

/**
 * The preview captures of the exploration rows (lib/preview-shots), by "product#number": one raw file for all, no
 * GitHub API call, so even a visitor without a token gets them. A row without one keeps its thumbnail.
 */
function useShots(rows: ListRow[]): Map<string, ThumbSpec> {
  const [shots, setShots] = useState<Map<string, ThumbSpec>>(new Map());
  const xp = rows.filter((r) => r.opens === 'exploration');
  const key = xp.map((r) => `${r.product ?? ''}#${r.number}`).join(',');
  useEffect(() => {
    if (!xp.length) return;
    let live = true;
    void Promise.all([import('../../../scripts/preview-shots'), import('../../../lib/preview-shots')]).then(([{ previewShotOf }, { shotThumb }]) => {
      for (const r of xp) {
        void previewShotOf({ number: r.number, product: r.product ?? null }).then((shot) => {
          if (live && shot) setShots((m) => new Map(m).set(`${r.product ?? ''}#${r.number}`, shotThumb(shot, { seed: r.product ? `${r.product}#${r.number}` : String(r.number) })));
        });
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return shots;
}

/** Whether a branch only edits tokens: its files when read, else what the status read said. */
function tokenOnly(r: ListRow, e: Extra | undefined, tokensRoot: string): boolean | null {
  if (r.opens !== 'pr' || r.lifecycle === 'shipped' || r.lifecycle === 'closed') return false;
  if (e?.files) return onlyTokens(e.files, tokensRoot);
  const s = r.signals;
  if (s) return s.tokens && !s.visual && !s.guidance && !s.developer;
  return null;
}

export function BranchesList(p: BranchesListProps) {
  const [picked, setPicked] = useState<ChangesFilters>(() => changesFiltersParam(location.search));
  const [selected, setSelected] = useState<number[]>([]);
  const viewer = p.viewer ?? (p.seat ? `~${p.seat.toLowerCase()}` : null);
  const tab = picked.state;
  const archivedTab = tab === 'archived';
  const shippedTab = tab === 'shipped';
  // Open rows; archived explorations and what shipped only under their own tab.
  const open = p.rows;
  const archived = useMemo(() => p.archived ?? [], [p.archived]);
  const shipped = useMemo(() => shippedRows(p.closed ?? []), [p.closed]);
  const shown = archivedTab ? archived : shippedTab ? shipped : open;
  const { extras, people } = useExtras(shown, p.connected ? 'all' : p.seat ? 'seat' : 'none');
  const shots = useShots(shown);
  const names = useMemo(
    () => knownNames([...p.rows, ...archived, ...(p.closed ?? [])], p.viewer ? { login: p.viewer, name: p.viewerName ?? null } : null),
    [p.rows, archived, p.closed, p.viewer, p.viewerName],
  );

  // A login as a person, by display name: the profile read, else a name recorded on another row, else the login.
  const resolve = (login: string): Person => {
    const k = login.replace(/^@/, '').toLowerCase();
    const base = people.get(k) ?? person(login, null, avatarOf(login));
    const known = names.get(k);
    return known && base.name === displayName(login) ? { ...base, name: displayName(login, known) } : base;
  };
  // The person of a row: who asked for it when Bridge recorded it, else Claude AI for its own work, else the author.
  const personOf = (r: ListRow): Person => (r.requester && requesterPerson(r.requester, resolve)) ?? (r.agent ? CLAUDE : resolve(r.author));
  const whoNode = (r: ListRow) => <Who p={personOf(r)} size="md" />;
  const nameOf = (r: ListRow) => personOf(r).name;

  // Every row, classified once: its product, kind, person (the viewer as You) and state tab.
  const products = p.products ?? DEFAULT_PRODUCTS;
  const classify = (r: ListRow, fixed: 'archived' | 'shipped' | null) => {
    // Extras are keyed by the design system's numbers: a product repository's #12 is another branch.
    const e = r.product ? undefined : extras.get(r.number);
    const x = { r, e, product: r.product ?? productOf(e?.files ?? null, p.products, r.labels), tokenOnly: tokenOnly(r, e, p.tokensRoot) };
    const own = r.product ? (products.find((pp) => pp.key === r.product) ?? null) : null;
    const c = own ? { category: 'product' as const, product: own } : categoryOf({ files: e?.files ?? null, labels: r.labels, headRef: r.head.ref, signals: r.signals, guidanceOnly: r.guidance }, products);
    const pp = personOf(r);
    const yours = isYours(r, viewer, p.viewerName);
    return {
      kind: 'branch' as const,
      x,
      category: c.category,
      productName: c.product?.name ?? null,
      designer: { key: yours ? YOU : designerKey(pp), name: pp.name },
      state: (fixed ?? stateOf(r)) as StateTab | null,
    };
  };
  const openItems = open.map((r) => classify(r, null));
  const archivedItems = archived.map((r) => classify(r, 'archived'));
  const shippedItems = shipped.map((r) => classify(r, 'shipped'));
  const waitingExtras = viewer
    ? (p.waiting ?? []).map((w) => {
        const pp = w.need.person ?? CLAUDE;
        const yours = Boolean(pp.login && viewer && pp.login.replace(/^@/, '').toLowerCase() === viewer.replace(/^@/, '').toLowerCase());
        return { kind: 'extra' as const, w, category: w.category, productName: w.product?.name ?? null, designer: { key: yours ? YOU : designerKey(pp), name: pp.name } };
      })
    : [];
  type Item = (typeof openItems)[number] | (typeof waitingExtras)[number];
  const inTab = (t: StateTab): Item[] =>
    t === 'all'
      ? openItems
      : t === 'waiting'
        ? viewer
          ? [...openItems.filter((q) => q.x.r.yourTurn), ...waitingExtras]
          : []
        : t === 'archived'
          ? archivedItems
          : t === 'shipped'
            ? shippedItems
            : openItems.filter((q) => q.state === t);
  const queue = inTab(tab);
  // The person picked stays only while someone listed matches it (an address naming nobody listed keeps everyone).
  const by = picked.by && (picked.by === YOU ? Boolean(viewer) : queue.some((q) => q.designer.key === picked.by)) ? picked.by : null;
  const active = { kind: picked.kind as KindFilter, by };
  const filtered = active.kind !== 'all' || Boolean(active.by);
  const kept = queue.filter((q) => passes(q, active));
  const counts = Object.fromEntries(
    (['all', 'waiting', 'not-started', 'exploring', 'draft', 'review', 'code', 'shipped', 'archived'] as StateTab[]).map((t) => [t, inTab(t).filter((q) => passes(q, active)).length]),
  ) as Record<StateTab, number>;
  const tabs = visibleTabs(counts, tab);
  const waitingView = tab === 'waiting' && Boolean(viewer);
  const rowKey = (r: ListRow) => (r.product ? `${r.product}#${r.number}` : String(r.number));
  const rows = kept.flatMap((q) => (q.kind === 'branch' ? [q.x] : []));
  // Token branches carry a checkbox to preview them together, except in the demo lead's read-only Waiting on me.
  const picks = !(waitingView && p.seat);
  // Library branches a listed product branch needs follow it, one step in (lib/product-branch nestLinked).
  const groups = nestLinked(groupByProduct(rows, p.products));

  // Checked branches stay only while they are listed and still checkable.
  const checkable = rows.filter((x) => picks && selectable(x));
  const listedKey = checkable.map((x) => `${x.r.number}@${x.r.head.sha}\u0000${x.r.title}`).join('\u0001');
  const listed = useMemo(
    () =>
      new Map<number, ListedBranch>(
        listedKey
          ? listedKey.split('\u0001').map((k) => {
              const [id, title] = k.split('\u0000') as [string, string];
              const [n, sha] = id.split('@') as [string, string];
              return [Number(n), { number: Number(n), title, sha }];
            })
          : [],
      ),
    [listedKey],
  );
  useEffect(() => {
    setSelected((s) => (s.every((n) => listed.has(n)) ? s : s.filter((n) => listed.has(n))));
  }, [listed]);

  const toggle = (n: number, on: boolean) => setSelected((s) => toggleChange(s, n, on).selected);
  const clear = useCallback(() => setSelected([]), []);
  const drop = useCallback((ns: number[]) => setSelected((s) => s.filter((n) => !ns.includes(n))), []);

  // The tab, kind and person are kept together in the address (lib/branches-page withChangesFilters).
  const pick = (f: ChangesFilters) => {
    setPicked(f);
    const url = new URL(location.href);
    url.search = withChangesFilters(url.search, f);
    history.replaceState(history.state, '', url);
  };
  const pickTab = (v: string) => pick({ ...picked, state: v as StateTab });
  const pickFilters = (f: { kind: KindFilter; by: string | null }) => pick({ ...picked, kind: f.kind, by: f.by });
  // Shipped reads the closed list when it was not read yet (the page reads it after the open one).
  const readClosed = p.readClosed;
  useEffect(() => {
    if (shippedTab && p.closed === null) readClosed();
  }, [shippedTab, p.closed, readClosed]);

  // The checkbox (preview token branches together) leads a row; every row of a group that has one keeps its slot, so
  // thumbnails and avatars stay in one column.
  const pickable = (x: { tokenOnly: boolean | null }) => picks && selectable(x);
  const slot = <span className="bl-pick-slot" aria-hidden="true" />;
  const branchRow = ({ r, e, tokenOnly, child }: (typeof rows)[number] & { child: boolean }, line?: string, reserve = false) => {
    const tok = picks && tokenOnly;
                const href = r.opens === 'pr' ? `?pr=${r.number}` : r.product ? `?exploration=${r.number}&product=${encodeURIComponent(r.product)}` : `?exploration=${r.number}`;
                const checked = selected.includes(r.number);
                const full = boxDisabled(selected, r.number);
                const box = (
                  <Checkbox
                    className="bl-pick"
                    label={<VisuallyHidden>Select {r.title} to preview it</VisuallyHidden>}
                    checked={checked}
                    disabled={full}
                    onCheckedChange={(on) => toggle(r.number, on)}
                  />
                );
                const behind = r.behindBy && r.behindBy > 0 && r.lifecycle !== 'shipped' && r.lifecycle !== 'closed';
                return (
                  <BranchRow
                    key={rowKey(r)}
                    className={`bl-row${tok ? ' is-pickable' : ''}${child ? ' is-linked' : ''}`}
                    selected={checked}
                    lead={tok ? (full ? <Tooltip content={FULL_TIP}>{box}</Tooltip> : box) : reserve ? slot : undefined}
                    thumb={shots.get(`${r.product ?? ''}#${r.number}`) ?? e?.thumb ?? { kind: 'icon', icon: r.guidance ? 'guidance' : 'branch' }}
                    who={whoNode(r)}
                    title={r.title}
                    jira={r.jira}
                    line={child ? childLine(nameOf(r)) : (line ?? (r.ago ? `${nameOf(r)}${SEP}${r.ago}` : nameOf(r)))}
                    href={href}
                    linkAttributes={r.opens === 'pr' ? { 'data-open-pr': r.number } : { 'data-open-exploration': r.number, ...(r.product ? { 'data-product': r.product } : {}) }}
                    pill={r.pill}
                    end={
                      behind ? (
                        <span className="t-ui bl-behind">
                          <span className="t-muted">
                            {r.behindBy} {r.behindBy === 1 ? 'update' : 'updates'} on {VOCAB.main}
                          </span>
                          <span className="t-muted" aria-hidden="true">
                            {' · '}
                          </span>
                          <Link href={href} className="bl-update" data-open-pr={r.number}>
                            {VOCAB.updateFromMain}
                            <VisuallyHidden>: {r.title}</VisuallyHidden>
                          </Link>
                        </span>
                      ) : null
                    }
                  />
                );
  };

  // Waiting on me: every change that waits on the viewer, branches and the rest, by kind and by designer.
  const kinds = kindOptions(queue, active.by);
  const designers = peopleOptions(designerOptions(queue, active.kind), Boolean(viewer));
  const reach = reachLine(products);
  const count = (n: number) => (
    <Badge tone="neutral" size="sm">
      {n}
    </Badge>
  );

  const extraRow = ({ w, productName }: (typeof waitingExtras)[number], reserve = false) => {
    const pp = w.need.person ?? CLAUDE;
    const s = w.suggestion;
    const line = s ? `${productName ? `${productName} · ` : ''}${pp.name} · Suggestion` : w.need.line;
    return (
      <BranchRow
        key={w.need.key}
        thumb={w.need.thumb}
        who={<Who p={pp} size="md" />}
        title={w.need.title}
        line={line}
        href={w.need.href}
        linkAttributes={s ? { 'data-open-suggestion': s } : undefined}
        pill={w.need.pill}
        lead={reserve ? slot : undefined}
      />
    );
  };

  const waitingList = (
    <>
      <p className="t-body bl-summary">
        {queueSummary(kept.length, queue.length, filtered)}
        {filtered && (
          <>
            {' '}
            <Button variant="link" onClick={() => pickFilters({ kind: 'all', by: null })}>
              Clear filters
            </Button>
          </>
        )}
      </p>
      {groupByCategory(kept)
        .filter((g) => g.rows.length > 0 || !filtered)
        .map((g) => (
          <section className="bl-group" key={g.key} aria-labelledby={`bl-${g.key}`}>
            <div className="bl-head">
              <h2 className="bl-h2" id={`bl-${g.key}`}>
                {g.label} <span className="bl-count">{g.rows.length}</span>
              </h2>
              {g.key === 'library' && reach && <p className="t-ui t-muted bl-reach">{reach}</p>}
            </div>
            {g.rows.length ? (
              <ul className="sh-rows" aria-labelledby={`bl-${g.key}`}>
                {g.rows.map((q) => {
                  const reserve = g.rows.some((o) => o.kind === 'branch' && pickable(o.x));
                  return q.kind === 'extra' ? extraRow(q, reserve) : branchRow({ ...q.x, child: false }, q.productName ? `${q.productName} · ${q.designer.name}` : undefined, reserve);
                })}
              </ul>
            ) : (
              <p className="t-ui t-muted bl-none">Nothing of this kind waits on you.</p>
            )}
          </section>
        ))}
    </>
  );

  const clearLink = (
    <Button variant="link" onClick={() => pickFilters({ kind: 'all', by: null })}>
      Clear filters
    </Button>
  );

  return (
    <div className={waitingView ? 'bl is-waiting' : 'bl'}>
      <div className="bl-filters">
        <Tabs className="bl-tabs" value={tab} onValueChange={(v) => v !== null && pickTab(String(v))}>
          <TabsList aria-label={`Where the ${VOCAB.branches} stand`}>
            {tabs.map((t) => (
              <Tab key={t.value} value={t.value} count={t.count}>
                {t.label}
              </Tab>
            ))}
          </TabsList>
        </Tabs>
        {/* The filters show once the tab holds something to narrow (or while one is picked). */}
        {!(p.loading && !p.rows.length) && (queue.length > 0 || filtered) && (
          <span className="bl-narrow">
            <Select
              label="Kind of change"
              hideLabel
              value={active.kind}
              onValueChange={(v) => pickFilters({ ...active, kind: (v ?? 'all') as KindFilter })}
              options={kinds.map((k) => ({ value: k.value, label: k.label, badge: count(k.count), disabled: k.count === 0 && k.value !== active.kind }))}
            />
            <Select
              label="People"
              hideLabel
              value={active.by ?? EVERYONE}
              onValueChange={(v) => pickFilters({ ...active, by: !v || v === EVERYONE ? null : v })}
              options={designers.map((d) => ({ value: d.value, label: d.label, badge: count(d.count), disabled: d.count === 0 && d.value !== (active.by ?? EVERYONE) }))}
            />
          </span>
        )}
      </div>
      {p.tierLabel && (
        <p className="t-ui t-muted bl-note">
          Showing {p.tierLabel} only. <Link href={studioHref('changes/')}>Show all</Link>
        </p>
      )}
      {archivedTab && archivedItems.length > 0 && <p className="t-ui t-muted bl-note">{ARCHIVED_NOTE}</p>}
      {(p.loading && !p.rows.length) || (shippedTab && p.closed === null) ? (
        <ul className="sh-rows" aria-hidden="true">
          <li className="sh-row-item">
            <Skeleton variant="rect" className="sh-skel" />
          </li>
          <li className="sh-row-item">
            <Skeleton variant="rect" className="sh-skel" />
          </li>
        </ul>
      ) : waitingView && queue.length > 0 ? (
        waitingList
      ) : kept.length === 0 && filtered && queue.length > 0 ? (
        <p className="t-body t-muted bl-none">Nothing here matches these filters. {clearLink}</p>
      ) : groups.length === 0 ? (
        <p className="t-body t-muted bl-none">{emptyTabLine(tab, Boolean(viewer))}</p>
      ) : shippedTab ? (
        <>
          {groupByMonth(rows, (x) => x.r.merged_at).map((g) => (
            <section className="bl-group" key={g.key} aria-labelledby={`bl-${g.key}`}>
              <h2 className="bl-h2" id={`bl-${g.key}`}>
                {g.label} <span className="bl-count">{g.rows.length}</span>
              </h2>
              <ul className="sh-rows" aria-labelledby={`bl-${g.key}`}>
                {g.rows.map((x) => {
                  const product = products.find((pp) => pp.key === x.product)?.name;
                  const line = [product, nameOf(x.r), shippedOn(x.r.merged_at!)].filter(Boolean).join(SEP);
                  return branchRow({ ...x, r: { ...x.r, pill: null }, child: false }, line);
                })}
              </ul>
            </section>
          ))}
          {shippedCapLine(p.closed?.length ?? 0, p.closedLimit) && <p className="t-ui t-muted bl-merged">{shippedCapLine(p.closed?.length ?? 0, p.closedLimit)}</p>}
        </>
      ) : (
        groups.map((g) => (
          <section className="bl-group" key={g.key} aria-labelledby={`bl-${g.key}`}>
            <h2 className="bl-h2" id={`bl-${g.key}`}>
              {g.label} <span className="bl-count">{g.count}</span>
            </h2>
            <ul className="sh-rows" aria-labelledby={`bl-${g.key}`}>
              {g.rows.map((x) => branchRow(x, undefined, g.rows.some(pickable)))}
            </ul>
          </section>
        ))
      )}
      <SelectionBar selected={selected} listed={listed} admin={p.admin} failure={p.failure} onClear={clear} onDrop={drop} />
    </div>
  );
}

let root: Root | null = null;

/** Mounts the list into `el` once; later calls repaint it with the new rows (its filter and selection stay). */
export function paintBranchesList(el: HTMLElement, props: BranchesListProps) {
  root ??= createRoot(el);
  root.render(<BranchesList {...props} />);
}
