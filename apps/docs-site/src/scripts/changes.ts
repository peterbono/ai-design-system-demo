// Studio Changes page controller: the four views (In review, Requests, Explorations, History) as tabs, a pull request opened in
// place (?pr=N), a component change request opened in place (?request=N), the local draft strip, and the routes old pages redirect to (?view=history, #other-branches, ?branch=).
import { initWorkFilter } from './work-filter';
import { closePr, initReviewAuth, loadList, openPr } from './reviews';
import { initHistory } from './history/page';
import { initRequests, loadRequests, openRequest } from './requests';
import { initExplorations, loadExplorations, openExploration, paintExplorationCount, startForRequest } from './explorations';
import type { ExplorationPullLike } from '../lib/explorations-view';
import type { PullLike } from '../lib/requests-view';
import { draftCount } from './shell';
import { docsEdits, draftSummary, tokenEdits } from '../lib/docs-draft-model';
import type { Draft } from '../lib/editor-model';
import { addableChanges, defaultTarget, draftDestination, type ChangePullLike } from '../lib/continue-change';
import { currentViewer, initGitHubConnect, onAccess, readRepo } from './github-session';

type View = 'review' | 'requests' | 'explorations' | 'history';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const tabs = () => [...document.querySelectorAll<HTMLAnchorElement>('[data-cg-view]')];
let listLoaded: Promise<{ number: number; head: { ref: string } }[]> | null = null;
const VIEW_QUERY: Record<View, string> = { review: '', requests: '?view=requests', explorations: '?view=explorations', history: '?view=history' };

/** The open pull requests In review already read (with their bodies), so Requests links them at no request. */
const openPullsForRequests = (): Promise<PullLike[] | null> | undefined =>
  listLoaded?.then((pulls) => (pulls.every((p) => 'body' in p) ? (pulls as unknown as PullLike[]) : null));

/** The same open pull requests for Explorations (the In review list is read once, explorations included). */
const openPullsForExplorations = () => {
  listLoaded ??= loadList();
  return listLoaded.then((pulls) => (pulls.every((p) => 'body' in p) ? (pulls as unknown as ExplorationPullLike[]) : null));
};

