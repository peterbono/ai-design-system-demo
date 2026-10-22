// Branches (/studio/changes/): all the work, not a second triage page (triage lives on Home and the review queue).
//   - One DS SegmentedControl: Mine, Waiting on me, All (All by default, lib/branches-page whoFilterParam; ?who=).
//   - The open branches, explorations included (status pill "Exploration"), grouped by the product they belong to
//     (lib/branches-page productOf, bridge.config.json products), each group a heading with its count. Rows are the home row (BranchRow).
//   - Token branches carry a checkbox to preview them together; the floating bar (CombineChanges SelectionBar) acts.
//   - Merged and closed branches stay behind one muted line at the end: "12 merged this month. Show merged" (?status=).
//   - Waiting on me (what "Review all" opens on the demo) is the lead's review list: one summary sentence, every change
//     that waits (branches, suggestions, usage guidance drafts) under three kinds (lib/review-categories: In a product,
//     Library components and tokens, Documentation), and two DS Selects to narrow it by kind and by designer
//     (?kind=, ?by=). The designer is who asked for the change (the requester line), Claude AI's work included.
// Mounted and repainted by scripts/reviews.ts (loadList), which reads GitHub; this file only enriches what is shown
// (display names, before/after thumbnails and changed files, with a working token only: anonymous visitors have 60
// GitHub reads an hour, kept for the statuses). The exception is the visitor in the demo lead's seat: the demo's
// activity snapshot answers the before/after and the files, so a change looks the same here as on the demo home.
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Checkbox, Link, SegmentedControl, Select, Skeleton, Tooltip, VisuallyHidden } from '@bridge-ds/react';
import { BranchRow } from './BranchRow';
import { Who } from './faces';
import { SelectionBar, type ListedBranch } from './CombineChanges';
import { boxDisabled, emptyWhoLine, showsDesignerFilter, tabFilters, finishedParam, FULL_TIP, groupByProduct, mergedLine, mergedThisMonth, onlyLine, productOf, selectable, showsForWho, WHO_FILTERS, whoFilterParam, type WhoFilter } from '../../../lib/branches-page';
import { onlyTokens, toggleChange } from '../../../lib/combine-changes';
import { childLine, nestLinked } from '../../../lib/product-branch';
import { CLAUDE, person, requesterPerson, type Person, type PillTone } from '../../../lib/home-model';
import {
  categoryOf,
  designerKey,
  designerOptions,
  groupByCategory,
  kindOptions,
  passes,
  queueFiltersParam as readQueueFilters,
  queueSummary,
  reachLine,
  withQueueFilters,
  type KindFilter,
  type QueueFilters,
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
  /** Who asked for it, as Bridge records it in the body ("Requested by Ann Leroy."): the designer of the change. */
  requester?: { name: string | null; login: string | null } | null;
}

export interface BranchesListProps {
  /** Open branches and running explorations, most urgent first. */
  rows: ListRow[];
  /** The most recently closed branches (merged or not), null until read. */
  closed: ListRow[] | null;
  closedLimit: number;
  loading: boolean;
  viewer: string | null;
  /** A working GitHub token: names, thumbnails and files are read. */
  connected: boolean;
  admin: string | null;
  tokensRoot: string;
  /** bridge.config.json products, in group order (lib/config). Absent: the default products. */
  products?: ProductConfig[];
  /** ?tier= keeps working: the one kind of change shown, in words, or null. */
  tierLabel: string | null;
  failure: (err: unknown) => string;
  /** Asks scripts/reviews.ts for the closed list (when the line is pressed before it was read). */
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
  person?: Person;
  thumb?: ThumbSpec;
  files?: string[] | null;
}

/**
 * `read`: 'all' with a working token; 'seat' for the visitor in the demo lead's seat, whose reads the demo's activity
 * snapshot answers (the before/after and the files, as on the demo home; no profile reads); 'none' otherwise.
 */
