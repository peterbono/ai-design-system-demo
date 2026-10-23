// Team Branches (team shell /studio/<owner>/<repo>/changes/, multi-team): the team's open branches and suggestions,
// with the same loaders as the self-hosted Branches page (scripts/reviews.ts loadList, BranchesList) and the same
// in-place reviews (?pr=N: the branch review; ?suggestion=N: the suggestion review). The team's repo model is read
// first (scripts/team-data.ts, with its progress) because reviews.ts reads the team's settings (owners, rights,
// products) when it loads. The views the self-hosted page reaches by address work for the team too, with the same
// modules: History (scripts/history/page.ts, read from the team's GitHub history when signed in, from its published
// activity.json for a guest), a component change
// request in place (scripts/requests.ts, the team's request issues), Requests when triage is on in Studio, and the
// exploration start form (scripts/explorations.ts, against the team's repository, following its "changes" mode; in
// direct mode the first write asks for Bridge Direct's OK, scripts/github-session.ts).
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { listSuggestionsOnGitHub, stalenessStatus } from '@bridge-ds/core';
import { TeamLoadError, TeamLoadProgress } from '../components/ds/studio/TeamState';
import { loadTeamData, resetTeamData, teamOfPage, type TeamData } from './team-data';
import { suggestionRows, TEAM_VIEW_TITLE, teamBranchesRoute } from '../lib/team-branches';
import { teamFailure } from '../lib/team-load';
import type { PullLike } from '../lib/requests-view';
import type { ExplorationPullLike } from '../lib/explorations-view';
import { studioHref } from '../lib/team-path';
import { teamGuidance } from '../lib/team-facts';
import { readWaitingExtras } from './waiting-extras';

const $ = (id: string) => document.getElementById(id);

