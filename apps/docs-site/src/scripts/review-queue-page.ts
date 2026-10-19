// The review queue page (pages/studio/review.astro). Reads the same rows as the Studio home (scripts/home-data.ts
// loadHome), lists them with the home row component (NeedList), and opens the selected one in the main area:
//   - a branch row opens the branch review of Branches in place (scripts/reviews.ts openPr into #rv-detail);
//   - usage guidance drafts, library health and setup rows show a short card with the link that handles them.
// The footer moves through the queue: "Approve and next" (only when the open review offers the viewer an approval,
// through the review's own approval path, actOnOpenBranch), "Skip", and where the viewer is ("3 of 20").
// J or ArrowDown, K or ArrowUp move to the next or previous row. The URL keeps the selection (?pr=N or ?item=key)
// with replaceState only. Moves are pure in lib/queue-nav.ts.
import { createElement as h, Fragment, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Button, Card, CardBody, EmptyState, Kbd, Select, Skeleton } from '@bridge-ds/react';
import { Inbox } from 'lucide-react';
import ButtonLink from '../components/ds/ButtonLink';
import { NeedList } from '../components/ds/studio/StudioHome';
import { currentViewer, initGitHubConnect, prefersSignIn } from './github-session';
import { setReviewCount } from './shell';
import { loadHome, type HomeStatic } from './home-data';
import { actOnOpenBranch, closePr, openPr } from './reviews';
import { afterApprove, branchOf, keyFromSearch, keyMove, moveIndex, positionLabel, searchFor, skipIndex } from '../lib/queue-nav';
import { ghAction, ghButton } from '../lib/gh-wording';
import type { NeedKind, NeedRow } from '../lib/home-model';

/** The link of a row that does not open a branch review, by kind. */
const OPEN_LABEL: Record<NeedKind, string> = {
  guidance: 'Review guidance',
  health: 'Open Quality',
  setup: 'Open settings',
  review: 'Open review',
  own: 'Open branch',
};

const read = <T>(id: string): T | null => {
  try {
    return JSON.parse(document.getElementById(id)?.textContent || 'null') as T;
  } catch {
    return null;
  }
};

/** The branch a row opens in place, from its link, else from a ?pr= key ("change-N"). */
const branchNumber = (row: NeedRow | null, key: string | null): number | null => {
  if (row) return branchOf(row);
  const m = key ? /^change-(\d+)$/.exec(key) : null;
  return m ? Number(m[1]) : null;
};

/** Typing, picking in a menu or a list box, or a dialog: J and K belong to that control. */
function ownsKeys(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.closest('input, textarea, select, [contenteditable="true"]')) return true;
  return Boolean(t.closest('[role="menu"], [role="menubar"], [role="menuitem"], [role="listbox"], [role="option"], [role="combobox"], [role="dialog"], [role="alertdialog"]'));
}

