// Branches (/studio/changes/): all the work, not a second triage page (triage lives on Home and the review queue).
//   - One DS SegmentedControl: Mine, Waiting on me, All (All by default, lib/branches-page whoFilterParam; ?who=).
//   - The open branches, explorations included (status pill "Exploration"), grouped by the product they belong to
//     (lib/branches-page productOf, bridge.config.json products), each group a heading with its count. Rows are the home row (BranchRow).
//   - Token branches carry a checkbox to preview them together; the floating bar (CombineChanges SelectionBar) acts.
//   - Merged and closed branches stay behind one muted line at the end: "12 merged this month. Show merged" (?status=).
// Mounted and repainted by scripts/reviews.ts (loadList), which reads GitHub; this file only enriches what is shown
// (display names, before/after thumbnails and changed files, with a working token only: anonymous visitors have 60
// GitHub reads an hour, kept for the statuses).
import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Link, SegmentedControl, Skeleton, Tooltip, VisuallyHidden } from '@bridge-ds/react';
import { BranchRow } from './BranchRow';
import { Who } from './faces';
import { SelectionBar, type ListedBranch } from './CombineChanges';
import { boxDisabled, emptyWhoLine, finishedParam, FULL_TIP, groupByProduct, mergedLine, mergedThisMonth, onlyLine, productOf, selectable, showsForWho, WHO_FILTERS, whoFilterParam, type WhoFilter } from '../../../lib/branches-page';
import { onlyTokens, toggleChange } from '../../../lib/combine-changes';
import { childLine, nestLinked } from '../../../lib/product-branch';
import { CLAUDE, person, type Person, type PillTone } from '../../../lib/home-model';
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
}

const avatarOf = (login: string) => `https://github.com/${encodeURIComponent(login)}.png?size=64`;

/** Enrichment read once per branch version, shared by every paint. */
interface Extra {
  person?: Person;
  thumb?: ThumbSpec;
  files?: string[] | null;
}

function useExtras(rows: ListRow[], connected: boolean): Map<number, Extra> {
  const [extras, setExtras] = useState<Map<number, Extra>>(new Map());
  const key = rows.map((r) => `${r.number}@${r.head.sha}`).join(',');
  useEffect(() => {
    if (!connected || !rows.length) return;
    let live = true;
    const put = (n: number, e: Extra) => live && setExtras((m) => new Map(m).set(n, { ...m.get(n), ...e }));
    void import('../../../scripts/home-data').then(({ personOf, thumbOf, filesOf }) => {
      for (const r of rows) {
        if (!r.agent) void personOf(r.author, avatarOf(r.author)).then((p) => put(r.number, { person: p }));
        void filesOf(r.number, r.head.sha).then((files) => put(r.number, { files }));
        if (r.base) void thumbOf({ number: r.number, head: r.head, base: r.base }, r.guidance).then((thumb) => put(r.number, { thumb }));
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, connected]);
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
  const all = useMemo(() => [...p.rows, ...(finished.finished ? (p.closed ?? []) : [])], [p.rows, p.closed, finished.finished]);
  const extras = useExtras(all, p.connected);

  const shown = all.filter((r) => showsForWho(who, { author: r.author, yourTurn: r.yourTurn }, p.viewer) && (!finished.only || r.lifecycle === finished.only));
  const rows = shown.map((r) => {
    const e = extras.get(r.number);
    return { r, e, product: productOf(e?.files ?? null, p.products, r.labels), tokenOnly: tokenOnly(r, e, p.tokensRoot) };
  });
  // Library branches a listed product branch needs follow it, one step in (lib/product-branch nestLinked).
  const groups = nestLinked(groupByProduct(rows, p.products));

  // Checked branches stay only while they are listed and still checkable.
  const checkable = rows.filter((x) => selectable(x));
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

  const whoNode = (r: ListRow, e: Extra | undefined) => {
    const pp = r.agent ? CLAUDE : (e?.person ?? person(r.author, null, avatarOf(r.author)));
    return <Who p={pp} size="md" />;
  };
  const nameOf = (r: ListRow, e: Extra | undefined) => (r.agent ? CLAUDE.name : (e?.person ?? person(r.author)).name);

  return (
    <div className="bl">
      <div className="bl-filters">
        <SegmentedControl label={`Whose ${VOCAB.branches}`} value={who} onValueChange={pickWho} items={WHO_FILTERS} />
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
      ) : groups.length === 0 ? (
        <p className="t-body t-muted bl-none">{emptyWhoLine(who, Boolean(p.viewer))}</p>
      ) : (
        groups.map((g) => (
          <section className="bl-group" key={g.key} aria-labelledby={`bl-${g.key}`}>
            <h2 className="bl-h2" id={`bl-${g.key}`}>
              {g.label} <span className="bl-count">{g.count}</span>
            </h2>
            <ul className="sh-rows" aria-labelledby={`bl-${g.key}`}>
              {g.rows.map(({ r, e, tokenOnly: tok, child }) => {
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
                    lead={tok ? (full ? <Tooltip content={FULL_TIP}>{box}</Tooltip> : box) : undefined}
                    thumb={e?.thumb ?? { kind: 'icon', icon: r.guidance ? 'guidance' : 'branch' }}
                    who={whoNode(r, e)}
                    title={r.title}
                    jira={r.jira}
                    line={child ? childLine(nameOf(r, e)) : nameOf(r, e)}
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
              })}
            </ul>
          </section>
        ))
      )}
      {!finished.only && (merged !== null || finished.finished) && (
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
