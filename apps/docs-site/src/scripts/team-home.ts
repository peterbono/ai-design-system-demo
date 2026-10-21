// Studio Home on a team shell (multi-team PR 3b): the same home as /studio/ (components/ds/studio/StudioHome.tsx, the
// GitHub rows of scripts/home-data.ts), with the repo facts the self-hosted page embeds at build time computed in the
// browser from the team's repo model instead: contrast failures, the component list of Create branch, the guidance
// drafts waiting for review. Adoption is not compared here: a team's audits are not paired before and after a move
// the way the demo's are, so its figures live on Quality only. The setup steps are not shown here (they belong to the
// onboarding of hosted teams, multi-team PR 3c).
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { RepoModel } from '@bridge-ds/core';
import { currentViewer, getToken, initGitHubConnect, prefersSignIn } from './github-session';
import { setReviewCount } from './shell';
import { rememberMine } from './needs-you';
import { loadHome, type HomeData, type HomeStatic } from './home-data';
import { loadTeamData, resetTeamData, teamOfPage, type TeamData } from './team-data';
import { paintStudioHome, type HealthLine, type HomeComponent, type StudioHomeProps } from '../components/ds/studio/StudioHome';
import { TeamLoadError, TeamSourceNote } from '../components/ds/studio/TeamState';
import { greeting, homeState } from '../lib/home-model';
import { startChangeHref } from '../lib/overview-board';
import { signedOutLine } from '../lib/overview-todo';
import { ghButton } from '../lib/gh-wording';
import { studioHref } from '../lib/team-path';
import { fileUrl, teamFailure } from '../lib/team-load';

export interface TeamHomeStatic extends HomeStatic {
  components: HomeComponent[];
  startHrefs: StudioHomeProps['startHrefs'];
}

/** Failing contrast checks of a model: one per pair, brand and theme, as the build gate counts them. */
export function contrastFailures(model: Pick<RepoModel, 'contrast'>): number {
  let fail = 0;
  for (const p of model.contrast.pairs) {
    const brands = Object.values(p.brands);
    const results = brands.length ? brands.flatMap((b) => Object.values(b)) : Object.values(p.modes);
    fail += results.filter((r) => r.ratio < p.min).length;
  }
  return fail;
}

/** The repo facts of Studio Home for a team (what /studio/ embeds as #home-static), from its repo model. Pure. */
export function teamHomeStatic(data: Pick<TeamData, 'owner' | 'repo' | 'sha' | 'model'>): TeamHomeStatic {
  const comps = data.model.components?.list ?? [];
  const missing = comps.find((c) => !c.docs);
  return {
    contrastFail: contrastFailures(data.model),
    components: comps.map((c) => ({ name: c.name, slug: c.slug, family: c.category })).sort((a, b) => a.name.localeCompare(b.name)),
    // Drafted guidance waits for review: the row opens the draft on GitHub (the docs editor is the demo Library's).
    guidance: comps.filter((c) => c.docs?.needsReview).map((c) => ({ name: c.name, href: fileUrl(data.owner, data.repo, data.sha, c.files.docs), since: null })),
    startHrefs: {
      tokens: startChangeHref('look'),
      component: startChangeHref('variant'),
      guidance: missing ? fileUrl(data.owner, data.repo, data.sha, missing.dir) : studioHref('components/'),
    },
  };
}

/** Paints the team home into `el` (the [data-studio-home] mount), and the source line into `sourceEl`. */
export function initTeamHome(el: HTMLElement, sourceEl: HTMLElement | null) {
  let root: Root | null = null;
  let sourceRoot: Root | null = null;
  let stat: TeamHomeStatic | null = null;
  let data: HomeData | null = null;
  let known = false;
  let run = 0;
  const signIn = prefersSignIn();

  function health(): HealthLine | null {
    if (!stat) return null;
    return stat.contrastFail ? null : { text: 'Library healthy.', tone: 'ok', href: studioHref('quality/'), link: 'Open Quality' };
  }

  function paint() {
    if (!stat) return;
    const now = Date.now();
    const v = currentViewer();
    const signedIn = Boolean(v) || (!known && Boolean(getToken()));
    const d = data;
    const state = homeState({ signedIn, loading: !d || d.loading, needs: d?.needs.length ?? 0, branches: d?.branches.length ?? 0 });
    root = paintStudioHome(
      el,
      {
        state,
        greeting: greeting(new Date(now).getHours(), v?.name ?? null),
        needs: d?.needs ?? [],
        branches: d?.branches ?? [],
        health: health(),
        now,
        components: stat.components,
        signedOut: { line: signedOutLine(signIn), button: ghButton(signIn), signIn },
        failed: d?.failed ?? null,
        startHrefs: stat.startHrefs,
      },
      root,
    );
  }

  function reload() {
    if (!stat) return;
    data = null;
    const mine = ++run;
    paint();
    void loadHome(stat, (d) => {
      if (mine !== run) return;
      data = d;
      paint();
      if (!d.loading && !d.failed && d.viewer) {
        setReviewCount(d.decisions);
        rememberMine(d.decisions);
      }
      if (!d.viewer) setReviewCount(null);
    });
  }

  function start() {
    loadTeamData().then(
      (team) => {
        stat = teamHomeStatic(team);
        sourceRoot ??= sourceEl ? createRoot(sourceEl) : null;
        sourceRoot?.render(createElement(TeamSourceNote, { data: team, refreshing: false, onRefresh: () => (resetTeamData(), start()) }));
        paint();
        if (known) reload();
      },
      (err: unknown) => {
        const team = teamOfPage();
        root ??= createRoot(el);
        root.render(createElement(TeamLoadError, { failure: teamFailure(err, team ? `${team.owner}/${team.repo}` : 'this repository'), onRetry: () => (resetTeamData(), start()) }));
      },
    );
  }

  start();
  initGitHubConnect(() => {
    known = true;
    reload();
  });
}
