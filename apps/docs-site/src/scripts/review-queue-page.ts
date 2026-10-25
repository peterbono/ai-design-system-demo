// The review queue page (pages/studio/review.astro). Reads the same rows as the Studio home (scripts/home-data.ts
// loadHome), lists them on the start side with what the viewer did to each (components/ds/studio/ReviewQueue
// QueueList), and opens the selected one in the main area:
//   - a branch row opens the branch review of Branches in place (scripts/reviews.ts openPr into #rv-detail), without
//     its own bar: the queue's bar replaces it;
//   - a suggestion row (a change a developer applies once owners approve it) opens the suggestion review in place
//     (scripts/suggestions.ts openSuggestion into [data-rq-sg]), with its own decision on the card: the queue bar is for
//     branches; A and S press its Approve and Suggest changes, an approval waits for Undo the same way;
//   - usage guidance drafts, library health and setup rows show a short card with the link that handles them.
// The bar is about the item on screen only: comment, Suggest changes, Approve, More actions (Ask someone else to
// review, Copy link, Open the full review). After a decision the queue moves on: the list mark changes, the next item
// opens, focus goes to its title, and a toast says what was done. Approve waits UNDO_MS before anything is sent, so
// Undo only cancels: nothing reached GitHub, nobody was notified (dismissing a sent approval would leave a trace on
// the branch and notify its author). Leaving the page sends what waits. A approves, S suggests changes, J and K move.
// The URL keeps the selection (?pr=N or ?item=key) with replaceState only. Rules: lib/queue-nav.ts.
import { createElement as h, Fragment, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Badge, Button, Card, CardBody, EmptyState, Progress, Select, Skeleton, type UseToastReturn } from '@bridge-ds/react';
import { Inbox } from 'lucide-react';
import ButtonLink from '../components/ds/ButtonLink';
import { QueueBar, QueueList, QueueToasts } from '../components/ds/studio/ReviewQueue';
import { currentAccess, currentViewer, initGitHubConnect, prefersSignIn, readRepo } from './github-session';
import { joinHandlers } from './join-handlers';
import { viewerRole } from './needs-you';
import { loadDemoHome } from './demo-home';
import { exploresDemo } from '../lib/demo';
import { ENTRY_WORDS } from '../lib/entry';
import { setReviewCount } from './shell';
import { loadHome, type HomeStatic } from './home-data';
import { approveBranch, askSomeoneElse, closePr, openPr, suggestChanges } from './reviews';
import { closeSuggestion, forgetSuggestions, openSuggestion, type OpenedSuggestion } from './suggestions';
import { suggestionOfKey } from '../lib/suggestions-view';
import { branchOf, keyDecision, keyFromSearch, keyMove, moveIndex, nextOpen, outcomeLine, positionLabel, searchFor, UNDO_MS, type QueueOutcome } from '../lib/queue-nav';
import { reviewLink } from '../lib/review-page';
import { ghAction, ghButton } from '../lib/gh-wording';
import type { NeedKind, NeedRow } from '../lib/home-model';
import { studioHref } from '../lib/team-path';
import { demoApproved, isSampleTeam } from '../lib/demo';
import { rememberDemoApproval } from './demo-approvals';
import { repoContext } from './repo-context';

/** The sample team (lib/demo.ts): Approve is tried, nothing is sent; the rest opens the demo dialog. */
const onSampleTeam = () => {
  const r = repoContext();
  return isSampleTeam(`${r.owner}/${r.repo}`) && !currentViewer();
};