function useExtras(rows: ListRow[], read: 'all' | 'seat' | 'none'): Map<number, Extra> {
  const [extras, setExtras] = useState<Map<number, Extra>>(new Map());
  const key = rows.map((r) => `${r.number}@${r.head.sha}`).join(',');
  useEffect(() => {
    if (read === 'none' || !rows.length) return;
    let live = true;
    const put = (n: number, e: Extra) => live && setExtras((m) => new Map(m).set(n, { ...m.get(n), ...e }));
    void import('../../../scripts/home-data').then(({ personOf, thumbOf, filesOf }) => {
      for (const r of rows) {
        if (!r.agent && read === 'all') void personOf(r.author, avatarOf(r.author)).then((p) => put(r.number, { person: p }));
        void filesOf(r.number, r.head.sha).then((files) => put(r.number, { files }));
        if (r.base) void thumbOf({ number: r.number, head: r.head, base: r.base }, r.guidance).then((thumb) => put(r.number, { thumb }));
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, read]);
  return extras;
}

/** Whether a branch only edits tokens: its files when read, else what the status read said. */
function tokenOnly(r: ListRow, e: Extra | undefined, tokensRoot: string): boolean | null {
  if (r.opens !== 'pr' || r.lifecycle === 'shipped' || r.lifecycle === 'closed') return false;
  if (e?.files) return onlyTokens(e.files, tokensRoot);
  const s = r.signals;
  if (s) return s.tokens && !s.visual && !s.guidance && !s.developer;
  return null;
}

const setParam = (name: string, value: string | null) => {
  const url = new URL(location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  history.replaceState(history.state, '', url);
};

export function BranchesList(p: BranchesListProps) {
  const [who, setWho] = useState<WhoFilter>(() => whoFilterParam(location.search));
  const [finished, setFinished] = useState(() => finishedParam(location.search));
  const [selected, setSelected] = useState<number[]>([]);
  const [filters, setFilters] = useState<QueueFilters>(() => readQueueFilters(location.search));
  const viewer = p.viewer ?? (p.seat ? `~${p.seat.toLowerCase()}` : null);
  const all = useMemo(() => [...p.rows, ...(finished.finished ? (p.closed ?? []) : [])], [p.rows, p.closed, finished.finished]);
  const extras = useExtras(all, p.connected ? 'all' : p.seat ? 'seat' : 'none');

  // The person of a row: who asked for it when Bridge recorded it, else Claude AI for its own work, else the author.
  const personOf = (r: ListRow, e: Extra | undefined): Person =>
    (r.requester && requesterPerson(r.requester, (l) => (l.toLowerCase() === r.author.toLowerCase() && e?.person) || person(l, null, avatarOf(l)))) ??
    (r.agent ? CLAUDE : (e?.person ?? person(r.author, null, avatarOf(r.author))));
  const whoNode = (r: ListRow, e: Extra | undefined) => <Who p={personOf(r, e)} size="md" />;
  const nameOf = (r: ListRow, e: Extra | undefined) => personOf(r, e).name;

  const shown = all.filter((r) => showsForWho(who, { author: r.author, yourTurn: r.yourTurn, mine: r.mine }, viewer) && (!finished.only || r.lifecycle === finished.only));
  const tabRows = shown.map((r) => {
    const e = extras.get(r.number);
    return { r, e, product: productOf(e?.files ?? null, p.products, r.labels), tokenOnly: tokenOnly(r, e, p.tokensRoot) };
  });
  const waitingView = who === 'waiting' && !finished.only && Boolean(viewer);
  // The kind and designer of each listed branch: the filter bar narrows every tab, not only Waiting on me.
  const products = p.products ?? DEFAULT_PRODUCTS;
  const classified = tabRows.map((x) => {
    const c = categoryOf({ files: x.e?.files ?? null, labels: x.r.labels, headRef: x.r.head.ref, signals: x.r.signals, guidanceOnly: x.r.guidance }, products);
    const pp = personOf(x.r, x.e);
    return { kind: 'branch' as const, x, category: c.category, productName: c.product?.name ?? null, designer: { key: designerKey(pp), name: pp.name } };
  });
  const queueExtras = waitingView
    ? (p.waiting ?? []).map((w) => {
        const pp = w.need.person ?? CLAUDE;
        return { kind: 'extra' as const, w, category: w.category, productName: w.product?.name ?? null, designer: { key: designerKey(pp), name: pp.name } };
      })
    : [];
  const queue = [...classified, ...queueExtras];
  const active: QueueFilters = tabFilters(
    who,
    filters,
    queue.map((q) => q.designer.key),
  );
  const filtered = active.kind !== 'all' || Boolean(active.by);
  const kept = queue.filter((q) => passes(q, active));
  const keptBranches = new Set(kept.filter((q) => q.kind === 'branch').map((q) => (q as (typeof classified)[number]).x.r.number));
  const rows = tabRows.filter((x) => keptBranches.has(x.r.number));
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

  const merged = p.closed ? mergedThisMonth(p.closed, new Date()) : null;
  const pickWho = (v: string) => {
    const next = v as WhoFilter;
    setWho(next);
    setParam('who', next === 'all' ? null : next);
    // The kind and designer picks stay across tabs: each tab applies what it can (lib/branches-page tabFilters).
  };
  const pickFilters = (f: QueueFilters) => {
    setFilters(f);
    const url = new URL(location.href);
    url.search = withQueueFilters(url.search, f);
    history.replaceState(history.state, '', url);
  };
  const showFinished = () => {
    setFinished({ finished: true, only: null });
    setParam('status', 'merged');
    p.readClosed();
  };
  const hideFinished = () => {
    setFinished({ finished: false, only: null });
    setParam('status', null);
  };


  // The checkbox (preview token branches together) leads a row; every row of a group that has one keeps its slot, so
  // thumbnails and avatars stay in one column.
  const pickable = (x: { tokenOnly: boolean | null }) => picks && selectable(x);
  const slot = <span className="bl-pick-slot" aria-hidden="true" />;
  const branchRow = ({ r, e, tokenOnly, child }: (typeof rows)[number] & { child: boolean }, line?: string, reserve = false) => {
    const tok = picks && tokenOnly;
                const href = r.opens === 'pr' ? `?pr=${r.number}` : `?exploration=${r.number}`;
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
                    key={r.number}
                    className={`bl-row${tok ? ' is-pickable' : ''}${child ? ' is-linked' : ''}`}
                    selected={checked}
                    lead={tok ? (full ? <Tooltip content={FULL_TIP}>{box}</Tooltip> : box) : reserve ? slot : undefined}
                    thumb={e?.thumb ?? { kind: 'icon', icon: r.guidance ? 'guidance' : 'branch' }}
                    who={whoNode(r, e)}
                    title={r.title}
                    jira={r.jira}
                    line={child ? childLine(nameOf(r, e)) : (line ?? nameOf(r, e))}
                    href={href}
                    linkAttributes={r.opens === 'pr' ? { 'data-open-pr': r.number } : { 'data-open-exploration': r.number }}
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
  const designers = designerOptions(queue, active.kind);
  const reach = reachLine(products);
  const count = (n: number) => (
    <Badge tone="neutral" size="sm">
      {n}
    </Badge>
  );

  const extraRow = ({ w, productName }: (typeof queueExtras)[number], reserve = false) => {
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

  return (
    <div className={waitingView ? 'bl is-waiting' : 'bl'}>
      <div className="bl-filters">
        <SegmentedControl label={`Whose ${VOCAB.branches}`} value={who} onValueChange={pickWho} items={WHO_FILTERS} />
        {!(p.loading && !p.rows.length) && (
          <span className="bl-narrow">
            <Select
              label="Kind of change"
              hideLabel
              value={active.kind}
              onValueChange={(v) => pickFilters({ ...active, kind: (v ?? 'all') as KindFilter })}
              options={kinds.map((k) => ({ value: k.value, label: k.label, badge: count(k.count), disabled: k.count === 0 && k.value !== active.kind }))}
            />
            {/* Mine is the viewer's own work: no designer to pick. The kind select keeps its place. */}
            {showsDesignerFilter(who) && (
              <Select
                label="Designer"
                hideLabel
                value={active.by ?? EVERYONE}
                onValueChange={(v) => pickFilters({ ...active, by: !v || v === EVERYONE ? null : v })}
                options={designers.map((d) => ({ value: d.value, label: d.label, badge: count(d.count), disabled: d.count === 0 && d.value !== (active.by ?? EVERYONE) }))}
              />
            )}
          </span>
        )}
      </div>
      {(p.tierLabel || finished.only) && (
        <p className="t-ui t-muted bl-note">
          {p.tierLabel ? `Showing ${p.tierLabel} only.` : onlyLine(finished.only)}{' '}
          <Link
            href={studioHref('changes/')}
            onClick={(e) => {
              if (p.tierLabel) return;
              e.preventDefault();
              hideFinished();
            }}
          >
            Show all
          </Link>
        </p>
      )}
      {p.loading && !p.rows.length ? (
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
      ) : groups.length === 0 && filtered && tabRows.length > 0 ? (
        <p className="t-body t-muted bl-none">
          No {VOCAB.branch} of this kind.{' '}
          <Button variant="link" onClick={() => pickFilters({ kind: 'all', by: null })}>
            Clear filters
          </Button>
        </p>
      ) : groups.length === 0 || waitingView ? (
        <p className="t-body t-muted bl-none">{emptyWhoLine(who, Boolean(viewer))}</p>
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
      {!finished.only && !waitingView && (merged !== null || finished.finished) && (
        <p className="t-ui t-muted bl-merged">
          {finished.finished ? (
            <>
              Showing merged and closed {VOCAB.branches}.{' '}
              <Button variant="link" onClick={hideFinished}>
                Hide them
              </Button>
            </>
          ) : (
            <>
              {mergedLine(merged ?? 0, p.closed?.length ?? 0, p.closedLimit)}{' '}
              {(p.closed?.length ?? 0) > 0 && (
                <Button variant="link" onClick={showFinished}>
                  Show merged
                </Button>
              )}
            </>
          )}
        </p>
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
