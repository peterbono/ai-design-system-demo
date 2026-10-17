// Studio Changes page controller: the two views (In review, History) as tabs, a pull request opened in place
// (?pr=N), the local draft strip, and the routes old pages redirect to (?view=history, #other-branches, ?branch=).
import { closePr, initReviewAuth, loadList, openPr } from './reviews';
import { initHistory } from './history/page';
import { draftCount } from './shell';
import { docsEdits, draftSummary, tokenEdits } from '../lib/docs-draft-model';
import type { Draft } from '../lib/editor-model';

type View = 'review' | 'history';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const tabs = () => [...document.querySelectorAll<HTMLAnchorElement>('[data-cg-view]')];
let listLoaded: Promise<{ number: number; head: { ref: string } }[]> | null = null;

function selectTab(view: View) {
  for (const t of tabs()) {
    const on = t.dataset.cgView === view;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  $('cg-review').hidden = view !== 'review';
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
  // Docs edits only: propose them from the docs editor of the first one.
  const docs = docsEdits(draft);
  const cta = document.querySelector<HTMLAnchorElement>('#cg-draft a');
  if (cta && docs.length && !tokenEdits(draft).length) cta.href = `/studio/components/docs/${docs[0]!.slug}/`;
}

function showView(view: View) {
  closePr();
  $('cg-main').hidden = false;
  selectTab(view);
  if (view === 'history') initHistory();
  else listLoaded ??= loadList();
}

function route() {
  const params = new URLSearchParams(location.search);
  const n = Number(params.get('pr'));
  if (n) {
    $('cg-main').hidden = true;
    void openPr(n, false);
    return;
  }
  const view: View = params.get('view') === 'history' ? 'history' : 'review';
  showView(view);
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
  initReviewAuth();
  paintDraft();
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
      history.pushState({}, '', view === 'history' ? '?view=history' : location.pathname);
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
}