export async function initTeamBranches(): Promise<void> {
  const state = document.querySelector<HTMLElement>('[data-tb-state]');
  const main = $('cg-main');
  if (!state || !main) return;
  let stateRoot: Root | null = createRoot(state);
  stateRoot.render(createElement(TeamLoadProgress, { label: "Reading this team's branches" }));

  let data: TeamData;
  try {
    data = await loadTeamData();
  } catch (err) {
    const team = teamOfPage();
    state.classList.remove('lp-wait');
    stateRoot.render(
      createElement(TeamLoadError, {
        failure: teamFailure(err, team ? `${team.owner}/${team.repo}` : 'this repository'),
        onRetry: () => {
          resetTeamData();
          location.reload();
        },
      }),
    );
    return;
  }
  stateRoot.unmount();
  stateRoot = null;
  state.remove();

  const list = $('cg-list');
  if (list) list.dataset.tokensRoot = data.model.tokens.root;
  // What the self-hosted page embeds at build time (#bridge-branches), from the team: no preview apps of its own yet.
  if (!$('bridge-branches')) {
    const cfg = document.createElement('script');
    cfg.type = 'application/json';
    cfg.id = 'bridge-branches';
    cfg.textContent = JSON.stringify({ owner: data.owner, repo: data.repo, defaultBranch: data.defaultBranch, apps: {}, packages: [] });
    document.body.append(cfg);
  }
  // Loaded once the team's settings are known: reviews.ts reads them when it loads.
  const reviews = await import('./reviews');
  const suggestions = await import('./suggestions');
  const sgHost = $('sg-detail');
  const header = document.querySelector<HTMLElement>('[data-team-shell] > .st-head');
  let listLoaded: ReturnType<typeof reviews.loadList> | null = null;
  let suggestionsLoaded: Promise<void> | null = null;
  let extrasLoaded: Promise<void> | null = null;

  type MainView = keyof typeof TEAM_VIEW_TITLE;
  const panels: Record<MainView, HTMLElement | null> = { list: $('cg-review'), history: $('cg-history'), requests: $('cg-requests'), explorations: $('cg-explore') };
  // The list, or one of the views the header and addresses reach; null: a branch, suggestion or request in place,
  // which has its own title and way back.
  const showMain = (view: MainView | null) => {
    main.hidden = view === null;
    if (header) header.hidden = view === null;
    if (view === null) return;
    const title = header?.querySelector('.st-title');
    if (title) title.textContent = TEAM_VIEW_TITLE[view];
    const historyLink = $('cg-history-link');
    const backLink = $('cg-back-link');
    if (historyLink) historyLink.hidden = view !== 'list';
    if (backLink) backLink.hidden = view === 'list';
    for (const [k, el] of Object.entries(panels)) if (el) el.hidden = k !== view;
  };

  const paintSuggestions = async () => {
    const el = $('tb-suggestions');
    if (!el) return;
    try {
      const items = await listSuggestionsOnGitHub(data.client, { state: 'open' });
      const { paintTeamSuggestions } = await import('../components/ds/studio/TeamSuggestions');
      paintTeamSuggestions(el, suggestionRows(items));
      if (items.length) $('cg-empty')?.setAttribute('hidden', '');
      // Then whether main made any outdated (the status its page and the MCP server say), with a token only.
      const outdated = await suggestions.outdatedOf(items, data.client).catch(() => new Set<number>());
      if (outdated.size) paintTeamSuggestions(el, suggestionRows(items.map((i) => (outdated.has(i.number) ? { ...i, status: stalenessStatus(i.status, { outdated: true }) } : i))));
    } catch {
      // The branches list says when GitHub cannot be read; suggestions only add rows.
    }
  };

  // The team's open pull requests, read once by the list, for requests (which close them) and explorations.
  // Null when the list was read without bodies: each module then reads what it needs itself.
  const openPulls = <T,>(): Promise<T[] | null> => {
    listLoaded ??= reviews.loadList();
    return listLoaded.then((pulls) => (pulls.every((p) => 'body' in p) ? (pulls as unknown as T[]) : null));
  };
  // Loaded on first use: each reads the team's repository and settings when it loads, known by now.
  let requests: typeof import('./requests') | null = null;
  let explorations: typeof import('./explorations') | null = null;
  const loadRequestsModule = async () => {
    if (!requests) {
      requests = await import('./requests');
      requests.initRequests();
    }
    return requests;
  };
  const loadExplorationsModule = async () => {
    if (!explorations) {
      explorations = await import('./explorations');
      explorations.initExplorations();
    }
    return explorations;
  };

  const route = async () => {
    const r = teamBranchesRoute(location.search);
    if (r.view !== 'suggestion') suggestions.closeSuggestion(sgHost);
    if (r.view === 'pr') {
      showMain(null);
      void reviews.openPr(r.n, false);
      return;
    }
    reviews.closePr();
    if (r.view === 'suggestion') {
      showMain(null);
      if (sgHost) void suggestions.openSuggestion(r.n, { el: sgHost, crumbs: [{ label: 'Branches', href: studioHref('changes/') }, { label: 'Suggestion' }] });
      return;
    }
    if (r.view === 'request') {
      showMain(null);
      const m = await loadRequestsModule();
      void m.openRequest(r.n, false, openPulls<PullLike>());
      return;
    }
    if (r.view === 'history') {
      showMain('history');
      const { initHistory } = await import('./history/page');
      initHistory();
      return;
    }
    if (r.view === 'requests') {
      showMain('requests');
      const m = await loadRequestsModule();
      void m.loadRequests(openPulls<PullLike>());
      return;
    }
    if (r.view === 'explorations') {
      showMain('explorations');
      const m = await loadExplorationsModule();
      void m.loadExplorations(() => openPulls<ExplorationPullLike>());
      // Started for a request: the form, filled from it; from Create branch > New component: the form, open.
      if (r.forRequest) void m.startForRequest(r.forRequest);
      else {
        const opener = $('ex-start-open');
        if (opener?.getAttribute('aria-expanded') !== 'true') opener?.click();
      }
      return;
    }
    showMain('list');
    listLoaded ??= reviews.loadList();
    suggestionsLoaded ??= listLoaded.then(paintSuggestions);
    extrasLoaded ??= listLoaded.then(() => readWaitingExtras({ owner: data.owner, repo: data.repo, guidance: teamGuidance(data) })).then(reviews.setWaitingExtras, () => undefined);
  };
  const go = (search: string) => {
    history.pushState({}, '', search || location.pathname);
    void route();
    window.scrollTo({ top: 0 });
  };

  reviews.initReviewAuth();
  document.addEventListener('bridge:changes-view', () => showMain(null));
  document.addEventListener('click', (e) => {
    const me = e as MouseEvent;
    if (me.metaKey || me.ctrlKey || me.shiftKey || me.button !== 0) return;
    const t = e.target as HTMLElement;
    const pr = t.closest<HTMLElement>('[data-open-pr], [data-open-exploration]');
    const sg = t.closest<HTMLElement>('[data-open-suggestion]');
    const rq = t.closest<HTMLElement>('[data-open-request]');
    const n = Number(pr?.dataset.openPr ?? pr?.dataset.openExploration ?? sg?.dataset.openSuggestion ?? rq?.dataset.openRequest);
    if (n) {
      e.preventDefault();
      go(sg ? `?suggestion=${n}` : rq ? `?request=${n}` : `?pr=${n}`);
      return;
    }
    const start = t.closest<HTMLElement>('[data-start-for]');
    if (start) {
      e.preventDefault();
      go(`?view=explorations&for=${Number(start.dataset.startFor)}`);
      return;
    }
    if (t.closest('[data-back-requests]')) {
      e.preventDefault();
      go('?view=requests');
      return;
    }
    if (t.closest('[data-back]')) {
      e.preventDefault();
      go('');
      return;
    }
    const tab = t.closest<HTMLElement>('[data-cg-view]');
    if (tab) {
      e.preventDefault();
      go(tab.dataset.cgView === 'history' ? '?view=history' : '');
    }
  });
  window.addEventListener('popstate', () => void route());
  void route();
}
