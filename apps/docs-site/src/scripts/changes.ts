// Studio Branches page controller: the list (every branch, explorations included), the views the header and old
// addresses reach (History ?view=history, the exploration start form ?view=explorations&start=new or &for=N, Requests
// ?view=requests when request triage is on in Studio, lib/studio-flags), a branch opened in place (?pr=N), a component
// change request opened in place (?request=N), a suggestion opened in place (?suggestion=N, scripts/suggestions.ts),
// the local draft strip, and the routes old pages redirect to
// (#other-branches, ?branch=). The header names the view: "Branches" with a History link, or the view's own name with
// a link back to all branches.
import { initWorkFilter } from './work-filter';
import { closePr, initReviewAuth, loadList, openPr, setWaitingExtras } from './reviews';
import { readWaitingExtras } from './waiting-extras';
import { initHistory } from './history/page';
import { initRequests, loadRequests, openRequest } from './requests';
import { closeSuggestion, onViewerChange, openSuggestion } from './suggestions';
import { explorationParam } from '../lib/explorations-view';
import { initExplorations, loadExplorations, openExploration, paintExplorationCount, startForRequest } from './explorations';
import type { ExplorationPullLike } from '../lib/explorations-view';
import type { PullLike } from '../lib/requests-view';
import { draftCount } from './shell';
import { docsEdits, draftSummary, tokenEdits } from '../lib/docs-draft-model';
import type { Draft } from '../lib/editor-model';
import { addableChanges, defaultTarget, draftDestination, type ChangePullLike } from '../lib/continue-change';
import { currentViewer, initGitHubConnect, onAccess, readRepo } from './github-session';
import { REQUEST_TRIAGE_IN_STUDIO } from '../lib/studio-flags';
import { studioHref } from '../lib/team-path';
import { sendButton } from '../lib/gh-wording';
import { changesModeOnPage } from './changes-mode';

type View = 'review' | 'requests' | 'explorations' | 'history';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let listLoaded: Promise<{ number: number; head: { ref: string } }[]> | null = null;
let extrasLoaded: Promise<void> | null = null;
const VIEW_QUERY: Record<View, string> = { review: '', requests: '?view=requests', explorations: '?view=explorations', history: '?view=history' };

/** The open pull requests In review already read (with their bodies), so Requests links them at no request. */
const openPullsForRequests = (): Promise<PullLike[] | null> | undefined =>
  listLoaded?.then((pulls) => (pulls.every((p) => 'body' in p) ? (pulls as unknown as PullLike[]) : null));

/** The same open pull requests for Explorations (the In review list is read once, explorations included). */
const openPullsForExplorations = () => {
  listLoaded ??= loadList();
  return listLoaded.then((pulls) => (pulls.every((p) => 'body' in p) ? (pulls as unknown as ExplorationPullLike[]) : null));
};

const VIEW_TITLE: Record<View, string> = { review: 'Changes', requests: 'Requests', explorations: 'Explorations', history: 'History' };