export function initReviewQueue() {
  const page = document.querySelector<HTMLElement>('[data-review-queue]');
  if (!page) return;
  const stat = read<HomeStatic>('home-static') ?? { contrastFail: 0, guidance: [] };
  stat.guidance = read<{ drafted: HomeStatic['guidance'] }>('home-guidance')?.drafted ?? [];

  const el = (sel: string) => page.querySelector<HTMLElement>(sel)!;
  const layout = el('[data-rq-layout]');
  const sideEl = el('[data-rq-side]');
  const pickEl = el('[data-rq-pick]');
  const cardEl = el('[data-rq-card]');
  const footEl = el('[data-rq-foot]');
  const emptyEl = el('[data-rq-empty]');
  const detail = document.getElementById('rv-detail')!;
  const roots = new Map<HTMLElement, Root>();
  const render = (host: HTMLElement, node: Parameters<Root['render']>[0]) => {
    let r = roots.get(host);
    if (!r) {
      host.replaceChildren();
      r = createRoot(host);
      roots.set(host, r);
    }
    r.render(node);
  };

  let rows: NeedRow[] = [];
  let loading = true;
  let signedIn = false;
  let failed: string | null = null;
  let selected: string | null = keyFromSearch(location.search);
  /** The branch open in #rv-detail. */
  let opened: number | null = null;
  /** Approved here: never listed again, even when a later read still has them. */
  const done = new Set<string>();
  let canApprove = false;
  let busy = false;
  let run = 0;

  const index = () => rows.findIndex((r) => r.key === selected);
  const rowOf = (key: string | null) => rows.find((r) => r.key === key) ?? null;

  function show(key: string | null) {
    selected = key;
    const row = rowOf(key);
    const n = branchNumber(row, key);
    if (row) history.replaceState(history.state, '', `${location.pathname}${searchFor(row)}`);
    if (n) {
      if (opened !== n) {
        opened = n;
        canApprove = false;
        void openPr(n, false);
      }
    } else if (opened !== null) {
      opened = null;
      canApprove = false;
      closePr();
    }
    paint();
    sideEl.querySelector('[aria-current="true"]')?.closest('li')?.scrollIntoView({ block: 'nearest' });
  }

  function go(to: number | null) {
    if (to === null || !rows[to]) return;
    show(rows[to].key);
  }

  async function approveAndNext() {
    if (busy || !canApprove) return;
    busy = true;
    paint();
    const ok = await actOnOpenBranch('APPROVE');
    busy = false;
    if (!ok) {
      paint();
      return;
    }
    const i = index();
    if (selected) done.add(selected);
    const next = afterApprove(rows, i);
    rows = next.items;
    setReviewCount(rows.filter((r) => r.kind === 'review').length);
    if (next.index < 0) {
      if (opened !== null) closePr();
      opened = null;
      selected = null;
      history.replaceState(history.state, '', location.pathname);
      paint();
      return;
    }
    show(rows[next.index].key);
  }

  function emptyState() {
    const signIn = prefersSignIn();
    return h(EmptyState, {
      icon: Inbox,
      size: 'lg',
      headingLevel: 2,
      title: 'Nothing waits on you.',
      description: failed ?? (signedIn ? 'New reviews, usage guidance drafts and library checks land here.' : `${ghAction('see what waits on you', signIn)}.`),
      actions: signedIn
        ? h(ButtonLink, { variant: 'primary', href: '/studio/' }, 'Back to Overview')
        : h(
            Fragment,
            null,
            h(Button, { variant: 'primary', 'data-gh-open': '', 'data-gh-signin': signIn ? '' : undefined } as ComponentProps<typeof Button>, ghButton(signIn)),
            h(ButtonLink, { variant: 'secondary', href: '/studio/' }, 'Back to Overview'),
          ),
    });
  }

  function paint() {
    const empty = !loading && rows.length === 0;
    layout.hidden = empty;
    emptyEl.hidden = !empty;
    if (empty) {
      render(emptyEl, emptyState());
      return;
    }

    const i = index();
    const row = i >= 0 ? rows[i] : null;
    const branch = branchNumber(row, selected);

    // The list: the home rows, the selected one marked. Skeletons while nothing is listed yet.
    render(
      sideEl,
      rows.length
        ? h(NeedList, { rows, selectedKey: selected, onSelect: (r: NeedRow) => show(r.key), label: 'Waiting on you' })
        : h(Skeleton, { variant: 'rect', className: 'sh-skel' }),
    );

    // Phones: the list folds into one Select.
    render(
      pickEl,
      rows.length
        ? h(Select, {
            label: 'Waiting on you',
            hideLabel: true,
            size: 'md',
            value: row ? row.key : null,
            placeholder: 'Pick what to review',
            options: rows.map((r) => ({ value: r.key, label: r.title, description: r.line })),
            onValueChange: (v: string | null) => v && show(v),
          })
        : null,
    );

    // Not a branch: what it is and the link that handles it.
    cardEl.hidden = Boolean(branch) || !row;
    render(
      cardEl,
      !branch && row
        ? h(
            Card,
            { className: 'rq-item' },
            h(
              CardBody,
              { className: 'rq-item-body' },
              h('h2', { className: 'rq-item-title' }, row.title),
              h('p', { className: 't-body t-muted rq-item-line' }, row.line),
              h(ButtonLink, { variant: 'primary', href: row.href }, OPEN_LABEL[row.kind]),
            ),
          )
        : null,
    );

    // The footer: where the viewer is, Skip, and Approve and next when the open review offers an approval.
    footEl.hidden = !rows.length && !branch;
    // Nothing listed is selected (a branch opened from its link): Skip starts the queue.
    const skip = i < 0 ? (rows.length ? 0 : null) : skipIndex(rows.length, i);
    render(
      footEl,
      h(
        'div',
        { className: 'rq-foot-bar', role: 'group', 'aria-label': 'Move through the queue' },
        h(
          'p',
          { className: 't-ui t-muted rq-pos', 'aria-live': 'polite' },
          h('span', null, positionLabel(rows.length, i)),
          h('span', { className: 'rq-keys' }, h(Kbd, { keys: 'J', size: 'sm' }), ' ', h(Kbd, { keys: 'K', size: 'sm' }), ' to move'),
        ),
        h(
          'span',
          { className: 'rq-foot-actions' },
          h(Button, { variant: 'secondary', disabled: skip === null || busy, onClick: () => go(skip) }, 'Skip'),
          branch ? h(Button, { variant: 'primary', disabled: !canApprove || busy, loading: busy, onClick: () => void approveAndNext() }, 'Approve and next') : null,
        ),
      ),
    );
  }

  // Approve and next follows the open review: enabled only while it shows an approval the viewer can give.
  new MutationObserver(() => {
    const can = !detail.hidden && Boolean(detail.querySelector('[data-act="APPROVE"]'));
    if (can !== canApprove) {
      canApprove = can;
      paint();
    }
  }).observe(detail, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || layout.hidden || ownsKeys(e.target)) return;
    const move = keyMove(e);
    if (!move) return;
    const i = index();
    const to = i < 0 && move === 'next' ? (rows.length ? 0 : null) : moveIndex(rows.length, i, move);
    if (to === null) return;
    e.preventDefault();
    go(to);
  });

  // A deep link to a branch opens at once, before the list is read.
  if (selected && branchNumber(null, selected)) show(selected);
  else paint();

  let lastLogin: string | null | undefined;
  initGitHubConnect((v) => {
    const login = v?.login ?? null;
    // The viewer changed (or is known now): reopen the branch, the approvals it offers depend on who is connected.
    if (opened && login !== (lastLogin ?? null)) {
      canApprove = false;
      void openPr(opened, false);
    }
    lastLogin = login;
    const mine = ++run;
    loading = true;
    rows = [];
    failed = null;
    signedIn = Boolean(login);
    paint();
    void loadHome(stat, (d) => {
      if (mine !== run) return;
      signedIn = Boolean(d.viewer);
      failed = d.failed;
      loading = d.loading;
      rows = d.needs.filter((r) => !done.has(r.key));
      if (!d.loading && d.viewer && !d.failed) setReviewCount(d.decisions);
      if (!loading && !rows.length) {
        // Nothing waits: the empty state, nothing open behind it.
        if (opened !== null) closePr();
        opened = null;
        selected = null;
      } else if (d.settled && !rowOf(selected) && !(selected && branchNumber(null, selected))) {
        // The first row once the list is read and its order settled, unless the URL names a listed row or a branch.
        show(rows[0].key);
        return;
      } else if (opened && rowOf(selected)) {
        // A branch opened from its link: the URL follows the row once it is listed.
        history.replaceState(history.state, '', `${location.pathname}${searchFor(rowOf(selected))}`);
      }
      paint();
    });
  });
}