function selectTab(view: View) {
  for (const t of tabs()) {
    const on = t.dataset.cgView === view;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  $('cg-review').hidden = view !== 'review';
  $('cg-requests').hidden = view !== 'requests';
  $('cg-explore').hidden = view !== 'explorations';
  $('cg-history').hidden = view !== 'history';
}

function readDraft(): Draft {
  try {
    return (JSON.parse(localStorage.getItem('bridge.draft.v1') ?? 'null') as Draft | null) ?? { edits: [] };
  } catch {
    return { edits: [] };
  }
}

function paintDraft() {
  const n = draftCount();
  $('cg-draft').hidden = n === 0;
  const draft = readDraft();
  $('cg-draft-n').textContent = draftSummary(draft);
  // Docs edits only: send them from the edit mode of the first one's Library page.
  const docs = docsEdits(draft);
  const cta = document.querySelector<HTMLAnchorElement>('#cg-draft a');
  if (cta && docs.length && !tokenEdits(draft).length) cta.href = `/components/${docs[0]!.slug}/?edit=1`;
  paintDestination(tokenEdits(draft).length);
}

let canWrite = false;
/** Where the token draft goes when sent: the viewer's own change in review (the default target), else a new one. */
function paintDestination(edits: number) {
  const dest = document.getElementById('cg-draft-dest');
  if (!dest) return;
  const viewer = currentViewer()?.login;
  if (!edits || !viewer || !listLoaded) {
    dest.textContent = '';
    return;
  }
  void listLoaded.then((pulls) => {
    const r = readRepo();
    const targets = addableChanges(pulls as unknown as ChangePullLike[], { repo: `${r.owner}/${r.repo}`, viewer, write: canWrite });
    const choice = defaultTarget(targets);
    dest.textContent = draftDestination(choice.kind === 'change' ? (targets.find((t) => t.number === choice.number) ?? null) : null, edits);
  });
}

function showView(view: View) {
  closePr();
  $('cg-main').hidden = false;
  selectTab(view);
  if (view === 'history') initHistory();
  else if (view === 'requests') void loadRequests(openPullsForRequests());
  else if (view === 'explorations') void loadExplorations(openPullsForExplorations);
  else listLoaded ??= loadList();
  void listLoaded?.then((pulls) => paintExplorationCount(pulls as unknown as ExplorationPullLike[]));
}

function route() {
  const params = new URLSearchParams(location.search);
  const n = Number(params.get('pr'));
  if (n) {
    $('cg-main').hidden = true;
    void openPr(n, false);
    return;
  }
  const req = Number(params.get('request'));
  if (req) {
    closePr();
    $('cg-main').hidden = true;
    void openRequest(req, false, openPullsForRequests());
    return;
  }
  const ex = Number(params.get('exploration'));
  if (ex) {
    closePr();
    $('cg-main').hidden = true;
    void openExploration(ex, false);
    void loadExplorations(openPullsForExplorations);
    return;
  }
  const v = params.get('view');
  const view: View = v === 'history' || v === 'requests' || v === 'explorations' ? v : 'review';
  showView(view);
  // Start an exploration from a request: the form, filled from it.
  const forRequest = Number(params.get('for'));
  if (view === 'explorations' && forRequest) void startForRequest(forRequest);
  // From the Overview "Start a change", New component: the start form, open and empty.
  else if (view === 'explorations' && params.get('start') === 'new') {
    const opener = document.getElementById('ex-start-open');
    if (opener?.getAttribute('aria-expanded') !== 'true') opener?.click();
  }
  // Branch scope from the Studio header: open the pull request of that branch, if it has one.
  const branch = params.get('branch');
  if (view === 'review' && branch && listLoaded)
    void listLoaded.then((pulls) => {
      const match = pulls.find((p) => p.head.ref === branch);
      if (match) {
        $('cg-main').hidden = true;
        void openPr(match.number);
      }
    });
}

export function initChanges() {
  initWorkFilter();
  initReviewAuth();
  initExplorations();
  initRequests();
  paintDraft();
  initGitHubConnect(() => paintDraft());
  onAccess((a) => {
    canWrite = Boolean(a?.write);
    paintDraft();
  });
  document.addEventListener('bridge:draft', paintDraft);
  window.addEventListener('storage', paintDraft);
  document.addEventListener('bridge:changes-view', () => ($('cg-main').hidden = true));

  document.addEventListener('click', (e) => {
    const me = e as MouseEvent;
    if (me.metaKey || me.ctrlKey || me.shiftKey) return;
    const t = e.target as HTMLElement;
    const pr = t.closest<HTMLAnchorElement>('[data-open-pr]');
    if (pr) {
      e.preventDefault();
      $('cg-main').hidden = true;
      void openPr(Number(pr.dataset.openPr));
      return;
    }
    const rq = t.closest<HTMLAnchorElement>('[data-open-request]');
    if (rq) {
      e.preventDefault();
      $('cg-main').hidden = true;
      void openRequest(Number(rq.dataset.openRequest), true, openPullsForRequests());
      return;
    }
    const start = t.closest<HTMLAnchorElement>('[data-start-for]');
    if (start) {
      e.preventDefault();
      history.pushState({}, '', `?view=explorations&for=${Number(start.dataset.startFor)}`);
      route();
      window.scrollTo({ top: 0 });
      return;
    }
    const ex = t.closest<HTMLAnchorElement>('[data-open-exploration]');
    if (ex) {
      e.preventDefault();
      $('cg-main').hidden = true;
      void openExploration(Number(ex.dataset.openExploration));
      return;
    }
    if (t.closest('[data-back-explorations]')) {
      e.preventDefault();
      history.pushState({}, '', '?view=explorations');
      showView('explorations');
      return;
    }
    if (t.closest('[data-back-requests]')) {
      e.preventDefault();
      history.pushState({}, '', '?view=requests');
      showView('requests');
      return;
    }
    if (t.closest('[data-back]')) {
      e.preventDefault();
      history.pushState({}, '', location.pathname);
      showView('review');
      return;
    }
    const tab = t.closest<HTMLAnchorElement>('[data-cg-view]');
    if (tab) {
      e.preventDefault();
      const view = tab.dataset.cgView as View;
      history.pushState({}, '', VIEW_QUERY[view] || location.pathname);
      showView(view);
    }
  });

  // Tabs: arrow keys move between them (they are links, so Enter and middle click keep working).
  document.querySelector('[role="tablist"]')?.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight') return;
    const all = tabs();
    const i = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    e.preventDefault();
    const next = all[(i + (k === 'ArrowRight' ? 1 : -1) + all.length) % all.length]!;
    next.focus();
    next.click();
  });

  window.addEventListener('popstate', route);
  route();
  paintDraft();
}