/** The link of a row that does not open a branch review, by kind. */
const OPEN_LABEL: Record<NeedKind, string> = {
  guidance: 'Review guidance',
  health: 'Open Quality',
  setup: 'Open settings',
  review: 'Open review',
  own: 'Open change',
  join: 'Open Members',
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

/** Typing, picking in a menu or a list box, or a dialog: the queue's keys belong to that control. */
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
  const toastEl = el('[data-rq-toasts]');
  const sgEl = el('[data-rq-sg]');
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
  /** The suggestion open in [data-rq-sg], and what it allows once read. */
  let openedSg: number | null = null;
  let sgState: OpenedSuggestion | null = null;
  /** What the viewer did here: decided rows stay listed and marked, even when a later read drops them. */
  const outcomes = new Map<string, QueueOutcome>();
  const decided = new Map<string, NeedRow>();
  /** Approvals waiting for Undo: sent when their time is up, or when the viewer leaves. */
  const waiting = new Map<string, { go: () => Promise<unknown>; timer: ReturnType<typeof setTimeout> }>();
  let canApprove = false;
  let canSuggest = false;
  let busy: 'approve' | 'suggest' | 'ask' | null = null;
  let said = '';
  let focusComment = 0;
  /** After a move, focus goes to the title of the item that opens. */
  let focusTitle = false;
  let toasts: UseToastReturn | null = null;
  let run = 0;

  render(toastEl, h(QueueToasts, { onReady: (api: UseToastReturn) => (toasts = api) }));

  const index = () => rows.findIndex((r) => r.key === selected);
  const rowOf = (key: string | null) => rows.find((r) => r.key === key) ?? null;

  /** The rows waiting after the current one, drawn stacked behind the suggestion card. */
  const nextCards = () => {
    const i = index();
    return rows
      .slice(i + 1)
      .filter((r) => !outcomes.has(r.key))
      .slice(0, 3)
      .map((r) => ({ key: r.key, title: r.title, person: r.person }));
  };

  function showSuggestionRow(sg: number | null) {
    if (sg === openedSg) return;
    openedSg = sg;
    sgState = null;
    if (sg === null) {
      closeSuggestion(sgEl);
      return;
    }
    void openSuggestion(sg, {
      el: sgEl,
      inQueue: true,
      next: nextCards(),
      approve: (_s, go) => approveLater(go),
      decided: (s, event) => {
        // An approval moved on when it was pressed (it waited for Undo); the others move on once GitHub has them.
        if (event === 'approve') return;
        const d = decide(event === 'decline' ? 'declined' : 'suggested');
        if (!d) return;
        toasts?.add({ title: outcomeLine(event === 'decline' ? 'declined' : 'suggested', s.title), tone: 'success' });
        advance(d.i);
      },
      opened: (s) => {
        sgState = s;
        if (s && focusTitle) {
          focusTitle = false;
          requestAnimationFrame(() => sgEl.querySelector<HTMLElement>('.sg-title')?.focus());
        }
      },
    });
  }

  function show(key: string | null) {
    if (key !== selected) {
      joinSaid = '';
      joinGitHub = false;
    }
    selected = key;
    const row = rowOf(key);
    const n = branchNumber(row, key);
    const sg = suggestionOfKey(row?.key ?? key);
    if (row) history.replaceState(history.state, '', `${location.pathname}${searchFor(row)}`);
    showSuggestionRow(sg);
    if (n) {
      if (opened !== n) {
        opened = n;
        canApprove = false;
        canSuggest = false;
        void openPr(n, false);
      }
    } else if (opened !== null) {
      opened = null;
      canApprove = false;
      canSuggest = false;
      closePr();
    }
    paint();
    if (focusTitle && !n && !sg) {
      focusTitle = false;
      requestAnimationFrame(() => cardEl.querySelector<HTMLElement>('.rq-item-title')?.focus());
    }
  }

  function go(to: number | null) {
    if (to === null || !rows[to]) return;
    show(rows[to].key);
  }

  /** After a decision on the row at `i`: the next row without an outcome opens, else the queue is done. */
  function advance(i: number) {
    const to = nextOpen(
      rows.map((r) => r.key),
      i,
      outcomes,
    );
    focusTitle = true;
    if (to === null) {
      if (opened !== null) closePr();
      opened = null;
      showSuggestionRow(null);
      selected = null;
      history.replaceState(history.state, '', location.pathname);
      said = 'Nothing else waits on you.';
      paint();
      return;
    }
    go(to);
  }

  function send(key: string) {
    const w = waiting.get(key);
    if (!w) return;
    waiting.delete(key);
    clearTimeout(w.timer);
    w.go().catch((err: Error) => {
      outcomes.delete(key);
      toasts?.error(`Not approved: ${rowOf(key)?.title ?? 'the change'}`, { description: `${err.message}. Open it and approve again.` });
      paint();
    });
  }

  function decide(outcome: QueueOutcome) {
    const i = index();
    const row = i >= 0 ? rows[i]! : null;
    if (!row) return;
    outcomes.set(row.key, outcome);
    decided.set(row.key, row);
    setReviewCount(rows.filter((r) => r.kind === 'review' && !outcomes.has(r.key)).length);
    return { i, row };
  }

  function approve(text: string) {
    if (busy || !canApprove || !opened) return;
    const n = opened;
    const d = decide('approved');
    if (!d) return;
    // The sample team: the approved state and what happens next, nothing sent.
    if (onSampleTeam()) {
      const w = demoApproved(d.row.person?.name ?? null, detail.dataset.codeNext || null, detail.hasAttribute('data-values-only'));
      // Once Undo has passed, the visit remembers it: the home and the branch say Approved too (scripts/demo-approvals.ts).
      later(d, async () => rememberDemoApproval(n), `${w.next} ${w.note}`);
      return;
    }
    later(d, () => approveBranch(n, text));
  }

  /** A suggestion's Approve: the same Undo window as a branch, then scripts/suggestions.ts posts the review. */
  function approveLater(go: () => Promise<void>) {
    if (busy) return;
    const d = decide('approved');
    if (!d) return;
    later(d, async () => {
      await go();
      forgetSuggestions();
    });
  }

  /** Waits UNDO_MS with an Undo toast, then sends; the queue moves on at once. */
  function later(d: { i: number; row: NeedRow }, go: () => Promise<unknown>, description?: string) {
    const key = d.row.key;
    // Nothing is sent before the toast closes: Undo only cancels.
    waiting.set(key, { go, timer: setTimeout(() => send(key), UNDO_MS) });
    const toastId = toasts?.add({
      title: outcomeLine('approved', d.row.title),
      ...(description ? { description } : {}),
      tone: 'success',
      timeout: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const w = waiting.get(key);
          if (!w) return;
          clearTimeout(w.timer);
          waiting.delete(key);
          outcomes.delete(key);
          if (toastId) toasts?.close(toastId);
          toasts?.info(`Not approved: ${d.row.title}`, { description: 'Nothing was sent.', timeout: 3000 });
          focusTitle = true;
          show(key);
        },
      },
    });
    advance(d.i);
  }

  async function act(kind: 'suggest' | 'ask', text = '') {
    if (busy || !opened) return;
    if (onSampleTeam()) {
      const { openMakeItYours } = await import('./demo-gate');
      await openMakeItYours();
      return;
    }
    const n = opened;
    busy = kind;
    said = '';
    paint();
    try {
      const names = kind === 'suggest' ? (await suggestChanges(n, text), null) : await askSomeoneElse(n);
      busy = null;
      const d = decide(kind === 'suggest' ? 'suggested' : 'asked');
      if (!d) return;
      toasts?.add({ title: outcomeLine(kind === 'suggest' ? 'suggested' : 'asked', d.row.title), description: names ? `Asked ${names.join(', ')}.` : undefined, tone: 'success' });
      advance(d.i);
    } catch (err) {
      busy = null;
      said = (err as Error).message;
      paint();
    }
  }

  // Join requests: Approve and Decline in the queue card (scripts/join-handlers, the same calls as the Home).
  const { owner: repoOwner, repo: repoName } = readRepo();
  let joinBusy: 'approve' | 'decline' | null = null;
  let joinSaid = '';
  let joinGitHub = false;
  const join = joinHandlers(
    () => `${repoOwner}/${repoName}`,
    () => undefined,
  );
  async function decideJoin(row: NeedRow, approve: boolean) {
    if (joinBusy) return;
    joinBusy = approve ? 'approve' : 'decline';
    joinSaid = '';
    paint();
    const o = await join.decide(row, approve);
    joinBusy = null;
    if (!o.ok) {
      joinGitHub = o.github;
      joinSaid = o.github ? '' : o.text;
      paint();
      return;
    }
    const d = decide(approve ? 'approved' : 'declined');
    if (!d) return;
    const toastId = toasts?.add({
      title: o.text,
      tone: 'success',
      action:
        o.undo && join.undo
          ? {
              label: ENTRY_WORDS.undo,
              onClick: () => {
                void join.undo!(row).then((u) => {
                  if (!u.ok) return toasts?.error(u.text || ENTRY_WORDS.githubToManage);
                  // The decision is taken back: its toast (and its Undo) goes, the new one says so.
                  if (toastId) toasts?.close(toastId);
                  outcomes.delete(row.key);
                  toasts?.info(u.text);
                  paint();
                });
              },
            }
          : undefined,
    });
    advance(d.i);
  }

  function emptyState() {
    const signIn = prefersSignIn();
    // The sample team: no GitHub sign-in here, the banner's "Get started" is its one way in. Home lists what waits.
    if (onSampleTeam())
      return h(EmptyState, {
        icon: Inbox,
        size: 'lg',
        headingLevel: 2,
        title: 'Nothing to review here.',
        description: failed ?? 'Home lists the changes waiting on the lead of this sample team.',
        actions: h(ButtonLink, { variant: 'primary', href: studioHref() }, 'Back to Home'),
      });
    return h(EmptyState, {
      icon: Inbox,
      size: 'lg',
      headingLevel: 2,
      title: 'Nothing waits on you.',
      // Someone without a review right (an email member or admin, a GitHub reader: needs-you viewerRole): this queue is
      // the reviewers'; what comes back to them is on Home, never "new reviews land here".
      description:
        failed ??
        (!signedIn
          ? `${ghAction('see what waits on you', signIn)}.`
          : viewerRole() !== 'reviewer'
            ? 'Reviewers look at changes here. When one sends your change back, it shows on Home.'
            : 'New reviews, usage guidance drafts and library checks land here.'),
      actions: signedIn
        ? h(ButtonLink, { variant: 'primary', href: studioHref() }, 'Back to Home')
        : h(
            Fragment,
            null,
            h(Button, { variant: 'primary', 'data-gh-open': '', 'data-gh-signin': signIn ? '' : undefined } as ComponentProps<typeof Button>, ghButton(signIn)),
            h(ButtonLink, { variant: 'secondary', href: studioHref() }, 'Back to Home'),
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

    render(
      sideEl,
      rows.length ? h(QueueList, { rows, selected, outcomes, onSelect: (k: string) => show(k) }) : h(Skeleton, { variant: 'rect', className: 'sh-skel' }),
    );

    // Phones: the list folds into one Select.
    render(
      pickEl,
      rows.length
        ? h(
            Fragment,
            null,
            // Where the viewer is, as on the wide list: the count and the progress above the picker.
            h('p', { className: 'rq-count' }, h('strong', null, 'Review all'), h('span', { className: 'rq-muted' }, ` · ${i >= 0 ? positionLabel(rows.length, i) : `${rows.length} waiting`}`)),
            h(Progress, { value: outcomes.size, max: rows.length, size: 'sm', 'aria-label': `${outcomes.size} of ${rows.length} done` }),
            h(Select, {
              label: 'Waiting on you',
              hideLabel: true,
              size: 'md',
              value: row ? row.key : null,
              placeholder: 'Pick what to review',
              options: rows.map((r) => ({ value: r.key, label: r.title, description: outcomes.has(r.key) ? outcomeLine(outcomes.get(r.key)!, '').trim() : r.line })),
              onValueChange: (v: string | null) => v && show(v),
            }),
          )
        : null,
    );

    // Not a branch nor a suggestion: what it is and the link that handles it.
    const sg = suggestionOfKey(row?.key ?? selected);
    sgEl.hidden = !sg;
    cardEl.hidden = Boolean(branch) || Boolean(sg) || !row;
    render(
      cardEl,
      !branch && !sg && row
        ? h(
            Card,
            { className: 'rq-item' },
            h(
              CardBody,
              { className: 'rq-item-body' },
              h('h2', { className: 'rq-item-title', tabIndex: -1 }, row.title),
              h('p', { className: 't-body t-muted rq-item-line' }, row.line),
              // A join request: the role it gets and how long it waits, then Decline and Approve right here.
              row.kind === 'join' && row.detail ? h('p', { className: 't-ui t-muted rq-item-line' }, row.detail) : null,
              row.kind === 'join' && row.pill ? h(Badge, { tone: row.pill.tone, size: 'sm' }, row.pill.label) : null,
              row.kind === 'join' && row.request
                ? h(
                    'div',
                    { className: 'rq-join' },
                    joinSaid ? h('p', { className: 't-ui t-muted', role: 'status' }, joinSaid) : null,
                    joinGitHub
                      ? h(Button, { variant: 'link', onClick: () => join.connectGitHub() }, ENTRY_WORDS.githubToManage)
                      : h(
                          Fragment,
                          null,
                          h(Button, { variant: 'secondary', loading: joinBusy === 'decline', disabled: Boolean(joinBusy), 'aria-label': `${ENTRY_WORDS.decline} ${row.request.name}`, onClick: () => void decideJoin(row, false) }, ENTRY_WORDS.decline),
                          h(Button, { variant: 'primary', loading: joinBusy === 'approve', disabled: Boolean(joinBusy), 'aria-label': `${ENTRY_WORDS.approve} ${row.request.name}`, onClick: () => void decideJoin(row, true) }, ENTRY_WORDS.approve),
                        ),
                  )
                : h(ButtonLink, { variant: 'primary', href: row.href }, OPEN_LABEL[row.kind]),
            ),
          )
        : null,
    );

    footEl.hidden = !branch;
    render(
      footEl,
      h(QueueBar, {
        canApprove: Boolean(branch) && canApprove && !outcomes.has(selected ?? ''),
        canSuggest: Boolean(branch) && canSuggest && !outcomes.has(selected ?? ''),
        branch: Boolean(branch),
        busy,
        said,
        onApprove: approve,
        onSuggest: (text: string) => void act('suggest', text),
        onAsk: () => void act('ask'),
        links: branch && detail.dataset.developer ? { review: reviewLink(location.origin, branch), developer: detail.dataset.developer } : null,
        focusComment,
      }),
    );
  }

  // What the open review offers (scripts/reviews.ts marks #rv-detail), and focus on its title after a move.
  let lastDev = '';
  new MutationObserver(() => {
    const a = !detail.hidden && detail.hasAttribute('data-can-approve');
    const s = !detail.hidden && detail.hasAttribute('data-can-suggest');
    const dev = detail.dataset.developer ?? '';
    if (a !== canApprove || s !== canSuggest || dev !== lastDev) {
      canApprove = a;
      canSuggest = s;
      lastDev = dev;
      paint();
    }
    const title = detail.querySelector<HTMLElement>('.br-title');
    if (focusTitle && title) {
      focusTitle = false;
      title.tabIndex = -1;
      title.focus();
    }
  }).observe(detail, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-can-approve', 'data-can-suggest', 'data-developer'] });

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || layout.hidden || ownsKeys(e.target)) return;
    const move = keyMove(e);
    if (move) {
      const i = index();
      const to = i < 0 && move === 'next' ? (rows.length ? 0 : null) : moveIndex(rows.length, i, move);
      if (to === null) return;
      e.preventDefault();
      go(to);
      return;
    }
    const decision = keyDecision(e);
    if (decision && openedSg && sgState) {
      // A suggestion: its own buttons, when the viewer may press them.
      const btn = sgEl.querySelector<HTMLButtonElement>(decision === 'approve' ? '[data-sg-approve]' : '[data-sg-suggest]');
      if (!btn || btn.disabled) return;
      e.preventDefault();
      btn.click();
      return;
    }
    if (!decision || !opened) return;
    e.preventDefault();
    if (decision === 'approve') approve('');
    else {
      // S: the comment says what to change, so it opens the field first.
      focusComment++;
      paint();
    }
  });

  // Leaving the page sends what waits for Undo: an approval is never lost silently.
  window.addEventListener('pagehide', () => [...waiting.keys()].forEach(send));

  // A deep link to a branch or a suggestion opens at once, before the list is read.
  if (selected && (branchNumber(null, selected) || suggestionOfKey(selected))) show(selected);
  else paint();

  let lastLogin: string | null | undefined;
  initGitHubConnect((v) => {
    const login = v?.login ?? null;
    // The viewer changed (or is known now): reopen the branch, the approvals it offers depend on who is connected.
    if (opened && login !== (lastLogin ?? null)) {
      canApprove = false;
      void openPr(opened, false);
    }
    if (openedSg && lastLogin !== undefined && login !== lastLogin) {
      const n = openedSg;
      openedSg = null;
      showSuggestionRow(n);
    }
    lastLogin = login;
    const mine = ++run;
    loading = true;
    rows = [];
    failed = null;
    signedIn = Boolean(login ?? currentViewer());
    paint();
    // The demo, for a visitor who cannot change it: the lead's queue, the same rows as its home (lib/waiting-on),
    // read-only. "Review all" on the home always lands here.
    const { owner, repo } = readRepo();
    if (exploresDemo({ repo: `${owner}/${repo}`, signedIn: Boolean(login), write: login ? (currentAccess()?.write ?? null) : false })) {
      signedIn = false;
      void loadDemoHome(stat, (d) => {
        if (mine !== run) return;
        failed = d.failed;
        loading = d.loading;
        rows = d.needs;
        if (!loading && rows.length && !rowOf(selected) && !(selected && (branchNumber(null, selected) || suggestionOfKey(selected)))) {
          show(rows[0]!.key);
          return;
        }
        paint();
      });
      return;
    }
    void loadHome(stat, (d) => {
      if (mine !== run) return;
      signedIn = Boolean(d.viewer);
      failed = d.failed;
      loading = d.loading;
      // Rows decided here stay listed, marked, even once GitHub no longer lists them as waiting.
      const listed = new Set(d.needs.map((r) => r.key));
      rows = [...[...decided.values()].filter((r) => !listed.has(r.key)), ...d.needs];
      if (!d.loading && d.viewer && !d.failed) setReviewCount(d.decisions);
      if (!loading && !rows.length) {
        if (opened !== null) closePr();
        opened = null;
        showSuggestionRow(null);
        selected = null;
      } else if (d.settled && !rowOf(selected) && !(selected && (branchNumber(null, selected) || suggestionOfKey(selected)))) {
        // The first row once the list is read and its order settled, unless the URL names a listed row or a branch.
        const first = rows.findIndex((r) => !outcomes.has(r.key));
        show(rows[first < 0 ? 0 : first]!.key);
        return;
      } else if (opened && rowOf(selected)) {
        history.replaceState(history.state, '', `${location.pathname}${searchFor(rowOf(selected))}`);
      }
      paint();
    });
  });
}