function selectTab(view: View) {
  const title = document.querySelector<HTMLElement>('#cg-main .st-title');
  if (title) title.textContent = VIEW_TITLE[view];
  $('cg-history-link').hidden = view !== 'review';
  $('cg-back-link').hidden = view === 'review';
  // One primary per view: History and the start form have their own, so Create branch steps down to secondary there
  // (components/ds/studio/StartChange START_CHANGE_EVENT; on the list the selection bar decides).
  // The island reads data-start-variant when it mounts after this, and the event when it is already there.
  const variant = view !== 'review' || document.querySelector('.cg-bar') ? 'secondary' : 'primary';
  const slot = document.querySelector<HTMLElement>('[data-greet]');
  if (slot) slot.dataset.startVariant = variant;
  document.dispatchEvent(new CustomEvent('bridge:start-change', { detail: { variant, hidden: false } }));
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
  // The same verb as the editor it opens: "Send suggestion" in suggest mode, "Send for review" in direct mode.
  const label = cta ? [...cta.querySelectorAll('*'), cta].find((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) : null;
  const text = label && [...label.childNodes].find((n) => n.nodeType === 3 && n.textContent?.trim());
  if (text) text.textContent = sendButton(docs.length && !tokenEdits(draft).length ? 'docs' : 'tokens', changesModeOnPage());
  paintDestination(tokenEdits(draft).length);
}

let canWrite = false;
/** Where the token draft goes when sent: the viewer's own branch in review (the default target), else a new one. */
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

/** The suggestion review host (pages/studio/changes.astro), beside #rv-detail. */
const sgHost = () => document.getElementById('sg-detail');

/** Opens suggestion `n` in place, with the way back to all branches. */
function showSuggestion(n: number, push: boolean) {
  closePr();
  $('cg-main').hidden = true;
  if (push) history.pushState({ suggestion: n }, '', `?suggestion=${n}`);
  window.scrollTo({ top: 0 });
  const el = sgHost();
  if (el) void openSuggestion(n, { el, crumbs: [{ label: 'Changes', href: studioHref('changes/') }, { label: 'Suggestion' }] });
}

function showView(view: View) {
  closePr();
  closeSuggestion(sgHost());
  $('cg-main').hidden = false;
  selectTab(view);
  if (view === 'history') initHistory();
  else if (view === 'requests') void loadRequests(openPullsForRequests());
  else if (view === 'explorations') void loadExplorations(openPullsForExplorations);
  else {
    listLoaded ??= loadList();
    // Waiting on me also lists the suggestions that wait on the viewer (no guidance drafts here: Home has them).
    extrasLoaded ??= listLoaded.then(() => readWaitingExtras({ ...readRepo(), guidance: [] })).then(setWaitingExtras, () => undefined);
  }
  void listLoaded?.then((pulls) => paintExplorationCount(pulls as unknown as ExplorationPullLike[]));
}

function route() {
  const params = new URLSearchParams(location.search);
  const sg = Number(params.get('suggestion'));
  if (sg) {
    showSuggestion(sg, false);
    return;
  }
  closeSuggestion(sgHost());
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
  const asked = explorationParam(location.search);
  const ex = asked?.number ?? 0;
  if (ex) {
    closePr();
    $('cg-main').hidden = true;
    void openExploration(ex, false, asked?.product ?? null);
    void loadExplorations(openPullsForExplorations);
    return;
  }
  const v = params.get('view');
  // Request triage off (teams triage in Jira): ?view=requests opens All branches. Explorations are rows of the list:
  // ?view=explorations opens its own view only to start one (Create branch > New component, or from a request).
  const starting = Boolean(Number(params.get('for'))) || params.get('start') === 'new';
  const view: View = v === 'history' || (v === 'explorations' && starting) || (v === 'requests' && REQUEST_TRIAGE_IN_STUDIO) ? v : 'review';
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
      closeSuggestion(sgHost());
      $('cg-main').hidden = true;
      void openPr(Number(pr.dataset.openPr));
      return;
    }
    const sg = t.closest<HTMLAnchorElement>('[data-open-suggestion]');
    if (sg) {
      e.preventDefault();
      showSuggestion(Number(sg.dataset.openSuggestion), true);
      return;
    }
    const rq = t.closest<HTMLAnchorElement>('[data-open-request]');
    if (rq) {
      e.preventDefault();
      closeSuggestion(sgHost());
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
      closeSuggestion(sgHost());
      $('cg-main').hidden = true;
      void openExploration(Number(ex.dataset.openExploration), true, ex.dataset.product || null);
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

  window.addEventListener('popstate', route);
  // A change that turns out to be an exploration (scripts/reviews.ts openPr): its own page, at its own address.
  document.addEventListener('bridge:open-exploration', (e) => {
    const n = Number((e as CustomEvent<{ number: number }>).detail?.number);
    if (!n) return;
    e.preventDefault();
    history.replaceState({ exploration: n, product: null }, '', `?exploration=${n}`);
    route();
  });
  // What the viewer may do on a suggestion depends on who is connected.
  onViewerChange(() => {
    const sg = Number(new URLSearchParams(location.search).get('suggestion'));
    if (sg) showSuggestion(sg, false);
  });
  route();
  paintDraft();
}
