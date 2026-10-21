// Team Branches (team shell /studio/<owner>/<repo>/changes/, multi-team): the team's open branches and suggestions,
// with the same loaders as the self-hosted Branches page (scripts/reviews.ts loadList, BranchesList) and the same
// in-place reviews (?pr=N: the branch review; ?suggestion=N: the suggestion review). The team's repo model is read
// first (scripts/team-data.ts, with its progress) because reviews.ts reads the team's settings (owners, rights,
// products) when it loads. History, requests and explorations stay on the demo for now.
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { listSuggestionsOnGitHub } from '@bridge-ds/core';
import { TeamLoadError, TeamLoadProgress } from '../components/ds/studio/TeamState';
import { loadTeamData, resetTeamData, teamOfPage, type TeamData } from './team-data';
import { suggestionRows, teamBranchesRoute } from '../lib/team-branches';
import { teamFailure } from '../lib/team-load';
import { studioHref } from '../lib/team-path';

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
  let listLoaded: Promise<unknown> | null = null;
  let suggestionsLoaded: Promise<void> | null = null;

  const showList = (on: boolean) => {
    main.hidden = !on;
    // A branch or a suggestion in place has its own title and way back.
    if (header) header.hidden = !on;
  };

  const paintSuggestions = async () => {
    const el = $('tb-suggestions');
    if (!el) return;
    try {
      const items = await listSuggestionsOnGitHub(data.client, { state: 'open' });
      const { paintTeamSuggestions } = await import('../components/ds/studio/TeamSuggestions');
      paintTeamSuggestions(el, suggestionRows(items));
      if (items.length) $('cg-empty')?.setAttribute('hidden', '');
    } catch {
      // The branches list says when GitHub cannot be read; suggestions only add rows.
    }
  };

  const route = () => {
    const r = teamBranchesRoute(location.search);
    if (r.view === 'pr') {
      suggestions.closeSuggestion(sgHost);
      showList(false);
      void reviews.openPr(r.n, false);
      return;
    }
    if (r.view === 'suggestion') {
      reviews.closePr();
      showList(false);
      if (sgHost) void suggestions.openSuggestion(r.n, { el: sgHost, crumbs: [{ label: 'Branches', href: studioHref('changes/') }, { label: `Suggestion #${r.n}` }] });
      return;
    }
    reviews.closePr();
    suggestions.closeSuggestion(sgHost);
    showList(true);
    listLoaded ??= reviews.loadList();
    suggestionsLoaded ??= listLoaded.then(paintSuggestions);
  };

  reviews.initReviewAuth();
  document.addEventListener('bridge:changes-view', () => showList(false));
  document.addEventListener('click', (e) => {
    const me = e as MouseEvent;
    if (me.metaKey || me.ctrlKey || me.shiftKey || me.button !== 0) return;
    const t = e.target as HTMLElement;
    const pr = t.closest<HTMLElement>('[data-open-pr], [data-open-exploration]');
    const sg = t.closest<HTMLElement>('[data-open-suggestion]');
    const n = Number(pr?.dataset.openPr ?? pr?.dataset.openExploration ?? sg?.dataset.openSuggestion);
    if (!n) return;
    e.preventDefault();
    history.pushState({}, '', sg ? `?suggestion=${n}` : `?pr=${n}`);
    route();
    window.scrollTo({ top: 0 });
  });
  window.addEventListener('popstate', route);
  route();
}
